// Гостевой вход (миграция 031).
//
// Зачем фича: между «заинтересовался» и «играет» стояла стена из формы
// регистрации — имя, почта, пароль, два согласия, год рождения. Гость
// убирает эту стену: аккаунт создаётся в один клик, прогресс потом можно
// присвоить себе.
//
// Проверяем то, что легко сломать и трудно заметить: гость не должен
// логиниться по паролю, аккаунт должен быть помечен гостевым, а присвоение
// обязано сохранять тот же user_id (иначе пропадёт весь прогресс).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthService } from '../services/AuthService';
import { AUTH_ERROR_MESSAGES, type AuthError } from '../../../shared/auth.types';

// ── Мок БД и Redis ────────────────────────────────────────────
type Row = Record<string, unknown>;
const db = {
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
};
const store = new Map<string, string>();
const redis = {
  get: jest.fn(async (k: string) => store.get(k) ?? null),
  set: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
  incr: jest.fn(async (k: string) => {
    const n = parseInt(store.get(k) ?? '0') + 1;
    store.set(k, String(n));
    return n;
  }),
  expire: jest.fn(async () => 1),
  del: jest.fn(async (k: string) => { store.delete(k); return 1; }),
  getSession: jest.fn(async () => null),
  setSession: jest.fn(async () => 1),
  deleteSession: jest.fn(async () => 1),
  publish: jest.fn(async () => 1),
};

jest.mock('../services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => db },
}));
jest.mock('../services/RedisService', () => ({
  RedisService: { getInstance: () => redis },
}));
jest.mock('../services/AnalyticsService', () => ({
  analytics: { track: jest.fn() },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const svc = new AuthService();

/** Ответы, которые сервер реально отправит в БД */
const inserted: { sql: string; params: unknown[] }[] = [];
const updated: { sql: string; params: unknown[] }[] = [];
beforeEach(() => {
  store.clear();
  inserted.length = 0;
  updated.length = 0;
  db.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO users/i.test(sql)) inserted.push({ sql, params });
    if (/UPDATE users/i.test(sql)) updated.push({ sql, params });
    return [];
  });
  db.queryOne.mockResolvedValue(null);
  redis.get.mockImplementation(async (k: string) => store.get(k) ?? null);
});

describe('Гостевой вход', () => {
  it('создаёт аккаунт и выдаёт сессию без всяких данных от игрока', async () => {
    const res = await svc.guestLogin('1.2.3.4');
    expect(res.isGuest).toBe(true);
    expect(res.token).toBeTruthy();
    expect(res.userId).toBeTruthy();
    expect(redis.setSession).toHaveBeenCalled();
  });

  it('ставит гостю пароль, который невозможно угадать, и служебную почту', async () => {
    await svc.guestLogin('1.2.3.4');
    const ins = inserted[0];
    expect(ins).toBeDefined();
    // Колонки NOT NULL, поэтому заполняются — но не настоящими данными
    const [, username, email, hash] = ins.params;
    expect(String(username).length).toBeLessThanOrEqual(20); // users.username VARCHAR(20)
    // .invalid нельзя зарегистрировать (RFC 2606) — такой адрес не совпадёт с чужим
    expect(String(email)).toMatch(/@guest\.invalid$/);
    expect(String(hash).length).toBeGreaterThan(20); // bcrypt-хэш
    expect(ins.sql).toMatch(/is_guest/);
  });

  it('помечает аккаунт гостевым', async () => {
    await svc.guestLogin('1.2.3.4');
    // Флаг ставится литералом TRUE в самом SQL, а не параметром: так его
    // нельзя случайно подменить значением из тела запроса
    expect(inserted[0].sql).toMatch(/is_guest\s*,\s*last_login_at/);
    expect(inserted[0].sql).toMatch(/VALUES[^)]*TRUE/);
    // Параметры ровно те четыре, что нужно: id, имя, почта, хэш
    expect(inserted[0].params).toHaveLength(4);
  });

  it('имя гостя укладывается в 20 символов и уникально', async () => {
    // Первая попытка занята — сервис обязан взять другое имя
    db.queryOne.mockResolvedValueOnce({ id: 'taken' } as Row);
    const res = await svc.guestLogin('1.2.3.4');
    const name = inserted[0].params[1] as string;
    expect(name.length).toBeLessThanOrEqual(20);
    expect(res.username).toBe(name);
  });

  it('ограничивает число гостей с одного адреса (иначе наделают аккаунтов)', async () => {
    // Предел берём из кода, а не пишем числом: он менялся (5 → 30), когда
    // появилась кнопка «Играть за 10 секунд», и зашитое здесь пять
    // превратилось бы в проверку устаревшего числа, а не самого лимита.
    const limit = Number(
      /MAX_GUESTS_PER_IP\s*=\s*(\d+)/
        .exec(readFileSync(join(__dirname, '../services/AuthService.ts'), 'utf-8'))?.[1] ?? 0,
    );
    expect(limit).toBeGreaterThan(0);
    for (let i = 0; i < limit; i++) await svc.guestLogin('9.9.9.9');
    await expect(svc.guestLogin('9.9.9.9')).rejects.toMatchObject({ code: 'guest_rate_limited' });
    // С другого адреса — можно
    await expect(svc.guestLogin('8.8.8.8')).resolves.toBeTruthy();
    // Вызовов столько, сколько лимит (сейчас 30), а не пять: с mock-задержкой
    // это около восьми секунд, стандартных пяти не хватает
  }, 30000);
});

describe('Присвоение гостевого аккаунта', () => {
  const userId = '11111111-2222-3333-4444-555555555555';

  it('сохраняет тот же user_id — иначе пропал бы весь прогресс', async () => {
    db.queryOne.mockResolvedValueOnce({ is_guest: true } as Row);
    await svc.claim(userId, 'a@b.com', 'Password1');
    const upd = updated[0];
    expect(upd).toBeDefined();
    expect(upd.params[2]).toBe(userId);
    // Меняется только учётные данные, сам user_id не трогаем
    expect(upd.sql).not.toMatch(/SET id/i);
    expect(upd.sql).toMatch(/is_guest\s*=\s*FALSE/);
  });

  it('отказывает, если аккаунт уже не гостевой', async () => {
    db.queryOne.mockResolvedValueOnce({ is_guest: false } as Row);
    await expect(svc.claim(userId, 'a@b.com', 'Password1')).rejects.toMatchObject({ code: 'already_claimed' });
    expect(updated.length).toBe(0);
  });

  it('не даёт слабый пароль', async () => {
    db.queryOne.mockResolvedValueOnce({ is_guest: true } as Row);
    await expect(svc.claim(userId, 'a@b.com', 'short')).rejects.toMatchObject({ code: 'weak_password' });
  });

  it('не даёт занять чужую почту', async () => {
    db.queryOne.mockResolvedValueOnce({ is_guest: true } as Row)   // сам пользователь
      .mockResolvedValueOnce({ id: 'other' } as Row);              // почта занята
    await expect(svc.claim(userId, 'taken@b.com', 'Password1')).rejects.toMatchObject({ code: 'email_taken' });
  });

  it('считает почту в нижнем регистре, чтобы не было дубликатов', async () => {
    db.queryOne.mockResolvedValueOnce({ is_guest: true } as Row).mockResolvedValueOnce(null);
    await svc.claim(userId, 'Mixed@Case.COM', 'Password1');
    expect(updated[0].params[0]).toBe('mixed@case.com');
  });
});

describe('Коды ошибок гостевого входа', () => {
  it('у каждого нового кода есть текст', () => {
    for (const code of ['guest_rate_limited', 'not_guest', 'already_claimed'] as AuthError[]) {
      expect(AUTH_ERROR_MESSAGES[code]).toBeTruthy();
    }
  });
});
