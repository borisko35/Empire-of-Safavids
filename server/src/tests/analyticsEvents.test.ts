// Аналитика игроков: события, которых не было, и почему DAU был неправдой.
//
// ЧТО БЫЛО. В analytics_events писалось только player_login, и оно
// срабатывает исключительно на входе через форму. Сессия в Redis живёт 30
// дней, поэтому игрок, зашедший в игру на следующий день, не оставлял в
// аналитике НИЧЕГО. Отсюда две беды:
//   * DAU/MAU считали не игроков, а открытия экрана входа;
//   * удержание D1/D7/D30 по этим данным давало бы ноль у всех, кто не
//     перезаходил через форму. А перезаходят единицы.
//
// События character_created и level_up были объявлены в AnalyticsEvent, но
// не писались никем: воронку «зашёл → завёл персонажа → вырос» посчитать
// было нечем.
//
// ЧТО СТАЛО. Три события пишутся в тех местах, где они и возникают:
//   session_start    — GameSocketHandler.handleAuth, после AUTH_SUCCESS
//   character_created — CharacterService.createCharacter
//   level_up         — LevelingSystem.addExperience, только при реальном росте
//
// Плюс getDailyActivePlayers(): честные активные игроки за день.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

// ── Мок БД: проверяем настоящие функции, а не наличие строк ──────────
const db = {
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue({ count: '7' }),
};
jest.mock('../services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => db },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { AnalyticsService } from '../services/AnalyticsService';

const socketHandler = stripComments(read('server/src/socket/GameSocketHandler.ts'));
const characterService = stripComments(read('server/src/services/CharacterService.ts'));
const leveling = stripComments(read('server/src/systems/LevelingSystem.ts'));
const analyticsSource = read('server/src/services/AnalyticsService.ts');

describe('Активные игроки считаются по входу в мир, а не по форме входа', () => {
  const svc = new AnalyticsService();

  beforeEach(() => db.queryOne.mockClear());

  it('getDailyActivePlayers спрашивает session_start', async () => {
    // САМОЕ ГЛАВНОЕ. Именно этот запрос отвечает на вопрос «сколько нас
    // было в игре» — и только он годится для удержания.
    const n = await svc.getDailyActivePlayers(new Date('2026-09-29T00:00:00Z'));
    expect(n).toBe(7);
    const sql = db.queryOne.mock.calls[0][0] as string;
    expect(sql).toContain("event='session_start'");
  });

  it('старая функция осталась про входы — и не притворяется DAU', async () => {
    // Две метрики с разным смыслом не должны молча слиться. Если когда-нибудь
    // getDailyActiveUsers перепишут на session_start, то проверка на
    // player_login упадёт и заставит подумать, что происходит.
    await svc.getDailyActiveUsers(new Date('2026-09-29T00:00:00Z'));
    const sql = db.queryOne.mock.calls[0][0] as string;
    expect({ событие: sql.match(/event='([a-z_]+)'/)?.[1] }).toEqual({ событие: 'player_login' });
  });

  it('обе метрики считают разных людей за день, а не события', () => {
    // COUNT(DISTINCT user_id) обязателен: иначе один игрок, зашедший пять
    // раз за вечер, будет посчитан пятью и DAU вздуется в разы
    for (const method of ['getDailyActivePlayers', 'getDailyActiveUsers', 'getMonthlyActiveUsers']) {
      const body = new RegExp(`${method}[\\s\\S]{0,400}`).exec(analyticsSource)?.[0] ?? '';
      expect({ method, distinct: /COUNT\(DISTINCT user_id\)/.test(body) })
        .toEqual({ method, distinct: true });
    }
  });

  it('событие session_start объявлено в списке событий', () => {
    // Объявленное, но не написанное событие — это то, из-за чего всё
    // предыдущее и выглядело работающим
    expect(analyticsSource).toMatch(/'session_start'/);
  });
});

describe('Событие входа пишется в момент, когда игрок действительно вошёл', () => {
  it('handleAuth отмечает session_start', () => {
    expect(socketHandler).toMatch(/analytics\.track\(\s*'session_start'/);
  });

  it('отметка идёт ПОСЛЕ AUTH_SUCCESS, а не до', () => {
    // Порядок здесь и есть смысл. AUTH_SUCCESS — это момент, когда клиент
    // признан игроком; до него вход не состоялся. Отметка выше считала бы
    // сессии, которых не было.
    const success = socketHandler.indexOf('AUTH_SUCCESS');
    const track = socketHandler.indexOf("'session_start'");
    expect({ нашли_оба: success >= 0 && track >= 0, трек_после_успеха: track > success })
      .toEqual({ нашли_оба: true, трек_после_успеха: true });
  });

  it('в session_start попадают уровень, регион и сервер', () => {
    // Без этого в воронке нельзя отделить «зашёл и сразу ушёл» от «зашёл и
    // застрял на первом экране»: в первом случае у игрока есть персонаж.
    const block = /analytics\.track\(\s*'session_start'[\s\S]{0,400}?\);/.exec(socketHandler)?.[0] ?? '';
    expect({ уровень: /level/.test(block), регион: /region/.test(block), сервер: /serverId/.test(block) })
      .toEqual({ уровень: true, регион: true, сервер: true });
  });
});

describe('Воронка: создание персонажа и рост в уровне пишутся', () => {
  it('createCharacter отмечает character_created', () => {
    // Без этого шага неизвестно, сколько людей дошло до игры, а сколько
    // осталось на экране входа.
    const block = /async createCharacter[\s\S]*?return character;/.exec(characterService)?.[0] ?? '';
    expect({ нашли: block.length > 0, трек: /analytics\.track\(\s*'character_created'/.test(block) })
      .toEqual({ нашли: true, трек: true });
  });

  it('в character_created видно класс и сервер', () => {
    // Иначе нельзя понять, какой класс удерживает, а какой отсеивается
    const block = /analytics\.track\(\s*'character_created'[\s\S]{0,300}?\);/.exec(characterService)?.[0] ?? '';
    expect({ класс: /class/.test(block), сервер: /serverId/.test(block) })
      .toEqual({ класс: true, сервер: true });
  });

  it('LevelingSystem отмечает level_up', () => {
    expect(leveling).toMatch(/analytics\.track\(\s*'level_up'/);
  });

  it('в level_up видно, с какого уровня на какой и откуда опыт', () => {
    // source — это ответ на вопрос «кто кормит опытом»: квесты, убийства
    // или события. Без него нельзя понять, на чём держится прогресс новичка.
    const block = /analytics\.track\(\s*'level_up'[\s\S]{0,400}?\);/.exec(leveling)?.[0] ?? '';
    expect({
      from: /from/.test(block), to: /to/.test(block), source: /source/.test(block),
    }).toEqual({ from: true, to: true, source: true });
  });

  it('level_up пишется только при росте, а не на каждый вызов addExperience', () => {
    // addExperience вызывается на каждой награде. Если бы событие слалось
    // всегда, воронка «дошёл до уровня N» считала бы мусор: один и тот же
    // игрок дал бы тысячу «level_up» на первом уровне.
    const method = /async addExperience[\s\S]*$/m.exec(leveling)?.[0] ?? '';
    const leveledBranch = /if \(leveledUp\) \{[\s\S]*?\n {4}\}/.exec(method)?.[0] ?? '';
    expect({
      трек_внутри_ветки_роста: /analytics\.track\(\s*'level_up'/.test(leveledBranch),
      трек_есть_в_методе: /analytics\.track\(\s*'level_up'/.test(method),
    }).toEqual({ трек_внутри_ветки_роста: true, трек_есть_в_методе: true });
  });
});

describe('Причина правки объяснена в коде', () => {
  it('рядом с player_login сказано, почему он не DAU', () => {
    // Через полгода «player_login = DAU» будет выглядеть очевидным и
    // верным. Метрика без её границ врёт тихо.
    const before = analyticsSource.slice(0, analyticsSource.indexOf('async getDailyActiveUsers'));
    expect({ упоминание_сессии: /30 дней/.test(before) }).toEqual({ упоминание_сессии: true });
  });
});
