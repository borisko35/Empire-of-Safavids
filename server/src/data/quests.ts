import { CharacterClass, Region } from '../types/game.types';

// ============================================================
// Система квестов — Empire of Safavids
// ============================================================

/**
 * personal — личный квест: выдаётся по карме, а не по уровню и региону.
 * Единственный тип, условие которого — кто ты, а не где ты.
 */
export type QuestType = 'main' | 'side' | 'guild' | 'daily' | 'world' | 'class' | 'personal';
export type QuestStatus = 'locked' | 'available' | 'active' | 'completed' | 'failed';
export type ObjectiveType = 'kill' | 'collect' | 'talk' | 'explore' | 'escort' | 'craft' | 'trade';

export interface QuestObjectiveDef {
  id: string;
  type: ObjectiveType;
  description: string;
  target: string;       // monsterId | itemId | npcId | regionId
  required: number;
  optional: boolean;
  /** Точки спавна монстров для навигации (используются когда монстры ещё не появились в мире) */
  spawnPoints?: { x: number; z: number }[];
}

export interface QuestRewardDef {
  experience: number;
  gold: number;
  /** Премиум-награда AZENS (обычно 0 — выдается в особых миссиях). */
  azens?: number;
  /** Исфаханское серебро — бесплатная валюта квестов/ивентов. */
  isfahanSilver?: number;
  /** Сирийское золото — бесплатная валюта квестов/ивентов. */
  syrianGold?: number;
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
  /**
   * Тёмная ветка: квест доступен только если карма НЕ ВЫШЕ этого числа.
   *
   * Означает «красный или изгой». Для светлой ветки поле можно читать
   * наоборот — как минимальную карму, но таких квестов пока нет, и лишнего
   * поля с незаполненным смыслом в данных не заводим.
   */
  requiresKarmaAtMost?: number;
  prerequisites: string[];  // id предыдущих квестов
  objectives: QuestObjectiveDef[];
  rewards: QuestRewardDef;
  npcGiver: string;
  npcGiverRegion: Region;
  timeLimit?: number;   // минуты, если есть ограничение
  repeatable: boolean;
  repeatCooldown?: number; // часы
}

/**
 * Граница «тёмной» кармы: −2001 и ниже — это красный и изгой.
 *
 * Число намерино по getKarmaStatus: хаотичным считается карма от −2000,
 * значит красный начинается с −2001. Проверка сверяет эту константу с
 * таблицей статусов на всём диапазоне, так что при смене порогов в карме
 * проверка укажет на расхождение, а не промолчит.
 */
export const PERSONAL_KARMA_MAX = -2001;

export const QUESTS_DATABASE: Record<string, QuestDefinition> = {

  // ── Личные квесты по тёмной карме ──────────────────────────────────────
  // Их даёт охотник: заказы, от которых отказываются остальные. Смысл в том,
  // что карма — не только наказание (смерть, потеря золота, охота монстров),
  // но и работа: изгой идёт туда, куда не ходят добрые.
  'personal_001_dirty_work': {
    id: 'personal_001_dirty_work',
    title: 'Dirty Work',
    titleRu: 'Грязная работа',
    description: 'Охотник берёт заказы, от которых отказываются остальные. Разбойники на дороге душат торговцев, а ловить их больше некому: закон для таких, как ты, не работает.',
    type: 'personal',
    minLevel: 4,
    requiresKarmaAtMost: PERSONAL_KARMA_MAX,
    prerequisites: [],
    objectives: [
      { id: 'obj_personal_bandits', type: 'kill', description: 'Перебить разбойников на дороге', target: 'mob_road_bandit', required: 10, optional: false, spawnPoints: [{ x: 143, z: 115 }, { x: -80, z: 120 }] },
    ],
    rewards: { experience: 400, gold: 150, items: [] },
    npcGiver: 'npc_tabriz_hunter',
    npcGiverRegion: Region.TABRIZ,
    repeatable: false,
  },
  'personal_002_ledger': {
    id: 'personal_002_ledger',
    title: 'The Ledger',
    titleRu: 'Счёт',
    description: 'За разбойниками стоит не только они. Охотник хочет имя главаря — а узнать его можно только там, где бандиты держат оплот.',
    type: 'personal',
    minLevel: 8,
    requiresKarmaAtMost: PERSONAL_KARMA_MAX,
    prerequisites: ['personal_001_dirty_work'],
    objectives: [
      { id: 'obj_personal_warriors', type: 'kill', description: 'Сломить бандитский отряд', target: 'mob_bandit_warrior', required: 6, optional: false },
    ],
    rewards: { experience: 900, gold: 400, items: [] },
    npcGiver: 'npc_tabriz_hunter',
    npcGiverRegion: Region.TABRIZ,
    repeatable: false,
  },


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
      { id: 'obj_kill_scouts', type: 'kill', description: 'Уничтожить разбойников-разведчиков', target: 'mob_bandit_scout', required: 10, optional: false, spawnPoints: [{ x: 143, z: 115 }, { x: -80, z: 120 }] },
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
      { id: 'obj_kill_spies', type: 'kill', description: 'Уничтожить османских шпионов', target: 'mob_ottoman_janissary', required: 20, optional: false, spawnPoints: [{ x: 200, z: 50 }, { x: -60, z: -170 }] },
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
      { id: 'obj_kill_bandits', type: 'kill', description: 'Уничтожить разбойников', target: 'mob_bandit_warrior', required: 5, optional: false, spawnPoints: [{ x: -80, z: 120 }, { x: 143, z: 115 }] },
      { id: 'obj_return_gold', type: 'collect', description: 'Вернуть золото торговцу', target: 'qst_merchant_gold_bag', required: 1, optional: false },
    ],
    rewards: { experience: 2000, gold: 300, isfahanSilver: 50, syrianGold: 20, items: [{ itemId: 'mat_silk', quantity: 5 }] },
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
      { id: 'obj_daily_kill', type: 'kill', description: 'Уничтожить 20 разбойников', target: 'mob_bandit_scout', required: 20, optional: false, spawnPoints: [{ x: 143, z: 115 }, { x: -80, z: 120 }] },
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
      { id: 'obj_solo_boss', type: 'kill', description: 'Победить босса в одиночку', target: 'boss_bandit_king', required: 1, optional: false, spawnPoints: [{ x: 0, z: 0 }] },
      { id: 'obj_no_potion', type: 'kill', description: 'Без использования зелий', target: 'mob_ottoman_janissary', required: 30, optional: true, spawnPoints: [{ x: 200, z: 50 }, { x: -60, z: -170 }] },
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
    minLevel: 85,
    prerequisites: [],
    objectives: [
      { id: 'obj_kill_simurgh', type: 'kill', description: 'Победить Великого Симурга', target: 'world_boss_simurgh', required: 1, optional: false, spawnPoints: [{ x: 0, z: 0 }] },
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

  // ── ДОПОЛНИТЕЛЬНЫЕ КВЕСТЫ (Фаза 1) ──────────────────────────────

  'side_tabriz_caravan_guard': {
    id: 'side_tabriz_caravan_guard',
    title: 'Guard the Caravan Gates',
    titleRu: 'Страж Караванных Ворот',
    description: 'Разбойники-воины давят на подступах к Тебризу. Разгоните их лагерь.',
    type: 'side',
    minLevel: 5,
    prerequisites: [],
    objectives: [
      { id: 'obj_kill_warriors', type: 'kill', description: 'Разогнать разбойников-воинов', target: 'mob_bandit_warrior', required: 5, optional: false, spawnPoints: [{ x: -80, z: 120 }, { x: 143, z: 115 }] },
    ],
    rewards: { experience: 900, gold: 120, items: [{ itemId: 'con_stamina_food', quantity: 5 }] },
    npcGiver: 'npc_guard_captain',
    npcGiverRegion: Region.TABRIZ,
    repeatable: true,
    repeatCooldown: 24,
  },

  'side_isfahan_silk_order': {
    id: 'side_isfahan_silk_order',
    title: 'Silk for the Workshop',
    titleRu: 'Шёлк для Мастерской',
    description: 'Ремесленные цеха Исфахана ждут партию шёлка. Доставьте 3 рулона со склада.',
    type: 'side',
    minLevel: 20,
    prerequisites: [],
    objectives: [
      { id: 'obj_collect_silk', type: 'collect', description: 'Собрать шёлк', target: 'mat_silk', required: 3, optional: false },
      { id: 'obj_visit_isfahan', type: 'explore', description: 'Доставить заказ в Исфахан', target: 'isfahan_bazaar', required: 1, optional: false },
    ],
    rewards: { experience: 2200, gold: 300, items: [{ itemId: 'con_mana_potion', quantity: 5 }] },
    npcGiver: 'npc_grand_vizier',
    npcGiverRegion: Region.ISFAHAN,
    repeatable: true,
    repeatCooldown: 24,
  },

  'side_shiraz_hafiz_manuscript': {
    id: 'side_shiraz_hafiz_manuscript',
    title: 'The Poet Lost Manuscript',
    titleRu: 'Потерянная Рукопись Поэта',
    description: 'Хафиз ищет свою рукопись, украденную контрабандистами. Верните свиток и убийц накажите.',
    type: 'side',
    minLevel: 40,
    prerequisites: [],
    objectives: [
      { id: 'obj_collect_scroll', type: 'collect', description: 'Вернуть свиток Хафиза', target: 'qst_hafiz_scroll', required: 1, optional: false },
      { id: 'obj_kill_fog', type: 'kill', description: 'Наказать ассасинов из тумана', target: 'mob_fog_assassin', required: 3, optional: true },
    ],
    rewards: {
      experience: 6500, gold: 500,
      items: [{ itemId: 'acc_turquoise_ring', quantity: 1 }],
      title: 'Друг Хафиза',
    },
    npcGiver: 'npc_shiraz_librarian',
    npcGiverRegion: Region.SHIRAZ,
    repeatable: false,
  },

  'side_caucasus_tower_defense': {
    id: 'side_caucasus_tower_defense',
    title: 'Towers of the Caucasus',
    titleRu: 'Башни Кавказа',
    description: 'Горные крепости теряют дозорных. Очистите перевалы от налётчиков.',
    type: 'side',
    minLevel: 50,
    prerequisites: [],
    objectives: [
      { id: 'obj_kill_raiders', type: 'kill', description: 'Разбить монгольских наездников', target: 'mob_mongol_raider', required: 10, optional: false, spawnPoints: [{ x: 66, z: 167 }, { x: -150, z: 200 }] },
      { id: 'obj_collect_ore', type: 'collect', description: 'Собрать железо для ремонта ворот', target: 'mat_iron_ore', required: 10, optional: false },
    ],
    rewards: { experience: 12000, gold: 800, items: [{ itemId: 'con_health_potion_m', quantity: 10 }] },
    npcGiver: 'npc_guard_captain',
    npcGiverRegion: Region.CAUCASUS,
    repeatable: true,
    repeatCooldown: 48,
  },

  'side_gulf_smuggler_rings': {
    id: 'side_gulf_smuggler_rings',
    title: 'Smuggler Rings of the Gulf',
    titleRu: 'Кольца Контрабандистов Залива',
    description: 'Пираты и янычары делят Персидский залив. Прервите их союз.',
    type: 'side',
    minLevel: 80,
    prerequisites: [],
    objectives: [
      { id: 'obj_kill_janissaries', type: 'kill', description: 'Потопить десанты янычар', target: 'mob_ottoman_janissary', required: 15, optional: false, spawnPoints: [{ x: 200, z: 50 }, { x: -60, z: -170 }] },
      { id: 'obj_collect_turquoise', type: 'collect', description: 'Изъять контрабандную бирюзу', target: 'mat_turquoise', required: 3, optional: true },
    ],
    rewards: { experience: 80000, gold: 3000, items: [{ itemId: 'con_exp_scroll', quantity: 2 }] },
    npcGiver: 'npc_gulf_harbor-master',
    npcGiverRegion: Region.PERSIAN_GULF,
    repeatable: true,
    repeatCooldown: 48,
  },

  'daily_rustam_offer': {
    id: 'daily_rustam_offer',
    title: 'Rustam the Undying Stirs',
    titleRu: 'Рустам Бессмертный Пробуждается',
    description: 'В заливе слышен рог Рустама. Соберите группу и уложите легенду обратно спать.',
    type: 'daily',
    minLevel: 95,
    prerequisites: [],
    objectives: [
      { id: 'obj_kill_rustam', type: 'kill', description: 'Одолеть Рустама Бессмертного', target: 'world_boss_rustam_reborn', required: 1, optional: false, spawnPoints: [{ x: 40, z: -230 }] },
    ],
    rewards: {
      experience: 400000, gold: 8000,
      items: [{ itemId: 'mat_dragon_scale', quantity: 3 }],
      title: 'Поборник Рустама',
    },
    npcGiver: 'npc_gulf_harbor-master',
    npcGiverRegion: Region.PERSIAN_GULF,
    repeatable: true,
    repeatCooldown: 336,
  },

  // ── ПОБОЧНЫЕ КВЕСТЫ ТЕБРИЗА ──────────────────────────────────
  'side_001_scorpion_nest': {
    id: 'side_001_scorpion_nest',
    title: 'Scorpion Nest',
    titleRu: 'Гнездо Скорпионов',
    description: 'Фермер жалуется на скорпионов у дороги. Уничтожьте гнездо.',
    type: 'side',
    minLevel: 2,
    prerequisites: [],
    objectives: [
      { id: 'obj_kill_scorpions', type: 'kill', description: 'Убить скорпионов', target: 'mob_desert_scorpion', required: 5, optional: false, spawnPoints: [{ x: 220, z: 70 }] },
    ],
    rewards: { experience: 200, gold: 50, items: [{ itemId: 'pot_health_small', quantity: 3 }] },
    npcGiver: 'npc_tabriz_farmer',
    npcGiverRegion: Region.TABRIZ,
    repeatable: true,
    repeatCooldown: 24,
  },
  'side_002_wolf_pelts': {
    id: 'side_002_wolf_pelts',
    title: 'Wolf Pelts',
    titleRu: 'Волчьи Шкуры',
    description: 'Охотник хочет купить волчьи шкуры для зимней куртки.',
    type: 'side',
    minLevel: 5,
    prerequisites: [],
    objectives: [
      // Раньше цель была «убить 8 волков»: игрок приносил охотнику
      // пустые руки, а шкуры просто висели в сумке как обычный лут.
      // Теперь их надо принести и сдать — как и обещает текст квеста.
      { id: 'obj_collect_pelts', type: 'collect', description: 'Принести волчьи шкуры', target: 'trophy_wolf_pelt', required: 8, optional: false, spawnPoints: [{ x: -90, z: 130 }] },
    ],
    rewards: { experience: 350, gold: 120, items: [{ itemId: 'arm_leather_vest', quantity: 1 }] },
    npcGiver: 'npc_tabriz_hunter',
    npcGiverRegion: Region.TABRIZ,
    repeatable: false,
  },

  // ── ЗАТЫКАЕМ ПУСТЫЕ УРОВНИ 1–20 ───────────────────────────
  // Пустыми были уровни 4, 7, 9, 11, 13, 14, 16, 17 и 19. Сценарий
  // разбора: игрок уровень за уровнем делает всё, что открылось. На
  // перечисленных уровнях не открывалось ничего — ни одного квеста, кроме
  // ежедневных, а они раз в сутки. Человек доходил до двадцатого уровня и
  // упирался в пустоту.
  'side_village_ore': {
    id: 'side_village_ore',
    title: 'Ore for the Village',
    titleRu: 'Руда для деревни',
    description: 'Деревня второй месяц чинит ограду из подручных камней. Старейшина просит привезти железную руду: в кузнице рядом сразу найдётся, кому её переплавить.',
    type: 'side',
    minLevel: 4,
    prerequisites: [],
    objectives: [
      { id: 'obj_collect_ore', type: 'collect', description: 'Принести железную руду', target: 'mat_iron_ore', required: 8, optional: false, spawnPoints: [{ x: 143, z: 115 }, { x: -80, z: 120 }] },
    ],
    rewards: { experience: 300, gold: 100, items: [{ itemId: 'pot_health_small', quantity: 3 }] },
    npcGiver: 'npc_village_elder',
    npcGiverRegion: Region.TABRIZ,
    repeatable: false,
  },
  'side_road_bandit_hunt': {
    id: 'side_road_bandit_hunt',
    title: 'Road Bandit Hunt',
    titleRu: 'Охота на дорожных разбойников',
    description: 'Разбойники сняли подводы с торговой дороги. Дровосек знает их стоянки лучше стражников — и предлагает сходить туда вместе.',
    type: 'side',
    minLevel: 7,
    prerequisites: [],
    objectives: [
      { id: 'obj_hunt_road_bandits', type: 'kill', description: 'Перебить разбойников на дороге', target: 'mob_road_bandit', required: 8, optional: false, spawnPoints: [{ x: 143, z: 115 }] },
    ],
    rewards: { experience: 500, gold: 180, items: [{ itemId: 'pot_health_small', quantity: 4 }, { itemId: 'food_kebab', quantity: 2 }] },
    npcGiver: 'npc_tabriz_hunter',
    npcGiverRegion: Region.TABRIZ,
    repeatable: false,
  },
  'side_bandit_tokens': {
    id: 'side_bandit_tokens',
    title: 'Bandit Tokens',
    titleRu: 'Знаки разбойников',
    description: 'У каждого разбойника на шее латунный знак с номером шайки. Стражу Рустаму нужны знаки: по ним он вычислит, откуда банда берёт оружие.',
    type: 'side',
    minLevel: 9,
    prerequisites: [],
    objectives: [
      { id: 'obj_collect_tokens', type: 'collect', description: 'Собрать разбойничьи знаки', target: 'trophy_road_bandit_token', required: 4, optional: false, spawnPoints: [{ x: -80, z: 120 }] },
    ],
    rewards: { experience: 800, gold: 260, items: [{ itemId: 'pot_health_small', quantity: 5 }] },
    npcGiver: 'npc_guard_captain',
    npcGiverRegion: Region.TABRIZ,
    repeatable: false,
  },
  'side_piranha_fins': {
    id: 'side_piranha_fins',
    title: 'Fins of the Lake',
    titleRu: 'Плавники озера',
    description: 'Пирании вытащили половину сети ещё до рассвета. Рыбак Тигран просит принести плавники — из них он сделает шины для саней.',
    type: 'side',
    minLevel: 11,
    prerequisites: [],
    objectives: [
      { id: 'obj_collect_fins', type: 'collect', description: 'Принести плавники пираней', target: 'trophy_piranha_fin', required: 5, optional: false },
    ],
    rewards: { experience: 1100, gold: 350, items: [{ itemId: 'fish_sturgeon', quantity: 2 }] },
    npcGiver: 'npc_fisherman',
    npcGiverRegion: Region.ISFAHAN,
    repeatable: false,
  },
  'side_piranha_thinning': {
    id: 'side_piranha_thinning',
    title: 'Thin Out the Shallows',
    titleRu: 'Пробить мелководье',
    description: 'Плавники Тигран уже получил, но лов не стал легче: в мелководье всё ещё шныряют пираньи. Просит выбить их, пока не начали грызти снасти.',
    type: 'side',
    minLevel: 12,
    prerequisites: ['side_piranha_fins'],
    objectives: [
      { id: 'obj_kill_piranhas', type: 'kill', description: 'Выбить пираний из мелководья', target: 'mob_lake_piranha', required: 10, optional: false },
    ],
    rewards: { experience: 1200, gold: 380, items: [{ itemId: 'pot_health_small', quantity: 5 }] },
    npcGiver: 'npc_fisherman',
    npcGiverRegion: Region.ISFAHAN,
    repeatable: false,
  },
  'side_bandit_warriors': {
    id: 'side_bandit_warriors',
    title: 'Bandit Warriors',
    titleRu: 'Разбойничьи воины',
    description: 'Обычных разбойников с дороги прогнали, а в лесу остались бронированные. Старейшина деревни просит: пока эти ходят, никто не выйдет к северной роще.',
    type: 'side',
    minLevel: 13,
    prerequisites: [],
    objectives: [
      { id: 'obj_kill_warriors', type: 'kill', description: 'Снять разбойничьих воинов', target: 'mob_bandit_warrior', required: 6, optional: false, spawnPoints: [{ x: 143, z: 115 }] },
    ],
    rewards: { experience: 1400, gold: 420, items: [{ itemId: 'wpn_iron_sword', quantity: 1 }] },
    npcGiver: 'npc_village_elder',
    npcGiverRegion: Region.TABRIZ,
    repeatable: false,
  },
  'side_rain_spirits': {
    id: 'side_rain_spirits',
    title: 'Spirits of the Rain',
    titleRu: 'Духи дождя',
    description: 'Духи дождя топят костры лесничего и уносят воду из ручья. Лесничий Давид не суеверный, но с мокрым костром поспоришь.',
    type: 'side',
    minLevel: 14,
    prerequisites: [],
    objectives: [
      { id: 'obj_kill_rain_spirits', type: 'kill', description: 'Прогнать духов дождя', target: 'mob_rain_spirit', required: 3, optional: false },
    ],
    rewards: { experience: 1600, gold: 480, items: [{ itemId: 'con_mana_potion', quantity: 3 }] },
    npcGiver: 'npc_forester',
    npcGiverRegion: Region.TABRIZ,
    repeatable: false,
  },
  'side_sturgeon_bladders': {
    id: 'side_sturgeon_bladders',
    title: 'Sturgeon Bladders',
    titleRu: 'Сомьи пузыри',
    description: 'Сом-громила бьёт хвостом так, что сети рвутся. Рыбак Тигран берёт пузыри на ремонт: из них получается непромокаемая кожа для плащей.',
    type: 'side',
    minLevel: 16,
    prerequisites: [],
    objectives: [
      { id: 'obj_collect_bladders', type: 'collect', description: 'Принести сомьи пузыри', target: 'trophy_sturgeon_bladder', required: 3, optional: false },
    ],
    rewards: { experience: 1800, gold: 600, items: [{ itemId: 'food_kebab', quantity: 3 }] },
    npcGiver: 'npc_fisherman',
    npcGiverRegion: Region.ISFAHAN,
    repeatable: false,
  },
  'side_lake_sturgeon_hunt': {
    id: 'side_lake_sturgeon_hunt',
    title: 'Hunt the Gulper Sturgeon',
    titleRu: 'Охота на сома-громилу',
    description: 'Пузырей сом теперь не даёт. Тигран идёт на него сам — в одиночку, потому что в лодке больше не помещается.',
    type: 'side',
    minLevel: 17,
    prerequisites: ['side_sturgeon_bladders'],
    objectives: [
      { id: 'obj_kill_sturgeon', type: 'kill', description: 'Убить сома-громилу', target: 'mob_lake_sturgeon_horror', required: 4, optional: false },
    ],
    rewards: { experience: 2000, gold: 650, items: [{ itemId: 'pot_health_medium', quantity: 2 }] },
    npcGiver: 'npc_fisherman',
    npcGiverRegion: Region.ISFAHAN,
    repeatable: false,
  },
  'side_bandit_king_tidings': {
    id: 'side_bandit_king_tidings',
    title: 'Tidings of the Bandit King',
    titleRu: 'Слухи о короле разбойников',
    description: 'Говорят, у дорожных банд появился атаман. Стражу Рустаму нужны знаки с клеймом новой шайки: по ним он найдёт лагерь раньше, чем нападёт следующий караван.',
    type: 'side',
    minLevel: 19,
    prerequisites: ['side_bandit_tokens'],
    objectives: [
      { id: 'obj_collect_king_tokens', type: 'collect', description: 'Собрать знаки новой шайки', target: 'trophy_road_bandit_token', required: 6, optional: false, spawnPoints: [{ x: -80, z: 120 }] },
    ],
    rewards: { experience: 2400, gold: 800, items: [{ itemId: 'acc_hunters_amulet', quantity: 1 }] },
    npcGiver: 'npc_guard_captain',
    npcGiverRegion: Region.TABRIZ,
    repeatable: false,
  },

  // ── ПОБОЧНЫЕ КВЕСТЫ ИСФАХАНА ────────────────────────────────
  'side_003_silk_road': {
    id: 'side_003_silk_road',
    title: 'The Silk Road',
    titleRu: 'Шёлковый Путь',
    description: 'Торговец ищет защиту для каравана до Тебриза.',
    type: 'side',
    minLevel: 18,
    prerequisites: [],
    objectives: [
      { id: 'obj_kill_assassins', type: 'kill', description: 'Убить ассасинов', target: 'mob_assassin_acolyte', required: 5, optional: false, spawnPoints: [{ x: 34, z: 26 }] },
    ],
    rewards: { experience: 1200, gold: 500, items: [{ itemId: 'mat_silk_thread', quantity: 10 }, { itemId: 'acc_boots_silk', quantity: 1 }] },
    npcGiver: 'npc_isfahan_merchant',
    npcGiverRegion: Region.ISFAHAN,
    repeatable: true,
    repeatCooldown: 48,
  },
  'side_004_sand_storm': {
    id: 'side_004_sand_storm',
    title: 'The Sand Storm',
    titleRu: 'Песчаная Буря',
    description: 'Маг-элементаль пустыни угрожает караванам. Следы ведут в пустыню.',
    type: 'side',
    minLevel: 28,
    prerequisites: ['side_003_silk_road'],
    objectives: [
      { id: 'obj_kill_elementals', type: 'kill', description: 'Убить песчанных элементалей', target: 'mob_sand_elemental', required: 3, optional: false, spawnPoints: [{ x: 34, z: 26 }] },
    ],
    rewards: { experience: 2000, gold: 800, items: [{ itemId: 'acc_ring_jade', quantity: 1 }] },
    npcGiver: 'npc_isfahan_mage',
    npcGiverRegion: Region.ISFAHAN,
    repeatable: false,
  },

  // ── ПОБОЧНЫЕ КВЕСТЫ ШИРАЗА ──────────────────────────────────
  'side_005_graveyard': {
    id: 'side_005_graveyard',
    title: 'The Haunted Graveyard',
    titleRu: 'Проклятое Кладбище',
    description: 'На кладбище Шираза поднялись мертвецы. Остановите их.',
    type: 'side',
    minLevel: 42,
    prerequisites: [],
    objectives: [
      { id: 'obj_kill_undead', type: 'kill', description: 'Убить неживых стражей', target: 'mob_undead_guardian', required: 4, optional: false, spawnPoints: [{ x: 110, z: -91 }] },
    ],
    rewards: { experience: 5000, gold: 2000, items: [{ itemId: 'arm_silk_robe', quantity: 1 }, { itemId: 'mat_dragon_scale', quantity: 2 }] },
    npcGiver: 'npc_shiraz_priest',
    npcGiverRegion: Region.SHIRAZ,
    repeatable: true,
    repeatCooldown: 72,
  },

  // ── ЕЖЕДНЕВНЫЕ КВЕСТЫ ────────────────────────────────────────
  'daily_patrol': {
    id: 'daily_patrol',
    title: 'Patrol the Roads',
    titleRu: 'Патрулирование Дорог',
    description: 'Очистите дороги от разбойников.',
    type: 'daily',
    minLevel: 5,
    prerequisites: [],
    objectives: [
      { id: 'obj_kill_bandits', type: 'kill', description: 'Убить разбойников', target: 'mob_road_bandit', required: 10, optional: false, spawnPoints: [{ x: 143, z: 115 }, { x: -80, z: 120 }] },
    ],
    rewards: { experience: 500, gold: 200, items: [{ itemId: 'pot_health_small', quantity: 5 }] },
    npcGiver: 'npc_tabriz_guard',
    npcGiverRegion: Region.TABRIZ,
    repeatable: true,
    repeatCooldown: 24,
  },
  'daily_herbs': {
    id: 'daily_herbs',
    title: 'Gather Herbs',
    titleRu: 'Сбор Трав',
    description: 'Соберите лепестки роз для алхимика.',
    type: 'daily',
    minLevel: 1,
    prerequisites: [],
    objectives: [
      { id: 'obj_collect_roses', type: 'collect', description: 'Собрать лепестки роз', target: 'mat_rose_petals', required: 15, optional: false },
    ],
    rewards: { experience: 150, gold: 60, items: [{ itemId: 'pot_mana_small', quantity: 3 }] },
    npcGiver: 'npc_isfahan_alchemist',
    npcGiverRegion: Region.ISFAHAN,
    repeatable: true,
    repeatCooldown: 24,
  },

  // ── НОВЫЕ СЮЖЕТНЫЕ КВЕСТЫ ────────────────────────────────────
  'main_020_shah_convocation': {
    id: 'main_020_shah_convocation',
    title: "The Shah's Convocation",
    titleRu: 'Созыв Шаха',
    description: 'Шах Исмаил созывает великий совет. Все воеводы должны явиться в Тебриз и доказать свою преданность.',
    type: 'main',
    minLevel: 15,
    prerequisites: ['main_002_first_blood'],
    objectives: [
      { id: 'obj_travel_tabriz', type: 'explore', description: 'Явиться в Тебриз', target: 'tabriz_gate', required: 1, optional: false },
      { id: 'obj_meet_warriors', type: 'talk', description: 'Доложить командующему', target: 'npc_tabriz_guard', required: 1, optional: false },
    ],
    rewards: { experience: 5000, gold: 500, items: [{ itemId: 'wpn_iron_sword', quantity: 1 }] },
    npcGiver: 'npc_grand_vizier',
    npcGiverRegion: Region.ISFAHAN,
    repeatable: false,
  },
  'main_030_caucasus_campaign': {
    id: 'main_030_caucasus_campaign',
    title: 'Campaign of the Caucasus',
    titleRu: 'Кавказский Поход',
    description: 'Монгольские налёты угрожают северным рубежам. Шах поручает вам возглавить карательную экспедицию.',
    type: 'main',
    minLevel: 50,
    prerequisites: ['main_020_shah_convocation', 'main_035_caucasus_outpost'],
    objectives: [
      { id: 'obj_kill_raiders', type: 'kill', description: 'Уничтожить монгольских наездников', target: 'mob_mongol_raider', required: 15, optional: false, spawnPoints: [{ x: 66, z: 167 }, { x: -140, z: 160 }] },
      { id: 'obj_seize_pass', type: 'explore', description: 'Занять перевал', target: 'caucasus_pass', required: 1, optional: false },
    ],
    rewards: { experience: 12000, gold: 1500, items: [{ itemId: 'wpn_qizilbash_saber', quantity: 1 }] },
    npcGiver: 'npc_qizilbash_commander',
    npcGiverRegion: Region.CAUCASUS,
    repeatable: false,
  },
  'main_035_caucasus_outpost': {
    id: 'main_035_caucasus_outpost',
    title: 'Outposts of the Caucasus',
    titleRu: 'Заставы Кавказа',
    description: 'Горные заставы остались без защиты: джинны бури сбивают караваны с перевала. Пока перевал держится, до Кавказского похода говорить нечего.',
    type: 'main',
    minLevel: 38,
    prerequisites: ['main_010_silk_road'],
    objectives: [
      { id: 'obj_seize_outpost', type: 'explore', description: 'Добраться до заставы на перевале', target: 'caucasus_pass', required: 1, optional: false },
      { id: 'obj_kill_djinn', type: 'kill', description: 'Очистить заставу от джиннов бури', target: 'mob_storm_djinn', required: 3, optional: false, spawnPoints: [{ x: 66, z: 167 }] },
    ],
    rewards: { experience: 18000, gold: 2000, items: [{ itemId: 'con_health_potion_m', quantity: 5 }, { itemId: 'con_exp_scroll', quantity: 1 }] },
    npcGiver: 'npc_qizilbash_commander',
    npcGiverRegion: Region.CAUCASUS,
    repeatable: false,
  },
  'main_040_desert_trial': {
    id: 'main_040_desert_trial',
    title: 'Trial of the Desert',
    titleRu: 'Испытание Пустыни',
    description: 'Чтобы стать истинным воином Сефевидов, нужно пережить испытание пустыней. Убейте огненного дива — стража дорог Хорасана.',
    type: 'main',
    minLevel: 60,
    prerequisites: ['main_030_caucasus_campaign'],
    objectives: [
      { id: 'obj_kill_div', type: 'kill', description: 'Уничтожить Огненного Дива', target: 'mob_div_fire', required: 1, optional: false, spawnPoints: [{ x: 300, z: -100 }] },
    ],
    rewards: { experience: 25000, gold: 3000, items: [{ itemId: 'acc_silk_road_amulet', quantity: 1 }] },
    npcGiver: 'npc_khorasan_governor',
    npcGiverRegion: Region.KHORASAN,
    repeatable: false,
  },
  'main_050_gulf_battle': {
    id: 'main_050_gulf_battle',
    title: 'Battle for the Gulf',
    titleRu: 'Битва за Залив',
    description: 'Османский флот появился в Персидском заливе. Нужно остановить их десант и защитить портовые города.',
    type: 'main',
    minLevel: 60,
    prerequisites: ['main_040_desert_trial'],
    objectives: [
      { id: 'obj_kill_janissaries', type: 'kill', description: 'Уничтожить османский десант', target: 'mob_ottoman_janissary', required: 25, optional: false, spawnPoints: [{ x: -60, z: -170 }, { x: 200, z: 50 }] },
    ],
    rewards: { experience: 50000, gold: 5000, items: [{ itemId: 'arm_silk_robe', quantity: 1 }] },
    npcGiver: 'npc_gulf_harbor-master',
    npcGiverRegion: Region.PERSIAN_GULF,
    repeatable: false,
  },

  // ── НОВЫЕ ПОБОЧНЫЕ КВЕСТЫ ────────────────────────────────────
  'side_006_broken_caravan': {
    id: 'side_006_broken_caravan',
    title: 'The Broken Caravan',
    titleRu: 'Разбитый Караван',
    description: 'Караван торговцев атакован разбойниками у дорог Исфахана. Спасите выживших.',
    type: 'side',
    minLevel: 8,
    prerequisites: [],
    objectives: [
      { id: 'obj_kill_road_bandits', type: 'kill', description: 'Убить разбойников на дороге', target: 'mob_road_bandit', required: 6, optional: false, spawnPoints: [{ x: 143, z: 115 }, { x: -80, z: 120 }] },
    ],
    rewards: { experience: 600, gold: 200, items: [{ itemId: 'con_health_potion_m', quantity: 3 }] },
    npcGiver: 'npc_isfahan_trader',
    npcGiverRegion: Region.ISFAHAN,
    repeatable: true,
    repeatCooldown: 24,
  },
  'side_007_forest_patrol': {
    id: 'side_007_forest_patrol',
    title: 'Forest Patrol',
    titleRu: 'Лесной Патруль',
    description: 'Волки стали агрессивнее у деревни. Отправляйтесь на патрулирование и Protected жителей.',
    type: 'side',
    minLevel: 6,
    prerequisites: ['side_002_wolf_pelts'],
    objectives: [
      { id: 'obj_patrol_forest', type: 'kill', description: 'Очистить лес от волков', target: 'mob_wolf', required: 12, optional: false, spawnPoints: [{ x: -90, z: 130 }] },
    ],
    rewards: { experience: 800, gold: 250, items: [{ itemId: 'con_stamina_food', quantity: 5 }] },
    npcGiver: 'npc_forester',
    npcGiverRegion: Region.TABRIZ,
    repeatable: true,
    repeatCooldown: 48,
  },
  'side_008_shiraz_poet_riddle': {
    id: 'side_008_shiraz_poet_riddle',
    title: "The Poet's Riddle",
    titleRu: 'Загадка Поэта',
    description: 'Хафиз бросил вызов: кто решит его загадку — тот получит мудрость веков.',
    type: 'side',
    minLevel: 40,
    prerequisites: ['side_shiraz_hafiz_manuscript'],
    objectives: [
      { id: 'obj_solve_riddle', type: 'talk', description: 'Решить загадку Хафиза', target: 'npc_poet', required: 1, optional: false },
    ],
    rewards: { experience: 3000, gold: 500, items: [{ itemId: 'acc_ring_jade', quantity: 1 }] },
    npcGiver: 'npc_poet',
    npcGiverRegion: Region.SHIRAZ,
    repeatable: false,
  },
  'side_009_gulf_reef': {
    id: 'side_009_gulf_reef',
    title: 'Sharks of the Gulf',
    titleRu: 'Акулы Залива',
    description: 'Рыбаки не могут выйти в море — акулы заселили рифы. Очистите акваторию.',
    type: 'side',
    minLevel: 25,
    prerequisites: [],
    objectives: [
      // Раньше целью стоял mob_ottoman_janissary: квест про акул просил
      // убивать османских янычар, которых в игре нигде не было видно на
      // рифе. Теперь это то, чем квест и называется.
      { id: 'obj_kill_sharks', type: 'kill', description: 'Убрать акул у рифов', target: 'mob_lake_leviathan', required: 2, optional: false, spawnPoints: [{ x: -430, z: -190 }] },
      { id: 'obj_kill_sharks_young', type: 'kill', description: 'Отогнать мелкую стаю', target: 'mob_lake_piranha', required: 6, optional: false, spawnPoints: [{ x: -420, z: -100 }] },
    ],
    rewards: { experience: 1000, gold: 300, items: [{ itemId: 'con_health_potion_s', quantity: 5 }] },
    npcGiver: 'npc_fisherman',
    npcGiverRegion: Region.ISFAHAN,
    repeatable: true,
    repeatCooldown: 24,
  },
  'side_013_lake_horror': {
    id: 'side_013_lake_horror',
    title: 'The Thing in the Lake',
    titleRu: 'То, Что в Озере',
    description: 'Рыбаки перестали ходить к северному берегу. Говорят, там что-то дышит. И охотится только на тех, кто в воде.',
    type: 'side',
    minLevel: 20,
    prerequisites: [],
    objectives: [
      { id: 'obj_hunt_ghost_fish', type: 'kill', description: 'Убить трёх призрачных рыб', target: 'mob_lake_ghost_fish', required: 3, optional: false, spawnPoints: [{ x: -350, z: -230 }] },
      // Плащ муссонного дождя и Сапоги Морехода — в сундуке: сначала
      // сходишь на воду, потом получаешь то, что помогает там остаться
      { id: 'obj_collect_pearl', type: 'collect', description: 'Принести жемчужину старухи озера', target: 'trophy_leviathan_pearl', required: 1, optional: false },
    ],
    rewards: {
      experience: 2600, gold: 900,
      items: [{ itemId: 'arm_fur_coat', quantity: 1 }],
      title: 'Сын Озера',
    },
    npcGiver: 'npc_tabriz_hunter',
    npcGiverRegion: Region.TABRIZ,
    repeatable: false,
  },
  'side_010_sheikh_tomb': {
    id: 'side_010_sheikh_tomb',
    title: "The Sheikh's Tomb",
    titleRu: 'Гробница Шеиха',
    description: 'Древняя гробница в горах Кавказа стала убежищем для мертвецов. Исследуйте её.',
    type: 'side',
    minLevel: 40,
    prerequisites: [],
    objectives: [
      { id: 'obj_clear_tomb', type: 'kill', description: 'Очистить гробницу от нежити', target: 'mob_undead_guardian', required: 6, optional: false, spawnPoints: [{ x: 60, z: 140 }] },
    ],
    rewards: { experience: 2000, gold: 600, items: [{ itemId: 'con_health_potion_m', quantity: 5 }] },
    npcGiver: 'npc_healer',
    npcGiverRegion: Region.SHIRAZ,
    repeatable: false,
  },
  'side_011_stolen_horses': {
    id: 'side_011_stolen_horses',
    title: 'Stolen Horses',
    titleRu: 'Украденные Кони',
    description: 'У конюшни Исфахана украли лучших скакунов. Отслеедите и верните их.',
    type: 'side',
    minLevel: 15,
    prerequisites: [],
    objectives: [
      { id: 'obj_track_thieves', type: 'kill', description: 'Напасть на след воров', target: 'mob_bandit_scout', required: 8, optional: false, spawnPoints: [{ x: 143, z: 115 }, { x: -80, z: 120 }] },
    ],
    rewards: { experience: 1500, gold: 400, items: [{ itemId: 'con_mana_potion', quantity: 5 }] },
    npcGiver: 'npc_stable_master',
    npcGiverRegion: Region.ISFAHAN,
    repeatable: true,
    repeatCooldown: 48,
  },
  'side_012_metro_ruins': {
    id: 'side_012_metro_ruins',
    title: 'Ruins of Mesopotamia',
    titleRu: 'Руины Месопотамии',
    description: 'Древние руины к востоку заполнены разбойниками. Верните их под контроль Империи.',
    type: 'side',
    minLevel: 30,
    prerequisites: [],
    objectives: [
      { id: 'obj_clear_ruins', type: 'kill', description: 'Очистить руины от врагов', target: 'mob_ottoman_janissary', required: 10, optional: false, spawnPoints: [{ x: 200, z: 50 }] },
    ],
    rewards: { experience: 1800, gold: 500, items: [{ itemId: 'mat_turquoise', quantity: 2 }] },
    npcGiver: 'npc_desert_scout',
    npcGiverRegion: Region.KHORASAN,
    repeatable: true,
    repeatCooldown: 48,
  },

  // ── НОВЫЕ ЕЖЕДНЕВНЫЕ КВЕСТЫ ──────────────────────────────────
  'daily_wolf_hunt': {
    id: 'daily_wolf_hunt',
    title: 'Wolf Hunt',
    titleRu: 'Охота на Волков',
    description: 'Ежедневная охота на волков у деревенских границ.',
    type: 'daily',
    minLevel: 3,
    prerequisites: [],
    objectives: [
      { id: 'obj_daily_wolves', type: 'kill', description: 'Убить 5 волков', target: 'mob_wolf', required: 5, optional: false, spawnPoints: [{ x: -90, z: 130 }] },
    ],
    rewards: { experience: 400, gold: 100, items: [{ itemId: 'pot_health_small', quantity: 3 }] },
    npcGiver: 'npc_tabriz_hunter',
    npcGiverRegion: Region.TABRIZ,
    repeatable: true,
    repeatCooldown: 24,
  },
  'daily_guard_duty': {
    id: 'daily_guard_duty',
    title: "Guard's Duty",
    titleRu: 'Стража Гарнизона',
    description: 'Ежедневный обход периметра. Убейте приближающихся врагов.',
    type: 'daily',
    minLevel: 5,
    prerequisites: [],
    objectives: [
      { id: 'obj_daily_patrol', type: 'kill', description: 'Убить 10 разбойников', target: 'mob_bandit_warrior', required: 10, optional: false, spawnPoints: [{ x: -80, z: 120 }, { x: 143, z: 115 }] },
    ],
    rewards: { experience: 700, gold: 150, items: [{ itemId: 'con_health_potion_s', quantity: 5 }] },
    npcGiver: 'npc_guard_east',
    npcGiverRegion: Region.ISFAHAN,
    repeatable: true,
    repeatCooldown: 24,
  },
  'daily_scorpion_cleansing': {
    id: 'daily_scorpion_cleansing',
    title: 'Scorpion Cleansing',
    titleRu: 'Очищение от Скорпионов',
    description: 'Фермеры снова жалуются на скорпионов. Уберите угрозу.',
    type: 'daily',
    minLevel: 2,
    prerequisites: [],
    objectives: [
      { id: 'obj_daily_scorpions', type: 'kill', description: 'Убить 10 скорпионов', target: 'mob_desert_scorpion', required: 10, optional: false, spawnPoints: [{ x: 220, z: 70 }] },
    ],
    rewards: { experience: 300, gold: 80, items: [{ itemId: 'pot_health_small', quantity: 3 }] },
    npcGiver: 'npc_tabriz_farmer',
    npcGiverRegion: Region.TABRIZ,
    repeatable: true,
    repeatCooldown: 24,
  },
};

export function getQuest(id: string): QuestDefinition | undefined {
  return QUESTS_DATABASE[id];
}

export function getQuestsByType(type: QuestType): QuestDefinition[] {
  return Object.values(QUESTS_DATABASE).filter(q => q.type === type);
}

export function getAvailableQuests(
  level: number,
  completedIds: string[],
  characterClass?: CharacterClass,
  /**
   * Карма персонажа.
   *
   * Нужна личным квестам. Без неё тёмный квест святому либо виден в
   * списке, либо отклоняется только при попытке взять — и то и другое плохо.
   * Карму не передали — личные квесты просто не показываются: безопаснее,
   * чем показать их не тому.
   */
  karma?: number,
): QuestDefinition[] {
  return Object.values(QUESTS_DATABASE).filter(q => {
    if (q.minLevel > level) return false;
    if (q.requiredClass && q.requiredClass !== characterClass) return false;
    if (!q.repeatable && completedIds.includes(q.id)) return false;
    if (q.prerequisites.some(p => !completedIds.includes(p))) return false;
    // Личный квест по тёмной карме: добрым он не адресован.
    if (q.requiresKarmaAtMost !== undefined) {
      if (karma === undefined || karma > q.requiresKarmaAtMost) return false;
    }
    return true;
  });
}
