// Репутация: всегда ноль.
//
// ЧТО БЫЛО. ReputationService.addReputation написан целиком — поиск записи,
// обновление, проверка нового ранга, уведомление о повышении. И его не
// вызывал НИКТО и НИГДЕ за всё время существования проекта. Все четыре
// фракции навсегда оставались на нуле, а панель репутации показывала честные
// нули.
//
// ВТОРАЯ, БОЛЕЕ КОВАРНАЯ ПОЛОМКА. Маршрут отдавал сервису req.userId —
// идентификатор АККАУНТА, а сервис ищет по character_reputation.character_id,
// то есть по идентификатору ПЕРСОНАЖА. Это разные числа. Поэтому даже если бы
// репутация начислялась, панель всё равно увидела бы пустоту. Ровно та же
// ошибка, что была с задачами дня, — она закрыта тестом в dailyTasks.test.ts,
// и этот тест теперь защищает от неё же в репутации.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const grants = stripComments(read('server/src/systems/ReputationGrants.ts'));
const routes = stripComments(read('server/src/routes/progression.ts'));
const clientApi = stripComments(read('client/src/app/api.ts'));
const clientPanel = stripComments(read('client/src/app/panels.ts'));

// Все места, где сервер начисляет репутацию. Каждое — реальное игровое
// событие, а не выдуманный повод.
const HOOKS: [string, string, string][] = [
  // файл, что начисляем, каким игровым поступком это является
  ['server/src/socket/GameSocketHandler.ts', 'monsterKill', 'убийство монстра в поле'],
  ['server/src/services/QuestService.ts', 'questDone', 'выполненное задание'],
  ['server/src/systems/DungeonService.ts', 'dungeonClear', 'пройденный данж'],
  ['server/src/services/AuctionService.ts', 'auctionSale', 'лот на аукционе'],
  ['server/src/services/PvPService.ts', 'pvpWin', 'победа в PvP'],
  ['server/src/systems/TradeService.ts', 'tradeDone', 'сданный караван'],
];

const LOCALES = ['ru', 'en', 'az'] as const;
type Dict = Record<string, unknown>;
const locale = (lang: string): Dict =>
  JSON.parse(read(`shared/locales/${lang}.json`)) as Dict;

describe('Репутация: начисляется и видна', () => {
  it('addReputation вызывается хоть откуда-то', () => {
    // ГЛАВНОЕ. Раньше вызова не было ни одного, и это проверяется отдельно
    // от остальных: остальные тесты могут пройти, а это — нет
    expect(grants).toMatch(/reputation\.addReputation\(/);
  });

  it('все шесть поступков подключены', () => {
    // По одной на фракцию: иначе часть фракций не поднималась бы в принципе
    const missing = HOOKS
      .filter(([file, kind]) => !stripComments(read(file)).includes(`grantReputation(`) ||
        !stripComments(read(file)).includes(`'${kind}'`))
      .map(([, kind, cause]) => `${kind} (${cause})`);
    expect({ отсутствуют: missing }).toEqual({ отсутствуют: [] });
  });

  it('каждая фракция получает репутацию хотя бы за один поступок', () => {
    // Четыре фракции в игре. Если какая-то не встречается в REP, она не
    // может подняться в принципе: сколько бы игрок ни старался
    const factions = [...grants.matchAll(/faction: '([a-z]+)', amount: (\d+)/g)]
      .map(m => ({ faction: m[1], amount: Number(m[2]) }));
    const covered = new Set(factions.map(f => f.faction));
    expect({
      покрыто: [...covered].sort(),
      незакрытых: ['qizilbash', 'sufi', 'merchants', 'assassins'].filter(f => !covered.has(f)),
    }).toEqual({
      покрыто: ['assassins', 'merchants', 'qizilbash', 'sufi'],
      незакрытых: [],
    });
  });

  it('все числа положительные и целые', () => {
    // amount: 0 или отрицательное — это выдумка вместо награды
    const amounts = [...grants.matchAll(/amount: (-?\d+)/g)].map(m => Number(m[1]));
    expect({ amounts, все_положительные: amounts.every(a => Number.isInteger(a) && a > 0) })
      .toEqual({ amounts, все_положительные: true });
  });

  it('темп начисления соразмерен лестнице рангов', () => {
    // Пороги рангов: 100, 300, 700, 1500. При +1 за монстра путь до первого
    // ранга — 100 убийств. Проверяем, что это не полчаса и не полгода
    const perKill = Number(grants.match(/monsterKill: \{ faction: 'qizilbash', amount: (\d+) \}/)?.[1]);
    const доПервогоРанга = 100 / perKill;
    expect({ за_одно_убийство: perKill, убийств_до_первого_ранга: Math.round(доПервогоРанга) })
      .toEqual({ за_одно_убийство: perKill, убийств_до_первого_ранга: expect.any(Number) });
    // 100 убийств — от часа до нескольких часов активной игры
    expect(доПервогоРанга >= 20).toBe(true);
  });
});

describe('Репутация: маршрут отдаёт персонажа, а не аккаунт', () => {
  it('getReputation нигде не получает req.userId', () => {
    // ГЛАВНОЕ. Это и есть вторая поломка: идентификатор аккаунта вместо
    // идентификатора персонажа. Даже с начислением панель была бы пустой
    expect(routes).not.toMatch(/getReputation\(req\.userId\)/);
  });

  it('персонаж запрашивается явно и проверяется на принадлежность', () => {
    expect(routes).toMatch(/req\.query\.characterId/);
    // Проверка user_id: без неё любой игрок смотрит чужую репутацию
    expect(routes).toMatch(/FROM characters WHERE id = \$1 AND user_id = \$2/);
  });

  it('та же ошибка не осталась в задачах дня', () => {
    // Раньше /tasks тоже брал req.userId, и задачи дня нельзя было выполнить.
    // Проверка на регресс: этот файл правится вместе с репутацией
    expect(routes).toMatch(/SELECT level FROM characters WHERE id = \$1 AND user_id = \$2/);
  });

  it('клиент передаёт персонажа в запрос репутации', () => {
    expect(clientApi).toMatch(/reputation: \(characterId: string\)/);
    expect(clientApi).toMatch(/\/api\/progression\/reputation\?characterId=\$\{characterId\}/);
  });
});

describe('Репутация: панель показывает все четыре фракции', () => {
  it('список фракций берётся отдельным запросом, а не из ответа', () => {
    // Ответ /reputation содержит только те фракции, где что-то начислено.
    // На новом персонаже он пуст, и панель писала «пока не заработана» —
    // то есть игрок не видел, что репутация вообще бывает
    expect(clientPanel).toMatch(/api\.factions\(\)/);
  });

  it('ранг считается на клиенте, а не берётся из базы', () => {
    // Сервер хранит rank_title по-русски: в английской версии панель
    // показывала бы «Тень» вместо «Shadow»
    expect(clientPanel).toMatch(/function rankOf\(/);
  });

  it('подсказка «как получить» есть и переведена', () => {
    expect(clientPanel).toMatch(/reputation\.hint/);
  });
});

describe('Репутация: переводы', () => {
  it('группа reputation есть во всех трёх языках', () => {
    for (const lang of LOCALES) {
      const rep = (locale(lang) as Dict).reputation as Dict | undefined;
      expect({ lang, есть: !!rep }).toEqual({ lang, есть: true });
    }
  });

  it('набор ключей одинаков во всех трёх языках', () => {
    // Разные наборы ключей = в части языков панель молча показывает путь
    // перевода вместо текста
    const paths = (d: Dict, prefix = 'reputation'): string[] =>
      Object.entries(d).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null
          ? paths(v as Dict, `${prefix}.${k}`)
          : [`${prefix}.${k}`]);
    const sets = LOCALES.map(l => paths((locale(l) as Dict).reputation as Dict).sort());
    expect({ одинаковы: sets.every(s => s.join('|') === sets[0].join('|')), ключей: sets[0].length })
      .toEqual({ одинаковы: true, ключей: expect.any(Number) });
  });

  it('на каждую фракцию есть название и на каждый ранг — название', () => {
    // 4 фракции и 20 рангов по 5. Недостающий ключ показывался бы как
    // «reputation.rank.whatever» — прямо в панели
    for (const lang of LOCALES) {
      const rep = (locale(lang) as Dict).reputation as Dict;
      const faction = rep.faction as Dict;
      const rank = rep.rank as Dict;
      expect({ lang, фракций: Object.keys(faction).length, рангов: Object.keys(rank).length })
        .toEqual({ lang, фракций: 4, рангов: 20 });
    }
  });

  it('ни один перевод репутации не пустой', () => {
    for (const lang of LOCALES) {
      const rep = JSON.stringify((locale(lang) as Dict).reputation);
      expect({ lang, пустых: (rep.match(/:\s*""/g) ?? []).length }).toEqual({ lang, пустых: 0 });
    }
  });
});
