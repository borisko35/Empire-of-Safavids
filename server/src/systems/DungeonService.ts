// ============================================================
// Инстансы подземелий — Empire of Safavids
// ============================================================
// Сессия данжа: монстры данжа спавнятся через ИИ-систему в области
// данжа своего региона, права урона и прогресс — только у участников
// сессии. Убийство всех боссов завершает данж с наградой; выход
// убирает монстров из мира. Состояние в памяти: сессии переживают
// только текущий процесс сервера (транзиентный геймплей).

import { DUNGEONS_DATABASE, DungeonDefinition } from '../data/dungeons';
import { MONSTERS_DATABASE } from '../data/monsters';
import { AISystem } from './AISystem';
import { CharacterService } from '../services/CharacterService';
import { Region } from '../types/game.types';
import { logger } from '../utils/logger';

export interface DungeonSession {
  id: string;
  dungeonId: string;
  region: Region;
  leaderId: string;
  members: Set<string>;
  monsterIds: Set<string>;
  requiredBossIds: Set<string>;
  killedBossIds: Set<string>;
  startedAt: number;
  completedAt?: number;
}

export interface DungeonCompleteInfo {
  sessionId: string;
  dungeonId: string;
  dungeonNameRu: string;
  experience: number;
  gold: number;
  items: string[];
}

export class DungeonService {
  private static instance: DungeonService;
  private sessions = new Map<string, DungeonSession>();
  private monsterToSession = new Map<string, string>();
  private characterToSession = new Map<string, string>();
  private ai = new AISystem(); // заглушка: заменяется при init
  private characters = new CharacterService();

  static getInstance(): DungeonService {
    if (!DungeonService.instance) {
      DungeonService.instance = new DungeonService();
    }
    return DungeonService.instance;
  }

  /** Привязать к ИИ-системе игрового цикла (вызывается из GameLoop.init) */
  attachAI(ai: AISystem): void {
    this.ai = ai;
  }

  /**
   * Войти в данж (создать сессию). Монстры спавнятся в области данжа;
   * клиенты участников получают их через обычный канал спавна региона.
   */
  async enter(characterId: string, dungeonId: string): Promise<
    { ok: true; session: DungeonSession } | { ok: false; code: string }
  > {
    const def: DungeonDefinition | undefined = DUNGEONS_DATABASE[dungeonId];
    if (!def) return { ok: false, code: 'dungeon_not_found' };

    const existingId = this.characterToSession.get(characterId);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing && !existing.completedAt) return { ok: false, code: 'dungeon_already_inside' };
    }

    const character = await this.characters.getCharacterById(characterId);
    if (!character) return { ok: false, code: 'character_not_found' };
    if (character.level < def.minLevel || character.level > def.maxLevel) {
      return { ok: false, code: 'dungeon_level_range' };
    }
    if (character.region !== def.region) {
      return { ok: false, code: 'dungeon_wrong_region' };
    }

    const session: DungeonSession = {
      id: `dg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      dungeonId,
      region: def.region,
      leaderId: characterId,
      members: new Set([characterId]),
      monsterIds: new Set(),
      requiredBossIds: new Set(),
      killedBossIds: new Set(),
      startedAt: Date.now(),
    };

    for (const room of def.rooms) {
      for (const group of room.monsters) {
        for (const pos of group.positions) {
          const monsterDef = MONSTERS_DATABASE[group.monsterId];
          if (!monsterDef) continue;
          const ctx = this.ai.spawnMonster(monsterDef, pos);
          session.monsterIds.add(ctx.instanceId);
          this.monsterToSession.set(ctx.instanceId, session.id);
          if (room.isBossRoom && room.bossId === group.monsterId) {
            session.requiredBossIds.add(ctx.instanceId);
          }
        }
      }
    }

    this.sessions.set(session.id, session);
    this.characterToSession.set(characterId, session.id);
    logger.info(`[Dungeon] ${def.nameRu} started by ${character.name} (${session.monsterIds.size} monsters)`);
    return { ok: true, session };
  }

  /** Выйти из данжа: монстры сессии убираются из мира */
  async leave(characterId: string): Promise<boolean> {
    const sessionId = this.characterToSession.get(characterId);
    if (!sessionId) return false;
    this.characterToSession.delete(characterId);

    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.members.delete(characterId);

    if (session.members.size === 0 && !session.completedAt) {
      this.disposeSession(session);
    }
    return true;
  }

  getSessionByMonster(instanceId: string): DungeonSession | undefined {
    const sessionId = this.monsterToSession.get(instanceId);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  isMember(characterId: string, session: DungeonSession): boolean {
    return session.members.has(characterId);
  }

  getSessionForCharacter(characterId: string): DungeonSession | undefined {
    const sessionId = this.characterToSession.get(characterId);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  /** Убийство монстра данжа: прогресс боссов, завершение с наградой */
  async onMonsterKilled(instanceId: string, killerId: string): Promise<DungeonCompleteInfo | null> {
    const session = this.getSessionByMonster(instanceId);
    if (!session || session.completedAt) return null;

    this.monsterToSession.delete(instanceId);
    session.monsterIds.delete(instanceId);

    if (session.requiredBossIds.has(instanceId)) {
      session.killedBossIds.add(instanceId);

      if ([...session.requiredBossIds].every(id => session.killedBossIds.has(id))) {
        return this.complete(session, killerId);
      }
    }
    return null;
  }

  private async complete(session: DungeonSession, killerId: string): Promise<DungeonCompleteInfo> {
    session.completedAt = Date.now();
    const def = DUNGEONS_DATABASE[session.dungeonId];
    const gold = def.rewards.gold.min + Math.floor(Math.random() * (def.rewards.gold.max - def.rewards.gold.min + 1));

    await this.characters.addExperience(killerId, def.rewards.experience).catch(() => {});
    await this.characters.addGold(killerId, gold).catch(() => {});
    for (const itemId of def.rewards.guaranteedItems) {
      await this.characters.addItems(killerId, [{ itemId, qty: 1 }]).catch(() => {});
    }

    const info: DungeonCompleteInfo = {
      sessionId: session.id,
      dungeonId: session.dungeonId,
      dungeonNameRu: def.nameRu,
      experience: def.rewards.experience,
      gold,
      items: def.rewards.guaranteedItems,
    };
    logger.info(`[Dungeon] ${def.nameRu} completed by ${killerId} (+${def.rewards.experience}xp, +${gold}g)`);
    this.disposeSession(session);
    return info;
  }

  /** Убрать монстры сессии из мира и забыть сессию */
  private disposeSession(session: DungeonSession): void {
    for (const instanceId of session.monsterIds) {
      this.ai.removeInstance(instanceId);
      this.monsterToSession.delete(instanceId);
    }
    for (const member of session.members) {
      if (this.characterToSession.get(member) === session.id) {
        this.characterToSession.delete(member);
      }
    }
    this.sessions.delete(session.id);
  }
}
