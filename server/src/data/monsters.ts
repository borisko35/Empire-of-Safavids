import { Region } from '../types/game.types';

// ============================================================
// База данных монстров — Empire of Safavids
// ============================================================

export type MonsterType = 'normal' | 'elite' | 'boss' | 'world_boss';
export type MonsterFaction = 'ottoman' | 'mongol' | 'bandit' | 'undead' | 'mythical' | 'neutral';

export interface MonsterSkill {
  id: string;
  name: string;
  nameRu: string;
  damage: number;
  cooldown: number;
  range: number;
  aoe: boolean;
  aoeRadius?: number;
  effect?: 'stun' | 'slow' | 'bleed' | 'poison' | 'fear';
  effectDuration?: number;
}

export interface MonsterLootEntry {
  itemId: string;
  chance: number;   // 0–1 (1 = 100%)
  minQty: number;
  maxQty: number;
}

export interface MonsterDefinition {
  id: string;
  name: string;
  nameRu: string;
  type: MonsterType;
  faction: MonsterFaction;
  level: number;
  hp: number;
  mana: number;
  strength: number;
  agility: number;
  intelligence: number;
  defense: number;
  moveSpeed: number;
  attackRange: number;
  aggroRange: number;
  expReward: number;
  goldReward: { min: number; max: number };
  skills: MonsterSkill[];
  lootTable: MonsterLootEntry[];
  region: Region;
  respawnTime: number; // секунды
  description: string;
  modelPath: string;
}

export const MONSTERS_DATABASE: Record<string, MonsterDefinition> = {

  // ── ОБЫЧНЫЕ МОНСТРЫ ──────────────────────────────────────────────
  'mob_bandit_scout': {
    id: 'mob_bandit_scout',
    name: 'Bandit Scout',
    nameRu: 'Разбойник-Разведчик',
    type: 'normal',
    faction: 'bandit',
    level: 3,
    hp: 250,
    mana: 0,
    strength: 12,
    agility: 18,
    intelligence: 5,
    defense: 8,
    moveSpeed: 4.5,
    attackRange: 2,
    aggroRange: 12,
    expReward: 45,
    goldReward: { min: 2, max: 8 },
    skills: [
      { id: 'bandit_stab', name: 'Quick Stab', nameRu: 'Быстрый Укол', damage: 35, cooldown: 4, range: 2, aoe: false },
    ],
    lootTable: [
      { itemId: 'con_health_potion_s', chance: 0.3, minQty: 1, maxQty: 2 },
      { itemId: 'mat_iron_ore', chance: 0.2, minQty: 1, maxQty: 3 },
    ],
    region: Region.TABRIZ,
    respawnTime: 60,
    description: 'Одинокий разбойник, промышляющий околостей Тебриза.',
    modelPath: 'models/monsters/bandit_scout.fbx',
  },
  'mob_bandit_warrior': {
    id: 'mob_bandit_warrior',
    name: 'Bandit Warrior',
    nameRu: 'Разбойник-Воин',
    type: 'normal',
    faction: 'bandit',
    level: 8,
    hp: 600,
    mana: 0,
    strength: 22,
    agility: 14,
    intelligence: 4,
    defense: 18,
    moveSpeed: 3.8,
    attackRange: 2.5,
    aggroRange: 10,
    expReward: 120,
    goldReward: { min: 5, max: 20 },
    skills: [
      { id: 'warrior_slash', name: 'Heavy Slash', nameRu: 'Тяжёлый Удар', damage: 80, cooldown: 5, range: 2.5, aoe: false },
      { id: 'warrior_charge', name: 'Charge', nameRu: 'Таран', damage: 60, cooldown: 12, range: 8, aoe: false, effect: 'stun', effectDuration: 2 },
    ],
    lootTable: [
      { itemId: 'con_health_potion_s', chance: 0.4, minQty: 1, maxQty: 3 },
      { itemId: 'mat_iron_ore', chance: 0.5, minQty: 2, maxQty: 5 },
      { itemId: 'wpn_iron_sword', chance: 0.05, minQty: 1, maxQty: 1 },
      // Украденное золото торговца: гарантированный дроп, иначе квест
      // side_tabriz_merchant невозможно завершить (предмет больше нигде не берётся).
      { itemId: 'qst_merchant_gold_bag', chance: 1, minQty: 1, maxQty: 1 },
    ],
    region: Region.TABRIZ,
    respawnTime: 90,
    description: 'Бронированный разбойник с тяжёлым двуручным мечом.',
    modelPath: 'models/monsters/bandit_warrior.fbx',
  },
  'mob_ottoman_janissary': {
    id: 'mob_ottoman_janissary',
    name: 'Ottoman Janissary',
    nameRu: 'Османский Янычар',
    type: 'elite',
    faction: 'ottoman',
    level: 35,
    hp: 4500,
    mana: 200,
    strength: 55,
    agility: 35,
    intelligence: 20,
    defense: 45,
    moveSpeed: 3.5,
    attackRange: 3,
    aggroRange: 15,
    expReward: 850,
    goldReward: { min: 30, max: 80 },
    skills: [
      { id: 'jan_musket', name: 'Musket Shot', nameRu: 'Выстрел из Мушкета', damage: 200, cooldown: 8, range: 20, aoe: false },
      { id: 'jan_bayonet', name: 'Bayonet Charge', nameRu: 'Штыковая Атака', damage: 150, cooldown: 6, range: 4, aoe: false, effect: 'bleed', effectDuration: 5 },
      { id: 'jan_formation', name: 'Battle Formation', nameRu: 'Боевой Строй', damage: 0, cooldown: 30, range: 10, aoe: true, aoeRadius: 10 },
    ],
    lootTable: [
      { itemId: 'con_health_potion_m', chance: 0.5, minQty: 1, maxQty: 2 },
      { itemId: 'mat_iron_ore', chance: 0.7, minQty: 3, maxQty: 8 },
      { itemId: 'wpn_qizilbash_saber', chance: 0.02, minQty: 1, maxQty: 1 },
    ],
    region: Region.MESOPOTAMIA,
    respawnTime: 300,
    description: 'Элитный пехотинец Османской империи. Вооружён мушкетом и ятаганом.',
    modelPath: 'models/monsters/ottoman_janissary.fbx',
  },
  'mob_mongol_raider': {
    id: 'mob_mongol_raider',
    name: 'Mongol Raider',
    nameRu: 'Монгольский Наездник',
    type: 'elite',
    faction: 'mongol',
    level: 55,
    hp: 7000,
    mana: 100,
    strength: 70,
    agility: 60,
    intelligence: 15,
    defense: 40,
    moveSpeed: 6.0,
    attackRange: 15,
    aggroRange: 20,
    expReward: 1500,
    goldReward: { min: 60, max: 150 },
    skills: [
      { id: 'mongol_arrow', name: 'Mounted Arrow', nameRu: 'Стрела с Коня', damage: 280, cooldown: 2, range: 15, aoe: false },
      { id: 'mongol_trample', name: 'Trample', nameRu: 'Топтание', damage: 350, cooldown: 10, range: 6, aoe: true, aoeRadius: 4, effect: 'stun', effectDuration: 3 },
    ],
    lootTable: [
      { itemId: 'con_health_potion_m', chance: 0.6, minQty: 1, maxQty: 3 },
      { itemId: 'mat_silk', chance: 0.4, minQty: 2, maxQty: 6 },
      { itemId: 'acc_turquoise_ring', chance: 0.03, minQty: 1, maxQty: 1 },
    ],
    region: Region.KHORASAN,
    respawnTime: 600,
    description: 'Быстрый монгольский наездник на боевом коне. Опасен на открытой местности.',
    modelPath: 'models/monsters/mongol_raider.fbx',
  },
  'mob_div_fire': {
    id: 'mob_div_fire',
    name: 'Fire Div',
    nameRu: 'Огненный Див',
    type: 'elite',
    faction: 'mythical',
    level: 65,
    hp: 12000,
    mana: 800,
    strength: 80,
    agility: 30,
    intelligence: 90,
    defense: 55,
    moveSpeed: 4.0,
    attackRange: 10,
    aggroRange: 18,
    expReward: 3000,
    goldReward: { min: 100, max: 300 },
    skills: [
      { id: 'div_fireball', name: 'Hellfire', nameRu: 'Адское Пламя', damage: 450, cooldown: 5, range: 10, aoe: true, aoeRadius: 4 },
      { id: 'div_curse', name: 'Div Curse', nameRu: 'Проклятие Дива', damage: 200, cooldown: 15, range: 12, aoe: false, effect: 'poison', effectDuration: 10 },
      { id: 'div_roar', name: 'Terrifying Roar', nameRu: 'Ужасающий Рёв', damage: 0, cooldown: 20, range: 15, aoe: true, aoeRadius: 15, effect: 'fear', effectDuration: 4 },
    ],
    lootTable: [
      { itemId: 'mat_dragon_scale', chance: 0.1, minQty: 1, maxQty: 2 },
      { itemId: 'con_exp_scroll', chance: 0.3, minQty: 1, maxQty: 1 },
      { itemId: 'wpn_sufi_staff', chance: 0.01, minQty: 1, maxQty: 1 },
    ],
    region: Region.KHORASAN,
    respawnTime: 1800,
    description: 'Демон из персидской мифологии. Обитает в горных пещерах Хорасана.',
    modelPath: 'models/monsters/fire_div.fbx',
  },

  // ── БОССЫ ДАНЖЕЙ ──────────────────────────────────────────────
  'boss_bandit_king': {
    id: 'boss_bandit_king',
    name: 'Rustam the Bandit King',
    nameRu: 'Рустам — Король Разбойников',
    type: 'boss',
    faction: 'bandit',
    level: 20,
    hp: 50000,
    mana: 500,
    strength: 80,
    agility: 50,
    intelligence: 30,
    defense: 60,
    moveSpeed: 4.0,
    attackRange: 4,
    aggroRange: 25,
    expReward: 8000,
    goldReward: { min: 200, max: 500 },
    skills: [
      { id: 'rk_whirlwind', name: 'Whirlwind', nameRu: 'Вихрь', damage: 300, cooldown: 8, range: 5, aoe: true, aoeRadius: 5 },
      { id: 'rk_throw', name: 'Boulder Throw', nameRu: 'Бросок Камня', damage: 500, cooldown: 12, range: 15, aoe: true, aoeRadius: 3 },
      { id: 'rk_enrage', name: 'Enrage', nameRu: 'Ярость', damage: 0, cooldown: 60, range: 0, aoe: false },
    ],
    lootTable: [
      { itemId: 'wpn_qizilbash_saber', chance: 0.15, minQty: 1, maxQty: 1 },
      { itemId: 'arm_leather_vest', chance: 0.3, minQty: 1, maxQty: 1 },
      { itemId: 'con_exp_scroll', chance: 0.5, minQty: 1, maxQty: 2 },
      { itemId: 'mat_turquoise', chance: 0.4, minQty: 2, maxQty: 5 },
    ],
    region: Region.TABRIZ,
    respawnTime: 3600,
    description: 'Легендарный атаман Рустам. Главарь всех разбойников Тебриза.',
    modelPath: 'models/bosses/bandit_king.fbx',
  },
  'boss_ottoman_pasha': {
    id: 'boss_ottoman_pasha',
    name: 'Grand Vizier Kara Mustafa',
    nameRu: 'Великий Везирь Кара Мустафа',
    type: 'boss',
    faction: 'ottoman',
    level: 60,
    hp: 250000,
    mana: 2000,
    strength: 150,
    agility: 80,
    intelligence: 100,
    defense: 120,
    moveSpeed: 3.5,
    attackRange: 5,
    aggroRange: 30,
    expReward: 50000,
    goldReward: { min: 1000, max: 3000 },
    skills: [
      { id: 'pasha_cannon', name: 'Ottoman Cannon', nameRu: 'Османская Пушка', damage: 1500, cooldown: 15, range: 25, aoe: true, aoeRadius: 6 },
      { id: 'pasha_janissary_call', name: 'Call Janissaries', nameRu: 'Призыв Янычар', damage: 0, cooldown: 45, range: 0, aoe: false },
      { id: 'pasha_saber', name: 'Scimitar Dance', nameRu: 'Танец Сабли', damage: 800, cooldown: 6, range: 6, aoe: true, aoeRadius: 6 },
      { id: 'pasha_shield', name: 'Janissary Shield Wall', nameRu: 'Щитовая Стена', damage: 0, cooldown: 90, range: 0, aoe: false },
    ],
    lootTable: [
      { itemId: 'wpn_shah_blade', chance: 0.05, minQty: 1, maxQty: 1 },
      { itemId: 'arm_qizilbash_armor', chance: 0.1, minQty: 1, maxQty: 1 },
      { itemId: 'acc_silk_road_amulet', chance: 0.08, minQty: 1, maxQty: 1 },
      { itemId: 'mat_dragon_scale', chance: 0.2, minQty: 1, maxQty: 3 },
      { itemId: 'con_exp_scroll', chance: 0.8, minQty: 2, maxQty: 5 },
    ],
    region: Region.MESOPOTAMIA,
    respawnTime: 86400,
    description: 'Главный полководец Османской армии. Босс данжа «Багдадская Цитадель».',
    modelPath: 'models/bosses/ottoman_pasha.fbx',
  },

  // ── МИРОВЫЕ БОССЫ ────────────────────────────────────────────
  'world_boss_simurgh': {
    id: 'world_boss_simurgh',
    name: 'The Great Simurgh',
    nameRu: 'Великий Симург',
    type: 'world_boss',
    faction: 'mythical',
    level: 90,
    hp: 5000000,
    mana: 10000,
    strength: 300,
    agility: 200,
    intelligence: 250,
    defense: 200,
    moveSpeed: 8.0,
    attackRange: 20,
    aggroRange: 50,
    expReward: 500000,
    goldReward: { min: 5000, max: 15000 },
    skills: [
      { id: 'sim_divine_wind', name: 'Divine Wind', nameRu: 'Божественный Ветер', damage: 3000, cooldown: 10, range: 30, aoe: true, aoeRadius: 20 },
      { id: 'sim_healing_feather', name: 'Healing Feather', nameRu: 'Исцеляющее Перо', damage: -500000, cooldown: 120, range: 0, aoe: false },
      { id: 'sim_fire_breath', name: 'Sacred Fire Breath', nameRu: 'Дыхание Священного Огня', damage: 5000, cooldown: 20, range: 25, aoe: true, aoeRadius: 8 },
      { id: 'sim_storm', name: 'Celestial Storm', nameRu: 'Небесная Буря', damage: 2000, cooldown: 60, range: 40, aoe: true, aoeRadius: 40 },
    ],
    lootTable: [
      { itemId: 'wpn_ismail_artifact', chance: 0.001, minQty: 1, maxQty: 1 },
      { itemId: 'mat_dragon_scale', chance: 0.5, minQty: 3, maxQty: 10 },
      { itemId: 'wpn_shah_blade', chance: 0.02, minQty: 1, maxQty: 1 },
      { itemId: 'acc_silk_road_amulet', chance: 0.05, minQty: 1, maxQty: 1 },
      { itemId: 'con_exp_scroll', chance: 1.0, minQty: 5, maxQty: 10 },
    ],
    region: Region.KHORASAN,
    respawnTime: 604800, // 1 неделя
    description: 'Мифическая птица из персидской мифологии. Требует рейд из 40+ игроков.',
    modelPath: 'models/world_bosses/simurgh.fbx',
  },
  'world_boss_rustam_reborn': {
    id: 'world_boss_rustam_reborn',
    name: 'Rustam the Undying',
    nameRu: 'Рустам Бессмертный',
    type: 'world_boss',
    faction: 'mythical',
    level: 100,
    hp: 10000000,
    mana: 5000,
    strength: 500,
    agility: 300,
    intelligence: 150,
    defense: 350,
    moveSpeed: 5.0,
    attackRange: 8,
    aggroRange: 60,
    expReward: 1000000,
    goldReward: { min: 10000, max: 30000 },
    skills: [
      { id: 'ru_legendary_strike', name: 'Legendary Strike', nameRu: 'Легендарный Удар', damage: 8000, cooldown: 5, range: 8, aoe: false },
      { id: 'ru_earthquake', name: 'Earthquake', nameRu: 'Землетрясение', damage: 4000, cooldown: 30, range: 0, aoe: true, aoeRadius: 50, effect: 'stun', effectDuration: 5 },
      { id: 'ru_resurrection', name: 'Resurrection', nameRu: 'Воскрешение', damage: -2000000, cooldown: 300, range: 0, aoe: false },
    ],
    lootTable: [
      { itemId: 'wpn_ismail_artifact', chance: 0.005, minQty: 1, maxQty: 1 },
      { itemId: 'mat_dragon_scale', chance: 1.0, minQty: 5, maxQty: 20 },
      { itemId: 'wpn_shah_blade', chance: 0.05, minQty: 1, maxQty: 1 },
      { itemId: 'con_exp_scroll', chance: 1.0, minQty: 10, maxQty: 20 },
    ],
    region: Region.PERSIAN_GULF,
    respawnTime: 1209600, // 2 недели
    description: 'Древний герой шахнаме, возрождённый тёмными силами. Требует 100+ игроков.',
    modelPath: 'models/world_bosses/rustam_undying.fbx',
  },

  // ── ПОГОДНЫЕ ДУХИ (спавнятся только в соответствующую погоду,
  //    см. WorldTimeSystem.WEATHER_EFFECTS.specialMobs) ───────────
  'mob_rain_spirit': {
    id: 'mob_rain_spirit',
    name: 'Rain Spirit',
    nameRu: 'Дух Дождя',
    type: 'normal',
    faction: 'mythical',
    level: 15,
    hp: 900,
    mana: 300,
    strength: 10,
    agility: 25,
    intelligence: 30,
    defense: 12,
    moveSpeed: 5.5,
    attackRange: 12,
    aggroRange: 14,
    expReward: 180,
    goldReward: { min: 8, max: 25 },
    skills: [
      { id: 'rain_water_bolt', name: 'Water Bolt', nameRu: 'Водяная Стрела', damage: 90, cooldown: 3, range: 12, aoe: false },
      { id: 'rain_veil', name: 'Rain Veil', nameRu: 'Дождевая Завеса', damage: 40, cooldown: 10, range: 6, aoe: true, aoeRadius: 5, effect: 'slow', effectDuration: 3 },
    ],
    lootTable: [
      { itemId: 'con_mana_potion', chance: 0.4, minQty: 1, maxQty: 2 },
      { itemId: 'mat_silk', chance: 0.2, minQty: 1, maxQty: 3 },
    ],
    region: Region.TABRIZ,
    respawnTime: 600,
    description: 'Полупрозрачный дух, материализующийся под дождём. Умывает путников и ворует их ману.',
    modelPath: 'models/monsters/weather/rain_spirit.fbx',
  },
  'mob_storm_djinn': {
    id: 'mob_storm_djinn',
    name: 'Storm Djinn',
    nameRu: 'Джинн Бури',
    type: 'elite',
    faction: 'mythical',
    level: 35,
    hp: 4500,
    mana: 1200,
    strength: 30,
    agility: 40,
    intelligence: 60,
    defense: 35,
    moveSpeed: 6.5,
    attackRange: 15,
    aggroRange: 20,
    expReward: 900,
    goldReward: { min: 40, max: 120 },
    skills: [
      { id: 'storm_lightning', name: 'Chain Lightning', nameRu: 'Цепная Молния', damage: 320, cooldown: 6, range: 15, aoe: false },
      { id: 'storm_gust', name: 'Cyclone Gust', nameRu: 'Смерч', damage: 180, cooldown: 14, range: 8, aoe: true, aoeRadius: 7, effect: 'stun', effectDuration: 2 },
    ],
    lootTable: [
      { itemId: 'con_mana_potion', chance: 0.6, minQty: 1, maxQty: 3 },
      { itemId: 'mat_turquoise', chance: 0.15, minQty: 1, maxQty: 2 },
      { itemId: 'acc_turquoise_ring', chance: 0.02, minQty: 1, maxQty: 1 },
    ],
    region: Region.CAUCASUS,
    respawnTime: 1800,
    description: 'Грозовой джинн, являющийся лишь в разгар бури. Каждая его молния слышна на милю вокруг.',
    modelPath: 'models/monsters/weather/storm_djinn.fbx',
  },
  'mob_sand_div': {
    id: 'mob_sand_div',
    name: 'Sand Div',
    nameRu: 'Песчаный Див',
    type: 'elite',
    faction: 'mythical',
    level: 55,
    hp: 12000,
    mana: 400,
    strength: 90,
    agility: 35,
    intelligence: 20,
    defense: 70,
    moveSpeed: 4.0,
    attackRange: 4,
    aggroRange: 18,
    expReward: 1600,
    goldReward: { min: 80, max: 220 },
    skills: [
      { id: 'sand_sweep', name: 'Sand Sweep', nameRu: 'Песчаный Взмах', damage: 380, cooldown: 5, range: 4, aoe: true, aoeRadius: 4 },
      { id: 'sand_burial', name: 'Sand Burial', nameRu: 'Погребение в Песке', damage: 450, cooldown: 18, range: 10, aoe: false, effect: 'slow', effectDuration: 5 },
    ],
    lootTable: [
      { itemId: 'con_health_potion_m', chance: 0.6, minQty: 1, maxQty: 3 },
      { itemId: 'mat_saffron', chance: 0.25, minQty: 1, maxQty: 3 },
      { itemId: 'mat_dragon_scale', chance: 0.03, minQty: 1, maxQty: 1 },
    ],
    region: Region.MESOPOTAMIA,
    respawnTime: 2700,
    description: 'Див, чьё тело — спрессованная песчаная буря. Пробуждается, когда пустыня встаёт стеной.',
    modelPath: 'models/monsters/weather/sand_div.fbx',
  },
  'mob_fog_assassin': {
    id: 'mob_fog_assassin',
    name: 'Fog Assassin',
    nameRu: 'Туманный Убийца',
    type: 'elite',
    faction: 'neutral',
    level: 45,
    hp: 6000,
    mana: 500,
    strength: 70,
    agility: 95,
    intelligence: 30,
    defense: 30,
    moveSpeed: 7.0,
    attackRange: 2.5,
    aggroRange: 12,
    expReward: 1300,
    goldReward: { min: 60, max: 180 },
    skills: [
      { id: 'fog_backstab', name: 'Shadow Backstab', nameRu: 'Удар из Тумана', damage: 400, cooldown: 4, range: 2.5, aoe: false },
      { id: 'fog_smoke', name: 'Vanishing Mist', nameRu: 'Исчезающий Туман', damage: 0, cooldown: 25, range: 0, aoe: false, effect: 'slow', effectDuration: 4 },
    ],
    lootTable: [
      { itemId: 'con_health_potion_m', chance: 0.5, minQty: 1, maxQty: 2 },
      { itemId: 'wpn_persian_composite_bow', chance: 0.02, minQty: 1, maxQty: 1 },
      { itemId: 'acc_turquoise_ring', chance: 0.05, minQty: 1, maxQty: 1 },
    ],
    region: Region.SHIRAZ,
    respawnTime: 1800,
    description: 'Никто не видел его лица: в тумане он рождается, в тумане и исчезает. Охотится на зазевавшихся торговцев.',
    modelPath: 'models/monsters/weather/fog_assassin.fbx',
  },

  // ── БОССЫ ДАНЖЕЙ ──────────────────────────────────────────────
  'boss_div_arzhang': {
    id: 'boss_div_arzhang',
    name: 'Arzhang, King of Divs',
    nameRu: 'Аржанг, Царь Дивов',
    type: 'boss',
    faction: 'mythical',
    level: 80,
    hp: 3500000,
    mana: 8000,
    strength: 320,
    agility: 140,
    intelligence: 200,
    defense: 260,
    moveSpeed: 4.5,
    attackRange: 10,
    aggroRange: 30,
    expReward: 120000,
    goldReward: { min: 2000, max: 6000 },
    skills: [
      { id: 'arz_inferno', name: 'Infernal Deluge', nameRu: 'Инфернальный Потоп', damage: 2200, cooldown: 8, range: 12, aoe: true, aoeRadius: 8 },
      { id: 'arz_chains', name: 'Chains of Arzhang', nameRu: 'Цепи Аржанга', damage: 1500, cooldown: 20, range: 20, aoe: false, effect: 'stun', effectDuration: 4 },
      { id: 'arz_shadow_legion', name: 'Call the Legion', nameRu: 'Зов Легиона', damage: 0, cooldown: 60, range: 0, aoe: false },
      { id: 'arz_doom_gaze', name: 'Doom Gaze', nameRu: 'Взгляд Рока', damage: 3000, cooldown: 35, range: 25, aoe: true, aoeRadius: 10, effect: 'fear', effectDuration: 5 },
    ],
    lootTable: [
      { itemId: 'wpn_ismail_artifact', chance: 0.002, minQty: 1, maxQty: 1 },
      { itemId: 'wpn_shah_blade', chance: 0.03, minQty: 1, maxQty: 1 },
      { itemId: 'arm_qizilbash_armor', chance: 0.06, minQty: 1, maxQty: 1 },
      { itemId: 'mat_dragon_scale', chance: 0.5, minQty: 2, maxQty: 6 },
      { itemId: 'con_exp_scroll', chance: 1.0, minQty: 3, maxQty: 8 },
    ],
    region: Region.KHORASAN,
    respawnTime: 604800,
    description: 'Царь огненных дивов Хорасана, повелитель пещер вечного пламени. Финальный босс пещер Хорасана.',
    modelPath: 'models/dungeon_bosses/div_arzhang.fbx',
  },

  // ── ДОПОЛНИТЕЛЬНЫЕ МОНСТРЫ ──────────────────────────────────

  // Тебриз — регион 1-20
  'mob_desert_scorpion': {
    id: 'mob_desert_scorpion',
    name: 'Desert Scorpion',
    nameRu: 'Пустынный Скорпион',
    type: 'normal',
    faction: 'neutral',
    level: 3,
    hp: 120, mana: 0,
    strength: 8, agility: 14, intelligence: 0,
    defense: 3, moveSpeed: 3.5, attackRange: 1.5, aggroRange: 8,
    expReward: 40, goldReward: { min: 5, max: 15 },
    skills: [],
    lootTable: [
      { itemId: 'mat_iron_ore', chance: 0.3, minQty: 1, maxQty: 2 },
    ],
    region: Region.TABRIZ,
    respawnTime: 30,
    description: 'Ядовитый скорпион, прячущийся под камнями.',
    modelPath: 'models/mobs/scorpion.fbx',
  },
  'mob_road_bandit': {
    id: 'mob_road_bandit',
    name: 'Road Bandit',
    nameRu: 'Разбойник с Большой Дороги',
    type: 'normal',
    faction: 'bandit',
    level: 8,
    hp: 280, mana: 0,
    strength: 18, agility: 12, intelligence: 0,
    defense: 8, moveSpeed: 3.8, attackRange: 2, aggroRange: 12,
    expReward: 90, goldReward: { min: 20, max: 50 },
    skills: [
      { id: 'backstab', name: 'Удар в спину', nameRu: 'Удар в спину', damage: 25, cooldown: 8, range: 2, aoe: false, effect: 'bleed', effectDuration: 3 },
    ],
    lootTable: [
      { itemId: 'wpn_iron_sword', chance: 0.05, minQty: 1, maxQty: 1 },
      { itemId: 'pot_health_small', chance: 0.3, minQty: 1, maxQty: 2 },
    ],
    region: Region.TABRIZ,
    respawnTime: 45,
    description: 'Преступник, грабящий караваны на дорогах Тебриза.',
    modelPath: 'models/mobs/bandit.fbx',
  },
  'mob_wolf': {
    id: 'mob_wolf',
    name: 'Grey Wolf',
    nameRu: 'Серый Волк',
    type: 'normal',
    faction: 'neutral',
    level: 6,
    hp: 200, mana: 0,
    strength: 14, agility: 18, intelligence: 0,
    defense: 5, moveSpeed: 5.0, attackRange: 1.5, aggroRange: 15,
    expReward: 70, goldReward: { min: 10, max: 30 },
    skills: [],
    lootTable: [
      { itemId: 'mat_iron_ore', chance: 0.1, minQty: 1, maxQty: 1 },
    ],
    region: Region.TABRIZ,
    respawnTime: 30,
    description: 'Серый волк, бродящий по горам к северу от Тебриза.',
    modelPath: 'models/mobs/wolf.fbx',
  },

  // Исфахан — регион 20-40
  'mob_assassin_acolyte': {
    id: 'mob_assassin_acolyte',
    name: 'Assassin Acolyte',
    nameRu: 'Послушник Ассасинов',
    type: 'normal',
    faction: 'bandit',
    level: 22,
    hp: 550, mana: 120,
    strength: 25, agility: 30, intelligence: 15,
    defense: 14, moveSpeed: 4.2, attackRange: 2, aggroRange: 14,
    expReward: 280, goldReward: { min: 40, max: 100 },
    skills: [
      { id: 'poison_dagger', name: 'Poison Dagger', nameRu: 'Отравленный Кинжал', damage: 35, cooldown: 6, range: 2, aoe: false, effect: 'poison', effectDuration: 5 },
      { id: 'smoke_bomb', name: 'Smoke Bomb', nameRu: 'Дымовая Бомба', damage: 0, cooldown: 15, range: 0, aoe: true, aoeRadius: 5 },
    ],
    lootTable: [
      { itemId: 'mat_silk_thread', chance: 0.2, minQty: 1, maxQty: 3 },
      { itemId: 'acc_boots_silk', chance: 0.03, minQty: 1, maxQty: 1 },
    ],
    region: Region.ISFAHAN,
    respawnTime: 60,
    description: 'Послушник тайного ордена ассасинов, охраняющий подземелья Исфахана.',
    modelPath: 'models/mobs/assassin_acolyte.fbx',
  },
  'mob_sand_elemental': {
    id: 'mob_sand_elemental',
    name: 'Sand Elemental',
    nameRu: 'Песчанный Элементаль',
    type: 'elite',
    faction: 'neutral',
    level: 30,
    hp: 1200, mana: 200,
    strength: 35, agility: 15, intelligence: 30,
    defense: 22, moveSpeed: 2.8, attackRange: 3, aggroRange: 16,
    expReward: 600, goldReward: { min: 80, max: 200 },
    skills: [
      { id: 'sand_blast', name: 'Sand Blast', nameRu: 'Песчаный Взрыв', damage: 50, cooldown: 10, range: 12, aoe: true, aoeRadius: 6, effect: 'slow', effectDuration: 3 },
    ],
    lootTable: [
      { itemId: 'mat_iron_ore', chance: 0.4, minQty: 2, maxQty: 5 },
      { itemId: 'mat_dragon_scale', chance: 0.02, minQty: 1, maxQty: 1 },
    ],
    region: Region.ISFAHAN,
    respawnTime: 120,
    description: 'Древнее дух пустыни, сотканный из песка и ярости.',
    modelPath: 'models/mobs/sand_elemental.fbx',
  },

  // Шираз — регион 40-60
  'mob_undead_guardian': {
    id: 'mob_undead_guardian',
    name: 'Undead Guardian',
    nameRu: 'Неживой Страж',
    type: 'elite',
    faction: 'undead',
    level: 45,
    hp: 2200, mana: 300,
    strength: 50, agility: 20, intelligence: 40,
    defense: 35, moveSpeed: 2.5, attackRange: 2.5, aggroRange: 18,
    expReward: 1500, goldReward: { min: 150, max: 400 },
    skills: [
      { id: 'death_coil', name: 'Death Coil', nameRu: 'Вихрь Смерти', damage: 70, cooldown: 8, range: 10, aoe: false },
      { id: 'summon_skeletons', name: 'Summon Skeletons', nameRu: 'Призыв Скелетов', damage: 0, cooldown: 30, range: 0, aoe: true, aoeRadius: 8 },
    ],
    lootTable: [
      { itemId: 'mat_dragon_scale', chance: 0.15, minQty: 1, maxQty: 2 },
      { itemId: 'arm_silk_robe', chance: 0.05, minQty: 1, maxQty: 1 },
    ],
    region: Region.SHIRAZ,
    respawnTime: 180,
    description: 'Древний страж гробниц Шираза, несущий вечную службу.',
    modelPath: 'models/mobs/undead_guardian.fbx',
  },
};

export function getMonster(id: string): MonsterDefinition | undefined {
  return MONSTERS_DATABASE[id];
}

export function getMonstersByRegion(region: Region): MonsterDefinition[] {
  return Object.values(MONSTERS_DATABASE).filter(m => m.region === region);
}

export function getWorldBosses(): MonsterDefinition[] {
  return Object.values(MONSTERS_DATABASE).filter(m => m.type === 'world_boss');
}

export function getDungeonBosses(): MonsterDefinition[] {
  return Object.values(MONSTERS_DATABASE).filter(m => m.type === 'boss');
}
