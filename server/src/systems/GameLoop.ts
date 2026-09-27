// ============================================================
// Game Loop — центральный оркестратор игровых систем
// ============================================================
// До этого момента системы (спавн, ИИ, мировое время, карма)
// существовали изолированно: никто не вызывал их тики.
// GameLoop запускается при старте сервера и сводит их вместе.

import { Region } from '../types/game.types';
import { SpawnSystem } from './SpawnSystem';
import { TargetPlayer } from './AISystem';
import { KarmaSystem } from './KarmaSystem';
import { WorldTimeSystem } from './WorldTimeSystem';
import { DefenseStates } from './DefenseStates';
import { DungeonService } from './DungeonService';
import { WorldEventSystem } from './WorldEventSystem';
import { RedisService } from '../services/RedisService';
import { DatabaseService } from '../services/DatabaseService';
import { CharacterService } from '../services/CharacterService';
import { EquipmentCache } from '../services/EquipmentCache';
import { REDIS_CHANNELS } from '../../../shared/constants';
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
  private characters = new CharacterService();
  private redis = RedisService.getInstance();
  private defenseStates = DefenseStates.getInstance();
  private equipment = EquipmentCache.getInstance();
  private worldEventBroadcaster: ((payload: Record<string, unknown>) => void) | null = null;

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

  /** Система времени и погоды — нужна админ-панели для ручной смены погоды */
  getWorldTimeSystem(): WorldTimeSystem {
    return this.worldTime;
  }

  /** Текущее игровое время и погода — чтобы дослать их сразу при входе,
   *  не дожидаясь ближайшего вещания (раз в минуту) */
  getWorldTime() {
    return this.worldTime.getCurrentWorldTime();
  }

  /** Функция объявлений мировых событий (передаётся из index.ts) */
  setWorldEventBroadcaster(fn: (payload: Record<string, unknown>) => void): void {
    this.worldEventBroadcaster = fn;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Данжи и мировые события работают на том же ИИ игрового цикла
    DungeonService.getInstance().attachAI(this.spawnSystem.getAI());
    WorldEventSystem.getInstance().init(
      this.spawnSystem.getAI(),
      () => this.spawnSystem.getActiveShards(),
      (payload) => {
        this.worldEventBroadcaster?.(payload);
      },
    );
    WorldEventSystem.getInstance().start();

    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    // Сразу шлём время/погоду, иначе клиент ждёт первый тик до 60 секунд
    this.worldTime.broadcastWorldTime().catch((e) => logger.error('[GameLoop] initial worldTime rejected:', e));
    logger.info('[GameLoop] Started (tick = 1s)');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    WorldEventSystem.getInstance().stop();
    this.running = false;
    logger.info('[GameLoop] Stopped');
  }

  private tick(): void {
    this.tickCount++;

    // Вещание погоды — в СВОЕМ try/catch. Раньше оно делило обработчик с
    // респавном монстров: если spawnSystem.tick() падал, игроки не получали
    // новую погоду и дождь «залипал» до перезапуска сервера.
    if (this.tickCount % WORLD_TIME_EVERY === 0) {
      this.worldTime.broadcastWorldTime().catch((e) => logger.error('[GameLoop] worldTime rejected:', e));
    }

    try {
      // Респавн монстров
      this.spawnSystem.tick();

      // Тик ИИ для всех активных монстров
      if (this.tickCount % AI_TICK_EVERY === 0) {
        this.tickAI().catch((e) => logger.error('[GameLoop] tickAI rejected:', e));
      }

      // Постепенное восстановление отрицательной кармы у онлайн-игроков
      if (this.tickCount % KARMA_DECAY_EVERY === 0) {
        this.decayKarmaOnline().catch((e) => logger.error('[GameLoop] decayKarma rejected:', e));
      }
    } catch (error) {
      logger.error('[GameLoop] Tick error:', error);
    }
  }

  private async tickAI(): Promise<void> {
    try {
    // Собираем онлайн-игроков по шардам и регионам из Redis
    const nearbyPlayers = new Map<string, TargetPlayer[]>();
    const allIds: string[] = [];
    const shards = this.spawnSystem.getActiveShards();
    for (const shardId of shards) {
      for (const region of Object.values(Region)) {
        const ids = await this.redis.getPlayersInRegion(shardId, region).catch(() => [] as string[]);
        allIds.push(...ids);
        const players: TargetPlayer[] = [];
        for (const id of ids) {
          const pos = await this.redis.getPlayerPosition(id).catch(() => null) as { x: number; y: number; z: number } | null;
          if (pos) players.push({ id, position: pos, hp: 1, inBoat: false });
        }
        nearbyPlayers.set(`${shardId}:${region}`, players);
      }
    }

    // Реальный HP одним запросом: ИИ не должен таргетить павших
    // (заглушка выше — только признак живости, уточняется здесь)
    if (allIds.length) {
      const db = DatabaseService.getInstance();
      const rows = await db.query<{ id: string; hp: number }>(
        'SELECT id, hp FROM characters WHERE id = ANY($1::uuid[])',
        [allIds]
      ).catch(() => []);
      const hpById = new Map(rows.map(r => [r.id, Number(r.hp)]));
      for (const players of nearbyPlayers.values()) {
        for (let i = players.length - 1; i >= 0; i--) {
          const hp = hpById.get(players[i].id) ?? 0;
          if (hp <= 0) {
            players.splice(i, 1);
            continue;
          }
          players[i].hp = hp;
        }
      }
    }

    // Кто сейчас в лодке: подводные существа игнорируют таких.
    // Один запрос на всех онлайн-игроков — по одному на игрока в тике
    // (тик идёт раз в 200 мс) база бы не потянула.
    if (allIds.length) {
      const db = DatabaseService.getInstance();
      const boatRows = await db.query<{ character_id: string }>(
        'SELECT character_id FROM character_boats WHERE character_id = ANY($1::uuid[]) AND is_active = TRUE',
        [allIds]
      ).catch(() => [] as { character_id: string }[]);
      if (boatRows.length) {
        const inBoat = new Set(boatRows.map(r => r.character_id));
        for (const players of nearbyPlayers.values()) {
          for (const p of players) p.inBoat = inBoat.has(p.id);
        }
      }
    }

    // Тик ИИ + урон монстров по игрокам (публикуется в Redis, сокеты раздают подписчики)
    const attacks = this.spawnSystem.tickAI(nearbyPlayers);
    for (const atk of attacks) {
      const target = nearbyPlayers.get(`${atk.shardId}:${atk.region}`)?.find(p => p.id === atk.targetId);
      if (!target) continue;
      // Защита цели (выносливость + броня экипировки) гасит часть урона
      const victim = await this.characters.getCharacterById(target.id).catch(() => null);
      if (!victim) continue;
      const equipStats = await this.equipment.getStats(target.id);
      const defense = victim.stats.endurance * 0.75 + equipStats.endurance * 0.75;
      let damage = this.monsterDamage(atk, defense);

      // Активная защита: уклонение (полный промах) или блок (−60%)
      const defenseMult = this.defenseStates.getIncomingMultiplier(target.id);
      const isDodged = defenseMult === 0;
      damage = Math.max(isDodged ? 0 : 1, Math.floor(damage * defenseMult));

      const applied = await this.characters.applyDamage(target.id, damage).catch(() => null);
      if (!applied) continue;
      await this.redis.publish(REDIS_CHANNELS.REGION_MONSTER_HIT(atk.shardId, atk.region), {
        characterId: target.id,
        instanceId: atk.instanceId,
        skillId: atk.skillId ?? null,
        damage,
        hp: applied.hp,
        maxHp: applied.maxHp,
        isDodged,
        isBlocked: !isDodged && defenseMult < 1,
        died: applied.died,
      }).catch(() => {});
    }
    } catch (error) {
      logger.error('[GameLoop] tickAI error:', error);
    }
  }

  /** Урон монстра игроку: навык из базы монстров либо удар с руки, минус защита цели */
  private monsterDamage(atk: { skillId?: string; instanceId: string }, defense = 0): number {
    const ctx = this.spawnSystem.getAI().getContext(atk.instanceId);
    if (!ctx) return 5;
    let raw: number;
    if (atk.skillId) {
      const skill = ctx.definition.skills.find(s => s.id === atk.skillId);
      raw = skill ? skill.damage : ctx.definition.strength * 1.6;
    } else {
      raw = ctx.definition.strength * 1.6;
    }
    return Math.max(3, Math.round(raw - defense));
  }

  private async decayKarmaOnline(): Promise<void> {
    try {
    for (const shardId of this.spawnSystem.getActiveShards()) {
      for (const region of Object.values(Region)) {
        const ids = await this.redis.getPlayersInRegion(shardId, region).catch(() => [] as string[]);
        for (const id of ids) {
          await this.karmaSystem.decayKarma(id).catch(() => {});
        }
      }
    }
    } catch (error) {
      logger.error('[GameLoop] decayKarmaOnline error:', error);
    }
  }
}
