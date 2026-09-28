// Три поломки, найденные обходом всех панелей на проде 28.09.2026:
// четыре эндпоинта отвечали 4xx/5xx, а панели показывали ошибку или пустоту.
//
// 1. Питомцы, дом и PvP. requireCharacterOwnership читал персонажа ТОЛЬКО из
//    тела запроса, а GET приходит с ?characterId=. Панель «Питомцы» получала
//    400 «Missing characterId» («Ошибка: Missing characterId» у игрока),
//    «Дом» — 400 («Ошибка загрузки»), «PvP» — 400. Маршрутов с такой
//    подписью пять. Собственно идентификатор в это время лежал в query —
//    то есть сервер сам себя отвергал.
//
// 2. Зал славы. Маршрут SELECT k.character_id ... FROM world_boss_kills,
//    а колонки character_id в таблице никогда не было: победитель писался
//    внутрь JSONB top_damage. Postgres отвечал «column k.character_id does
//    not exist», маршрут — 500, панель — «Бой не окончен». Ни одного
//    убийцы не было показано ни разу.
//
// 3. Ежедневные задачи. В seedCatalog пропущена запятая между SQL-шаблоном
//    и массивом значений. JavaScript прочитал это как индексацию строки,
//    то есть в базу уходил ОДИН СИМВОЛ вместо INSERT — и на каждом старте
//    сервера: «посев каталога задач не удался: syntax error at or near "a"».
//    Каталог задач оставался пустым.
//
// Здесь исполняется настоящий код: requireCharacterOwnership и recordKill
// вырезаются из файлов, seedCatalog — метод, который тоже берётся из класса.
// Копии этих функций в тесте не ломались бы никогда.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildConstRunner, buildMethodRunner } from './helpers/extractFn';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const gameRoute = read('server/src/routes/game.ts');
const dailyService = read('server/src/services/DailyTaskService.ts');
const worldEvent = read('server/src/systems/WorldEventSystem.ts');
const hallRoute = read('server/src/routes/hallOfFame.ts');

// ── 1. Проверка принадлежности персонажа ──────────────────────

type FakeRes = {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(payload: unknown): FakeRes;
};

type Middleware = (
  req: { body?: Record<string, unknown>; query?: Record<string, unknown>; userId?: string },
  res: FakeRes,
  next: () => void,
) => Promise<void> | void;

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: null,
    status(code: number) { res.statusCode = code; return res; },
    json(payload: unknown) { res.body = payload; return res; },
  };
  return res;
}

/** Персонаж существует и принадлежит USER-1; чужой id сервис не находит */
const characterService = {
  async getCharacterById(id: unknown): Promise<{ id: string; userId: string } | null> {
    return id === 'CHAR-OWN' ? { id: 'CHAR-OWN', userId: 'USER-1' } : null;
  },
};

// requireCharacterOwnership — фабрика: в маршрутах стоят вызовы
// requireCharacterOwnership(), и настоящий middleware — её результат
const makeOwnership = buildConstRunner(gameRoute, 'requireCharacterOwnership', {
  characterService,
}) as unknown as (field?: string) => Middleware;
const ownership = makeOwnership();

/** Прогнать middleware и вернуть, что ответил сервер и был ли next() */
async function run(
  req: { body?: Record<string, unknown>; query?: Record<string, unknown>; userId?: string },
): Promise<{ res: FakeRes; nextCalls: number }> {
  const res = makeRes();
  let nextCalls = 0;
  await ownership(req, res, () => { nextCalls++; });
  return { res, nextCalls };
}

describe('GET-маршруты: персонаж берётся из query, а не только из тела', () => {
  it('исполняется настоящая requireCharacterOwnership из game.ts', () => {
    // Функция должна существовать в коде ровно так, как её вырезает тест:
    // иначе сборка теста упадёт раньше, чем падение превратится в диагноз
    expect(gameRoute).toMatch(/const requireCharacterOwnership = \(field = 'characterId'\)/);
  });

  it('id из строки запроса проходит проверку', () => {
    // БЫЛО: 400 Missing characterId, хотя id лежал в query — панель
    // «Питомцы» показывала текст ошибки игроку
    return run({ query: { characterId: 'CHAR-OWN' }, userId: 'USER-1' })
      .then(({ res, nextCalls }) => {
        expect(nextCalls).toBe(1);
        expect(res.statusCode).toBe(200);
      });
  });

  it('id из тела запроса тоже проходит — POST-маршруты не сломаны', () => {
    return run({ body: { characterId: 'CHAR-OWN' }, userId: 'USER-1' })
      .then(({ res, nextCalls }) => {
        expect(nextCalls).toBe(1);
        expect(res.statusCode).toBe(200);
      });
  });

  it('массив в query не роняет проверку', () => {
    // Express повторяет параметр в массив, если он встретился дважды
    return run({ query: { characterId: ['CHAR-OWN'] as unknown as string }, userId: 'USER-1' })
      .then(({ nextCalls }) => expect(nextCalls).toBe(1));
  });

  it('без id — 400 с понятным текстом', () => {
    return run({ userId: 'USER-1' }).then(({ res, nextCalls }) => {
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({ error: 'Missing characterId' });
    });
  });

  it('чужой персонаж — 403, а не пропуск', () => {
    // Проверка принадлежности — единственное, что мешало тратить золото
    // чужого персонажа; fallback на query не должен её ослабить
    return run({ query: { characterId: 'CHAR-OTHER' }, userId: 'USER-1' })
      .then(({ res, nextCalls }) => {
        expect(nextCalls).toBe(0);
        expect(res.statusCode).toBe(403);
      });
  });

  it('пострадавшие GET-маршруты действительно стоят на этой проверке', () => {
    // Петля обратной связи: если маршрут перестанет проверять принадлежность,
    // тест выше продолжит проходить, а дыра в безопасности вернётся
    for (const path of ['/pets', '/pets/active', '/house', '/pvp/me', '/pvp/history']) {
      const re = new RegExp(`gameRouter\\.get\\('${path.replace(/[/]/g, '\\$&')}'[^\\n]*requireCharacterOwnership\\(\\)`);
      expect({ path, guarded: re.test(gameRoute) }).toEqual({ path, guarded: true });
    }
  });
});

// ── 2. Посев каталога ежедневных задач ────────────────────────

type FakeDb = { query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }> };
type SeedCtx = { db: FakeDb; catalog(): Promise<unknown[]> };

const seedCatalog = buildMethodRunner(dailyService, 'seedCatalog', {}) as unknown as (
  this: SeedCtx,
) => Promise<number>;

const TASKS = [
  {
    id: 'daily_login', title: 'Login', title_ru: 'Войти', description: 'd', description_ru: 'd',
    task_type: 'login', target: 'any', required_count: 1, reward_gold: 100,
    reward_experience: 50, reward_item_id: null, reward_item_qty: 0, min_level: 1,
    region: null, reset_hours: 24,
  },
  {
    id: 'daily_kill', title: 'Kill', title_ru: 'Убить', description: 'd', description_ru: 'd',
    task_type: 'kill', target: 'wolf', required_count: 5, reward_gold: 200,
    reward_experience: 80, reward_item_id: 'mat_wolf_pelt', reward_item_qty: 2,
    min_level: 3, region: 'CITY', reset_hours: 24,
  },
];

/** Собрать ctx с базой, которая только запоминает, что ей передали */
function seedCtx(): { ctx: SeedCtx; calls: { sql: string; values: unknown[] }[] } {
  const calls: { sql: string; values: unknown[] }[] = [];
  const ctx: SeedCtx = {
    db: {
      async query(sql: string, values: unknown[] = []) {
        calls.push({ sql, values });
        return { rows: [] };
      },
    },
    async catalog() { return TASKS; },
  };
  return { ctx, calls };
}

describe('Ежедневные задачи: каталог уходит в базу настоящим INSERT', () => {
  it('исполняется настоящий seedCatalog из класса', () => {
    expect(dailyService).toMatch(/async seedCatalog\(\): Promise<number> \{/);
  });

  it('каждая задача — это SQL, начинающийся с INSERT, плюс массив значений', async () => {
    const { ctx, calls } = seedCtx();
    const written = await seedCatalog.call(ctx);

    expect(written).toBe(TASKS.length);
    expect(calls).toHaveLength(TASKS.length);

    // ТУТ БЫЛ БАГ. Пропущенная запятая превращала `шаблон[массив]` в
    // обращение к элементу строки, поэтому в базу уходил один символ.
    for (const [i, call] of calls.entries()) {
      expect({ i, sql: call.sql.slice(0, 40) }).toEqual({
        i,
        sql: expect.stringMatching(/^INSERT INTO daily_tasks/),
      });
      expect(Array.isArray(call.values)).toBe(true);
      expect(call.values).toHaveLength(15);
      expect(call.values[0]).toBe(TASKS[i].id);
    }
  });

  it('посев идемпотентен: повтор не плодит дубли', async () => {
    const { ctx, calls } = seedCtx();
    await seedCatalog.call(ctx);
    expect(calls[0].sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
    expect(calls[0].sql).toMatch(/reset_hours = EXCLUDED\.reset_hours/);
  });

  it('посев зовётся из игрового цикла и сообщает результат', () => {
    // Тот же вызов, что на проде давал «посев каталога задач не удался».
    // Строка успеха нужна: без неё непонятно, отработал посев или молчал
    const loop = read('server/src/systems/GameLoop.ts');
    expect(loop).toMatch(/this\.dailyTaskService\.seedCatalog\(\)/);
    expect(loop).toMatch(/каталог записан в базу/);
  });
});

// ── 3. Зал славы: колонка победителя ──────────────────────────

/** Колонки, объявленные в CREATE TABLE и добавленные через ALTER TABLE ADD COLUMN */
function declaredColumns(table: string): Set<string> {
  const schemaSql = readdirSync(join(repoRoot, 'database', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => read(`database/migrations/${f}`))
    .join('\n');

  const cols = new Set<string>();
  const create = new RegExp(
    `CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${table}\\s*\\(([\\s\\S]*?)\\n\\s*\\);`,
    'gi',
  );
  for (const m of schemaSql.matchAll(create)) {
    for (const line of m[1].split('\n')) {
      const col = line.trim().match(/^([a-z_][a-z0-9_]*)\s+/i);
      if (col) cols.add(col[1].toLowerCase());
    }
  }
  const alter = new RegExp(
    `ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+([a-z_][a-z0-9_]*)`,
    'gi',
  );
  for (const m of schemaSql.matchAll(alter)) cols.add(m[1].toLowerCase());
  return cols;
}

/** SQL-шаблон, которым маршруту отдаётся таблица убийств */
function hallSql(): string {
  const m = /`([^`]*FROM world_boss_kills[^`]*)`/.exec(hallRoute);
  if (!m) throw new Error('в маршруте зала славы нет запроса к world_boss_kills');
  return m[1];
}

describe('Зал славы: маршрут считает по колонкам, которые есть в базе', () => {
  const cols = declaredColumns('world_boss_kills');

  it('таблица существует (иначе проверка ниже вхолостую)', () => {
    expect(cols.size).toBeGreaterThan(3);
  });

  it('колонка победителя объявлена миграцией', () => {
    // БЫЛО: колонки не было вообще — маршрут отвечал 500
    expect({ character_id: cols.has('character_id') }).toEqual({ character_id: true });
  });

  it('все k.*-колонки из запроса маршрута объявлены в схеме', () => {
    const sql = hallSql();
    const used = [...sql.matchAll(/\bk\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1].toLowerCase());
    expect(used.length).toBeGreaterThan(0);
    for (const col of used) {
      expect({ col, inSchema: cols.has(col) }).toEqual({ col, inSchema: true });
    }
  });

  it('миграция 041 заносит туда старые победы, а не только заведёт колонку', () => {
    // Без переноса из JSONB панель осталась бы пустой для всех прошлых
    // убийств — починка выглядела бы как «не работает»
    const fix = read('database/migrations/041_world_boss_kills_character.sql');
    expect(fix).toMatch(/ADD COLUMN IF NOT EXISTS character_id UUID/);
    expect(fix).toMatch(/UPDATE world_boss_kills/);
    expect(fix).toMatch(/top_damage->0->>'characterId'/);
  });

  it('исполняется настоящий recordKill, и он пишет победителя колонкой', async () => {
    type KillCtx = {
      characters: { getCharacterById(id: string): Promise<{ guildId: string } | null> };
      db: FakeDb;
    };
    const recordKill = buildMethodRunner(worldEvent, 'recordKill', {
      EVENT_INTERVAL_MS: 3 * 60 * 60 * 1000,
    }) as unknown as (this: KillCtx, bossId: string, killerId: string) => Promise<void>;

    const calls: { sql: string; values: unknown[] }[] = [];
    const ctx: KillCtx = {
      characters: { getCharacterById: async () => ({ guildId: 'GUILD-1' }) },
      db: {
        async query(sql: string, values: unknown[] = []) {
          calls.push({ sql, values });
          return { rows: [] };
        },
      },
    };

    await recordKill.call(ctx, 'simurgh', 'CHAR-OWN');

    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toMatch(/INSERT INTO world_boss_kills \(boss_id, guild_id, top_damage, character_id\)/);
    expect(calls[0].values[3]).toBe('CHAR-OWN');
    // Второй запрос — расписание, он не должен был не выполниться
    expect(calls[1].sql).toMatch(/UPDATE world_boss_schedule/);
  });

  it('исчезнувший персонаж не роняет запись убийства', async () => {
    // character_id — внешний ключ. Если персонажа уже нет, колонка
    // остаётся NULL: строка истории сохраняется, в JOIN не попадает
    type KillCtx = {
      characters: { getCharacterById(id: string): Promise<null> };
      db: FakeDb;
    };
    const recordKill = buildMethodRunner(worldEvent, 'recordKill', {
      EVENT_INTERVAL_MS: 3 * 60 * 60 * 1000,
    }) as unknown as (this: KillCtx, bossId: string, killerId: string) => Promise<void>;

    const calls: { sql: string; values: unknown[] }[] = [];
    const ctx: KillCtx = {
      characters: { getCharacterById: async () => null },
      db: {
        async query(sql: string, values: unknown[] = []) {
          calls.push({ sql, values });
          return { rows: [] };
        },
      },
    };

    await recordKill.call(ctx, 'simurgh', 'CHAR-GONE');
    expect(calls[0].values[3]).toBe(null);
  });
});
