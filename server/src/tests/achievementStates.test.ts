// Условие по состоянию: «есть друг» и «состоишь в гильдии».
//
// ЧТО БЫЛО. У достижений «Дружелюбный» и «Член Гильдии» было написано
// «добавить первого друга» и «вступить в гильдию», и условия не было
// вовсе - выдать их было нечем, и панель писала «пока не считается».
//
// ЧТО ТЕПЕРЬ. Условие стало двух видов: счётчик, который копится
// событиями, и состояние, которое пересчитывается из своей таблицы. Это
// не одно и то же: счётчик «друзей» в leaderboard пришлось бы уменьшать
// при удалении друга, а удаление происходит одним DELETE, и минус в
// счётчике не записался бы - друг остался бы засчитан навсегда.
//
// ГЛАВНАЯ ОПАСНОСТЬ, КОТОРУЮ ЗДЕСЬ ЛОВЯТ. has_friend берёт только
// status = 'accepted'. Отправленное приглашение, на которое ещё не
// ответили, другом не является, и без этой проверки достижение выдавалось
// бы за нажатую кнопку. И friends привязана к АККАУНТУ (users.id), а не к
// персонажу, поэтому владелец достаётся подзапросом: поиск по
// character_id в этой таблице всегда дал бы пусто.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AchievementService, ACHIEVEMENTS, isEarned, STATE_SOURCE, type AchievementState,
} from '../services/AchievementService';

jest.mock('../services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => ({ query: jest.fn(), queryOne: jest.fn() }) },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const ЧАР = 'dddddddd-1111-4111-8111-111111111111';
const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

/** Подмена базы: состояние задаётся ответами по имени таблицы. */
function подменить(состояния: Partial<Record<AchievementState, number>>) {
  const service = new AchievementService();
  const запросы: string[] = [];
  const db = {
    query: jest.fn(async (sql: string) => { запросы.push(sql); return []; }),
    queryOne: jest.fn(async (sql: string, params: unknown[] = []) => {
      запросы.push(sql);
      if (/FROM friends/.test(sql)) {
        return { n: состояния.has_friend ?? 0 };
      }
      if (/FROM guild_members/.test(sql)) {
        return { n: состояния.in_guild ?? 0 };
      }
      if (/FROM region_visits/.test(sql)) {
        // Оба запроса по регионам идут в одну таблицу, различаются условием.
        // Ответ по региону обязан зависеть от самого региона, иначе подмена
        // не отличала бы «посетил Тебриж» от «посетил Исфахан».
        return /region = 'tabriz'/.test(sql)
          ? { n: состояния.visited_tabriz ?? 0 }
          : { n: состояния.regions_visited ?? 0 };
      }
      if (/FROM leaderboard/.test(sql)) return {};
      if (/FROM character_achievements/.test(sql)) return null;
      // Персонаж должен достаться по тому самому идентификатору, который
      // пришёл снаружи: иначе подмена проверяла бы не то.
      if (/FROM characters/.test(sql)) return { user_id: 'u-1', id: params[0] };
      return null;
    }),
    transaction: jest.fn(),
  };
  (service as unknown as { db: unknown }).db = db;
  return { service, запросы };
}

describe('Состояние читается из своей таблицы', () => {
  it('друг и гильдия приходят разными числами, а не одним нулём', async () => {
    const { service } = подменить({
      has_friend: 3, in_guild: 1, regions_visited: 2, visited_tabriz: 1,
    });
    expect(await service.getStates(ЧАР)).toEqual({
      has_friend: 3, in_guild: 1, regions_visited: 2, visited_tabriz: 1,
    });
  });

  it('нет ни друга, ни гильдии - это ноль, а не ошибка', async () => {
    // У нового персонажа нет ни того, ни другого, и это нормальное
    // положение дел. Отказ базы здесь был бы поводом не выдать
    // достижение, а тишина в базе - поводом не выдать.
    const { service } = подменить({});
    expect(await service.getStates(ЧАР)).toEqual({
      has_friend: 0, in_guild: 0, regions_visited: 0, visited_tabriz: 0,
    });
  });

  it('у каждого состояния есть запрос в закрытом списке', () => {
    // Имя состояния подставляется в SQL. Если бы оно приходило из данных,
    // подстановка чужого имени прошла бы мимо typecheck.
    expect({
      состояний: Object.keys(STATE_SOURCE).length,
      все_с_запросом: Object.values(STATE_SOURCE).every(q => q.trim().length > 0),
      все_с_таблицей: Object.values(STATE_SOURCE).every(q => /FROM/.test(q)),
    }).toEqual({ состояний: 4, все_с_запросом: true, все_с_таблицей: true });

    // Ни одно состояние не читает текущий регион персонажа.
    //
    // characters.region лежит по умолчанию ровно в 'tabriz' у каждого нового
    // персонажа. Состояние, читающее его, было бы правдивым нулём для всех и
    // сразу, и «Посетить Тебриз» выдавалось бы бесплатно.
    // Запрещён не сам факт упоминания characters, а ЧТЕНИЕ ИМЕННО РЕГИОНА.
    //
    // Первая версия запрещала любое 'FROM characters', и ругалась на
    // has_friend: его запрос ходит в characters подзапросом - чтобы найти
    // ВЛАДЕЛЬЦА персонажа по account_id, - и региона там не касается.
    //
    // Ловушка же про другое: characters.region лежит по умолчанию ровно в
    // 'tabriz' у каждого нового персонажа. Состояние, читающее эту колонку,
    // было бы правдивым нулём для всех и сразу.
    const читаетРегион = Object.entries(STATE_SOURCE)
      .filter(([, q]) => /FROM characters/i.test(q) && /\bregion\b/i.test(q))
      .map(([k]) => k);
    expect({ читают_текущий_регион: читаетРегион })
      .toEqual({ читают_текущий_регион: [] });
  });

  it('состояние не путано со счётчиком и не лежит в leaderboard', () => {
    // Главное различие двух видов условия. Если бы состояние читалось из
    // leaderboard, оно стало бы счётчиком, который никто не уменьшает.
    expect({
      в_лидерборде: Object.values(STATE_SOURCE).some(q => /leaderboard/i.test(q)),
      друзья_не_в_лидерборде: !/leaderboard/i.test(STATE_SOURCE.has_friend),
    }).toEqual({ в_лидерборде: false, друзья_не_в_лидерборде: true });
  });
});

describe('Друг считается только настоящим', () => {
  it('приглашение без ответа другом не считается', () => {
    // В таблице friends есть status: pending, accepted, blocked. Без
    // фильтра по accepted достижение выдавалось бы за нажатую кнопку.
    expect({ фильтр_есть: /status\s*=\s*'accepted'/.test(STATE_SOURCE.has_friend) })
      .toEqual({ фильтр_есть: true });
  });

  it('заблокированный тоже не друг', () => {
    // blocked не должен попадать под ту же галочку, что и accepted.
    const только_accepted = /status\s*=\s*'accepted'/.test(STATE_SOURCE.has_friend);
    const без_отрицания = !/NOT\s+IN|!=\s*'accepted'|<>\s*'accepted'/.test(STATE_SOURCE.has_friend);
    expect({ только_accepted, без_отрицания }).toEqual({ только_accepted: true, без_отрицания: true });
  });

  it('друзья ищутся по аккаунту, а не по персонажу', () => {
    // friends привязана к users.id. Поиск по character_id дал бы всегда
    // пусто, и достижение не выдавалось бы никогда - то есть снова
    // «пока не считается», только с другой формулировкой.
    expect({
      есть_подзапрос: /user_id = \(SELECT user_id FROM characters WHERE id = \$1\)/.test(STATE_SOURCE.has_friend),
      нет_прямого_character_id: !/WHERE character_id/.test(STATE_SOURCE.has_friend),
    }).toEqual({ есть_подзапрос: true, нет_прямого_character_id: true });
  });
});

describe('Достижения по состоянию выдаются по делу', () => {
  it('«Дружелюбный» выдаётся ровно с первого принятого друга', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_first_friend')!;
    expect({
      условие: def.condition,
      без_друга: isEarned(def, { has_friend: 0 }),
      с_одним: isEarned(def, { has_friend: 1 }),
      с_пятью: isEarned(def, { has_friend: 5 }),
    }).toEqual({ условие: { state: 'has_friend', need: 1 }, без_друга: false, с_одним: true, с_пятью: true });
  });

  it('«Член Гильдии» выдаётся ровно со вступления', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_guild_member')!;
    expect({
      условие: def.condition,
      вне_гильдии: isEarned(def, { in_guild: 0 }),
      в_гильдии: isEarned(def, { in_guild: 1 }),
    }).toEqual({ условие: { state: 'in_guild', need: 1 }, вне_гильдии: false, в_гильдии: true });
  });

  it('счётчик не может выдать достижение по состоянию', () => {
    // Разные пространства значений: 999 убитых монстров не делают
    // игрока другом или членом гильдии.
    const друг = ACHIEVEMENTS.find(a => a.id === 'ach_first_friend')!;
    expect({
      от_убийств: isEarned(друг, { monsters_killed: 99999 }),
      от_побед_в_шахматах: isEarned(друг, { chess_wins: 99999 }),
    }).toEqual({ от_убийств: false, от_побед_в_шахматах: false });
  });

  it('состояние не может выдать достижение по счётчику', () => {
    const убийства = ACHIEVEMENTS.find(a => a.id === 'ach_monster_hunter_10')!;
    expect({
      от_друзей: isEarned(убийства, { has_friend: 999 }),
      от_гильдии: isEarned(убийства, { in_guild: 999 }),
    }).toEqual({ от_друзей: false, от_гильдии: false });
  });
});

describe('Выдача сверяется с состоянием, а не с просьбой', () => {
  it('пока состояния нет - достижение не выдаётся, запись не делается', async () => {
    const { service, запросы } = подменить({ has_friend: 0, in_guild: 0 });
    const выдано = await service.checkAndUnlock(ЧАР, 'ach_first_friend');
    expect({
      выдано,
      вставок_не_было: !запросы.some(q => /INSERT INTO character_achievements/.test(q)),
    }).toEqual({ выдано: false, вставок_не_было: true });
  });

  it('состояние появилось - достижение выдаётся', async () => {
    const { service, запросы } = подменить({ has_friend: 1, in_guild: 0 });
    const выдано = await service.checkAndUnlock(ЧАР, 'ach_first_friend');
    expect({
      выдано,
      вставка_есть: запросы.some(q => /INSERT INTO character_achievements/.test(q)),
      состояние_читалось: запросы.some(q => /FROM friends/.test(q)),
    }).toEqual({ выдано: true, вставка_есть: true, состояние_читалось: true });
  });

  it('панель показывает прогресс по состоянию, а не ноль', async () => {
    // current = null означал бы «пока не считается», а достижение уже
    // считается. Панель обязана видеть число.
    const { service } = подменить({ in_guild: 1 });
    const прогресс = await service.getProgress(ЧАР, 'ach_guild_member');
    expect({ current: прогресс.current, need: прогресс.need, counted: прогресс.counted })
      .toEqual({ current: 1, need: 1, counted: true });
  });

  it('маршрут панели берёт состояния, а не только счётчики', () => {
    // Проверка по исходнику: маршрут обязан звать getMeasures. Если бы он
    // остался на getCounters, состояния в панели были бы всегда нулевыми, и
    // панель врала бы молча - проверка поведения это не поймала бы,
    // потому что подмена отдаёт оба числа.
    const маршрут = читать('server/src/routes/progression.ts');
    expect({
      берёт_меры: /getMeasures\(characterId\)/.test(маршрут),
      не_берёт_только_счётчики: !/getCounters\(characterId\)/.test(маршрут),
    }).toEqual({ берёт_меры: true, не_берёт_только_счётчики: true });
  });
});
