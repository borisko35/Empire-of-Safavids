// ============================================================
// Spawn System — Empire of Safavids
// ============================================================
// Точки спавна на каждый игровой сервер (шард). Монстры шарда
// заспавнены, только пока на нём есть игроки (ленивый спавн):
// первый вошедший активирует шард, опустевший — выгружается.

import { Region } from '../types/game.types';
import { MONSTERS_DATABASE } from '../data/monsters';
import { AISystem } from './AISystem';
import { WorldTimeSystem, Weather } from './WorldTimeSystem';
import { RedisService } from '../services/RedisService';
import { logger } from '../utils/logger';

export interface SpawnPoint {
  id: string;
  monsterId: string;
  region: Region;
  position: { x: number; y: number; z: number };
  maxCount: number;
  /** Текущее число живых монстров точки, по шардам */
  counts: Map<string, number>;
  respawnTime: number; // секунды
  lastDeath: Record<string, number>; // shardId -> момент смерти
  weatherBonus: Partial<Record<Weather, number>>; // модификатор спавна
}

function makePoint(p: Omit<SpawnPoint, 'counts' | 'lastDeath'>): SpawnPoint {
  return { ...p, counts: new Map(), lastDeath: {} };
}

// Исфахан (столица): мобы внутри стен не спавнятся.
// Координаты продублированы из клиента (game3d/terrain.ts CITY) намеренно:
// сервер не тянет клиентский модуль, а стены двигаются редко.
const ISFAHAN = { x: 34, z: 26, radius: 116 };

// Точки спавна (шаблон; экземпляры создаются на каждый активный шард)
const SPAWN_POINTS: SpawnPoint[] = [
  // ─ Тебриз
  makePoint({ id: 'sp_tabriz_01', monsterId: 'mob_bandit_scout',   region: Region.TABRIZ,      position: { x: 143, y: 0, z: 115 }, maxCount: 5, respawnTime: 60,   weatherBonus: {} }),
  makePoint({ id: 'sp_tabriz_02', monsterId: 'mob_bandit_warrior', region: Region.TABRIZ,      position: { x: -80, y: 0, z: 120 }, maxCount: 3, respawnTime: 90,   weatherBonus: { fog: 1.5 } }),
  makePoint({ id: 'sp_tabriz_scorp', monsterId: 'mob_desert_scorpion', region: Region.TABRIZ,   position: { x: 220, y: 0, z: 70  }, maxCount: 4, respawnTime: 45,   weatherBonus: { sandstorm: 2.0 } }),
  makePoint({ id: 'sp_tabriz_wolf',  monsterId: 'mob_wolf',         region: Region.TABRIZ,      position: { x: -90, y: 0, z: 130 }, maxCount: 3, respawnTime: 60,   weatherBonus: { fog: 1.5 } }),
  // ─ Шираз
  makePoint({ id: 'sp_shir_01',   monsterId: 'mob_bandit_scout',   region: Region.SHIRAZ,      position: { x: 110, y: 0, z: -91 }, maxCount: 4, respawnTime: 75,   weatherBonus: {} }),
  makePoint({ id: 'sp_shir_02',   monsterId: 'mob_fog_assassin',   region: Region.SHIRAZ,      position: { x: -110, y: 0, z: -90 }, maxCount: 2, respawnTime: 240,  weatherBonus: { fog: 2.0 } }),
  // ─ Кавказ
  makePoint({ id: 'sp_cauc_01',   monsterId: 'mob_mongol_raider',  region: Region.CAUCASUS,    position: { x: 66,  y: 0, z: 167 }, maxCount: 4, respawnTime: 120,  weatherBonus: { snow: 1.4 } }),
  makePoint({ id: 'sp_cauc_02',   monsterId: 'mob_bandit_warrior', region: Region.CAUCASUS,    position: { x: -140, y: 0, z: 160 }, maxCount: 3, respawnTime: 150,  weatherBonus: {} }),
  // ─ Месопотамия
  makePoint({ id: 'sp_meso_01',   monsterId: 'mob_ottoman_janissary', region: Region.MESOPOTAMIA, position: { x: 200, y: 0, z: 50  }, maxCount: 4, respawnTime: 300,  weatherBonus: { sandstorm: 1.3 } }),
  // ─ Хорасан
  makePoint({ id: 'sp_khor_01',   monsterId: 'mob_mongol_raider',    region: Region.KHORASAN,    position: { x: -150, y: 0, z: 200 }, maxCount: 3, respawnTime: 600,  weatherBonus: {} }),
  makePoint({ id: 'sp_khor_02',   monsterId: 'mob_div_fire',         region: Region.KHORASAN,    position: { x: 300, y: 0, z: -100 }, maxCount: 2, respawnTime: 1800, weatherBonus: { storm: 2.0 } }),
  makePoint({ id: 'sp_khor_03',   monsterId: 'mob_sand_div',         region: Region.KHORASAN,    position: { x: 180, y: 0, z: 230 }, maxCount: 2, respawnTime: 900,  weatherBonus: { sandstorm: 3.0 } }),
  // ─ Персидский залив
  makePoint({ id: 'sp_gulf_01',   monsterId: 'mob_ottoman_janissary', region: Region.PERSIAN_GULF, position: { x: -60, y: 0, z: -170 }, maxCount: 4, respawnTime: 180,  weatherBonus: {} }),
  makePoint({ id: 'sp_gulf_02',   monsterId: 'mob_bandit_warrior',    region: Region.PERSIAN_GULF, position: { x: 140, y: 0, z: -190 }, maxCount: 3, respawnTime: 150,  weatherBonus: { storm: 1.6 } }),
  // ─ Мировые боссы
  makePoint({ id: 'sp_wb_simurgh', monsterId: 'world_boss_simurgh',  region: Region.KHORASAN,    position: { x: 0, y: 100, z: 0 },   maxCount: 1, respawnTime: 604800, weatherBonus: {} }),
  makePoint({ id: 'sp_wb_rustam',  monsterId: 'world_boss_rustam_reborn', region: Region.PERSIAN_GULF, position: { x: 40, y: 0, z: -230 }, maxCount: 1, respawnTime: 1209600, weatherBonus: {} }),
];

export class SpawnSystem {
  private ai          = new AISystem();
  private worldTime   = new WorldTimeSystem();
  private redis       = RedisService.getInstance();
  private spawnPoints = new Map<string, SpawnPoint>();
  /** instanceId -> { shardId, spawnPointId } */
  private instanceIndex = new Map<string, { shardId: string; spawnPointId: string }>();
  /** Активные шарды: на них заспавнены монстры и идёт тик */
  private activeShards = new Set<string>();

  constructor() {
    for (const sp of SPAWN_POINTS) {
      this.spawnPoints.set(sp.id, sp);
    }
  }

  // ── Управление шардами ─────────────────────────────────────

  /** Первый игрок вошёл в шард — заселить монстров */
  activateShard(shardId: string): void {
    if (this.activeShards.has(shardId)) return;
    this.activeShards.add(shardId);
    logger.info(`[Spawn] Shard activated: ${shardId}`);
  }

  /** Шард опустел — убрать его монстров из мира */
  deactivateShard(shardId: string): void {
    if (!this.activeShards.has(shardId)) return;
    const ai = this.ai;
    for (const ctx of ai.getAllInstances()) {
      if (ctx.shardId === shardId) {
        ai.removeInstance(ctx.instanceId);
        this.instanceIndex.delete(ctx.instanceId);
        for (const sp of this.spawnPoints.values()) sp.counts.delete(shardId);
      }
    }
    this.activeShards.delete(shardId);
    logger.info(`[Spawn] Shard deactivated: ${shardId}`);
  }

  getActiveShards(): string[] {
    return [...this.activeShards];
  }

  isShardActive(shardId: string): boolean {
    return this.activeShards.has(shardId);
  }

  // ── Тик системы спавна (1 раз в секунду) ───────────────────
  tick(): void {
    const now = Date.now();
    const worldTime = this.worldTime.getCurrentWorldTime();

    for (const sid of this.activeShards) {
      for (const sp of this.spawnPoints.values()) {
        const current = sp.counts.get(sid) ?? 0;
        if (current >= sp.maxCount) continue;

        const elapsed = (now - (sp.lastDeath[sid] ?? 0)) / 1000;
        let respawnTime = sp.respawnTime;

        // Погодный модификатор
        const weatherMod = sp.weatherBonus[worldTime.weather] ?? 1.0;
        respawnTime = respawnTime / weatherMod;

        // Ночью монстры респят быстрее
        if (worldTime.timeOfDay === 'night' || worldTime.timeOfDay === 'midnight') {
          respawnTime *= 0.7;
        }

        if (elapsed >= respawnTime) {
          this.spawnMonster(sp, sid);
        }
      }
    }
  }

  // ── Спавн монстра ───────────────────────────────────────────
  private spawnMonster(sp: SpawnPoint, shardId: string): void {
    const def = MONSTERS_DATABASE[sp.monsterId];
    if (!def) return;

    // Страховка от расширения города: не спавнить внутри стен Исфахана.
    // (точки уже вынесены, это защита от будущих правок данных)
    if (Math.hypot(sp.position.x - ISFAHAN.x, sp.position.z - ISFAHAN.z) < ISFAHAN.radius + 15) {
      logger.debug(`[Spawn] skipped ${sp.id}: inside city walls`);
      return;
    }

    // Случайный разброс позиции
    const jitter = 5;
    const pos = {
      x: sp.position.x + (Math.random() - 0.5) * jitter,
      y: sp.position.y,
      z: sp.position.z + (Math.random() - 0.5) * jitter,
    };

    const ctx = this.ai.spawnMonster(def, pos, shardId);
    sp.counts.set(shardId, (sp.counts.get(shardId) ?? 0) + 1);
    this.instanceIndex.set(ctx.instanceId, { shardId, spawnPointId: sp.id });

    // Уведомляем игроков шарда в регионе
    this.redis.publish(`region:${shardId}:${sp.region}:spawn`, {
      instanceId: ctx.instanceId,
      monsterId: def.id,
      nameRu: def.nameRu,
      position: pos,
      hp: def.hp,
      type: def.type,
    }).catch(() => {});

    logger.debug(`[Spawn] ${def.nameRu} spawned at ${sp.region} on ${shardId} (${sp.id})`);
  }

  // ── Смерть монстра ──────────────────────────────────────────
  onMonsterDeath(instanceId: string, spawnPointId: string, shardId: string): void {
    const sp = this.spawnPoints.get(spawnPointId);
    if (sp) {
      sp.counts.set(shardId, Math.max(0, (sp.counts.get(shardId) ?? 0) - 1));
      sp.lastDeath[shardId] = Date.now();
    }
    this.instanceIndex.delete(instanceId);
    logger.debug(`[Spawn] Monster ${instanceId} died on ${shardId}, respawn in ${sp?.respawnTime}s`);
  }

  /**
   * Смерть монстра по instanceId (убит игроком через сокет).
   */
  onInstanceDeath(instanceId: string): void {
    const info = this.instanceIndex.get(instanceId);
    if (!info) return;
    this.onMonsterDeath(instanceId, info.spawnPointId, info.shardId);
  }

  // ── Тик ИИ ──────────────────────────────────────────────────
  /**
   * Тик ИИ всех активных монстров. Игроки передаются по ключу
   * «шард:регион» — монстр видит только игроков своего шарда.
   */
  tickAI(nearbyPlayers: Map<string, { id: string; position: { x: number; y: number; z: number }; hp: number }[]>): {
    shardId: string; region: Region; instanceId: string; targetId?: string; skillId?: string; type: string;
  }[] {
    const attacks: { shardId: string; region: Region; instanceId: string; targetId?: string; skillId?: string; type: string }[] = [];
    for (const ctx of this.ai.getAllInstances()) {
      const players = nearbyPlayers.get(`${ctx.shardId}:${ctx.definition.region}`) ?? [];
      const action = this.ai.tick(ctx.instanceId, players);
      if (action.type !== 'idle') {
        this.redis.publish(`region:${ctx.shardId}:${ctx.definition.region}:ai_action`, {
          instanceId: ctx.instanceId,
          action,
        }).catch(() => {});
      }
      if ((action.type === 'attack' || action.type === 'skill') && action.targetId) {
        attacks.push({
          shardId: ctx.shardId,
          region: ctx.definition.region,
          instanceId: ctx.instanceId,
          targetId: action.targetId,
          skillId: action.skillId,
          type: action.type,
        });
      }
    }
    return attacks;
  }

  getAI(): AISystem { return this.ai; }
}
