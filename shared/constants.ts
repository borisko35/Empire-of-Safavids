// ============================================================
// Общие константы — Empire of Safavids
// ============================================================

/**
 * Версия игры. Показывается на лендинге (бейдж берёт из /health) и в меню
 * персонажа. Раньше в index.html было захардкожено «v0.2.0» отдельно от
 * константы — версии расходились. Теперь меню подставляет значение отсюда.
 *
 * ПРАВИЛО: это единственное место, где версия написана руками. Копия в
 * разметке, в текстах или в чужом файле — всегда расхождение, потому что
 * вспомнить её обновить невозможно. Проверка gameVersion.test.ts требует,
 * чтобы других вхождений не появлялось.
 *
 * ПОЧЕМУ НОМЕР ВЕРСИИ НЕ ДУБЛИРУЕТСЯ НИГДЕ. Даже здесь, в комментарии.
 * Описание изменений не должно повторять сам номер: иначе при следующем
 * обновлении комментарий останется с прошлой цифрой, и проверка упадёт
 * правильно, но править придётся вслед за ней. Состав релиза — в
 * сообщении коммита.
 */
export const GAME_VERSION = '0.4.0';
export const MAX_LEVEL = 100;
export const MAX_CHARACTERS_PER_ACCOUNT = 3;
export const MAX_INVENTORY_SLOTS = 100;
export const MAX_ENHANCEMENT = 20;
export const MAX_GUILD_MEMBERS = 100;

// Опыт для каждого уровня: exp = level^2 * 100
export function expRequiredForLevel(level: number): number {
  return Math.pow(level, 2) * 100;
}

// Регионы и их уровневые требования
//
// ЧТО БЫЛО. Первым по требованию стоял tabriz (уровень 1), и полоса
// вокруг построенного города называлась tabriz_center. Но город-то один, и
// он Исфахан: так его названы ISFAHAN в SpawnSystem, PVP_ZONES и якоря.
// Получалось, что столица империи называлась Тебризом в зонах и Исфаханом
// в коде, а якоря tabriz и isfahan указывали в ОДНУ точку - то есть
// путешествие в Исфахан вообще никуда не перемещало.
//
// Теперь столица - Исфахан, ему и требование первого уровня. Тебриз занял
// полосу, которую раньше занимал Исфахан, и требование 20.
export const REGION_LEVEL_REQUIREMENTS: Record<string, number> = {
  isfahan: 1,
  tabriz: 20,
  shiraz: 40,
  caucasus: 50,
  mesopotamia: 60,
  khorasan: 70,
  persian_gulf: 80,
  // Герат — восьмой регион и самый дальний. 90 — под стать самому суровому
  // краю: зоны Персидского залива доходят до 90, MAX_LEVEL = 100.
  herat: 90,
  // Дальние края - девятый и десятый регионы, за полосами. Требования
  // продолжают рост и не превышают MAX_LEVEL = 100.
  east_frontier: 92,
  west_frontier: 94,
};

// Множители опыта
export const EXP_MULTIPLIERS = {
  PARTY_BONUS: 1.2,      // Бонус в группе
  GUILD_BONUS: 1.1,      // Бонус в гильдии
  PREMIUM_BONUS: 1.5,    // Премиум аккаунт
  FIRST_KILL_BONUS: 2.0, // Первое убийство монстра
};

// Лимиты чата
//
// ЗАЧЕМ ЗДЕСЬ ЗАДЕРЖКИ. В проекте они были объявлены, но не применялись
// нигде: обработчик сообщений только резал длину. Итог — ограничения на
// частоту не было вовсе, и один клиент мог забить мировой чат так быстро,
// как успевал отправлять кадры.
export const CHAT_LIMITS = {
  MAX_MESSAGE_LENGTH: 500,
  WORLD_CHAT_COOLDOWN_MS: 5000,
  REGION_CHAT_COOLDOWN_MS: 1000,
  // Задержка для гильдейского и группового чата. Своих констант у них не
  // было, и без этой они остались бы без ограничения вовсе: аудитория мала,
  // но перебор возможен. 500 мс — человек физически не успевает набрать
  // быстрее, при этом спамить «ааааа» в два кадра уже нельзя.
  GUILD_CHAT_COOLDOWN_MS: 500,
};

// ── Выносливость ─────────────────────────────────────────────
// Доли от максимальной стамины в секунду. Клиент считает плавно для
// полоски, сервер — раз в 5 секунд для базы; ставки должны совпадать,
// иначе серверный player:resources будет дёргать полоску.
// Раньше стамина вообще не тратилась: плыть можно было бесконечно.
export const STAMINA = {
  /** Расход при плавании (доля от максимума в секунду) */
  SWIM_DRAIN_PER_SEC: 0.05,
  /** Восстановление на суше после отдыха (быстрое) */
  LAND_REGEN_PER_SEC: 0.14,
  /** Обычное медленное восстановление */
  IDLE_REGEN_PER_SEC: 0.035,
  /** Ниже этой доли бег (Shift) невозможен */
  SPRINT_MIN: 0.05,
  /** Сколько стамины стоит 1 секунда плавания на «одном уровне» (для UI) */
  get SWIM_DRAIN_PER_5S(): number { return this.SWIM_DRAIN_PER_SEC * 5; },
};

// Socket события
export const SOCKET_EVENTS = {
  // Auth
  AUTH: 'auth',
  AUTH_SUCCESS: 'auth:success',
  AUTH_ERROR: 'auth:error',

  // Player
  PLAYER_MOVE: 'player:move',
  PLAYER_MOVED: 'player:moved',
  ZONE_CHANGED: 'zone:changed',
  PLAYER_JOINED: 'player:joined',
  PLAYER_LEFT: 'player:left',
  PLAYER_DIED: 'player:died',
  PLAYER_RESPAWNED: 'player:respawned',
  MOVE_REJECTED: 'move:rejected',
  /** Решение игрока: где возрождаться (см. RESPAWN_TYPES) */
  RESPAWN: 'respawn',

  // Interiors (здания с входом/выходом)
  INTERIOR_ENTER: 'interior:enter',
  INTERIOR_EXIT: 'interior:exit',

  // Combat
  COMBAT_ACTION: 'combat:action',
  COMBAT_RESULT: 'combat:result',
  COMBAT_HIT: 'combat:hit',
  // Урон со временем и список эффектов, висящих на игроке. Отдельное
  // событие от combat:hit: там удар, здесь то, что длится секунды.
  DEBUFF_TICK: 'combat:debuff_tick',
  COMBAT_VISUAL: 'combat:visual',
  COMBAT_HEAL: 'combat:heal',
  COMBAT_ERROR: 'combat:error',
  /** Выбор боевой стойки: клиент шлёт, сервер проверяет и сохраняет */
  COMBAT_STANCE: 'combat:stance',
  /** Включение активного навыка профессии: Зикр, Тадж */
  SKILL_ACTIVATE: 'skill:activate',

  // Chat
  CHAT_MESSAGE: 'chat:message',
  CHAT_WORLD: 'chat:world',
  CHAT_REGION: 'chat:region',
  CHAT_GUILD: 'chat:guild',
  CHAT_PARTY: 'chat:party',

  // ── Партия: сервер сообщает участникам об изменениях ─────────
  // Через эти события PartySystem доставляет состав партии. Раньше
  // изменения публиковались в Redis и там пропадали.
  PARTY_UPDATED: 'party:updated',
  PARTY_MEMBER_JOINED: 'party:member_joined',
  PARTY_MEMBER_LEFT: 'party:member_left',
  PARTY_DISBANDED: 'party:disbanded',

  // ── Аукцион и баунти ────────────────────────────────────────
  /** Новый лот на аукционе: видят все, цены меняются у всех */
  AUCTION_NEW_LISTING: 'auction:new_listing',
  /** На игрока повесили баунти: знает только он */
  BOUNTY_PLACED: 'bounty:placed',

  // ── Действия администратора, адресованные игроку ─────────────
  /** Персонаж заглушён: чат и приглашения недоступны до снятия */
  ADMIN_MUTE: 'admin:mute',
  /** Персонаж телепортирован: клиент обязан переставить игрока */
  ADMIN_TELEPORT: 'admin:teleport',
  /** Персонажу выдан предмет: инвентарь надо перечитать */
  ADMIN_GIVE_ITEM: 'admin:give_item',

  /**
   * Смена активного скакуна этого игрока. Персональное событие: приходит
   * тому, кто переседок, и меняет скорость передвижения.
   */
  PLAYER_MOUNT: 'player:mount',
} as const;

// События, отправляемые только сервером (REST/фоновые системы → клиент)
export const SERVER_EVENTS = {
  NOTIFICATION: 'notification',
  ZONE_CHANGED: 'zone:changed',
  FORCE_DISCONNECT: 'force:disconnect',
  WORLD_TIME: 'world:time',
  MONSTER_SPAWNED: 'monster:spawned',
  MONSTER_KILLED: 'monster:killed',
  KARMA_CHANGED: 'karma:changed',
  RESOURCES: 'player:resources',       // периодический синк hp/маны/стамины/золота
  QUEST_COMPLETED: 'quest:completed',  // квест завершён: награды начислены
  WORLD_EVENT: 'world:event',          // мировой ивент: старт/победа над боссом
  DUNGEON_COMPLETED: 'dungeon:completed', // данж завершён: награды
  DAILY_TASK_COMPLETED: 'daily:task',  // задача дня закрыта: золото/опыт/предмет начислены
  COMBAT_BLOCKED: 'combat:defense',    // принято активное блок/уклонение
  RESPAWN_ERROR: 'respawn:error',      // отказ в респавне (см. RESPAWN_REJECT)
} as const;

// ── Смерть и возрождение ──────────────────────────────────────
// Игрок не возрождается мгновенно: сервер ждёт решения игрока
// (город / на месте) и только затем воскрешает.
export const RESPAWN_TYPES = {
  /** На стартовой точке региона, бесплатно */
  CITY: 'city',
  /** На месте смерти, за долю золота (DEATH.SPOT_COST_GOLD_RATE) */
  SPOT: 'spot',
} as const;

export type RespawnType = (typeof RESPAWN_TYPES)[keyof typeof RESPAWN_TYPES];

/** Причины отказа в респавне: клиент по ним выбирает надпись из переводов */
export const RESPAWN_REJECT = {
  /** Сокет не аутентифицирован */
  NOT_AUTH: 'not_auth',
  /** Игрок и не был мёртв — состояние уже снято (или клиент прислал мусор) */
  NOT_DEAD: 'not_dead',
  /** Тип не из RESPAWN_TYPES */
  INVALID_TYPE: 'invalid_type',
  /** Не хватило золота на респавн на месте */
  NO_GOLD: 'no_gold',
  /** На месте смерти слишком глубоко — там возродиться нельзя */
  SPOT_BLOCKED: 'spot_blocked',
} as const;

export const DEATH = {
  /**
   * Страховочный таймер на СЕРВЕРЕ: сколько живут мёртвые, пока игрок
   * не выбрал способ возрождения. Без него обрыв связи, закрытая вкладка
   * или молчащий клиент оставляли персонажа мёртвым навсегда. Клиент
   * показывает тот же отсчёт, но таймер держит сервер: клиентскому
   * таймеру нельзя доверять (его можно не дослать, а страница может
   * быть перезагружена).
   */
  AUTO_RESPAWN_SEC: 15,
  /** Доля золота за возрождение на месте смерти */
  SPOT_COST_GOLD_RATE: 0.05,
  /**
   * Минимум к списанию. Без него 0 золота даёт 0 комиссии, то есть
   * бесплатный респавн на месте — ровно то, чего мы хотим избежать.
   */
  SPOT_COST_MIN_GOLD: 1,
} as const;

/** Цена респавна на месте для баланса в N золота (округление вниз) */
export function spotRespawnCost(gold: number): number {
  return Math.max(DEATH.SPOT_COST_MIN_GOLD, Math.floor(Math.max(0, gold) * DEATH.SPOT_COST_GOLD_RATE));
}

// Каналы Redis pub/sub

// ============================================================
// Игровые серверы (шарды): персонаж привязан к серверу при создании.
// ============================================================
export interface GameServerDef {
  id: string;
  nameRu: string;
  /** Рекомендуемый для новичков */
  recommended?: boolean;
}

export const GAME_SERVERS: GameServerDef[] = [
  { id: 'baku', nameRu: 'Баку', recommended: true },
  { id: 'nakhchivan', nameRu: 'Нахчивань' },
  { id: 'ganja', nameRu: 'Гянджа' },
  { id: 'tebriz', nameRu: 'Тебриз' },
  { id: 'khoy', nameRu: 'Хой' },
  { id: 'rasht', nameRu: 'Решт' },
  { id: 'isfahan', nameRu: 'Исфахан' },
  { id: 'derbent', nameRu: 'Дербент' },
];

export const DEFAULT_SERVER_ID = 'isfahan';

export function isValidServerId(id: string): boolean {
  return GAME_SERVERS.some(s => s.id === id);
}

// ============================================================
// Стартовые точки регионов (суша, рядом с поселениями).
// Используются при создании персонажа, респавне и спасении
// персонажа, чья сохранённая позиция оказалась в воде.
// tabriz/isfahan — площадь возрождения у ворот Исфахана (0,0);
// остальные — якоря регионов (см. REGION_ANCHORS в клиенте).
// ============================================================
export const SPAWN_PLAZA = { x: 0, z: 0 };

export const REGION_SPAWNS: Record<string, { x: number; z: number }> = {
  // Исфахан - столица, и его якорь обязан лежать ВНУТРИ его собственной
  // зоны. Раньше isfahan и tabriz указывали в (0,0), то есть путешествие
  // в Исфахан было полным no-op: и регион, и якорь совпадали со стартом.
  isfahan: { x: 0, z: 0 },
  // Тебриз - внутри своей полосы (z -350..-150).
  tabriz: { x: 0, z: -300 },
  shiraz: { x: 90, z: 400 },
  caucasus: { x: 60, z: 560 },
  mesopotamia: { x: 200, z: -450 },
  khorasan: { x: 150, z: 750 },
  // Герат — восьмой регион, за Хорасаном на северо-востоке. Стоит в
  // полосе z 1600..3175 (herat_city — 2100..2600), то есть внутри своей
  // зоны, как того требует проверка якорей.
  //
  // Точка выбрана перебором, а не на глаз. Первый кандидат (100, 2350)
  // стоял на высоте -3.70 при уровне моря -3.2, то есть в яме. Проверка
  // «не в воде» этого бы не заметила: вода считается по берегу и маскам,
  // а не по высоте. Перебор искал сухое ровное место повыше моря, в стороне
  // от соседних городов и от края мира, и нашёл ровно одно: разброс высот
  // по кругу радиусом 116 - 2.93, до ближайшего города 1724.
  herat: { x: -700, z: 2250 },
  // Дальние края. Якоря лежат внутри своих полос, и выбраны не на глаз:
  // перебор края показал, что на x = 2750 размах высот в окне 400x400
  // равнялся 47 метрам, и город повис бы на уступе. Здесь 15.4 и 15.0.
  east_frontier: { x: 2950, z: 100 },
  west_frontier: { x: -2550, z: 2100 },
  // Персидский залив. Якорь стоял в (-60, -700) - в мелкой воде, на
  // высоте -2.1. Место назначения у якоря одно: CharacterService.respawn()
  // при выборе «возродиться в городе» и спасение из глубокой воды в
  // handleAuth. То есть игрок, умерший в заливе, возвращался в воду - и
  // так после каждой смерти. Стоит в (-60, -620): суша, уклон 0,
  // высота 3.5, своя зона persian_gulf_islands, форт в 274.
  persian_gulf: { x: -60, z: -620 },
};

export function getRegionSpawn(region: string): { x: number; z: number } {
  return REGION_SPAWNS[region] ?? { ...SPAWN_PLAZA };
}

// ============================================================
// Зоны внутри регионов
// ============================================================
// Каждый регион разделён на зоны с прямоугольными границами.
// Зона — это подразделение региона с собственным названием, уровнем
// опасности и набором объектов. Границы зоны — прямоугольник в
// мировых координатах (x1, z1, x2, z2).
//
// Зоны нужны для:
// - Навигации: игрок видит, в какой зоне находится
// - Спавна монстров: разные зоны — разные монстры
// - Квестов: квесты привязаны к зонам
// - Уровня опасности: зона определяет уровень монстров

export interface Zone {
  id: string;
  region: string;
  name: string;
  nameRu: string;
  minLevel: number;
  dangerLevel: 1 | 2 | 3 | 4 | 5;
  bounds: { x1: number; z1: number; x2: number; z2: number };
  description: string;
}

/** Граница центральной части мира. За этой чертой - дальние края.
 *  Полосы восьми прежних регионов идут по северу-югу и потому ограничены
 *  по x: иначе они налезали бы на полосы дальних краёв, а getZoneAt отдаёт
 *  первую подходящую зону, то есть игрок увидел бы чужой регион. */
export const СРЕДНИЙ_КРАЙ = 2350;

export const ZONES: Zone[] = [
  // ── Дальние края: девятый и десятый регионы ───────────────────────────
  // Решение владельца. За x = ±2350 край становится настоящей землёй.
  // Уровни продолжают рост: Герат 90, восточный край 92, западный 94.
  // Запретов на вход нет - преграды на пути игрока не ставим.
  { id: 'east_frontier_gates', region: 'east_frontier', name: 'Far East Outpost', nameRu: 'Застава дальнего востока', minLevel: 92, dangerLevel: 4, bounds: { x1: СРЕДНИЙ_КРАЙ, z1: -483, x2: 3175, z2: 700 }, description: 'Последнее место, где ещё есть дорога. За ним на восток начинается земля, которой никто не наносит карты.' },
  { id: 'east_frontier_road', region: 'east_frontier', name: 'Road to the Far East', nameRu: 'Дорога на дальний восток', minLevel: 94, dangerLevel: 5, bounds: { x1: СРЕДНИЙ_КРАЙ, z1: 700, x2: 3175, z2: 1900 }, description: 'Каменная дорога через горы. Идти можно, но обратной дороги никто не обещал.' },
  { id: 'east_frontier_far', region: 'east_frontier', name: 'Edge of the East', nameRu: 'Край востока', minLevel: 96, dangerLevel: 5, bounds: { x1: СРЕДНИЙ_КРАЙ, z1: 1900, x2: 3175, z2: 3175 }, description: 'Самый дальний угол мира. За гребнем хребта не слышно ничего, даже ветра.' },
  { id: 'west_frontier_gates', region: 'west_frontier', name: 'Far West Outpost', nameRu: 'Застава дальнего запада', minLevel: 94, dangerLevel: 5, bounds: { x1: -3175, z1: -483, x2: -СРЕДНИЙ_КРАЙ, z2: 1400 }, description: 'Застава на западной кромке обитаемого мира. Отсюда вниз по склону уходит тропа.' },
  { id: 'west_frontier_road', region: 'west_frontier', name: 'Road to the Far West', nameRu: 'Дорога на дальний запад', minLevel: 96, dangerLevel: 5, bounds: { x1: -3175, z1: 1400, x2: -СРЕДНИЙ_КРАЙ, z2: 2400 }, description: 'Ровная степь на краю мира. Здесь нет гор, зато нет и дороги.' },
  { id: 'west_frontier_far', region: 'west_frontier', name: 'Edge of the West', nameRu: 'Край запада', minLevel: 98, dangerLevel: 5, bounds: { x1: -3175, z1: 2400, x2: -СРЕДНИЙ_КРАЙ, z2: 3175 }, description: 'Дальний предел. Земля, которая ничем не отличается от края карты.' },
  // ── Исфахан: столица, полоса вокруг ПОСТРОЕННОГО города (34, 26).
  // ЧТО БЫЛО. Полоса называлась tabriz_center, хотя город Исфахан: то есть
  // зона и код называли столицу разными именами. Полоса не двигалась, а
  // только переименована - город и зоны теперь совпадают.
  { id: 'isfahan_center', region: 'isfahan', name: 'Isfahan Center', nameRu: 'Центр Исфахана', minLevel: 1, dangerLevel: 1, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: -50, x2: СРЕДНИЙ_КРАЙ, z2: 33 }, description: 'Столица империи. Безопасная зона для новичков.' },
  { id: 'isfahan_outskirts', region: 'isfahan', name: 'Isfahan Outskirts', nameRu: 'Окраины Исфахана', minLevel: 5, dangerLevel: 2, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: 33, x2: СРЕДНИЙ_КРАЙ, z2: 117 }, description: 'Пригороды и фермы. Встречаются волки и бандиты.' },
  { id: 'isfahan_north', region: 'isfahan', name: 'Northern Isfahan', nameRu: 'Северный Исфахан', minLevel: 10, dangerLevel: 3, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: 117, x2: СРЕДНИЙ_КРАЙ, z2: 350 }, description: 'Холмы и руины. Опасные монстры.' },
  // ── Тебриз: полоса, которую раньше занимал Исфахан.
  { id: 'tabriz_bazaar', region: 'tabriz', name: 'Tabriz Bazaar', nameRu: 'Базар Тебриза', minLevel: 20, dangerLevel: 1, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: -350, x2: СРЕДНИЙ_КРАЙ, z2: -283 }, description: 'Главный базар Тебриза. Безопасно, много торговцев.' },
  { id: 'tabriz_gates', region: 'tabriz', name: 'Tabriz Gates', nameRu: 'Ворота Тебриза', minLevel: 20, dangerLevel: 2, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: -283, x2: СРЕДНИЙ_КРАЙ, z2: -217 }, description: 'Ворота и стены города.' },
  { id: 'tabriz_south', region: 'tabriz', name: 'Southern Tabriz', nameRu: 'Южный Тебриз', minLevel: 25, dangerLevel: 3, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: -217, x2: СРЕДНИЙ_КРАЙ, z2: -50 }, description: 'Южные дороги. Караваны и разбойники.' },
  { id: 'shiraz_gardens', region: 'shiraz', name: 'Shiraz Gardens', nameRu: 'Сады Шираза', minLevel: 40, dangerLevel: 1, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: 350, x2: СРЕДНИЙ_КРАЙ, z2: 400 }, description: 'Сады и дворцы. Безопасно.' },
  { id: 'shiraz_walls', region: 'shiraz', name: 'Shiraz Walls', nameRu: 'Стены Шираза', minLevel: 40, dangerLevel: 2, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: 400, x2: СРЕДНИЙ_КРАЙ, z2: 450 }, description: 'Городские стены и окрестности.' },
  { id: 'shiraz_east', region: 'shiraz', name: 'Eastern Shiraz', nameRu: 'Восточный Шираз', minLevel: 45, dangerLevel: 3, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: 450, x2: СРЕДНИЙ_КРАЙ, z2: 500 }, description: 'Восточные пустыни. Опасные монстры.' },
  { id: 'caucasus_pass', region: 'caucasus', name: 'Caucasus Pass', nameRu: 'Кавказский перевал', minLevel: 50, dangerLevel: 3, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: 500, x2: СРЕДНИЙ_КРАЙ, z2: 567 }, description: 'Горный перевал. Опасно.' },
  { id: 'caucasus_fortress', region: 'caucasus', name: 'Caucasus Fortress', nameRu: 'Кавказская крепость', minLevel: 55, dangerLevel: 4, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: 567, x2: СРЕДНИЙ_КРАЙ, z2: 633 }, description: 'Крепость и окрестности.' },
  { id: 'caucasus_peaks', region: 'caucasus', name: 'Caucasus Peaks', nameRu: 'Кавказские пики', minLevel: 60, dangerLevel: 5, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: 633, x2: СРЕДНИЙ_КРАЙ, z2: 700 }, description: 'Высокие горы. Самые опасные монстры.' },
  { id: 'mesopotamia_river', region: 'mesopotamia', name: 'Mesopotamia River', nameRu: 'Месопотамская река', minLevel: 60, dangerLevel: 3, bounds: { x1: -3175, z1: -550, x2: 3175, z2: -483 }, description: 'Речные долины. Караваны.' },
  { id: 'mesopotamia_ruins', region: 'mesopotamia', name: 'Mesopotamia Ruins', nameRu: 'Месопотамские руины', minLevel: 65, dangerLevel: 4, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: -483, x2: СРЕДНИЙ_КРАЙ, z2: -417 }, description: 'Древние руины. Опасно.' },
  { id: 'mesopotamia_frontier', region: 'mesopotamia', name: 'Mesopotamia Frontier', nameRu: 'Месопотамская граница', minLevel: 70, dangerLevel: 5, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: -417, x2: СРЕДНИЙ_КРАЙ, z2: -350 }, description: 'Граница с Османами. Постоянные бои.' },
  { id: 'khorasan_oasis', region: 'khorasan', name: 'Khorasan Oasis', nameRu: 'Хорасанский оазис', minLevel: 70, dangerLevel: 3, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: 700, x2: СРЕДНИЙ_КРАЙ, z2: 900 }, description: 'Оазис в пустыне.' },
  { id: 'khorasan_caravanserai', region: 'khorasan', name: 'Khorasan Caravanserai', nameRu: 'Хорасанский караван-сарай', minLevel: 75, dangerLevel: 4, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: 900, x2: СРЕДНИЙ_КРАЙ, z2: 1150 }, description: 'Караван-сарай и дороги.' },
  { id: 'khorasan_east', region: 'khorasan', name: 'Eastern Khorasan', nameRu: 'Восточный Хорасан', minLevel: 80, dangerLevel: 5, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: 1150, x2: СРЕДНИЙ_КРАЙ, z2: 1600 }, description: 'Дальний восток. Самые опасные монстры.' },
  // ── Герат: восьмой регион, северо-восточный край за Хорасаном.
  // Герата не было в мире вовсе, хотя он и назван в ROADMAP как город, и
  // решение по нему было отложено на владельца. Владелец решил: заводим
  // полноценный регион, а не город внутри Хорасана.
  { id: 'herat_gates', region: 'herat', name: 'Herat Gates', nameRu: 'Ворота Герата', minLevel: 90, dangerLevel: 4, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: 1600, x2: СРЕДНИЙ_КРАЙ, z2: 2100 }, description: 'Западные ворота и подступы к Герату.' },
  { id: 'herat_city', region: 'herat', name: 'Herat City', nameRu: 'Герат', minLevel: 90, dangerLevel: 5, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: 2100, x2: СРЕДНИЙ_КРАЙ, z2: 2600 }, description: 'Сам Герат и его кварталы.' },
  { id: 'herat_east', region: 'herat', name: 'Eastern Herat', nameRu: 'Восточный Герат', minLevel: 95, dangerLevel: 5, bounds: { x1: -СРЕДНИЙ_КРАЙ, z1: 2600, x2: СРЕДНИЙ_КРАЙ, z2: 3175 }, description: 'Край мира за Гератом. Самые опасные монстры.' },
  { id: 'persian_gulf_harbor', region: 'persian_gulf', name: 'Persian Gulf Harbor', nameRu: 'Персидский залив — гавань', minLevel: 80, dangerLevel: 2, bounds: { x1: -3175, z1: -3175, x2: 3175, z2: -917 }, description: 'Гавань и порт.' },
  { id: 'persian_gulf_waters', region: 'persian_gulf', name: 'Persian Gulf Waters', nameRu: 'Персидский залив — воды', minLevel: 85, dangerLevel: 4, bounds: { x1: -3175, z1: -917, x2: 3175, z2: -733 }, description: 'Открытые воды. Пираты и морские чудовища.' },
  { id: 'persian_gulf_islands', region: 'persian_gulf', name: 'Persian Gulf Islands', nameRu: 'Персидский залив — острова', minLevel: 90, dangerLevel: 5, bounds: { x1: -3175, z1: -733, x2: 3175, z2: -550 }, description: 'Острова. Самые опасные монстры.' },
];

export function getZoneAt(x: number, z: number): Zone | null {
  for (const zone of ZONES) {
    if (x >= zone.bounds.x1 && x <= zone.bounds.x2 && z >= zone.bounds.z1 && z <= zone.bounds.z2) {
      return zone;
    }
  }
  return null;
}

export function getZonesByRegion(region: string): Zone[] {
  return ZONES.filter(z => z.region === region);
}

export const REDIS_CHANNELS = {
  PLAYER_NOTIFICATION: 'player:notification',
  ANTI_CHEAT_KICK: 'anticheat:kick',
  ANTI_CHEAT_BAN: 'anticheat:ban',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_LOGOUT_ALL: 'auth:logout_all',
  WORLD_TIME_UPDATE: 'world:time_update',
  PLAYER_KARMA_CHANGED: 'player:karma_changed',
  /**
   * Активация скакуна конкретным игроком. Канал персональный: персонаж
   * входит в само имя, поэтому подписка делается на канал этого
   * игрока. Раньше MountSystem публиковал сюда напрямую строкой, и
   * подписчика не было - смена скакуна доходила только после
   * перечитывания панели.
   */
  PLAYER_MOUNT: (characterId: string) => `player:mount:${characterId}`,
  // ── Партия ────────────────────────────────────────────────────
  // Партия живёт в Redis, а игроки подключены к сокетам. События из
  // PartySystem уходили в каналы, на которые не подписан никто: состав
  // партии менялся, и никто из участников об этом не узнавал, пока не
  // открыл панель заново.
  PARTY_UPDATED: 'party:updated',
  PARTY_MEMBER_JOINED: 'party:member_joined',
  PARTY_MEMBER_LEFT: 'party:member_left',
  PARTY_DISBANDED: 'party:disbanded',
  // ── Аукцион и карма ───────────────────────────────────────────
  /** Новый лот: сообщаем всем, чтобы игрок увидел, что цена изменилась */
  AUCTION_NEW_LISTING: 'auction:new_listing',
  /** На игрока повесили баунти: сообщаем только ему */
  BOUNTY_PLACED: 'player:bounty_placed',
  // ── Глобальные объявления ─────────────────────────────────────
  /** Объявление всем игрокам. Раньше канал был, подписчика не было */
  GLOBAL_NOTIFICATION: 'global:notification',
  // ── Действия администратора ───────────────────────────────────
  /** Кик игрока: по userId, как и у анти-чита */
  ADMIN_KICK_USER: 'admin:kick_user',
  /** Молчание персонажа */
  ADMIN_MUTE: 'admin:mute',
  /** Телепорт персонажа: игрок должен оказаться в новом месте */
  ADMIN_TELEPORT: 'admin:teleport',
  /** Выдача предмета: игрок должен увидеть предмет у себя */
  ADMIN_GIVE_ITEM: 'admin:give_item',
  // Каналы регионов изолированы по шардам (игровым серверам)
  REGION_SPAWN: (shardId: string, region: string) => `region:${shardId}:${region}:spawn`,
  REGION_AI_ACTION: (shardId: string, region: string) => `region:${shardId}:${region}:ai_action`,
  REGION_NOTIFICATION: (shardId: string, region: string) => `region:${shardId}:${region}:notification`,
  REGION_MONSTER_KILLED: (shardId: string, region: string) => `region:${shardId}:${region}:monster_killed`,
  REGION_MONSTER_HIT: (shardId: string, region: string) => `region:${shardId}:${region}:monster_hit`, // монстр ударил игрока
  // Урон со временем и список того, что сейчас висит на игроке. Отдельный
  // канал от monster_hit: тот приходит в момент удара, а этот - на
  // проходе раз в две секунды и несёт остаток эффектов, а не удар.
  REGION_DEBUFF_TICK: (shardId: string, region: string) => `region:${shardId}:${region}:debuff_tick`,
} as const;

// ============================================================
// Алиасы квестовых NPC: id из server/src/data/quests.ts, которых нет
// в мире, → реально существующий NPC. Используется и сервером
// (QuestService.recordTalk), и клиентом (стрелка-навигатор).
// ============================================================
export const QUEST_NPC_ALIAS: Record<string, string> = {
  npc_shah_messenger: 'npc_quest_crier',
  npc_grand_vizier: 'npc_quest_crier',
  npc_guard_captain: 'npc_guard_east',
  npc_tabriz_guard: 'npc_guard_east',
  npc_tabriz_merchant: 'npc_forester',
  npc_isfahan_trader: 'npc_bazaar_merchant',
  npc_isfahan_merchant: 'npc_bazaar_merchant',
  npc_village_elder: 'npc_forester',
  npc_tabriz_farmer: 'npc_village_trader',
  npc_tabriz_hunter: 'npc_woodcutter',
  npc_shiraz_librarian: 'npc_poet',
  npc_shiraz_priest: 'npc_healer',
  npc_qizilbash_commander: 'npc_fort_commander',
  npc_khorasan_governor: 'npc_desert_master',
  'npc_gulf_harbor-master': 'npc_harbor_master',
  npc_isfahan_mage: 'npc_mystic',
  npc_isfahan_alchemist: 'npc_craftsman',
};
