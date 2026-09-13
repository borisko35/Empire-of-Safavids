// ============================================================
// Мировые события — Empire of Safavids
// ============================================================
// Периодический спавн мирового босса с объявлением всем игрокам
// и наградой за победу. Одно активное событие за раз; следующее
// стартует по расписанию после завершения предыдущего.

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
  private instanceId: string | null = null;
  private startedAt: number | null = null;
  private nextEventAt = Date.now() + FIRST_EVENT_DELAY_MS;
  private onAnnounce: ((payload: Record<string, unknown>) => void) | null = null;

  static getInstance(): WorldEventSystem {
    if (!WorldEventSystem.instance) {
      WorldEventSystem.instance = new WorldEventSystem();
    }
    return WorldEventSystem.instance;
  }

  /** Привязать ИИ игрового цикла и функцию объявлений (GameLoop/SocketHandler) */
  init(ai: AISystem, announce: (payload: Record<string, unknown>) => void): void {
    this.ai = ai;
    this.onAnnounce = announce;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 30 * 1000);
    logger.info('[WorldEvent] Scheduler started (world boss every 3h, first in 10m)');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getState(): WorldEventState {
    return {
      active: !!this.instanceId,
      bossNameRu: this.instanceId
        ? MONSTERS_DATABASE['world_boss_simurgh']?.nameRu ?? null
        : null,
      instanceId: this.instanceId,
      startedAt: this.startedAt,
      nextEventAt: this.nextEventAt,
    };
  }

  /** Активный босс события? */
  isActiveBoss(instanceId: string): boolean {
    return !!instanceId && instanceId === this.instanceId;
  }

  /** Победа над боссом события: награда и объявление */
  async onBossDefeated(killerId: string): Promise<void> {
    if (!this.instanceId) return;
    this.instanceId = null;
    this.startedAt = null;
    this.nextEventAt = Date.now() + EVENT_INTERVAL_MS;

    // Награда победителю: золото и перо Симурга (легендарный материал)
    await this.characters.addGold(killerId, 5000).catch(() => {});
    await this.characters.addItems(killerId, [{ itemId: 'mat_dragon_scale', qty: 1 }]).catch(() => {});
    this.announce({ status: 'defeated', killerId });
    logger.info(`[WorldEvent] Boss defeated by ${killerId}, next event in 3h`);
  }

  private async tick(): Promise<void> {
    if (this.instanceId || !this.ai || Date.now() < this.nextEventAt) return;
    this.spawnBoss();
  }

  private spawnBoss(): void {
    const def: MonsterDefinition | undefined = MONSTERS_DATABASE['world_boss_simurgh'];
    if (!def || !this.ai) return;

    // Гнездо Симурга — горы Хорасана
    const position: Vector3 = { x: 0, y: 100, z: 0 };
    const ctx = this.ai.spawnMonster(def, position);
    this.instanceId = ctx.instanceId;
    this.startedAt = Date.now();

    this.announce({ status: 'started', nameRu: def.nameRu, region: Region.KHORASAN, position });
    logger.info(`[WorldEvent] ${def.nameRu} spawned (${ctx.instanceId})`);
  }

  private announce(payload: Record<string, unknown>): void {
    this.onAnnounce?.({ ...payload, startedAt: this.startedAt, nextEventAt: this.nextEventAt });
  }
}
