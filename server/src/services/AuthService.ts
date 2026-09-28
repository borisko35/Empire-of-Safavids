// ============================================================
// Auth Service (Server) — Empire of Safavids
// ============================================================

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './DatabaseService';
import { RedisService } from './RedisService';
import { analytics } from './AnalyticsService';
import { logger } from '../utils/logger';
import { RegisterRequest, LoginRequest, AuthResponse, AuthUser, AuthError } from '../../../shared/auth.types';
import { validateRegister, validateLogin } from '../../../shared/auth.validation';

const JWT_SECRET      = process.env.JWT_SECRET ?? 'safavid-secret-key';
const SESSION_TTL_7D  = 7 * 24 * 3600;   // 7 дней в секундах
const SESSION_TTL_30D = 30 * 24 * 3600;  // 30 дней («запомнить меня»)
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES    = 15;
// Гостевой вход: сколько гостей один IP может создать за сутки.
// Без предела через гостевую дверь можно наделать сколько угодно
// аккаунтов — и обойти бан по аккаунту, и набить базу мусором.
const MAX_GUESTS_PER_IP  = 5;
const GUEST_WINDOW_SEC   = 24 * 3600;

/**
 * Поле формы регистрации -> код ошибки для клиента.
 *
 * validateRegister проверяет девять вещей, а отдавать можно было один код на
 * все случаи. Клиент показывает текст по коду (screens/auth.ts ищет
 * errors.<code>), поэтому без этой таблицы половина сообщений была бы
 * непроизносимой, а игрок получал бы «пароль слишком простой» вместо
 * «вы несовершеннолетний».
 *
 * agreeToPrivacy отдаётся как terms_not_accepted: отдельного ключа нет, а
 * текст «примите правила» верен для обоих чекбоксов.
 */
const REGISTER_ERROR_CODES: Record<string, AuthError> = {
  username: 'username_invalid',
  email: 'email_invalid',
  password: 'weak_password',
  confirmPassword: 'password_mismatch',
  birthYear: 'underage',
  agreeToTerms: 'terms_not_accepted',
  agreeToPrivacy: 'terms_not_accepted',
};

export class AuthService {
  private db           = DatabaseService.getInstance();
  private redis        = RedisService.getInstance();

  // ============================================================
  // РЕГИСТРАЦИЯ
  // ============================================================
  async register(data: RegisterRequest): Promise<AuthResponse> {
    // Валидация
    //
    // ЧТО БЫЛО. Карта ошибок сворачивалась в один код weak_password, и игрок
    // получал «Пароль слишком простой (мин 8 символов)» на ЛЮБУЮ проблему:
    // на занятый ник, на неверный email, на несовершеннолетие, на
    // непроставленную галочку. Коды underage и terms_not_accepted были
    // написаны во всех трёх переводах и не отдавались сервером никогда.
    const { valid, errors } = validateRegister(data);
    if (!valid) {
      const [field] = Object.keys(errors);
      throw this.authError(REGISTER_ERROR_CODES[field] ?? 'weak_password', errors[field]);
    }

    // Проверка уникальности
    const existingEmail = await this.db.queryOne(
      'SELECT id FROM users WHERE email = $1', [data.email.toLowerCase()]
    );
    if (existingEmail) throw this.authError('email_taken');

    const existingUsername = await this.db.queryOne(
      'SELECT id FROM users WHERE username = $1', [data.username]
    );
    if (existingUsername) throw this.authError('username_taken');

    // Хэширование пароля
    const passwordHash = await bcrypt.hash(data.password, 12);
    const userId = uuidv4();

    await this.db.query(
      `INSERT INTO users (id, username, email, password_hash, has_password, created_at, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())`,
      [userId, data.username, data.email.toLowerCase(), passwordHash]
    );

    analytics.track('player_login', { username: data.username, registration: true }, userId);
    logger.info(`[Auth] New user registered: ${data.username} (${userId})`);

    // Автоматический вход после регистрации
    return this.createSession(userId, data.username, false);
  }

  // ============================================================
  // ГОСТЕВОЙ ВХОД
  // ============================================================
  /**
   * Создаёт гостевой аккаунт в один клик — без email и пароля.
   *
   * Зачем: это самая большая дыра в воронке. Человек пришёл по ссылке,
   * увидел форму регистрации (имя, почта, пароль, два согласия, год
   * рождения) и закрыл вкладку. Здесь между «заинтересовался» и «играет»
   * стоит стена. Гость играет сразу, а аккаунт можно присвоить позже —
   * user_id не меняется, поэтому весь прогресс сохраняется.
   *
   * Ограничение по IP обязательно: иначе через гостевой вход можно
   * наделать сколько угодно аккаунтов (и обойти бан по аккаунту).
   */
  async guestLogin(ip: string): Promise<AuthResponse> {
    const key = `auth:guests:${ip}`;
    const count = parseInt((await this.redis.get(key)) ?? '0');
    if (count >= MAX_GUESTS_PER_IP) {
      throw this.authError('guest_rate_limited',
        `С этого адреса уже создано ${count} гостевых аккаунтов`);
    }
    await this.redis.incr(key);
    await this.redis.expire(key, GUEST_WINDOW_SEC);

    const userId = uuidv4();
    const username = await this.pickGuestUsername();
    // .invalid — домен, который нельзя зарегистрировать (RFC 2606),
    // поэтому такой адрес физически не может совпасть с чужим
    const email = `guest_${userId}@guest.invalid`;
    // Хэш случайного пароля: войти в гостя по паролю невозможно,
    // но колонка NOT NULL satisfied и код логина не меняется
    const passwordHash = await bcrypt.hash(uuidv4() + uuidv4(), 12);

    await this.db.query(
      `INSERT INTO users (id, username, email, password_hash, is_guest, last_login_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW(), NOW())`,
      [userId, username, email, passwordHash]
    );

    analytics.track('guest_login', { ip }, userId);
    logger.info(`[Auth] Guest created: ${username} from ${ip}`);

    const session = await this.createSession(userId, username, true);
    return { ...session, isGuest: true };
  }

  /**
   * Присвоение гостевого аккаунта: игрок задаёт email и пароль.
   * user_id остаётся прежним, поэтому персонаж, вещи, уровень,
   * квесты и всё остальное сохраняется.
   */
  async claim(userId: string, email: string, password: string): Promise<void> {
    const user = await this.db.queryOne<{ is_guest: boolean }>(
      'SELECT is_guest FROM users WHERE id = $1', [userId]
    );
    if (!user) throw this.authError('user_not_found');
    if (!user.is_guest) throw this.authError('already_claimed');

    if (password.length < 8) throw this.authError('weak_password');

    const emailTaken = await this.db.queryOne(
      'SELECT id FROM users WHERE email = $1', [email.toLowerCase()]
    );
    if (emailTaken) throw this.authError('email_taken');

    const passwordHash = await bcrypt.hash(password, 12);
    await this.db.query(
      `UPDATE users SET email = $1, password_hash = $2, has_password = TRUE, is_guest = FALSE,
              claimed_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [email.toLowerCase(), passwordHash, userId]
    );

    analytics.track('guest_claimed', { ip: 'self' }, userId);
    logger.info(`[Auth] Guest claimed: userId=${userId}`);
  }

  /** Подбирает свободное имя вида Гость_4821 (в users.username 20 символов) */
  private async pickGuestUsername(): Promise<string> {
    for (let i = 0; i < 12; i++) {
      const n = Math.floor(1000 + Math.random() * 9000);
      const name = `Гость_${n}`;
      const taken = await this.db.queryOne(
        'SELECT id FROM users WHERE username = $1', [name]
      );
      if (!taken) return name;
    }
    // Крайне маловероятный случай: добавляем счётчик к id
    return `Гость_${uuidv4().slice(0, 8)}`;
  }

  // ============================================================
  // ВХОД
  // ============================================================
  async login(data: LoginRequest, ip: string): Promise<AuthResponse> {
    const { valid } = validateLogin(data);
    if (!valid) throw this.authError('invalid_credentials');

    // Проверка блокировки по IP
    await this.checkRateLimit(ip);

    const user = await this.db.queryOne<{
      id: string; username: string; password_hash: string;
      is_banned: boolean; ban_reason: string | null; ban_until: Date | null;
    }>(
      'SELECT id, username, password_hash, is_banned, ban_reason, ban_until FROM users WHERE email = $1',
      [data.email.toLowerCase()]
    );

    if (!user) {
      await this.incrementFailedAttempts(ip);
      throw this.authError('invalid_credentials');
    }

    const passwordOk = await bcrypt.compare(data.password, user.password_hash);
    if (!passwordOk) {
      await this.incrementFailedAttempts(ip);
      throw this.authError('invalid_credentials');
    }

    // Проверка бана
    if (user.is_banned) {
      const banUntil = user.ban_until ? new Date(user.ban_until) : null;
      if (!banUntil || banUntil > new Date()) {
        throw this.authError('account_banned', user.ban_reason ?? undefined);
      }
      // Бан истёк — разблокируем
      await this.db.query(
        'UPDATE users SET is_banned = FALSE, ban_reason = NULL, ban_until = NULL WHERE id = $1',
        [user.id]
      );
    }

    // Сбрасываем счётчик неудачных попыток
    await this.resetFailedAttempts(ip);

    // Обновляем last_login_at
    await this.db.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]
    );

    analytics.track('player_login', { ip }, user.id);
    logger.info(`[Auth] Login: ${user.username} from ${ip}`);

    return this.createSession(user.id, user.username, data.rememberMe);
  }

  // ============================================================
  // ВЫХОД
  // ============================================================
  async logout(token: string, userId: string): Promise<void> {
    await this.redis.deleteSession(token);
    // Удаляем все активные сокет-соединения
    await this.redis.publish('auth:logout', { userId, token });
    analytics.track('player_logout', {}, userId);
    logger.info(`[Auth] Logout: userId=${userId}`);
  }

  // ============================================================
  // ВЫХОД СО ВСЕХ УСТРОЙСТВ
  // ============================================================
  async logoutAll(userId: string): Promise<void> {
    // Удаляем все сессии пользователя
    const sessions = await this.db.query<{ token: string }>(
      'SELECT token FROM user_sessions WHERE user_id = $1', [userId]
    );
    for (const s of sessions) {
      await this.redis.deleteSession(s.token);
    }
    await this.db.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
    await this.redis.publish('auth:logout_all', { userId });
    logger.info(`[Auth] Logout all devices: userId=${userId}`);
  }

  // ============================================================
  // ПРОВЕРКА СЕССИИ
  // ============================================================
  async validateSession(token: string): Promise<AuthUser | null> {
    const userId = await this.redis.getSession(token);
    if (!userId) return null;

    const user = await this.db.queryOne<{
      id: string; username: string; email: string;
      is_banned: boolean; ban_reason: string | null; ban_until: Date | null;
      is_admin: boolean; admin_role: string | null; is_guest: boolean;
      created_at: Date; last_login_at: Date;
    }>(
      'SELECT id, username, email, is_banned, ban_reason, ban_until, is_admin, admin_role, is_guest, created_at, last_login_at FROM users WHERE id = $1',
      [userId]
    );
    if (!user) return null;

    // Проверка бана
    if (user.is_banned) {
      const banUntil = user.ban_until ? new Date(user.ban_until) : null;
      if (!banUntil || banUntil > new Date()) {
        await this.redis.deleteSession(token);
        return null;
      }
    }

    const premiumRow = await this.db.queryOne<{ expires_at: Date }>(
      'SELECT expires_at FROM premium_subscriptions WHERE user_id = $1 AND expires_at > NOW()',
      [userId]
    );

    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      isPremium: !!premiumRow,
      isAdmin: !!user.is_admin,
      adminRole: user.admin_role ?? 'gm',
      isBanned: user.is_banned,
      banReason: user.ban_reason ?? undefined,
      banUntil: user.ban_until ? new Date(user.ban_until) : undefined,
      isGuest: user.is_guest,
      createdAt: new Date(user.created_at),
      lastLoginAt: new Date(user.last_login_at),
    };
  }

  // ============================================================
  // СМЕНА ПАРОЛЯ
  // ============================================================
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = await this.db.queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1', [userId]
    );
    if (!user) throw this.authError('user_not_found');

    const ok = await bcrypt.compare(oldPassword, user.password_hash);
    if (!ok) throw this.authError('invalid_credentials');

    if (newPassword.length < 8) throw this.authError('weak_password');

    const newHash = await bcrypt.hash(newPassword, 12);
    await this.db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newHash, userId]
    );

    // Инвалидируем все сессии
    await this.logoutAll(userId);
    logger.info(`[Auth] Password changed: userId=${userId}`);
  }

  // ============================================================
  // ВНУТРЕННИЕ МЕТОДЫ
  // ============================================================
  private async createSession(
    userId: string,
    username: string,
    rememberMe: boolean
  ): Promise<AuthResponse> {
    const token = uuidv4();
    const ttl   = rememberMe ? SESSION_TTL_30D : SESSION_TTL_7D;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    await this.redis.setSession(token, userId, ttl);

    // Сохраняем сессию в БД для logoutAll
    await this.db.query(
      `INSERT INTO user_sessions (id, user_id, token, expires_at, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW())
       ON CONFLICT DO NOTHING`,
      [userId, token, expiresAt]
    );

    const jwtToken = jwt.sign(
      { userId, username },
      JWT_SECRET,
      { expiresIn: rememberMe ? '30d' : '7d' }
    );

    return { token, jwtToken, userId, username, expiresAt };
  }

  private async checkRateLimit(ip: string): Promise<void> {
    const key = `auth:attempts:${ip}`;
    const attempts = await this.redis.get(key);
    if (attempts && parseInt(attempts) >= MAX_LOGIN_ATTEMPTS) {
      throw this.authError('invalid_credentials',
        `Слишком много попыток. Подождите ${LOCKOUT_MINUTES} минут`
      );
    }
  }

  private async incrementFailedAttempts(ip: string): Promise<void> {
    const key = `auth:attempts:${ip}`;
    await this.redis.incr(key);
    await this.redis.expire(key, LOCKOUT_MINUTES * 60);
  }

  private async resetFailedAttempts(ip: string): Promise<void> {
    await this.redis.del(`auth:attempts:${ip}`);
  }

  /** Сброс счётчика попыток (для разработчика) */
  async resetRateLimit(ip: string): Promise<void> {
    await this.redis.del(`auth:attempts:${ip}`);
  }

  // ============================================================
  // ПРОВЕРКА УНИКАЛЬНОСТИ (для REST-роутов)
  // ============================================================
  async isUsernameAvailable(username: string): Promise<boolean> {
    const existing = await this.db.queryOne(
      'SELECT id FROM users WHERE username = $1', [username]
    );
    return !existing;
  }

  async isEmailAvailable(email: string): Promise<boolean> {
    const existing = await this.db.queryOne(
      'SELECT id FROM users WHERE email = $1', [email.toLowerCase()]
    );
    return !existing;
  }

  // ============================================================
  // СБРОС ПАРОЛЯ (для разработчика)
  // ============================================================
  async resetPassword(email: string, newPassword: string): Promise<void> {
    const user = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE email = $1', [email.toLowerCase()]
    );
    if (!user) throw this.authError('user_not_found');
    const newHash = await bcrypt.hash(newPassword, 12);
    await this.db.query(
      'UPDATE users SET password_hash = $1, has_password = TRUE, updated_at = NOW() WHERE id = $2',
      [newHash, user.id]
    );
    logger.info(`[Auth] Password reset for: ${email}`);
  }

  private authError(code: AuthError, message?: string): Error {
    const err = new Error(message ?? code);
    (err as Error & { code: string }).code = code;
    return err;
  }
}
