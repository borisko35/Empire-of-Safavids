// Достижения: в панели стояло «undefined», а счётчик не двигался никогда.
//
// Две поломки в одной панели, найденные обходом 28.09.2026:
//
// 1. Название строки. Сервер отдаёт поля title / title_ru (определения
//    достижений лежат в коде и приходят в JSON как есть), а панель читала
//    a.titleRu — такого поля нет, и во всех 21 строках выводилось
//    «⚔️ undefined Убить первого монстра».
//
// 2. Счётчик «Разблокировано: 0 / 21». Маршрут вызывал
//    getUnlocked(req.userId) — идентификатор АККАУНТА — а таблица
//    character_achievements хранит character_id. Прогресс игрока в базе
//    никогда не находился: даже у того, кто что-то достиг, панель
//    показывала ноль и не загорала строки. Ровно та же ошибка, что была
//    с задачами дня, репутацией, конюшней, башней и питомцами.
//
// Здесь исполняются настоящие обработчики маршрутов, вырезанные из
// progression.ts, и настоящий getAll() с определениями из AchievementService.
// Поля, которые читает клиент, сверяются с настоящим ответом сервера.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRouteRunner } from './helpers/extractFn';
import { AchievementService } from '../services/AchievementService';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const routes = read('server/src/routes/progression.ts');
const panels = read('client/src/app/panels.ts');
const clientApi = read('client/src/app/api.ts');

// ── Настоящий обработчик /achievements ───────────────────────

type FakeRes = {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(payload: unknown): FakeRes;
};

type Req = { query?: Record<string, unknown>; params?: Record<string, unknown>; userId?: string };

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: null,
    status(code: number) { res.statusCode = code; return res; },
    json(payload: unknown) { res.body = payload; return res; },
  };
  return res;
}

/** Спишем всё, что маршрут спросил у сервисов */
function makeDeps(): {
  deps: Record<string, unknown>;
  unlockedFor: string[];
  progressFor: string[];
} {
  const unlockedFor: string[] = [];
  const progressFor: string[] = [];
  const deps = {
    achievements: {
      async getAll() {
        return [{ id: 'ach_first_blood', title: 'First Blood', title_ru: 'Первая кровь' }];
      },
      async getUnlocked(charId: string) {
        unlockedFor.push(charId);
        return [{ id: 'ach_first_blood' }];
      },
      /**
       * Счётчики. Маршрут зовёт их, чтобы отдать прогресс по строке.
       * Без этого метода маршрут падал бы с «getCounters is not a function» -
       * и проверка панели падала бы, ничего не говоря о панели.
       */
      async getCounters() {
        return { monsters_killed: 0, parries: 0, pvp_wins: 0, quests_completed: 0 };
      },
      /**
       * Счётчики И состояния вместе - то, чем измеряется условие.
       * Маршрут перешёл на getMeasures, когда у части достижений
       * появились условия по состоянию (друг, гильдия), которых в
       * leaderboard нет. Подмена повторяет настоящее поведение:
       * состояний нет, пока их не завели.
       *
       * Без этого метода маршрут падал бы с «getMeasures is not a
       * function» - и проверка панели падала бы, ничего не говоря о панели.
       */
      async getMeasures() {
        return {
          monsters_killed: 0, parries: 0, pvp_wins: 0, quests_completed: 0,
          has_friend: 0, in_guild: 0,
        };
      },
      async getProgress(charId: string, achId: string) {
        progressFor.push(`${charId}:${achId}`);
        return { unlocked: true, current: 0, need: 1, counted: true };
      },
    },
    // Проверка принадлежности: тот же запрос, что у других панелей
    db: {
      async queryOne(_sql: string, values: unknown[] = []) {
        const [characterId, userId] = values as [string, string];
        return characterId === 'CHAR-OWN' && userId === 'USER-1' ? { id: characterId } : null;
      },
    },
  };
  return { deps, unlockedFor, progressFor };
}

describe('Достижения: счётчик считает по персонажу, а не по аккаунту', () => {
  it('исполняется настоящий обработчик из progression.ts', () => {
    // Маркер должен найтись ровно один раз, иначе вырежется не тот маршрут
    expect(routes.split("'/achievements'").length - 1).toBe(1);
    expect(routes).toMatch(/getUnlocked\(characterId\)/);
    expect(routes).not.toMatch(/getUnlocked\(req\.userId\)/);
  });

  it('без characterId — 400, и прогресс даже не спрашивается', async () => {
    const { deps, unlockedFor } = makeDeps();
    const handler = buildRouteRunner(routes, "'/achievements'", deps) as (
      req: Req, res: FakeRes,
    ) => Promise<void> | void;
    const res = makeRes();
    await handler({ query: {}, userId: 'USER-1' }, res);
    expect(res.statusCode).toBe(400);
    expect(unlockedFor).toHaveLength(0);
  });

  it('чужой персонаж — 404, а не чужой прогресс', async () => {
    const { deps, unlockedFor } = makeDeps();
    const handler = buildRouteRunner(routes, "'/achievements'", deps) as (
      req: Req, res: FakeRes,
    ) => Promise<void> | void;
    const res = makeRes();
    await handler({ query: { characterId: 'CHAR-OTHER' }, userId: 'USER-1' }, res);
    expect(res.statusCode).toBe(404);
    expect(unlockedFor).toHaveLength(0);
  });

  it('открытые достижения запрашиваются по id ПЕРСОНАЖА', async () => {
    // ТУТ БЫЛ БАГ: в запрос уходил req.userId, и база никогда не находила
    // ни одного открытого достижения
    const { deps, unlockedFor } = makeDeps();
    const handler = buildRouteRunner(routes, "'/achievements'", deps) as (
      req: Req, res: FakeRes,
    ) => Promise<void> | void;
    const res = makeRes();
    await handler({ query: { characterId: 'CHAR-OWN' }, userId: 'USER-1' }, res);

    expect(res.statusCode).toBe(200);
    expect(unlockedFor).toEqual(['CHAR-OWN']);
    expect(unlockedFor).not.toContain('USER-1');

    const body = res.body as { total: number; unlockedCount: number; achievements: { unlocked: boolean }[] };
    expect(body.total).toBe(1);
    expect(body.unlockedCount).toBe(1);
    expect(body.achievements[0].unlocked).toBe(true);
  });

  it('прогресс отдельного достижения тоже по персонажу', async () => {
    const { deps, progressFor } = makeDeps();
    const handler = buildRouteRunner(routes, "'/achievements/:id/progress'", deps) as (
      req: Req, res: FakeRes,
    ) => Promise<void> | void;

    const bad = makeRes();
    await handler({ query: {}, params: { id: 'ach_first_blood' }, userId: 'USER-1' }, bad);
    expect(bad.statusCode).toBe(400);
    expect(progressFor).toHaveLength(0);

    const ok = makeRes();
    await handler({ query: { characterId: 'CHAR-OWN' }, params: { id: 'ach_first_blood' }, userId: 'USER-1' }, ok);
    expect(ok.statusCode).toBe(200);
    expect(progressFor).toEqual(['CHAR-OWN:ach_first_blood']);
  });
});

// ── Контракт: клиент читает только то, что сервер отдаёт ─────

describe('Строка достижения: поля клиента есть в настоящем ответе', () => {
  /** Блок, которым рисуется строка, — из него видно, что именно читает клиент */
  const rowBlock = (() => {
    const m = /for \(const a of data\.achievements\)[\s\S]*?box\.append\(row\);/.exec(panels);
    if (!m) throw new Error('блок строки достижения в panels.ts не найден');
    return m[0];
  })();

  it('в блоке действительно читаются поля объекта', () => {
    const keys = [...rowBlock.matchAll(/\ba\.([a-zA-Z_]\w*)/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(3);
  });

  it('ни одно поле клиента не отдаётся undefined', async () => {
    // Настоящий сервис: определения достижений лежат в модуле и базу не
    // трогают, поэтому это ровно тот набор, что уйдёт игроку в JSON.
    const defs = await new AchievementService().getAll();
    expect(defs.length).toBeGreaterThan(10);

    // Настоящий ответ сервера, а не собранный руками.
    //
    // ТУТ БЫЛА ПОДМЕНА: payload склеивался как {...defs[0], unlocked: false}.
    // Маршрут добавляет в каждую строку ещё current, need и counted, и в
    // подмене их не было - проверка видела только определение, а не ответ.
    // Ровно так она пропустила бы поле, которое панель читает, а маршрут
    // не отдаёт. Теперь ответ берётся из res.body настоящего маршрута.
    const { deps } = makeDeps();
    (deps.achievements as { getAll: () => Promise<unknown> }).getAll = async () => defs;
    (deps.achievements as { getMeasures?: unknown }).getMeasures =
      // Счётчик задан ненулевым, чтобы панель показала прогресс, а не ноль
      // по умолчанию. Состояния тоже заданы: иначе проверка «ни одно поле
      // клиента не отдаётся undefined» прошла бы на нулях и ничего бы не
      // сказала о прогрессе по состоянию.
      async () => ({
        monsters_killed: 3, parries: 0, pvp_wins: 0, quests_completed: 0,
        has_friend: 1, in_guild: 1,
      });
    const handler = buildRouteRunner(routes, "'/achievements'", deps) as (
      req: Req, res: FakeRes,
    ) => Promise<void> | void;
    const res = makeRes();
    await handler({ query: { characterId: 'CHAR-OWN' }, userId: 'USER-1' }, res);
    expect(res.statusCode).toBe(200);

    const body = res.body as { achievements: Record<string, unknown>[] };
    const payload = body.achievements[0];

    const keys = [...new Set([...rowBlock.matchAll(/\ba\.([a-zA-Z_]\w*)/g)].map((m) => m[1]))];
    expect({ полей_у_клиента: keys.length }).toEqual({ полей_у_клиента: expect.any(Number) });
    for (const key of keys) {
      // Не 'undefined', а именно наличие: отсутствующее поле в ответе и
      // поле со значением undefined одинаково рисуют в панели пустоту,
      // но первое - поломка сервера, второе - поломка сериализации.
      expect({ key, есть: key in payload }).toEqual({ key, есть: true });
    }
  });

  it('a.titleRu больше не читается — это поле сервер никогда не отдавал', () => {
    // ТУТ БЫЛ БАГ: в каждой из 21 строки стояло «undefined»
    expect(rowBlock).not.toMatch(/a\.titleRu\b/);
    expect(rowBlock).toMatch(/a\.title_ru/);
  });

  it('клиент передаёт characterId в оба эндпоинта достижений', () => {
    expect(clientApi).toMatch(/achievements: \(characterId: string\)/);
    expect(clientApi).toMatch(/\/api\/progression\/achievements\?characterId=\$\{characterId\}/);
    expect(panels).toMatch(/api\.achievements\(charId\)/);
  });
});
