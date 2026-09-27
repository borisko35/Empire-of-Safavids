// ============================================================
// OAuth Service — вход через Google и VK
// ============================================================
// Зачем: пароль — это стена на пути нового игрока. «Войти через Google» —
// один клик, и для привлечения людей это работает лучше, чем любой
// другой способ входа.
//
// Безопасность (главное в этой фиче):
//   1. СЕКРЕТ ПРОВАЙДЕРА НИКОГДА не попадает в браузер. Код обменивается
//      на токен на сервере, в интерфейс уходят только client_id.
//   2. state обязателен и одноразов: без него злоумышленник может
//      подсунуть свой код и войти в чужой аккаунт (подмена сессии).
//   3. user_id сохраняется при привязке: гость, вошедший через Google,
//      не теряет персонажа и прогресс.
//
// Если переменные окружения не заданы, провайдер считается выключенным:
// кнопки прячутся, а эндпоинт отвечает «не настроено». Иначе игра
// сломалась бы у того, кто ключи ещё не завёл.

import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './DatabaseService';
import { RedisService } from './RedisService';
import { analytics } from './AnalyticsService';
import { logger } from '../utils/logger';
import type { AuthResponse, OAuthProvider, OAuthProfile } from '../../../shared/auth.types';

// ── Конфигурация ──────────────────────────────────────────────
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const FACEBOOK_CLIENT_ID     = process.env.FACEBOOK_CLIENT_ID ?? '';
const FACEBOOK_CLIENT_SECRET = process.env.FACEBOOK_CLIENT_SECRET ?? '';

/**
 * Версия Graph API. Закреплена константой намеренно: если оставить «latest»,
 * то через полгода Facebook сменит формат ответа без предупреждения, и вход
 * сломается у всех разом. Меняем только осознанно.
 */
const FB_GRAPH_VERSION = 'v21.0';

/** Куда провайдер возвращает игрока. Домен берём из CLIENT_ORIGIN. */
const redirectUri = (): string => {
  const origin = (process.env.CLIENT_ORIGIN ?? '').replace(/\/+$/, '');
  return `${origin}/game/`;
};

const STATE_TTL_SEC = 600; // 10 минут на вход

/** Провайдер считается включённым, только если заданы и id, и секрет */
export function providerEnabled(p: OAuthProvider): boolean {
  return p === 'google'
    ? !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)
    : !!(FACEBOOK_CLIENT_ID && FACEBOOK_CLIENT_SECRET);
}

export function publicClientId(p: OAuthProvider): string | null {
  if (!providerEnabled(p)) return null;
  return p === 'google' ? GOOGLE_CLIENT_ID : FACEBOOK_CLIENT_ID;
}

/** Адрес, на который клиент отправляет игрока для входа */
export function authorizeUrl(p: OAuthProvider, state: string): string {
  const redirect = redirectUri();
  if (p === 'google') {
    return 'https://accounts.google.com/o/oauth2/v2/auth'
      + `?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}`
      + '&redirect_uri=' + encodeURIComponent(redirect)
      + '&response_type=code&scope=openid%20email%20profile'
      + `&state=${encodeURIComponent(state)}`
      // prompt: без этого Google молча возвращает того же пользователя без
      // экрана выбора — удобно, но «войти как другой» становится невозможно
      + '&prompt=select_account';
  }
  // Facebook: scope минимальный. Запрашивать email нельзя без App Review,
  // поэтому его не просим — почты у игрока просто не будет, и мы заведём
  // служебный адрес (см. createUserFromProfile). Имя и базовый профиль
  // Facebook отдаёт без отдельной проверки.
  return `https://www.facebook.com/${FB_GRAPH_VERSION}/dialog/oauth`
    + `?client_id=${encodeURIComponent(FACEBOOK_CLIENT_ID)}`
    + '&redirect_uri=' + encodeURIComponent(redirect)
    + '&response_type=code&scope=' + encodeURIComponent('public_profile')
    + `&state=${encodeURIComponent(state)}`
    // Без этого Facebook молча возвращает ранее выданный токен, и «войти как
    // другой» перестаёт работать
    + '&auth_type=rerequest';
}

export class OAuthService {
  private db    = DatabaseService.getInstance();
  private redis = RedisService.getInstance();

  // ============================================================
  // STATE
  // ============================================================
  /**
   * Выдаёт одноразовый state и запоминает его в Redis.
   * Если игрок уже вошёл (в т.ч. как гость) — state привязывается к его
   * user_id, и внешний вход привяжется к тому же аккаунту.
   */
  async createState(provider: OAuthProvider, currentUserId?: string): Promise<string> {
    const state = uuidv4();
    await this.redis.set(`oauth:state:${state}`, `${provider}:${currentUserId ?? ''}`, STATE_TTL_SEC);
    return state;
  }

  /**
   * Проверяет и СЖИГАЕТ state. Одноразовость обязательна: иначе один и тот
   * перехваченный state можно использовать дважды.
   */
  private async consumeState(state: string): Promise<{ provider: OAuthProvider; userId?: string }> {
    const key = `oauth:state:${state}`;
    const raw = await this.redis.get(key);
    if (!raw) throw this.oauthError('invalid_state', 'Сессия входа устарела. Попробуйте ещё раз');
    await this.redis.del(key);
    const [provider, userId] = raw.split(':');
    return { provider: provider as OAuthProvider, userId: userId || undefined };
  }

  // ============================================================
  // ОБМЕН КОДА НА ПРОФИЛЬ
  // ============================================================
  /** Google: код → access_token → профиль */
  private async fetchGoogleProfile(code: string): Promise<OAuthProfile> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw this.oauthError('provider_error', 'Google отклонил код входа');
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
    if (!accessToken) throw this.oauthError('provider_error', 'Google не вернул токен');

    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!infoRes.ok) throw this.oauthError('provider_error', 'Не удалось получить профиль Google');
    const info = (await infoRes.json()) as {
      sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string;
    };
    if (!info.sub) throw this.oauthError('provider_error', 'Google не вернул идентификатор');

    return {
      provider: 'google',
      providerId: info.sub,
      email: (info.email ?? '').toLowerCase(),
      // Вход по неподтверждённой почте — лазейка: через неё можно было бы
      // присвоить чужой аккаунт, поэтому требуем подтверждение
      emailVerified: info.email_verified === true,
      displayName: info.name ?? info.email?.split('@')[0] ?? 'Игрок',
      avatarUrl: info.picture,
    };
  }

  /**
   * Facebook: код → access_token → профиль.
   *
   * Отличия от Google, из-за которых нельзя переиспользовать тот же код:
   *   — токен берётся GET-ом с токеном в query, а не POST-ом с телом;
   *   — профиль приходит одним объектом верхнего уровня, без обёртки
   *     response[] как у ВК;
   *   — почты, скорее всего, не будет: право email требует проверки
   *     приложения, а мы её не просим. Это нормально, почта не обязательна.
   */
  private async fetchFacebookProfile(code: string): Promise<OAuthProfile> {
    const tokenUrl = `https://graph.facebook.com/${FB_GRAPH_VERSION}/oauth/access_token`
      + `?client_id=${encodeURIComponent(FACEBOOK_CLIENT_ID)}`
      + `&client_secret=${encodeURIComponent(FACEBOOK_CLIENT_SECRET)}`
      + `&redirect_uri=${encodeURIComponent(redirectUri())}`
      + `&code=${encodeURIComponent(code)}`;
    const tokenRes = await fetch(tokenUrl);
    if (!tokenRes.ok) throw this.oauthError('provider_error', 'Facebook отклонил код входа');
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
    if (!accessToken) throw this.oauthError('provider_error', 'Facebook не вернул токен');

    const infoRes = await fetch(
      `https://graph.facebook.com/${FB_GRAPH_VERSION}/me`
      + '?fields=' + encodeURIComponent('id,name,picture.width(200).height(200)')
      + `&access_token=${encodeURIComponent(accessToken)}`
    );
    if (!infoRes.ok) throw this.oauthError('provider_error', 'Не удалось получить профиль Facebook');
    const info = (await infoRes.json()) as {
      id?: string; name?: string; email?: string;
      picture?: { data?: { url?: string } };
    };
    if (!info.id) throw this.oauthError('provider_error', 'Facebook не вернул идентификатор');

    return {
      provider: 'facebook',
      providerId: info.id,
      // Почты без запрошенного права не будет. Помечаем как неподтверждённую,
      // тогда createUserFromProfile заведёт служебный адрес и не привяжет
      // аккаунт к чужой почте
      email: (info.email ?? '').toLowerCase(),
      emailVerified: false,
      displayName: info.name || `Игрок ${info.id}`,
      avatarUrl: info.picture?.data?.url,
    };
  }

  // ============================================================
  // ВХОД
  // ============================================================
  async login(provider: OAuthProvider, code: string, state: string): Promise<{
    auth: AuthResponse;
    linked: boolean;      // true — внешний вход привязан к гостю
    isNew: boolean;
  }> {
    if (!providerEnabled(provider)) {
      throw this.oauthError('provider_disabled', `${provider} вход пока не настроен`);
    }
    const st = await this.consumeState(state);
    // Не даём обменять код по чужому state: вход инициирован для другого
    if (st.provider !== provider) {
      throw this.oauthError('invalid_state', 'Провайдер не совпадает');
    }

    const profile = provider === 'google'
      ? await this.fetchGoogleProfile(code)
      : await this.fetchFacebookProfile(code);

    // 1) Этот внешний аккаунт уже привязан — пускаем
    const linkedRow = await this.db.queryOne<{ user_id: string }>(
      'SELECT user_id FROM user_identities WHERE provider = $1 AND provider_id = $2',
      [provider, profile.providerId]
    );

    let userId: string;
    let linked = false;
    let isNew = false;

    if (linkedRow && st.userId && linkedRow.user_id !== st.userId) {
      // ТУТ БЫЛА ДЫРА. Игрок уже вошёл (например, как гость) и нажал
      // «Войти через Google». Код сначала искал готовую привязку, находил
      // её — и ВХОДИЛ В ЧУЖОЙ АККАУНТ вместо привязки своего Google к
      // текущему. Игрок получал чужой персонаж и не понимал почему.
      // Теперь это явная ошибка, а не тихая смена личности.
      throw this.oauthError(
        'identity_taken',
        `Этот ${provider} уже привязан к другому аккаунту. Войдите в него напрямую`,
      );
    }

    if (linkedRow) {
      userId = linkedRow.user_id;
    } else if (st.userId) {
      // 2) Игрок вошёл как гость и сейчас привязывает внешний аккаунт.
      //    user_id остаётся прежним — прогресс не теряется.
      userId = st.userId;
      linked = true;
      await this.db.query(
        'INSERT INTO user_identities (user_id, provider, provider_id) VALUES ($1, $2, $3)',
        [userId, provider, profile.providerId]
      );
      analytics.track('guest_claimed', { via: provider }, userId);
    } else {
      // 3) Новый игрок. Создаём аккаунт по данным провайдера.
      const created = await this.createUserFromProfile(profile);
      userId = created.userId;
      isNew = true;
    }

    await this.db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);

    const user = await this.db.queryOne<{ username: string; is_guest: boolean }>(
      'SELECT username, is_guest FROM users WHERE id = $1', [userId]
    );
    if (!user) throw this.oauthError('provider_error', 'Аккаунт не найден');
    if (user.is_guest) {
      // Внешний вход по сути присваивает аккаунт: пароль не нужен,
      // так как вход будет идти через провайдера
      await this.db.query(
        'UPDATE users SET is_guest = FALSE, claimed_at = COALESCE(claimed_at, NOW()) WHERE id = $1',
        [userId]
      );
    }

    analytics.track('player_login', { via: provider, isNew, linked }, userId);
    logger.info(`[OAuth] ${provider} login: userId=${userId} new=${isNew} linked=${linked}`);

    return {
      auth: await this.newSession(userId, user.username),
      linked,
      isNew,
    };
  }

  /** Создаёт нового игрока по профилю провайдера */
  private async createUserFromProfile(profile: OAuthProfile): Promise<{ userId: string; username: string }> {
    const userId = uuidv4();
    const username = await this.pickUsername(profile);

    // Почта: подтверждённая — настоящая, иначе синтетическая. Синтетическая
    // нужна потому, что users.email NOT NULL и UNIQUE, а у ВК почты может
    // не быть вовсе.
    const serviceEmail = `${profile.provider}_${profile.providerId}@oauth.invalid`;
    let email = serviceEmail;
    if (profile.emailVerified && profile.email) {
      const taken = await this.db.queryOne('SELECT id FROM users WHERE email = $1', [profile.email]);
      if (taken) {
        // Почта уже занята чужим аккаунтом. Подставлять её нельзя: иначе
        // можно было бы войти в чужой аккаунт. Идём на служебный адрес.
        logger.warn(`[OAuth] email already taken, using service address for ${profile.providerId}`);
      } else {
        email = profile.email;
      }
    }

    await this.db.query(
      `INSERT INTO users (id, username, email, password_hash, is_guest, last_login_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, FALSE, NOW(), NOW(), NOW())`,
      // Пароль случайный: вход только через провайдера, пароля у игрока нет
      [userId, username, email, await bcrypt.hash(uuidv4() + uuidv4(), 12)]
    );
    await this.db.query(
      'INSERT INTO user_identities (user_id, provider, provider_id) VALUES ($1, $2, $3)',
      [userId, profile.provider, profile.providerId]
    );
    return { userId, username };
  }

  /** Имя игрока из профиля провайдера, приводим к допустимому виду */
  private async pickUsername(profile: OAuthProfile): Promise<string> {
    const base = profile.displayName
      .replace(/[^A-Za-zА-Яа-яЁё0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 16) || 'Player';
    for (let i = 0; i < 12; i++) {
      const name = i === 0 ? base : `${base}_${Math.floor(Math.random() * 900 + 100)}`;
      const taken = await this.db.queryOne('SELECT id FROM users WHERE username = $1', [name]);
      if (!taken) return name;
    }
    return `Player_${profile.providerId.slice(0, 8)}`;
  }

  /**
   * Сессия для внешнего входа. Отдельный метод, потому что AuthService
   * держит createSession приватным: логика одна и та же — обмен токена на
   * пару «токен в Redis + запись в user_sessions».
   */
  private async newSession(userId: string, username: string): Promise<AuthResponse> {
    const token = uuidv4();
    const ttl = 30 * 24 * 3600;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    await this.redis.setSession(token, userId, ttl);
    await this.db.query(
      `INSERT INTO user_sessions (id, user_id, token, expires_at, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW()) ON CONFLICT DO NOTHING`,
      [userId, token, expiresAt]
    );
    return { token, jwtToken: '', userId, username, expiresAt, isGuest: false };
  }

  private oauthError(code: string, message: string): Error {
    const err = new Error(message);
    (err as Error & { code: string }).code = code;
    return err;
  }
}
