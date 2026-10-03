// ============================================================
// Game Loop — центральный оркестратор игровых систем
// ============================================================
// До этого момента системы (спавн, ИИ, мировое время, карма)
// существовали изолированно: никто не вызывал их тики.
// GameLoop запускается при старте сервера и сводит их вместе.

import { Region } from '../types/game.types';
import { SpawnSystem } from './SpawnSystem';
import { TargetPlayer } from './AISystem';
import { KarmaSystem, isNpcHostile, isGuardTarget } from './KarmaSystem';
import { WorldTimeSystem, WEATHER_EFFECTS } from './WorldTimeSystem';
import { DefenseStates } from './DefenseStates';
import { StealthStates } from './StealthStates';
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
import { GUARD_POSTS, GUARD_STRIKE, strikingGuard, nightFactor } from '../../../shared/stealth';
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
  private stealthStates = StealthStates.getInstance();
  /**
   * Когда игрока последний раз ударил страж: characterId -> миллисекунды.
   *
   * Кулдаун держится на игрока, а не на посте: постов в зоне может быть
   * несколько (два стражника у ворот стоят в 7 единицах друг от друга), и
   * кулдаун на каждом дал бы два удара за раз. Здесь он один на всех стражей
   * сразу - ровно столько, сколько согласовано с владельцем.
   */
  private guardLastStrike = new Map<string, number>();
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

    // Кого в принципе бьёт стража. Карта остаётся пустой, если база
    // недоступна, - тогда стражи просто не бьют никого.
    //
    // Отдельная карта, а не флаг на TargetPlayer: там уже лежит npcHostile, и
    // две разные карты стоят одного лишнего поля в горячем пути. Читается из
    // той же строки кармы, что и враждебность монстров, - второго запроса в
    // базу не появляется.
    const guardTargetById = new Map<string, boolean>();

    // Реальный HP и карма одним запросом: ИИ не должен таргетить павших, а
    // враждебность берётся из кармы. Отдельный запрос на карму означал бы
    // ещё один обход базы на каждом тике (тик идёт раз в 200 мс).
    if (allIds.length) {
      const db = DatabaseService.getInstance();
      const rows = await db.query<{ id: string; hp: number; karma: number | null }>(
        'SELECT id, hp, karma FROM characters WHERE id = ANY($1::uuid[])',
        [allIds]
      ).catch(() => []);
      const hpById = new Map(rows.map(r => [r.id, Number(r.hp)]));
      // Карма → признак враждебности по таблице последствий. Пустая карта —
      // обычное дело при недоступной базе: тогда все просто не враждебны.
      const hostileById = new Map(
        rows.map(r => [r.id, isNpcHostile(Number(r.karma ?? 0))]),
      );
      // Поле guardAttack было объявлено в таблице последствий у красного и
      // изгоя и не читалось НИГДЕ: город обещал наказание тёмному игроку, а
      // наказывать было некому. Теперь его читает isGuardTarget - вторая
      // дверь в ту же таблицу, рядом с isNpcHostile. Таблица читается только
      // изнутри KarmaSystem, и это проверяет karmaNpcHostile.
      for (const r of rows) {
        guardTargetById.set(r.id, isGuardTarget(Number(r.karma ?? 0)));
      }
      for (const players of nearbyPlayers.values()) {
        for (let i = players.length - 1; i >= 0; i--) {
          const hp = hpById.get(players[i].id) ?? 0;
          if (hp <= 0) {
            players.splice(i, 1);
            continue;
          }
          players[i].hp = hp;
          players[i].npcHostile = hostileById.get(players[i].id) === true;
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

      // Площадь элитных и боссов: урон по всем игрокам в радиусе способности.
      // Решение владельца — обычные монстры бьют выбранную цель, группа
      // страдает только от боссов и элитных. Иначе обычный разбойник снимал
      // пати, а у «Землетрясения» (радиус 50) и бури Симурга (40) не было бы
      // смысла вовсе.
      //
      // Центр — цель, а не сам монстр: удар накрывает то место, куда бьют.
      // Эффект (замедление, яд, оглушение) остаётся только на цели: применять
      // его по всей группе — отдельное решение владельца.
      const радиусПлощади = this.monsterAoeRadius(atk);
      if (радиусПлощади > 0) {
        const список = nearbyPlayers.get(`${atk.shardId}:${atk.region}`) ?? [];
        for (const сосед of список) {
          if (сосед.id === target.id) continue;
          const расстояние = Math.hypot(
            сосед.position.x - target.position.x,
            сосед.position.z - target.position.z
          );
          if (расстояние > радиусПлощади) continue;

          // У каждого своя защита и своя реакция: уклонение и блок считаются
          // отдельно, иначе площадь была бы сильнее любого одиночного удара.
          const жертва = await this.characters.getCharacterById(сосед.id).catch(() => null);
          if (!жертва) continue;
          const статы = await this.equipment.getStats(сосед.id);
          const защита = жертва.stats.endurance * 0.75 + статы.endurance * 0.75;
          const множитель = this.defenseStates.getIncomingMultiplier(сосед.id);
          const уклонён = множитель === 0;
          const уронСоседа = Math.max(
            уклонён ? 0 : 1,
            Math.floor(this.monsterDamage(atk, защита) * множитель)
          );
          if (уклонён || уронСоседа <= 0) continue;
          const применён = await this.characters.applyDamage(сосед.id, уронСоседа).catch(() => null);
          if (!применён) continue;
          if (применён.died) DungeonService.getInstance().recordDeath(сосед.id);
          await this.redis.publish(
            REDIS_CHANNELS.REGION_MONSTER_HIT(atk.shardId, atk.region),
            {
              characterId: сосед.id,
              instanceId: atk.instanceId,
              skillId: atk.skillId ?? null,
              damage: уронСоседа,
              hp: применён.hp,
              maxHp: применён.maxHp,
              isDodged: false,
              isBlocked: множитель < 1,
              died: применён.died,
              debuff: null,
              aoeSplash: true,
            }
          ).catch(() => {});
        }
      }

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

    // Стража. Отдельным проходом, а не внутри разбора атак монстров: удар
    // стража идёт по своему кулдауну, а не по тику чужого монстра, и попадать
    // в разбор атак значило бы ждать, когда какой-нибудь монстр решит ударить.
    await this.tickGuards(nearbyPlayers, guardTargetById);
    } catch (error) {
      logger.error('[GameLoop] tickAI error:', error);
    }
  }

  /**
   * Стража бьёт тёмных.
   *
   * ЧТО БЫЛО. Поле guardAttack в таблице последствий кармы было объявлено у
   * рангов «красный» и «изгой» и не читалось нигде: стражи умели только
   * замечать игрока (шаг 1-3 стелса в shared/stealth.ts). То есть город
   * обещал наказание тёмному игроку, а наказывать было некому.
   *
   * ЧТО ТЕПЕРЬ. Того, кого страж видит и достаёт, он бьёт: 60 урона раз в 2
   * секунды и минус 100 кармы за удар - решение владельца, числа лежат в
   * GUARD_STRIKE, чтобы правило читалось и проверялось одним местом.
   *
   * ПОЧЕМУ ЗДЕЛЬКО, А НЕ В СОКЕТ-ОБРАБОТЧИКЕ. Удар должен приходить по времени.
   * Считали бы мы его в пакете движения, стоящий у поста игрок не получил бы
   * ни одного удара: стоя он пакетов не шлёт. Тик ИИ идёт раз в 2 секунды, и
   * GUARD_STRIKE.COOLDOWN_MS с ним совпадает.
   *
   * ПОЧЕМУ ОДИН УДАР ЗА ЦИКЛ. Постов рядом может быть несколько: два
   * стражника у ворот стоят в 7 единицах друг от друга. Кулдаун держится на
   * игрока (guardLastStrike), а не на посте, иначе под двумя стражами прилетело
   * бы вдвое больше договорённого.
   */
  private async tickGuards(
    nearbyPlayers: Map<string, TargetPlayer[]>,
    guardTargetById: Map<string, boolean>,
  ): Promise<void> {
    if (!guardTargetById.size) return;

    const теперь = Date.now();
    // Ночь и погода — те же, что при обнаружении в сокет-обработчике, из
    // того же источника. Если бы тик считал иначе, игрок был бы «невидим»
    // клиенту и «видим» серверу, и страж бил бы того, кого не бьют по экрану.
    const время = this.getWorldTime();
    const ctx = {
      night: nightFactor(время.timeOfDay),
      visibility: WEATHER_EFFECTS[время.weather]?.visibilityMod ?? 1,
    };

    for (const [ключ, игроки] of nearbyPlayers) {
      if (!игроки.length) continue;
      for (const игрок of игроки) {
        if (guardTargetById.get(игрок.id) !== true) continue;

        // Кулдаун на игрока: стражей рядом может быть несколько.
        const прошлый = this.guardLastStrike.get(игрок.id) ?? 0;
        if (теперь - прошлый < GUARD_STRIKE.COOLDOWN_MS) continue;

        // Приседание знает только сокет-обработчик: пакет движения - единственный
        // источник, которому можно верить (и он уже прошёл античит).
        const скрытность = this.stealthStates.get(игрок.id);
        const пост = strikingGuard(
          игрок.position,
          GUARD_POSTS,
          { crouch: скрытность?.crouch === true, ...ctx },
          теперь,
        );
        if (!пост) continue;

        // Кулдаун ставим ДО похода в базу: если запрос упадёт, игрок всё равно
        // не должен получить серию ударов в следующем тике.
        this.guardLastStrike.set(игрок.id, теперь);

        // Ключ nearbyPlayers устроен как «шард:регион». Регион нужен системе
        // кармы для её правила PvP-зон, а шард - каналу публикации.
        const двоеточие = ключ.indexOf(':');
        const шард = ключ.slice(0, двоеточие);
        const регион = ключ.slice(двоеточие + 1);

        // Урон считается так же, как у монстра: сырое число минус защита цели.
        // Защита из выносливости и брони - то же, что в monsterDamage.
        const жертва = await this.characters.getCharacterById(игрок.id).catch(() => null);
        if (!жертва) continue;
        const статы = await this.equipment.getStats(игрок.id);
        const защита = жертва.stats.endurance * 0.75 + статы.endurance * 0.75;

        // Активная защита игрока работает и здесь: уклонение отменяет удар
        // целиком, а вместе с ним и карму - за что не ударили, то и не берут.
        const множитель = this.defenseStates.getIncomingMultiplier(игрок.id);
        const уклонён = множитель === 0;
        const урон = уклонён
          ? 0
          : Math.max(1, Math.round(Math.max(3, GUARD_STRIKE.DAMAGE - защита) * множитель));

        const применён = await this.characters.applyDamage(игрок.id, урон).catch(() => null);
        if (!применён) continue;
        if (применён.died) DungeonService.getInstance().recordDeath(игрок.id);

        if (!уклонён) {
          // Регион нужен системе кармы для её правила PvP-зон; берём его из
          // ключа nearbyPlayers, а не из данных монстра.
          await this.karmaSystem
            .applyKarmaEvent(игрок.id, 'guard_strike', регион)
            .catch((e) => logger.error('[GameLoop] карма за удар стража не применена:', e));
        }

        // Тем же каналом, что и удар монстра: клиент рисует число по позиции
        // самого игрока, поэтому отдельный канал ради трёх полей заставил бы
        // подписываться на вторую ветку в двух местах.
        await this.redis.publish(
          REDIS_CHANNELS.REGION_MONSTER_HIT(шард, регион),
          {
            characterId: игрок.id,
            instanceId: пост.id,
            skillId: null,
            damage: урон,
            hp: применён.hp,
            maxHp: применён.maxHp,
            isDodged: уклонён,
            isBlocked: !уклонён && множитель < 1,
            died: применён.died,
            debuff: null,
            guardStrike: true,
            guardName: пост.nameRu,
            karmaDelta: уклонён ? 0 : GUARD_STRIKE.KARMA,
          },
        ).catch(() => {});
      }
    }
  }

  /**
   * Радиус площади монстра — и ноль, если площадью он бить не должен.
   *
   * Правило владельца: площадью бьют только элитные и боссы. Обычный монстр
   * бьёт выбранную цель, чтобы группа не снималась случайным разбойником.
   * Возвращается ноль, а не радиус: ноль означает «свой круг не трогаем», и
   * шаг площади просто не выполняется.
   */
  private monsterAoeRadius(atk: { skillId?: string; instanceId: string }): number {
    if (!atk.skillId) return 0;
    const ctx = this.spawnSystem.getAI().getContext(atk.instanceId);
    if (!ctx) return 0;
    const тип = ctx.definition.type;
    if (тип !== 'elite' && тип !== 'boss' && тип !== 'world_boss') return 0;
    const skill = ctx.definition.skills?.find(s => s.id === atk.skillId);
    if (!skill?.aoe || !skill.aoeRadius) return 0;
    return skill.aoeRadius;
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
