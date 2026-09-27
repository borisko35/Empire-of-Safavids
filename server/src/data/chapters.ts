// ============================================================
// Главы — Empire of Safavids
// ============================================================
// Сюжет разложен по главам, чтобы игрок видел, где он находится:
// «Пробуждение → Дороги → Шёлковый путь → Север → Пустыня → Залив».
//
// Главы собраны из квестов, которые реально существуют в quests.ts.
// Нумерация сюжетных квестов в базе имеет пропуски (001, 002, потом
// сразу 010) — это не ошибка глав: состав главы задаётся здесь явно,
// и проверка целостности следит, чтобы все указанные квесты существовали.

import { Region } from '../types/game.types';

export interface ChapterDef {
  id: string;
  /** Порядок в списке (1-based) */
  order: number;
  title: string;
  titleRu: string;
  description: string;
  descriptionRu: string;
  region: Region;
  /** Уровень, с которого глава открывается */
  minLevel: number;
  /** Квесты главы в порядке прохождения */
  quests: string[];
  /** Кат-сцены главы (id из cutscenes.ts) */
  cutscenes: string[];
}

export const CHAPTERS: ChapterDef[] = [
  {
    id: 'ch_awakening',
    order: 1,
    title: 'The Awakening',
    titleRu: 'Пробуждение',
    description: 'A summons to Tabriz, and blood on the first road. Everyone starts somewhere.',
    descriptionRu: 'Призыв в Тебриз и кровь на первой дороге. Все начинают с чего-то.',
    region: Region.TABRIZ,
    minLevel: 1,
    quests: ['main_001_awakening', 'main_002_first_blood'],
    cutscenes: ['cut_001_awakening', 'cut_002_first_blood'],
  },
  {
    id: 'ch_roads',
    order: 2,
    title: 'Roads and Robbers',
    titleRu: 'Дороги и разбойники',
    description: 'Before empires, there are roads that need defending. Scorpions, wolves, broken caravans.',
    descriptionRu: 'Прежде чем империи, есть дороги, которые надо защищать. Скорпионы, волки, разбитые караваны.',
    region: Region.TABRIZ,
    minLevel: 2,
    quests: [
      'side_001_scorpion_nest',
      'side_002_wolf_pelts',
      'side_006_broken_caravan',
      'side_007_forest_patrol',
      'side_003_silk_road',
    ],
    cutscenes: [],
  },
  {
    id: 'ch_silk_road',
    order: 3,
    title: 'The Silk Road Conspiracy',
    titleRu: 'Заговор на Шёлковом Пути',
    description: 'Ottoman spies are not stealing silk. They are buying silence, one seal at a time.',
    descriptionRu: 'Османские шпионы не крадут шёлк. Они покупают молчание — по одной печати за раз.',
    region: Region.ISFAHAN,
    // Порог не выше самого низкого квеста главы: иначе игрок берёт
    // квест 15-го уровня, а глава в списке висит закрытой
    minLevel: 15,
    quests: ['side_011_stolen_horses', 'main_030_caucasus_campaign', 'main_010_silk_road'],
    cutscenes: ['cut_010_conspiracy'],
  },
  {
    id: 'ch_desert',
    order: 4,
    title: 'Trial of the Desert',
    titleRu: 'Испытание Пустыни',
    description: 'The Khorasan roads have their own masters, and they are older than the dynasty.',
    descriptionRu: 'У дорог Хорасана есть свои хозяева, и они старше династии.',
    region: Region.MESOPOTAMIA,
    // Порог = минимальный уровень квеста главы (Руины Месопотамии, ур. 18),
    // иначе игрок выполнит этот квест, а глава в списке будет закрытой
    minLevel: 18,
    quests: ['side_004_sand_storm', 'side_012_metro_ruins', 'side_005_graveyard', 'main_040_desert_trial'],
    cutscenes: ['cut_040_desert'],
  },
  {
    id: 'ch_north',
    order: 5,
    title: 'The North and the Gulf',
    titleRu: 'Север и Залив',
    // Название про Кавказ, а в главе ещё и Залив: переименовал под состав,
    // иначе игрок ищет «северную стену» и не находит битву за залив
    description: 'Mongol riders, tower garrisons, a lake nobody fishes twice, and a fleet in the bay.',
    descriptionRu: 'Монгольские наездники, гарнизоны башен, озеро, в которое никто не ловит дважды, и флот в заливе.',
    region: Region.CAUCASUS,
    // Порог = минимальный уровень квеста главы (То, Что в Озере, ур. 20)
    minLevel: 20,
    quests: ['side_013_lake_horror', 'side_caucasus_tower_defense', 'main_050_gulf_battle'],
    cutscenes: ['cut_030_caucasus', 'cut_050_gulf'],
  },
  {
    id: 'ch_legacy',
    order: 6,
    title: 'The Legacy',
    titleRu: 'Наследие',
    description: 'The Red Hat trial, the Simurgh, and a name that outlasts the man who earned it.',
    descriptionRu: 'Испытание Красной Шапки, Симург и имя, которое переживёт того, кто его заслужил.',
    region: Region.KHORASAN,
    minLevel: 60,
    quests: ['class_qizilbash_trial', 'world_simurgh_hunt'],
    cutscenes: [],
  },
];

const BY_ID = new Map(CHAPTERS.map(c => [c.id, c]));

export function getChapter(id: string): ChapterDef | undefined {
  return BY_ID.get(id);
}
