import { Region } from '../types/game.types';

// ============================================================
// База данных данжей — Empire of Safavids
// ============================================================

export type DungeonDifficulty = 'normal' | 'hard' | 'heroic' | 'mythic';

export interface DungeonRoom {
  id: string;
  name: string;
  nameRu: string;
  monsters: { monsterId: string; count: number; positions: { x: number; y: number; z: number }[] }[];
  /**
   * Координаты сундуков комнаты в её локальной системе.
   *
   * Появляются вместе с механикой сундуков: пока поля не было, сундуки
   * были нарисованы в геометрии, но в игре их не существовало — сервер не
   * читал treasureChests нигде. Теперь у комнаты есть и количество, и
   * координаты, и сервер заводит их в заход при спавне.
   */
  chestPositions?: { x: number; z: number }[];
  isBossRoom: boolean;
  bossId?: string;
  treasureChests: number;
}

export interface DungeonDefinition {
  id: string;
  name: string;
  nameRu: string;
  description: string;
  region: Region;
  minLevel: number;
  maxLevel: number;
  minPlayers: number;
  maxPlayers: number;
  difficulties: DungeonDifficulty[];
  rooms: DungeonRoom[];
  /**
   * Точка входа в подземелье в МИРОВЫХ координатах.
   *
   * Позиции комнат локальные: без этого поля спавн шёл в (8, 0, 5), то
   * есть в начало координат — в центр города. Монстры подземелья
   * появлялись на главной площади при входе в данж.
   */
  entryX: number;
  entryZ: number;
  /**
   * Ключ интерьера, в котором подземелье живёт.
   *
   * Стоит рядом с entryX/entryZ не для красоты: у гробницы интерьер уже был
   * построен (слот 16, комната 4704), а точка входа указывала на 4968 — комнату,
   * которой нет. Монстры появлялись в пустом кармане за 264 единицы от
   * гробницы, и заход нельзя было пройти. Сверять надо не «вход в кармане», а
   * «вход совпадает с комнатой СВОЕГО интерьера», и поле делает сверку
   * возможной без таблицы в проверке.
   */
  interiorId: string;
  timeLimit: number; // минуты
  /**
   * Свой дневной лимит входа. Не задано — берётся общий
   * DUNGEON_ATTEMPTS_PER_DAY из DungeonService.
   *
   * Исключение живёт здесь, а не в сервисе: сервис не должен знать про
   * гробницу лично, иначе второе исключение превратит его в список.
   */
  attemptsPerDay?: number;
  rewards: {
    experience: number;
    gold: { min: number; max: number };
    guaranteedItems: string[];
    bonusItems: { itemId: string; chance: number }[];
  };
  lore: string;
  mapPath: string;
}

export const DUNGEONS_DATABASE: Record<string, DungeonDefinition> = {

  'dungeon_tabriz_catacombs': {
    id: 'dungeon_tabriz_catacombs',
    name: 'Catacombs of Tabriz',
    nameRu: 'Катакомбы Тебриза',
    description: 'Древние подземные туннели под городом. Здесь скрываются разбойники и нежить.',
    region: Region.TABRIZ,
    // Точка входа: монстры появятся здесь плюс локальные позиции комнат.
    entryX: 4792,
    entryZ: 4000,
    interiorId: 'catacombs',
    minLevel: 5,
    // Было 5–25. Расширение, а не урезание: выше двадцатого в катакомбах
    // всё равно нет ничего, а полоса 26–29 закрывается кавказским данжем
    maxLevel: 30,
    minPlayers: 1,
    maxPlayers: 5,
    difficulties: ['normal', 'hard'],
    timeLimit: 45,
    rooms: [
      {
        id: 'room_entrance',
        name: 'Entrance Hall',
        nameRu: 'Входный Зал',
        monsters: [{ monsterId: 'mob_bandit_scout', count: 4, positions: [{ x: 10, y: 0, z: 5 }, { x: -10, y: 0, z: 5 }, { x: 0, y: 0, z: 15 }, { x: 5, y: 0, z: 20 }] }],
        isBossRoom: false,
        chestPositions: [{ x: -4.6, z: 12.4 }],
        treasureChests: 1,
      },
      {
        id: 'room_barracks',
        name: 'Bandit Barracks',
        nameRu: 'Казармы Разбойников',
        monsters: [
          { monsterId: 'mob_bandit_scout', count: 3, positions: [{ x: 5, y: 0, z: 5 }, { x: -5, y: 0, z: 5 }, { x: 0, y: 0, z: 10 }] },
          { monsterId: 'mob_bandit_warrior', count: 2, positions: [{ x: 8, y: 0, z: 15 }, { x: -8, y: 0, z: 15 }] },
        ],
        isBossRoom: false,
        chestPositions: [{ x: 3.2, z: 7.6 }, { x: -3.2, z: 2.6 }],
        treasureChests: 2,
      },
      {
        id: 'room_throne',
        name: 'Rustam\'s Throne Room',
        nameRu: 'Тронный Зал Рустама',
        monsters: [
          // Раньше босса здесь не было, поэтому он не появлялся и не
          // засчитывался: комната заканчивалась мусором, а не боем
          { monsterId: 'boss_bandit_king', count: 1, positions: [{ x: 0, y: 0, z: 0 }] },
          { monsterId: 'mob_bandit_warrior', count: 4, positions: [{ x: 10, y: 0, z: 5 }, { x: -10, y: 0, z: 5 }, { x: 10, y: 0, z: -5 }, { x: -10, y: 0, z: -5 }] },
        ],
        isBossRoom: true,
        bossId: 'boss_bandit_king',
        chestPositions: [{ x: -6.4, z: -11.4 }, { x: 6.4, z: -11.4 }, { x: 0, z: -6.4 }],
        treasureChests: 3,
      },
    ],
    rewards: {
      experience: 5000,
      gold: { min: 100, max: 300 },
      guaranteedItems: ['con_health_potion_m'],
      bonusItems: [
        { itemId: 'wpn_qizilbash_saber', chance: 0.1 },
        { itemId: 'mat_turquoise', chance: 0.4 },
      ],
    },
    lore: 'Древние катакомбы под Тебризом были построены ещё до Сефевидов. Теперь здесь царит Рустам.',
    mapPath: 'maps/dungeons/tabriz_catacombs.umap',
  },

  'dungeon_isfahan_palace': {
    id: 'dungeon_isfahan_palace',
    name: 'Palace of Forty Columns',
    nameRu: 'Дворец Сорока Колонн',
    description: 'Захваченный дворец в Исфахане. Османские шпионы захватили его и устроили здесь свою базу.',
    region: Region.ISFAHAN,
    // Было 25–50, но босс здесь шестидесятого уровня. Пока он не
    // появлялся, обещание «с двадцать пятого» ничего не значило; теперь
    // означало бы, что игрок тридцатого уровня доходит до тронного зала и
    // встанет. Уровни 25–40 закрывает новый кавказский данж.
    // Точка входа: монстры появятся здесь плюс локальные позиции комнат.
    entryX: 4836,
    entryZ: 4000,
    interiorId: 'palace_dungeon',
    minLevel: 40,
    maxLevel: 60,
    minPlayers: 3,
    maxPlayers: 10,
    difficulties: ['normal', 'hard', 'heroic'],
    timeLimit: 60,
    rooms: [
      {
        id: 'room_garden',
        name: 'Palace Garden',
        nameRu: 'Дворцовый Сад',
        monsters: [{ monsterId: 'mob_ottoman_janissary', count: 6, positions: [{ x: 10, y: 0, z: 5 }, { x: -10, y: 0, z: 5 }, { x: 0, y: 0, z: 15 }, { x: 15, y: 0, z: 10 }, { x: -15, y: 0, z: 10 }, { x: 0, y: 0, z: 25 }] }],
        isBossRoom: false,
        chestPositions: [{ x: -4.4, z: 11.4 }, { x: 4.4, z: 11.4 }],
        treasureChests: 2,
      },
      {
        id: 'room_throne_isfahan',
        name: 'Throne Room',
        nameRu: 'Тронный Зал',
        monsters: [
          // Раньше босса здесь не было, поэтому он не появлялся и не
          // засчитывался: комната заканчивалась мусором, а не боем
          { monsterId: 'boss_ottoman_pasha', count: 1, positions: [{ x: 0, y: 0, z: 30 }] },{ monsterId: 'mob_ottoman_janissary', count: 8, positions: [{ x: 10, y: 0, z: 5 }, { x: -10, y: 0, z: 5 }, { x: 0, y: 0, z: 15 }, { x: 15, y: 0, z: 10 }, { x: -15, y: 0, z: 10 }, { x: 0, y: 0, z: 25 }, { x: 20, y: 0, z: 20 }, { x: -20, y: 0, z: 20 }] }],
        isBossRoom: true,
        bossId: 'boss_ottoman_pasha',
        chestPositions: [{ x: -3.6, z: -10.4 }, { x: 3.6, z: -10.4 }, { x: -3.6, z: -15 }, { x: 3.6, z: -15 }, { x: 0, z: -15 }],
        treasureChests: 5,
      },
    ],
    rewards: {
      experience: 30000,
      gold: { min: 500, max: 1500 },
      guaranteedItems: ['con_exp_scroll', 'con_health_potion_m'],
      bonusItems: [
        { itemId: 'wpn_shah_blade', chance: 0.03 },
        { itemId: 'arm_qizilbash_armor', chance: 0.05 },
        { itemId: 'mat_dragon_scale', chance: 0.15 },
      ],
    },
    lore: 'Дворец Сорока Колонн — шедевр исфаханской архитектуры. Теперь здесь хозяйничает Османский везирь.',
    mapPath: 'maps/dungeons/isfahan_palace.umap',
  },

  'dungeon_khorasan_caves': {
    id: 'dungeon_khorasan_caves',
    name: 'Caves of the Fire Divs',
    nameRu: 'Пещеры Огненных Дивов',
    description: 'Глубокие пещеры в горах Хорасана. Здесь обитают демоны из персидской мифологии.',
    region: Region.KHORASAN,
    // Точка входа: монстры появятся здесь плюс локальные позиции комнат.
    entryX: 4880,
    entryZ: 4000,
    interiorId: 'khorasan_caves',
    minLevel: 60,
    maxLevel: 85,
    minPlayers: 5,
    maxPlayers: 20,
    difficulties: ['normal', 'hard', 'heroic', 'mythic'],
    timeLimit: 90,
    rooms: [
      {
        id: 'room_cave_entrance',
        name: 'Cave Entrance',
        nameRu: 'Вход в Пещеру',
        monsters: [{ monsterId: 'mob_div_fire', count: 3, positions: [{ x: 10, y: 0, z: 5 }, { x: -10, y: 0, z: 5 }, { x: 0, y: 0, z: 15 }] }],
        isBossRoom: false,
        chestPositions: [{ x: -7.4, z: 12.4 }, { x: 8.4, z: 6.4 }],
        treasureChests: 2,
      },
      {
        id: 'room_fire_chamber',
        name: 'Chamber of Eternal Fire',
        nameRu: 'Зал Вечного Огня',
        monsters: [
          // Раньше босса здесь не было, поэтому он не появлялся и не
          // засчитывался: комната заканчивалась мусором, а не боем
          { monsterId: 'boss_div_arzhang', count: 1, positions: [{ x: 0, y: 0, z: 40 }] },{ monsterId: 'mob_div_fire', count: 6, positions: [{ x: 10, y: 0, z: 5 }, { x: -10, y: 0, z: 5 }, { x: 0, y: 0, z: 15 }, { x: 15, y: 0, z: 20 }, { x: -15, y: 0, z: 20 }, { x: 0, y: 0, z: 30 }] }],
        isBossRoom: true,
        bossId: 'boss_div_arzhang',
        chestPositions: [{ x: -4.6, z: -2.4 }, { x: 4.6, z: -2.4 }, { x: -7.4, z: -3.4 }, { x: 7.4, z: -3.4 }, { x: -3.6, z: -12.4 }, { x: 3.6, z: -12.4 }],
        treasureChests: 6,
      },
    ],
    rewards: {
      experience: 150000,
      gold: { min: 2000, max: 6000 },
      guaranteedItems: ['mat_dragon_scale', 'con_exp_scroll'],
      bonusItems: [
        { itemId: 'wpn_ismail_artifact', chance: 0.001 },
        { itemId: 'wpn_shah_blade', chance: 0.02 },
        { itemId: 'arm_qizilbash_armor', chance: 0.04 },
      ],
    },
    lore: 'Древние пещеры, где дивы жили ещё до создания мира. Только сильнейшие герои осмелятся войти сюда.',
    mapPath: 'maps/dungeons/khorasan_caves.umap',
  },
  // ── КАВКАЗ: КРЕПОСТЬ НА ПЕРЕВАЛЕ ──────────────────────────────
  // Полоса 30–52 закрывает провал между катакомбами и дворцом. Наполнение -
  // османские янычари (35) и джинны бури (35): другого гарнизона на
  // перевале нет, и выдумывать его ради двух данжей не будем.
  'dungeon_caucasus_fort': {
    id: 'dungeon_caucasus_fort',
    name: 'Fortress at the Pass',
    nameRu: 'Крепость на перевале',
    description: 'Гарнизон Сефевидов ушёл вниз, и перевал заняли янычары. Пока крепость стоит, караваны идут мимо, а с ними и налёты.',
    region: Region.CAUCASUS,
    // Точка входа: монстры появятся здесь плюс локальные позиции комнат.
    entryX: 4924,
    entryZ: 4000,
    interiorId: 'caucasus_fort',
    minLevel: 30,
    maxLevel: 52,
    minPlayers: 3,
    maxPlayers: 8,
    difficulties: ['normal', 'hard', 'heroic'],
    timeLimit: 60,
    rooms: [
      {
        id: 'room_fort_gate',
        name: 'Fort Gate',
        nameRu: 'Ворота крепости',
        monsters: [
          { monsterId: 'mob_bandit_warrior', count: 4, positions: [{ x: 10, y: 0, z: 5 }, { x: -10, y: 0, z: 5 }, { x: 0, y: 0, z: 12 }, { x: 6, y: 0, z: 18 }] },
          { monsterId: 'mob_road_bandit', count: 3, positions: [{ x: -6, y: 0, z: 18 }, { x: 12, y: 0, z: 20 }, { x: -12, y: 0, z: 20 }] },
        ],
        isBossRoom: false,
        chestPositions: [{ x: 0, z: 6.4 }],
        treasureChests: 1,
      },
      {
        id: 'room_fort_wall',
        name: 'Curtain Wall',
        nameRu: 'Стена',
        monsters: [
          { monsterId: 'mob_ottoman_janissary', count: 5, positions: [{ x: 10, y: 0, z: 5 }, { x: -10, y: 0, z: 5 }, { x: 0, y: 0, z: 14 }, { x: 15, y: 0, z: 8 }, { x: -15, y: 0, z: 8 }] },
        ],
        isBossRoom: false,
        chestPositions: [{ x: 8.4, z: -4.4 }, { x: 8.4, z: -8.4 }],
        treasureChests: 2,
      },
      {
        id: 'room_storm_keep',
        name: 'Keep of the Storm',
        nameRu: 'Башня бури',
        monsters: [
          // Джинны бури сидят в башне и держат перевал. Финал данжа - они
          // же, а не рядовой гарнизон: боссовая группа должна быть крупнее
          // всего остального в комнате, иначе «финал» не финал
          { monsterId: 'mob_storm_djinn', count: 2, positions: [{ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 22 }] },
        ],
        isBossRoom: true,
        bossId: 'mob_storm_djinn',
        chestPositions: [{ x: -5.4, z: -13.4 }, { x: 5.4, z: -13.4 }, { x: -5.4, z: -5.6 }, { x: 5.4, z: -5.6 }],
        treasureChests: 4,
      },
    ],
    rewards: {
      experience: 45000,
      gold: { min: 800, max: 2500 },
      guaranteedItems: ['con_health_potion_m', 'con_mana_potion'],
      bonusItems: [
        { itemId: 'acc_turquoise_ring', chance: 0.05 },
        { itemId: 'arm_qizilbash_armor', chance: 0.03 },
        { itemId: 'wpn_qizilbash_saber', chance: 0.02 },
      ],
    },
    lore: 'Крепость построена в одну ночь и с тех пор ни разу не взята штурмом: всякий раз джинны бури сбивали нападавших с перевала.',
    mapPath: 'maps/dungeons/caucasus_fort.umap',
  },

  // ── ШИРАЗ: ГРОБНИЦА ШЕИХА ───────────────────────────────────────
  // Полоса 45–70 закрывает провал между дворцом и пещерами. Сюда же ведёт
  // побочный квест side_010_sheikh_tomb и квест про кладбище, поэтому
  // гробница - не выдумка, а место, о котором игрок уже слышал.
  'dungeon_shiraz_tomb': {
    id: 'dungeon_shiraz_tomb',
    name: "The Sheikh's Tomb",
    nameRu: 'Гробница Шеиха',
    description: 'В горах Шираза открылась гробница, откуда выходят мертвецы. Святилище закрыто снаружи - и медленно перестало закрываться изнутри.',
    region: Region.SHIRAZ,
    // Точка входа: монстры появятся здесь плюс локальные позиции комнат.
    entryX: 4704,
    entryZ: 4000,
    interiorId: 'tomb',
    minLevel: 45,
    maxLevel: 70,
    minPlayers: 3,
    maxPlayers: 8,
    difficulties: ['normal', 'hard', 'heroic', 'mythic'],
    timeLimit: 70,
    // Один вход в сутки: гробницу вскрывают один раз, и три попытки
    // в день превращали бы её в обычный данж.
    attemptsPerDay: 1,
    rooms: [
      {
        id: 'room_tomb_stair',
        name: 'Tomb Stair',
        nameRu: 'Лестница гробницы',
        monsters: [
          { monsterId: 'mob_undead_guardian', count: 3, positions: [{ x: 8, y: 0, z: 5 }, { x: -8, y: 0, z: 5 }, { x: 0, y: 0, z: 14 }] },
        ],
        isBossRoom: false,
        treasureChests: 2,
      },
      {
        id: 'room_tomb_hall',
        name: 'Hall of Sarcophagi',
        nameRu: 'Зал саркофагов',
        monsters: [
          { monsterId: 'mob_undead_guardian', count: 4, positions: [{ x: 10, y: 0, z: 5 }, { x: -10, y: 0, z: 5 }, { x: 10, y: 0, z: 16 }, { x: -10, y: 0, z: 16 }] },
          { monsterId: 'mob_fog_assassin', count: 3, positions: [{ x: 0, y: 0, z: 22 }, { x: 14, y: 0, z: 10 }, { x: -14, y: 0, z: 10 }] },
        ],
        isBossRoom: false,
        treasureChests: 3,
      },
      {
        id: 'room_tomb_sanctum',
        name: 'Sanctum',
        nameRu: 'Святилище',
        monsters: [
          { monsterId: 'mob_fog_assassin', count: 3, positions: [{ x: 0, y: 0, z: 10 }, { x: 10, y: 0, z: 18 }, { x: -10, y: 0, z: 18 }] },
        ],
        isBossRoom: true,
        bossId: 'mob_fog_assassin',
        treasureChests: 5,
      },
    ],
    rewards: {
      experience: 90000,
      gold: { min: 1500, max: 4500 },
      guaranteedItems: ['con_exp_scroll', 'pot_health_medium'],
      bonusItems: [
        { itemId: 'acc_turquoise_ring', chance: 0.04 },
        { itemId: 'acc_amulet_safavid', chance: 0.01 },
        { itemId: 'wpn_shamshir_alamut', chance: 0.02 },
      ],
    },
    lore: 'Шеих похоронен был при мне, и гробница его была завалена камнем. Теперь камня нет, а Шеих ходит.',
    mapPath: 'maps/dungeons/shiraz_tomb.umap',
  },

}

export function getDungeon(id: string): DungeonDefinition | undefined {
  return DUNGEONS_DATABASE[id];
}

export function getDungeonsByRegion(region: Region): DungeonDefinition[] {
  return Object.values(DUNGEONS_DATABASE).filter(d => d.region === region);
}

export function getDungeonsByLevel(level: number): DungeonDefinition[] {
  return Object.values(DUNGEONS_DATABASE).filter(
    d => d.minLevel <= level && d.maxLevel >= level
  );
}
