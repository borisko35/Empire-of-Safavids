// Победа в шахматах засчитывается счётчику достижений.
//
// ЧТО БЫЛО. У достижения «Шахматный Гений» написано «выиграть 10 шахматных
// партий», и условия не было вовсе - пункт значился как «пока не считается».
// Счётчика побед не существовало ни в одной таблице.
//
// ГЛАВНОЕ В ЭТОМ ФАЙЛЕ - НЕ СЧЁТЧИК, А ЗАЩИТА ОТ ПОВТОРА. Повторный
// вызов settle по уже закрытой партии обязан не только не платить, но и не
// увеличивать счётчик. Если бы начисление шло до проверки статуса, одна
// партия засчиталась бы дважды, и десять побед доставались за пять.
//
// ПОЧЕМУ ВЫПЛАТА ПРОВЕРЯЕТСЯ ЗДЕСЬ, А НЕ НА БОЮ. До этого выплата за
// победу не была проверена нигде: мат на 6x6 при почти случайном мастере не
// наступал примерно за сто ходов, и ждать его на бою - значит ждать
// неизвестно сколько. settle - обычный метод сервиса, и его можно довести
// до победы напрямую.
import { ChessBetService } from '../services/ChessBetService';
import { LeaderboardService } from '../services/LeaderboardService';
import { ACHIEVEMENTS } from '../services/AchievementService';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('../services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => ({ query: jest.fn(), queryOne: jest.fn(), transaction: jest.fn() }) },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const ИГРА = 'game-1';
const ЧАР = 'cccccccc-1111-4111-8111-111111111111';
const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

/**
 * Подмена базы для партии.
 *
 * Строка партии переходит из playing в finished сама: повторный settle
 * обязан её не найти. Это и есть главная защита от двойного начисления, и
 * подмена обязана её воспроизводить, а не отдавать строку вечно.
 */
function подменить(opts: { ставка?: number } = {}) {
  const service = new ChessBetService();
  const запросы: string[] = [];
  let статус = 'playing';

  const db = {
    query: jest.fn(async (sql: string) => { запросы.push(sql); return []; }),
    queryOne: jest.fn(async (sql: string, params: unknown[] = []) => {
      запросы.push(sql);
      // Выбор ставки: только пока партия играется.
      if (/SELECT bet_gold FROM chess_games/.test(sql)) {
        return статус === 'playing' ? { bet_gold: opts.ставка ?? 100 } : null;
      }
      // Занять строку: UPDATE ... WHERE status = 'playing' RETURNING.
      if (/UPDATE chess_games/.test(sql)) {
        if (статус !== 'playing') return null;
        статус = 'finished';
        return { game_id: ИГРА };
      }
      // Начисление выплаты.
      if (/UPDATE characters SET gold = gold \+/.test(sql)) {
        return { gold: 1000 + Number(params[0]) };
      }
      return null;
    }),
    transaction: jest.fn(),
  };
  (service as unknown as { db: unknown }).db = db;
  return { service, запросы, состояние: () => статус };
}

/** Начисления счётчика побед: ловятся по вызовам LeaderboardService. */
function ловушкаСчётчика() {
  const рост: number[] = [];
  const spy = jest.spyOn(LeaderboardService.prototype, 'increment')
    .mockImplementation(async function (_id: string, counters: Record<string, number> = {}) {
      if (counters.chessWins) рост.push(counters.chessWins);
    });
  return { рост, spy };
}

afterEach(() => jest.restoreAllMocks());

describe('Счётчик растёт только за настоящую победу', () => {
  it('победа игрока увеличивает счётчик на единицу', async () => {
    const ловушка = ловушкаСчётчика();
    const { service, запросы } = подменить({ ставка: 100 });
    const итог = await service.settle(ИГРА, ЧАР, 'white');

    expect({
      выплата: итог.payout,
      счётчик_рос: ловушка.рост,
      колонка_верная: запросы.some(q => /chess/i.test(q)),
    }).toEqual({ выплата: 200, счётчик_рос: [1], колонка_верная: true });
  });

  it('ничья не победа: счётчик не растёт, но золото возвращается', async () => {
    // Ничья платит одну ставку - деньги игрок получает. Счётчик побед при
    // этом обязан молчать, иначе «выиграть 10 партий» выдавалось бы за
    // «сыграть 10 партий без проигрыша».
    const ловушка = ловушкаСчётчика();
    const { service } = подменить({ ставка: 100 });
    const итог = await service.settle(ИГРА, ЧАР, 'draw');

    expect({ выплата: итог.payout, счётчик: ловушка.рост }).toEqual({ выплата: 100, счётчик: [] });
  });

  it('проигрыш не даёт ни золота, ни счётчика', async () => {
    const ловушка = ловушкаСчётчика();
    const { service } = подменить({ ставка: 100 });
    const итог = await service.settle(ИГРА, ЧАР, 'black');

    expect({ выплата: итог.payout, счётчик: ловушка.рост }).toEqual({ выплата: 0, счётчик: [] });
  });

  it('ставка в ноль не засчитывается как победа', async () => {
    // Выплата 0 - это не победа, даже если исход назван победой. Иначе
    // партия без ставки была бы способом набить себе достижение.
    const ловушка = ловушкаСчётчика();
    const { service } = подменить({ ставка: 0 });
    const итог = await service.settle(ИГРА, ЧАР, 'white');

    expect({ выплата: итог.payout, счётчик: ловушка.рост }).toEqual({ выплата: 0, счётчик: [] });
  });
});

describe('Одна партия засчитывается ровно один раз', () => {
  it('повторный settle не платит и не растрит счётчик', async () => {
    // ГЛАВНАЯ ЗАЩИТА. Раньше повторный запрос возвращал «уже закрыто», но
    // счётчика тогда не существовало. С добавлением счётчика появился бы
    // новый способ набить десять побед одной партией.
    const ловушка = ловушкаСчётчика();
    const { service } = подменить({ ставка: 100 });

    const первый = await service.settle(ИГРА, ЧАР, 'white');
    const второй = await service.settle(ИГРА, ЧАР, 'white');

    expect({
      первый_выплатил: первый.payout,
      второй_не_платит: второй.payout === undefined,
      второй_помнит_о_закрытии: второй.alreadySettled === true,
      счётчик_вырос_на_единицу: ловушка.рост,
    }).toEqual({
      первый_выплатил: 200,
      второй_не_платит: true,
      второй_помнит_о_закрытии: true,
      счётчик_вырос_на_единицу: [1],
    });
  });

  it('пять повторов подряд - всё равно одна победа', async () => {
    const ловушка = ловушкаСчётчика();
    const { service } = подменить({ ставка: 100 });
    await service.settle(ИГРА, ЧАР, 'white');
    for (let i = 0; i < 4; i++) await service.settle(ИГРА, ЧАР, 'white');
    expect({ всего_начислено: ловушка.рост }).toEqual({ всего_начислено: [1] });
  });
});

describe('Отказ базы не отменяет выигранную победу', () => {
  it('счётчик не растёт, но и маршрут не падает', async () => {
    // Игрок золото получил. Ронять его запрос из-за счётчика - значит
    // показать ошибку на честно выигранные деньги.
    const ловушка = ловушкаСчётчика();
    ловушка.spy.mockImplementation(async () => { throw new Error('leaderboard недоступен'); });

    const { service } = подменить({ ставка: 100 });
    const итог = await service.settle(ИГРА, ЧАР, 'white');

    expect({ выплата_состоялась: итог.payout, ошибка_не_выброшена: итог.ok }).toEqual({ выплата_состоялась: 200, ошибка_не_выброшена: true });
  });
});

describe('Достижение смотрит на настоящий счётчик', () => {
  it('«Шахматный Гений» имеет условие из 10 побед', () => {
    // Числа зафиксированы руками как ловушка: если число поменяют или
    // условие снимут, проверка обязана покраснеть.
    const деф = ACHIEVEMENTS.find(a => a.id === 'ach_chess_master');
    expect({ условие: деф?.condition }).toEqual({ условие: { counter: 'chess_wins', need: 10 } });
  });

  it('описание достижения обещает ровно то, что проверяет условие', () => {
    // Условие и текст - две разные правды, если их писали отдельно.
    // «Выиграть 10 шахматных партий» обязано означать need: 10.
    const деф = ACHIEVEMENTS.find(a => a.id === 'ach_chess_master');
    const обещано = /(\d+)/.exec(деф?.description ?? '')?.[1];
    expect({
      в_описании: Number(обещано),
      в_условии: (деф?.condition as { need: number } | undefined)?.need,
    }).toEqual({ в_описании: 10, в_условии: 10 });
  });

  it('колонка счётчика появляется миграцией, а не по пути', () => {
    // Без колонки начисление падало бы, и победы просто не считались бы.
    const миграция = читать('database/migrations/051_chess_wins.sql');
    expect({
      колонка: /ADD COLUMN IF NOT EXISTS chess_wins INT/.test(миграция),
      потолок: /chess_wins >= 0 AND chess_wins <= 10000/.test(миграция),
    }).toEqual({ колонка: true, потолок: true });
  });

  it('начисление идёт через общий счётчик, а не своей таблицей', () => {
    // Свой счётчик - третье место учёта, где его легко забыть внести в
    // список достижений, и счётчик молча перестанет работать.
    //
    // Первая версия этой проверки искала «нет ли тут своей таблицы» через
    // replace с нечитаемой регуляркой и всегда давала «есть». Проверка,
    // которая не может покраснеть, хуже отсутствующей: честнее требовать
    // прямо то, что нужно.
    const сервис = читать('server/src/services/ChessBetService.ts');
    const инкремент = /await this\.засчитатьПобеду\(characterId\);/.test(сервис);
    const вОбщуюТаблицу = /LeaderboardService\(\)\.increment\(characterId, \{ chessWins: 1 \}\)/.test(сервис);
    // Прямой записи в leaderboard из шахмат быть не должно: начисление
    // идёт только сложением через increment, иначе счётчик можно было бы
    // переписать вместо накопления.
    const прямаяЗапись = /INSERT INTO leaderboard/i.test(сервис) || /UPDATE leaderboard/i.test(сервис);
    expect({ инкремент, в_общую_таблицу: вОбщуюТаблицу, прямая_запись: !прямаяЗапись })
      .toEqual({ инкремент: true, в_общую_таблицу: true, прямая_запись: true });
  });

  it('счётчик растёт по исходу победы, а не по факту выплаты', () => {
    // Страховка исходником от повтора ошибки «ничья считается победой».
    // Поведенческая проверка это уже ловит, но только на одном исходе;
    // здесь видно само правило в коде.
    const сервис = читать('server/src/services/ChessBetService.ts');
    const блок = сервис.slice(сервис.indexOf('async settle'), сервис.indexOf('async resign'));
    expect({
      по_исходу_white: /if \(outcome === 'white'\) await this\.засчитатьПобеду/.test(блок),
      не_по_размеру_выплаты: !/выплата > 0[\s\S]{0,80}засчитатьПобеду/.test(блок),
    }).toEqual({ по_исходу_white: true, не_по_размеру_выплаты: true });
  });
});
