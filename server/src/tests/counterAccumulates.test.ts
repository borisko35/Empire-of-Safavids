// Накопительные счётчики рейтинга действительно копятся.
//
// ЧТО БЫЛО. В `increment` плейсхолдер счётчика считался как `$<номер в
// массиве значений>`, а `$1` в этом запросе - character_id, то есть UUID
// персонажа. Ошибка возникала только на ветке DO UPDATE, то есть когда
// строка рейтинга УЖЕ ЕСТЬ: первое событие создавало строку через VALUES и
// проходило, все последующие падали.
//
// На боевом сервере в таблице leaderboard было ноль убийств при работающей
// вкладке «Убийства». Счётчик «работал» ровно один раз на персонажа, а всё
// остальное молча глотал catch. То же касалось парирований и стихов.
//
// ПРОВЕРКА. Считаем плейсхолдеры в обоих местах запроса и сверяем их с
// позициями в VALUES. Это единственный способ поймать ошибку без базы:
// выполнить запрос здесь нечем, а искать текст недостаточно - нужна
// арифметика.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LeaderboardService } from '../services/LeaderboardService';

jest.mock('../services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => ({ query: jest.fn(), queryOne: jest.fn() }) },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const CHAR = '11111111-1111-4111-8111-111111111111';
const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function подменить(): { service: LeaderboardService; запросы: { sql: string; params: unknown[] }[] } {
  const service = new LeaderboardService();
  const запросы: { sql: string; params: unknown[] }[] = [];
  (service as unknown as { db: unknown }).db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      запросы.push({ sql, params });
      return [];
    }),
    queryOne: jest.fn(),
  };
  return { service, запросы };
}

/**
 * Разобрать запрос и свести плейсхолдеры к числам.
 *
 * `$1` в VALUES - это character_id, а не счётчик, поэтому он отбрасывается:
 * иначе «первый счётчик» оказывался бы номером 1, и проверка ругалась бы
 * на заведомо верный код. Первая версия разбора именно так и сделала.
 */
function разобрать(sql: string): { счётчикиВValues: number[]; счётчикиВUpdate: number[]; все: number[] } {
  const значения = sql.slice(sql.indexOf('VALUES'), sql.indexOf('ON CONFLICT'));
  const обновление = sql.slice(sql.indexOf('DO UPDATE SET'));
  const номера = (текст: string): number[] =>
    (текст.match(/\$(\d+)/g) ?? []).map(s => Number(s.slice(1)));
  // В VALUES первым идёт $1 - идентификатор персонажа.
  const счётчикиВValues = номера(значения).slice(1);
  const счётчикиВUpdate = номера(обновление);
  const все = [...new Set([1, ...счётчикиВValues, ...счётчикиВUpdate])].sort((a, b) => a - b);
  return { счётчикиВValues, счётчикиВUpdate, все };
}

describe('Плейсхолдеры счётчика не наезжают на идентификатор', () => {
  it('первый счётчик - это $2, а не $1', async () => {
    // Ровно та ошибка, что стоила на проде нуля убийств: счётчик брал $1,
    // а $1 - это UUID персонажа.
    const { service, запросы } = подменить();
    await service.increment(CHAR, { monstersKilled: 1 });
    const p = разобрать(запросы[0].sql);
    expect({
      первый_счётчик_в_values: p.счётчикиВValues[0],
      первый_счётчик_в_update: p.счётчикиВUpdate[0],
      они_совпадают: p.счётчикиВValues[0] === p.счётчикиВUpdate[0],
      не_единица: p.счётчикиВUpdate[0] !== 1,
    }).toEqual({ первый_счётчик_в_values: 2, первый_счётчик_в_update: 2, они_совпадают: true, не_единица: true });
  });

  it('каждый счётчик занимает свой номер и ни один не повторяется', async () => {
    // Три счётчика: плейсхолдеры должны идти подряд со второго, по одному
    // на счётчик, без пропусков и повторов.
    const { service, запросы } = подменить();
    await service.increment(CHAR, { monstersKilled: 1, parries: 2, poetryCompleted: 3 });
    const p = разобрать(запросы[0].sql);
    const ожидаем = [2, 3, 4];
    expect({
      в_values: p.счётчикиВValues,
      в_update: p.счётчикиВUpdate,
      подряд_со_второго: JSON.stringify(p.счётчикиВValues) === JSON.stringify(ожидаем),
      повторов_нет: p.счётчикиВUpdate.length === new Set(p.счётчикиВUpdate).size,
      единица_не_использована: !p.счётчикиВUpdate.includes(1),
    }).toEqual({
      в_values: ожидаем, в_update: ожидаем,
      подряд_со_второго: true, повторов_нет: true, единица_не_использована: true,
    });
  });

  it('число плейсхолдеров совпадает с числом значений', async () => {
    // Расхождение на единицу означало бы, что параметр не передаётся или
    // передаётся не туда. Именно так выглядит «всё работает, а на второй
    // раз падает».
    const проверки: { набор: string; получили: number; ждали: number }[] = [];
    for (const счётчики of [
      { monstersKilled: 1 },
      { parries: 1 },
      { poetryCompleted: 1 },
      { monstersKilled: 1, parries: 1 },
      { monstersKilled: 1, parries: 1, poetryCompleted: 1 },
    ]) {
      const лок = подменить();
      await лок.service.increment(CHAR, счётчики);
      const p = разобрать(лок.запросы[0].sql);
      // +1 за character_id
      проверки.push({
        набор: Object.keys(счётчики).join('+'),
        получили: p.все.length,
        ждали: Object.values(счётчики).length + 1,
      });
    }
    // Все наборы должны совпасть с ожиданием: показываем списком, чтобы
    // падение сразу называло, какой набор сошёлся криво.
    expect(проверки.map(v => ({ ...v, ок: v.получили === v.ждали })).every(v => v.ок))
      .toEqual(true);
    expect(проверки).toEqual(проверки.map(v => ({ набор: v.набор, получили: v.ждали, ждали: v.ждали })));
  });

  it('в DO UPDATE идёт сложение с прежним значением, а не присваивание', async () => {
    // Присваивание обнулило бы счётчик каждым новым событием, и он навсегда
    // показывал бы 1.
    const { service, запросы } = подменить();
    await service.increment(CHAR, { monstersKilled: 1, parries: 2 });
    const sql = запросы[0].sql;
    const обновлениеЧасть = sql.slice(sql.indexOf('DO UPDATE SET'));
    expect({
      убийства_складываются: /monsters_killed = leaderboard\.monsters_killed \+ \$2/.test(sql),
      парирования_складываются: /parries = leaderboard\.parries \+ \$3/.test(sql),
      // Присваивание было бы `monsters_killed = $2` - без `leaderboard.x +`.
      присваиваний_нет: !/=\s*\$\d+\s*[,;]/.test(обновлениеЧасть),
    }).toEqual({ убийства_складываются: true, парирования_складываются: true, присваиваний_нет: true });
  });

  it('значения передаются в том же порядке, что и колонки', async () => {
    // Порядок в VALUES и в массиве параметров разойтись может, если бы
    // счётчик отбрасывался при нуле: колонка сдвинулась бы, а параметр
    // остался бы на месте.
    const { service, запросы } = подменить();
    await service.increment(CHAR, { monstersKilled: 0, parries: 5 });
    const { sql, params } = запросы[0];
    expect({
      нуль_пропущен: !sql.includes('monsters_killed'),
      параметры: params,
    }).toEqual({ нуль_пропущен: true, параметры: [CHAR, 5] });
  });

  it('счётчик пишется через номер позиции, а не через длину массива', () => {
    // Проверка по исходнику, потому что считать поведение подменой
    // бессмысленно: подмена не выполняет SQL, и ошибку нумерации видит
    // только арифметика выше. Здесь страхуем от возврата к старой форме.
    const код = читать('server/src/services/LeaderboardService.ts');
    expect({ сдвиг_на_единицу: /const ph = `\$\$\{values\.length \+ 1\}`/.test(код) })
      .toEqual({ сдвиг_на_единицу: true });
  });
});

describe('Дорожная карта не врёт про счётчик убийств', () => {
  it('счётчик убийств действительно копится', () => {
    // В дорожной карте было написано, что вкладка «Убийства» перестала
    // показывать ноль у всех. На проде в рейтинге было ноль убийств -
    // счётчик работал ровно один раз на персонажа. Проверка по исходнику
    // страхует от тихого возврата.
    const код = читать('server/src/services/LeaderboardService.ts');
    expect({
      метод_есть: /async increment\(characterId: string, counters/.test(код),
      убийства_в_списке: /monstersKilled\?: number/.test(код),
      вызывается_из_боя: /leaderboardService\.increment\(attacker\.id, \{ monstersKilled: 1 \}\)/.test(
        читать('server/src/socket/GameSocketHandler.ts'),
      ),
    }).toEqual({ метод_есть: true, убийства_в_списке: true, вызывается_из_боя: true });
  });
});
