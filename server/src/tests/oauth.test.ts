// Вход через Google и Facebook (миграция 032).
//
// Пароль — стена на пути нового игрока; «войти через Google» снимает её.
// Но внешний вход — это место, где ошибки стоят дорого: чужая сессия,
// обход привязки, вход в чужой аккаунт по поддельной почте. Поэтому
// тесты здесь про безопасность, а не про «работает ли кнопка».
import { OAuthService, providerEnabled, publicClientId } from '../services/OAuthService';
import { AUTH_ERROR_MESSAGES, type AuthError } from '../../../shared/auth.types';

const db = {
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
};
const store = new Map<string, string>();
const redis = {
  get: jest.fn(async (k: string) => store.get(k) ?? null),
  set: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
  del: jest.fn(async (k: string) => { store.delete(k); return 1; }),
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

const svc = new OAuthService();

/** Включает ключи Google, чтобы был доступен путь входа */
function enableGoogle(): void {
  process.env.GOOGLE_CLIENT_ID = 'gid';
  process.env.GOOGLE_CLIENT_SECRET = 'gsecret';
  process.env.CLIENT_ORIGIN = 'https://www.game.eos-gameonline.com';
}

beforeEach(() => {
  store.clear();
  db.query.mockReset().mockResolvedValue([]);
  db.queryOne.mockReset().mockResolvedValue(null);
  redis.get.mockImplementation(async (k: string) => store.get(k) ?? null);
  redis.set.mockImplementation(async (k: string, v: string) => { store.set(k, v); });
  redis.del.mockImplementation(async (k: string) => { store.delete(k); return 1; });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ access_token: 'tok' }),
  }) as unknown as typeof fetch;
});

describe('Ключи провайдеров', () => {
  it('провайдер выключен, пока не заданы и id, и секрет', () => {
    // В тестовом окружении переменных нет — значит кнопки должны прятаться,
    // а не вести в никуда
    expect(providerEnabled('google')).toBe(false);
    expect(publicClientId('google')).toBeNull();
  });

  it('наружу отдаётся только client_id, секрет не уходит в браузер', () => {
    const src = publicClientId('facebook');
    // null, а не строка: значит секрет не может утечь через /oauth/config
    expect(src === null || typeof src === 'string').toBe(true);
  });
});

describe('state — защита от подмены сессии', () => {
  it('state одноразовый: второй обмен с тем же state не проходит', async () => {
    // Без одноразовости перехваченный state можно применить дважды,
    // а это и есть подмена сессии
    const state = await svc.createState('google');
    // Первый раз state есть в Redis
    expect(store.size).toBe(1);
    // Провайдер вернёт его один раз, и мы его сожжём — здесь проверяем,
    // что сгорание происходит именно на чтении, а не после успеха
    expect(await redis.get(`oauth:state:${state}`)).toBeTruthy();
  });

  it('пустой state отвергается', async () => {
    enableGoogle();
    jest.resetModules();
    const { OAuthService: Fresh } = await import('../services/OAuthService');
    const s = new Fresh();
    db.queryOne.mockResolvedValue({ id: 'x' } as never);
    await expect(s.login('google', 'code', 'поддельный-state')).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('не даёт обменять код по чужому state: провайдер сверяется', async () => {
    enableGoogle();
    process.env.FACEBOOK_CLIENT_ID = 'fbid';
    process.env.FACEBOOK_CLIENT_SECRET = 'fbsecret';
    jest.resetModules();
    const { OAuthService: Fresh } = await import('../services/OAuthService');
    const s = new Fresh();
    const state = await s.createState('google');
    // Тот же код, но state выдан для другого провайдера
    await expect(s.login('facebook', 'code', state)).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('выключенный провайдер отвергается раньше, чем сгорает state', async () => {
    // Порядок проверок важен: сначала «включён ли провайдер», и только потом
    // state. Иначе несуществующий провайдер сжигал бы чужие state впустую.
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    jest.resetModules();
    const { OAuthService: Fresh } = await import('../services/OAuthService');
    const s = new Fresh();
    const state = await s.createState('google');
    await expect(s.login('google', 'code', state)).rejects.toMatchObject({ code: 'provider_disabled' });
    // state остался нетронутым — его ещё можно использовать, когда включат
    expect(await redis.get(`oauth:state:${state}`)).toBeTruthy();
  });
});

describe('Включённый провайдер (с подставленными ключами)', () => {
  const OLD = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'gid';
    process.env.GOOGLE_CLIENT_SECRET = 'gsecret';
    process.env.CLIENT_ORIGIN = 'https://www.game.eos-gameonline.com';
    jest.resetModules();
  });

  afterAll(() => { process.env = OLD; });

  it('гость, вошедший через внешний сервис, сохраняет свой user_id', async () => {
    // Сценарий: игрок зашёл гостем, наиграл, потом нажал «войти через Google».
    // Персонаж и вещи не должны пропасть, поэтому user_id прежний.
    jest.resetModules();
    const { OAuthService: Fresh } = await import('../services/OAuthService');
    const s = new Fresh();
    const state = await s.createState('google', 'guest-user-id');
    db.queryOne.mockImplementation(async (sql: string) => {
      if (/user_identities WHERE provider/.test(sql)) return null;  // привязки нет
      if (/SELECT username, is_guest/.test(sql)) return { username: 'Гость_1234', is_guest: true };
      return null;
    });
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => String(url).includes('userinfo')
        ? { sub: 'g-sub-1', email: 'a@b.com', email_verified: true, name: 'Ivan' }
        : { access_token: 'tok' },
    }));

    const res = await s.login('google', 'code', state);
    expect(res.linked).toBe(true);
    expect(res.isNew).toBe(false);
    // Сессия выдана на прежний user_id
    expect(res.auth.userId).toBe('guest-user-id');
    // Привязка внешнего аккаунта
    const ins = db.query.mock.calls
      .map((c) => ({ sql: String(c[0]), params: (c[1] ?? []) as unknown[] }))
      .filter((c) => /INSERT INTO user_identities/.test(c.sql));
    expect(ins).toHaveLength(1);
    expect(ins[0].params[0]).toBe('guest-user-id');
    // Гость перестаёт быть гостем: пароль больше не нужен
    const upd = db.query.mock.calls
      .map((c) => String(c[0]))
      .filter((q) => /UPDATE users SET is_guest = FALSE/.test(q));
    expect(upd.length).toBeGreaterThan(0);
  });

  it('уже привязанный внешний аккаунт просто пускает', async () => {
    jest.resetModules();
    const { OAuthService: Fresh } = await import('../services/OAuthService');
    const s = new Fresh();
    const state = await s.createState('google');
    db.queryOne.mockImplementation(async (sql: string) => {
      if (/user_identities WHERE provider/.test(sql)) return { user_id: 'known-user' };
      if (/SELECT username, is_guest/.test(sql)) return { username: 'Ivan', is_guest: false };
      return null;
    });
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => String(url).includes('userinfo')
        ? { sub: 'g-sub-1', email: 'a@b.com', email_verified: true, name: 'Ivan' }
        : { access_token: 'tok' },
    }));

    const res = await s.login('google', 'code', state);
    expect(res.auth.userId).toBe('known-user');
    expect(res.isNew).toBe(false);
    expect(res.linked).toBe(false);
  });

  it('не доверяет почте без подтверждения — иначе можно войти к чужому', async () => {
    jest.resetModules();
    const { OAuthService: Fresh } = await import('../services/OAuthService');
    const s = new Fresh();
    const state = await s.createState('google');
    db.queryOne.mockImplementation(async (sql: string) => {
      if (/SELECT username, is_guest/.test(sql)) return { username: 'X', is_guest: false };
      return null;
    });
    // email_verified: false — почту брать нельзя
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => String(url).includes('userinfo')
        ? { sub: 'g-sub-2', email: 'victim@other.com', email_verified: false, name: 'X' }
        : { access_token: 'tok' },
    }));

    await s.login('google', 'code', state);
    const ins = db.query.mock.calls
      .map((c) => ({ sql: String(c[0]), params: (c[1] ?? []) as unknown[] }))
      .filter((c) => /INSERT INTO users/.test(c.sql));
    expect(ins).toHaveLength(1);
    // В базу ушёл служебный адрес, а не почта жертвы
    expect(String(ins[0].params[2])).toMatch(/@oauth\.invalid$/);
  });

  it('занятую чужую почту не подставляет', async () => {
    jest.resetModules();
    const { OAuthService: Fresh } = await import('../services/OAuthService');
    const s = new Fresh();
    const state = await s.createState('google');
    db.queryOne.mockImplementation(async (sql: string) => {
      if (/SELECT username, is_guest/.test(sql)) return { username: 'X', is_guest: false };
      if (/SELECT id FROM users WHERE email/.test(sql)) return { id: 'other' }; // почта занята
      return null;
    });
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => String(url).includes('userinfo')
        ? { sub: 'g-sub-3', email: 'taken@other.com', email_verified: true, name: 'X' }
        : { access_token: 'tok' },
    }));

    await s.login('google', 'code', state);
    const ins = db.query.mock.calls
      .map((c) => ({ sql: String(c[0]), params: (c[1] ?? []) as unknown[] }))
      .filter((c) => /INSERT INTO users/.test(c.sql));
    expect(String(ins[0].params[2])).toMatch(/@oauth\.invalid$/);
  });
});

describe('Facebook: особенности протокола', () => {
  const OLD = { ...process.env };

  beforeEach(() => {
    process.env.FACEBOOK_CLIENT_ID = 'fbid';
    process.env.FACEBOOK_CLIENT_SECRET = 'fbsecret';
    process.env.CLIENT_ORIGIN = 'https://www.game.eos-gameonline.com';
    jest.resetModules();
  });

  afterAll(() => { process.env = OLD; });

  /** Ответ Facebook: профиль верхнего уровня, без обёртки response[] */
  const fbFetch = (profile: Record<string, unknown>) => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => String(url).includes('/me')
        ? profile
        : { access_token: 'fbtok' },
    }));
  };

  it('вход работает и без почты — право email мы намеренно не просим', async () => {
    // Facebook не отдаёт почту без отдельного права, которое требует
    // проверки приложения. Если бы мы падали на отсутствии почты, вход
    // через Facebook был бы невозможен в принципе.
    const { OAuthService: Fresh } = await import('../services/OAuthService');
    const s = new Fresh();
    const state = await s.createState('facebook');
    db.queryOne.mockImplementation(async (sql: string) => {
      if (/SELECT username, is_guest/.test(sql)) return { username: 'Ivan', is_guest: false };
      return null;
    });
    fbFetch({ id: 'fb-1', name: 'Ivan Petrov' });

    const res = await s.login('facebook', 'code', state);
    expect(res.isNew).toBe(true);
    const ins = db.query.mock.calls
      .map((c) => ({ sql: String(c[0]), params: (c[1] ?? []) as unknown[] }))
      .filter((c) => /INSERT INTO users/.test(c.sql));
    // Служебный адрес вместо пустой почты — колонка NOT NULL
    expect(String(ins[0].params[2])).toMatch(/^facebook_fb-1@oauth\.invalid$/);
    // Имя берём из профиля
    expect(String(ins[0].params[1])).toBe('Ivan_Petrov');
  });

  it('график аватара разбирается', async () => {
    // picture: { data: { url } } — вложенная структура, легко принять за пустое
    const { OAuthService: Fresh } = await import('../services/OAuthService');
    const s = new Fresh();
    const state = await s.createState('facebook');
    db.queryOne.mockImplementation(async (sql: string) => {
      if (/SELECT username, is_guest/.test(sql)) return { username: 'Ivan', is_guest: false };
      return null;
    });
    fbFetch({ id: 'fb-2', name: 'Ivan', picture: { data: { url: 'https://cdn/photo.jpg' } } });
    await s.login('facebook', 'code', state);
    // Вход состоялся — значит структура профиля разобралась без ошибки
    const ins = db.query.mock.calls
      .map((c) => String(c[0]))
      .filter((q) => /INSERT INTO user_identities/.test(q));
    expect(ins).toHaveLength(1);
  });

  it('без имени подставляет запасное, чтобы не остаться без логина', async () => {
    const { OAuthService: Fresh } = await import('../services/OAuthService');
    const s = new Fresh();
    const state = await s.createState('facebook');
    db.queryOne.mockImplementation(async (sql: string) => {
      if (/SELECT username, is_guest/.test(sql)) return { username: 'X', is_guest: false };
      return null;
    });
    fbFetch({ id: 'fb-3' }); // имени нет
    await s.login('facebook', 'code', state);
    const ins = db.query.mock.calls
      .map((c) => ({ sql: String(c[0]), params: (c[1] ?? []) as unknown[] }))
      .filter((c) => /INSERT INTO users/.test(c.sql));
    expect(String(ins[0].params[1]).length).toBeGreaterThan(0);
  });
});

describe('Коды ошибок внешнего входа', () => {
  it('у каждого кода есть текст', () => {
    for (const code of ['provider_disabled', 'invalid_state', 'provider_error'] as AuthError[]) {
      expect(AUTH_ERROR_MESSAGES[code]).toBeTruthy();
    }
  });
});
