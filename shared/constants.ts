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
export const CHAT_LIMITS = {
  MAX_MESSAGE_LENGTH: 500,
  WORLD_CHAT_COOLDOWN_MS: 5000,
  REGION_CHAT_COOLDOWN_MS: 1000,
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
  PLAYER_JOINED: 'player:joined',
  PLAYER_LEFT: 'player:left',
  PLAYER_DIED: 'player:died',
  PLAYER_RESPAWNED: 'player:respawned',
  MOVE_REJECTED: 'move:rejected',

  // Interiors (здания с входом/выходом)
  INTERIOR_ENTER: 'interior:enter',
  INTERIOR_EXIT: 'interior:exit',

  // Combat
  COMBAT_ACTION: 'combat:action',
  COMBAT_RESULT: 'combat:result',
  COMBAT_HIT: 'combat:hit',
  COMBAT_VISUAL: 'combat:visual',
  COMBAT_HEAL: 'combat:heal',
  COMBAT_ERROR: 'combat:error',

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
} as const;

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
