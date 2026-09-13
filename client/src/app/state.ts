// ============================================================
// Состояние сессии — Empire of Safavids
// ============================================================

export interface Vec3 { x: number; y: number; z: number }

export interface CharacterStats {
  strength: number; agility: number; intelligence: number; endurance: number; charisma: number;
}

export interface Character {
  id: string;
  userId: string;
  name: string;
  class: string;
  level: number;
  experience: number;
  stats: CharacterStats;
  hp: number; maxHp: number;
  mana: number; maxMana: number;
  stamina: number; maxStamina: number;
  position: Vec3;
  region: string;
  serverId: string;
  gold: number;
}

export interface SkillDef {
  id: string;
  name: string;
  nameRu: string;
  manaCost: number;
  staminaCost: number;
  cooldown: number;
  damageMultiplier: number;
  range: number;
  aoe: boolean;
}

export interface RegionInfo {
  id: string;
  name: string;
  nameRu: string;
  minLevel: number;
  description: string;
  onlinePlayers: number;
}

export interface QuestObjectiveDef {
  id: string;
  type: string;
  description: string;
  target: string;
  required: number;
  optional: boolean;
}

export interface QuestDef {
  id: string;
  title: string;
  titleRu: string;
  description: string;
  type: string;
  minLevel: number;
  requiredRegion?: string;
  objectives: QuestObjectiveDef[];
  npcGiverRegion: string;
  rewards: { experience: number; gold: number; items?: { itemId: string; quantity: number }[] };
}

/** Живое состояние игровой сессии */
export const session = {
  token: localStorage.getItem('eos_token') ?? '',
  userId: localStorage.getItem('eos_user_id') ?? '',
  username: localStorage.getItem('eos_username') ?? '',
  character: null as Character | null,
  skills: [] as SkillDef[],
  /** Локальные ресурсы (сервер их не стримит — поддерживаем сами, ресинк по событиям) */
  hp: 0, maxHp: 0, mana: 0, maxMana: 0, stamina: 0, maxStamina: 0,
  level: 0, experience: 0,
  /** Убийства за сессию: monsterId -> количество (для прогресса квестов) */
  kills: {} as Record<string, number>,
  /** Прогресс квестов с сервера: questId -> { status, progress } */
  questState: {} as Record<string, { status: string; progress: Record<string, number> }>,
  worldTime: '' as string,
};

export function persistAuth(token: string, userId: string, username: string): void {
  session.token = token;
  session.userId = userId;
  session.username = username;
  localStorage.setItem('eos_token', token);
  localStorage.setItem('eos_user_id', userId);
  localStorage.setItem('eos_username', username);
}

export function clearAuth(): void {
  session.token = '';
  session.userId = '';
  session.username = '';
  session.character = null;
  session.skills = [];
  localStorage.removeItem('eos_token');
  localStorage.removeItem('eos_user_id');
  localStorage.removeItem('eos_username');
}
