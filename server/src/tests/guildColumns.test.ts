// Гильдии: код требует колонок, которых в базе нет.
//
// ЧТО БЫЛО. Таблицу создала миграция 001, а 015 объявила её заново — через
// CREATE TABLE IF NOT EXISTS, который не выполняется, если таблица уже есть.
// Код при этом с самого начала опирался на четыре колонки из 015:
//
//   tag          — createGuild писал INSERT INTO guilds (name, tag, ...),
//                  создать гильдию было нельзя ни разу (в проде 0 гильдий);
//                  searchGuilds искал по tag, запрос падал, ответ не
//                  отправлялся, клиент получал 504;
//   max_members  — addMember сверялся с guild.max_members, которого нет в
//                  SELECT *, то есть с undefined: сравнение всегда ложно и
//                  лимит гильдии не действовал;
//   experience   — addContribution делал UPDATE guilds SET experience = ...;
//   banner_color — есть в интерфейсе Guild, в базе его не было.
//
// Здесь исполняются настоящие createGuild и searchGuilds, вырезанные из
// GuildService: они печатают настоящий SQL, а колонки сверяются с настоящими
// миграциями. Копия запроса в тесте не упала бы никогда.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildMethodRunner } from './helpers/extractFn';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const service = read('server/src/services/GuildService.ts');
const routes = read('server/src/routes/guilds.ts');
const client = read('client/src/app/guild.ts');

/**
 * Колонки, которые база имеет НА САМОМ ДЕЛЕ после применения миграций.
 *
 * Не объявленные, а применённые. Миграция 015 объявила guilds через
 * `CREATE TABLE IF NOT EXISTS` поверх таблицы из 001 — Postgres такой CREATE
 * пропускает, и объявленные там колонки в базу не попадают. Обычный разбор
 * объявлений этого не видит и дал бы зелёный тест на сломанной базе: именно
 * так поломка и жила рядом с проходящими тестами.
 *
 * Правила совпадают с раннером server/src/database/migrate.ts: файлы
 * выполняются по порядку целиком.
 */
function appliedColumns(table: string): Set<string> {
  const cols = new Set<string>();
  let exists = false;

  const files = readdirSync(join(repoRoot, 'database', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const f of files) {
    const sql = read(`database/migrations/${f}`);

    const create = new RegExp(
      `CREATE\\s+TABLE(\\s+IF\\s+NOT\\s+EXISTS)?\\s+${table}\\s*\\(([\\s\\S]*?)\\n\\s*\\);`,
      'gi',
    );
    for (const m of sql.matchAll(create)) {
      if (exists) continue; // таблица уже есть — CREATE не выполняется
      for (const line of m[2].split('\n')) {
        const col = line.trim().match(/^([a-z_][a-z0-9_]*)\s+/i);
        if (col) cols.add(col[1].toLowerCase());
      }
      exists = true;
    }

    const alter = new RegExp(
      `ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+([a-z_][a-z0-9_]*)`,
      'gi',
    );
    for (const m of sql.matchAll(alter)) cols.add(m[1].toLowerCase());
  }
  return cols;
}

/** Колонки, которые запрос реально трогает (INSERT-список и сравнения) */
function columnsUsedIn(sql: string): string[] {
  const out = new Set<string>();
  const ins = /INSERT\s+INTO\s+guilds\s*\(([^)]+)\)/i.exec(sql);
  if (ins) for (const c of ins[1].split(',')) out.add(c.trim().toLowerCase());
  for (const m of sql.matchAll(/\b([a-z_][a-z0-9_]*)\s*(?:=|ILIKE|<>|>=|<=)/gi)) {
    out.add(m[1].toLowerCase());
  }
  return [...out];
}

/** База, которая только запоминает SQL; INSERT INTO guilds отдаёт новую гильдию */
function fakeDb(): { db: Record<string, unknown>; calls: { sql: string; values: unknown[] }[] } {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = {
    async queryOne(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      if (/INSERT\s+INTO\s+guilds/i.test(sql)) return { id: 'GUILD-1', name: 'Test', tag: 'TEST' };
      return null;
    },
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      return [];
    },
  };
  return { db, calls };
}

const cols = appliedColumns('guilds');
const expected = ['tag', 'experience', 'max_members', 'banner_color'];

describe('Гильдии: колонки из интерфейса есть в настоящей схеме', () => {
  it('таблица создана (иначе проверки ниже вхолостую)', () => {
    expect(cols.size).toBeGreaterThan(5);
    expect(cols.has('name')).toBe(true);
  });

  for (const col of expected) {
    it(`колонка ${col} объявлена миграцией`, () => {
      // ТУТ БЫЛА ПОЛОМКА: 015 объявила их через IF NOT EXISTS поверх 001
      expect({ col, inSchema: cols.has(col) }).toEqual({ col, inSchema: true });
    });
  }

  it('все четыре колонки заводит новая миграция, а не старая 015', () => {
    // 015 не сработает второй раз: применённые миграции записываются в
    // schema_migrations по имени файла. Значит нужен новый файл
    const fix = read('database/migrations/042_guilds_missing_columns.sql');
    for (const col of expected) {
      expect({ col, added: new RegExp(`ADD COLUMN IF NOT EXISTS ${col}`).test(fix) })
        .toEqual({ col, added: true });
    }
    // Строки UPDATE в миграции тоже колонки: перенос тега для старых гильдий
    expect(fix).toMatch(/SET tag = CASE/);
  });

  it('интерфейс и клиент ждут тег и лимит — иначе правка была бы ни к чему', () => {
    expect(service).toMatch(/max_members: number/);
    expect(client).toMatch(/\[\$\{g\.tag\}\]/);
  });

  it('015 объявила колонки в CREATE, который Postgres пропускает', () => {
    // Механизм поломки зафиксирован, чтобы проверка выше не была пустым
    // повтором вывода: без 042 база знает про tag только «на словах»
    const m015 = read('database/migrations/015_guilds_achievements_daily.sql');
    expect(m015).toMatch(/CREATE TABLE IF NOT EXISTS guilds \(/);
    expect(m015).toMatch(/tag\s+VARCHAR\(10\)/);

    const m001 = read('database/migrations/001_initial_schema.sql');
    const create001 = /CREATE TABLE guilds \(([\s\S]*?)\n\s*\);/.exec(m001);
    expect(create001).not.toBeNull();
    const cols001 = create001![1].split('\n').map((l) => l.trim().split(/\s+/)[0]);
    for (const col of expected) {
      expect({ col, in001: cols001.includes(col) }).toEqual({ col, in001: false });
    }
  });
});

describe('Настоящий createGuild печатает только существующие колонки', () => {
  it('исполняется функция из GuildService, а не её копия', () => {
    expect(service).toMatch(/async createGuild\(name: string, tag: string, leaderId: string/);
  });

  it('INSERT и проверка уникальности ссылаются на колонки из схемы', async () => {
    const createGuild = buildMethodRunner(service, 'createGuild', {
      logger: { info: () => undefined },
    }) as unknown as (
      this: { db: unknown },
      name: string, tag: string, leaderId: string, desc: string,
    ) => Promise<{ id: string }>;

    const { db, calls } = fakeDb();
    const guild = await createGuild.call({ db }, 'Тестовая', 'TEST', 'CHAR-1', '');

    expect(guild.id).toBe('GUILD-1');
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const { sql } of calls) {
      if (!/guilds/i.test(sql)) continue;
      for (const col of columnsUsedIn(sql)) {
        expect({ запрос: sql.replace(/\s+/g, ' ').slice(0, 60), col, inSchema: cols.has(col) })
          .toEqual({ запрос: expect.any(String), col, inSchema: true });
      }
    }
  });
});

describe('Настоящий searchGuilds ищет по колонкам из схемы', () => {
  it('исполняется функция из GuildService', async () => {
    const searchGuilds = buildMethodRunner(service, 'searchGuilds', {}) as unknown as (
      this: { db: unknown },
      query: string,
    ) => Promise<unknown[]>;

    const { db, calls } = fakeDb();
    await searchGuilds.call({ db }, 'Тебриз');

    expect(calls).toHaveLength(1);
    const sql = calls[0].sql;
    expect(sql).toMatch(/FROM guilds/);
    for (const col of columnsUsedIn(sql)) {
      expect({ col, inSchema: cols.has(col) }).toEqual({ col, inSchema: true });
    }
  });

  // Без try/catch ошибка БД уходила в unhandled rejection: ответ не
  // отправлялся вообще, клиент висел и получал 504
  const searchGuard = /router\.get\('\/search'[\s\S]{0,400}catch \(err\)/;

  it('маршрут поиска отвечает ошибкой, а не молчит до 504', () => {
    expect(searchGuard.test(routes)).toBe(true);
  });

  it('проверка выше не пропускает маршрут без обработки ошибки', () => {
    // Обычный вид этой поломки — именно так /search выглядит сейчас без
    // правки. Если выражение найдёт catch и тут, оно ничего не ловит
    const broken = [
      "router.get('/search', authMiddleware, async (req, res) => {",
      "  const q = String(req.query.q || '');",
      '  const results = await guilds.searchGuilds(q);',
      '  res.json({ guilds: results });',
      '});',
      "router.post('/create', authMiddleware, async (req, res) => {",
      '  // …дальше другие маршруты с catch — но вне 400 символов от поиска',
      '});',
    ].join('\n');
    expect(searchGuard.test(broken)).toBe(false);
  });
});
