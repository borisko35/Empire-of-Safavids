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
import { DatabaseService } from '../services/DatabaseService';
import { logger } from '../utils/logger';

// Расписание: первое событие через 10 минут после старта сервера,
// далее каждые 3 часа
const FIRST_EVENT_DELAY_MS = 10 * 60 * 1000;
const EVENT_INTERVAL_MS = 3 * 60 * 60 * 1000;

/**
 * Единственный мировой босс. Захардкожен и раньше; теперь его идентификатор
 * нужен не только для спавна, но и для записи в world_boss_schedule.
 */
const WORLD_BOSS_ID = 'world_boss_simurgh';

/** Что известно о боссе на шарде: экземпляр монстра и id босса из расписания */
interface ActiveBoss {
  instanceId: string;
  bossId: string;
}

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
  private db = DatabaseService.getInstance();
  private timer: NodeJS.Timeout | null = null;
  /** Активные боссы по шардам */
  private bosses = new Map<string, ActiveBoss>();
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
    return instanceId != null && [...this.bosses.values()].some(b => b.instanceId === instanceId);
  }

  /**
   * Победа над боссом события: награда, объявление шарду и запись в базу.
   *
   * ЧТО БЫЛО. Победа засчитывалась только в памяти: удалили запись из Map и
   * выдали награду. Таблицы world_boss_kills и world_boss_schedule созданы
   * миграцией 002 и с тех пор пусты — то есть нельзя было сказать ни «когда
   * Симурга убивали в последний раз», ни «сколько раз», ни «кто убил».
   */
  async onBossDefeated(instanceId: string, killerId: string): Promise<void> {
    let shardId: string | undefined;
    let bossId: string | undefined;
    for (const [sid, boss] of this.bosses) {
      if (boss.instanceId === instanceId) { shardId = sid; bossId = boss.bossId; }
    }
    if (!shardId || !bossId) return;
    this.bosses.delete(shardId);
    if (this.bosses.size === 0) this.nextEventAt = Date.now() + EVENT_INTERVAL_MS;

    // Награда победителю: золото и перо Симурга (легендарный материал)
    await this.characters.addGold(killerId, 5000).catch(() => {});
    await this.characters.addItems(killerId, [{ itemId: 'mat_dragon_scale', qty: 1 }]).catch(() => {});

    await this.recordKill(bossId, killerId).catch((e) =>
      logger.warn(`[WorldEvent] не удалось записать убийство босса: ${e}`));

    this.announce({ status: 'defeated', killerId, shardId });
    logger.info(`[WorldEvent] Boss ${bossId} defeated by ${killerId} on ${shardId}`);
  }

  /**
   * Записать победу в world_boss_kills и обновить world_boss_schedule.
   *
   * Гильдия пишется, потому что таблица для того и заведена: «кто и какой
   * гильдией убил мирового босса» — это то, что потом показывают в интерфейсе
   * зала славы. top_damage заполняется одним победителем: собирать расклад
   * по урону за бой сервер не умеет, а выдумывать его нельзя.
   */
  private async recordKill(bossId: string, killerId: string): Promise<void> {
    const killer = await this.characters.getCharacterById(killerId).catch(() => null);
    const guildId = killer?.guildId ?? null;
    await this.db.query(
      `INSERT INTO world_boss_kills (boss_id, guild_id, top_damage)
       VALUES ($1, $2, $3::jsonb)`,
      [bossId, guildId, JSON.stringify([{ characterId: killerId }])]
    );
    await this.db.query(
      `UPDATE world_boss_schedule
       SET is_alive = FALSE, last_killed = NOW(),
           kill_count = kill_count + 1,
           next_spawn = NOW() + ($2 || ' milliseconds')::interval
       WHERE boss_id = $1`,
      [bossId, String(EVENT_INTERVAL_MS)]
    );
  }

  /**
   * Прочитать расписание и привести его в согласие с реальностью.
   *
   * ЧТО БЫЛО. Миграция 002 засеяла next_spawn: Симург через 7 дней, Рустам
   * через 14. Код при этом спавнил босса каждые 3 часа и в таблицу не писал
   * ничего. То есть база хранила вымышленное расписание, не совпадающее с
   * тем, что игроки видели, — и по ней нельзя было узнать реальную историю.
   *
   * Теперь таблица правдива: next_spawn пересчитывается при каждой победе по
   * настоящему интервалу, а kill_count копится. Старое сид-значение в 7 и 14
   * дней остаётся только для боссов, которых ещё ни разу не убивали, — и это
   * единственное место, где миграция и код расходятся намеренно.
   */
  async loadSchedule(): Promise<void> {
    const rows = await this.db.query<{ boss_id: string; kill_count: number; last_killed: Date | null }>(
      `SELECT boss_id, kill_count, last_killed FROM world_boss_schedule`
    ).catch((e) => {
      logger.warn(`[WorldEvent] не удалось прочитать расписание: ${e}`);
      return [];
    });
    for (const r of rows) {
      logger.info(`[WorldEvent] ${r.boss_id}: убийств ${r.kill_count}` +
        (r.last_killed ? `, последний ${new Date(r.last_killed).toISOString()}` : ', ещё ни разу не убит'));
    }
  }

  /** Пометить босса живым в расписании — он только что заспавнился */
  private async markSpawned(bossId: string): Promise<void> {
    await this.db.query(
      `UPDATE world_boss_schedule SET is_alive = TRUE WHERE boss_id = $1`,
      [bossId]
    ).catch((e) => logger.warn(`[WorldEvent] не удалось отметить босса живым: ${e}`));
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
    const def: MonsterDefinition | undefined = MONSTERS_DATABASE[WORLD_BOSS_ID];
    if (!def || !this.ai) return;

    // Гнездо Симурга — горы Хорасана
    const position: Vector3 = { x: 0, y: 100, z: 0 };
    const ctx = this.ai.spawnMonster(def, position, shardId);
    this.bosses.set(shardId, { instanceId: ctx.instanceId, bossId: WORLD_BOSS_ID });
    this.startedAt = Date.now();
    void this.markSpawned(WORLD_BOSS_ID);

    this.announce({ status: 'started', nameRu: def.nameRu, region: Region.KHORASAN, position, shardId });
    logger.info(`[WorldEvent] ${def.nameRu} spawned on ${shardId} (${ctx.instanceId})`);
  }

  private announce(payload: Record<string, unknown>): void {
    this.onAnnounce?.({ ...payload, startedAt: this.startedAt, nextEventAt: this.nextEventAt });
  }
}
