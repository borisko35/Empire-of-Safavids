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

export interface PoetryChallenge {
  id: string;
  title: string;
  titleRu: string;
  lines: PoetryLine[];          // Правильный порядок
  options: PoetryLine[];        // Все строки (вперемешку + лишние)
  difficulty: 'easy' | 'medium' | 'hard';
  reward: { gold: number; experience: number; title?: string };
}

export interface PoetryGameState {
  gameId: string;
  challengeId: string;
  selectedLines: number[];      // Индексы выбранных строк (в порядке выбора)
  isComplete: boolean;
  isCorrect: boolean;
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

  /** Начать новую игру */
  startGame(playerId: string, difficulty?: string): PoetryGameState | null {
    // Выбрать стихотворение по сложности
    let pool = POETRY_CHALLENGES;
    if (difficulty) pool = pool.filter(p => p.difficulty === difficulty);
    if (pool.length === 0) pool = POETRY_CHALLENGES;

    const challenge = pool[Math.floor(Math.random() * pool.length)];

    const gameId = `poetry_${playerId}_${Date.now()}`;
    const state: PoetryGameState = {
      gameId,
      challengeId: challenge.id,
      selectedLines: [],
      isComplete: false,
      isCorrect: false,
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

  /** Проверить ответ */
  private checkAnswer(game: PoetryGameState, challenge: PoetryChallenge): boolean {
    // Перемешанные варианты — нужно проверить, что выбранные строки совпадают с правильными
    const shuffled = [...challenge.options].sort(() => Math.random() - 0.5);
    const selectedTexts = game.selectedLines.map(i => shuffled[i]?.text);
    const correctTexts = challenge.lines.map(l => l.text);
    return JSON.stringify(selectedTexts) === JSON.stringify(correctTexts);
  }

  /** Получить результат */
  getResult(gameId: string): PoetryGameState | null {
    return this.games.get(gameId) ?? null;
  }

  /** Получить стихотворение (с перемешанными вариантами) */
  getChallenge(gameId: string): { challenge: PoetryChallenge; shuffled: PoetryLine[] } | null {
    const game = this.games.get(gameId);
    if (!game) return null;
    const challenge = POETRY_CHALLENGES.find(c => c.id === game.challengeId);
    if (!challenge) return null;
    const shuffled = [...challenge.options].sort(() => Math.random() - 0.5);
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
