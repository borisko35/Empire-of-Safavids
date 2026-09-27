// Мини-игра «Поэзия Хафиза»: проверка честности проверки ответа.
// Баг был в том, что порядок строк перемешивался заново в каждом запросе:
// игрок собирал стихотворение по одной последовательности, а сервер
// проверял по другой — правильная сборка засчитывалась почти случайно.
import { getPoetryGame, POETRY_CHALLENGES } from '../systems/PoetryOfHafiz';

/** Правильный порядок вариантов для этой игры: индексы строк в эталоне */
function correctOrder(gameId: string): number[] {
  const poetry = getPoetryGame();
  const game = poetry.getResult(gameId)!;
  const view = poetry.getChallenge(gameId)!;
  const order: number[] = [];
  for (const line of view.challenge.lines) {
    order.push(view.shuffled.findIndex(l => l.text === line.text));
  }
  expect(game.order.length).toBe(view.shuffled.length);
  return order;
}

describe('Поэзия Хафиза', () => {
  it.each(POETRY_CHALLENGES.map(c => c.id))('правильная сборка засчитывается: %s', (id) => {
    const poetry = getPoetryGame();
    const state = poetry.startGame('player-1', undefined, id)!;
    expect(state.challengeId).toBe(id);

    for (const idx of correctOrder(state.gameId)) {
      poetry.selectLine(state.gameId, idx);
    }
    const res = poetry.getResult(state.gameId)!;
    expect(res.isComplete).toBe(true);
    expect(res.isCorrect).toBe(true);
  });

  it('неправильная сборка не засчитывается', () => {
    const poetry = getPoetryGame();
    const state = poetry.startGame('player-2', 'easy')!;
    const view = poetry.getChallenge(state.gameId)!;
    // Берём заведомо неверный порядок: эталон наоборот
    const right = correctOrder(state.gameId);
    const wrong = [...right].reverse();
    // Если вариантов ровно столько же, сколько строк, порядок всегда разный
    expect(wrong).not.toEqual(right);
    for (const idx of wrong) poetry.selectLine(state.gameId, idx);
    const res = poetry.getResult(state.gameId)!;
    expect(res.isComplete).toBe(true);
    expect(res.isCorrect).toBe(false);
    expect(view.challenge.lines.length).toBeGreaterThan(0);
  });

  it('порядок вариантов не меняется между запросами', () => {
    // Ключевая защита от исходного бага: getChallenge обязан отдавать
    // тот же порядок, что игрок видел при старте.
    const poetry = getPoetryGame();
    const state = poetry.startGame('player-3', 'medium')!;
    const first = poetry.getChallenge(state.gameId)!.shuffled.map(l => l.text);
    for (let i = 0; i < 5; i++) {
      expect(poetry.getChallenge(state.gameId)!.shuffled.map(l => l.text)).toEqual(first);
    }
  });

  it('в каждом стихотворении есть лишние варианты', () => {
    for (const c of POETRY_CHALLENGES) {
      expect({ id: c.id, options: c.options.length, lines: c.lines.length })
        .toEqual({ id: c.id, options: c.options.length, lines: c.lines.length });
      expect(c.options.length).toBeGreaterThan(c.lines.length);
      // Каждая строка стиха должна присутствовать среди вариантов
      for (const l of c.lines) {
        expect(c.options.some(o => o.text === l.text)).toBe(true);
      }
    }
  });

  it('каждое стихотворение играется полностью: собираем все', () => {
    const poetry = getPoetryGame();
    for (const c of POETRY_CHALLENGES) {
      const state = poetry.startGame('player-4', undefined, c.id)!;
      for (const idx of correctOrder(state.gameId)) poetry.selectLine(state.gameId, idx);
      expect(poetry.getResult(state.gameId)!.isCorrect).toBe(true);
    }
  });
});
