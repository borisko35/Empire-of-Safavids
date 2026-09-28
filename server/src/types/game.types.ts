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
  /** Добыча с монстров: шкуры, клыки, панцири. Идёт в квесты и крафт */
  TROPHY = 'trophy',
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
  /** Текущая зона внутри региона (например, "tabriz_center") */
  zone?: string;
  /** Игровой сервер (шард), на котором живёт персонаж */
  serverId: string;
  guildId?: string;
  gold: number;
  /** Премиум-валюта AZENS (АЗЭНы) — покупка за реальные деньги */
  azens?: number;
  /** Исфаханское серебро — бесплатно в квестах, торговле, ивентах */
  isfahanSilver?: number;
  /** Сирийское золото — бесплатно в квестах, торговле, ивентах */
  syrianGold?: number;
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
  /**
   * Бонус для воды: доля (0.3 = +30%), на которую предмет убирает
   * замедление в реке/озере. НЕ характеристика — поэтому живёт отдельно
   * от stats, иначе сумма бонусов в интерфейсе показывала бы мусор.
   */
  waterSpeed?: number;
  /** Расход выносливости в воде: доля экономии (0.25 = на четверть меньше) */
  swimStamina?: number;
  description: string;
  iconPath: string;
  stackable: boolean;
  maxStack: number;
  price: number;
}

/** Специальные бонусы экипировки (вне пяти основных характеристик) */
export interface EquipmentBonuses {
  /** -1..1: доля снятого замедления в воде */
  waterSpeed: number;
  /** 0..1: экономия выносливости при плавании */
  swimStamina: number;
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
  /** Премиум-валюта AZENS (АЗЭНы) — покупка за реальные деньги */
  azens?: number;
  /** Исфаханское серебро — бесплатно в квестах, торговле, ивентах */
  isfahanSilver?: number;
  /** Сирийское золото — бесплатно в квестах, торговле, ивентах */
  syrianGold?: number;
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
