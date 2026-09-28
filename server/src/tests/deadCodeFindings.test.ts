// Две находки из охоты на мёртвый код: сервер писал в игрока, а игрок
// об этом не знал.
//
// 1. combat:defense. Сервер подтверждает успешный блок и уклонение этим
//    событием, но клиент его НЕ слушал. Игрок нажимал блок, сервер принимал
//    и применял множитель защиты — а на экране не появлялось ничего. Не
//   понятно, сработало или нет, при том что механика работала, просто
//    молча. Соседние ветки боя (combat:result, combat:hit) обрабатывались.
//
// 2. Таблица рейтинга. LeaderboardService.updateStats не вызывался ниоткуда
//    — единственный INSERT INTO leaderboard во всём сервере не выполнялся.
//    Таблица создана, индексы есть, маршрут /api/leaderboard/:type отвечает,
//    на главной странице сайта висел «Топ-10 игроков»… который всегда
//    показывал «пока нет данных». Игрок заходил и качался, а попадать в
//    рейтинг было некуда.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const client = stripComments(read('client/src/app/world.ts'));
const socket = stripComments(read('server/src/socket/GameSocketHandler.ts'));
const service = stripComments(read('server/src/services/LeaderboardService.ts'));
const siteJs = read('client/web/js/main.js');

describe('Блок и уклонение: игрок видит, что сработало', () => {
  it('клиент слушает combat:defense', () => {
    expect(client).toMatch(/socket\.on\('combat:defense'/);
  });

  it('имя события совпадает с тем, что шлёт сервер', () => {
    // Событие живёт в shared/constants: если там переименуют, а здесь
    // оставят, отклик снова пропадёт молча
    const constants = stripComments(read('shared/constants.ts'));
    const name = constants.match(/COMBAT_BLOCKED:\s*'([^']+)'/);
    expect(name).not.toBeNull();
    expect(client).toMatch(new RegExp(`socket\\.on\\('${name![1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  });

  it('показывает оба действия, а не только одно', () => {
    expect(client).toMatch(/actionType === 'dodge'/);
    expect(client).toMatch(/t\('world\.dodge'\)/);
    expect(client).toMatch(/t\('world\.block'\)/);
  });

  it('ключи перевода для обеих надписей есть во всех языках', () => {
    // Ключ world.block был в словарях, но нигде не использовался — теперь
    // используется. Проверяем, что он есть в каждом языке, иначе надпись
    // покажет сам путь к ключу
    for (const lang of ['ru', 'en', 'az']) {
      const json = JSON.parse(read(`shared/locales/${lang}.json`)) as Record<string, Record<string, string>>;
      const { block, dodge } = json.world;
      expect({ lang, block: !!block, dodge: !!dodge }).toEqual({ lang, block: true, dodge: true });
    }
  });

  it('чужое подтверждение не показывается', () => {
    // Событие приходит защищавшемуся. Над чужим персонажем «Блок» — враньё
    expect(client).toMatch(/d\.characterId !== me\.id\) return/);
  });

  it('без мира подтверждение не роняет игру', () => {
    expect(client).toMatch(/if \(!world\) return/);
  });
});

describe('Рейтинг игроков наполняется', () => {
  it('updateStats вызывается хоть где-то', () => {
    // Главная находка: вызова не было ни одного
    const callers = [...socket.matchAll(/leaderboardService\.updateStats\(/g)].length;
    expect(callers).toBeGreaterThan(0);
  });

  it('вызов стоит в тике, а не разово', () => {
    // Разовый вызов на входе означал бы, что поднявшийся уровень в рейтинг
    // не попадёт. Тик идёт раз в 5 секунд по каждому онлайн-игроку
    expect(socket).toMatch(/async regenTick/);
    const tick = socket.slice(socket.indexOf('async regenTick'));
    expect(tick.slice(0, 1500)).toMatch(/leaderboardService\.updateStats/);
  });

  it('передаются только поля, которые есть в схеме leaderboard', () => {
    // Убийства и квесты сюда передавать НЕЛЬЗЯ: updateStats пишет
    // АБСОЛЮТНЫЕ значения (col = $n) и вызывается раз в 5 секунд,
    // поэтому счётчик затирался бы нулём каждые пять секунд. Для них
    // есть отдельный накопительный increment — см. проверки ниже.
    // Прежний запрет был прав по сути, но указывал на разделение методов,
    // а не на отказ от самих счётчиков: из-за него вкладки «Убийства» и
    // «Квесты» оставались нулевыми навсегда.
    // PvP считаются в других местах. Если подставить
    // их нулями, настоящие значения затирались бы
    const call = socket.match(/updateStats\([\s\S]*?\n\s*\}\)/);
    expect(call).not.toBeNull();
    expect(call![0]).not.toMatch(/monstersKilled/);
    expect(call![0]).not.toMatch(/questsCompleted/);
    expect(call![0]).toMatch(/level/);
    expect(call![0]).toMatch(/experience/);
  });

  it('счётчики рейтинга накапливаются, а не перезаписываются', () => {
    // ГЛАВНОЕ. updateStats присваивает (col = $n) и зовётся раз в 5 секунд,
    // поэтому счётчики в него пускать нельзя: через пять секунд после убийства
    // тик затирал бы счётчик нулём. Для них отдельный increment, который
    // делает col = col + n. Проверяем именно сложение — это и есть причина,
    // по которой метод нельзя слить с updateStats.
    expect(service).toMatch(/async increment\(/);
    expect(service).toMatch(/fields\.push\(`\$\{col\} = leaderboard\.\$\{col\} \+ \$\{ph\}`\)/);
  });

  it('убийства попадают в рейтинг в момент убийства', () => {
    // Вкладка «Убийства» показывала 0 у всех: колонка monsters_killed была
    // в схеме с самого начала, и её не писал никто
    expect(socket).toMatch(/increment\(attacker\.id, \{ monstersKilled: 1 \}\)/);
  });

  it('квесты попадают в рейтинг в момент завершения', () => {
    expect(read('server/src/services/QuestService.ts'))
      .toMatch(/increment\(characterId, \{ questsCompleted: 1 \}\)/);
  });

  it('время в игре копится в тике регенерации', () => {
    // Тик идёт ровно раз в 5 секунд по каждому онлайн-игроку, так что
    // счётчик копится без погрешности
    expect(socket).toMatch(/increment\(socket\.characterId, \{ playtimeSeconds: 5 \}\)/);
  });

  it('вкладка PvP читает настоящую таблицу, а не её копию', () => {
    // В leaderboard была вторая колонка pvp_rating, которую никто не писал:
    // PvPService ведёт pvp_rankings. Поэтому у всех стояло 1000 и порядок
    // был произвольным. Теперь вкладка берёт pvp_rankings.
    expect(service).toMatch(/LEFT JOIN pvp_rankings pr ON pr\.character_id = l\.character_id/);
    expect(service).toMatch(/COALESCE\(pr\.rating, 0\)/);
  });

  it('ошибка записи в рейтинг не роняет игровой тик', () => {
    // Регенерация ресурсов не должна зависеть от того, записался ли рейтинг
    expect(socket).toMatch(/Leaderboard sync skipped/);
  });

  it('колонки и значения не разъезжаются', () => {
    // БЫЛА ОШИБКА: колонки для INSERT брались из Object.keys(stats) целиком,
    // а значения — только те, что не undefined. При частичном вызове
    // плейсхолдеров получалось больше, чем параметров, и Postgres
    // отклонял запрос. Теперь оба списка собираются одним проходом
    expect(service).toMatch(/const ph = `\$\$\{values\.length\}`/);
    expect(service).toMatch(/cols\.map\(\(_, i\) => `\$\$\{i \+ 2\}`\)/);
    // Старая схема, где колонки и параметры считались по-разному, исчезла
    expect(service).not.toMatch(/Object\.keys\(stats\)\.map/);
  });

  it('пустой вызов не делает запрос', () => {
    // Иначе был бы INSERT без колонок
    expect(service).toMatch(/if \(cols\.length === 0\) return;/);
  });

  it('главная страница всё ещё спрашивает рейтинг', () => {
    // Проверяем, что вывод на сайте не отвалился: пустая таблица была
    // симптомом, а не причиной — починить надо было наполнение
    expect(siteJs).toMatch(/api\/leaderboard\/top/);
  });
});
