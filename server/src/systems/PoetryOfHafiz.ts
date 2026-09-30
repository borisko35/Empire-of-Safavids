// ============================================================
// Poetry of Hafiz — Мини-игра: стихотворение — Empire of Safavids
// ============================================================
// Мини-игра в таверне: собрать правильные строки стихотворения.
// Уникальная культурная фишка — стихи Хафиза Ширази.
// Уровень сложности зависит от уровня игрока.

import { logger } from '../utils/logger';

export interface PoetryLine {
  text: string;
  textRu: string;
}

/**
 * Награда за стихотворение. Отдельный тип, а не строчка в объекте:
 * маршрут завершения возвращает её клиенту, и тип должен совпадать с
 * тем, что лежит в данных.
 */
export interface PoetryReward {
  gold: number;
  experience: number;
  title?: string;
}

export interface PoetryChallenge {
  id: string;
  title: string;
  titleRu: string;
  lines: PoetryLine[];          // Правильный порядок
  options: PoetryLine[];        // Все строки (вперемешку + лишние)
  difficulty: 'easy' | 'medium' | 'hard';
  reward: PoetryReward;
}

export interface PoetryGameState {
  gameId: string;
  challengeId: string;
  selectedLines: number[];      // Индексы выбранных строк (в порядке выбора)
  /** Перемешанный порядок, зафиксированный при старте игры.
   *  Раньше порядок перемешивался заново в каждом запросе, и игрок
   *  собирал стихотворение по одной последовательности, а сервер
   *  проверял по другой — правильный ответ засчитывался почти случайно. */
  order: number[];
  isComplete: boolean;
  isCorrect: boolean;
  /** Награда уже забрана. Ставится только после успешной выплаты. */
  rewarded: boolean;
}

export const POETRY_CHALLENGES: PoetryChallenge[] = [
  // ── ЛЁГКИЕ (1-2 лишних строки) ────────────────────────────
  {
    id: 'poem_ghazal_1',
    title: 'Ghazal of the Heart',
    titleRu: 'Газель Сердца',
    lines: [
      { text: 'If that beauty of Shiraz takes our heart in hand,', textRu: 'Если та красавица Шираза возьмёт наше сердце в руки,' },
      { text: 'For that dark mole I would give Samarkand and Bukhara.', textRu: 'За ту тёмную родинку я отдал бы Самарканд и Бухару.' },
    ],
    options: [
      { text: 'If that beauty of Shiraz takes our heart in hand,', textRu: 'Если та красавица Шираза возьмёт наше сердце в руки,' },
      { text: 'For that dark mole I would give Samarkand and Bukhara.', textRu: 'За ту тёмную родинку я отдал бы Самарканд и Бухару.' },
      { text: 'The garden of the world has no end, but the horizon.', textRu: 'Сад мира не имеет конца, но имеет горизонт.' },
    ],
    difficulty: 'easy',
    reward: { gold: 50, experience: 100 },
  },
  {
    id: 'poem_ghazal_2',
    title: 'On Wine and Roses',
    titleRu: 'О Вине и Розах',
    lines: [
      { text: 'Come, let us scatter roses and drink wine.', textRu: 'Давай, рассыплем розы и выпьем вина.' },
      { text: 'Let us fill the cup and pour out sorrow.', textRu: 'Давай наполним чашу и выльем печаль.' },
    ],
    options: [
      { text: 'Come, let us scatter roses and drink wine.', textRu: 'Давай, рассыплем розы и выпьем вина.' },
      { text: 'The night is young and the stars are bright.', textRu: 'Ночь молода и звёзды ярки.' },
      { text: 'Let us fill the cup and pour out sorrow.', textRu: 'Давай наполним чашу и выльем печаль.' },
    ],
    difficulty: 'easy',
    reward: { gold: 50, experience: 100 },
  },

  // ── СРЕДНИЕ (3-4 строки) ──────────────────────────────────
  {
    id: 'poem_ghazal_3',
    title: 'The Nightingale and the Rose',
    titleRu: 'Соловей и Роза',
    lines: [
      { text: 'The nightingale sings to the rose, drunk with love.', textRu: 'Соловей поёт розе, пьян от любви.' },
      { text: 'Her fragrance fills the garden of Isfahan.', textRu: 'Её аромат наполняет сад Исфахана.' },
      { text: 'The wine of love intoxicates the soul.', textRu: 'Вино любви опьяняет душу.' },
    ],
    options: [
      { text: 'The nightingale sings to the rose, drunk with love.', textRu: 'Соловей поёт розе, пьян от любви.' },
      { text: 'Her fragrance fills the garden of Isfahan.', textRu: 'Её аромат наполняет сад Исфахана.' },
      { text: 'The mountain echoes with the cry of eagles.', textRu: 'Гора эхом откликается на крик орлов.' },
      { text: 'The wine of love intoxicates the soul.', textRu: 'Вино любви опьяняет душу.' },
      { text: 'Silk curtains sway in the desert wind.', textRu: 'Шёлковые шторы покачиваются в пустынном ветре.' },
    ],
    difficulty: 'medium',
    reward: { gold: 150, experience: 300 },
  },
  {
    id: 'poem_ghazal_4',
    title: 'The Sultan\'s Garden',
    titleRu: 'Сад Султана',
    lines: [
      { text: 'In the garden of the Shah, the tulips bloom red.', textRu: 'В саду Шаха тюльпаны цветут красным.' },
      { text: 'The fountain whispers secrets to the moon.', textRu: 'Фонтан шепчет тайны луне.' },
      { text: 'Silk banners wave in the evening breeze.', textRu: 'Шёлковые знамёна развеваются в вечернем бризе.' },
    ],
    options: [
      { text: 'In the garden of the Shah, the tulips bloom red.', textRu: 'В саду Шаха тюльпаны цветут красным.' },
      { text: 'The fountain whispers secrets to the moon.', textRu: 'Фонтан шепчет тайны луне.' },
      { text: 'The sword hangs heavy on the warrior\'s belt.', textRu: 'Меч тяжёл на поясе воина.' },
      { text: 'Silk banners wave in the evening breeze.', textRu: 'Шёлковые знамёна развеваются в вечернем бризе.' },
    ],
    difficulty: 'medium',
    reward: { gold: 150, experience: 300 },
  },

  // ── СЛОЖНЫЕ (5-6 строк) ───────────────────────────────────
  {
    id: 'poem_ghazal_5',
    title: 'The Great Ghazal',
    titleRu: 'Великая Газель',
    lines: [
      { text: 'At dawn I heard the nightingale weep for the rose.', textRu: 'На заре я услышал, как соловей оплакивает розу.' },
      { text: 'Its tears of dew upon the garden close.', textRu: 'Его слёзы росы на садовых утёсах.' },
      { text: 'The drunkard staggers through the morning mist.', textRu: 'Пьяный шатается сквозь утренний туман.' },
      { text: 'While Hafiz sings what the beloved bestows.', textRu: 'Пока Хафиз поёт то, что дарует возлюбленная.' },
    ],
    options: [
      { text: 'At dawn I heard the nightingale weep for the rose.', textRu: 'На заре я услышал, как соловей оплакивает розу.' },
      { text: 'Its tears of dew upon the garden close.', textRu: 'Его слёзы росы на садовых утёсах.' },
      { text: 'The desert stretches endless, hot and bare.', textRu: 'Пустыня простирается бесконечная, жаркая и голая.' },
      { text: 'The drunkard staggers through the morning mist.', textRu: 'Пьяный шатается сквозь утренний туман.' },
      { text: 'While Hafiz sings what the beloved bestows.', textRu: 'Пока Хафиз поёт то, что дарует возлюбленная.' },
      { text: 'The merchant counts his gold in dusty rooms.', textRu: 'Торговец считает золото в пыльных комнатах.' },
    ],
    difficulty: 'hard',
    reward: { gold: 500, experience: 800, title: 'Знаток Хафиза' },
  },
];

export class PoetryOfHafiz {
  private games = new Map<string, PoetryGameState>();

  /**
   * Перемешать индексы строк. Фишер–Йетс — честный тасователь:
   * sort(() => Math.random() - 0.5) даёт заметно неравномерный порядок.
   * `keep` — начало диапазона, чтобы при заданной сложности вариантов
   * было больше, чем нужно для сборки (лишние строки — часть игры).
   */
  private static shuffleIndices(from: number, to: number): number[] {
    const idx = Array.from({ length: to - from }, (_, i) => from + i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
  }

  /** Начать новую игру */
  startGame(playerId: string, difficulty?: string, challengeId?: string): PoetryGameState | null {
    // Выбрать стихотворение: по id, если выбрано конкретное, иначе по сложности
    let pool = POETRY_CHALLENGES;
    if (challengeId) {
      const byId = pool.filter(p => p.id === challengeId);
      if (byId.length) pool = byId;
    }
    if (difficulty) pool = pool.filter(p => p.difficulty === difficulty);
    if (pool.length === 0) pool = POETRY_CHALLENGES;

    const challenge = pool[Math.floor(Math.random() * pool.length)];

    // Порядок вариантов — один на игру, дальше он неизменен
    const order = PoetryOfHafiz.shuffleIndices(0, challenge.options.length);

    const gameId = `poetry_${playerId}_${Date.now()}`;
    const state: PoetryGameState = {
      gameId,
      challengeId: challenge.id,
      selectedLines: [],
      order,
      isComplete: false,
      isCorrect: false,
      rewarded: false,
    };

    this.games.set(gameId, state);
    logger.info(`[Poetry] Game ${gameId} started (${challenge.difficulty})`);
    return state;
  }

  /** Выбрать строку */
  selectLine(gameId: string, lineIndex: number): PoetryGameState | null {
    const game = this.games.get(gameId);
    if (!game || game.isComplete) return null;

    game.selectedLines.push(lineIndex);

    const challenge = POETRY_CHALLENGES.find(c => c.id === game.challengeId);
    if (!challenge) return null;

    // Проверяем, собраны ли все строки
    if (game.selectedLines.length === challenge.lines.length) {
      game.isComplete = true;
      // Проверяем правильность
      game.isCorrect = this.checkAnswer(game, challenge);
    }

    return game;
  }

  /**
   * Проверить ответ: игрок выбирал варианты в порядке `order`, который
   * был показан ему с самого начала. Правильные строки идут в том же
   * порядке — сверяем тексты выбранных вариантов с эталоном.
   */
  private checkAnswer(game: PoetryGameState, challenge: PoetryChallenge): boolean {
    if (game.selectedLines.length !== challenge.lines.length) return false;
    return game.selectedLines.every((optionIndex, step) => {
      const line = challenge.options[game.order[optionIndex]];
      return line?.text === challenge.lines[step].text;
    });
  }

  /**
   * Забрать награду за игру.
   *
   * ВОЗВРАЩАЕТ НАГРАДУ, А НЕ ФЛАГ. Раньше маршрута завершения не было
   * вовсе: игра доходила до конца, игрок видел, что сложил стихотворение,
   * и не получал ничего. Награды в данных стояли - 50, 150 и 500 золота.
   *
   * null - это отказ, а не ошибка, и отказов тут четыре, каждый со своим
   * смыслом: игра не найдена, стихотворение не собрано, собрано неверно,
   * награда уже забрана. Игрок должен различать их - «ничего не пришло»
   * после верно собранного стиха это обман.
   */
  claimReward(gameId: string): { reward: PoetryReward; challengeId: string; difficulty: PoetryChallenge['difficulty'] } | null {
    const game = this.games.get(gameId);
    if (!game) return null;
    if (!game.isComplete) return null;
    // Неверно собранное не оплачивается. Иначе перебором вариантов
    // можно было бы собрать что угодно и получить золото за это.
    if (!game.isCorrect) return null;
    // Флаг в самой игре, а не в базе: повторный запрос /finish вернул бы
    // null. Игра живёт в памяти процесса, поэтому после перезапуска её
    // нет - и платить за неё тоже нечего, то есть повторной выплаты
    // после перезапуска случиться не может.
    if (game.rewarded) return null;

    const challenge = POETRY_CHALLENGES.find(c => c.id === game.challengeId);
    if (!challenge) return null;

    game.rewarded = true;
    return { reward: challenge.reward, challengeId: challenge.id, difficulty: challenge.difficulty };
  }

  /** Получить результат */
  getResult(gameId: string): PoetryGameState | null {
    return this.games.get(gameId) ?? null;
  }

  /** Получить стихотворение в зафиксированном для этой игры порядке вариантов */
  getChallenge(gameId: string): { challenge: PoetryChallenge; shuffled: PoetryLine[] } | null {
    const game = this.games.get(gameId);
    if (!game) return null;
    const challenge = POETRY_CHALLENGES.find(c => c.id === game.challengeId);
    if (!challenge) return null;
    const shuffled = game.order.map(i => challenge.options[i]).filter(Boolean);
    return { challenge, shuffled };
  }

  /** Удалить игру */
  deleteGame(gameId: string): void {
    this.games.delete(gameId);
  }
}

// Singleton
let instance: PoetryOfHafiz | null = null;
export function getPoetryGame(): PoetryOfHafiz {
  if (!instance) instance = new PoetryOfHafiz();
  return instance;
}
