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
import { DatabaseService } from '../services/DatabaseService';
import { grantReputation } from './ReputationGrants';
import { Region } from '../types/game.types';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface DungeonSession {
  id: string;
  dungeonId: string;
  region: Region;
  shardId: string;
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
  private db = DatabaseService.getInstance();
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

    // Идентификатор сессии — UUID, а не строка вида dg_1756_abc123.
    //
    // ЧТО БЫЛО. Идентификатор собирался из времени и случайных символов, а
    // колонка dungeon_sessions.id объявлена как UUID со ссылкой на
    // characters(id). Такое значение в колонку UUID не пишется: Postgres
    // отвергал бы его. То есть сессия не могла оказаться в базе в принципе,
    // и перезапуск сервера стирал все заходы молча — без ошибки, без записи
    // в лог. Пять таблиц dungeon_* существовали, но не наполнялись.
    const session: DungeonSession = {
      id: uuidv4(),
      dungeonId,
      region: def.region,
      shardId: character.serverId ?? 'isfahan',
      leaderId: characterId,
      members: new Set([characterId]),
      monsterIds: new Set(),
      requiredBossIds: new Set(),
      killedBossIds: new Set(),
      startedAt: Date.now(),
    };

    this.spawnSessionMonsters(session, def);

    this.sessions.set(session.id, session);
    this.characterToSession.set(characterId, session.id);
    // Запись в базу. Ошибка здесь не должна отменять вход: игрок уже
    // внутри, монстры уже заспавнены. Но молча проглатывать нельзя — иначе
    // останется ровно то же, что было: потерянный заход без следа.
    await this.persistSession(session).catch((e) =>
      logger.warn(`[Dungeon] не удалось записать сессию ${session.id}: ${e}`));
    logger.info(`[Dungeon] ${def.nameRu} started by ${character.name} (${session.monsterIds.size} monsters)`);
    return { ok: true, session };
  }

  /**
   * Заспавнить монстров захода.
   *
   * Один код на два случая: новый заход (enter) и восстановление после
   * перезапуска. Если бы списки монстров и боссов набирались в двух местах,
   * то одна из копий рано или поздно разошлась бы с другой, и восстановленный
   * заход считался бы выигранным тем, чего на самом деле не было убито.
   */
  private spawnSessionMonsters(session: DungeonSession, def: DungeonDefinition): void {
    for (const room of def.rooms) {
      for (const group of room.monsters) {
        for (const pos of group.positions) {
          const monsterDef = MONSTERS_DATABASE[group.monsterId];
          if (!monsterDef) continue;
          const ctx = this.ai.spawnMonster(monsterDef, pos, session.shardId);
          session.monsterIds.add(ctx.instanceId);
          this.monsterToSession.set(ctx.instanceId, session.id);
          if (room.isBossRoom && room.bossId === group.monsterId) {
            session.requiredBossIds.add(ctx.instanceId);
          }
        }
      }
    }
  }

  /**
   * Записать сессию и её участников в базу.
   *
   * dungeon_sessions и dungeon_members созданы миграцией 010 и с тех пор
   * пустые. Монстры намеренно не сохраняются: их состав выводится из
   * DUNGEONS_DATABASE при восстановлении, а идентификаторы экземпляров
   * всё равно меняются при каждом спавне.
   */
  private async persistSession(session: DungeonSession): Promise<void> {
    await this.db.query(
      `INSERT INTO dungeon_sessions (id, dungeon_id, difficulty, leader_id, max_size, started_at, status)
       VALUES ($1, $2, 'normal', $3, 5, to_timestamp($4 / 1000.0), 'active')
       ON CONFLICT (id) DO NOTHING`,
      [session.id, session.dungeonId, session.leaderId, session.startedAt]
    );
    for (const memberId of session.members) {
      await this.db.query(
        `INSERT INTO dungeon_members (session_id, character_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id, character_id) DO NOTHING`,
        [session.id, memberId, memberId === session.leaderId ? 'leader' : 'member']
      );
    }
  }

  /**
   * Закрыть сессию в базе: простав��ить статус и время завершения.
   *
   * abandoned — игрок вышел сам, completed — заход доведён до конца.
   */
  private async closeSessionInDb(sessionId: string, status: 'completed' | 'abandoned'): Promise<void> {
    await this.db.query(
      `UPDATE dungeon_sessions
       SET status = $2, completed_at = NOW()
       WHERE id = $1 AND status = 'active'`,
      [sessionId, status]
    ).catch((e) => logger.warn(`[Dungeon] не удалось закрыть сессию ${sessionId}: ${e}`));
  }

  /**
   * Вернуть из базы заходы, которые остались активными после перезапуска.
   *
   * ЧТО ЭТО ДЕЛАЕТ. Сервер поднимается, читает незакрытые сессии и снова
   * спавнит их монстров. Игрок, зашедший в данж перед рестартом, возвращается
   * в тот же заход, а не начинает заново. Без этого перезапуск обслуживания
   * стирал прогресс всех, кто в этот момент был внутри.
   *
   * Вызывается один раз при старте сервера, до приёма соединений.
   */
  async restoreActiveSessions(): Promise<number> {
    const rows = await this.db.query<{
      id: string; dungeon_id: string; leader_id: string; started_at: Date;
    }>(
      `SELECT s.id, s.dungeon_id, s.leader_id, s.started_at
       FROM dungeon_sessions s
       WHERE s.status = 'active'`
    ).catch((e) => {
      logger.warn(`[Dungeon] не удалось прочитать активные сессии: ${e}`);
      return [];
    });
    if (!rows.length) return 0;

    let restored = 0;
    for (const row of rows) {
      const def = DUNGEONS_DATABASE[row.dungeon_id];
      if (!def) {
        // Данж в коде удалили, а сессия осталась. Закрываем, чтобы не висела
        // вечно и не занимала место в восстановлении при следующем старте
        await this.closeSessionInDb(row.id, 'abandoned');
        continue;
      }
      const leader = await this.characters.getCharacterById(row.leader_id).catch(() => null);
      if (!leader) {
        await this.closeSessionInDb(row.id, 'abandoned');
        continue;
      }

      const members = await this.db.query<{ character_id: string }>(
        'SELECT character_id FROM dungeon_members WHERE session_id = $1',
        [row.id]
      ).catch(() => []);

      const session: DungeonSession = {
        id: row.id,
        dungeonId: row.dungeon_id,
        region: def.region,
        shardId: leader.serverId ?? 'isfahan',
        leaderId: row.leader_id,
        members: new Set(members.map(m => m.character_id)),
        monsterIds: new Set(),
        requiredBossIds: new Set(),
        killedBossIds: new Set(),
        startedAt: new Date(row.started_at).getTime(),
      };
      session.members.add(row.leader_id);
      this.spawnSessionMonsters(session, def);

      this.sessions.set(session.id, session);
      for (const memberId of session.members) this.characterToSession.set(memberId, session.id);
      restored++;
    }
    if (restored) logger.info(`[Dungeon] восстановлено активных заходов: ${restored}`);
    return restored;
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
      // Последний участник вышел — заход брошен. Без этой записи сессия
      // осталась бы в базе со статусом active и вернулась бы при следующем
      // перезапуске сервера как живая, хотя монстров давно нет
      await this.closeSessionInDb(session.id, 'abandoned');
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
    // Репутация за данж — заметный поступок, а не рядовой бой
    void grantReputation(killerId, 'dungeonClear');

    // История прохождений. Таблица создана миграцией 010 и с тех пор пуста:
    // без неё нельзя ни показать игроку «сколько данжей ты прошёл», ни
    // понять, какие из них никто не проходил (на таких стоит переписать
    // награду — обычно они слишком жёсткие или слишком щедрые).
    const durationSec = Math.max(0, Math.round((session.completedAt - session.startedAt) / 1000));
    const totalMonsters = session.requiredBossIds.size + session.monsterIds.size;
    await this.db.query(
      `INSERT INTO dungeon_history
         (character_id, dungeon_id, difficulty, result, monsters_killed, bosses_killed, duration_sec)
       VALUES ($1, $2, 'normal', 'completed', $3, $4, $5)`,
      [killerId, session.dungeonId, totalMonsters, session.killedBossIds.size, durationSec]
    ).catch((e) => logger.warn(`[Dungeon] не удалось записать историю: ${e}`));
    await this.closeSessionInDb(session.id, 'completed');

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
