// ============================================================
// Game Loop — центральный оркестратор игровых систем
// ============================================================
// До этого момента системы (спавн, ИИ, мировое время, карма)
// существовали изолированно: никто не вызывал их тики.
// GameLoop запускается при старте сервера и сводит их вместе.

import { Region } from '../types/game.types';
import { SpawnSystem } from './SpawnSystem';
import { KarmaSystem } from './KarmaSystem';
import { WorldTimeSystem } from './WorldTimeSystem';
import { RedisService } from '../services/RedisService';
import { logger } from '../utils/logger';

const TICK_INTERVAL_MS = 1000;
const AI_TICK_EVERY = 2;        // тик ИИ раз в 2 секунды
const WORLD_TIME_EVERY = 60;    // вещание игрового времени раз в минуту
const KARMA_DECAY_EVERY = 3600; // распад кармы раз в час

export class GameLoop {
  private static instance: GameLoop;

  private spawnSystem = new SpawnSystem();
  private karmaSystem = new KarmaSystem();
  private worldTime = new WorldTimeSystem();
  private redis = RedisService.getInstance();

  private timer: NodeJS.Timeout | null = null;
  private tickCount = 0;
  private running = false;

  static getInstance(): GameLoop {
    if (!GameLoop.instance) {
      GameLoop.instance = new GameLoop();
    }
    return GameLoop.instance;
  }

  getSpawnSystem(): SpawnSystem {
    return this.spawnSystem;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    logger.info('[GameLoop] Started (tick = 1s)');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    logger.info('[GameLoop] Stopped');
  }

  private tick(): void {
    this.tickCount++;
    try {
      // Респавн монстров
      this.spawnSystem.tick();

      // Тик ИИ для всех активных монстров
      if (this.tickCount % AI_TICK_EVERY === 0) {
        void this.tickAI();
      }

      // Вещание игрового времени (день/ночь/погода)
      if (this.tickCount % WORLD_TIME_EVERY === 0) {
        void this.worldTime.broadcastWorldTime();
      }

      // Постепенное восстановление отрицательной кармы у онлайн-игроков
      if (this.tickCount % KARMA_DECAY_EVERY === 0) {
        void this.decayKarmaOnline();
      }
    } catch (error) {
      logger.error('[GameLoop] Tick error:', error);
    }
  }

  private async tickAI(): Promise<void> {
    // Собираем онлайн-игроков по регионам из Redis
    const nearbyPlayers = new Map<string, { id: string; position: { x: number; y: number; z: number }; hp: number }[]>();
    for (const region of Object.values(Region)) {
      const ids = await this.redis.getPlayersInRegion(region);
      const players: { id: string; position: { x: number; y: number; z: number }; hp: number }[] = [];
      for (const id of ids) {
        const pos = await this.redis.getPlayerPosition(id) as { x: number; y: number; z: number } | null;
        if (pos) players.push({ id, position: pos, hp: 100 }); // HP уточняется при реальном уроне
      }
      nearbyPlayers.set(region, players);
    }
    this.spawnSystem.tickAI(nearbyPlayers);
  }

  private async decayKarmaOnline(): Promise<void> {
    for (const region of Object.values(Region)) {
      const ids = await this.redis.getPlayersInRegion(region);
      for (const id of ids) {
        await this.karmaSystem.decayKarma(id);
      }
    }
  }
}
