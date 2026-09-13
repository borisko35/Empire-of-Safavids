// ============================================================
// Spawn System — Empire of Safavids
// ============================================================

import { Region } from '../types/game.types';
import { MONSTERS_DATABASE } from '../data/monsters';
import { AISystem, AIContext } from './AISystem';
import { WorldTimeSystem, Weather } from './WorldTimeSystem';
import { RedisService } from '../services/RedisService';
import { logger } from '../utils/logger';

export interface SpawnPoint {
  id: string;
  monsterId: string;
  region: Region;
  position: { x: number; y: number; z: number };
  maxCount: number;
  currentCount: number;
  respawnTime: number; // секунды
  lastDeath: number;
  weatherBonus: Partial<Record<Weather, number>>; // модификатор спавна
}

// Точки спавна по регионам
const SPAWN_POINTS: SpawnPoint[] = [
  // ─ Тебриз
  { id: 'sp_tabriz_01', monsterId: 'mob_bandit_scout',   region: Region.TABRIZ,      position: { x: 100, y: 0, z: 80  }, maxCount: 5, currentCount: 0, respawnTime: 60,   lastDeath: 0, weatherBonus: {} },
  { id: 'sp_tabriz_02', monsterId: 'mob_bandit_warrior', region: Region.TABRIZ,      position: { x: -80, y: 0, z: 120 }, maxCount: 3, currentCount: 0, respawnTime: 90,   lastDeath: 0, weatherBonus: { fog: 1.5 } },
  // ─ Шираз
  { id: 'sp_shir_01',   monsterId: 'mob_bandit_scout',   region: Region.SHIRAZ,      position: { x: 90,  y: 0, z: -60 }, maxCount: 4, currentCount: 0, respawnTime: 75,   lastDeath: 0, weatherBonus: {} },
  { id: 'sp_shir_02',   monsterId: 'mob_fog_assassin',   region: Region.SHIRAZ,      position: { x: -110, y: 0, z: -90 }, maxCount: 2, currentCount: 0, respawnTime: 240,  lastDeath: 0, weatherBonus: { fog: 2.0 } },
  // ─ Кавказ
  { id: 'sp_cauc_01',   monsterId: 'mob_mongol_raider',  region: Region.CAUCASUS,    position: { x: 60,  y: 0, z: 140 }, maxCount: 4, currentCount: 0, respawnTime: 120,  lastDeath: 0, weatherBonus: { snow: 1.4 } },
  { id: 'sp_cauc_02',   monsterId: 'mob_bandit_warrior', region: Region.CAUCASUS,    position: { x: -140, y: 0, z: 160 }, maxCount: 3, currentCount: 0, respawnTime: 150,  lastDeath: 0, weatherBonus: {} },
  // ─ Месопотамия
  { id: 'sp_meso_01',   monsterId: 'mob_ottoman_janissary', region: Region.MESOPOTAMIA, position: { x: 200, y: 0, z: 50  }, maxCount: 4, currentCount: 0, respawnTime: 300,  lastDeath: 0, weatherBonus: { sandstorm: 1.3 } },
  // ─ Хорасан
  { id: 'sp_khor_01',   monsterId: 'mob_mongol_raider',    region: Region.KHORASAN,    position: { x: -150, y: 0, z: 200 }, maxCount: 3, currentCount: 0, respawnTime: 600,  lastDeath: 0, weatherBonus: {} },
  { id: 'sp_khor_02',   monsterId: 'mob_div_fire',         region: Region.KHORASAN,    position: { x: 300, y: 0, z: -100 }, maxCount: 2, currentCount: 0, respawnTime: 1800, lastDeath: 0, weatherBonus: { storm: 2.0 } },
  { id: 'sp_khor_03',   monsterId: 'mob_sand_div',         region: Region.KHORASAN,    position: { x: 180, y: 0, z: 230 }, maxCount: 2, currentCount: 0, respawnTime: 900,  lastDeath: 0, weatherBonus: { sandstorm: 3.0 } },
  // ─ Персидский залив
  { id: 'sp_gulf_01',   monsterId: 'mob_ottoman_janissary', region: Region.PERSIAN_GULF, position: { x: -60, y: 0, z: -170 }, maxCount: 4, currentCount: 0, respawnTime: 180,  lastDeath: 0, weatherBonus: {} },
  { id: 'sp_gulf_02',   monsterId: 'mob_bandit_warrior',    region: Region.PERSIAN_GULF, position: { x: 140, y: 0, z: -190 }, maxCount: 3, currentCount: 0, respawnTime: 150,  lastDeath: 0, weatherBonus: { storm: 1.6 } },
  // ─ Мировые боссы
  { id: 'sp_wb_simurgh', monsterId: 'world_boss_simurgh',  region: Region.KHORASAN,    position: { x: 0, y: 100, z: 0 },   maxCount: 1, currentCount: 0, respawnTime: 604800, lastDeath: 0, weatherBonus: {} },
  { id: 'sp_wb_rustam',  monsterId: 'world_boss_rustam_reborn', region: Region.PERSIAN_GULF, position: { x: 40, y: 0, z: -230 }, maxCount: 1, currentCount: 0, respawnTime: 1209600, lastDeath: 0, weatherBonus: {} },
];

export class SpawnSystem {
  private ai          = new AISystem();
  private worldTime   = new WorldTimeSystem();
  private redis       = RedisService.getInstance();
  private spawnPoints = new Map<string, SpawnPoint>();
  private activeInstances = new Map<string, AIContext>(); // spawnPointId -> instance

  constructor() {
    for (const sp of SPAWN_POINTS) {
      this.spawnPoints.set(sp.id, { ...sp });
    }
  }

  // ============================================================
  // Тик системы спавна (1 раз в секунду)
  // ============================================================
  tick(): void {
    const now = Date.now();
    const worldTime = this.worldTime.getCurrentWorldTime();

    for (const [, sp] of this.spawnPoints) {
      if (sp.currentCount >= sp.maxCount) continue;

      const elapsed = (now - sp.lastDeath) / 1000;
      let respawnTime = sp.respawnTime;

      // Погодный модификатор
      const weatherMod = sp.weatherBonus[worldTime.weather] ?? 1.0;
      respawnTime = respawnTime / weatherMod;

      // Ночью монстры респят быстрее
      if (worldTime.timeOfDay === 'night' || worldTime.timeOfDay === 'midnight') {
        respawnTime *= 0.7;
      }

      if (elapsed >= respawnTime) {
        this.spawnMonster(sp);
      }
    }
  }

  // ============================================================
  // Спавн монстра
  // ============================================================
  private spawnMonster(sp: SpawnPoint): void {
    const def = MONSTERS_DATABASE[sp.monsterId];
    if (!def) return;

    // Случайный разброс позиции
    const jitter = 5;
    const pos = {
      x: sp.position.x + (Math.random() - 0.5) * jitter,
      y: sp.position.y,
      z: sp.position.z + (Math.random() - 0.5) * jitter,
    };

    const ctx = this.ai.spawnMonster(def, pos);
    sp.currentCount++;
    this.activeInstances.set(sp.id + '_' + ctx.instanceId, ctx);

    // Уведомляем игроков в регионе
    this.redis.publish(`region:${sp.region}:spawn`, {
      instanceId: ctx.instanceId,
      monsterId: def.id,
      nameRu: def.nameRu,
      position: pos,
      hp: def.hp,
      type: def.type,
    }).catch(() => {});

    logger.info(`[Spawn] ${def.nameRu} spawned at ${sp.region} (${sp.id})`);
  }

  // ============================================================
  // Смерть монстра
  // ============================================================
  onMonsterDeath(instanceId: string, spawnPointId: string): void {
    const sp = this.spawnPoints.get(spawnPointId);
    if (sp) {
      sp.currentCount = Math.max(0, sp.currentCount - 1);
      sp.lastDeath = Date.now();
    }
    this.activeInstances.delete(spawnPointId + '_' + instanceId);
    logger.debug(`[Spawn] Monster ${instanceId} died, respawn in ${sp?.respawnTime}s`);
  }

  /**
   * Смерть монстра по instanceId без знания точки спавна
   * (когда убил игрок через сокет, а не ИИ-цикл).
   */
  onInstanceDeath(instanceId: string): void {
    for (const key of this.activeInstances.keys()) {
      if (key.endsWith('_' + instanceId)) {
        const spawnPointId = key.slice(0, key.length - instanceId.length - 1);
        this.onMonsterDeath(instanceId, spawnPointId);
        return;
      }
    }
  }

  // ============================================================
  // Тик ИИ для всех активных монстров.
  // Возвращает атакующие действия — по ним GameLoop наносит урон игрокам.
  // ============================================================
  tickAI(nearbyPlayers: Map<string, { id: string; position: { x: number; y: number; z: number }; hp: number }[]>): {
    region: Region; instanceId: string; targetId?: string; skillId?: string; type: string;
  }[] {
    const attacks: { region: Region; instanceId: string; targetId?: string; skillId?: string; type: string }[] = [];
    for (const ctx of this.ai.getAllInstances()) {
      const players = nearbyPlayers.get(ctx.definition.region) ?? [];
      const action = this.ai.tick(ctx.instanceId, players);
      if (action.type !== 'idle') {
        this.redis.publish(`region:${ctx.definition.region}:ai_action`, {
          instanceId: ctx.instanceId,
          action,
        }).catch(() => {});
      }
      if ((action.type === 'attack' || action.type === 'skill') && action.targetId) {
        attacks.push({
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
