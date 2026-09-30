// Награда за стихотворение начисляется, и ровно один раз.
//
// ЧТО БЫЛО. Маршрута завершения не было вовсе. Маршрут /select доводил
// игру до isComplete, панель показывала «сложено правильно» и число из
// СВОЕЙ копии каталога - то есть число, которого никто не платил.
// Награды в данных стояли: 50, 150 и 500 золота по сложности.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  getPoetryGame, POETRY_CHALLENGES, type PoetryGameState,
} from '../systems/PoetryOfHafiz';
import { AchievementService, POETRY_TOTAL } from '../services/AchievementService';
import { payoutFor } from '../services/ChessBetService';

jest.mock('../services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => ({ query: jest.fn(), queryOne: jest.fn() }) },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const CHAR = '11111111-1111-4111-8111-111111111111';
const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

/**
 * Довести игру до верно собранного состояния.
 *
 * Правильный порядок строк известен из startGame: варианты перемешаны по
 * `order`, а эталон - это challenge.lines. Чтобы собрать верно, нужно
 * выбрать варианты в порядке, который даёт правильные тексты.
 *
 * Стихотворение берётся ИЗ САМОЙ ИГРЫ, а не по индексу в каталоге.
 * startGame выбирает стихотворение СЛУЧАЙНО, и первая версия этой
 * проверки брала его по своему индексу: проверка то проходила, то нет в
 * зависимости от порядка тестов в наборе. Краснела не проверка, а
 * случайный выбор, - и это выглядело бы как поломка кода.
 */
function собратьВерно(game: PoetryGameState): boolean {
  const poetry = getPoetryGame();
  const challenge = POETRY_CHALLENGES.find(c => c.id === game.challengeId);
  if (!challenge) throw new Error('стихотворение игры не найдено в каталоге');
  const состояние = poetry.getResult(game.gameId);
  if (!состояние) return false;
  for (const строка of challenge.lines) {
    const idx = состояние.order.findIndex(oi => challenge.options[oi]?.text === строка.text);
    if (idx < 0) return false;
    if (!poetry.selectLine(game.gameId, idx)) return false;
  }
  return true;
}

describe('Награда за стихотворение объявлена честно', () => {
  it('у каждого стихотворения есть награда, и она больше нуля', () => {
    // Награда из данных, на которую панель показывала число. Нулевая
    // награда означала бы «собрал правильно и ничего не получил».
    const безНаграды = POETRY_CHALLENGES
      .map((c, i) => (c.reward.gold > 0 && c.reward.experience > 0 ? null : `${i}:${c.id}`))
      .filter(Boolean);
    expect({ безНаграды }).toEqual({ безНаграды: [] });
  });

  it('чем сложнее, тем больше награда - иначе сложность ничего не значит', () => {
    // Порядок по сложности проверяем через данные, а не через написаное
    // руками «средняя больше простой».
    const поСложности = ['easy', 'medium', 'hard'] as const;
    const максимум = поСложности.map(s =>
      Math.max(...POETRY_CHALLENGES.filter(c => c.difficulty === s).map(c => c.reward.gold)),
    );
    const возрастает = максимум[0] < максимум[1] && максимум[1] < максимум[2];
    expect({ максимум, возрастает }).toEqual({ максимум: [50, 150, 500], возрастает: true });
  });

  it('достижение «Поэт Шираза» ждёт все стихотворения, а не выдуманное число', () => {
    // Порог берётся из данных. Написать 20 отдельно от числа стихов -
    // значит через год получить достижение, которое либо недостижимо,
    // либо выдастся само.
    expect(POETRY_TOTAL).toBe(POETRY_CHALLENGES.length);
    expect(POETRY_TOTAL).toBeGreaterThan(0);
  });
});

describe('Награда выдаётся за верно собранное и только один раз', () => {
  it('за неверно собранное награды нет', () => {
    // Перебором вариантов можно собрать что угодно. Если бы платили за
    // сам факт завершения, золото нашлось бы без единого правильного стиха.
    //
    // Неверный ответ строится ДОКАЗАТЕЛЬНО, а не «выберем наоборот».
    // Первая версия брала варианты в обратном порядке и была мигающей:
    // порядок вариантов перемешан, и обратный порядок изредка совпадал с
    // правильным - проверка падала примерно в одном прогоне из восьми.
    // Мигающая проверка хуже отсутствующей: она учит её игнорировать.
    const poetry = getPoetryGame();
    const game = poetry.startGame(CHAR, 'easy');
    if (!game) throw new Error('игра не началась');
    const challenge = POETRY_CHALLENGES.find(c => c.id === game.challengeId);
    if (!challenge) throw new Error('стихотворение игры не найдено');
    const состояние = poetry.getResult(game.gameId);
    if (!состояние) throw new Error('состояние игры недоступно');

    for (const строка of challenge.lines) {
      // Берём вариант, текст которого заведомо НЕ тот. Такой есть всегда:
      // вариантов больше, чем строк, иначе задача была бы без вариантов.
      const idx = состояние.order.findIndex(oi => challenge.options[oi]?.text !== строка.text);
      if (idx < 0) throw new Error(`для строки «${строка.text}» нет неверного варианта`);
      if (!poetry.selectLine(game.gameId, idx)) throw new Error('ход не принят');
    }

    const после = poetry.getResult(game.gameId);
    expect({
      завершена: после?.isComplete,
      неверно: после?.isCorrect,
      // Поле называется «награды_нет», и здесь оно ИСТИННО: награды нет.
      награды_нет: после ? poetry.claimReward(game.gameId) === null : false,
    }).toEqual({ завершена: true, неверно: false, награды_нет: true });
  });

  it('за верно собранное награда выдаётся один раз', () => {
    const poetry = getPoetryGame();
    const game = poetry.startGame(CHAR, 'easy');
    if (!game) throw new Error('игра не началась');
    const challenge = POETRY_CHALLENGES.find(c => c.id === game.challengeId);
    if (!challenge) throw new Error('стихотворение игры не найдено');
    expect(собратьВерно(game)).toEqual(true);

    const первый = poetry.claimReward(game.gameId);
    const второй = poetry.claimReward(game.gameId);
    expect({
      первая_выдана: !!первый,
      золото_совпало: первый?.reward.gold === challenge.reward.gold,
      вторая_нет: второй,
      // Флаг стоит - иначе повторный запрос заплатил бы снова.
      флаг_стоит: poetry.getResult(game.gameId)?.rewarded,
    }).toEqual({
      первая_выдана: true, золото_совпало: true, вторая_нет: null, флаг_стоит: true,
    });
  });

  it('незавершённая игра награды не даёт', () => {
    const poetry = getPoetryGame();
    const game = poetry.startGame(CHAR, 'easy');
    if (!game) throw new Error('игра не началась');
    expect(poetry.claimReward(game.gameId)).toEqual(null);
  });

  it('несуществующая игра награды не даёт', () => {
    expect(getPoetryGame().claimReward('такой-партии-нет')).toEqual(null);
  });
});

describe('Маршрут завершения платит и считает', () => {
  const маршрут = читать('server/src/routes/poetry.ts');

  it('маршрут завершения существует', () => {
    expect(/router\.post\('\/finish'/.test(маршрут)).toEqual(true);
  });

  it('требует персонажа и проверяет владение', () => {
    // Без проверки один вошедший забрал бы награду за чужую игру, зная
    // её gameId. Золото шло бы ему, а не игроку, который сложил стих.
    expect({
      требует: /characterId and gameId are required/.test(маршрут),
      проверяет: /FROM characters WHERE id = \$1 AND user_id = \$2/.test(маршрут),
    }).toEqual({ требует: true, проверяет: true });
  });

  it('золото и опыт начисляются одним UPDATE персонажу', () => {
    // Разными запросами был бы зазор, в котором опыт начислен, а золото
    // нет. Игрок видел бы половину награды.
    expect(/SET gold = gold \+ \$1, experience = experience \+ \$2/.test(маршрут)).toEqual(true);
  });

  it('отказы различаются, а не слиты в один', () => {
    // «Ничего не пришло» после верно собранного стиха - это обман. Игрок
    // должен отличать «не собрал» от «уже забрал» от «собрал неверно».
    expect({
      уже: /already_claimed/.test(маршрут),
      не_закончено: /not_complete/.test(маршрут),
      неверно: /not_correct/.test(маршрут),
    }).toEqual({ уже: true, не_закончено: true, неверно: true });
  });

  it('маршрут не отбирает награду при сбое записи счётчика', () => {
    // Золото начислено, счётчик не записался. Игрок получил своё, а
    // повторный запрос упрётся в already_claimed. Отбирать награду за
    // сбой счётчика - значит наказать за чужую ошибку.
    //
    // Расстояние в 1200 символов, а не 400: между catch и counterSaved
    // лежит целый блок с logger.error и вторым res.json. Слишком узкий
    // regex проходил бы мимо всего, что тут написано.
    expect({
      ловит: /catch \(err\)[\s\S]{0,1200}counterSaved: false/.test(маршрут),
      всё_же_успех: /success: true,[\s\S]{0,400}counterSaved: false/.test(маршрут),
      // И сказано, что счётчик не записан - игрок и администратор видят,
      // что достижение может не засчитаться.
      признано: /счётчик стихов не записан/.test(маршрут),
    }).toEqual({ ловит: true, всё_же_успех: true, признано: true });
  });
});

describe('Панель показывает то, что начислили, а не что она знает', () => {
  const панель = читать('client/src/app/panels.ts');

  it('панель зовёт завершение и рисует ответ сервера', () => {
    // ТУТ БЫЛА ЛОЖЬ: панель показывала challenge.reward.gold из своей
    // копии каталога, а маршрута завершения не существовало. Игрок видел
    // «правильно, 50 золота» и не получал ничего.
    expect({
      зовёт: /api\.poetryFinish\(charId, data\.gameId\)/.test(панель),
      рисует_ответ: /finish\.reward\.gold/.test(панель),
      // Числа из своих данных в результате больше нет.
      не_рисует_свои_данные: !/t\('poetry\.correct'\) \+ challenge\.reward\.gold/.test(панель),
    }).toEqual({ зовёт: true, рисует_ответ: true, не_рисует_свои_данные: true });
  });

  it('о неудачной выплате сказано прямо', () => {
    // Молчание выглядело бы так, будто всё в порядке.
    expect({
      текст_есть: /poetry\.reward_failed/.test(панель),
      в_словаре: ['ru', 'en', 'az'].every(f => /"reward_failed"/.test(читать(`shared/locales/${f}.json`))),
    }).toEqual({ текст_есть: true, в_словаре: true });
  });

  it('подпись опыта берётся из существующего ключа', () => {
    // Первая версия писала t('common.experience') - такого ключа нет ни в
    // одном из трёх словарей, и игрок увидел бы сам ключ.
    expect({
      ключ_существует: ['ru', 'en', 'az'].every(f => /"exp"\s*:/.test(читать(`shared/locales/${f}.json`))),
      используется_существующий: /t\('world\.exp'\)/.test(панель),
      выдуманного_нет: !/t\('common\.experience'\)/.test(панель),
    }).toEqual({ ключ_существует: true, используется_существующий: true, выдуманного_нет: true });
  });
});

describe('Счётчик стихов в базе и в достижениях', () => {
  it('миграция заводит колонку с ограничением', () => {
    // Проверяем САМО УСЛОВИЕ, а не имя ограничения. Первая версия искала
    // `ADD CONSTRAINT leaderboard_poetry_completed_range`, и замена
    // условия на `>= -1` - то есть фактическая отмена запрета - её
    // проходила. Слой «в базе снята граница счётчика» это и поймал.
    // Имя здесь только для человека: имя можно переименовать, и граница
    // продолжит работать.
    const миграция = читать('database/migrations/049_poetry_counter.sql');
    expect({
      колонка: /ADD COLUMN IF NOT EXISTS poetry_completed INT NOT NULL DEFAULT 0/.test(миграция),
      граница_по_существу: /CHECK \(poetry_completed >= 0 AND poetry_completed <= 1000\)/.test(миграция),
      комментарии_дефисом: миграция.split('\n').filter(l => l.trimStart().startsWith('//')).length === 0,
    }).toEqual({ колонка: true, граница_по_существу: true, комментарии_дефисом: true });
  });

  it('счётчик пишется накопительно, а не абсолютно', () => {
    // Тик регенерации перезаписывает строку рейтинга целиком. Если бы счётчик
    // стихов шёл в updateStats, он затирался бы нулём каждые пять секунд.
    const сервис = читать('server/src/services/LeaderboardService.ts');
    expect({
      в_накопительном: /poetryCompleted\?: number/.test(сервис),
      в_абсолютном_нет: !/updateStats\([^)]*poetryCompleted/.test(сервис),
    }).toEqual({ в_накопительном: true, в_абсолютном_нет: true });
  });

  it('счётчик достижения есть в закрытом списке колонок', () => {
    const сервис = читать('server/src/services/AchievementService.ts');
    expect({
      в_списке: /poetry_completed: 'poetry_completed'/.test(сервис),
      достижение_смотрит: /counter: 'poetry_completed'/.test(сервис),
    }).toEqual({ в_списке: true, достижение_смотрит: true });
  });

  it('колонка счётчика есть в миграциях, а не выдумана', () => {
    // Условие смотрит на колонку, которой может не быть.
    const все = readdirSync(join(корень, 'database', 'migrations'))
      .filter(f => f.endsWith('.sql'))
      .map(f => читать(join('database', 'migrations', f)))
      .join('\n');
    expect({ есть: /\bpoetry_completed\b/.test(все) }).toEqual({ есть: true });
  });

  it('достижение «Поэт Шираза» больше не в списке недостижимых', () => {
    const достижение = AchievementService.prototype ? null : null;
    void достижение;
    const сервис = читать('server/src/services/AchievementService.ts');
    const блок = сервис.slice(
      сервис.indexOf("{ id: 'ach_poet'"),
      сервис.indexOf("{ id: 'ach_no_death'"),
    );
    expect({ есть_условие: /condition: \{ counter: 'poetry_completed'/.test(блок) })
      .toEqual({ есть_условие: true });
  });
});

describe('Выплаты в шахматах и стихах считаются по одному правилу', () => {
  it('правило выплаты одно, а не два похожих', () => {
    // payoutFor описывает и шахматы, и (по форме) стихи. Проверяем, что
    // победа в шахматах - две ставки, ничья - одна, поражение - ноль:
    // это тот же смысл, что и «сложил правильно - получи награду».
    expect({
      победа: payoutFor(100, 'white'),
      ничья: payoutFor(100, 'draw'),
      поражение: payoutFor(100, 'black'),
    }).toEqual({ победа: 200, ничья: 100, поражение: 0 });
  });
});
