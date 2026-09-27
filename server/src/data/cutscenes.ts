// ============================================================
// Кат-сцены — Empire of Safavids
// ============================================================
// Сюжетные вставки, которые проигрываются в ключевые моменты:
// принятие первого квеста, разгадка заговора, приход флота.
//
// Почему текст живёт на сервере, а не на клиенте: игрок не должен
// получать содержимое сцены раньше, чем до неё дошёл. Клиент
// получает только ту сцену, которую положено показать сейчас.

export interface CutsceneLine {
  /** Кто говорит: id персонажа, 'narrator' или 'shah' */
  speaker: string;
  /** Имя говорящего (на случай, если персонажа нет в сцене) */
  speakerName: string;
  text: string;
  textRu: string;
  /** Пауза перед показом реплики, мс */
  delay?: number;
}

export interface CutsceneDef {
  id: string;
  /** Квест, при принятии или выполнении которого проигрывается */
  triggerQuest: string;
  /** 'accept' — при принятии квеста, 'complete' — при выполнении */
  trigger: 'accept' | 'complete';
  title: string;
  titleRu: string;
  /** Глава, к которой относится (для галереи) */
  chapterId: string;
  /** Что видно за окном сцены (для камеры) */
  backdrop: 'throne_room' | 'tabriz_gate' | 'caravan_road' | 'silk_road_fort' | 'caucasus_pass' | 'desert_dunes' | 'gulf_harbor';
  lines: CutsceneLine[];
}

export const CUTSCENES: CutsceneDef[] = [
  {
    id: 'cut_001_awakening',
    triggerQuest: 'main_001_awakening',
    trigger: 'accept',
    title: 'A Summons',
    titleRu: 'Призыв',
    chapterId: 'ch_awakening',
    backdrop: 'throne_room',
    lines: [
      {
        speaker: 'narrator', speakerName: 'Рассказчик',
        text: 'Tabriz. The first capital of the Safavids still smells of smoke and rosewater.',
        textRu: 'Тебриз. Первая столица Сефевидов ещё пахнет дымом и розовой водой.',
      },
      {
        speaker: 'shah', speakerName: 'Шах Исмаил I',
        text: 'They sent me a list of names. Most of them are already dead.',
        textRu: 'Мне прислали список имён. Большинство из них уже мертвы.',
        delay: 400,
      },
      {
        speaker: 'shah', speakerName: 'Шах Исмаил I',
        text: 'You are not on that list. That is either very good, or very bad.',
        textRu: 'Тебя в том списке нет. Это либо очень хорошо, либо очень плохо.',
      },
      {
        speaker: 'npc_grand_vizier', speakerName: 'Великий Визирь',
        text: 'Majesty, the roads east are not safe. Bandits, and worse.',
        textRu: 'Мой шах, дороги на восток небезопасны. Разбойники, и это ещё не всё.',
        delay: 400,
      },
      {
        speaker: 'shah', speakerName: 'Шах Исмаил I',
        text: 'Then they are about to become safe. Go to Tabriz. See what you are made of.',
        textRu: 'Тогда они скоро станут безопасными. Езжай в Тебриз. Узнай, из чего ты слеплен.',
      },
    ],
  },
  {
    id: 'cut_002_first_blood',
    triggerQuest: 'main_002_first_blood',
    trigger: 'complete',
    title: 'The Road Runs Red',
    titleRu: 'Дорога Краснеет',
    chapterId: 'ch_awakening',
    backdrop: 'caravan_road',
    lines: [
      {
        speaker: 'narrator', speakerName: 'Рассказчик',
        text: 'The caravan reached Tabriz with three carts instead of seven.',
        textRu: 'Караван добрался до Тебриза с тремя телегами вместо семи.',
      },
      {
        speaker: 'narrator', speakerName: 'Рассказчик',
        text: 'The bandits who took the other four are no longer taking anything.',
        textRu: 'Разбойники, унёсшие остальные четыре, больше ничего не уносят.',
        delay: 500,
      },
      {
        speaker: 'narrator', speakerName: 'Рассказчик',
        text: 'Word of this reaches the wrong ears. The Ottomans are watching the roads now.',
        textRu: 'Об этом узнают не те уши. Османы теперь смотрят на дороги.',
      },
    ],
  },
  {
    id: 'cut_010_conspiracy',
    triggerQuest: 'main_010_silk_road',
    trigger: 'complete',
    title: 'The Seal',
    titleRu: 'Печать',
    chapterId: 'ch_silk_road',
    backdrop: 'silk_road_fort',
    lines: [
      {
        speaker: 'npc_grand_vizier', speakerName: 'Великий Визирь',
        text: 'This seal. Ottoman. It opens letters in three cities.',
        textRu: 'Эта печать. Османская. Она открывает письма в трёх городах.',
      },
      {
        speaker: 'npc_grand_vizier', speakerName: 'Великий Визирь',
        text: 'They were not stealing silk. They were buying silence.',
        textRu: 'Они не крали шёлк. Они покупали молчание.',
        delay: 500,
      },
      {
        speaker: 'npc_grand_vizier', speakerName: 'Великий Визирь',
        text: 'Twenty names, and not one of them is a soldier. All of them merchants.',
        textRu: 'Двадцать имён, и ни одного воина. Все — купцы.',
      },
      {
        speaker: 'narrator', speakerName: 'Рассказчик',
        text: 'The Silk Road does not run on silk. It runs on who decides whose cart gets through.',
        textRu: 'Шёлковый путь держится не на шёлке. Он держится на том, чья телега проедет.',
      },
    ],
  },
  {
    id: 'cut_030_caucasus',
    triggerQuest: 'main_030_caucasus_campaign',
    trigger: 'accept',
    title: 'Beyond the Mountains',
    titleRu: 'За горами',
    chapterId: 'ch_north',
    backdrop: 'caucasus_pass',
    lines: [
      {
        speaker: 'narrator', speakerName: 'Рассказчик',
        text: 'North of the pass the air changes. Thinner. Colder.',
        textRu: 'За перевалом воздух меняется. Реже. Холоднее.',
      },
      {
        speaker: 'narrator', speakerName: 'Рассказчик',
        text: 'Mongol riders burn a village every spring, and every spring the villages move a little further south.',
        textRu: 'Каждую весну монгольские всадники сжигают деревню, и каждую весну деревни уходят ещё чуть южнее.',
        delay: 500,
      },
      {
        speaker: 'narrator', speakerName: 'Рассказчик',
        text: 'This time they will not move. Neither will we.',
        textRu: 'В этот раз они не двинутся. И мы тоже.',
      },
    ],
  },
  {
    id: 'cut_040_desert',
    triggerQuest: 'main_040_desert_trial',
    trigger: 'accept',
    title: 'The Old Ones',
    titleRu: 'Старые',
    chapterId: 'ch_desert',
    backdrop: 'desert_dunes',
    lines: [
      {
        speaker: 'narrator', speakerName: 'Рассказчик',
        text: 'The desert does not forget. It only waits.',
        textRu: 'Пустыня не забывает. Она ждёт.',
      },
      {
        speaker: 'narrator', speakerName: 'Рассказчик',
        text: 'The Fire Div guarded these roads before the Safavids, and before them the Parthians.',
        textRu: 'Огненный Див охранял эти дороги ещё до Сефевидов, а до них — парфяне.',
        delay: 500,
      },
      {
        speaker: 'narrator', speakerName: 'Рассказчик',
        text: 'A Safavid does not ask the desert for permission.',
        textRu: 'Сефевид не спрашивает у пустыни разрешения.',
      },
    ],
  },
  {
    id: 'cut_050_gulf',
    triggerQuest: 'main_050_gulf_battle',
    trigger: 'accept',
    title: 'Sails on the Horizon',
    titleRu: 'Паруса на горизонте',
    // Глава, в списке сцен которой эта сцена числится (ch_north)
    chapterId: 'ch_north',
    backdrop: 'gulf_harbor',
    lines: [
      {
        speaker: 'narrator', speakerName: 'Рассказчик',
        text: 'The fishermen saw them at dawn. Too many, and not fishing.',
        textRu: 'Рыбаки увидели их на рассвете. Слишком много, и не рыбаки.',
      },
      {
        speaker: 'npc_gulf_harbor_master', speakerName: 'Лейла',
        text: 'Ottoman galleys. Four of them. They are not here for the fish.',
        textRu: 'Османские галеи. Четыре. Они пришли не за рыбой.',
        delay: 400,
      },
      {
        speaker: 'npc_gulf_harbor_master', speakerName: 'Лейла',
        text: 'My grandfather counted them from this same rock. He counted sixty.',
        textRu: 'Мой дед считал их с этой же скалы. Он насчитал шестьдесят.',
        delay: 300,
      },
      {
        speaker: 'npc_gulf_harbor_master', speakerName: 'Лейла',
        text: 'Today I counted four, and I am the one who is afraid.',
        textRu: 'Сегодня я насчитала четыре — и боюсь я.',
      },
    ],
  },
];

const BY_ID = new Map(CUTSCENES.map(c => [c.id, c]));

export function getCutscene(id: string): CutsceneDef | undefined {
  return BY_ID.get(id);
}

/** Сцена, которая проигрывается при событии квеста (или undefined) */
export function getCutsceneForQuest(questId: string, trigger: 'accept' | 'complete'): CutsceneDef | undefined {
  return CUTSCENES.find(c => c.triggerQuest === questId && c.trigger === trigger);
}
