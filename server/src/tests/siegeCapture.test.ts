// Захват территории осадой и навык «Мастера осады».
//
// ЧТО БЫЛО. Территории и таблица guild_territories были объявлены, но осад
// не существовало. Первая версия SiegeSystem ввела урон, и на этом осада
// выглядела законченной: прочность падала до нуля, а владелец не менялся
// никогда, и исход всегда был 'defended'. То есть осада шла, а взять было
// нечего - ровно та же болезнь, что с боссами данжей и бонусами праздников:
// объявлено в данных, работает в коде, но результата нет.
//
// ЗДЕСЬ ИСПОЛНЯЕТСЯ НАСТОЯЩИЙ КОД SiegeSystem. Ответы базы подставлены по
// ТЕКСТУ запроса, а не по порядку вызовов: метод ходит в базу несколько раз,
// и привязка к порядку сделала бы проверку хрупкой.
import { SiegeSystem, уронЗаУбийство, ЦЕЛЬ_УБИЙСТВ } from '../systems/SiegeSystem';
import { GUILD_SKILLS } from '../data/guilds';

const queryOne = jest.fn();
const query = jest.fn();

jest.mock('../services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => ({ query, queryOne, transaction: jest.fn() }) },
}));
jest.mock('../services/RedisService', () => ({
  RedisService: { getInstance: () => ({ publish: jest.fn(), subscribe: jest.fn() }) },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { NotificationService } from '../services/NotificationService';

const ГИЛЬДИЯ = 'aaaaaaaa-1111-4111-8111-111111111111';
const ЧУЖАЯ = 'bbbbbbbb-2222-4222-8222-222222222222';
const ГЕРОЙ = 'cccccccc-3333-4333-8333-333333333333';
const РЕГИОН = 'tabriz';
const ТЕРРИТОРИЯ = 'territory_tabriz_market';

/**
 * Проверка с сужением типа.
 *
 * Именно asserts, а не void: без него TypeScript не знает, что после
 * must(базар !== undefined) переменная точно не undefined, и проверка падала
 * бы компиляцией (TS18048) вместо того, чтобы ронять тест по имени.
 */
function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

/**
 * Подмена ответов базы по тексту запроса.
 *
 * Значение — функция от текста: defense_hp должен уменьшаться от удара к
 * удару, иначе нельзя довести прочность до нуля и увидеть захват.
 *
 * Массив отвечает на query (список строк), одиночное значение - на queryOne.
 * Раньше подмена отвечала только на queryOne, и состояние территорий, которое
 * читает список, получало пустоту - тест падал на «владелец не прочитан из
 * базы» при вроде бы верной подмене.
 *
 * Моки чистятся ЗДЕСЬ, а не в beforeEach: внутри одного теста подмена
 * зовётся несколько раз (например, для каждого уровня навыка), и без
 * очистки поиск по накопленным вызовам находил ответ ПРЕДЫДУЩЕГО уровня.
 */
function подставить(ответы: Record<string, unknown>): void {
  queryOne.mockReset();
  query.mockReset();
  const найти = (sql: string): unknown => {
    for (const [кусок, ответ] of Object.entries(ответы)) {
      if (sql.includes(кусок)) {
        return typeof ответ === 'function' ? (ответ as () => unknown)() : ответ;
      }
    }
    return null;
  };
  queryOne.mockImplementation(async (sql: string) => {
    const значение = найти(sql);
    return Array.isArray(значение) ? (значение[0] ?? null) : значение;
  });
  query.mockImplementation(async (sql: string) => {
    const значение = найти(sql);
    return Array.isArray(значение) ? значение : [];
  });
}

/** Система с чистой памятью: иначе идущие осады протекли бы между тестами. */
function система(): SiegeSystem {
  const s = SiegeSystem.getInstance();
  (s as unknown as { идущие: Set<string> }).идущие.clear();
  (s as unknown as { напомненные: Set<string> }).напомненные.clear();
  return s;
}

/** Осада идёт. Ставится напрямую в память - так же, как это делает tick. */
function осадаИдёт(s: SiegeSystem): void {
  (s as unknown as { идущие: Set<string> }).идущие.add(ТЕРРИТОРИЯ);
}

describe('Осада: захват территории', () => {
  let объявили: jest.SpyInstance;

  beforeEach(() => {
    queryOne.mockReset();
    query.mockReset();
    объявили = jest.spyOn(NotificationService.prototype, 'sendToRegion').mockResolvedValue(undefined);
  });

  afterEach(() => объявили.mockRestore());

  it('крепость падает, прочность обнуляется, владелец меняется', async () => {
    let прочность = 5000; // defensePoints базара по данным
    подставить({
      'SELECT guild_id FROM characters': { guild_id: ГИЛЬДИЯ },
      'FROM guild_sieges': { id: 'siege-1' },
      'FROM guild_skills': { level: 0 },
      'FROM guild_territories': () => ({ defense_hp: прочность, guild_id: ЧУЖАЯ }),
    });

    const s = система();
    осадаИдёт(s);

    // Ровно ЦЕЛЬ_УБИЙСТВ ударов по крепости в 5000 прочности. Прочность
    // уменьшается после КАЖДОГО удара, включая последний: иначе на
    // пятидесятом ударе подмена отдала бы 100 вместо нуля и захват не
    // наступил бы.
    for (let i = 0; i < ЦЕЛЬ_УБИЙСТВ; i++) {
      await s.нанестиУрон(ГЕРОЙ, РЕГИОН);
      прочность = Math.max(0, прочность - уронЗаУбийство(5000));
    }

    must(прочность === 0, `после ${ЦЕЛЬ_УБИЙСТВ} ударов прочность ${прочность}, а ждали 0`);

    // Смена владельца - единственное, что делает захват захватом.
    const смена = query.mock.calls.filter((c) => String(c[0]).includes('SET guild_id ='));
    must(смена.length === 1, `владелец менялся ${смена.length} раз, ждали ровно один захват`);
    must(String(смена[0][0]).includes('WHERE territory_id = $1'), 'смена владельца идёт не по территории');
    must(смена[0][1][1] === ГИЛЬДИЯ, `новый владелец = ${String(смена[0][1][1])}, а ждали гильдию ${ГИЛЬДИЯ}`);

    // Захват обязан быть объявлен: иначе игроки узнают о нём из тишины.
    const объявления = объявили.mock.calls.map((c) => c[3] as Record<string, unknown>);
    must(объявления.some((d) => d.phase === 'captured'), 'захват не объявлен');
    must(объявления.some((d) => d.capturedBy === ГИЛЬДИЯ), 'в объявлении нет захватчика');
  });

  it('своя гильдия не «забирает» свою же территорию', async () => {
    // Ловушка, которую стоило назвать. Владелец пробивает свою же крепость
    // до нуля и получает за это «захват» - то есть ровно то состояние,
    // которого до осады и так не менялось, плюс запись в логе о захвате,
    // которого не было.
    подставить({
      'SELECT guild_id FROM characters': { guild_id: ГИЛЬДИЯ },
      'FROM guild_sieges': { id: 'siege-1' },
      'FROM guild_skills': { level: 0 },
      'FROM guild_territories': () => ({ defense_hp: 50, guild_id: ГИЛЬДИЯ }),
    });
    const s = система();
    осадаИдёт(s);
    await s.нанестиУрон(ГЕРОЙ, РЕГИОН);

    const смена = query.mock.calls.filter((c) => String(c[0]).includes('SET guild_id ='));
    must(смена.length === 0, 'своя гильдия объявила захват своей же территории');
    must(!объявили.mock.calls.some((c) => (c[3] as Record<string, unknown>).phase === 'captured'),
      'о захвате своей территории объявлено');
  });

  it('без гильдии урон не идёт вовсе', async () => {
    // Территория - владение гильдии. Иначе одиночка пробивал бы крепость в
    // ноль, и осада закрывалась бы как «взятая», а брать было бы некому.
    подставить({
      'SELECT guild_id FROM characters': { guild_id: null },
      'FROM guild_territories': () => ({ defense_hp: 5000, guild_id: null }),
    });
    const s = система();
    осадаИдёт(s);
    await s.нанестиУрон(ГЕРОЙ, РЕГИОН);

    must(query.mock.calls.length === 0, `без гильдии система сходила в базу ${query.mock.calls.length} раз`);
    const смена = query.mock.calls.filter((c) => String(c[0]).includes('SET guild_id ='));
    must(смена.length === 0, 'без гильдии территория захвачена');
  });

  it('без идущей осады урон не тратит ни одного запроса', async () => {
    // Обработчик боя - горячая точка. Если бы каждое добивание монстра в игре
    // ходило в базу, бой встал бы на паузу.
    подставить({ 'SELECT guild_id FROM characters': { guild_id: ГИЛЬДИЯ } });
    const s = система();
    await s.нанестиУрон(ГЕРОЙ, РЕГИОН);
    must(queryOne.mock.calls.length === 0, `без осады пошло ${queryOne.mock.calls.length} запросов в базу`);
  });

  it('навык «Мастера осады» увеличивает урон и упирается в потолок', async () => {
    const базовый = уронЗаУбийство(5000);
    const потолок = GUILD_SKILLS.find((s) => s.id === 'guild_siege_power')?.maxLevel ?? 0;
    must(потолок === 5, `потолок навыка в данных = ${потолок}, а код ждёт 5`);

    const уронНа = async (level: number): Promise<number> => {
      подставить({
        'SELECT guild_id FROM characters': { guild_id: ГИЛЬДИЯ },
        'FROM guild_sieges': { id: 'siege-1' },
        'FROM guild_skills': { level },
        'FROM guild_territories': () => ({ defense_hp: 5000, guild_id: ЧУЖАЯ }),
      });
      const s = система();
      осадаИдёт(s);
      await s.нанестиУрон(ГЕРОЙ, РЕГИОН);
      const обновление = query.mock.calls.find(
        (c: unknown[]) => String(c[0]).includes('SET damage = damage +'));
      must(обновление !== undefined, 'урон не записан в историю осады');
      const вызов = обновление as unknown[] as [string, unknown[]];
      return Number(вызов[1][1]);
    };

    must(await уронНа(0) === базовый, 'без навыка урон отличается от базового');
    must(await уронНа(1) === Math.floor(базовый * 1.1), `один уровень навыка дал не +10% (${базовый})`);
    must(await уронНа(3) === Math.floor(базовый * 1.3), `три уровня дали не +30% (${базовый})`);
    // Выше потолка - не растёт: иначе правка maxLevel в данных не имела бы
    // смысла, а навык печатал бы бесконечный урон.
    must(await уронНа(потолок) === Math.floor(базовый * 1.5), 'потолок навыка не применяется');
    must(await уронНа(99) === Math.floor(базовый * 1.5), 'навык растёт выше потолка из данных');
  });

  it('состояние территорий видно и оно сходится с данными', async () => {
    // Без этого осада невидима: игрок получает уведомление и наносит урон,
    // не видя ни прочности, ни владельца, а capturePoints остаётся полем,
    // которое не читает никто.
    подставить({
      'FROM guild_territories': [
        { territory_id: ТЕРРИТОРИЯ, guild_id: ЧУЖАЯ, defense_hp: 2500, captured_at: null },
      ],
    });
    const s = система();
    const список = await s.territoryState();

    must(список.length === 4, `в ответе ${список.length} территорий, а в данных 4`);
    const базар = список.find((t) => t.id === ТЕРРИТОРИЯ);
    must(базар !== undefined, 'базар не попал в ответ');
    must(базар.ownerGuildId === ЧУЖАЯ, 'владелец не прочитан из базы');
    must(базар.defenseHp === 2500, `прочность = ${базар.defenseHp}, а в базе 2500`);
    must(базар.defenseMax === 5000, `потолок прочности = ${базар.defenseMax}, а в данных 5000`);
    must(базар.siegeActive === false, 'осада отмечена идущей без идущей осады');
    must(базар.capturePoints > 0, 'capturePoints не отдан, а это единственное поле, ради которого спрашивают');
    must(Array.isArray(базар.bonuses) && базар.bonuses.length > 0, 'бонусы территории не отданы');

    // И идущая осада обязана отражаться в состоянии.
    осадаИдёт(s);
    const воВремяОсады = (await s.territoryState()).find((t) => t.id === ТЕРРИТОРИЯ);
    must(воВремяОсады?.siegeActive === true, 'идущая осада не видна в состоянии');
  });

  it('маршрут территорий существует и не требует гильдии', async () => {
    // Маршрут без проверки гильдии - сознательно: состояние территории общее.
    // Но authMiddleware обязан быть, иначе его читает кто угодно.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const код = readFileSync(
      join(__dirname, '..', 'routes', 'guilds.ts'), 'utf-8') as string;
    const блок = код.slice(код.indexOf("router.get('/territories'"));
    must(/authMiddleware/.test(блок.slice(0, 400)), 'маршрут территорий без authMiddleware');
    must(!/ownCharacterId/.test(блок.slice(0, 400)), 'маршрут территорий требует гильдию - состояние общее');
  });
});
