// ============================================================
// NPC Dynamic Lines — Empire of Safavids
// ============================================================
// Динамические реплики NPC: меняются в зависимости от
// прогресса квестов, уровня игрока, времени суток, дружбы.
// Каждый NPC имеет базовые линии + пул случайных реплик.

import { Region } from '../types/game.types';
import { NpcRole } from './npcDialogues';

export interface NpcDynamicProfile {
  npcId: string;
  role: NpcRole;
  region: Region;
  nameRu: string;
  /** Базовые линии (hello и т.д.) */
  baseLines: Record<string, { textRu: string; choices?: { labelRu: string; nextId: string; action?: string; questId?: string; when?: { minLevel?: number; questActive?: string; questCompleted?: string; hasItem?: string; minGold?: number; maxGold?: number; hour?: number } }[] }>;
  /** Случайные реплики для повторных разговоров */
  randomLines: {
    id: string;
    textRu: string;
    when?: { minLevel?: number; questActive?: string; questCompleted?: string; hour?: number; minGold?: number; maxGold?: number; hasItem?: string };
    frequency?: number;
  }[];
  /** Модификаторы приветствия в зависимости от дружбы + тон */
  greetings: {
    level0: string; // незнакомец
    level1: string; // знакомый
    level2: string; // друг
  };
  /** Тон-реплики: перекрывают greetings если выбран hostile/friendly */
  toneGreetings?: Partial<Record<'neutral' | 'friendly' | 'hostile', string>>;
  /** LLM-подсказка для генерации (заполняется NpcMemoryService.buildLlmHint) */
  llmHint?: string;
  /** Фразы при завершении квеста */
  questCompletePhrases: string[];
  /** Фразы при первом разговоре */
  firstMeetingPhrases: string[];
}

export const NPC_DYNAMIC_PROFILES: NpcDynamicProfile[] = [

  // ── Исфахан ────────────────────────────────────────────────

  {
    npcId: 'npc_quest_crier',
    role: 'quest_giver',
    region: Region.ISFAHAN,
    nameRu: 'Глашатай Шаха',
    baseLines: {
      hello: {
        textRu: 'Шах Исмаил призывает лучших воинов! Исфахан нуждается в героях.',
        choices: [
          { labelRu: 'Какие квесты доступны?', nextId: 'quests' },
          { labelRu: 'Расскажи о Шехе', nextId: 'shah' },
          { labelRu: 'До свидания', nextId: 'bye' },
        ],
      },
      quests: {
        textRu: 'Стражник Рустам на востоке базара поручит тебе дело. А суфий Мевлана ищет тех, кто очистит город.',
        choices: [
          { labelRu: 'К Рустаму', nextId: 'move_guard' },
          { labelRu: 'К Мевлане', nextId: 'move_mystic' },
          { labelRu: 'Благодарю', nextId: 'bye' },
        ],
      },
      shah: {
        textRu: 'Шах Исмаил I — основатель Сефевидской империи. Его гвардия кызылбашей — гордость Персии.',
        choices: [{ labelRu: 'Хочу служить', nextId: 'quest_offer' }],
      },
      quest_offer: {
        textRu: 'Отправься к командиру гарнизона — он даст первое задание.',
        choices: [{ labelRu: 'Иду', nextId: 'bye' }],
      },
      move_guard: { textRu: 'Стражник Рустам стоит у восточных ворот.', choices: [{ labelRu: 'Понятно', nextId: 'bye' }] },
      move_mystic: { textRu: 'Суфий Мевлана медитирует у мечети.', choices: [{ labelRu: 'Понятно', nextId: 'bye' }] },
      bye: { textRu: 'Да хранит тебя Аллах.', choices: [] },
    },
    randomLines: [
      { id: 'extra_city', textRu: 'Исфахан прекрасен, но за стенами — опасность.', when: { minLevel: 1 }, frequency: 0.5 },
      { id: 'extra_osman', textRu: 'Османы давят с запада. Нужны храбрые воины!', when: { minLevel: 10 }, frequency: 0.3 },
      { id: 'extra_silk', textRu: 'Шёлковый Путь — артерия нашей экономики. Охраняйте его!', when: { questActive: 'main_010_silk_road' }, frequency: 0.4 },
      { id: 'extra_boss', textRu: 'Говорят, Великий Симург пробудился в Хорасане...', when: { minLevel: 30 }, frequency: 0.2 },
      { id: 'extra_quest_done', textRu: 'Ты уже помог нам? Шах будет доволен.', when: { questCompleted: 'main_002_first_blood' }, frequency: 0.6 },
    ],
    greetings: {
      level0: 'Шах Исмаил призывает лучших воинов!',
      level1: 'О, это ты! Мы уже слышали о твоих подвигах.',
      level2: 'Друг Шаха! Рад тебя видеть. Есть новые дела?',
    },
    toneGreetings: {
      friendly: 'Друг Шаха, ты заслужил доверие — выбирай любое дело!',
      hostile: 'Ты новенький с дурной славой? Докажи, что не враг.',
    },
    questCompletePhrases: [
      'Отличная работа! Шах будет доволен.',
      'Ты действительно полезен Империи.',
      'Ещё один враг повержен! Слава Кызылбашам!',
    ],
    firstMeetingPhrases: [
      'Ты новенький? Покажешь ли ты себя в деле?',
      'Вижу твой боевой вид. Ты готов служить Шаху?',
    ],
  },

  {
    npcId: 'npc_guard_east',
    role: 'guard',
    region: Region.ISFAHAN,
    nameRu: 'Стражник Рустам',
    baseLines: {
      hello: {
        textRu: 'Стой! Ты не местный? ..Ладно, вид у тебя боевой. Я Рустам, командир восточных ворот.',
        choices: [
          { labelRu: 'Что нужно сделать?', nextId: 'mission' },
          { labelRu: 'А что за разбойники?', nextId: 'lore' },
          { labelRu: 'Я вернусь позже', nextId: 'bye' },
        ],
      },
      mission: {
        textRu: 'Уничтожь разбойников-разведчиков на дорогах к Тебризу. Их лагерь к северу от города.',
        choices: [
          { labelRu: 'Приму задание', nextId: 'quest_accept', action: 'quest', questId: 'main_002_first_blood' },
          { labelRu: 'Мне нужно оружие', nextId: 'gear' },
          { labelRu: 'Я справлюсь', nextId: 'bye' },
        ],
      },
      lore: {
        textRu: 'Разбойники — бывшие крестьяне, угнанные голодом. Но теперь они грабят без разбора.',
        choices: [{ labelRu: 'Понятно', nextId: 'bye' }],
      },
      gear: {
        textRu: 'Купишь у торговца на базаре. Или найди что-нибудь на теле убитых.',
        choices: [{ labelRu: 'Иду на базар', nextId: 'bye' }],
      },
      quest_accept: {
        textRu: 'Отлично. Вернёшься — доложишь. Удачи, боец.',
        choices: [{ labelRu: 'Будет сделано!', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Сколько раз я это слышал... Все говорили "справлюсь".',
        choices: [{ labelRu: 'Я справлюсь', nextId: 'bye' }],
      },
      bye: { textRu: 'Береги себя. Нам нужны живые герои.', choices: [] },
    },
    randomLines: [
      { id: 'random_watch', textRu: 'Стою на посту уже третий день. Глаза устают, но отдыхать нельзя.', frequency: 0.4 },
      { id: 'random_bandits', textRu: 'Разбойники стали наглеее. Каждую неделю новый набег.', when: { minLevel: 5 }, frequency: 0.3 },
      { id: 'random_veteran', textRu: 'Я воевал при Тебризе. Это было давно, но память свежа.', when: { minLevel: 20 }, frequency: 0.2 },
      { id: 'random_praise', textRu: 'Ты тот, кто убил разбойников? Молодец, боец!', when: { questCompleted: 'main_002_first_blood' }, frequency: 0.7 },
      { id: 'random_newquest', textRu: 'Есть новое дело. Османы замечены у лагеря.', when: { questActive: 'main_010_silk_road', minLevel: 20 }, frequency: 0.3 },
    ],
    greetings: {
      level0: 'Стой! Кто идёт?',
      level1: 'О, это ты! Опять на задание?',
      level2: 'Друг Рустам! Рад видеть живого.',
    },
    questCompletePhrases: [
      'Молодец! Разбойники больше не побеспокоят караваны.',
      'Хорошая работа. Исфахан тебе благодарен.',
      'Ещё один враг Империи повержен!',
    ],
    firstMeetingPhrases: [
      'Ты новенький? Покажешь ли свою доблесть?',
      'Вижу твой меч. Ты готов защищать город?',
    ],
  },

  {
    npcId: 'npc_bazaar_merchant',
    role: 'merchant',
    region: Region.ISFAHAN,
    nameRu: 'Торговец Джафар',
    baseLines: {
      hello: {
        textRu: 'Ассаламу алейкум, путник! Джафар к вашим услугам. Шёлк, специи, оружие — у меня есть всё.',
        choices: [
          { labelRu: 'Показать товары', nextId: 'shop' },
          { labelRu: 'Есть вопросы по региону', nextId: 'info' },
          { labelRu: 'Договоримся о цене', nextId: 'haggle' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      shop: {
        textRu: 'Шёлк — 100 золотых за рулон. Сафран — 150. Зелья — подешевле.',
        choices: [
          { labelRu: 'Купить шёлк', nextId: 'buy_silk' },
          { labelRu: 'Есть что подешевле?', nextId: 'cheap' },
          { labelRu: 'Я посмотрю', nextId: 'bye' },
        ],
      },
      buy_silk: {
        textRu: 'Шёлк — основа торговли. Из него ткут халаты.',
        choices: [{ labelRu: 'Куплю 10 штук', nextId: 'bye' }],
      },
      cheap: {
        textRu: 'Маленькие зелья здоровья по 60 золотых. Или руда — 8 за слиток.',
        choices: [{ labelRu: 'Беру руду', nextId: 'bye' }],
      },
      info: {
        textRu: 'Исфахан — сердце Империи. Мечеть Имам — чудо архитектуры.',
        choices: [{ labelRu: 'Спасибо', nextId: 'bye' }],
      },
      haggle: {
        textRu: 'О, вы любите поторговаться! Для вас — скидка 10%.',
        choices: [{ labelRu: 'Хорошо, договорились!', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Торговля — это искусство. Я торгую уже 20 лет.',
        choices: [{ labelRu: 'Мудрый совет', nextId: 'bye' }],
      },
      bye: { textRu: 'Да прибудет с вами баракат!', choices: [] },
    },
    randomLines: [
      { id: 'random_deals', textRu: 'Недавно привезли шелк из Гиляна. Качество отличное!', frequency: 0.5 },
      { id: 'random_price', textRu: 'Цены растут, друг. Войны дорого обходятся.', when: { minLevel: 10 }, frequency: 0.3 },
      { id: 'random_rich', textRu: 'Вы выглядите богато. Может, купите что-нибудь?', when: { minGold: 500 }, frequency: 0.4 },
      { id: 'random_poor', textRu: 'Бедному путнику — скидка. Возьмите зелье за полцены.', when: { maxGold: 50 }, frequency: 0.5 },
      { id: 'random_trade', textRu: 'Шёлковый Путь опасен. Караваны грабят каждую неделю.', when: { questActive: 'daily_silk_delivery' }, frequency: 0.6 },
    ],
    greetings: {
      level0: 'Ассаламу алейкум, путник!',
      level1: 'О, наш дорогой клиент! Как дела?',
      level2: 'Друг Джафара! Заходите, у меня есть особенные товары.',
    },
    questCompletePhrases: [
      'Вы помогли городу? Отлично! Держите скидку.',
      'Благодарность Шаху! Вы заслуживаете скидки.',
    ],
    firstMeetingPhrases: [
      'Первый раз вижу ваше лицо. Вы издалека?',
      'Новое лицо на базаре. Чем могу помочь?',
    ],
  },

  {
    npcId: 'npc_mystic',
    role: 'mystic',
    region: Region.ISFAHAN,
    nameRu: 'Суфий Мевлана',
    baseLines: {
      hello: {
        textRu: '*тихо кружится* ...О, путник. Твоя душа несётся вслепую. Остановись и выслушай.',
        choices: [
          { labelRu: 'Что вы видите?', nextId: 'vision' },
          { labelRu: 'Мне нужна помощь', nextId: 'help' },
          { labelRu: 'Я просто прохожу', nextId: 'bye' },
        ],
      },
      vision: {
        textRu: 'Я вижу тьму, что надвигается с востока. Ассасины сеют хаос.',
        choices: [
          { labelRu: 'Я могу помочь', nextId: 'quest_accept', action: 'quest', questId: 'side_003_silk_road' },
          { labelRu: 'Я не воин...', nextId: 'comfort' },
        ],
      },
      help: {
        textRu: 'Все нуждаются в помощи. Но сначала — помощь должна исходить из сердца.',
        choices: [{ labelRu: 'Я очищу Исфахан', nextId: 'quest_accept', action: 'quest', questId: 'side_003_silk_road' }],
      },
      comfort: {
        textRu: 'Мужество — не отсутствие страха. Это решение действовать, несмотря на него.',
        choices: [{ labelRu: 'Вы правы', nextId: 'bye' }],
      },
      quest_accept: {
        textRu: 'Пусть свет направит твой путь. Возвращайся, когда справишься.',
        choices: [{ labelRu: 'Аминь', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Руми сказал: "Зажги огонёк в другом, и твой тоже загорится".',
        choices: [{ labelRu: 'Благодарю за мудрость', nextId: 'bye' }],
      },
      bye: { textRu: '*продолжает медленно вращаться*', choices: [] },
    },
    randomLines: [
      { id: 'random_poem', textRu: '"Сиди в углу, печаль мой друг, не ищи путей вокруг..."', frequency: 0.3 },
      { id: 'random_doom', textRu: 'Тьма усиливается. Ассасины становятся смелее.', when: { minLevel: 15 }, frequency: 0.2 },
      { id: 'random_praise', textRu: 'Твоя душа чиста. Ты действительно можешь помочь.', when: { questCompleted: 'side_003_silk_road' }, frequency: 0.5 },
      { id: 'random_warning', textRu: 'Остерегайся тумана на кладбище Шираза. Там водятся неживые.', when: { minLevel: 30 }, frequency: 0.2 },
      { id: 'random_night', textRu: 'Ночью духи особенно сильны. Не ходи один.', when: { hour: 22 }, frequency: 0.4 },
      { id: 'random_dawn', textRu: 'Рассвет — время молитвы. Благослови этот день.', when: { hour: 6 }, frequency: 0.4 },
    ],
    greetings: {
      level0: '*кружится* ...Кто потревожил мою медитацию?',
      level1: 'О, друг мой. Твоя душа светится добром.',
      level2: 'Мудрый друг! Я видел твои дела через завесу времени.',
    },
    questCompletePhrases: [
      'Дух благодариет тебя. Ты очистил город от теней.',
      'Свет победил тьму. Благодарю за помощь.',
    ],
    firstMeetingPhrases: [
      'Первый раз вижу тебя здесь. Ты ищешь истину?',
      'Твоя душа зовёт меня. Что привело тебя?',
    ],
  },

  {
    npcId: 'npc_caravan_master',
    role: 'merchant',
    region: Region.ISFAHAN,
    nameRu: 'Караван-баши Юсуф',
    baseLines: {
      hello: {
        textRu: 'Юсуф, хозяин каравана. Везём шёлк из Гиляна в Тебриз. Ищешь работу или груз?',
        choices: [
          { labelRu: 'Есть ли работа?', nextId: 'work' },
          { labelRu: 'Расскажи о Шёлковом Пути', nextId: 'silk_road' },
          { labelRu: 'Просто мимо проходил', nextId: 'bye' },
        ],
      },
      work: {
        textRu: 'Мой караван нуждается в охране. 10 единиц шёлка до Тебриза — вот заказ.',
        choices: [
          { labelRu: 'Берусь!', nextId: 'quest_accept', action: 'quest', questId: 'daily_silk_delivery' },
          { labelRu: 'Мне нужно подумать', nextId: 'bye' },
        ],
      },
      silk_road: {
        textRu: 'Шёлковый Путь — артерия мира. От Китая до Средиземноморья.',
        choices: [{ labelRu: 'Уважаю ремесло', nextId: 'bye' }],
      },
      quest_accept: {
        textRu: 'Молодец! Загрузи шёлк и жди у ворот.',
        choices: [{ labelRu: 'Поехали!', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'В жизни нет ничего надёжнее верблюда.',
        choices: [{ labelRu: 'Правильные слова', nextId: 'bye' }],
      },
      bye: { textRu: 'С Богом на дороге!', choices: [] },
    },
    randomLines: [
      { id: 'random_silk', textRu: 'Шёлк сегодня в цене. Гилянский — лучший в мире.', frequency: 0.5 },
      { id: 'random_danger', textRu: 'Дорога опасна. Разбойники у Тебриза стали наглее.', when: { questActive: 'main_002_first_blood' }, frequency: 0.4 },
      { id: 'random_rich', textRu: 'Ты выглядишь как человек с деньгами. Хочешь стать партнёром?', when: { minGold: 1000 }, frequency: 0.3 },
      { id: 'random_delivered', textRu: 'Ты доставил шёлк? Караван ждёт нового груза!', when: { questCompleted: 'daily_silk_delivery' }, frequency: 0.6 },
      { id: 'random_night', textRu: 'Ночью караван-сарай безопаснее. Остерегайся одиночных путников.', when: { hour: 21 }, frequency: 0.3 },
    ],
    greetings: {
      level0: 'Юсуф, хозяин каравана. Чем могу помочь?',
      level1: 'О, друг! Караван помнит твою помощь.',
      level2: 'Партнёр! Давай обсудим новые сделки.',
    },
    questCompletePhrases: [
      'Шёлк доставлен! Караван благодарит вас.',
      'Отличная работа! Возвращайтесь за новой нагрузкой.',
    ],
    firstMeetingPhrases: [
      'Первый раз вижу вас у каравана. Вы из города?',
      'Новое лицо! Ищете работу или товар?',
    ],
  },

  {
    npcId: 'npc_forester',
    role: 'guide',
    region: Region.TABRIZ,
    nameRu: 'Лесничий Давид',
    baseLines: {
      hello: {
        textRu: 'О, путник! Давид, лесничий этих мест. Вид у тебя боевой — значит, не зевака.',
        choices: [
          { labelRu: 'Есть работы?', nextId: 'work' },
          { labelRu: 'Как пройти в Тебриз?', nextId: 'directions' },
          { labelRu: 'Расскажи о здешних местах', nextId: 'lore' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      work: {
        textRu: 'Разбойники засели у дорог. Ключник Бахрам просил очистить путь.',
        choices: [
          { labelRu: 'Приму задание', nextId: 'quest_accept', action: 'quest', questId: 'main_002_first_blood' },
          { labelRu: 'Сколько их?', nextId: 'info_enemies' },
          { labelRu: 'Я справлюсь', nextId: 'bye' },
        ],
      },
      info_enemies: {
        textRu: 'Около десятка сидят у дороги на север. Быстрые, но слабые.',
        choices: [{ labelRu: 'Иду!', nextId: 'bye' }],
      },
      directions: {
        textRu: 'Тебриз — далеко, но дорога прямая. Иди на север, затем на восток.',
        choices: [{ labelRu: 'Спасибо', nextId: 'bye' }],
      },
      lore: {
        textRu: 'Эти земли — пограничье. С одной стороны — лес, с другой — пустоши.',
        choices: [{ labelRu: 'Грустно...', nextId: 'bye' }],
      },
      quest_accept: {
        textRu: 'Возвращайся с доброй вестью. Ключник Бахрам ждёт отчёта.',
        choices: [{ labelRu: 'Будет сделано!', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Лес — наш дом. Но даже здесь разбойники не дают покоя.',
        choices: [{ labelRu: 'Защитим лес', nextId: 'bye' }],
      },
      bye: { textRu: 'Береги себя, путник.', choices: [] },
    },
    randomLines: [
      { id: 'random_wolves', textRu: 'Волки стали агрессивнее lately. Может, климат изменился?', frequency: 0.4 },
      { id: 'random_scorpions', textRu: 'Скорпионы у южной дороги размножились. Фермеры жалуются.', when: { questActive: 'side_001_scorpion_nest' }, frequency: 0.5 },
      { id: 'random_forest', textRu: 'Лес прекрасен весной. Цветы, птицы, зелень.', when: { minLevel: 1 }, frequency: 0.3 },
      { id: 'random_danger', textRu: 'Остерегайтесь тёмных троп после заката.', when: { hour: 19 }, frequency: 0.5 },
      { id: 'random_praise', textRu: 'Слышал, вы очистили дорогу от разбойников. Спасибо!', when: { questCompleted: 'main_002_first_blood' }, frequency: 0.7 },
      { id: 'random_hunter', textRu: 'Охотник Хасан жалуется на волков. Помогите ему.', when: { questActive: 'side_002_wolf_pelts' }, frequency: 0.4 },
    ],
    greetings: {
      level0: 'О, путник! Давид, лесничий. Чем помочь?',
      level1: 'О, это вы! Лес помнит вашу помощь.',
      level2: 'Друг леса! Рад видеть.',
    },
    questCompletePhrases: [
      'Дорога очищена! Фермеры смогут проходить спокойно.',
      'Благодарю! Лес станет безопаснее.',
    ],
    firstMeetingPhrases: [
      'Первый раз вижу вас в лесу. Вы охотник?',
      'Новое лицо! Ищете работу или прогулку?',
    ],
  },

  {
    npcId: 'npc_tabriz_farmer',
    role: 'villager',
    region: Region.TABRIZ,
    nameRu: 'Фермер Али',
    baseLines: {
      hello: {
        textRu: 'Ой, господи! Вы — из города? Слушайте, у меня беда — скорпионы!! Они грызут посевы!',
        choices: [
          { labelRu: 'Конечно, помогу', nextId: 'quest_accept', action: 'quest', questId: 'side_001_scorpion_nest' },
          { labelRu: 'А сколько их?', nextId: 'info' },
          { labelRu: 'Я сейчас не до этого', nextId: 'bye' },
        ],
      },
      info: {
        textRu: 'Около пяти гнёзд! Они в песках к югу от деревни.',
        choices: [{ labelRu: 'Уберу их всех', nextId: 'bye' }],
      },
      quest_accept: {
        textRu: 'Благословение Аллаха на тебя, друг! Убей пять скорпионов.',
        choices: [{ labelRu: 'Сделаю!', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Раньше здесь было спокойно. А теперь... *вздыхает*',
        choices: [{ labelRu: 'Всё будет хорошо', nextId: 'bye' }],
      },
      bye: { textRu: 'Да хранит тебя Аллах, герой!', choices: [] },
    },
    randomLines: [
      { id: 'random_crops', textRu: 'Посевы пострадали. Надеюсь, урожай будет хорошим.', frequency: 0.4 },
      { id: 'random_wolves', textRu: 'Волки тоже беспокоят. Охотник Хасан знает, что делать.', when: { questActive: 'side_002_wolf_pelts' }, frequency: 0.3 },
      { id: 'random_done', textRu: 'Скорпионы убиты? Мои посевы в безопасности!', when: { questCompleted: 'side_001_scorpion_nest' }, frequency: 0.7 },
      { id: 'random_harvest', textRu: 'Урожай в этом году хороший. Спасибо солнцу.', when: { minLevel: 5 }, frequency: 0.2 },
      { id: 'random_hunger', textRu: 'Еды хватает только до зимы. Нужно больше золота.', when: { maxGold: 100 }, frequency: 0.5 },
    ],
    greetings: {
      level0: 'Ой, господи! Вы — из города? Помогите!',
      level1: 'О, вы! Скорпионы больше не трогают мои посевы?',
      level2: 'Друг Али! Вы спасли мой двор.',
    },
    questCompletePhrases: [
      'Скорпионы убиты! Спасибо вам, друг!',
      'Мои посевы в безопасности. Аллагу акбар!',
    ],
    firstMeetingPhrases: [
      'Первый раз вижу вас. Вы похожи на героя.',
      'Новый человек в деревне. Чем помочь?',
    ],
  },

  {
    npcId: 'npc_poet',
    role: 'mystic',
    region: Region.SHIRAZ,
    nameRu: 'Поэт Хафиз',
    baseLines: {
      hello: {
        textRu: 'Извольте, путник! Хафиз Ширази — сын Ширазa. Читайте строки, пусть они согреют вашу душу.',
        choices: [
          { labelRu: 'Прочитай мне', nextId: 'poem' },
          { labelRu: 'Мне нужен квест', nextId: 'quest' },
          { labelRu: 'Прощайте', nextId: 'bye' },
        ],
      },
      poem: {
        textRu: '"Сиди в углу, печаль мой друг, не ищи путей вокруг."',
        choices: [
          { labelRu: 'Глубоко...', nextId: 'extra1' },
          { labelRu: 'Ещё одну!', nextId: 'poem2' },
        ],
      },
      poem2: {
        textRu: '"Покажи мне место, где друг мой живёт, и скажи — куда мне идти?"',
        choices: [{ labelRu: 'Прекрасно', nextId: 'bye' }],
      },
      quest: {
        textRu: 'У меня беда — украли мою рукопись! Ассасины похитили её.',
        choices: [
          { labelRu: 'Верну рукопись', nextId: 'quest_accept', action: 'quest', questId: 'side_shiraz_hafiz_manuscript' },
          { labelRu: 'Ассасины? Страшно...', nextId: 'comfort' },
        ],
      },
      comfort: {
        textRu: 'Страх — лишь тень ума. Поэт боится меньше всех.',
        choices: [{ labelRu: 'Вы правы, принимаю', nextId: 'quest_accept', action: 'quest', questId: 'side_shiraz_hafiz_manuscript' }],
      },
      quest_accept: {
        textRu: 'Да хранит тебя Хафиз! Если рукапись не найдёшь — напишу новую.',
        choices: [{ labelRu: 'Найду!', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'В Ширазе рождаются поэты. Каждый камень здесь пропитан стихами.',
        choices: [{ labelRu: 'Красиво сказано', nextId: 'bye' }],
      },
      bye: { textRu: 'Пусть строки освещают твой путь.', choices: [] },
    },
    randomLines: [
      { id: 'random_shiraz', textRu: 'Шираз — город роз и вина. Но также город поэтов.', frequency: 0.5 },
      { id: 'random_manuscript', textRu: 'Моя рукопись всё ещё украдена. Надеемся на вашу помощь.', when: { questActive: 'side_shiraz_hafiz_manuscript' }, frequency: 0.6 },
      { id: 'random_found', textRu: 'Рукопись возвращена! Вы спасли сокровище культуры!', when: { questCompleted: 'side_shiraz_hafiz_manuscript' }, frequency: 0.8 },
      { id: 'random_night', textRu: 'Ночью стихи приходят сами. Луна вдохновляет.', when: { hour: 22 }, frequency: 0.4 },
      { id: 'random_wise', textRu: 'Мудрость — это когда знание встречается с опытом.', when: { minLevel: 30 }, frequency: 0.3 },
    ],
    greetings: {
      level0: 'Извольте, путник! Хафиз к вашим услугам.',
      level1: 'О, друг! Вы вернули мою рукопись? Или пришли за новой?',
      level2: 'Мудрый друг! Ваши строки живут в моих стихах.',
    },
    questCompletePhrases: [
      'Рукопись возвращена! Вы — герой культуры!',
      'Благодарю! Мои стихи снова в безопасности.',
    ],
    firstMeetingPhrases: [
      'Первый раз вижу вас. Вы любите поэзию?',
      'Новое лицо! Ищете мудрость или просто отдых?',
    ],
  },

  {
    npcId: 'npc_fort_commander',
    role: 'commander',
    region: Region.CAUCASUS,
    nameRu: 'Комендант Ашот',
    baseLines: {
      hello: {
        textRu: 'Комендант Ашот, горная крепость. Монгольские наездники атакуют перевалы. Нужны добровольцы.',
        choices: [
          { labelRu: 'Какая задача?', nextId: 'mission' },
          { labelRu: 'Сколько врагов?', nextId: 'intel' },
          { labelRu: 'Я вернусь', nextId: 'bye' },
        ],
      },
      mission: {
        textRu: 'Монголы атакуют караваны на перевале. Убей пять наездников.',
        choices: [
          { labelRu: 'Принимаю!', nextId: 'quest_accept', action: 'quest', questId: 'side_caucasus_tower_defense' },
          { labelRu: 'Сложная задача', nextId: 'intel' },
        ],
      },
      intel: {
        textRu: 'Около десяти наездников патрулируют перевал.',
        choices: [{ labelRu: 'Понял', nextId: 'bye' }],
      },
      quest_accept: {
        textRu: 'За честь крепости! Не подведите, боец.',
        choices: [{ labelRu: 'Не подведу!', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Горы — наш щит. Но щит нуждается в сильных руках.',
        choices: [{ labelRu: 'Я за вас!', nextId: 'bye' }],
      },
      bye: { textRu: 'С Богом и честью, солдат!', choices: [] },
    },
    randomLines: [
      { id: 'random_mongols', textRu: 'Монголы становятся сильнее. Нужна подготовка.', frequency: 0.4 },
      { id: 'random_pass', textRu: 'Перевалы опасны зимой. Снег закрывает тропы.', when: { hour: 6 }, frequency: 0.3 },
      { id: 'random_victor', textRu: 'Вы победили наездников? Крепость благодарит вас!', when: { questCompleted: 'side_caucasus_tower_defense' }, frequency: 0.7 },
      { id: 'random_army', textRu: 'Шах прислал подкрепление. Мы держим оборону.', when: { minLevel: 25 }, frequency: 0.3 },
      { id: 'random_fortress', textRu: 'Эта крепость стоит 300 лет. Мы — последние потомки древних воинов.', frequency: 0.2 },
    ],
    greetings: {
      level0: 'Комендант Ашот. Нужны добровольцы для обороны.',
      level1: 'О, боец! Вы уже помогали крепости?',
      level2: 'Друг крепости! Горы помнят ваши подвиги.',
    },
    questCompletePhrases: [
      'Перевал очищен! Крепость в безопасности.',
      'Молодец, солдат! Монголы отступили.',
    ],
    firstMeetingPhrases: [
      'Первый раз вижу вас у крепости. Вы из города?',
      'Новый воин! Готовы защищать горы?',
    ],
  },

  {
    npcId: 'npc_desert_scout',
    role: 'scout',
    region: Region.KHORASAN,
    nameRu: 'Проводник Захра',
    baseLines: {
      hello: {
        textRu: 'Захра, проводник караванов через пустыню. Ищешь дорогу или помощь?',
        choices: [
          { labelRu: 'Расскажи о пустыне', nextId: 'lore' },
          { labelRu: 'Мне нужна помощь', nextId: 'help' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      lore: {
        textRu: 'Пустыня Кирман — море песка и смерти. Но в ней скрываются оазисы.',
        choices: [{ labelRu: 'Интересно', nextId: 'extra1' }],
      },
      help: {
        textRu: 'Караван идет через пустыню, но дивы атакуют. Нужен кто-то, кто отгонит их.',
        choices: [
          { labelRu: 'Я справлюсь', nextId: 'quest_accept' },
          { labelRu: 'Это опасно', nextId: 'warning' },
        ],
      },
      warning: {
        textRu: 'Опасно? О, путник, ты ещё не видел настоящего огня.',
        choices: [{ labelRu: 'Ладно, я с вами', nextId: 'quest_accept' }],
      },
      quest_accept: {
        textRu: 'Ты храбр. Или глуп. В пустыне это одно и то же.',
        choices: [{ labelRu: 'Спасибо', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Звёзды — мои спутники. По ним я нахожу путь.',
        choices: [{ labelRu: 'Мудрость', nextId: 'bye' }],
      },
      bye: { textRu: 'Да звёзды ведут тебя.', choices: [] },
    },
    randomLines: [
      { id: 'random_dunes', textRu: 'Песчаные дюны меняют форму каждый день. Путь не постоянен.', frequency: 0.4 },
      { id: 'random_div', textRu: 'Огненные дивы — ужас пустыни. Один взгляд пепелит.', when: { minLevel: 20 }, frequency: 0.3 },
      { id: 'random_oasis', textRu: 'Оазис рядом. Вода есть, но берегитесь скорпионов.', when: { minLevel: 5 }, frequency: 0.5 },
      { id: 'random_praise', textRu: 'Вы убили дива? Невероятно! Пустыня благодарит вас.', when: { questCompleted: 'side_004_sand_storm' }, frequency: 0.7 },
      { id: 'random_night', textRu: 'Ночью в пустыне холодно. Одевайтесь теплее.', when: { hour: 22 }, frequency: 0.4 },
    ],
    greetings: {
      level0: 'Захра, проводник. Ищешь дорогу?',
      level1: 'О, друг! Вы прошли пустыню?',
      level2: 'Герой пустыни! Звёзды ведут вас.',
    },
    questCompletePhrases: [
      'Див убит! Путь безопасен.',
      'Пустыня стала тише. Спасибо вам.',
    ],
    firstMeetingPhrases: [
      'Первый раз вижу вас в пустыне. Вы опытный путник?',
      'Новое лицо! Ищете оазис или опасность?',
    ],
  },

  {
    npcId: 'npc_healer',
    role: 'healer',
    region: Region.SHIRAZ,
    nameRu: 'Целительница Нарэ',
    baseLines: {
      hello: {
        textRu: 'Приветствую, путник. Я Нарэ, целительница. Вижу, ты ранен...',
        choices: [
          { labelRu: 'У меня есть раненые', nextId: 'help' },
          { labelRu: 'Расскажи о Ширазе', nextId: 'lore' },
          { labelRu: 'До свидания', nextId: 'bye' },
        ],
      },
      help: {
        textRu: 'Принеси мне травы — сафран и мяту. Я сварю целебный отвар.',
        choices: [
          { labelRu: 'Принесу травы', nextId: 'quest_accept' },
          { labelRu: 'Что нужно собрать?', nextId: 'ingredients' },
        ],
      },
      ingredients: {
        textRu: 'Сафран растёт на склонах к south. Мята — у ручья близ кладбища.',
        choices: [{ labelRu: 'Понял, иду', nextId: 'bye' }],
      },
      lore: {
        textRu: 'Шираз — город поэтов и садов. Розы здесь пахнут иначе.',
        choices: [{ labelRu: 'Спасибо за рассказ', nextId: 'bye' }],
      },
      quest_accept: {
        textRu: 'Благодарю тебя. Лечение не терпит ожидания.',
        choices: [{ labelRu: 'Вернусь с травами', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Целительство — это не только зелья. Главное — верить в исцеление.',
        choices: [{ labelRu: 'Верю', nextId: 'bye' }],
      },
      bye: { textRu: 'Здоровья тебе, путник.', choices: [] },
    },
    randomLines: [
      { id: 'random_herbs', textRu: 'Травы собирают на рассвете. Тогда они наиболее целебны.', frequency: 0.5 },
      { id: 'random_cemetery', textRu: 'Кладбищенская мята растет рядом с надгробиями. Остерегайтесь нежити.', when: { questActive: 'side_005_graveyard' }, frequency: 0.6 },
      { id: 'random_praise', textRu: 'Вы принесли травы? Больные благодарят вас!', when: { questCompleted: 'side_shiraz_hafiz_manuscript' }, frequency: 0.7 },
      { id: 'random_wound', textRu: 'У вас рана. Нужно обработать.', when: { minLevel: 10 }, frequency: 0.3 },
      { id: 'random_night', textRu: 'Ночью больные нуждаются в особом уходе.', when: { hour: 23 }, frequency: 0.4 },
    ],
    greetings: {
      level0: 'Приветствую, путник. Я Нарэ, целительница.',
      level1: 'О, друг! Вы уже приходили за лечением?',
      level2: 'Мой помощник! Больные вспоминают о вас.',
    },
    questCompletePhrases: [
      'Травы собраны! Больные будут спасены.',
      'Благодарю! Ваша помощь бесценна.',
    ],
    firstMeetingPhrases: [
      'Первый раз вижу вас. Вы ранены?',
      'Новое лицо! Нуждаетесь в лечении?',
    ],
  },

  {
    npcId: 'npc_fisherman',
    role: 'villager',
    region: Region.ISFAHAN,
    nameRu: 'Рыбак Тигран',
    baseLines: {
      hello: {
        textRu: 'Тигран, рыбак. Ловлю рыбу в озере и продаю на базаре. Что привело тебя к воде?',
        choices: [
          { labelRu: 'Расскажи о порте', nextId: 'lore' },
          { labelRu: 'Есть работа?', nextId: 'work' },
          { labelRu: 'Я просто рыбак', nextId: 'bye' },
        ],
      },
      lore: {
        textRu: 'Порт — gateway к морю. Отсюда идут корабли в Персидский залив.',
        choices: [{ labelRu: 'Интересно', nextId: 'bye' }],
      },
      work: {
        textRu: 'Работа? Если хочешь, можешь помочь ловить рыбу.',
        choices: [{ labelRu: 'Пойду к лодочнику', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Рыба — это жизнь. Без рыбы нет еды.',
        choices: [{ labelRu: 'Верно сказано', nextId: 'bye' }],
      },
      bye: { textRu: 'Удачной ловли, друг!', choices: [] },
    },
    randomLines: [
      { id: 'random_fish', textRu: 'Рыбы в этом году много. Озеро щедлое.', frequency: 0.5 },
      { id: 'random_ships', textRu: 'Корабли приходят редко. Обычно только торговые.', when: { minLevel: 10 }, frequency: 0.3 },
      { id: 'random_storm', textRu: 'Будет шторм. Не выходите в море сегодня.', when: { hour: 17 }, frequency: 0.4 },
      { id: 'random_janissary', textRu: 'Янычары появились у порта. Будьте осторожны.', when: { questActive: 'side_gulf_smuggler_rings' }, frequency: 0.5 },
      { id: 'random_help', textRu: 'Вы помогли с рыбой? Спасибо!', when: { questCompleted: 'side_gulf_smuggler_rings' }, frequency: 0.6 },
    ],
    greetings: {
      level0: 'Тигран, рыбак. Что привело тебя?',
      level1: 'О, друг! Опять за рыбой?',
      level2: 'Помощник Тиграна! Рыба благодарит.',
    },
    questCompletePhrases: [
      'Порт безопасен! Рыбаки смогут работать.',
      'Спасибо за помощь! Залив стал спокойнее.',
    ],
    firstMeetingPhrases: [
      'Первый раз вижу вас у озера. Вы рыбачите?',
      'Новое лицо! Ищете рыбу или просто отдыхаете?',
    ],
  },

  {
    npcId: 'npc_harbor_master',
    role: 'merchant',
    region: Region.PERSIAN_GULF,
    nameRu: 'Хозяйка пристани Лейла',
    baseLines: {
      hello: {
        textRu: 'Лейла, хозяйка этой пристани. Порт — моя жизнь.',
        choices: [
          { labelRu: 'Есть задания?', nextId: 'quest' },
          { labelRu: 'Расскажи о заливе', nextId: 'lore' },
          { labelRu: 'Просто смотрю', nextId: 'bye' },
        ],
      },
      quest: {
        textRu: 'Янычары беспокоят судоходство. Нужно устранить их — хотя бы 15 янычар.',
        choices: [
          { labelRu: 'Приму задание', nextId: 'quest_accept', action: 'quest', questId: 'side_gulf_smuggler_rings' },
          { labelRu: 'Многовато...', nextId: 'comfort' },
        ],
      },
      lore: {
        textRu: 'Персидский залив — жила Империи. Через него идёт торговля.',
        choices: [{ labelRu: 'Понятно', nextId: 'bye' }],
      },
      comfort: {
        textRu: 'Безопасность завета стоит усилий. Подумай — без нас никто не привезёт ваши товары.',
        choices: [{ labelRu: 'Ладно, беру', nextId: 'quest_accept', action: 'quest', questId: 'side_gulf_smuggler_rings' }],
      },
      quest_accept: {
        textRu: 'Благодарю! Залив станет безопаснее.',
        choices: [{ labelRu: 'Не за что', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Море — моя страсть. Каждый шторм — это испытание.',
        choices: [{ labelRu: 'Уважение', nextId: 'bye' }],
      },
      bye: { textRu: 'Да будет ветер попутным!', choices: [] },
    },
    randomLines: [
      { id: 'random_ships', textRu: 'Корабли приходят каждый день. Торговля жива.', frequency: 0.5 },
      { id: 'random_janissary', textRu: 'Янычары стали чаще появляться. Нужно держать оборону.', when: { questActive: 'side_gulf_smuggler_rings' }, frequency: 0.6 },
      { id: 'random_praise', textRu: 'Вы убили янычар? Залив благодарит вас!', when: { questCompleted: 'side_gulf_smuggler_rings' }, frequency: 0.8 },
      { id: 'random_storm', textRu: 'Будет шторм. Якорьте суда.', when: { hour: 18 }, frequency: 0.3 },
      { id: 'random_trader', textRu: 'Торговцы жалуются на пиратов. Нужна охрана.', when: { minLevel: 15 }, frequency: 0.4 },
    ],
    greetings: {
      level0: 'Лейла, хозяйка пристани. Чем могу помочь?',
      level1: 'О, друг! Вы помогли порту?',
      level2: 'Защитник залива! Порт помнит вас.',
    },
    questCompletePhrases: [
      'Залив безопасен! Торговля продолжится.',
      'Янычары отступили. Спасибо за помощь!',
    ],
    firstMeetingPhrases: [
      'Первый раз вижу вас у пристани. Вы моряк?',
      'Новое лицо! Ищете корабль илитовары?',
    ],
  },

  {
    npcId: 'npc_craftsman',
    role: 'craftsman',
    region: Region.ISFAHAN,
    nameRu: 'Кузнец Омар',
    baseLines: {
      hello: {
        textRu: 'Омар кузнец. Кою мечи, чиню доспехи. Нужна работа?',
        choices: [
          { labelRu: 'Что можете предложить?', nextId: 'craft' },
          { labelRu: 'Расскажи о кузнечном деле', nextId: 'lore' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      craft: {
        textRu: 'Могу заточить твоё оружие. Или отковать новое — если принесёшь руду.',
        choices: [
          { labelRu: 'Заточить оружие', nextId: 'enhance' },
          { labelRu: 'Отковать меч', nextId: 'forge' },
          { labelRu: 'Подумаю', nextId: 'bye' },
        ],
      },
      enhance: {
        textRu: 'Заточка — дело тонкое. Каждый уровень повышает урон.',
        choices: [{ labelRu: 'Начнём!', nextId: 'bye' }],
      },
      forge: {
        textRu: 'Железный меч — 60 золотых. Или 8 слитков руды.',
        choices: [{ labelRu: 'Делайте', nextId: 'bye' }],
      },
      lore: {
        textRu: 'Кузнечное дело — это искусство. Каждый меч — произведение.',
        choices: [{ labelRu: 'Уважение к ремеслу', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Огонь горна — мой второй дом.',
        choices: [{ labelRu: 'Понимаю', nextId: 'bye' }],
      },
      bye: { textRu: 'Заходи, кузнец всегда открыт!', choices: [] },
    },
    randomLines: [
      { id: 'random_fire', textRu: 'Горн должен быть горячим. Искра — признак мастерства.', frequency: 0.5 },
      { id: 'random_ore', textRu: 'Руды мало. Добыча сложная.', when: { minLevel: 10 }, frequency: 0.3 },
      { id: 'random_weapon', textRu: 'Ваш меч требует заточки. Приносите!', when: { hasItem: 'wpn_iron_sword' }, frequency: 0.4 },
      { id: 'random_praise', textRu: 'Вы носите хороший меч. Сам ковал для кызылбашей.', when: { questCompleted: 'main_002_first_blood' }, frequency: 0.5 },
      { id: 'random_night', textRu: 'Ночью кузница работает до свету. Заказов много.', when: { hour: 22 }, frequency: 0.3 },
    ],
    greetings: {
      level0: 'Омар кузнец. Нужна работа?',
      level1: 'О, друг! Ваш меч требует внимания?',
      level2: 'Мастер! Давайте обсудим новый заказ.',
    },
    questCompletePhrases: [
      'Меч готов! Он будет служить верно.',
      'Заточка выполнена. Оружие острое.',
    ],
    firstMeetingPhrases: [
      'Первый раз вижу вас у горна. Вы кузнец?',
      'Новое лицо! Нуждаетесь в оружии?',
    ],
  },

  {
    npcId: 'npc_stable_master',
    role: 'merchant',
    region: Region.ISFAHAN,
    nameRu: 'Конюх Фархад',
    baseLines: {
      hello: {
        textRu: 'Фархад, конюший при конюшне Исфахана. Лошади, верблюды — у нас всё есть.',
        choices: [
          { labelRu: 'Какие есть?', nextId: 'horses' },
          { labelRu: 'Сколько стоят?', nextId: 'prices' },
          { labelRu: 'Просто смотрю', nextId: 'bye' },
        ],
      },
      horses: {
        textRu: 'Арабский скакун — быстрый. Верблюд — выносливый. Боевой конь Кызылбаша — лучший для войны.',
        choices: [
          { labelRu: 'Арабского скакуна!', nextId: 'buy' },
          { labelRu: 'Верблюда', nextId: 'buy_camel' },
          { labelRu: 'Боевого коня', nextId: 'buy_warhorse' },
        ],
      },
      prices: {
        textRu: 'Арабский скакун — 5000 золотых. Верблюд — 8000. Боевой конь — 25000.',
        choices: [{ labelRu: 'Подумаю', nextId: 'bye' }],
      },
      buy: {
        textRu: 'Отличный выбор! Скакун доставит вас быстрее ветра.',
        choices: [{ labelRu: 'Беру!', nextId: 'bye' }],
      },
      buy_camel: {
        textRu: 'Верблюд — надежный друг в пустыне.',
        choices: [{ labelRu: 'Беру!', nextId: 'bye' }],
      },
      buy_warhorse: {
        textRu: 'Боевой конь Кызылбаша — гордость Империи.',
        choices: [{ labelRu: 'Беру!', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Лошадь — не просто транспорт. Это партнёр, друг, спаситель.',
        choices: [{ labelRu: 'Верю', nextId: 'bye' }],
      },
      bye: { textRu: 'С Богом в путь!', choices: [] },
    },
    randomLines: [
      { id: 'random_horses', textRu: 'Новые лошади из Аравии. Быстрые и выносливые.', frequency: 0.5 },
      { id: 'random_camel', textRu: 'Верблюды нужны для караванов. Спрос растет.', when: { questActive: 'daily_silk_delivery' }, frequency: 0.4 },
      { id: 'random_rich', textRu: 'У вас достаточно золота для боевого коня?', when: { minGold: 20000 }, frequency: 0.3 },
      { id: 'random_stolen', textRu: 'Некоторые лошади украдены разбойниками. Следите за конюшней!', when: { questActive: 'side_011_stolen_horses' }, frequency: 0.5 },
      { id: 'random_praise', textRu: 'Вы вернули коней? Конюшня благодарит!', when: { questCompleted: 'side_011_stolen_horses' }, frequency: 0.7 },
    ],
    greetings: {
      level0: 'Фархад, конюший. Нужна лошадь?',
      level1: 'О, друг! Ваш конь требует ухода?',
      level2: 'Партнёр! Давайте выберем лучшего скакуна.',
    },
    questCompletePhrases: [
      'Коней вернули! Конюшня снова полна.',
      'Спасибо! Лошади будут служить верно.',
    ],
    firstMeetingPhrases: [
      'Первый раз видите конюшню? Добро пожаловать!',
      'Новое лицо! Ищете коня или верблюда?',
    ],
  },

  {
    npcId: 'npc_desert_master',
    role: 'merchant',
    region: Region.KHORASAN,
    nameRu: 'Караван-баши Рахим',
    baseLines: {
      hello: {
        textRu: 'Рахим, караван-баши. Мой караван отдыхаёт здесь. Шёлк, специи, драгоценности.',
        choices: [
          { labelRu: 'Что есть интересного?', nextId: 'shop' },
          { labelRu: 'Расскажи о караване', nextId: 'lore' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      shop: {
        textRu: 'У нас бирюза — лучший камень в мире. 400 золотых за камень.',
        choices: [
          { labelRu: 'Бирюза, пожалуйста', nextId: 'buy_turquoise' },
          { labelRu: 'Дорого...', nextId: 'bye' },
        ],
      },
      buy_turquoise: {
        textRu: 'Бирюза из Нейшабура — символ Персии.',
        choices: [{ labelRu: 'Красиво', nextId: 'bye' }],
      },
      lore: {
        textRu: 'Караван идёт 40 дней. 200 верблюдов, 50 человек.',
        choices: [{ labelRu: 'Уважаю труд', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Пустыня учит одному: доверяй тому, кто идёт рядом.',
        choices: [{ labelRu: 'Верю', nextId: 'bye' }],
      },
      bye: { textRu: 'С Богом в путь!', choices: [] },
    },
    randomLines: [
      { id: 'random_caravan', textRu: 'Караван придёт через день. Терпение — ключ к торговле.', frequency: 0.5 },
      { id: 'random_div', textRu: 'Дивы стали чаще появляться. Путь опасен.', when: { minLevel: 20 }, frequency: 0.3 },
      { id: 'random_silk', textRu: 'Шёлк из Гиляна — лучший в мире. Хотите рулон?', when: { questActive: 'daily_silk_delivery' }, frequency: 0.4 },
      { id: 'random_rich', textRu: 'У вас есть золото для редких камней?', when: { minGold: 5000 }, frequency: 0.3 },
      { id: 'random_night', textRu: 'Ночью в пустыне холодно. Разведите огонь.', when: { hour: 21 }, frequency: 0.4 },
    ],
    greetings: {
      level0: 'Рахим, караван-баши. Нужен товар?',
      level1: 'О, друг! Ваш караван ожидает?',
      level2: 'Партнёр! Давайте обсудим сделку.',
    },
    questCompletePhrases: [
      'Караван безопасен! Торговля продолжится.',
      'Спасибо за помощь! Путь открыт.',
    ],
    firstMeetingPhrases: [
      'Первый раз видите караван? Добро пожаловать!',
      'Новое лицо! Ищете товар или путь?',
    ],
  },

  {
    npcId: 'npc_village_trader',
    role: 'merchant',
    region: Region.TABRIZ,
    nameRu: 'Торговка Ануш',
    baseLines: {
      hello: {
        textRu: 'Ануш, торговка из деревни. У меня есть всё необходимое для путника.',
        choices: [
          { labelRu: 'Показать товары', nextId: 'shop' },
          { labelRu: 'Есть новости?', nextId: 'news' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      shop: {
        textRu: 'Малое зелье здоровья — 5 серебра. Еда для стамина — 7 серебра.',
        choices: [
          { labelRu: 'Беру зелье', nextId: 'buy' },
          { labelRu: 'Дороговато', nextId: 'bye' },
        ],
      },
      news: {
        textRu: 'Новости? Разбойники стали чаще appear. Стражник Бахрам жалуется.',
        choices: [{ labelRu: 'Спасибо', nextId: 'bye' }],
      },
      buy: {
        textRu: 'Вот ваше зелье! Выпейте на здоровье.',
        choices: [{ labelRu: 'Благодарю', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Торговля в деревне — это служба. Люди зависят от того, что привезёшь.',
        choices: [{ labelRu: 'Понимаю', nextId: 'bye' }],
      },
      bye: { textRu: 'Заходи ещё, друг!', choices: [] },
    },
    randomLines: [
      { id: 'random_goods', textRu: 'Новые товары пришли с караваном. Есть что посмотреть.', frequency: 0.5 },
      { id: 'random_bandits', textRu: 'Разбойники грабят дорогу. Будь осторожен.', when: { questActive: 'main_002_first_blood' }, frequency: 0.4 },
      { id: 'random_done', textRu: 'Разбойники побеждены? Деревня в безопасности!', when: { questCompleted: 'main_002_first_blood' }, frequency: 0.6 },
      { id: 'random_poor', textRu: 'У меня мало золота. Может, поменяетесь?', when: { maxGold: 50 }, frequency: 0.5 },
      { id: 'random_rich', textRu: 'Вы выглядите богato. Может, купите что-нибудь?', when: { minGold: 500 }, frequency: 0.4 },
    ],
    greetings: {
      level0: 'Ануш, торговка. Нужен товар?',
      level1: 'О, друг! Зашли за зельями?',
      level2: 'Партнёр! У меня есть особенные товары.',
    },
    questCompletePhrases: [
      'Деревня безопасна! Спасибо за помощь.',
      'Разбойники побеждены! Торговля продолжится.',
    ],
    firstMeetingPhrases: [
      'Первый раз видите мою лавку? Добро пожаловать!',
      'Новое лицо! Нуждаетесь в товаре?',
    ],
  },

  {
    npcId: 'npc_woodcutter',
    role: 'villager',
    region: Region.TABRIZ,
    nameRu: 'Дровосек Гурген',
    baseLines: {
      hello: {
        textRu: 'Гурген, рублю дрова. Работа тяжёлая, но честная.',
        choices: [
          { labelRu: 'Расскажи о лесе', nextId: 'lore' },
          { labelRu: 'Есть работа?', nextId: 'work' },
          { labelRu: 'До свидания', nextId: 'bye' },
        ],
      },
      lore: {
        textRu: 'Лес вокруг деревни густой. Волки, зайцы, птицы...',
        choices: [{ labelRu: 'Надо Cleanupать', nextId: 'bye' }],
      },
      work: {
        textRu: 'Работа? Я бы с радостью пошел за дровами, но волки загнали меня в угол.',
        choices: [{ labelRu: 'Я разберусь с волками', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Топор — лучший друг дровосека.',
        choices: [{ labelRu: 'Осторожно', nextId: 'bye' }],
      },
      bye: { textRu: 'Береги себя, друг!', choices: [] },
    },
    randomLines: [
      { id: 'random_woods', textRu: 'Лес даёт нам дрова и еду. Берегите его.', frequency: 0.5 },
      { id: 'random_wolves', textRu: 'Волки стали агрессивнее lately. Может, охотник Хасан поможет?', when: { questActive: 'side_002_wolf_pelts' }, frequency: 0.4 },
      { id: 'random_done', textRu: 'Волки побеждены? Можно выйти в лес!', when: { questCompleted: 'side_002_wolf_pelts' }, frequency: 0.6 },
      { id: 'random_axe', textRu: 'Мой топор — старому другу. Не теряю его.', frequency: 0.3 },
      { id: 'random_scorpions', textRu: 'Скорпионы тоже полезли из пустыни.', when: { questActive: 'side_001_scorpion_nest' }, frequency: 0.3 },
    ],
    greetings: {
      level0: 'Гурген, дровосек. Чем помочь?',
      level1: 'О, друг! Волки больше не мешают?',
      level2: 'Герой леса! Спасибо за помощь.',
    },
    questCompletePhrases: [
      'Волки побеждены! Лес снова безопасен.',
      'Спасибо! Можно выйти за дровами.',
    ],
    firstMeetingPhrases: [
      'Первый раз видите меня за работой? Я Гурген.',
      'Новое лицо! Нуждаетесь в дровах?',
    ],
  },

  {
    npcId: 'npc_fort_guide',
    role: 'guide',
    region: Region.CAUCASUS,
    nameRu: 'Проводник Сирина',
    baseLines: {
      hello: {
        textRu: 'Сирина, проводник горных перевалов. Знаю каждую тропу.',
        choices: [
          { labelRu: 'Куда ведёт тропа?', nextId: 'paths' },
          { labelRu: 'Есть работа?', nextId: 'work' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      paths: {
        textRu: 'Тропа на север ведёт к Тебризу. На восток — в Месопотамию.',
        choices: [{ labelRu: 'Благодарю', nextId: 'bye' }],
      },
      work: {
        textRu: 'Работа? Комендант Ашот ищет добровольцев для охраны перевалов.',
        choices: [
          { labelRu: 'Иду к коменданту', nextId: 'commander_npc', action: 'move' },
          { labelRu: 'Спасибо за информацию', nextId: 'bye' },
        ],
      },
      commander_npc: {
        textRu: 'Комендант Ашот в крепости. Обратись к нему.',
        choices: [{ labelRu: 'Иду', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Горы учат терпению. Каждый подъём — это урок.',
        choices: [{ labelRu: 'Мудрость гор', nextId: 'bye' }],
      },
      bye: { textRu: 'С Божиим благословением!', choices: [] },
    },
    randomLines: [
      { id: 'random_mountains', textRu: 'Горы прекрасны весной. Цветы покрывают склоны.', frequency: 0.5 },
      { id: 'random_pass', textRu: 'Перевалы закрыты снегом. Ждите весны.', when: { hour: 6 }, frequency: 0.3 },
      { id: 'random_mongols', textRu: 'Монголы стали чаще появляться у перевалов.', when: { questActive: 'side_caucasus_tower_defense' }, frequency: 0.4 },
      { id: 'random_done', textRu: 'Перевалы очищены? Отлично!', when: { questCompleted: 'side_caucasus_tower_defense' }, frequency: 0.6 },
      { id: 'random_night', textRu: 'Ночью в горах холодно. Разведите огонь.', when: { hour: 22 }, frequency: 0.4 },
    ],
    greetings: {
      level0: 'Сирина, проводник. Нужна тропа?',
      level1: 'О, друг! Вы уже прошли перевалы?',
      level2: 'Герой гор! Знаю ваш путь.',
    },
    questCompletePhrases: [
      'Перевалы очищены! Дорога открыта.',
      'Спасибо! Горы станут безопаснее.',
    ],
    firstMeetingPhrases: [
      'Первый раз видите меня на перевале? Я Сирина.',
      'Новое лицо! Ищете тропу?',
    ],
  },

  {
    npcId: 'npc_fort_smith',
    role: 'craftsman',
    region: Region.CAUCASUS,
    nameRu: 'Оружейник Вахтанг',
    baseLines: {
      hello: {
        textRu: 'Вахтанг, оружейник горной крепости. Кую клинки для стражи.',
        choices: [
          { labelRu: 'Что можете предложить?', nextId: 'shop' },
          { labelRu: 'Расскажи о крепости', nextId: 'lore' },
          { labelRu: 'До свидания', nextId: 'bye' },
        ],
      },
      shop: {
        textRu: 'Горный меч — 3000 золотых. Прочный, как скалы.',
        choices: [{ labelRu: 'Закажите', nextId: 'bye' }],
      },
      lore: {
        textRu: 'Крепость стоит на скале 300 лет. Мы — потомки древних кузнецов.',
        choices: [{ labelRu: 'Уважение', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Меч — не просто оружие. Это продолжение руки воина.',
        choices: [{ labelRu: 'Философски', nextId: 'bye' }],
      },
      bye: { textRu: 'Берегите клинок!', choices: [] },
    },
    randomLines: [
      { id: 'random_forge', textRu: 'Горн работает день и ночь. Заказов много.', frequency: 0.5 },
      { id: 'random_mongols', textRu: 'Монголы ломают оружие. Нужны новые клинки.', when: { questActive: 'side_caucasus_tower_defense' }, frequency: 0.4 },
      { id: 'random_done', textRu: 'Вы победили монголов? Крепость благодарит!', when: { questCompleted: 'side_caucasus_tower_defense' }, frequency: 0.6 },
      { id: 'random_steel', textRu: 'Сталь из Кавказа — лучшая в Персии.', frequency: 0.3 },
      { id: 'random_night', textRu: 'Ночью кузница не спит. Заказы не ждут.', when: { hour: 23 }, frequency: 0.4 },
    ],
    greetings: {
      level0: 'Вахтанг, оружейник. Нужен меч?',
      level1: 'О, друг! Ваш клинок требует заточки?',
      level2: 'Мастер! Давайте обсудим новый заказ.',
    },
    questCompletePhrases: [
      'Враги отступили! Крепость в безопасности.',
      'Спасибо! Клинок будет служить верно.',
    ],
    firstMeetingPhrases: [
      'Первый раз видите меня у горна? Я Вахтанг.',
      'Новое лицо! Нуждаетесь в оружии?',
    ],
  },

  {
    npcId: 'npc_sailor',
    role: 'villager',
    region: Region.ISFAHAN,
    nameRu: 'Кок Салим',
    baseLines: {
      hello: {
        textRu: 'Салим, кок на корабле. Готовлю еду для команды.',
        choices: [
          { labelRu: 'Расскажи о море', nextId: 'sea' },
          { labelRu: 'Есть работа?', nextId: 'work' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      sea: {
        textRu: 'Море — это мир. Бескрайний, опасный, прекрасный.',
        choices: [{ labelRu: 'Рассказывайте ещё', nextId: 'extra1' }],
      },
      work: {
        textRu: 'Работа? Корабль уходит через день. Но это тяжёлый труд.',
        choices: [{ labelRu: 'Я не моряк', nextId: 'bye' }],
      },
      extra1: {
        textRu: 'Море кормит, но и забирает. Кто вышел в море — тот уже не принадлежит себе.',
        choices: [{ labelRu: 'Мудрость', nextId: 'bye' }],
      },
      bye: { textRu: 'Ровного ветра!', choices: [] },
    },
    randomLines: [
      { id: 'random_fish', textRu: 'Свежая рыба — лучшее блюдо на корабле.', frequency: 0.5 },
      { id: 'random_ship', textRu: 'Корабль придёт завтра. Товары будут.', when: { minLevel: 10 }, frequency: 0.3 },
      { id: 'random_janissary', textRu: 'Янычары появились у порта. Будьте осторожны.', when: { questActive: 'side_gulf_smuggler_rings' }, frequency: 0.4 },
      { id: 'random_done', textRu: 'Порт безопасен? Отлично, можно грузить!', when: { questCompleted: 'side_gulf_smuggler_rings' }, frequency: 0.6 },
      { id: 'random_storm', textRu: 'Будет шторм. Укрывайтетовары.', when: { hour: 17 }, frequency: 0.3 },
    ],
    greetings: {
      level0: 'Салим, кок. Нужна еда?',
      level1: 'О, друг! Вы уже были в море?',
      level2: 'Морской волк! Рад видеть.',
    },
    questCompletePhrases: [
      'Порт безопасен! Можно грузить.',
      'Спасибо! Море успокоилось.',
    ],
    firstMeetingPhrases: [
      'Первый раз видите меня на корабле? Я Салим.',
      'Новое лицо! Нуждаетесь в еде?',
    ],
  },

  {
    npcId: 'npc_gate_guard_l',
    role: 'guard',
    region: Region.ISFAHAN,
    nameRu: 'Стражник Фарид',
    baseLines: {
      hello: {
        textRu: 'Фарид, стражник левых ворот. Справа стоит Кавус.',
        choices: [
          { labelRu: 'Как дела?', nextId: 'extra1' },
          { labelRu: 'Пройти', nextId: 'bye' },
        ],
      },
      extra1: {
        textRu: 'Скучно, но честно. Лучше бы враг подошёл.',
        choices: [{ labelRu: 'Будет дело', nextId: 'bye' }],
      },
      bye: { textRu: 'Проходи, друг!', choices: [] },
    },
    randomLines: [
      { id: 'random_bored', textRu: 'Скучно стоять на воротах. Хоть бы враг появился.', frequency: 0.5 },
      { id: 'random_bandits', textRu: 'Разбойники у Тебриза стали наглее. Нужно усилить патруль.', when: { questActive: 'main_002_first_blood' }, frequency: 0.4 },
      { id: 'random_praise', textRu: 'Вы победили разбойников? Ворота безопаснее!', when: { questCompleted: 'main_002_first_blood' }, frequency: 0.6 },
      { id: 'random_night', textRu: 'Ночью особенно тихо. Не люблю ночную вахту.', when: { hour: 23 }, frequency: 0.4 },
      { id: 'random_morning', textRu: 'Рассвет — лучшее время на воротах. Солнце, птицы...', when: { hour: 6 }, frequency: 0.3 },
    ],
    greetings: {
      level0: 'Фарид, стражник. Проходите.',
      level1: 'О, друг! Опять на вахту?',
      level2: 'Герой ворот! Спасибо за защиту.',
    },
    questCompletePhrases: [
      'Ворота безопасны! Спасибо за помощь.',
      'Разбойники побеждены! Исфахан в безопасности.',
    ],
    firstMeetingPhrases: [
      'Первый раз видите меня у ворот? Я Фарид.',
      'Новое лицо! Проходите спокойно.',
    ],
  },

  {
    npcId: 'npc_auctioneer',
    role: 'merchant',
    region: Region.ISFAHAN,
    nameRu: 'Аукционист',
    baseLines: {
      hello: {
        textRu: 'Аукционист при Аукционном Доме Исфахана. Здесь можно купить и продать всё.',
        choices: [
          { labelRu: 'Открыть аукцион', nextId: 'auction' },
          { labelRu: 'Выставить лот', nextId: 'sell' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      auction: {
        textRu: 'Текущие лоты: мечи, доспехи, зелья. Ставки принимаются до истечения времени.',
        choices: [{ labelRu: 'Смотрю лоты', nextId: 'bye' }],
      },
      sell: {
        textRu: 'Выставить лот — просто. Определи цену, укажи предмет. Комиссия 3%.',
        choices: [{ labelRu: 'Понятно', nextId: 'bye' }],
      },
      bye: { textRu: 'Удачных сделок!', choices: [] },
    },
    randomLines: [
      { id: 'random_auction', textRu: 'Сегодня хороший день для аукциона. Много покупателей.', frequency: 0.5 },
      { id: 'random_rich', textRu: 'Богатые клиенты покупают всё. Мечи, камни, украшения.', when: { minGold: 5000 }, frequency: 0.3 },
      { id: 'random_bargain', textRu: 'Бюджетные лоты тоже есть. Для экономных.', when: { maxGold: 100 }, frequency: 0.4 },
      { id: 'random_silk', textRu: 'Шёлк снова в моде. Цена выросла.', when: { questActive: 'daily_silk_delivery' }, frequency: 0.3 },
      { id: 'random_commission', textRu: 'Комиссия 3% — справедливая цена за услуги.', frequency: 0.5 },
    ],
    greetings: {
      level0: 'Аукционист. Нужен товар?',
      level1: 'О, друг! Хотите выставить лот?',
      level2: 'Партнёр аукциона! У нас есть особенные items.',
    },
    questCompletePhrases: [
      'Сделка совершена! Комиссия уплачена.',
      'Аукцион успешен! Все довольны.',
    ],
    firstMeetingPhrases: [
      'Первый раз видите меня на аукционе? Я аукционист.',
      'Новое лицо! Хотите купить или продать?',
    ],
  },
];

/** Получить профиль NPC по id */
export function getNpcDynamicProfile(npcId: string): NpcDynamicProfile | null {
  return NPC_DYNAMIC_PROFILES.find(p => p.npcId === npcId) ?? null;
}
