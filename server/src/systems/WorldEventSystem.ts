// ============================================================
// Мировые события — Empire of Safavids
// ============================================================
// Периодический спавн мирового босса на каждом активном шарде
// (игровом сервере) с объявлением его игрокам и наградой за победу.
// Одно активное событие на шард за раз; следующее — по расписанию.

import { MONSTERS_DATABASE, MonsterDefinition } from '../data/monsters';
import { Region } from '../types/game.types';
import { Vector3 } from '../types/game.types';
import { AISystem } from './AISystem';
import { CharacterService } from '../services/CharacterService';
import { logger } from '../utils/logger';

// Расписание: первое событие через 10 минут после старта сервера,
// далее каждые 3 часа
const FIRST_EVENT_DELAY_MS = 10 * 60 * 1000;
const EVENT_INTERVAL_MS = 3 * 60 * 60 * 1000;

export interface WorldEventState {
  active: boolean;
  bossNameRu: string | null;
  instanceId: string | null;
  startedAt: number | null;
  nextEventAt: number;
}

export class WorldEventSystem {
  private static instance: WorldEventSystem;

  private ai: AISystem | null = null;
  private characters = new CharacterService();
  private timer: NodeJS.Timeout | null = null;
  /** Активные боссы по шардам: shardId -> instanceId */
  private bosses = new Map<string, string>();
  private startedAt: number | null = null;
  private nextEventAt = Date.now() + FIRST_EVENT_DELAY_MS;
  private onAnnounce: ((payload: Record<string, unknown>) => void) | null = null;
  private getActiveShards: () => string[] = () => [];

  static getInstance(): WorldEventSystem {
    if (!WorldEventSystem.instance) {
      WorldEventSystem.instance = new WorldEventSystem();
    }
    return WorldEventSystem.instance;
  }

  /** Привязать ИИ игрового цикла, список активных шардов и функцию объявлений */
  init(
    ai: AISystem,
    getActiveShards: () => string[],
    announce: (payload: Record<string, unknown>) => void,
  ): void {
    this.ai = ai;
    this.getActiveShards = getActiveShards;
    this.onAnnounce = announce;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, 30 * 1000);
    logger.info('[WorldEvent] Scheduler started (world boss every 3h per shard, first in 10m)');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Активный босс события? */
  isActiveBoss(instanceId: string): boolean {
    return instanceId != null && [...this.bosses.values()].includes(instanceId);
  }

  /** Победа над боссом события: награда и объявление шарду */
  async onBossDefeated(instanceId: string, killerId: string): Promise<void> {
    let shardId: string | undefined;
    for (const [sid, id] of this.bosses) {
      if (id === instanceId) shardId = sid;
    }
    if (!shardId) return;
    this.bosses.delete(shardId);
    if (this.bosses.size === 0) this.nextEventAt = Date.now() + EVENT_INTERVAL_MS;

    // Награда победителю: золото и перо Симурга (легендарный материал)
    await this.characters.addGold(killerId, 5000).catch(() => {});
    await this.characters.addItems(killerId, [{ itemId: 'mat_dragon_scale', qty: 1 }]).catch(() => {});
    this.announce({ status: 'defeated', killerId, shardId });
    logger.info(`[WorldEvent] Boss defeated by ${killerId} on ${shardId}`);
  }

  private async tick(): Promise<void> {
    if (!this.ai || Date.now() < this.nextEventAt) return;
    for (const shardId of this.getActiveShards()) {
      if (!this.bosses.has(shardId)) {
        this.spawnBoss(shardId);
      }
    }
  }

  private spawnBoss(shardId: string): void {
    const def: MonsterDefinition | undefined = MONSTERS_DATABASE['world_boss_simurgh'];
    if (!def || !this.ai) return;

    // Гнездо Симурга — горы Хорасана
    const position: Vector3 = { x: 0, y: 100, z: 0 };
    const ctx = this.ai.spawnMonster(def, position, shardId);
    this.bosses.set(shardId, ctx.instanceId);
    this.startedAt = Date.now();

    this.announce({ status: 'started', nameRu: def.nameRu, region: Region.KHORASAN, position, shardId });
    logger.info(`[WorldEvent] ${def.nameRu} spawned on ${shardId} (${ctx.instanceId})`);
  }

  private announce(payload: Record<string, unknown>): void {
    this.onAnnounce?.({ ...payload, startedAt: this.startedAt, nextEventAt: this.nextEventAt });
  }
}
