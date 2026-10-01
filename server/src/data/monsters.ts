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
  /**
   * Подводное существо: живёт и охотится только в глубокой воде.
   * Игнорирует тех, кто на суше или в лодке, и не вылезает на берег.
   */
  aquatic?: boolean;
  /**
   * Насколько тело торчит над водой (метры). Клиент рисует подводное
   * существо на поверхности, а не под ней — иначе его не видно и не в
   * кого бить. Задаётся здесь, а не на клиенте: список существ
   * меняется, а список на клиенте легко забыть обновить.
   */
  aquaticSize?: number;
  description: string;
  /**
   * Путь к 3D-модели. НЕ ЧИТАЕТСЯ НИГДЕ.
   *
   * ЧТО ЭТО ТАКОЕ. Клиент не грузит модели: он собирает тела процедурно по
   * monsterId в client/src/app/game3d/rig.ts. Поле указывало на .fbx, которых
   * в репозитории нет, и выглядело как описание внешности монстра.
   *
   * ПОЧЕМУ НЕ УДАЛЕНО, А ПРОСТО НЕОБЯЗАТЕЛЬНОЕ. Удалять 24 строки данных -
   * решение владельца; проверка monsterRigCoverage.test.ts следит, чтобы
   * поле не начали читать (клиент всё равно не умеет). А новым монстрам
   * писать выдуманный путь нельзя: это была бы новая ложь в данных, и
   * затыкать ею дыру в контенте нельзя.
   */
  modelPath?: string;
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
    region: Region.ISFAHAN,
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
      { itemId: 'trophy_road_bandit_token', chance: 0.4, minQty: 1, maxQty: 2 },
    ],
    region: Region.ISFAHAN,
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
      { itemId: 'qst_royal_seal', chance: 1.0, minQty: 1, maxQty: 1 },
    ],
    region: Region.SHIRAZ,
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
      { itemId: 'trophy_mongol_raider_banner', chance: 0.18, minQty: 1, maxQty: 1 },
    ],
    region: Region.CAUCASUS,
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
      { itemId: 'trophy_fire_div_ember', chance: 0.1, minQty: 1, maxQty: 1 },
    ],
    region: Region.MESOPOTAMIA,
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
      { itemId: 'trophy_rain_spirit_drop', chance: 0.7, minQty: 1, maxQty: 1 },
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
      { itemId: 'trophy_storm_djinn_lamp', chance: 0.35, minQty: 1, maxQty: 1 },
    ],
    region: Region.SHIRAZ,
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
      { itemId: 'trophy_sand_div_horn', chance: 0.15, minQty: 1, maxQty: 1 },
    ],
    region: Region.CAUCASUS,
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
      { itemId: 'trophy_fog_assassin_scarf', chance: 0.3, minQty: 1, maxQty: 1 },
      { itemId: 'qst_hafiz_scroll', chance: 0.6, minQty: 1, maxQty: 1 },
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
      { itemId: 'trophy_scorpion_carapace', chance: 0.6, minQty: 1, maxQty: 1 },
    ],
    region: Region.ISFAHAN,
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
      { itemId: 'trophy_road_bandit_token', chance: 0.55, minQty: 1, maxQty: 1 },
    ],
    region: Region.ISFAHAN,
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
      { itemId: 'trophy_wolf_pelt', chance: 1.0, minQty: 1, maxQty: 2 },
      { itemId: 'trophy_wolf_fang', chance: 0.25, minQty: 1, maxQty: 1 },
    ],
    region: Region.ISFAHAN,
    respawnTime: 30,
    description: 'Серый волк, бродящий по горам к северу от Тебриза.',
    modelPath: 'models/mobs/wolf.fbx',
  },

  // ── ПОДВОДНЫЕ СУЩЕСТВА (озеро у Тебриза) ────────────────────
  // Раньше озеро было мёртвой зоной: максимум — переплыть его и
  // выйти на другой берег. Теперь там есть кто охотится, причём
  // только на того, кто в воде. Стоящий на берегу для них невидим,
  // а уехавший на лодке — в безопасности: лодка стала защитой,
  // а не просто ускорением.
  'mob_lake_piranha': {
    id: 'mob_lake_piranha',
    name: 'Lake Piranha',
    nameRu: 'Пиранья Озера',
    type: 'normal',
    faction: 'neutral',
    level: 10,
    hp: 260, mana: 0,
    strength: 16, agility: 24, intelligence: 2,
    defense: 6, moveSpeed: 5.4, attackRange: 1.6, aggroRange: 13,
    expReward: 110, goldReward: { min: 14, max: 38 },
    skills: [
      { id: 'piranha_tear', name: 'Frenzy Bite', nameRu: 'Кусательный Прозы', damage: 22, cooldown: 3, range: 1.6, aoe: false, effect: 'bleed', effectDuration: 5 },
    ],
    lootTable: [
      { itemId: 'trophy_piranha_fin', chance: 0.6, minQty: 1, maxQty: 2 },
      { itemId: 'fish_crucian', chance: 0.35, minQty: 1, maxQty: 1 },
    ],
    region: Region.TABRIZ,
    respawnTime: 40,
    aquatic: true,
    aquaticSize: 0.15,
    description: 'Мелкая стая, держится у берега. Один не страшен — стая тянет на дно.',
    modelPath: 'models/mobs/piranha.fbx',
  },
  'mob_lake_sturgeon_horror': {
    id: 'mob_lake_sturgeon_horror',
    name: 'Gulper Sturgeon',
    nameRu: 'Сом-Громила',
    type: 'normal',
    faction: 'neutral',
    level: 16,
    hp: 620, mana: 0,
    strength: 26, agility: 12, intelligence: 3,
    defense: 14, moveSpeed: 3.6, attackRange: 2, aggroRange: 15,
    expReward: 240, goldReward: { min: 30, max: 75 },
    skills: [
      { id: 'sturgeon_maul', name: 'Tail Slam', nameRu: 'Хвост-Удар', damage: 38, cooldown: 5, range: 2.4, aoe: true, aoeRadius: 3.5 },
    ],
    lootTable: [
      { itemId: 'trophy_sturgeon_bladder', chance: 0.55, minQty: 1, maxQty: 1 },
      { itemId: 'fish_sturgeon', chance: 0.4, minQty: 1, maxQty: 1 },
    ],
    region: Region.TABRIZ,
    respawnTime: 75,
    aquatic: true,
    aquaticSize: 0.55,
    description: 'Толстый, слепой, размером с лодку. Бьёт хвостом — сбивает с ног.',
    modelPath: 'models/mobs/wolf.fbx',
  },
  'mob_lake_ghost_fish': {
    id: 'mob_lake_ghost_fish',
    name: 'Ghost Fish of the Lake',
    nameRu: 'Призрачная Рыба',
    type: 'elite',
    faction: 'mythical',
    level: 24,
    hp: 900, mana: 260,
    strength: 30, agility: 30, intelligence: 18,
    defense: 18, moveSpeed: 5.0, attackRange: 2.2, aggroRange: 18,
    expReward: 520, goldReward: { min: 80, max: 180 },
    skills: [
      { id: 'ghost_chill', name: 'Chilling Glance', nameRu: 'Холодный Взгляд', damage: 34, cooldown: 6, range: 8, aoe: false, effect: 'slow', effectDuration: 5 },
      { id: 'ghost_rush', name: 'Undertow Rush', nameRu: 'Течение Наносит Удар', damage: 46, cooldown: 8, range: 2.2, aoe: false },
    ],
    lootTable: [
      { itemId: 'trophy_ghost_fish_lure', chance: 0.4, minQty: 1, maxQty: 1 },
      { itemId: 'trophy_ghost_fish_scale', chance: 0.7, minQty: 1, maxQty: 3 },
    ],
    region: Region.TABRIZ,
    respawnTime: 150,
    aquatic: true,
    aquaticSize: 0.45,
    description: 'Белая, светится изнутри. Тянет за собой течение — и туда, и обратно.',
    modelPath: 'models/mobs/ghost_fish.fbx',
  },
  'mob_lake_leviathan': {
    id: 'mob_lake_leviathan',
    name: 'Leviathan of Tabriz',
    nameRu: 'Левиафан Тебриза',
    type: 'boss',
    faction: 'mythical',
    level: 30,
    hp: 3200, mana: 500,
    strength: 42, agility: 26, intelligence: 24,
    defense: 26, moveSpeed: 4.4, attackRange: 3, aggroRange: 26,
    expReward: 3200, goldReward: { min: 400, max: 900 },
    skills: [
      { id: 'leviathan_maul', name: 'Rending Bite', nameRu: 'Клыкастый Укус', damage: 70, cooldown: 4, range: 3, aoe: false },
      { id: 'leviathan_slam', name: 'Depth Slam', nameRu: 'Удар Глубины', damage: 90, cooldown: 10, range: 5, aoe: true, aoeRadius: 6 },
      { id: 'leviathan_drown', name: 'Drowning Gaze', nameRu: 'Взгляд Топи', damage: 55, cooldown: 14, range: 12, aoe: false, effect: 'fear', effectDuration: 3 },
    ],
    lootTable: [
      { itemId: 'trophy_leviathan_horn', chance: 0.5, minQty: 1, maxQty: 1 },
      // Жемчужина — цель квеста, а босс возрождается раз в 15 минут.
      // При 30% квест превращался бы в лотерей, поэтому ровно с первого
      // убийства: единственный источник, шанс лотереи тут неуместен.
      { itemId: 'trophy_leviathan_pearl', chance: 1.0, minQty: 1, maxQty: 1 },
      { itemId: 'trophy_ghost_fish_scale', chance: 0.8, minQty: 2, maxQty: 5 },
    ],
    region: Region.TABRIZ,
    respawnTime: 900,
    aquatic: true,
    aquaticSize: 0.95,
    description: 'Тот, кого рыбаки зовут «старухой озера». Дышит сорок лет, помнит ещё Кара-Хан.',
    modelPath: 'models/mobs/leviathan.fbx',
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
    region: Region.TABRIZ,
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
      { itemId: 'trophy_sand_elemental_core', chance: 0.5, minQty: 1, maxQty: 1 },
    ],
    region: Region.TABRIZ,
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
      { itemId: 'trophy_undead_reliquary', chance: 0.3, minQty: 1, maxQty: 1 },
    ],
    region: Region.SHIRAZ,
    respawnTime: 180,
    description: 'Древний страж гробниц Шираза, несущий вечную службу.',
    modelPath: 'models/mobs/undead_guardian.fbx',
  },
// ── ХОРАСАН: оазис, 70-80 уровень ────────────────────────────────
  // ЧТО БЫЛО. Зона khorasan_oasis (от 70 уровня) стояла пустой: в базе
  // не было ни одного монстра 70-80 уровня, кроме босса Арзханга. Пустая
  // зона видна игроку прямо - это «мир пустой», а не тонкая настройка.
  //
  // Характеристики взяты по соседям, а не выдуманы: монгол-рейдер
  // 55 уровня имеет 7000 hp и 1500 опыта, огненный див 65 уровня -
  // 12000 hp и 3000 опыта. Отсюда интерполяция для 70-72.
  'mob_caravan_raider': {
    id: 'mob_caravan_raider',
    name: 'Caravan Raider',
    nameRu: 'Караванный Налётчик',
    type: 'elite',
    faction: 'bandit',
    level: 70,
    hp: 14000,
    mana: 400,
    strength: 95,
    agility: 72,
    intelligence: 40,
    defense: 55,
    moveSpeed: 5.2,
    attackRange: 2,
    aggroRange: 16,
    expReward: 3200,
    goldReward: { min: 120, max: 320 },
    skills: [
      { id: 'raider_slash', name: 'Caravan Slash', nameRu: 'Взмах Налётчика', damage: 520, cooldown: 4, range: 2, aoe: false },
      { id: 'raider_sprint', name: 'Ambush Rush', nameRu: 'Засада', damage: 380, cooldown: 12, range: 3, aoe: false },
    ],
    lootTable: [
      { itemId: 'trophy_caravan_raider_seal', chance: 0.08, minQty: 1, maxQty: 1 },
      { itemId: 'mat_turquoise', chance: 0.25, minQty: 1, maxQty: 3 },
      { itemId: 'con_health_potion_m', chance: 0.35, minQty: 1, maxQty: 2 },
    ],
    region: Region.KHORASAN,
    respawnTime: 1200,
    description: 'Грабит караваны между оазисами. Знает тропы лучше, чем местные проводники.',
  },
  'mob_oasis_lynx': {
    id: 'mob_oasis_lynx',
    name: 'Oasis Lynx',
    nameRu: 'Оазисная Рысь',
    type: 'elite',
    faction: 'neutral',
    level: 72,
    hp: 15500,
    mana: 0,
    strength: 112,
    agility: 96,
    intelligence: 60,
    defense: 48,
    moveSpeed: 6.2,
    attackRange: 2,
    aggroRange: 20,
    expReward: 3600,
    goldReward: { min: 90, max: 260 },
    skills: [
      { id: 'lynx_pounce', name: 'Pounce', nameRu: 'Прыжок', damage: 610, cooldown: 6, range: 4, aoe: false },
      { id: 'lynx_rake', name: 'Rake', nameRu: 'Когти', damage: 340, cooldown: 3, range: 2, aoe: false, effect: 'bleed', effectDuration: 8 },
    ],
    lootTable: [
      { itemId: 'trophy_oasis_lynx_pelt', chance: 0.1, minQty: 1, maxQty: 1 },
      { itemId: 'trophy_wolf_pelt', chance: 0.12, minQty: 1, maxQty: 2 },
      { itemId: 'con_stamina_food', chance: 0.3, minQty: 1, maxQty: 2 },
    ],
    region: Region.KHORASAN,
    respawnTime: 1500,
    description: 'Пятнистая хищница, живущая у воды. Охотится на караваны, пока те стоят на водопой.',
  },

  // ── ПЕРСИДСКИЙ ЗАЛИВ: гавань, 80 уровень ──────────────────────────
  // ЧТО БЫЛО. Зона persian_gulf_harbor (от 80 уровня) тоже стояла пустой.
  // ВНИМАНИЕ, ЧТО ВЫБРАНО И ПОЧЕМУ. Монстры здесь наземные, хотя регион
  // называется «Залив»: моря в мире нет. В client/src/app/game3d/terrain.ts
  // вода - это LAKE (-420,-160), пруд и два русла рек. Поставить сюда
  // водное существо нельзя - оно оказалось бы стоять на суше.
  //
  // Зону persian_gulf_waters (от 85) по той же причине наполнить нельзя:
  // ей нужен залив, а залива нет. Она остаётся в списке известных дыр.
  'mob_corsair': {
    id: 'mob_corsair',
    name: 'Corsair',
    nameRu: 'Корсар',
    type: 'elite',
    faction: 'bandit',
    level: 80,
    hp: 20000,
    mana: 500,
    strength: 128,
    agility: 104,
    intelligence: 62,
    defense: 70,
    moveSpeed: 5.6,
    attackRange: 2,
    aggroRange: 18,
    expReward: 5000,
    goldReward: { min: 180, max: 450 },
    skills: [
      { id: 'corsair_cutlass', name: 'Cutlass', nameRu: 'Удар Саблей', damage: 680, cooldown: 3, range: 2, aoe: false },
      { id: 'corsair_flurry', name: 'Boarding Flurry', nameRu: 'Абордажная очередь', damage: 420, cooldown: 10, range: 2, aoe: true, aoeRadius: 3 },
    ],
    lootTable: [
      { itemId: 'trophy_corsair_cutlass', chance: 0.06, minQty: 1, maxQty: 1 },
      { itemId: 'mat_dragon_scale', chance: 0.1, minQty: 1, maxQty: 2 },
      { itemId: 'con_health_potion_m', chance: 0.4, minQty: 1, maxQty: 2 },
    ],
    region: Region.PERSIAN_GULF,
    respawnTime: 1800,
    description: 'Гаванит, ушедший из порта с добычей. Нападает на купцов прямо у причала.',
  },
  'mob_harbor_brute': {
    id: 'mob_harbor_brute',
    name: 'Harbour Brute',
    nameRu: 'Портный Головорез',
    type: 'elite',
    faction: 'bandit',
    level: 80,
    hp: 34000,
    mana: 0,
    strength: 165,
    agility: 44,
    intelligence: 30,
    defense: 95,
    moveSpeed: 4.2,
    attackRange: 3,
    aggroRange: 14,
    expReward: 5600,
    goldReward: { min: 220, max: 520 },
    skills: [
      { id: 'brute_maul', name: 'Maul', nameRu: 'Размах кувалдой', damage: 890, cooldown: 5, range: 3, aoe: true, aoeRadius: 4 },
      { id: 'brute_slam', name: 'Ground Slam', nameRu: 'Удар о землю', damage: 0, cooldown: 18, range: 5, aoe: true, aoeRadius: 8, effect: 'stun', effectDuration: 3 },
    ],
    lootTable: [
      { itemId: 'trophy_harbor_brute_iron', chance: 0.07, minQty: 1, maxQty: 1 },
      { itemId: 'mat_iron_ore', chance: 0.4, minQty: 2, maxQty: 5 },
      { itemId: 'con_exp_scroll', chance: 0.2, minQty: 1, maxQty: 1 },
    ],
    region: Region.PERSIAN_GULF,
    respawnTime: 2100,
    description: 'Списанный матрос, который остался на причале. Держит корабельную арматуру вместо оружия.',
  },
// ── ПЕРСИДСКИЙ ЗАЛИВ: вода, 85-90 уровень ───────────────────────
  // ЧТО БЫЛО. Зона persian_gulf_waters (от 85 уровня) называлась
  // «Персидский залив — воды» и стояла пустой. Причина была не в нехватке
  // монстров: МОРЯ НЕ БЫЛО. В игре вода - это озеро, пруд и две реки,
  // а залив был сушей. Море построено, и теперь зону есть чем наполнить.
  //
  // Подводные, поэтому у всех aquatic: true - ИИ держит их в воде и не
  // бьёт по ним с лодки (AISystem пропускает игрока в лодке).
  'mob_gulf_reef_raider': {
    id: 'mob_gulf_reef_raider',
    name: 'Reef Raider',
    nameRu: 'Рифовый Рейдер',
    type: 'normal',
    faction: 'bandit',
    level: 85,
    hp: 26000,
    mana: 600,
    strength: 135,
    agility: 118,
    intelligence: 58,
    defense: 78,
    moveSpeed: 5.4,
    attackRange: 2.4,
    aggroRange: 20,
    expReward: 5400,
    goldReward: { min: 200, max: 480 },
    skills: [
      { id: 'reef_slash', name: 'Reef Slash', nameRu: 'Взмах у рифа', damage: 720, cooldown: 3, range: 2.4, aoe: false },
      { id: 'reef_drag', name: 'Undertow Drag', nameRu: 'Тянущий вниз поток', damage: 380, cooldown: 11, range: 6, aoe: false, effect: 'slow', effectDuration: 6 },
    ],
    lootTable: [
      { itemId: 'trophy_leviathan_horn', chance: 0.05, minQty: 1, maxQty: 1 },
      { itemId: 'mat_dragon_scale', chance: 0.14, minQty: 1, maxQty: 2 },
      { itemId: 'con_health_potion_m', chance: 0.4, minQty: 1, maxQty: 2 },
    ],
    region: Region.PERSIAN_GULF,
    respawnTime: 900,
    aquatic: true,
    aquaticSize: 0.55,
    description: 'Собирается стаями у рифов и берёт любого, кто спустился к воде. С лодки не достаёт.',
  },
  'mob_gulf_depth_lurker': {
    id: 'mob_gulf_depth_lurker',
    name: 'Depth Lurker',
    nameRu: 'Глубинный Свистун',
    type: 'elite',
    faction: 'mythical',
    level: 88,
    hp: 42000,
    mana: 1400,
    strength: 190,
    agility: 88,
    intelligence: 130,
    defense: 120,
    moveSpeed: 4.2,
    attackRange: 8,
    aggroRange: 24,
    expReward: 9800,
    goldReward: { min: 320, max: 780 },
    skills: [
      { id: 'lurker_pull', name: 'Abyssal Pull', nameRu: 'Тяга бездны', damage: 820, cooldown: 9, range: 12, aoe: false, effect: 'slow', effectDuration: 8 },
      { id: 'lurker_bite', name: 'Crushing Bite', nameRu: 'Сокрушающий укус', damage: 1050, cooldown: 5, range: 2.4, aoe: false },
      { id: 'lurker_roar', name: 'Trench Roar', nameRu: 'Рёв из бездны', damage: 0, cooldown: 22, range: 16, aoe: true, aoeRadius: 14, effect: 'fear', effectDuration: 4 },
    ],
    lootTable: [
      { itemId: 'trophy_leviathan_pearl', chance: 0.06, minQty: 1, maxQty: 1 },
      { itemId: 'trophy_storm_djinn_lamp', chance: 0.05, minQty: 1, maxQty: 1 },
      { itemId: 'con_exp_scroll', chance: 0.22, minQty: 1, maxQty: 1 },
    ],
    region: Region.PERSIAN_GULF,
    respawnTime: 1500,
    aquatic: true,
    aquaticSize: 0.85,
    description: 'Огромная тварь из тёмных вод. Поднимается со дна и утягивает вниз вместе с собой.',
  },
  'mob_gulf_leviathan_cub': {
    id: 'mob_gulf_leviathan_cub',
    name: 'Gulf Leviathan Cub',
    nameRu: 'Детёрыш Заливного Левиафана',
    type: 'elite',
    faction: 'neutral',
    level: 90,
    hp: 58000,
    mana: 900,
    strength: 235,
    agility: 104,
    intelligence: 80,
    defense: 145,
    moveSpeed: 5.0,
    attackRange: 3,
    aggroRange: 22,
    expReward: 12000,
    goldReward: { min: 420, max: 900 },
    skills: [
      { id: 'cub_breach', name: 'Breach', nameRu: 'Выход из воды', damage: 1180, cooldown: 8, range: 5, aoe: true, aoeRadius: 6 },
      { id: 'cub_bite', name: 'Cub Bite', nameRu: 'Укус', damage: 890, cooldown: 4, range: 3, aoe: false },
    ],
    lootTable: [
      { itemId: 'trophy_leviathan_horn', chance: 0.09, minQty: 1, maxQty: 1 },
      { itemId: 'trophy_leviathan_pearl', chance: 0.05, minQty: 1, maxQty: 1 },
      { itemId: 'mat_dragon_scale', chance: 0.2, minQty: 1, maxQty: 3 },
    ],
    region: Region.PERSIAN_GULF,
    respawnTime: 2400,
    aquatic: true,
    aquaticSize: 1.15,
    description: 'Молодой левиафан. Выпрыгивает из воды и бьёт всем, кто стоял слишком близко к кромке.',
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
