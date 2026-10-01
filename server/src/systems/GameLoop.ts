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
import { SiegeSystem } from './SiegeSystem';
import { TerritoryBonuses } from './TerritoryBonuses';
import { MailService } from '../services/MailService';
import { DailyTaskService } from '../services/DailyTaskService';
import { RedisService } from '../services/RedisService';
import { DatabaseService } from '../services/DatabaseService';
import { CharacterService } from '../services/CharacterService';
import { EquipmentCache } from '../services/EquipmentCache';
import { AuctionService } from '../services/AuctionService';
import { DebuffService } from '../services/DebuffService';
import { debuffPlan, isWorthApplying } from './MonsterEffects';
import type { MonsterSkill } from '../data/monsters';
import { REDIS_CHANNELS } from '../../../shared/constants';
import { logger } from '../utils/logger';

const TICK_INTERVAL_MS = 1000;
const AI_TICK_EVERY = 2;        // тик ИИ раз в 2 секунды
const WORLD_TIME_EVERY = 60;    // вещание игрового времени раз в минуту
const KARMA_DECAY_EVERY = 3600; // распад кармы раз в час
// Уборка просроченных лотов аукциона. Раз в 5 минут: лот живёт сутки, так
// что погрешность в пять минут на возврат вещи никто не заметит, а запрос
// будет один на сервер вместо тысячи
const AUCTION_SWEEP_EVERY = 300;
// Урон со временем тикает раз в 2 секунды: ровно с периодом яда, самого
// медленного из эффектов. Тикать чаще нечего - сумма за все секунды не
// должна зависеть от частоты проверки, а тик кровотечения раз в секунду
// добрал бы свою долю на следующем проходе.
const DEBUFF_TICK_EVERY = 2;

export class GameLoop {
  private static instance: GameLoop;

  private spawnSystem = new SpawnSystem();
  private karmaSystem = new KarmaSystem();
  private worldTime = new WorldTimeSystem();
  private characters = new CharacterService();
  private debuffService = new DebuffService();
  private redis = RedisService.getInstance();
  private defenseStates = DefenseStates.getInstance();
  private equipment = EquipmentCache.getInstance();
  private auction = new AuctionService();
  private worldEventBroadcaster: ((payload: Record<string, unknown>) => void) | null = null;
  private dailyTaskService = new DailyTaskService();

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
    // Вернуть заходы, которые остались активными до перезапуска.
    // После attachAI: восстановление спавнит монстров через общий ИИ,
    // и до его подключения спавнить было бы нечем.
    //
    // Не ждём: восстановление ходит в базу, а игроки уже подключаются.
    void DungeonService.getInstance().restoreActiveSessions()
      .catch((e) => logger.error('[GameLoop] восстановление заходов не удалось:', e));
    WorldEventSystem.getInstance().init(
      this.spawnSystem.getAI(),
      () => this.spawnSystem.getActiveShards(),
      (payload) => {
        this.worldEventBroadcaster?.(payload);
      },
    );
    WorldEventSystem.getInstance().start();
    // Прочитать расписание мировых боссов: напечатать настоящую историю
    // убийств. Не ждём — чтение из базы не должно задерживать старт
    void WorldEventSystem.getInstance().loadSchedule()
      .catch((e) => logger.error('[GameLoop] чтение расписания боссов не удалось:', e));
    // Осады территорий гильдий. Данные и таблица объявлены давно, но
    // планировщика не существовало: карта обещала «осады выходных», которых
    // не было ни в коде, ни в данных.
    //
    // restore ДО start. Иначе тик успевает отработать на пустой памяти,
    // решить, что осады нет, а через полминуты выяснилось бы, что она шла.
    void SiegeSystem.getInstance().restore()
      .catch((e) => logger.error('[GameLoop] восстановление осад не удалось:', e));
    SiegeSystem.getInstance().start();
    // Бонусы территории: назвать один раз неподключённые виды из данных.
    // Проверка, что их применяют, лежит в TerritoryBonusesTest; здесь нужно
    // предупреждение в журнале, чтобы новый вид в справочнике не ждал
    // полгода жалобы игрока.
    TerritoryBonuses.getInstance().проверитьСправочник();
    // Убрать просроченные письма. expires_at в схеме есть, но про него
    // никто не помнил: письма копились бы вечно вместе с наградой внутри
    // Посев каталога ежедневных задач в таблицу daily_tasks.
    // Правка награды в базе переживает релиз. Откат на код внутри
    // сервиса: если посев не удался, задачи всё равно останутся
    void this.dailyTaskService.seedCatalog()
      .then((n: number) => logger.info(`[DailyTask] каталог записан в базу: ${n}`))
      .catch((e: unknown) => logger.error('[GameLoop] посев каталога задач не удался:', e));
    void MailService.getInstance().purgeExpired()
      .catch((e) => logger.error('[GameLoop] уборка писем не удалась:', e));

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
    SiegeSystem.getInstance().stop();
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

      // Возврат просроченных лотов аукциона. Без этого предмет, выставленный
      // на сутки, просто исчезал: эскроу забирал его сразу, а возврата не
      // существовало нигде
      if (this.tickCount % AUCTION_SWEEP_EVERY === 0) {
        this.auctionSweep().catch((e) => logger.error('[GameLoop] auctionSweep rejected:', e));
      }

      // Урон со временем: кровотечение и яд. Отдельный проход раз в
      // DEBUFF_TICK_EVERY секунд по всем, кто онлайн.
      if (this.tickCount % DEBUFF_TICK_EVERY === 0) {
        this.tickDebuffs().catch((e) => logger.error('[GameLoop] tickDebuffs rejected:', e));
      }
    } catch (error) {
      logger.error('[GameLoop] Tick error:', error);
    }
  }

  /**
   * Вернуть просроченные лоты аукциона продавцам.
   *
   * Отдельный метод с собственным try/catch на вызывающей стороне: падение
   * уборки не должно ронять респавн монстров и тик ИИ, которые живут в том
   * же блоке.
   */
  private async auctionSweep(): Promise<void> {
    await this.auction.returnExpiredListings();
  }

  private async tickAI(): Promise<void> {    try {
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

      // Смерть в подземелье - единственное место, где она считается для
      // достижения «пройти без единой смерти». Один раз на смерть, без
      // await: тик не должен ждать счётчик.
      if (applied.died) DungeonService.getInstance().recordDeath(target.id);

      // Эффект из данных монстра. Раньше `effect` и `effectDuration` были
      // объявлены у одиннадцати способностей и не читались нигде: монстр
      // бил числом и забывал, что у него написано. «Землетрясение» с
      // остановкой на 5 секунд выглядело как обычный удар.
      //
      // Пропускаем при уклонении: если удара не было, отравления быть не
      // должно - иначе монстр мог бы отравить игрока, стоявшего вне
      // досягаемости, и игрок уходил бы с ядом, которого не видел.
      const план = !isDodged ? debuffPlan(this.monsterSkill(atk)) : null;
      if (план && isWorthApplying(план.durationMs)) {
        await this.debuffService.apply(target.id, план, atk.instanceId);
      }

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
        // Имя эффекта едет вместе с ударом, а не отдельным сообщением:
        // клиенту нужно показать иконку в тот же миг, что и число урона.
        // Отдельный пакет пришёл бы на секунду позже и затерялся бы при
        // большой серии ударов.
        debuff: план && isWorthApplying(план.durationMs)
          ? { id: план.debuffId, kind: план.kind, durationMs: план.durationMs }
          : null,
      }).catch(() => {});
    }
    } catch (error) {
      logger.error('[GameLoop] tickAI error:', error);
    }
  }

  /**
   * Способность монстра, которой он бил, - или заглушка для удара с руки.
   *
   * Заглушка нужна, потому что `debuffPlan` спрашивает `effect` и
   * `effectDuration` у настоящего описания. Удару с руки эффекта не
   * полагается, и пустая заглушка честнее, чем искать способность по
   * несуществующему id и получать первую попавшуюся.
   */
  private monsterSkill(atk: { skillId?: string; instanceId: string }): Pick<
    MonsterSkill, 'id' | 'damage' | 'effect' | 'effectDuration'
  > {
    const ctx = this.spawnSystem.getAI().getContext(atk.instanceId);
    const найденная = atk.skillId ? ctx?.definition.skills.find(s => s.id === atk.skillId) : undefined;
    if (найденная) return найденная;
    const ударСРуки = Math.max(3, Math.round((ctx?.definition.strength ?? 1) * 1.6));
    return { id: atk.skillId ?? 'monster_melee', damage: ударСРуки, effect: undefined, effectDuration: undefined };
  }

  /**
   * Начислить урон со временем всем, у кого есть эффекты.
   *
   * Кто именно поражён, решает база: игрок с одним монстром в 20 шагах и
   * игрок в центре(Isfahan) за полем отличаются только наличием строки в
   * character_debuffs. Список онлайн-игроков берётся у Redis - это тот же
   * список, по которому уже идут респавн и распад кармы.
   *
   * Порядок важен: сначала списание урона, потом вещание остатка. Если
   * разошлись, игрок увидит иконку яда и через секунду умрёт, не
   * успев понять, от чего. Обратный порядок лучше не читается: игрок
   * видит, что яд кончился, и умирает от его последнего тика.
   */
  private async tickDebuffs(): Promise<void> {
    const сейчас = Date.now();
    for (const shardId of this.spawnSystem.getActiveShards()) {
      for (const region of Object.values(Region)) {
        const ids = await this.redis.getPlayersInRegion(shardId, region).catch(() => [] as string[]);
        for (const id of ids) {
          const итог = await this.debuffService.settle(id, сейчас);
          if (!итог.debuffs.length && итог.damage === 0) continue;

          let hp = 0;
          let maxHp = 0;
          let умер = false;
          if (итог.damage > 0) {
            const нанесено = await this.characters.applyDamage(id, итог.damage).catch(() => null);
            if (нанесено) {
              hp = нанесено.hp;
              maxHp = нанесено.maxHp;
              умер = нанесено.died;
            }
          }
          await this.redis.publish(REDIS_CHANNELS.REGION_DEBUFF_TICK(shardId, region), {
            characterId: id,
            damage: итог.damage,
            hp,
            maxHp,
            died: умер,
            debuffs: итог.debuffs.map(d => ({
              id: d.debuffId, kind: d.kind,
              // Сколько секунд осталось, а не абсолютное время: клиенту
              // нужен обратный отсчёт, и присылать ему epoch - значит
              // заставлять клиент вычитать из своих часов.
              secondsLeft: Math.max(0, Math.round((d.expiresAt - сейчас) / 1000)),
              magnitude: d.magnitude,
            })),
          }).catch(() => {});
        }
      }
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
