import { Region, CharacterClass } from '../types/game.types';

// ============================================================
// База данных данжей — Empire of Safavids
// ============================================================

export type DungeonDifficulty = 'normal' | 'hard' | 'heroic' | 'mythic';

export interface DungeonRoom {
  id: string;
  name: string;
  nameRu: string;
  monsters: { monsterId: string; count: number; positions: { x: number; y: number; z: number }[] }[];
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
  timeLimit: number; // минуты
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
    minLevel: 5,
    maxLevel: 25,
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
        treasureChests: 2,
      },
      {
        id: 'room_throne',
        name: 'Rustam\'s Throne Room',
        nameRu: 'Тронный Зал Рустама',
        monsters: [
          { monsterId: 'mob_bandit_warrior', count: 4, positions: [{ x: 10, y: 0, z: 5 }, { x: -10, y: 0, z: 5 }, { x: 10, y: 0, z: -5 }, { x: -10, y: 0, z: -5 }] },
        ],
        isBossRoom: true,
        bossId: 'boss_bandit_king',
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
    minLevel: 25,
    maxLevel: 50,
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
        treasureChests: 2,
      },
      {
        id: 'room_throne_isfahan',
        name: 'Throne Room',
        nameRu: 'Тронный Зал',
        monsters: [{ monsterId: 'mob_ottoman_janissary', count: 8, positions: [{ x: 10, y: 0, z: 5 }, { x: -10, y: 0, z: 5 }, { x: 0, y: 0, z: 15 }, { x: 15, y: 0, z: 10 }, { x: -15, y: 0, z: 10 }, { x: 0, y: 0, z: 25 }, { x: 20, y: 0, z: 20 }, { x: -20, y: 0, z: 20 }] }],
        isBossRoom: true,
        bossId: 'boss_ottoman_pasha',
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
        treasureChests: 2,
      },
      {
        id: 'room_fire_chamber',
        name: 'Chamber of Eternal Fire',
        nameRu: 'Зал Вечного Огня',
        monsters: [{ monsterId: 'mob_div_fire', count: 6, positions: [{ x: 10, y: 0, z: 5 }, { x: -10, y: 0, z: 5 }, { x: 0, y: 0, z: 15 }, { x: 15, y: 0, z: 20 }, { x: -15, y: 0, z: 20 }, { x: 0, y: 0, z: 30 }] }],
        isBossRoom: true,
        bossId: 'boss_div_arzhang',
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
};

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
