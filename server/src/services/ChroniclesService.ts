// ============================================================
// Chronicles of the Safavids — Внутриигровая энциклопедия
// ============================================================
// Образовательный контент: открывается по мере прохождения квестов.
// Уникальная культурная фишка, отличающая игру от других MMORPG.

import { QUESTS_DATABASE } from '../data/quests';

export interface ChronicleEntry {
  id: string;
  category: 'history' | 'culture' | 'geography' | 'biography' | 'mythology';
  title: string;
  titleRu: string;
  content: string;
  contentRu: string;
  unlockCondition: string; // questId или 'default'
  imageUrl?: string;
}

export const CHRONICLES: ChronicleEntry[] = [
  // ── ОТКРЫТЫ СРАЗУ ────────────────────────────────────────
  {
    id: 'chron_intro',
    category: 'history',
    title: 'The Safavid Legacy',
    titleRu: 'Наследие Сефевидов',
    content: 'The Safavid dynasty (1501–1736) united Persia under Shia Islam and created one of the greatest empires in Islamic history. Its capital, Isfahan, was celebrated as "Isfahan is half the world."',
    contentRu: 'Династия Сефевидов (1501–1736) объединила Персию под знаменем шиитского ислама и создала одну из величайших империй в исламской истории. Её столица Исфахан славился как «Исфахан — половина мира».',
    unlockCondition: 'default',
  },
  {
    id: 'chron_culture',
    category: 'culture',
    title: 'Persian Carpet and Calligraphy',
    titleRu: 'Персидский Ковер и Каллиграфия',
    content: 'Persian carpets are among the most famous textiles in the world. Each region has its own patterns — Isfahan, Tabriz, Kashan. Calligraphy, especially the Nasta\'liq script, is considered the highest art form in Persian culture.',
    contentRu: 'Персидские ковры — одни из самых известных текстильных изделий в мире. Каждый регион имеет свои узоры — Исфахан, Тебриз, Кашан. Каллиграфия, особенно стиль насталик, считается высшим художественным промыслом персидской культуры.',
    unlockCondition: 'default',
  },
  {
    id: 'chron_geography',
    category: 'geography',
    title: 'The Silk Road Crossroads',
    titleRu: 'Перекрёсток Шёлкового Пути',
    content: 'Persia sat at the heart of the Silk Road, connecting China and India to the Mediterranean. Caravanserais dotted the deserts — fortified inns where traders rested, traded, and protected their goods.',
    contentRu: 'Персия находилась в самом сердце Шёлкового Пути, соединяя Китай и Индию со Средиземноморьем. По пустыням тянулись караван-сараи — укреплённые гостиницы, где купцы отдыхали, торговали и хранили товары.',
    unlockCondition: 'default',
  },
  // ── ИСТОРИЯ ──────────────────────────────────────────────
  {
    id: 'chron_safavid_rise',
    category: 'history',
    title: 'The Rise of the Safavids',
    titleRu: 'Восхождение Сефевидов',
    content: 'The Safavid dynasty rose to power in 1501 when Shah Ismail I conquered Tabriz and declared Twelver Shia Islam the state religion. This bold move reshaped the religious and political landscape of the Middle East for centuries to come.',
    contentRu: 'Династия Сефевидов пришла к власти в 1501 году, когда Шах Исмаил I захватил Тебриз и провозгласил двенадцатиимамный шиитский ислам государственной религией. Этот смелый шаг переформировал религиозный и политический ландшафт Ближнего Востока на столетия вперёд.',
    unlockCondition: 'main_001_awakening',
  },
  {
    id: 'chron_tabriz_capital',
    category: 'history',
    title: 'Tabriz — First Capital',
    titleRu: 'Тебриз — Первая Столица',
    content: 'Tabriz served as the first capital of the Safavid Empire. Its strategic location on the Silk Road made it a hub of trade, culture, and diplomacy. The Grand Bazaar of Tabriz, a UNESCO World Heritage site, still stands today.',
    contentRu: 'Тебриз был первой столицей Сефевидской империи. Его стратегическое положение на Шёлковом пути сделало его центром торговли, культуры и дипломатии. Великий базар Тебриза, объект Всемирного наследия ЮНЕСКО, стоит и по сей день.',
    unlockCondition: 'main_002_first_blood',
  },
  {
    id: 'chron_isfahan_glory',
    category: 'history',
    title: 'Isfahan — Half the World',
    titleRu: 'Исфахан — Половина Мира',
    content: 'Under Shah Abbas the Great, Isfahan became one of the largest and most beautiful cities in the world. The famous saying "Isfahan nesf-e jahan" (Isfahan is half the world) reflected its grandeur, with its Naqsh-e Jahan Square, magnificent mosques, and bridges.',
    contentRu: 'При Шахе Аббасе Великом Исфахан стал одним из крупнейших и красивейших городов мира. Знаменитая поговорка "Исфахан — половина мира" отражала его величие: площадь Накш-е Джехан, великолепные мечети и мосты.',
    unlockCondition: 'side_isfahan_silk_order',
  },

  // ── КУЛЬТУРА ─────────────────────────────────────────────
  {
    id: 'chron_persian_garden',
    category: 'culture',
    title: 'The Persian Garden',
    titleRu: 'Персидский Сад',
    content: 'Persian gardens (bagh) are UNESCO-recognized masterpieces of landscape design. Divided into four sections by water channels (chahar bagh), they symbolize the four elements of Zoroastrianism. The gardens of Eram in Shiraz remain a living testament to this art.',
    contentRu: 'Персидские сады (баг) — объекты ЮНЕСКО, шедевры ландшафтного дизайна. Разделённые на четыре части каналами с воды (чахар-баг), они символизируют четыре элемента зороастризма. Сады Эрама в Ширазе остаются живым свидетельством этого искусства.',
    unlockCondition: 'side_001_scorpion_nest',
  },
  {
    id: 'chron_hafiz_poetry',
    category: 'culture',
    title: 'Hafiz of Shiraz',
    titleRu: 'Хафиз Ширази',
    content: 'Khwāja Shams-ud-Dīn Muḥammad Ḥāfeẓ-e Shīrāzī (1315–1390) is considered one of the greatest poets of the Persian language. His ghazals explore themes of love, spirituality, and wine. Iranians still use his Divan for bibliomancy (fāl-e Ḥāfeẓ).',
    contentRu: 'Хваджа Шамс-уд-Дин Мухаммад Хафиз Ширази (1315–1390) считается одним из величайших поэтов персидского языка. Его газели исследуют темы любви, духовности и вина. Иранцы до сих пор используют его Диван для гадания (фал-е Хафиз).',
    unlockCondition: 'side_poet_shiraz',
  },
  {
    id: 'chron_rumi',
    category: 'culture',
    title: 'Rumi — The Mystic Poet',
    titleRu: 'Руми — Мистический Поэт',
    content: 'Jalal ad-Din Muhammad Rumi (1207–1273) was a Sufi mystic whose poetry transcends borders. His Masnavi, known as "the Quran in Persian," explores divine love through parables. The Whirling Dervishes of Konya perform his sacred dance to this day.',
    contentRu: 'Джалалад-Дин Мухаммад Руми (1207–1273) был суфийским мистиком, чья поэзия превосходит границы. Его Маснави, известная как "Коран на персидском", исследует божественную любовь через притчи. Вертящиеся дервиши Конии исполняют его священный танец по сей день.',
    unlockCondition: 'side_010_sheikh_tomb',
  },

  // ── ГЕОГРАФИЯ ────────────────────────────────────────────
  {
    id: 'chron_silk_road',
    category: 'geography',
    title: 'The Silk Road',
    titleRu: 'Шёлковый Путь',
    content: 'The Silk Road was a network of trade routes connecting East and West. Through Safavid territory, merchants carried silk, spices, precious stones, and ideas. Caravanserais (roadside inns) provided shelter, food, and security for travelers.',
    contentRu: 'Шёлковый Путь — сеть торговых маршрутов, соединяющих Восток и Запад. Через территорию Сефевидов торговцы везли шёлк, специи, драгоценные камни и идеи. Караван-сараи (дорожные гостиницы) предоставляли кров, еду и безопасность путешественникам.',
    unlockCondition: 'side_003_silk_road',
  },
  {
    id: 'chron_persian_gulf',
    category: 'geography',
    title: 'The Persian Gulf',
    titleRu: 'Персидский Залив',
    content: 'The Persian Gulf was a vital trade artery for the Safavid Empire. Ports like Bandar Abbas and Hormuz connected Persia to India, Africa, and Southeast Asia. Control of the Gulf meant control of the spice trade and maritime wealth.',
    contentRu: 'Персидский залив был жизненной торговой артерией Сефевидской империи. Порты Бендер-Аббас и Ормуз связывали Персию с Индией, Африкой и Юго-Восточной Азией. Контроль над заливом означал контроль над торговлей специями и морским богатством.',
    unlockCondition: 'daily_patrol',
  },

  // ── БИОГРАФИИ ────────────────────────────────────────────
  {
    id: 'chron_shah_ismail',
    category: 'biography',
    title: 'Shah Ismail I',
    titleRu: 'Шах Исмаил I',
    content: 'Shah Ismail I (1487–1524) founded the Safavid dynasty at age 14. A charismatic leader and mystical poet (writing under the pen name Khatai), he united Persia through military conquest and religious reform. His red-capped Qizilbash warriors became legendary.',
    contentRu: 'Шах Исмаил I (1487–1524) основал династию Сефевидов в 14 лет. Харизматичный лидер и мистический поэт (писал под псевдонимом Хатаи), он объединил Персию через военные завоования и религиозные реформы. Его красноголовые воины-кызылбаши стали легендой.',
    unlockCondition: 'main_001_awakening',
  },
  {
    id: 'chron_shah_abbas',
    category: 'biography',
    title: 'Shah Abbas the Great',
    titleRu: 'Шах Аббас Великий',
    content: 'Shah Abbas I (1571–1629) transformed the Safavid Empire into a golden age. He moved the capital to Isfahan, reformed the army, encouraged art and architecture, and opened trade with Europe. His reign is considered the peak of Persian civilization.',
    contentRu: 'Шах Аббас I (1571–1629) превратил Сефевидскую империю в золотой век. Он перенёс столицу в Исфахан, реформировал армию, поощрял искусство и архитектуру, открыл торговлю с Европой. Его правление считается вершиной персидской цивилизации.',
    unlockCondition: 'main_050_gulf_battle',
  },

  // ── МИФОЛОГИЯ ────────────────────────────────────────────
  {
    id: 'chron_simurgh',
    category: 'mythology',
    title: 'The Simurgh',
    titleRu: 'Симург',
    content: 'The Simurgh is a mythical bird in Persian mythology, depicted as enormous and wise. In Ferdowsi\'s Shahnameh, the Simurgh raised the hero Zal and later saved him from a storm. It symbolizes divine guidance and protection.',
    contentRu: 'Симург — мифическая птица в персидской мифологии, огромная и мудрая. В Шахнаме Фирдоуси Симург вырастил героя Зала и позже спас его от бури. Он символизирует божественное руководство и защиту.',
    unlockCondition: 'world_simurgh_hunt',
  },
  {
    id: 'chron_rustam',
    category: 'mythology',
    title: 'Rustam — The Eternal Hero',
    titleRu: 'Рустам — Вечный Герой',
    content: 'Rustam is the greatest hero of the Shahnameh, performing seven legendary trials. Riding his steed Rakhsh, he defended Persia for generations. His tragic conflict with his son Sohrab is one of literature\'s most heartbreaking stories.',
    contentRu: 'Рустам — величайший герой Шахнаме, выполнивший семь легендарных подвигов. Верхом на коне Рахш он защищал Персию на протяжении поколений. Его трагический конфликт с сыном Сохрабом — одна из самых пронзительных историй мировой литературы.',
    unlockCondition: 'daily_rustam_offer',
  },
];

export interface ChronicleEntryView extends ChronicleEntry {
  /** Открыта ли запись для этого персонажа */
  unlocked: boolean;
  /** Название квеста, который открывает запись (для подсказки в интерфейсе) */
  unlockHintRu: string | null;
}

export class ChroniclesService {
  /** Получить все записи */
  getAll(): ChronicleEntry[] {
    return CHRONICLES;
  }

  /** Получить записи по категории */
  getByCategory(category: ChronicleEntry['category']): ChronicleEntry[] {
    return CHRONICLES.filter(c => c.category === category);
  }

  /**
   * Записи с флагом «открыто» для персонажа.
   * Раньше getUnlocked никем не вызывался: маршрут отдавал все записи
   * подряд, игрок видел весь текст сразу, а условия открытия были
   * чистой декорацией.
   */
  getView(completedQuests: string[]): ChronicleEntryView[] {
    const done = new Set(completedQuests);
    return CHRONICLES.map(c => {
      const unlocked = c.unlockCondition === 'default' || done.has(c.unlockCondition);
      let hint: string | null = null;
      if (!unlocked) {
        const quest = QUESTS_DATABASE[c.unlockCondition];
        hint = quest ? quest.titleRu : c.unlockCondition;
      }
      return { ...c, unlocked, unlockHintRu: hint };
    });
  }

  /** Только открытые записи */
  getUnlocked(completedQuests: string[]): ChronicleEntry[] {
    const done = new Set(completedQuests);
    return CHRONICLES.filter(c => c.unlockCondition === 'default' || done.has(c.unlockCondition));
  }

  /** Получить одну запись */
  getById(id: string): ChronicleEntry | undefined {
    return CHRONICLES.find(c => c.id === id);
  }
}
