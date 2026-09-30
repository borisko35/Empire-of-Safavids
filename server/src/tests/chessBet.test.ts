// Ставка в шахматах наконец двигает золото.
//
// ЧТО БЫЛО. `betGold` попадал в состояние партии, `goldWon` считался в
// makeMove, и на этом всё заканчивалось. Ни одного движения в
// characters.gold не происходило ни разу. Игрок ставил 500, выигрывал,
// видел «Мат! Вы победили!» с числом 1000 - и в кошельке было те же 500,
// с которых он начал. Дорожная карта это отметила словами «ставка не
// списывается».
//
// ПРОВЕРКА ДОЛЖНА БЫТЬ СПОСОБНА ПОКРАСНЕТЬ. Здесь три класса поломки,
// и каждый проверяется своим тестом: списание, выплата и повторная
// выплата. Последний - самый дорогой: если бы он проходил, один
// игрок мог бы нажать «получить награду» сколько угодно раз.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ChessBetService, payoutFor, normalizeBet, MIN_BET, MAX_BET, DEFAULT_BET,
} from '../services/ChessBetService';
import type { ChessGameState } from '../systems/ChessOfTheShah';

jest.mock('../services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => ({ query: jest.fn(), queryOne: jest.fn() }) },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const CHAR = '11111111-1111-4111-8111-111111111111';
const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

const ПУСТАЯ_ПАРТИЯ = {
  gameId: 'chess_x_1', board: [], turn: 'white', status: 'playing', betGold: 100,
} as unknown as ChessGameState;

/**
 * Подмена базы.
 *
 * Золото живёт в characters.gold, и важна сама формула запроса, а не
 * порядок вызовов. Поэтому подмена отвечает по тексту SQL: списание
 * отличить от начисления можно только по знаку в условии.
 */
function подменить(opts: { золото?: number } = {}): {
  service: ChessBetService;
  запросы: string[];
  начислено: number;
} {
  const service = new ChessBetService();
  const запросы: string[] = [];
  let начислено = 0;
  (service as unknown as { db: unknown }).db = {
    query: jest.fn(async (sql: string) => {
      запросы.push(sql);
      return [];
    }),
    queryOne: jest.fn(async (sql: string) => {
      запросы.push(sql);
      // Списание: `gold = gold - $1 ... AND gold >= $1`
      if (/SET gold = gold - /.test(sql)) {
        return (opts.золото ?? 1000) >= 100 ? { gold: (opts.золото ?? 1000) - 100 } : null;
      }
      // Начисление: `gold = gold + $1`
      if (/SET gold = gold \+ /.test(sql)) {
        начислено += Number(/\$1/.test(sql) ? 0 : 0);
        return { gold: (opts.золото ?? 1000) };
      }
      // Занятие строки партии при выплате
      if (/UPDATE chess_games/.test(sql)) {
        return { bet_gold: 100, payout_gold: 100 };
      }
      if (/FROM chess_games/.test(sql)) return null;
      if (/FROM characters/.test(sql)) return { gold: opts.золото ?? 1000 };
      return null;
    }),
  };
  return { service, запросы, начислено };
}

describe('Сколько платят по итогам партии', () => {
  it('победа - две ставки, ничья - одна, поражение - ноль', () => {
    // Ставка снимается при открытии, поэтому «две ставки» - это чистая
    // прибыль в размере ставки, а «одна» - возврат заложенного.
    expect({
      победа: payoutFor(100, 'white'),
      ничья: payoutFor(100, 'draw'),
      поражение: payoutFor(100, 'black'),
    }).toEqual({ победа: 200, ничья: 100, поражение: 0 });
  });

  it('выплата не может стать отрицательной', () => {
    // Отрицательная выплата означала бы, что у игрока по итогам партии
    // ЗАБИРАЮТ золото, а это не выплата.
    expect({
      отрицательная_ставка: payoutFor(-100, 'white'),
      ноль: payoutFor(0, 'white'),
      мусор: payoutFor(Number.NaN, 'white'),
    }).toEqual({ отрицательная_ставка: 0, ноль: 0, мусор: 0 });
  });

  it('дробная ставка округляется вниз, а не платит копейки', () => {
    expect(payoutFor(100.7, 'white')).toEqual(200);
  });

  it('ставка зажимается в допустимые границы', () => {
    // Диапазон был в маршруте, а теперь ещё и в правиле: правило
    // проверяется перебором, а не глазами.
    expect({
      меньше_минимума: normalizeBet(1),
      ровно_минимум: normalizeBet(MIN_BET),
      в_середине: normalizeBet(500),
      ровно_максимум: normalizeBet(MAX_BET),
      больше_максимума: normalizeBet(999999),
      мусор: normalizeBet('не число'),
      отсутствует: normalizeBet(undefined),
    }).toEqual({
      меньше_минимума: MIN_BET, ровно_минимум: MIN_BET, в_середине: 500,
      ровно_максимум: MAX_BET, больше_максимума: MAX_BET,
      мусор: DEFAULT_BET, отсутствует: DEFAULT_BET,
    });
  });
});

describe('Ставка закладывается настоящим списанием', () => {
  it('золото уходит из кошелька, а не только запоминается', async () => {
    const { service, запросы } = подменить({ золото: 1000 });
    const r = await service.open('game-1', CHAR, 100, ПУСТАЯ_ПАРТИЯ);
    expect({
      открылась: r.ok,
      списали: запросы.some(q => /SET gold = gold - /.test(q)),
      записали_партию: запросы.some(q => /INSERT INTO chess_games/.test(q)),
    }).toEqual({ открылась: true, списали: true, записали_партию: true });
  });

  it('списание защищено условием «золота хватает»', () => {
    // Проверяем САМО УСЛОВИЕ, а не всю строку списания. Первая версия
    // требовала текст `SET gold = gold - $1 WHERE ... AND gold >= $1`
    // целиком, и поломка «золото не уходит» ломала ещё и эту проверку:
    // краснела не та. Условие и вычитание - два разных вопроса.
    const сервис = читать('server/src/services/ChessBetService.ts');
    expect({
      есть_проверка: /AND gold >= \$1/.test(сервис),
    }).toEqual({ есть_проверка: true });
  });

  it('без золота партия не открывается', async () => {
    // Раньше ставка вообще ни с чем не сверялась: игрок без золота
    // начинал партию на 5000 и выигрывал «10000», которых у него нет.
    const { service } = подменить({ золото: 5 });
    const r = await service.open('game-2', CHAR, 500, ПУСТАЯ_ПАРТИЯ);
    expect(r).toEqual({ ok: false, reason: 'no_gold' });
  });

  it('если партия не записалась, золото возвращается', async () => {
    // Списание прошло, вставка упала - игрок теряет ставку на каждом
    // сбое записи. Откат обязателен.
    const service = new ChessBetService();
    const запросы: string[] = [];
    (service as unknown as { db: unknown }).db = {
      query: jest.fn(async (sql: string) => {
        запросы.push(sql);
        if (/INSERT INTO chess_games/.test(sql)) throw new Error('сбой записи');
        return [];
      }),
      queryOne: jest.fn(async (sql: string) => {
        запросы.push(sql);
        return /SET gold = gold - /.test(sql) ? { gold: 900 } : null;
      }),
    };
    const r = await service.open('game-3', CHAR, 100, ПУСТАЯ_ПАРТИЯ);
    expect({
      открылась: r.ok,
      золото_вернули: запросы.filter(q => /SET gold = gold \+ \$1/.test(q)).length === 1,
    }).toEqual({ открылась: false, золото_вернули: true });
  });
});

describe('Выплата происходит ровно один раз', () => {
  it('строка партии занимается до начисления', async () => {
    // Порядок, а не просто наличие двух запросов. Если сначала платить,
    // а потом занимать строку, повторный запрос заплатил бы дважды.
    const порядок: string[] = [];
    const service = new ChessBetService();
    (service as unknown as { db: unknown }).db = {
      query: jest.fn(async () => []),
      queryOne: jest.fn(async (sql: string) => {
        if (/SELECT bet_gold FROM chess_games/.test(sql)) { порядок.push('прочитали'); return { bet_gold: 100 }; }
        if (/UPDATE chess_games/.test(sql)) { порядок.push('заняли'); return { game_id: 'game-1' }; }
        if (/SET gold = gold \+ /.test(sql)) { порядок.push('заплатили'); return { gold: 1200 }; }
        return null;
      }),
    };
    const r = await service.settle('game-1', CHAR, 'white');
    expect({ порядок, выплата: r.payout, всего: r.gold }).toEqual({
      порядок: ['прочитали', 'заняли', 'заплатили'], выплата: 200, всего: 1200,
    });
  });

  it('в базу пишется та выплата, что начислена, а не ставка', async () => {
    // ТУТ БЫЛА ОШИБКА, И МОЯ ПРОВЕРКА ЕЁ ПРОПУСТИЛА. В UPDATE стояло
    // payout_gold = GREATEST(bet_gold, 0), то есть в базу всегда ложилось
    // число, равное ставке: победителю начислялось 200, а записано было
    // 100; проигравшему не начислялось ничего, а записано было 100.
    // Учёт и кошелёк расходились, и разбираться потом пришлось бы вслепую.
    const записано: unknown[] = [];
    const service = new ChessBetService();
    (service as unknown as { db: unknown }).db = {
      query: jest.fn(async () => []),
      queryOne: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (/SELECT bet_gold FROM chess_games/.test(sql)) return { bet_gold: 100 };
        if (/UPDATE chess_games/.test(sql)) { записано.push(params[2]); return { game_id: 'game-1' }; }
        if (/SET gold = gold \+ /.test(sql)) return { gold: 1200 };
        return null;
      }),
    };
    await service.settle('g', CHAR, 'white');
    await service.settle('g2', CHAR, 'draw');
    await service.settle('g3', CHAR, 'black');
    // Победа - 200, ничья - 100, поражение - 0. Ровно то, что начислено.
    expect({ записано }).toEqual({ записано: [200, 100, 0] });
  });

  it('повторная выплата по закрытой партии не проходит', async () => {
    // Самый дорогой класс поломки. Строка уже в finished - UPDATE её не
    // находит, начисления нет.
    const service = new ChessBetService();
    let начислений = 0;
    (service as unknown as { db: unknown }).db = {
      query: jest.fn(async () => []),
      queryOne: jest.fn(async (sql: string) => {
        if (/SELECT bet_gold FROM chess_games/.test(sql)) return { bet_gold: 100 };
        // Партия уже закрыта: UPDATE её не находит.
        if (/UPDATE chess_games/.test(sql)) return null;
        if (/SET gold = gold \+ /.test(sql)) { начислений++; return { gold: 1 }; }
        return null;
      }),
    };
    const r = await service.settle('game-1', CHAR, 'white');
    expect({ начислений, уже_закрыта: r.alreadySettled }).toEqual({ начислений: 0, уже_закрыта: true });
  });

  it('поражение не начисляет ничего', async () => {
    // Выплата ноль - это не «начислить ноль», а не начислять вовсе.
    const service = new ChessBetService();
    let начислений = 0;
    (service as unknown as { db: unknown }).db = {
      query: jest.fn(async () => []),
      queryOne: jest.fn(async (sql: string) => {
        if (/SELECT bet_gold FROM chess_games/.test(sql)) return { bet_gold: 100 };
        if (/UPDATE chess_games/.test(sql)) return { game_id: 'game-1' };
        if (/SET gold = gold \+ /.test(sql)) { начислений++; return { gold: 1 }; }
        return null;
      }),
    };
    const r = await service.settle('game-1', CHAR, 'black');
    expect({ выплата: r.payout, начислений }).toEqual({ выплата: 0, начислений: 0 });
  });

  it('партии нет вовсе - выплаты тоже нет', async () => {
    // Нет строки в playing: и читать ставку нечего, и платить нельзя.
    const service = new ChessBetService();
    let начислений = 0;
    (service as unknown as { db: unknown }).db = {
      query: jest.fn(async () => []),
      queryOne: jest.fn(async (sql: string) => {
        if (/FROM chess_games/.test(sql)) return null;
        if (/SET gold = gold \+ /.test(sql)) { начислений++; return { gold: 1 }; }
        return null;
      }),
    };
    const r = await service.settle('нет-такой', CHAR, 'white');
    expect({ начислений, уже_закрыта: r.alreadySettled }).toEqual({ начислений: 0, уже_закрыта: true });
  });

  it('выплата не идёт по чужой партии и не платится дважды', () => {
    // В запросе есть character_id: без него один игрок получил бы
    // выплату по gameId чужой партии, узнав его из списка.
    //
    // И `AND status = 'playing'` - без него повторный запрос на выплату
    // по уже закрытой партии нашёл бы строку и заплатил снова. Эту
    // часть ловим ПО ИСХОДНИКУ, а не подменой базы: подмена не умеет
    // отличить запрос с этим условием от запроса без него - она отвечает
    // по тексту и всегда ответит то, что подскажет тест. Поведенческая
    // проверка выше (`повторная выплата по закрытой партии не проходит`)
    // доказывает, что повторный вызов не платит; здесь - что защита
    // стоит в самом SQL, а не в удачном стечении.
    const сервис = читать('server/src/services/ChessBetService.ts');
    expect({
      проверяет_владельца: /WHERE game_id = \$1 AND character_id = \$2 AND status = 'playing'/.test(сервис),
      читает_только_играющую: /SELECT bet_gold FROM chess_games WHERE game_id = \$1 AND character_id = \$2 AND status = \$3/.test(сервис),
    }).toEqual({ проверяет_владельца: true, читает_только_играющую: true });
  });
});

describe('Партия переживает перезапуск', () => {
  it('состояние партии кладётся в базу целиком', () => {
    // Только доски мало: без чей ход и без истории партия после
    // перезапуска начиналась бы заново посреди игры.
    const сервис = читать('server/src/services/ChessBetService.ts');
    const блок = сервис.slice(сервис.indexOf('function состояниеВJson'), сервис.indexOf('/** Состояние в форму') + 900);
    expect({
      доска: /board: state\.board/.test(блок),
      чей_ход: /turn: state\.turn/.test(блок),
      история: /moveHistory: state\.moveHistory/.test(блок),
      ставка: /betGold: state\.betGold/.test(блок),
    }).toEqual({ доска: true, чей_ход: true, история: true, ставка: true });
  });

  it('движок умеет вернуть партию в память', () => {
    // Без этого Map остаётся пустым после перезапуска, и /state отвечает
    // 404 на живой партии с заложенным.
    const движок = читать('server/src/systems/ChessOfTheShah.ts');
    expect(/restore\(state: ChessGameState/.test(движок)).toEqual(true);
  });

  it('маршрут ищет партию в базе, раз её нет в памяти', () => {
    const маршрут = читать('server/src/routes/minigames.ts');
    // Только внутри маршрута /state/:gameId. Поиск по всему файлу
    // проходил бы, даже если бы восстановление убрали оттуда: тот же
    // вызов findPlaying есть в /current, и проверка его бы засчитала.
    const начало = маршрут.indexOf("router.get('/state/:gameId'");
    expect({ начало_найдено: начало > 0 }).toEqual({ начало_найдено: true });
    const блок = маршрут.slice(начало, маршрут.indexOf('\n// ', начало + 10));
    expect({
      ищет: /bets\.findPlaying/.test(блок),
      восстанавливает: /восстановить\(изБазы\.state\)/.test(блок),
    }).toEqual({ ищет: true, восстанавливает: true });
  });

  it('игрок может вернуться к незакрытой партии при входе', () => {
    expect(/router\.get\('\/current'/.test(читать('server/src/routes/minigames.ts'))).toEqual(true);
  });
});

describe('Сдача не возвращает ставку', () => {
  it('партия помечается отказом и выплаты не будет', async () => {
    // В этом и смысл ставки. Возврат при сдаче превращал бы партию в
    // ничью по кнопке, и риск был бы нулевым.
    const service = new ChessBetService();
    const запросы: string[] = [];
    (service as unknown as { db: unknown }).db = {
      query: jest.fn(async (sql: string) => { запросы.push(sql); return []; }),
      queryOne: jest.fn(async (sql: string) => { запросы.push(sql); return { game_id: 'g' }; }),
    };
    const r = await service.resign('game-1', CHAR);
    expect({
      закрыла: r.ok,
      помечает_отказом: запросы.some(q => /SET status = 'resigned'/.test(q)),
      золото_не_трогаем: !запросы.some(q => /characters SET gold/.test(q)),
    }).toEqual({ закрыла: true, помечает_отказом: true, золото_не_трогаем: true });
  });

  it('повторная сдача говорит, что уже закрыто, а не «закрыто»', async () => {
    // ОШИБКА, НАЙДЕННАЯ НА БОЕВОМ СЕРВЕРЕ. Метод спрашивал «есть ли
    // партия в статусе resigned» и получал «да» даже при повторной сдаче:
    // партия действительно была отказана, но не этим вызовом. Игрок видел
    // «закрыто», как будто его запрос что-то сделал.
    //
    // Денег тут не входит, поэтому ложь стоила не золота. Но в следующей
    // правке, где по нему решают, показывать ли сообщение, стоила бы.
    const service = new ChessBetService();
    let обновлений = 0;
    (service as unknown as { db: unknown }).db = {
      query: jest.fn(async () => []),
      queryOne: jest.fn(async (sql: string) => {
        if (/UPDATE chess_games/.test(sql)) { обновлений++; return null; }  // партия уже отказана
        return null;
      }),
    };
    const r = await service.resign('game-1', CHAR);
    expect({
      закрыла: r.ok,
      уже_была: r.alreadyClosed,
      // Отдельного SELECT «а есть ли она resigned» быть не должно: именно
      // он давал ложное «закрыто».
      без_запроса_о_существовании: обновлений === 1,
    }).toEqual({ закрыла: false, уже_была: true, без_запроса_о_существовании: true });
  });

  it('отказ закрывает партию возвратом строки, а не догадкой', () => {
    // Возврат строки - единственное доказательство, что UPDATE что-то
    // изменил. Без него «закрыто» остаётся догадкой.
    const сервис = читать('server/src/services/ChessBetService.ts');
    const блок = сервис.slice(сервис.indexOf('async resign'), сервис.indexOf('\n  }', сервис.indexOf('async resign')));
    expect({
      возвращает_строку: /RETURNING game_id/.test(блок),
      нет_отдельного_select: !/SELECT game_id FROM chess_games/.test(блок),
    }).toEqual({ возвращает_строку: true, нет_отдельного_select: true });
  });
});

describe('Таблица партий примет не то, что сломает деньги', () => {
  const миграция = читать('database/migrations/048_chess_bet.sql');

  it('ставка обязана быть больше нуля', () => {
    // Проверяем УСЛОВИЕ, а не имя ограничения. Первая версия искала
    // `ADD CONSTRAINT chess_games_bet_positive`, и замена `> 0` на
    // `>= 0` - то есть фактическая отмена запрета - её проходила.
    // Слой «база принимает нулевую ставку» это и поймал.
    expect(/ADD CONSTRAINT chess_games_bet_positive CHECK \(bet_gold > 0\)/.test(миграция))
      .toEqual(true);
  });

  it('выплата неотрицательна', () => {
    expect(/ADD CONSTRAINT chess_games_payout_nonnegative CHECK \(payout_gold >= 0\)/.test(миграция))
      .toEqual(true);
  });

  it('статус ограничен списком', () => {
    // Свободный текст означал бы опечатку, которая навсегда оставила бы
    // партию в непонятном состоянии - и выплатить её было бы уже нечем.
    expect(/ADD CONSTRAINT chess_games_status_known/.test(миграция)
      && /'playing', 'finished', 'resigned'/.test(миграция)).toEqual(true);
  });

  it('выплата идёт только из playing, а это написано в коде', () => {
    // Проверка на стороне схемы недостаточна: строка может быть playing,
    // а выплату всё равно попросить второй раз. Условие в коде - главное.
    const сервис = читать('server/src/services/ChessBetService.ts');
    expect({
      в_коде: /status = 'playing'/.test(сервис),
      в_схеме_дефолт: /status\s+VARCHAR\(20\) NOT NULL DEFAULT 'playing'/.test(миграция),
    }).toEqual({ в_коде: true, в_схеме_дефолт: true });
  });

  it('комментарии только через дефис, а не через две косые', () => {
    const код = миграция.split('\n').filter(l => l.trimStart().startsWith('//'));
    expect({ строк_с_косыми: код.length }).toEqual({ строк_с_косыми: 0 });
  });
});

describe('Маршрут не обещает денег, которых не заплатили', () => {
  const маршрут = читать('server/src/routes/minigames.ts');

  it('одна партия на персонажа, и это обещание проверяемо', () => {
    // Комментарий в findPlaying говорил «игрок не может вести две партии
    // на одни деньги», а маршрут это не проверял. Обещание без проверки -
    // это ложь, просто поменьше, чем ставка, которая не списывалась.
    // Партии у игрока было две, панель рисовала одну, и выигрыш за вторую
    // приходил бы «из ниоткуда».
    const маршрут = читать('server/src/routes/minigames.ts');
    const начало = маршрут.indexOf("router.post('/start'");
    expect({ начало_найдено: начало > 0 }).toEqual({ начало_найдено: true });
    const блок = маршрут.slice(начало, маршрут.indexOf('\n// ', начало + 10));
    expect({
      спрашивает_идущую: /bets\.findPlaying\(персонаж\)/.test(блок),
      не_залогин_снова: /game_in_progress/.test(блок),
      // И новую партию при этом НЕ открывает - иначе отказ был бы пустым.
      не_списывает_повторно: блок.indexOf('game_in_progress') < блок.indexOf('bets.open('),
    }).toEqual({ спрашивает_идущую: true, не_залогин_снова: true, не_списывает_повторно: true });
  });

  it('маршрут берёт персонажа, а не аккаунт', () => {
    // ОШИБКА, НАЙДЕННАЯ НА БОЕВОМ СЕРВЕРЕ. characters.gold и chess_games
    // заводятся на ПЕРСОНАЖА, а сессия хранит id АККАУНТА, и у одного
    // аккаунта несколько персонажей. Маршрут брал id из сессии и считал
    // его за персонажа: списание не находило строку и отвечало
    // «не хватает золота» - то есть врало о причине при полном кошельке.
    //
    // Проверка по исходнику, потому что подменить это поведением нельзя:
    // маршрут проверяет владение запросом в базу, и без настоящей базы
    // он всегда ответил бы «персонажа нет».
    const маршрут = читать('server/src/routes/minigames.ts');
    const хвост = маршрут.slice(маршрут.indexOf('async function свойПерсонаж'));
    expect({
      есть_проверка_владения: /FROM characters WHERE id = \$1 AND user_id = \$2/.test(хвост),
      требует_персонажа: /characterId is required/.test(хвост),
      // Ни одного места, где в деньги идёт прямо из сессии.
      деньги_не_из_сессии: !/bets\.(open|settle|resign|findPlaying)\([^)]*req\.userId/.test(маршрут),
    }).toEqual({ есть_проверка_владения: true, требует_персонажа: true, деньги_не_из_сессии: true });
  });

  it('клиент передаёт персонажа в каждом вызове шахмат', () => {
    // Без characterId сервер отвечает 400 на каждый маршрут, и панель
    // молчала бы: внешний catch превращает ошибку в пустую панель.
    //
    // Проверяем ТЕЛА запросов, а не объявления параметров. Первая версия
    // считала `characterId: string` в сигнатурах - их четыре, и они никуда
    // не делись бы, даже если бы параметр перестал попадать в запрос.
    const api = читать('client/src/app/api.ts');
    const панель = читать('client/src/app/panels.ts');
    // Только шахматный блок. Поиск по всему файлу ловил чужие вызовы с
    // полем gameId - например строки сценки, - и объявлял бы их шахматами.
    const шахматы = api.slice(api.indexOf('chessStart'), api.indexOf('chessResign') + 400);
    const безПерсонажа = (шахматы.match(/JSON\.stringify\(\{(?![^}]*characterId)[^}]*\}\)/g) ?? []);
    expect({
      маршруты_берут_персонажа: (шахматы.match(/characterId: string/g) ?? []).length >= 4,
      // Ни одно тело запроса шахмат не осталось без персонажа
      тела_без_персонажа: безПерсонажа,
      панель_передаёт: /api\.chessStart\(charId, bet\)/.test(панель)
        && /api\.chessMove\(cid\(\)/.test(панель)
        && /api\.chessResign\(cid\(\)/.test(панель),
    }).toEqual({
      маршруты_берут_персонажа: true, тела_без_персонажа: [],
      панель_передаёт: true,
    });
  });

  it('ответ о конце партии несёт настоящую выплату, а не посчитанную вслепую', () => {
    // ТУТ БЫЛА ЛОЖЬ: маршрут звал betGoldFromState(aiState) и отдавал
    // игроку число, не спросив ни базу, ни кошелёк.
    //
    // Проверяем, что в ответ кладётся ИМЕННО то, что вернула выплата, и
    // делаем это в обоих местах, где партия кончается. Поиск вызова
    // bets.settle по всему файлу проходил бы, даже если бы в одну из двух
    // ветвей вернули посчитанное вслепую число.
    const маршрут = читать('server/src/routes/minigames.ts');
    expect({
      спрашивает_базу: /bets\.settle\(/.test(маршрут),
      кладёт_выплату: (маршрут.match(/goldWon: оплата\.payout/g) ?? []).length >= 2,
      // И нигде число не берётся из самой ставки. «Ставка × 2» в ответе -
      // это ровно та ложь, которая была: красивое число без движения
      // золота. Искать `betGold` рядом с `goldWon` нельзя - bets.settle
      // возвращает payout, а betGold проходит в другие поля.
      золото_не_считается_вслепую: !/goldWon: [^о]/.test(маршрут),
      старой_функции_нет: !/betGoldFromState/.test(маршрут),
    }).toEqual({
      спрашивает_базу: true, кладёт_выплату: true,
      золото_не_считается_вслепую: true, старой_функции_нет: true,
    });
  });

  it('ответ показывает, сколько золото у игрока осталось', () => {
    // «Мат! Вы победили! +1000» без числа в кошельке выглядит как
    // обещание. С остатком игрок видит, что выплата пришла.
    expect(/goldLeft: открытие\.goldLeft/.test(маршрут)).toEqual(true);
  });

  it('при отказе от партии в кошельке тоже видно правду', () => {
    expect(/gold: оплата\.gold/.test(маршрут)).toEqual(true);
  });

  it('без золота партия не открывается, а не открывается с минусом', () => {
    expect(/chess\.deleteGame\(game\.gameId\)/.test(маршрут)).toEqual(true);
  });
});
