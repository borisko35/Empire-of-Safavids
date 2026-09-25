// ============================================================
// NPC Dialogue System — Empire of Safavids
// ============================================================
// Каждый NPC знает свой регион, имеет роль, персонажа и набор
// реплик. Диалоги выбираютсся динамически из пула, добавляя
// контекст: уровень игрока, активные квесты, время суток.

import { Region } from '../types/game.types';

export type NpcRole =
  | 'guard'       // стражник
  | 'merchant'    // торговец
  | 'quest_giver' // квестодатель
  | 'mystic'      // суфий/мистик
  | 'guide'       // проводник
  | 'craftsman'   // ремесленник
  | 'villager'    // деревенский
  | 'commander'   // командир
  | 'scout'       // разведчик
  | 'healer';     // целитель

export interface NpcDialogLine {
  /** Уникальный id реплики */
  id: string;
  /** Текст реплики NPC */
  textRu: string;
  /** Варианты выбора игрока (null = монолог, можно продолжить) */
  choices?: NpcDialogChoice[];
}

export interface NpcDialogChoice {
  /** Текст кнопки */
  labelRu: string;
  labelEn?: string;
  labelAz?: string;
  /** Переход к следующей реплике (id) */
  nextId: string;
  /** Действие при выборе: 'quest', 'trade', 'item', 'leave' */
  action?: 'quest' | 'trade' | 'item' | 'move' | 'close';
  /** ID квеста (для action: 'quest') */
  questId?: string;
  /** ID предмета (для action: 'item') */
  itemId?: string;
  /** Условие показа выбора */
  when?: { minLevel?: number; questActive?: string; questCompleted?: string };
}

export interface NpcDialogEntry {
  /** Id NPC (как в QUEST_NPC_ALIAS / NPC_WORLD_POSITIONS) */
  npcId: string;
  /** Роль NPC */
  role: NpcRole;
  /** Регион, где живёт NPC */
  region: Region;
  /** Имя NPC */
  nameRu: string;
  /** Список реплик: key -> entry */
  lines: Record<string, NpcDialogLine>;
  /** Id первой реплики (hello) */
  helloLine: string;
  /** Шутливые/дополнительные реплики для повторного разговора */
  extraLines: string[];
  /** Фразы первого знакомства */
  firstMeetingPhrases?: string[];
  /** Фразы при высокой дружбе */
  friendlyPhrases?: string[];
  /** Динамические приветствия по уровням дружбы */
  greetings?: {
    level0: string; // незнакомец
    level1: string; // знакомый
    level2: string; // друг
  };
  /** Фразы при завершении квеста */
  questCompletePhrases?: string[];
  /** Случайные реплики с условиями */
  randomLines?: {
    id: string;
    textRu: string;
    when?: { minLevel?: number; questActive?: string; questCompleted?: string; hour?: number };
    frequency?: number;
  }[];
}

export const NPC_DIALOGUES: NpcDialogEntry[] = [

  // ── Исфахан ──────────────────────────────────────────────────

  {
    npcId: 'npc_quest_crier',
    role: 'quest_giver',
    region: Region.ISFAHAN,
    nameRu: 'Глашатай Шаха',
    helloLine: 'hello',
    extraLines: ['extra1', 'extra2'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Шах Исмаил призывает лучших воинов! Исфахан нуждается в героях. Разбойники душат торговые пути, а османские шпионы сеют смуту.',
        choices: [
          { labelRu: 'Какие квесты доступны?', nextId: 'quests' },
          { labelRu: 'Расскажи о Шехе', nextId: 'shah' },
          { labelRu: 'До свидания', nextId: 'bye' },
        ],
      },
      quests: {
        id: 'quests',
        textRu: 'Стражник Рустам на востоке базара поручит тебе дело. А суфий Мевлана ищет тех, кто очистит город от ассасинов.',
        choices: [
          { labelRu: 'К Рустаму', nextId: 'guard_npc', action: 'move' },
          { labelRu: 'К Мевлане', nextId: 'mystic_npc', action: 'move' },
          { labelRu: 'Благодарю', nextId: 'bye' },
        ],
      },
      shah: {
        id: 'shah',
        textRu: 'Шах Исмаил I — основатель Сефевидской империи. Он объединил Персию и сделал шиизм государственной религией. Его гвардия кызылбашей — гордость Империи.',
        choices: [
          { labelRu: 'Хочу служить Шаху', nextId: 'quest_offer' },
          { labelRu: 'Интересно...', nextId: 'bye' },
        ],
      },
      quest_offer: {
        id: 'quest_offer',
        textRu: 'Тогда отправляйся к командиру гарнизона — он даст первое задание. Докажи свою преданность.',
        choices: [
          { labelRu: 'Иду к командиру', nextId: 'bye', action: 'move' },
        ],
      },
      guard_npc: {
        id: 'guard_npc',
        textRu: 'Стражник Рустам стоит у восточных ворот. Обратись к нему за поручениями.',
        choices: [{ labelRu: 'Понятно', nextId: 'bye' }],
      },
      mystic_npc: {
        id: 'mystic_npc',
        textRu: 'Суфий Мевлана медитирует у мечети. Он видит больше, чем кажется.',
        choices: [{ labelRu: 'Понятно', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Город красив, не правда ли? Мечеть Имам — чудо архитектуры. Но за стенами — опасность.',
        choices: [{ labelRu: 'Расскажи про опасность', nextId: 'extra2' }],
      },
      extra2: {
        id: 'extra2',
        textRu: 'Османы давят с запада, а внутри — интриги. Только сильные духом выживут в этой игре.',
        choices: [{ labelRu: 'Я готов', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Да хранит тебя Аллах. Враги Империи не ждут.',
        choices: [],
      },
    },
  },

  {
    npcId: 'npc_guard_east',
    role: 'guard',
    region: Region.ISFAHAN,
    nameRu: 'Стражник Рустам',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Стой! Ты не местный? ..Ладно, вид у тебя боевой. Я Рустам, командир восточных ворот. Нам нужны добровольцы — разбойники у ворот стали наглецее.',
        choices: [
          { labelRu: 'Что нужно сделать?', nextId: 'mission' },
          { labelRu: 'А что за разбойники?', nextId: 'lore' },
          { labelRu: 'Я вернусь позже', nextId: 'bye' },
        ],
      },
      mission: {
        id: 'mission',
        textRu: 'Уничтожь разбойников-разведчиков на дорогах к Тебризу. Их лагерь к северу от города. Принеси мне доказательства — 10 голов.',
        choices: [
          { labelRu: 'Приму задание', nextId: 'quest_accept', action: 'quest', questId: 'main_002_first_blood' },
          { labelRu: 'Мне нужно оружие', nextId: 'gear' },
          { labelRu: 'Я справлюсь', nextId: 'bye' },
        ],
      },
      lore: {
        id: 'lore',
        textRu: 'Разбойники — бывшие крестьяне, угнанные голодом. Но теперь они грабят караваны без разбора. Мне всё равно, кто они были.',
        choices: [{ labelRu: 'Понятно', nextId: 'bye' }],
      },
      gear: {
        id: 'gear',
        textRu: 'Купишь у торговца на базаре. Или найди что-нибудь на теле убитых.',
        choices: [{ labelRu: 'Иду на базар', nextId: 'bye', action: 'move' }],
      },
      quest_accept: {
        id: 'quest_accept',
        textRu: 'Отлично. Вернёшься — доложишь. Удачи, боец.',
        choices: [{ labelRu: 'Будет сделано!', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Сколько раз я это слышал... Все говорили "справлюсь". Но ты выглядишь уверенным.',
        choices: [{ labelRu: 'Я справлюсь', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Береги себя. Нам нужны живые герои, не мёртвые.',
        choices: [],
      },
    },
  },

  {
    npcId: 'npc_bazaar_merchant',
    role: 'merchant',
    region: Region.ISFAHAN,
    nameRu: 'Торговец Джафар',
    helloLine: 'hello',
    extraLines: ['extra1', 'haggle'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Ассаламу алейкум, путник! Джафар ибн Мухаммад к вашим услугам. Шёлк, специи, оружие — у меня есть всё. Что ищете?',
        choices: [
          { labelRu: 'Показать товары', nextId: 'shop' },
          { labelRu: 'Есть вопросы по региону', nextId: 'info' },
          { labelRu: 'Договоримся о цене', nextId: 'haggle' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      shop: {
        id: 'shop',
        textRu: 'Открываю лавку... Шёлк — 100 золотых за рулон. Сафран — 150. Зелья — подешевле. Хотите что-то конкретное?',
        choices: [
          { labelRu: 'Купить шёлк', nextId: 'buy_silk' },
          { labelRu: 'Есть что подешевле?', nextId: 'cheap' },
          { labelRu: 'Я посмотрю', nextId: 'bye' },
        ],
      },
      buy_silk: {
        id: 'buy_silk',
        textRu: 'Шёлк — основа торговли. Из него ткут халаты, делают нити. Хотите рулон?',
        choices: [
          { labelRu: 'Куплю 10 штук', nextId: 'bye' },
          { labelRu: 'Слишком дорого', nextId: 'bye' },
        ],
      },
      cheap: {
        id: 'cheap',
        textRu: 'Ну... маленькие зелья здоровья по 60 золотых. Или руда — 8 за слиток. Не богатство, но для начала сойдёт.',
        choices: [{ labelRu: 'Беру руду', nextId: 'bye' }],
      },
      info: {
        id: 'info',
        textRu: 'Исфахан — сердце Империи. Здесь живёт шах, здесь самые богатые базары. На north — Тебриз, на east — пустыня. Остерегайтесь османов!',
        choices: [{ labelRu: 'Спасибо', nextId: 'bye' }],
      },
      haggle: {
        id: 'haggle',
        textRu: 'О, вы любите поторговаться! Ладно... для вас — скидка 10%. Но только сегодня!',
        choices: [{ labelRu: 'Хорошо, договорились!', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Торговля — это искусство. Я торгую уже 20 лет и ещё не разорился. Секрет — не продавать слишком дорого.',
        choices: [{ labelRu: 'Мудрый совет', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Да прибудет с вами баракат! Заходите ещё!',
        choices: [],
      },
    },
  },

  {
    npcId: 'npc_mystic',
    role: 'mystic',
    region: Region.ISFAHAN,
    nameRu: 'Суфий Мевлана',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: '*тихо кружится* ...О, путник. Твоя душа несётся вслепую. Остановись на мгновение и выслушай.',
        choices: [
          { labelRu: 'Что вы видите?', nextId: 'vision' },
          { labelRu: 'Мне нужна помощь', nextId: 'help' },
          { labelRu: 'Я просто прохожу', nextId: 'bye' },
        ],
      },
      vision: {
        id: 'vision',
        textRu: 'Я вижу тьму, что надвигается с востока. Ассасины сеют хаос в наших городах. Им нужен тот, кто сможет остановить их изнутри.',
        choices: [
          { labelRu: 'Я могу помочь', nextId: 'quest_accept', action: 'quest', questId: 'side_003_silk_road' },
          { labelRu: 'Я не воин...', nextId: 'comfort' },
        ],
      },
      help: {
        id: 'help',
        textRu: 'Все нуждаются в помощи. Но сначала — помощь должна исходить из сердца. Очисти город от теней, и тогда я дам тебе мудрость.',
        choices: [{ labelRu: 'Я очищу Исфахан', nextId: 'quest_accept', action: 'quest', questId: 'side_003_silk_road' }],
      },
      comfort: {
        id: 'comfort',
        textRu: 'Мужество — не отсутствие страха. Это решение действовать, несмотря на него. Ты уже здесь — значит, готов.',
        choices: [{ labelRu: 'Вы правы', nextId: 'bye' }],
      },
      quest_accept: {
        id: 'quest_accept',
        textRu: 'Пусть свет направит твой путь. Возвращайся, когда справишься.',
        choices: [{ labelRu: 'Аминь', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Руми сказал: "Зажги огонёк в другом, и твой тоже загорится". Делай добро — и добро вернётся к тебе.',
        choices: [{ labelRu: 'Благодарю за мудрость', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: '*продолжает медленно вращаться* Да будет мир с тобой, странник.',
        choices: [],
      },
    },
  },

  {
    npcId: 'npc_caravan_master',
    role: 'merchant',
    region: Region.ISFAHAN,
    nameRu: 'Караван-баши Юсуф',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Юсуф, хозяин каравана. Везём шёлк из Гиляна в Тебриз, специи из Шираза — куда угодно. Ищешь работу или груз? Говори.',
        choices: [
          { labelRu: 'Есть ли работа?', nextId: 'work' },
          { labelRu: 'Расскажи о Шёлковом Пути', nextId: 'silk_road' },
          { labelRu: 'Просто мимо проходил', nextId: 'bye' },
        ],
      },
      work: {
        id: 'work',
        textRu: 'Мой караван нуждается в охране. Разбойники на дорогах — беда. Сопроводишь — заплатим щедро. 10 единиц шёлка до Тебриза — вот заказ.',
        choices: [
          { labelRu: 'Берусь!', nextId: 'quest_accept', action: 'quest', questId: 'daily_silk_delivery' },
          { labelRu: 'Мне нужно подумать', nextId: 'bye' },
        ],
      },
      silk_road: {
        id: 'silk_road',
        textRu: 'Шёлковый Путь — артерия мира. От Китая до Средиземноморья. Мы ездим по его персидскому отрезку: Исфахан → Тебриз → Месопотамия. Каждые три месяца — новый караван.',
        choices: [{ labelRu: 'Уважаю ремесло', nextId: 'bye' }],
      },
      quest_accept: {
        id: 'quest_accept',
        textRu: 'Молодец! Загрузи шёлк и жди у ворот — отправляемся на рассвете.',
        choices: [{ labelRu: 'Поехали!', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'В жизни нет ничего надёжнее верблюда. Они терпят жару, холод, голод — и всё равно несут груз.',
        choices: [{ labelRu: 'Правильные слова', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'С Богом на дороге, путник!',
        choices: [],
      },
    },
  },

  // ── Тебриз ────────────────────────────────────────────────────

  {
    npcId: 'npc_forester',
    role: 'guide',
    region: Region.TABRIZ,
    nameRu: 'Лесничий Давид',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'О, путник! Давид, лесничий этих мест. Вид у тебя боевой — значит, не зевака. Ищешь дело или дорогу?',
        choices: [
          { labelRu: 'Есть работы?', nextId: 'work' },
          { labelRu: 'Как пройти в Тебриз?', nextId: 'directions' },
          { labelRu: 'Расскажи о здешних местах', nextId: 'lore' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      work: {
        id: 'work',
        textRu: 'Разбойники засели у дорог. Ключник Бахрам просил очистить путь. Убил 10 разбойников-разведчиков — получишь награду.',
        choices: [
          { labelRu: 'Приму задание', nextId: 'quest_accept', action: 'quest', questId: 'main_002_first_blood' },
          { labelRu: 'Сколько их?', nextId: 'info_enemies' },
          { labelRu: 'Я справлюсь', nextId: 'bye' },
        ],
      },
      info_enemies: {
        id: 'info_enemies',
        textRu: 'Около десятка сидят у дороги на север. Обозначены как "разбойники-разведчики". Быстрые, но слабые — если нападёшь врасплох.',
        choices: [{ labelRu: 'Иду!', nextId: 'bye' }],
      },
      directions: {
        id: 'directions',
        textRu: 'Тебриз — далеко, но дорога прямая. Иди на север, затем на восток. Будь осторожен — в лесах водятся волки.',
        choices: [{ labelRu: 'Спасибо', nextId: 'bye' }],
      },
      lore: {
        id: 'lore',
        textRu: 'Эти земли — пограничье. С одной стороны — лес, с другой — пустоши. Когда-то здесь жили мирные люди, но войны выгнали их. Теперь лишь бродят тени.',
        choices: [{ labelRu: 'Грустно...', nextId: 'bye' }],
      },
      quest_accept: {
        id: 'quest_accept',
        textRu: 'Возвращайся с доброй вестью. Ключник Бахрам ждёт отчёта.',
        choices: [{ labelRu: 'Будет сделано!', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Лес — наш дом. Здесь я чувствую себя в безопасности. Но даже здесь разбойники не дают покоя.',
        choices: [{ labelRu: 'Защитим лес', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Береги себя, путник. Лес слышит каждый шаг.',
        choices: [],
      },
    },
  },

  {
    npcId: 'npc_tabriz_farmer',
    role: 'villager',
    region: Region.TABRIZ,
    nameRu: 'Фермер Али',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Ой, господи! Вы — из города? Слушайте, у меня беда — скорпионы!! Они грызут посевы и жалят скот. Помогите, пожалуйста!',
        choices: [
          { labelRu: 'Конечно, помогу', nextId: 'quest_accept', action: 'quest', questId: 'side_001_scorpion_nest' },
          { labelRu: 'А сколько их?', nextId: 'info' },
          { labelRu: 'Я сейчас не до этого', nextId: 'bye' },
        ],
      },
      info: {
        id: 'info',
        textRu: 'Около пяти гнёзд! Они в песках к югу от деревни. Я боюсь даже выйти за водой...',
        choices: [{ labelRu: 'Уберу их всех', nextId: 'bye' }],
      },
      quest_accept: {
        id: 'quest_accept',
        textRu: 'Благословение Аллаха на тебя, друг! Убей пять скорпионов, и я угощу тебя чаем.',
        choices: [{ labelRu: 'Сделаю!', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Раньше здесь было спокойно. А теперь... *вздыхает* Каждый день кто-то страдает от их укусов.',
        choices: [{ labelRu: 'Всё будет хорошо', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Да хранит тебя Аллах, герой!',
        choices: [],
      },
    },
  },

  {
    npcId: 'npc_tabriz_hunter',
    role: 'villager',
    region: Region.TABRIZ,
    nameRu: 'Охотник Хасан',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Хасан, охотник. Ищу волчьи шкуры — зимняя куртка для жены трещит от холода. Серые волки завелись к north от деревни.',
        choices: [
          { labelRu: 'Убить волков', nextId: 'quest_accept', action: 'quest', questId: 'side_002_wolf_pelts' },
          { labelRu: 'А сколько шкур нужно?', nextId: 'info' },
          { labelRu: 'До свидания', nextId: 'bye' },
        ],
      },
      info: {
        id: 'info',
        textRu: 'Восемь шкур — не мало, но я заплачу хорошо. Волк — достойный враг, но ради семьи рискну.',
        choices: [{ labelRu: 'Беру задание', nextId: 'bye' }],
      },
      quest_accept: {
        id: 'quest_accept',
        textRu: 'С Богом! Волки активнее ночью — будь осторожен.',
        choices: [{ labelRu: 'Понял', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Охота — не просто добыча. Это связь с землёй. Но сейчас мне нужно просто выжить зимой.',
        choices: [{ labelRu: 'Удачи', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Пусть удача будет с тобой, друг!',
        choices: [],
      },
    },
  },

  // ── Шираз ─────────────────────────────────────────────────────

  {
    npcId: 'npc_poet',
    role: 'mystic',
    region: Region.SHIRAZ,
    nameRu: 'Поэт Хафиз',
    helloLine: 'hello',
    extraLines: ['extra1', 'poem'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Извольте, путник! Хафиз Ширази — сын Ширазa. Читайте строки, пусть они согреют вашу душу, как вино согревает тело.',
        choices: [
          { labelRu: 'Прочитай мне', nextId: 'poem' },
          { labelRu: 'Мне нужен квест', nextId: 'quest' },
          { labelRu: 'Прощайте', nextId: 'bye' },
        ],
      },
      poem: {
        id: 'poem',
        textRu: '"Сиди в углу, печаль мой друг, не ищи путей вокруг. Вино и друг — вот всё, что надо, остальное — пустота!"',
        choices: [
          { labelRu: 'Глубоко...', nextId: 'extra1' },
          { labelRu: 'Ещё одну!', nextId: 'poem2' },
        ],
      },
      poem2: {
        id: 'poem2',
        textRu: '"Покажи мне место, где друг мой живёт, и скажи — куда мне идти? Виночерпий уже налил чашу — кто выпьет, тот найдёт покой!"',
        choices: [{ labelRu: 'Прекрасно', nextId: 'bye' }],
      },
      quest: {
        id: 'quest',
        textRu: 'У меня беда — украли мою рукопись! Ассасины из тумана похитили её. Найди их и верни свиток.',
        choices: [
          { labelRu: 'Верну рукопись', nextId: 'quest_accept', action: 'quest', questId: 'side_shiraz_hafiz_manuscript' },
          { labelRu: 'Ассасины? Страшно...', nextId: 'comfort' },
        ],
      },
      comfort: {
        id: 'comfort',
        textRu: 'Страх — лишь тень ума. Поэт боится меньше всех — он видел смерть в лицо и продолжал писать.',
        choices: [{ labelRu: 'Вы правы, принимаю', nextId: 'quest_accept', action: 'quest', questId: 'side_shiraz_hafiz_manuscript' }],
      },
      quest_accept: {
        id: 'quest_accept',
        textRu: 'Да хранит тебя Хафиз! Если рукапись не найдёшь — напишу новую, но старая дороже.',
        choices: [{ labelRu: 'Найду!', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'В Ширазе рождаются поэты. Каждый камень здесь пропитан стихами. Мой город — столица души.',
        choices: [{ labelRu: 'Красиво сказано', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Пусть строки освещают твой путь. Возвращайся — расскажешь новую историю.',
        choices: [],
      },
    },
  },

  {
    npcId: 'npc_healer',
    role: 'healer',
    region: Region.SHIRAZ,
    nameRu: 'Целительница Нарэ',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Приветствую, путник. Я Нарэ, целительница. Вижу, ты ранен... Или просто устал в дороге? Расскажи, чем могу помочь.',
        choices: [
          { labelRu: 'У меня есть раненые', nextId: 'help' },
          { labelRu: 'Расскажи о Ширазе', nextId: 'lore' },
          { labelRu: 'До свидания', nextId: 'bye' },
        ],
      },
      help: {
        id: 'help',
        textRu: 'Принеси мне травы — сафран и мяту. Я сварю целебный отвар для больных. Их много после набегов.',
        choices: [
          { labelRu: 'Принесу травы', nextId: 'quest_accept' },
          { labelRu: 'Что нужно собрать?', nextId: 'ingredients' },
        ],
      },
      ingredients: {
        id: 'ingredients',
        textRu: 'Сафран растёт на склонах к south. Мята — у ручья близ кладбища. Не слишком далеко, но осторожно — кладбище неспокойное.',
        choices: [{ labelRu: 'Понял, иду', nextId: 'bye' }],
      },
      lore: {
        id: 'lore',
        textRu: 'Шираз — город поэтов и садов. Розы здесь пахнут иначе, чем где-либо. Но за красотой скрывается опасность: ассасины бродят у кладбища.',
        choices: [{ labelRu: 'Спасибо за рассказ', nextId: 'bye' }],
      },
      quest_accept: {
        id: 'quest_accept',
        textRu: 'Благодарю тебя. Лечение не терпит ожидания.',
        choices: [{ labelRu: 'Вернусь с травами', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Целительство — это не только зелья. Главное — верить, что исцеление возможно.',
        choices: [{ labelRu: 'Верю', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Здоровья тебе, путник. И помни: улыбка лечит лучше любого зелья.',
        choices: [],
      },
    },
  },

  // ── Кавказ ────────────────────────────────────────────────────

  {
    npcId: 'npc_fort_commander',
    role: 'commander',
    region: Region.CAUCASUS,
    nameRu: 'Комендант Ашот',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Комендант Ашот, горная крепость. Монгольские наездники атакуют перевалы. Нужны добровольцы для обороны.',
        choices: [
          { labelRu: 'Какая задача?', nextId: 'mission' },
          { labelRu: 'Сколько врагов?', nextId: 'intel' },
          { labelRu: 'Я вернусь', nextId: 'bye' },
        ],
      },
      mission: {
        id: 'mission',
        textRu: 'Монголы атакуют караваны на перевале. Убей пять наездников — это снизит давление. Также нужны железные детали для ремонта ворот.',
        choices: [
          { labelRu: 'Принимаю!', nextId: 'quest_accept', action: 'quest', questId: 'side_caucasus_tower_defense' },
          { labelRu: 'Сложная задача', nextId: 'intel' },
        ],
      },
      intel: {
        id: 'intel',
        textRu: 'Около десяти наездников патрулируют перевал. Они быстрые, но в горах их кони теряют преимущество.',
        choices: [{ labelRu: 'Понял', nextId: 'bye' }],
      },
      quest_accept: {
        id: 'quest_accept',
        textRu: 'За честь крепости! Не подведите, боец.',
        choices: [{ labelRu: 'Не подведу!', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Горы — наш щит. Но щит нуждается в сильных руках.',
        choices: [{ labelRu: 'Я за вас!', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'С Богом и честью, солдат!',
        choices: [],
      },
    },
  },

  {
    npcId: 'npc_desert_scout',
    role: 'scout',
    region: Region.KHORASAN,
    nameRu: 'Проводник Захра',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Захра, проводник караванов через пустыню. Ищешь дорогу? Или помощь? Пустыня не прощает ошибок.',
        choices: [
          { labelRu: 'Расскажи о пустыне', nextId: 'lore' },
          { labelRu: 'Мне нужна помощь', nextId: 'help' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      lore: {
        id: 'lore',
        textRu: 'Пустыня Кирман — море песка и смерти. Но в ней скрываются оазисы и древние храмы. Дивы — огненные демоны — обитают в пещерах Хорасана.',
        choices: [{ labelRu: 'Огонь и демоны...', nextId: 'extra1' }],
      },
      help: {
        id: 'help',
        textRu: 'Караван идет через пустыню, но дивы атакуют. Нужен кто-то, кто отгонит их. 5 огненных дивов — вот цена за безопасность пути.',
        choices: [
          { labelRu: 'Я справлюсь', nextId: 'quest_accept' },
          { labelRu: 'Это опасно', nextId: 'warning' },
        ],
      },
      warning: {
        id: 'warning',
        textRu: 'Опасно? О, путник, ты ещё не видел настоящего огня. Но если не кто-то другой, кто защитит караван?',
        choices: [{ labelRu: 'Ладно, я с вами', nextId: 'quest_accept' }],
      },
      quest_accept: {
        id: 'quest_accept',
        textRu: 'Ты храбр. Или глуп. В пустыне это одно и то же. Удачи.',
        choices: [{ labelRu: 'Спасибо', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Звёзды — мои спутники. По ним я нахожу путь там, где другие видят лишь песок.',
        choices: [{ labelRu: 'Мудро', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Да звёзды ведут тебя, путник.',
        choices: [],
      },
    },
  },

  // ── Порт ──────────────────────────────────────────────────────

  {
    npcId: 'npc_fisherman',
    role: 'villager',
    region: Region.ISFAHAN,
    nameRu: 'Рыбак Тигран',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'А, новыйface! Тигран, рыбак. Ловлю рыбу в озере и продаю на базаре. Что привело тебя к воде?',
        choices: [
          { labelRu: 'Расскажи о порте', nextId: 'lore' },
          { labelRu: 'Есть работа?', nextId: 'work' },
          { labelRu: 'Я просто рыбак', nextId: 'bye' },
        ],
      },
      lore: {
        id: 'lore',
        textRu: 'Порт — gateway к морю. Отсюда идут корабли в Персидский залив. Рыба, соль, пряности — всё идёт через этот порт.',
        choices: [{ labelRu: 'Интересно', nextId: 'bye' }],
      },
      work: {
        id: 'work',
        textRu: 'Работа? Ну... если хочешь, можешь помочь ловить рыбу. Но это скучно. Лучше отправься к лодочнику — он знает, где рыба водится.',
        choices: [{ labelRu: 'Пойду к лодочнику', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Рыба — это жизнь. Без рыбы нет еды, без еды нет жизни. Простая философия.',
        choices: [{ labelRu: 'Верно сказано', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Удачной ловли, друг!',
        choices: [],
      },
    },
  },

  {
    npcId: 'npc_harbor_master',
    role: 'merchant',
    region: Region.PERSIAN_GULF,
    nameRu: 'Хозяйка пристани Лейла',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Лейла, хозяйка этой пристани. Порт — моя жизнь. Корабли приходят, уходят, везут товары. Что нужно?',
        choices: [
          { labelRu: 'Есть задания?', nextId: 'quest' },
          { labelRu: 'Расскажи о заливе', nextId: 'lore' },
          { labelRu: 'Просто смотрю', nextId: 'bye' },
        ],
      },
      quest: {
        id: 'quest',
        textRu: 'Янычары беспокоят судоходство. Пираты и османы делят залив. Нужно устранить их — хотя бы 15 янычар, чтобы путь стал безопаснее.',
        choices: [
          { labelRu: 'Приму задание', nextId: 'quest_accept', action: 'quest', questId: 'side_gulf_smuggler_rings' },
          { labelRu: 'Многовато...', nextId: 'comfort' },
        ],
      },
      lore: {
        id: 'lore',
        textRu: 'Персидский залив — жила Империи. Через него идёт торговля с Индией, Африкой, далёким Востоком. Кто контролирует залив — контролирует богатство.',
        choices: [{ labelRu: 'Понятно', nextId: 'bye' }],
      },
      comfort: {
        id: 'comfort',
        textRu: 'Безопасность завета стоит усилий. Подумай — без нас никто не привезёт ваши товары.',
        choices: [{ labelRu: 'Ладно, беру', nextId: 'quest_accept', action: 'quest', questId: 'side_gulf_smuggler_rings' }],
      },
      quest_accept: {
        id: 'quest_accept',
        textRu: 'Благодарю! Залив станет безопаснее благодаря тебе.',
        choices: [{ labelRu: 'Не за что', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Море — моя страсть. Каждый шторм — это испытание, каждый шторм — это жизнь.',
        choices: [{ labelRu: 'Уважение', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Да будет ветер попутным!',
        choices: [],
      },
    },
  },

  // ── Форт ──────────────────────────────────────────────────────

  {
    npcId: 'npc_fort_guide',
    role: 'guide',
    region: Region.CAUCASUS,
    nameRu: 'Проводник Сирина',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Сирина, проводник горных перевалов. Знаю каждую тропу, каждый овраг. Ищешь путь или сведения?',
        choices: [
          { labelRu: 'Куда ведёт тропа?', nextId: 'paths' },
          { labelRu: 'Есть работа?', nextId: 'work' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      paths: {
        id: 'paths',
        textRu: 'Тропа на север ведёт к Тебризу. На восток — в Месопотамию. Но будь осторожен: перевалы опасны в любую погоду.',
        choices: [{ labelRu: 'Благодарю', nextId: 'bye' }],
      },
      work: {
        id: 'work',
        textRu: 'Работа? Хм... Комендант Ашот ищет добровольцев для охраны перевалов. Монголы активизировались.',
        choices: [
          { labelRu: 'Иду к коменданту', nextId: 'commander_npc', action: 'move' },
          { labelRu: 'Спасибо за информацию', nextId: 'bye' },
        ],
      },
      commander_npc: {
        id: 'commander_npc',
        textRu: 'Комендант Ашот в крепости. Обратись к нему — он даст задание.',
        choices: [{ labelRu: 'Иду', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Горы учат терпению. Каждый подъём — это урок, каждое спуск — награда.',
        choices: [{ labelRu: 'Мудрость гор', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'С Божиим благословением, путник!',
        choices: [],
      },
    },
  },

  // ── Караван-сарай ──────────────────────────────────────────────

  {
    npcId: 'npc_desert_master',
    role: 'merchant',
    region: Region.KHORASAN,
    nameRu: 'Караван-баши Рахим',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Рахим, караван-баши. Мой караван отдыхаёт здесь. Шёлк, специи, драгоценности — всё, что везут из далёких земель. Нужен товар?',
        choices: [
          { labelRu: 'Что есть интересного?', nextId: 'shop' },
          { labelRu: 'Расскажи о караване', nextId: 'lore' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      shop: {
        id: 'shop',
        textRu: 'У нас бирюза — лучший камень в мире. Драконья чешуя — редкость, но если нужна для ритуала... 60000 золотых за чешую.',
        choices: [
          { labelRu: 'Бирюза, пожалуйста', nextId: 'buy_turquoise' },
          { labelRu: 'Дорого...', nextId: 'bye' },
        ],
      },
      buy_turquoise: {
        id: 'buy_turquoise',
        textRu: 'Бирюза из Нейшабура — символ Персии. Надень её — и мир увидит в тебе человека со вкусом.',
        choices: [{ labelRu: 'Красиво', nextId: 'bye' }],
      },
      lore: {
        id: 'lore',
        textRu: 'Караван идёт 40 дней. 200 верблюдов, 50 человек. Мы везём шёлк из Китая, специи из Индии. Путь долгий, но прибыльный.',
        choices: [{ labelRu: 'Уважаю труд', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Пустыня учит одному: доверяй тому, кто идёт рядом. Одиночка в песках мёртв.',
        choices: [{ labelRu: 'Верю', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'С Богом в путь, друг!',
        choices: [],
      },
    },
  },

  // ── Деревня ────────────────────────────────────────────────────

  {
    npcId: 'npc_village_trader',
    role: 'merchant',
    region: Region.TABRIZ,
    nameRu: 'Торговка Ануш',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Ануш, торговка из деревни. У меня есть всё необходимое для путника: зелья, еда, инструменты. Заходи, гляди!',
        choices: [
          { labelRu: 'Показать товары', nextId: 'shop' },
          { labelRu: 'Есть новости?', nextId: 'news' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      shop: {
        id: 'shop',
        textRu: 'Малое зелье здоровья — 5 серебра. Еда для стамина — 7 серебра. Железная руда — 3 серебра. Дешёво и сердито!',
        choices: [
          { labelRu: 'Беру зелье', nextId: 'buy' },
          { labelRu: 'Дороговато', nextId: 'bye' },
        ],
      },
      news: {
        id: 'news',
        textRu: 'Новости? Разбойники стали чаще appear. Стражник Бахрам жалуется. А ещё говорят, скорпионы размножились у южной дороги.',
        choices: [{ labelRu: 'Спасибо', nextId: 'bye' }],
      },
      buy: {
        id: 'buy',
        textRu: 'Вот ваше зелье! Выпейте на здоровье.',
        choices: [{ labelRu: 'Благодарю', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Торговля в деревне — это не бизнес, это служба. Люди зависят от того, что привезёшь.',
        choices: [{ labelRu: 'Понимаю', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Заходи ещё, друг!',
        choices: [],
      },
    },
  },

  {
    npcId: 'npc_woodcutter',
    role: 'villager',
    region: Region.TABRIZ,
    nameRu: 'Дровосек Гурген',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Гурген, рублю дрова. Работа тяжёлая, но честная. Чем могу помочь?',
        choices: [
          { labelRu: 'Расскажи о лесе', nextId: 'lore' },
          { labelRu: 'Есть работа?', nextId: 'work' },
          { labelRu: 'До свидания', nextId: 'bye' },
        ],
      },
      lore: {
        id: 'lore',
        textRu: 'Лес вокруг деревни густой. Волки, зайцы, птицы... Раньше здесь был мир. Теперь разбойники и скорпионы — вот кто здесь хозяйничает.',
        choices: [{ labelRu: 'НадоCleanupать', nextId: 'bye' }],
      },
      work: {
        id: 'work',
        textRu: 'Работа? Я бы с радостью пошел за дровами, но... волки загнали меня в угол. Не выйти из хижшины.',
        choices: [{ labelRu: 'Я разберусь с волками', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Топор — лучший друг дровосека. И самый опасный враг — если неправильно им пользовать.',
        choices: [{ labelRu: 'Осторожно', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Береги себя, друг!',
        choices: [],
      },
    },
  },

  // ── Привратник ─────────────────────────────────────────────────

  {
    npcId: 'npc_guard_gate',
    role: 'guard',
    region: Region.ISFAHAN,
    nameRu: 'Привратник',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Стоп! Кто идёт? Пока документы... Шучу, просто проверяю. Проходи, путник. Ворота открыты для друзей Шаха.',
        choices: [
          { labelRu: 'Спасибо', nextId: 'bye' },
          { labelRu: 'Что за стена вокруг города?', nextId: 'walls' },
        ],
      },
      walls: {
        id: 'walls',
        textRu: 'Стены Исфахана — 12 метров высотой. Построены при шахе Тахмаспе I. Выдерживают любую осаду. Но главный щит — не камни, а люди.',
        choices: [{ labelRu: 'Понятно', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Стою на воротах уже 10 лет. Вижу тысячи лиц. Каждое лицо — своя история.',
        choices: [{ labelRu: 'Работа не из лёгких', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Да хранит тебя Шах!',
        choices: [],
      },
    },
  },

  // ── Кузнец ─────────────────────────────────────────────────────

  {
    npcId: 'npc_craftsman',
    role: 'craftsman',
    region: Region.ISFAHAN,
    nameRu: 'Кузнец Омар',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Омар кузнец. Кою мечи, чиню доспехи. Нужна работа? Или просто зашли согреться у горна?',
        choices: [
          { labelRu: 'Что можете предложить?', nextId: 'craft' },
          { labelRu: 'Расскажи о кузнечном деле', nextId: 'lore' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      craft: {
        id: 'craft',
        textRu: 'Могу заточить твоё оружие. Или отковать новое — если принесёшь руду. Железный меч стоит 60 золотых или 8 слитков руды.',
        choices: [
          { labelRu: 'Заточить оружие', nextId: 'enhance' },
          { labelRu: 'Отковать меч', nextId: 'forge' },
          { labelRu: 'Подумаю', nextId: 'bye' },
        ],
      },
      enhance: {
        id: 'enhance',
        textRu: 'Заточка — дело тонкое. Каждый уровень заточки повышает урон. Но помните: слишком усердствовать опасно — металл может треснуть.',
        choices: [{ labelRu: 'Начнём!', nextId: 'bye' }],
      },
      forge: {
        id: 'forge',
        textRu: 'Железный меч — 60 золотых. Или 8 слитков руды. Сделаю за час, если горн разогрет.',
        choices: [{ labelRu: 'Делайте', nextId: 'bye' }],
      },
      lore: {
        id: 'lore',
        textRu: 'Кузнечное дело — это не просто бить молотом. Это искусство. Каждый меч — произведение, каждый доспех — произведение. Кузнец создаёт защиту для героев.',
        choices: [{ labelRu: 'Уважение к ремеслу', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Огонь горна — мой второй дом. Здесь я забываю о всех бедах мира.',
        choices: [{ labelRu: 'Понимаю', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Заходи, кузнец всегда открыт!',
        choices: [],
      },
    },
  },

  // ── Аукционист ─────────────────────────────────────────────────

  {
    npcId: 'npc_auctioneer',
    role: 'merchant',
    region: Region.ISFAHAN,
    nameRu: 'Аукционист',
    helloLine: 'hello',
    extraLines: [],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Аукционист при Аукционном Доме Исфахана. Здесь можно купить и продать всё: от меча до замка. Что интересует?',
        choices: [
          { labelRu: 'Открыть аукцион', nextId: 'auction' },
          { labelRu: 'Выставить лот', nextId: 'sell' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      auction: {
        id: 'auction',
        textRu: 'Текущие лоты: мечи, доспехи, зелья. Ставки принимаются до истечения времени. Победитель платит комиссию 3%.',
        choices: [{ labelRu: 'Смотрю лоты', nextId: 'bye' }],
      },
      sell: {
        id: 'sell',
        textRu: 'Выставить лот — просто. Определи цену, укажи предмет. Комиссия 3% от продажи.',
        choices: [{ labelRu: 'Понятно', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Удачных сделок!',
        choices: [],
      },
    },
  },

  // ── Дровосёк (кавказский) ─────────────────────────────────────

  {
    npcId: 'npc_fort_smith',
    role: 'craftsman',
    region: Region.CAUCASUS,
    nameRu: 'Оружейник Вахтанг',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Вахтанг, оружейник горной крепости. Кую клинки для стражи. Нужен меч? Или починить старый?',
        choices: [
          { labelRu: 'Что можете предложить?', nextId: 'shop' },
          { labelRu: 'Расскажи о крепости', nextId: 'lore' },
          { labelRu: 'До свидания', nextId: 'bye' },
        ],
      },
      shop: {
        id: 'shop',
        textRu: 'Горный меч — 3000 золотых. Прочный, как скалы. Или могу заточить ваш — за материалы.',
        choices: [{ labelRu: 'Закажите', nextId: 'bye' }],
      },
      lore: {
        id: 'lore',
        textRu: 'Крепость стоит на скале 300 лет. Мы — последние потомки древних кузнецов. Наш металл знают во всей Персии.',
        choices: [{ labelRu: 'Уважаю', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Меч — не просто оружие. Это продолжение руки воина.',
        choices: [{ labelRu: 'Философски', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Берегите клинок!',
        choices: [],
      },
    },
  },

  // ── Конюх ──────────────────────────────────────────────────────

  {
    npcId: 'npc_stable_master',
    role: 'merchant',
    region: Region.ISFAHAN,
    nameRu: 'Конюх Фархад',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Фархад, конюший при конюшне Исфахана. Лошади, верблюды — у нас всё есть. Нужна лошадь для дороги?',
        choices: [
          { labelRu: 'Какие есть?', nextId: 'horses' },
          { labelRu: 'Сколько стоят?', nextId: 'prices' },
          { labelRu: 'Просто смотрю', nextId: 'bye' },
        ],
      },
      horses: {
        id: 'horses',
        textRu: 'Арабский скакун — быстрый, но дорогой. Верблюд — медленный, но выносливый. Боевой конь Кызылбаша — лучший для войны.',
        choices: [
          { labelRu: 'Арабского скакуна!', nextId: 'buy' },
          { labelRu: 'Верблюда', nextId: 'buy_camel' },
          { labelRu: 'Боевого коня', nextId: 'buy_warhorse' },
        ],
      },
      prices: {
        id: 'prices',
        textRu: 'Арабский скакун — 5000 золотых. Верблюд — 8000. Боевой конь Кызылбаша — 25000. Дорого, ноEach one — произведение искусства.',
        choices: [{ labelRu: 'Подумаю', nextId: 'bye' }],
      },
      buy: {
        id: 'buy',
        textRu: 'Отличный выбор! Скакун доставит вас быстрее ветра.',
        choices: [{ labelRu: 'Беру!', nextId: 'bye' }],
      },
      buy_camel: {
        id: 'buy_camel',
        textRu: 'Верблюд — надежный друг в пустыне. Переживёт и жару, и голод.',
        choices: [{ labelRu: 'Беру!', nextId: 'bye' }],
      },
      buy_warhorse: {
        id: 'buy_warhorse',
        textRu: 'Боевой конь Кызылбаша — гордость Империи. Лучший конь для войны.',
        choices: [{ labelRu: 'Беру!', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Лошадь — не просто транспорт. Это партнёр, друг, спаситель в битве.',
        choices: [{ labelRu: 'Верю', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'С Богом в путь!',
        choices: [],
      },
    },
  },

  // ── Порт: рыбак, матрос ────────────────────────────────────────

  {
    npcId: 'npc_sailor',
    role: 'villager',
    region: Region.ISFAHAN,
    nameRu: 'Кок Салим',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Салим, кок на корабле. Готовлю еду для команды. Рыба, рис, специи — вот наш рацион. Хочешь есть?',
        choices: [
          { labelRu: 'Расскажи о море', nextId: 'sea' },
          { labelRu: 'Есть работа?', nextId: 'work' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      sea: {
        id: 'sea',
        textRu: 'Море — это мир. Бескрайний, опасный, прекрасный. Я видел штормы, где волны выше домов. И видел закаты, от которых замирает сердце.',
        choices: [{ labelRu: 'Рассказывайте ещё', nextId: 'extra1' }],
      },
      work: {
        id: 'work',
        textRu: 'Работа? Корабль уходит через день. Но это тяжёлый труд — поднимать паруса, чинить сеть, ловить рыбу в шторм.',
        choices: [{ labelRu: 'Я не моряк', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Море кормит, но и забирает. Кто вышел в море — тот уже не принадлежит себе.',
        choices: [{ labelRu: 'Мудрость', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Ровного ветра!',
        choices: [],
      },
    },
  },

  {
    npcId: 'npc_port_guard',
    role: 'guard',
    region: Region.ISFAHAN,
    nameRu: 'Дозорный моря',
    helloLine: 'hello',
    extraLines: [],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Дозорный на порту. Корабли приходят, уходят — я слежу за порядком. Кто идёт?',
        choices: [
          { labelRu: 'Просто прохожу', nextId: 'bye' },
          { labelRu: 'Что охраняете?', nextId: 'duty' },
        ],
      },
      duty: {
        id: 'duty',
        textRu: 'Порт — стратегический объект. Вражеские корабли могут подойти откуда угодно. Мы следим за каждым судном.',
        choices: [{ labelRu: 'Понятно', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Проходите, друг.',
        choices: [],
      },
    },
  },

  // ── Стражники ворот (Исфахан) ──────────────────────────────────

  {
    npcId: 'npc_gate_guard_l',
    role: 'guard',
    region: Region.ISFAHAN,
    nameRu: 'Стражник Фарид',
    helloLine: 'hello',
    extraLines: [],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Фарид, стражник левых ворот. Справа стоит Кавус. Мы держим оборону 24/7. Что нужно?',
        choices: [
          { labelRu: 'Как дела?', nextId: 'extra1' },
          { labelRu: 'Пройти', nextId: 'bye' },
        ],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Скучно, но честно. Лучше бы враг подошёл — тогда хоть дело есть.',
        choices: [{ labelRu: 'Будет дело', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Проходи, друг!',
        choices: [],
      },
    },
  },

  {
    npcId: 'npc_gate_guard_r',
    role: 'guard',
    region: Region.ISFAHAN,
    nameRu: 'Стражник Кавус',
    helloLine: 'hello',
    extraLines: [],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Кавус, правые ворота. Фарид слева скучает, а я здесь — держу форму.',
        choices: [
          { labelRu: 'Что стряслось?', nextId: 'news' },
          { labelRu: 'Пройду', nextId: 'bye' },
        ],
      },
      news: {
        id: 'news',
        textRu: 'Разбойники у Тебриза стали наглее. Караваны ждут охраны. Если нужен подвиг — отправляйся к командиру Рустаму.',
        choices: [{ labelRu: 'Спасибо за совет', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Береги себя!',
        choices: [],
      },
    },
  },

  {
    npcId: 'npc_gate_archer_l',
    role: 'guard',
    region: Region.ISFAHAN,
    nameRu: 'Лучник Марван',
    helloLine: 'hello',
    extraLines: [],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Марван, лучник. Стою на.wall и наблюдаю. Лучший глаз в Исфахане.',
        choices: [
          { labelRu: 'Покажи что-нибудь', nextId: 'shoot' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      shoot: {
        id: 'shoot',
        textRu: '*натягивает тетиву и выпускает стрелу в облако* Видишь? Там, вдалеке. 200 шагов — и стрела на месте. Хороший стрелок — это не роскошь, это необходимость.',
        choices: [{ labelRu: 'Впечатляет!', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Не мешай сосредоточиться!',
        choices: [],
      },
    },
  },

  {
    npcId: 'npc_gate_archer_r',
    role: 'guard',
    region: Region.ISFAHAN,
    nameRu: 'Лучник Данияр',
    helloLine: 'hello',
    extraLines: [],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Данияр, правый лучник. Марван слева хвастается, а я просто стреляю. Разница — в словах.',
        choices: [
          { labelRu: 'Какой враг наиболее опасен?', nextId: 'enemy' },
          { labelRu: 'До свидания', nextId: 'bye' },
        ],
      },
      enemy: {
        id: 'enemy',
        textRu: 'Османские янычары — лучшие стрелки в регионе. Но мы из Исфахана, и мы не сдаёмся.',
        choices: [{ labelRu: 'Гордость!', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'С Богом!',
        choices: [],
      },
    },
  },

  // ── Форт: горный стрелок ──────────────────────────────────────

  {
    npcId: 'npc_fort_guard',
    role: 'guard',
    region: Region.CAUCASUS,
    nameRu: 'Горный стрелок',
    helloLine: 'hello',
    extraLines: [],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Стражник горной крепости. Монголы могут подняться откуда угодно. Мы следим за каждым перевалом.',
        choices: [
          { labelRu: 'Как долго вы здесь?', nextId: 'service' },
          { labelRu: 'Пройду', nextId: 'bye' },
        ],
      },
      service: {
        id: 'service',
        textRu: 'Пять лет. Начинал молодым, стал старым. Но крепость — мой дом. Не покину её.',
        choices: [{ labelRu: 'Честь имею', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Береги себя!',
        choices: [],
      },
    },
  },

  // ── Пустынный торговец ────────────────────────────────────────

  {
    npcId: 'npc_desert_merchant',
    role: 'merchant',
    region: Region.KHORASAN,
    nameRu: 'Торгаш Фарид',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Фарид, торговец из пустыни. У меня есть всё: от ткани до оружия. Цены — лучшие в Кирмане!',
        choices: [
          { labelRu: 'Товары', nextId: 'shop' },
          { labelRu: 'Новости', nextId: 'news' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      shop: {
        id: 'shop',
        textRu: 'У меня есть зелья, еда, немного оружия. Но лучшее — бирюза из Нейшабура. 400 золотых за камень.',
        choices: [{ labelRu: 'Дорого', nextId: 'bye' }],
      },
      news: {
        id: 'news',
        textRu: 'Новости? Дивы стали чаще показываться. Говорят, это из-за изменения климата... или гнева богов.',
        choices: [{ labelRu: 'Странно...', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Торговля в пустыне — это риск. Но и прибыль большая.',
        choices: [{ labelRu: 'Понятно', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'С Богом в путь!',
        choices: [],
      },
    },
  },

  // ── Стражники без диалогов (кликабельны в мире, иначе 404) ──
  {
    npcId: 'npc_guard_west',
    role: 'guard',
    region: Region.ISFAHAN,
    nameRu: 'Стражник Бахрам',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Бахрам, западные ворота. Проходи, путник, только без глупостей — за порядком слежу я.',
        choices: [
          { labelRu: 'Что тут происходит?', nextId: 'watch' },
          { labelRu: 'Прощай', nextId: 'bye' },
        ],
      },
      watch: {
        id: 'watch',
        textRu: 'Тихо пока. Караваны идут, стража не спит. Так и должно быть.',
        choices: [{ labelRu: 'Понятно', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Западная стена крепка. Отсюда весь город как на ладони.',
        choices: [{ labelRu: 'Впечатляет', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Иди с миром.',
        choices: [],
      },
    },
  },
  {
    npcId: 'npc_desert_guard',
    role: 'guard',
    region: Region.KHORASAN,
    nameRu: 'Стражник каравана',
    helloLine: 'hello',
    extraLines: ['extra1'],
    lines: {
      hello: {
        id: 'hello',
        textRu: 'Стой. Караван под охраной — грузы опечатаны, лишних не пропускаем. Ты кто?',
        choices: [
          { labelRu: 'Я путник, ищу работу', nextId: 'work' },
          { labelRu: 'Просто мимо', nextId: 'bye' },
        ],
      },
      work: {
        id: 'work',
        textRu: 'Работу даёт караван-баши Рахим, не я. Моё дело — копьё и дозор.',
        choices: [{ labelRu: 'Понял', nextId: 'bye' }],
      },
      extra1: {
        id: 'extra1',
        textRu: 'Песок, солнце и разбойники. Третьего не жди — всё как всегда.',
        choices: [{ labelRu: 'Держитесь', nextId: 'bye' }],
      },
      bye: {
        id: 'bye',
        textRu: 'Пески тебе под ноги.',
        choices: [],
      },
    },
  },
];

/** Получить диалог NPC по id */
export function getNpcDialogue(npcId: string): NpcDialogEntry | null {
  return NPC_DIALOGUES.find(d => d.npcId === npcId) ?? null;
}
