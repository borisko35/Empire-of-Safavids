import { CharacterClass, Region } from '../types/game.types';

// ============================================================
// Система квестов — Empire of Safavids
// ============================================================

export type QuestType = 'main' | 'side' | 'guild' | 'daily' | 'world' | 'class';
export type QuestStatus = 'locked' | 'available' | 'active' | 'completed' | 'failed';
export type ObjectiveType = 'kill' | 'collect' | 'talk' | 'explore' | 'escort' | 'craft' | 'trade';

export interface QuestObjectiveDef {
  id: string;
  type: ObjectiveType;
  description: string;
  target: string;       // monsterId | itemId | npcId | regionId
  required: number;
  optional: boolean;
}

export interface QuestRewardDef {
  experience: number;
  gold: number;
  items: { itemId: string; quantity: number }[];
  reputation?: { faction: string; amount: number }[];
  unlocks?: string[];   // разблокируемые квесты
  title?: string;       // титул персонажа
}

export interface QuestDefinition {
  id: string;
  title: string;
  titleRu: string;
  description: string;
  type: QuestType;
  minLevel: number;
  requiredClass?: CharacterClass;
  requiredRegion?: Region;
  prerequisites: string[];  // id предыдущих квестов
  objectives: QuestObjectiveDef[];
  rewards: QuestRewardDef;
  npcGiver: string;
  npcGiverRegion: Region;
  timeLimit?: number;   // минуты, если есть ограничение
  repeatable: boolean;
  repeatCooldown?: number; // часы
}

export const QUESTS_DATABASE: Record<string, QuestDefinition> = {

  // ── ОСНОВНОЙ СЮЖЕТ ──────────────────────────────────────────────
  'main_001_awakening': {
    id: 'main_001_awakening',
    title: 'The Awakening of the Empire',
    titleRu: 'Пробуждение Империи',
    description: 'Шах Исмаил I призывает вас на службу. Отправьтесь в Тебриз и доложите о своём прибытии.',
    type: 'main',
    minLevel: 1,
    prerequisites: [],
    objectives: [
      { id: 'obj_talk_shah', type: 'talk', description: 'Поговорите с посланником Шаха', target: 'npc_shah_messenger', required: 1, optional: false },
      { id: 'obj_reach_tabriz', type: 'explore', description: 'Добраться до ворот Тебриза', target: 'tabriz_gate', required: 1, optional: false },
    ],
    rewards: { experience: 500, gold: 50, items: [{ itemId: 'con_health_potion_s', quantity: 5 }] },
    npcGiver: 'npc_village_elder',
    npcGiverRegion: Region.TABRIZ,
    repeatable: false,
  },
  'main_002_first_blood': {
    id: 'main_002_first_blood',
    title: 'First Blood for the Shah',
    titleRu: 'Первая Кровь для Шаха',
    description: 'Разбойники угрожают торговым путям. Уничтожьте их и защитите караван.',
    type: 'main',
    minLevel: 3,
    prerequisites: ['main_001_awakening'],
    objectives: [
      { id: 'obj_kill_scouts', type: 'kill', description: 'Уничтожить разбойников-разведчиков', target: 'mob_bandit_scout', required: 10, optional: false },
      { id: 'obj_collect_loot', type: 'collect', description: 'Собрать украденное добро', target: 'mat_iron_ore', required: 5, optional: true },
    ],
    rewards: { experience: 1500, gold: 150, items: [{ itemId: 'wpn_iron_sword', quantity: 1 }, { itemId: 'con_health_potion_s', quantity: 10 }] },
    npcGiver: 'npc_guard_captain',
    npcGiverRegion: Region.TABRIZ,
    repeatable: false,
  },
  'main_010_silk_road': {
    id: 'main_010_silk_road',
    title: 'The Silk Road Conspiracy',
    titleRu: 'Заговор на Шёлковом Пути',
    description: 'Османские шпионы пытаются перехватить контроль над шёлковыми путями. Раскройте заговор.',
    type: 'main',
    minLevel: 30,
    prerequisites: ['main_002_first_blood'],
    objectives: [
      { id: 'obj_spy_isfahan', type: 'explore', description: 'Проникните в османский лагерь', target: 'ottoman_camp_isfahan', required: 1, optional: false },
      { id: 'obj_kill_spies', type: 'kill', description: 'Уничтожить османских шпионов', target: 'mob_ottoman_janissary', required: 20, optional: false },
      { id: 'obj_recover_docs', type: 'collect', description: 'Забрать секретные документы', target: 'qst_royal_seal', required: 1, optional: false },
    ],
    rewards: {
      experience: 25000, gold: 2000,
      items: [{ itemId: 'wpn_qizilbash_saber', quantity: 1 }],
      reputation: [{ faction: 'safavid_empire', amount: 500 }],
      title: 'Защитник Шёлкового Пути',
    },
    npcGiver: 'npc_grand_vizier',
    npcGiverRegion: Region.ISFAHAN,
    repeatable: false,
  },

  // ── ПОБОЧНЫЕ КВЕСТЫ ──────────────────────────────────────────────
  'side_tabriz_merchant': {
    id: 'side_tabriz_merchant',
    title: 'The Merchant\'s Debt',
    titleRu: 'Долг Торговца',
    description: 'Помогите торговцу вернуть долг разбойникам.',
    type: 'side',
    minLevel: 5,
    prerequisites: [],
    objectives: [
      { id: 'obj_kill_bandits', type: 'kill', description: 'Уничтожить разбойников', target: 'mob_bandit_warrior', required: 5, optional: false },
      { id: 'obj_return_gold', type: 'collect', description: 'Вернуть золото торговцу', target: 'qst_merchant_gold_bag', required: 1, optional: false },
    ],
    rewards: { experience: 2000, gold: 300, items: [{ itemId: 'mat_silk', quantity: 5 }] },
    npcGiver: 'npc_tabriz_merchant',
    npcGiverRegion: Region.TABRIZ,
    repeatable: false,
  },
  'side_poet_shiraz': {
    id: 'side_poet_shiraz',
    title: 'The Lost Poems of Hafiz',
    titleRu: 'Потерянные Стихи Хафиза',
    description: 'Найдите утерянные рукописи великого поэта Хафиза.',
    type: 'side',
    minLevel: 40,
    prerequisites: [],
    objectives: [
      { id: 'obj_explore_shiraz', type: 'explore', description: 'Исследовать сады Шираза', target: 'shiraz_gardens', required: 3, optional: false },
      { id: 'obj_collect_scrolls', type: 'collect', description: 'Собрать свитки со 5 стихов', target: 'qst_hafiz_scroll', required: 5, optional: false },
    ],
    rewards: {
      experience: 15000, gold: 1000,
      items: [{ itemId: 'acc_turquoise_ring', quantity: 1 }],
      reputation: [{ faction: 'shiraz_scholars', amount: 200 }],
    },
    npcGiver: 'npc_shiraz_librarian',
    npcGiverRegion: Region.SHIRAZ,
    repeatable: false,
  },

  // ── ЕЖЕДНЕВНЫЕ КВЕСТЫ ────────────────────────────────────────────
  'daily_bandit_hunt': {
    id: 'daily_bandit_hunt',
    title: 'Daily Bandit Hunt',
    titleRu: 'Ежедневная Охота на Разбойников',
    description: 'Уничтожьте разбойников для защиты торговых путей.',
    type: 'daily',
    minLevel: 1,
    prerequisites: [],
    objectives: [
      { id: 'obj_daily_kill', type: 'kill', description: 'Уничтожить 20 разбойников', target: 'mob_bandit_scout', required: 20, optional: false },
    ],
    rewards: { experience: 3000, gold: 200, items: [{ itemId: 'con_health_potion_m', quantity: 2 }] },
    npcGiver: 'npc_guard_captain',
    npcGiverRegion: Region.TABRIZ,
    repeatable: true,
    repeatCooldown: 24,
  },
  'daily_silk_delivery': {
    id: 'daily_silk_delivery',
    title: 'Silk Delivery',
    titleRu: 'Доставка Шёлка',
    description: 'Доставьте шёлк из Исфахана в Тебриз.',
    type: 'daily',
    minLevel: 10,
    prerequisites: [],
    objectives: [
      { id: 'obj_collect_silk', type: 'collect', description: 'Собрать 10 единиц шёлка', target: 'mat_silk', required: 10, optional: false },
      { id: 'obj_deliver_silk', type: 'trade', description: 'Доставить шёлк торговцу', target: 'npc_tabriz_merchant', required: 1, optional: false },
    ],
    rewards: { experience: 2500, gold: 400, items: [{ itemId: 'mat_turquoise', quantity: 1 }] },
    npcGiver: 'npc_isfahan_trader',
    npcGiverRegion: Region.ISFAHAN,
    repeatable: true,
    repeatCooldown: 24,
  },

  // ── КВЕСТЫ КЛАССА ──────────────────────────────────────────────
  'class_qizilbash_trial': {
    id: 'class_qizilbash_trial',
    title: 'Trial of the Red Hat',
    titleRu: 'Испытание Красной Шапки',
    description: 'Докажите свою достойность гвардейца Кызылбаша.',
    type: 'class',
    minLevel: 60,
    requiredClass: CharacterClass.QIZILBASH,
    prerequisites: ['main_010_silk_road'],
    objectives: [
      { id: 'obj_solo_boss', type: 'kill', description: 'Победить босса в одиночку', target: 'boss_bandit_king', required: 1, optional: false },
      { id: 'obj_no_potion', type: 'kill', description: 'Без использования зелий', target: 'mob_ottoman_janissary', required: 30, optional: true },
    ],
    rewards: {
      experience: 100000, gold: 5000,
      items: [{ itemId: 'arm_qizilbash_armor', quantity: 1 }],
      title: 'Истинный Кызылбаш',
      unlocks: ['skill_qiz_awakening'],
    },
    npcGiver: 'npc_qizilbash_commander',
    npcGiverRegion: Region.CAUCASUS,
    repeatable: false,
  },

  // ── МИРОВЫЕ КВЕСТЫ ──────────────────────────────────────────────
  'world_simurgh_hunt': {
    id: 'world_simurgh_hunt',
    title: 'Hunt the Great Simurgh',
    titleRu: 'Охота на Великого Симурга',
    description: 'Великий Симург появился в горах Хорасана. Соберите рейд и остановите его.',
    type: 'world',
    minLevel: 80,
    prerequisites: [],
    objectives: [
      { id: 'obj_kill_simurgh', type: 'kill', description: 'Победить Великого Симурга', target: 'world_boss_simurgh', required: 1, optional: false },
    ],
    rewards: {
      experience: 500000, gold: 10000,
      items: [{ itemId: 'mat_dragon_scale', quantity: 5 }, { itemId: 'con_exp_scroll', quantity: 5 }],
      reputation: [{ faction: 'safavid_empire', amount: 1000 }],
      title: 'Убийца Симурга',
    },
    npcGiver: 'npc_khorasan_governor',
    npcGiverRegion: Region.KHORASAN,
    repeatable: true,
    repeatCooldown: 168,
  },
};

export function getQuest(id: string): QuestDefinition | undefined {
  return QUESTS_DATABASE[id];
}

export function getQuestsByType(type: QuestType): QuestDefinition[] {
  return Object.values(QUESTS_DATABASE).filter(q => q.type === type);
}

export function getAvailableQuests(level: number, completedIds: string[], characterClass?: CharacterClass): QuestDefinition[] {
  return Object.values(QUESTS_DATABASE).filter(q => {
    if (q.minLevel > level) return false;
    if (q.requiredClass && q.requiredClass !== characterClass) return false;
    if (!q.repeatable && completedIds.includes(q.id)) return false;
    if (q.prerequisites.some(p => !completedIds.includes(p))) return false;
    return true;
  });
}
