// ============================================================
// Основные игровые типы — Empire of Safavids
// ============================================================

export enum CharacterClass {
  QIZILBASH = 'qizilbash',       // Гвардеец Кызылбаш
  SUFI_MYSTIC = 'sufi_mystic',   // Суфийский Мистик
  PERSIAN_ARCHER = 'persian_archer', // Персидский Лучник
  BAZAAR_MERCHANT = 'bazaar_merchant', // Базарный Торговец
  COURT_DIPLOMAT = 'court_diplomat',   // Придворный Дипломат
}

export enum Region {
  TABRIZ = 'tabriz',
  ISFAHAN = 'isfahan',
  SHIRAZ = 'shiraz',
  CAUCASUS = 'caucasus',
  MESOPOTAMIA = 'mesopotamia',
  KHORASAN = 'khorasan',
  PERSIAN_GULF = 'persian_gulf',
}

export enum ItemRarity {
  COMMON = 'common',
  UNCOMMON = 'uncommon',
  RARE = 'rare',
  EPIC = 'epic',
  LEGENDARY = 'legendary',
  ARTIFACT = 'artifact',
}

export enum ItemType {
  WEAPON = 'weapon',
  ARMOR = 'armor',
  ACCESSORY = 'accessory',
  CONSUMABLE = 'consumable',
  MATERIAL = 'material',
  QUEST = 'quest',
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface CharacterStats {
  strength: number;      // Сила — физический урон
  agility: number;       // Ловкость — скорость, уклонение
  intelligence: number;  // Интеллект — магический урон
  endurance: number;     // Выносливость — HP, стамина
  charisma: number;      // Харизма — торговля, дипломатия
}

export interface Character {
  id: string;
  userId: string;
  name: string;
  class: CharacterClass;
  level: number;
  experience: number;
  stats: CharacterStats;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  stamina: number;
  maxStamina: number;
  position: Vector3;
  region: Region;
  guildId?: string;
  gold: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Item {
  id: string;
  name: string;
  nameRu: string;
  type: ItemType;
  rarity: ItemRarity;
  level: number;
  stats?: Partial<CharacterStats>;
  description: string;
  iconPath: string;
  stackable: boolean;
  maxStack: number;
  price: number;
}

export interface InventorySlot {
  slotIndex: number;
  item: Item;
  quantity: number;
  enhancement: number; // +0 до +20
}

export interface Guild {
  id: string;
  name: string;
  description: string;
  leaderId: string;
  members: string[];
  level: number;
  territory?: Region;
  gold: number;
  createdAt: Date;
}

export interface Quest {
  id: string;
  title: string;
  titleRu: string;
  description: string;
  type: 'main' | 'side' | 'guild' | 'daily' | 'world';
  minLevel: number;
  rewards: QuestReward;
  objectives: QuestObjective[];
}

export interface QuestObjective {
  id: string;
  description: string;
  type: 'kill' | 'collect' | 'talk' | 'explore' | 'escort';
  target: string;
  required: number;
  current: number;
}

export interface QuestReward {
  experience: number;
  gold: number;
  items?: Item[];
  reputation?: { faction: string; amount: number };
}

export interface CombatAction {
  characterId: string;
  actionType: 'attack' | 'skill' | 'dodge' | 'block' | 'ultimate';
  skillId?: string;
  targetId?: string;
  position: Vector3;
  direction: Vector3;
  timestamp: number;
}

export interface GameEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  region: Region;
}
