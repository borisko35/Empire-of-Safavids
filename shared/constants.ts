// ============================================================
// Общие константы — Empire of Safavids
// ============================================================

/**
 * Версия игры. Показывается на лендинге (бейдж берёт из /health) и в меню
 * персонажа. Раньше в index.html было захардкожено «v0.2.0» отдельно от
 * константы — версии расходились. Теперь меню подставляет значение отсюда.
 */
export const GAME_VERSION = '0.3.0';
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
export const REGION_LEVEL_REQUIREMENTS: Record<string, number> = {
  tabriz: 1,
  isfahan: 20,
  shiraz: 40,
  caucasus: 50,
  mesopotamia: 60,
  khorasan: 70,
  persian_gulf: 80,
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
  tabriz: { x: 0, z: 0 },
  isfahan: { x: 0, z: 0 },
  shiraz: { x: 90, z: -60 },
  caucasus: { x: 60, z: 140 },
  mesopotamia: { x: 200, z: 50 },
  khorasan: { x: 150, z: 200 },
  persian_gulf: { x: -60, z: -170 },
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

export const ZONES: Zone[] = [
  { id: 'tabriz_center', region: 'tabriz', name: 'Tabriz Center', nameRu: 'Центр Тебриза', minLevel: 1, dangerLevel: 1, bounds: { x1: -1170, z1: -50, x2: 1170, z2: 33 }, description: 'Столица империи. Безопасная зона для новичков.' },
  { id: 'tabriz_outskirts', region: 'tabriz', name: 'Tabriz Outskirts', nameRu: 'Окраины Тебриза', minLevel: 5, dangerLevel: 2, bounds: { x1: -1170, z1: 33, x2: 1170, z2: 117 }, description: 'Пригороды и фермы. Встречаются волки и бандиты.' },
  { id: 'tabriz_north', region: 'tabriz', name: 'Northern Tabriz', nameRu: 'Северный Тебриз', minLevel: 10, dangerLevel: 3, bounds: { x1: -1170, z1: 117, x2: 1170, z2: 200 }, description: 'Холмы и руины. Опасные монстры.' },
  { id: 'isfahan_bazaar', region: 'isfahan', name: 'Isfahan Bazaar', nameRu: 'Базар Исфахана', minLevel: 20, dangerLevel: 1, bounds: { x1: -1170, z1: -350, x2: 1170, z2: -283 }, description: 'Главный базар. Безопасно, много торговцев.' },
  { id: 'isfahan_gates', region: 'isfahan', name: 'Isfahan Gates', nameRu: 'Ворота Исфахана', minLevel: 20, dangerLevel: 2, bounds: { x1: -1170, z1: -283, x2: 1170, z2: -217 }, description: 'Ворота и стены города.' },
  { id: 'isfahan_south', region: 'isfahan', name: 'Southern Isfahan', nameRu: 'Южный Исфахан', minLevel: 25, dangerLevel: 3, bounds: { x1: -1170, z1: -217, x2: 1170, z2: -150 }, description: 'Южные дороги. Караваны и разбойники.' },
  { id: 'shiraz_gardens', region: 'shiraz', name: 'Shiraz Gardens', nameRu: 'Сады Шираза', minLevel: 40, dangerLevel: 1, bounds: { x1: -1170, z1: 350, x2: 1170, z2: 400 }, description: 'Сады и дворцы. Безопасно.' },
  { id: 'shiraz_walls', region: 'shiraz', name: 'Shiraz Walls', nameRu: 'Стены Шираза', minLevel: 40, dangerLevel: 2, bounds: { x1: -1170, z1: 400, x2: 1170, z2: 450 }, description: 'Городские стены и окрестности.' },
  { id: 'shiraz_east', region: 'shiraz', name: 'Eastern Shiraz', nameRu: 'Восточный Шираз', minLevel: 45, dangerLevel: 3, bounds: { x1: -1170, z1: 450, x2: 1170, z2: 500 }, description: 'Восточные пустыни. Опасные монстры.' },
  { id: 'caucasus_pass', region: 'caucasus', name: 'Caucasus Pass', nameRu: 'Кавказский перевал', minLevel: 50, dangerLevel: 3, bounds: { x1: -1170, z1: 500, x2: 1170, z2: 567 }, description: 'Горный перевал. Опасно.' },
  { id: 'caucasus_fortress', region: 'caucasus', name: 'Caucasus Fortress', nameRu: 'Кавказская крепость', minLevel: 55, dangerLevel: 4, bounds: { x1: -1170, z1: 567, x2: 1170, z2: 633 }, description: 'Крепость и окрестности.' },
  { id: 'caucasus_peaks', region: 'caucasus', name: 'Caucasus Peaks', nameRu: 'Кавказские пики', minLevel: 60, dangerLevel: 5, bounds: { x1: -1170, z1: 633, x2: 1170, z2: 700 }, description: 'Высокие горы. Самые опасные монстры.' },
  { id: 'mesopotamia_river', region: 'mesopotamia', name: 'Mesopotamia River', nameRu: 'Месопотамская река', minLevel: 60, dangerLevel: 3, bounds: { x1: -1170, z1: -550, x2: 1170, z2: -483 }, description: 'Речные долины. Караваны.' },
  { id: 'mesopotamia_ruins', region: 'mesopotamia', name: 'Mesopotamia Ruins', nameRu: 'Месопотамские руины', minLevel: 65, dangerLevel: 4, bounds: { x1: -1170, z1: -483, x2: 1170, z2: -417 }, description: 'Древние руины. Опасно.' },
  { id: 'mesopotamia_frontier', region: 'mesopotamia', name: 'Mesopotamia Frontier', nameRu: 'Месопотамская граница', minLevel: 70, dangerLevel: 5, bounds: { x1: -1170, z1: -417, x2: 1170, z2: -350 }, description: 'Граница с Османами. Постоянные бои.' },
  { id: 'khorasan_oasis', region: 'khorasan', name: 'Khorasan Oasis', nameRu: 'Хорасанский оазис', minLevel: 70, dangerLevel: 3, bounds: { x1: -1170, z1: 700, x2: 1170, z2: 817 }, description: 'Оазис в пустыне.' },
  { id: 'khorasan_caravanserai', region: 'khorasan', name: 'Khorasan Caravanserai', nameRu: 'Хорасанский караван-сарай', minLevel: 75, dangerLevel: 4, bounds: { x1: -1170, z1: 817, x2: 1170, z2: 933 }, description: 'Караван-сарай и дороги.' },
  { id: 'khorasan_east', region: 'khorasan', name: 'Eastern Khorasan', nameRu: 'Восточный Хорасан', minLevel: 80, dangerLevel: 5, bounds: { x1: -1170, z1: 933, x2: 1170, z2: 1050 }, description: 'Дальний восток. Самые опасные монстры.' },
  { id: 'persian_gulf_harbor', region: 'persian_gulf', name: 'Persian Gulf Harbor', nameRu: 'Персидский залив — гавань', minLevel: 80, dangerLevel: 2, bounds: { x1: -1170, z1: -1100, x2: 1170, z2: -917 }, description: 'Гавань и порт.' },
  { id: 'persian_gulf_waters', region: 'persian_gulf', name: 'Persian Gulf Waters', nameRu: 'Персидский залив — воды', minLevel: 85, dangerLevel: 4, bounds: { x1: -1170, z1: -917, x2: 1170, z2: -733 }, description: 'Открытые воды. Пираты и морские чудовища.' },
  { id: 'persian_gulf_islands', region: 'persian_gulf', name: 'Persian Gulf Islands', nameRu: 'Персидский залив — острова', minLevel: 90, dangerLevel: 5, bounds: { x1: -1170, z1: -733, x2: 1170, z2: -550 }, description: 'Острова. Самые опасные монстры.' },
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
