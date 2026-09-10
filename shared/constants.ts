// ============================================================
// Общие константы — Empire of Safavids
// ============================================================

export const GAME_VERSION = '0.1.0';
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
} as const;

// Каналы Redis pub/sub
export const REDIS_CHANNELS = {
  PLAYER_NOTIFICATION: 'player:notification',
  ANTI_CHEAT_KICK: 'anticheat:kick',
  ANTI_CHEAT_BAN: 'anticheat:ban',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_LOGOUT_ALL: 'auth:logout_all',
  WORLD_TIME_UPDATE: 'world:time_update',
  PLAYER_KARMA_CHANGED: 'player:karma_changed',
  REGION_SPAWN: (region: string) => `region:${region}:spawn`,
  REGION_AI_ACTION: (region: string) => `region:${region}:ai_action`,
  REGION_NOTIFICATION: (region: string) => `region:${region}:notification`,
  REGION_MONSTER_KILLED: (region: string) => `region:${region}:monster_killed`,
  REGION_MONSTER_HIT: (region: string) => `region:${region}:monster_hit`, // монстр ударил игрока
} as const;
