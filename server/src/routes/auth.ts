// ============================================================
// Auth Routes — Empire of Safavids
// ============================================================

import { Router, Request, Response } from 'express';
import { AuthService } from '../services/AuthService';
import {
  OAuthService, providerEnabled, publicClientId, authorizeUrl,
} from '../services/OAuthService';
import { RedisService } from '../services/RedisService';
import { authRateLimiter } from '../middleware/rateLimiter';
import { authMiddleware, secureMiddleware } from '../middleware/auth';
import { AccountLinkService } from '../services/AccountLinkService';
import { asyncHandler } from '../utils/asyncHandler';
import { twoFactor } from '../services/TwoFactorService';
import { DatabaseService } from '../services/DatabaseService';
import { logger } from '../utils/logger';

export const authRouter = Router();
const authService = new AuthService();
const db = DatabaseService.getInstance();
const oauth      = new OAuthService();
const redis      = RedisService.getInstance();

// ============================================================
// POST /api/auth/register
// ============================================================
authRouter.post('/register', authRateLimiter, async (req: Request, res: Response) => {
  try {
    const result = await authService.register(req.body);
    return res.status(201).json({
      success: true,
      message: 'Аккаунт успешно создан',
      data: result,
    });
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    logger.warn(`[Auth] Register failed: ${e.message}`);
    return res.status(400).json({
      success: false,
      code: e.code ?? 'server_error',
      message: e.message,
    });
  }
});

// ============================================================
// POST /api/auth/login
// ============================================================
authRouter.post('/login', authRateLimiter, async (req: Request, res: Response) => {
  try {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const result = await authService.login(req.body, ip);
    return res.json({
      success: true,
      message: 'Вход выполнен',
      data: result,
    });
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    logger.warn(`[Auth] Login failed: ${e.message}`);
    const status = e.code === 'account_banned' ? 403 : 401;
    return res.status(status).json({
      success: false,
      code: e.code ?? 'server_error',
      message: e.message,
    });
  }
});

// ============================================================
// POST /api/auth/guest — вход без регистрации
// ============================================================
// Создаёт гостевой аккаунт и сразу выдаёт сессию. Пароль и почта не
// нужны. Аккаунт можно позже присвоить через /claim.
authRouter.post('/guest', authRateLimiter, async (req: Request, res: Response) => {
  try {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const result = await authService.guestLogin(ip);
    return res.status(201).json({
      success: true,
      message: 'Гостевой вход выполнен',
      data: result,
    });
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    logger.warn(`[Auth] Guest login failed: ${e.message}`);
    const status = e.code === 'guest_rate_limited' ? 429 : 400;
    return res.status(status).json({
      success: false,
      code: e.code ?? 'server_error',
      message: e.message,
    });
  }
});

// ============================================================
// POST /api/auth/claim — присвоение гостевого аккаунта
// ============================================================
// Игрок задаёт почту и пароль. user_id не меняется, поэтому весь
// прогресс (персонаж, уровень, вещи, квесты) сохраняется.
authRouter.post('/claim', authRateLimiter, authMiddleware, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        code: 'server_error',
        message: 'Укажите email и пароль',
      });
    }
    await authService.claim(req.userId!, String(email), String(password));
    return res.json({
      success: true,
      message: 'Аккаунт сохранён',
    });
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    logger.warn(`[Auth] Claim failed: ${e.message}`);
    return res.status(400).json({
      success: false,
      code: e.code ?? 'server_error',
      message: e.message,
    });
  }
});

// ============================================================
// GET /api/auth/oauth/config — что доступно на сервере
// ============================================================
// Возвращает только публичные client_id. Секретов в браузере не бывает:
// если бы клиент знал secret, любой мог бы подделывать вход от чужого имени.
authRouter.get('/oauth/config', async (_req: Request, res: Response) => {
  const providers = (['google', 'facebook'] as const)
    .filter((p) => providerEnabled(p))
    .map((p) => ({
      provider: p,
      clientId: publicClientId(p),
      authorizeUrl: authorizeUrl(p, 'REPLACED_BY_CLIENT'),
    }));
  return res.json({ success: true, data: { providers } });
});

// ============================================================
// POST /api/auth/oauth/start — выдать state и адрес для перехода
// ============================================================
// state живёт на сервере и одноразов: без него можно было бы подсунуть
// свой код входа и войти в чужой аккаунт.
authRouter.post('/oauth/start', authRateLimiter, async (req: Request, res: Response) => {
  const { provider } = req.body ?? {};
  if (provider !== 'google' && provider !== 'facebook') {
    return res.status(400).json({ success: false, message: 'Неизвестный способ входа' });
  }
  if (!providerEnabled(provider)) {
    return res.status(400).json({ success: false, code: 'provider_disabled', message: 'Вход пока не настроен' });
  }
  try {
    // Если игрок уже вошёл (в том числе как гость) — привяжем внешний
    // аккаунт к нему же, чтобы не потерять прогресс
    const token = req.headers.authorization?.replace('Bearer ', '');
    const currentUserId = token ? (await redis.getSession(token)) ?? undefined : undefined;
    const state = await oauth.createState(provider, currentUserId);
    return res.json({
      success: true,
      data: { provider, state, authorizeUrl: authorizeUrl(provider, state) },
    });
  } catch (err: unknown) {
    logger.warn(`[OAuth] start failed: ${(err as Error).message}`);
    return res.status(500).json({ success: false, message: 'Не удалось начать вход' });
  }
});

// ============================================================
// POST /api/auth/oauth/callback — обмен кода на сессию
// ============================================================
authRouter.post('/oauth/callback', authRateLimiter, async (req: Request, res: Response) => {
  const { provider, code, state } = req.body ?? {};
  if ((provider !== 'google' && provider !== 'facebook') || !code || !state) {
    return res.status(400).json({ success: false, message: 'Неполные данные входа' });
  }
  try {
    const result = await oauth.login(provider, code, state);
    return res.json({
      success: true,
      message: 'Вход выполнен',
      data: { ...result.auth, linked: result.linked, isNew: result.isNew },
    });
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    logger.warn(`[OAuth] callback failed: ${e.message}`);
    return res.status(400).json({
      success: false,
      code: e.code ?? 'server_error',
      message: e.message,
    });
  }
});

// ============================================================
// POST /api/auth/logout
// ============================================================
authRouter.post('/logout', authMiddleware, async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') ?? '';
    await authService.logout(token, req.userId!);
    return res.json({ success: true, message: 'Выход выполнен' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Ошибка выхода' });
  }
});

// ============================================================
// POST /api/auth/logout-all
// ============================================================
authRouter.post('/logout-all', authMiddleware, async (req: Request, res: Response) => {
  try {
    await authService.logoutAll(req.userId!);
    return res.json({ success: true, message: 'Выход со всех устройств выполнен' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Ошибка' });
  }
});

// ============================================================
// GET /api/auth/me
// ============================================================
authRouter.get('/me', secureMiddleware, async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') ?? '';
    const user  = await authService.validateSession(token);
    if (!user) return res.status(401).json({ success: false, message: 'Сессия недействительна' });
    return res.json({ success: true, data: user });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// ============================================================
// ПРИВЯЗКА АККАУНТА
// ============================================================
// Аккаунт должен давать больше одного способа войти: игрок, зашедший по
// Google, иначе не сможет ни задать пароль, ни выйти из аккаунта.

// GET /api/auth/identities — какие способы входа привязаны
authRouter.get('/identities', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const info = await new AccountLinkService().getInfo(req.userId!);
  return res.json(info);
}));

// POST /api/auth/identities/email — добавить вход по почте и паролю
authRouter.post('/identities/email', secureMiddleware, authRateLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Укажите почту и пароль', code: 'missing_fields' });
  }
  await new AccountLinkService().addEmailLogin(req.userId!, String(email), String(password));
  return res.json({ success: true, message: 'Вход по почте добавлен' });
}));

// POST /api/auth/identities/:provider/unlink — отвязать Google или Facebook
// Последний способ входа отвязать нельзя: иначе доступ к персонажу пропадёт
authRouter.post('/identities/:provider/unlink', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const provider = String(req.params.provider);
  if (provider !== 'google' && provider !== 'facebook') {
    return res.status(400).json({ error: 'Неизвестный способ входа', code: 'bad_provider' });
  }
  await new AccountLinkService().unlink(req.userId!, provider);
  return res.json({ success: true, message: 'Способ входа отвязан' });
}));

// ============================================================
// POST /api/auth/change-password
// ============================================================
authRouter.post('/change-password', secureMiddleware, async (req: Request, res: Response) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Укажите старый и новый пароль' });
    }
    await authService.changePassword(req.userId!, oldPassword, newPassword);
    return res.json({ success: true, message: 'Пароль успешно изменён' });
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    return res.status(400).json({ success: false, code: e.code, message: e.message });
  }
});

// ============================================���===================
// Второй фактор (TOTP)
// ============================================================
// Маршруты требуют сессии: включить или выключить второй фактор может только
// тот, кто уже вошёл.
//
// ПОРЯДОК ВКЛЮЧЕНИЯ. begin -> код из телефона -> confirm. Между ними 2FA
// выдан, но НЕ действует (enabled = false). Иначе игрок, закрывший вкладку
// на втором шаге, остался бы с включённым вторым фактором и без входа, а
// починить это можно было бы только правкой базы.
//
// СЕКРЕТ И КОДЫ ВОССТАНОВЛЕНИЯ ОТДАЮТСЯ ОДИН РАЗ. В базе лежит шифротекст
// секрета и хэши кодов, а открытые значения игрок видит только сейчас. Если
// потеряет - придётся выключать и включать заново.
authRouter.get('/2fa/status', secureMiddleware, async (req: Request, res: Response) => {
  try {
    const статус = await twoFactor().статус(req.userId!);
    return res.json({ success: true, ...статус, ...twoFactor().параметры });
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    return res.status(503).json({ success: false, code: 'two_factor_unavailable', message: e.message });
  }
});

authRouter.post('/2fa/begin', secureMiddleware, authRateLimiter, async (req: Request, res: Response) => {
  try {
    const строка = await db.queryOne<{ email: string }>(
      'SELECT email FROM users WHERE id = $1', [req.userId!]);
    if (!строка) return res.status(404).json({ success: false, code: 'user_not_found' });
    const начали = await twoFactor().начать(req.userId!, строка.email);
    return res.json({
      success: true,
      secret: начали.secret,
      otpauthUrl: начали.otpauthUrl,
      recoveryCodes: начали.recoveryCodes,
      ...twoFactor().параметры,
    });
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    return res.status(503).json({ success: false, code: 'two_factor_unavailable', message: e.message });
  }
});

authRouter.post('/2fa/confirm', secureMiddleware, authRateLimiter, async (req: Request, res: Response) => {
  try {
    const код = String(req.body?.code ?? '');
    const р = await twoFactor().подтвердить(req.userId!, код);
    if (!р.ok) {
      return res.status(400).json({ success: false, code: р.code });
    }
    return res.json({ success: true });
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    return res.status(503).json({ success: false, code: 'two_factor_unavailable', message: e.message });
  }
});

authRouter.post('/2fa/disable', secureMiddleware, authRateLimiter, async (req: Request, res: Response) => {
  try {
    // Требуется верный код. Иначе достаточно украсть сессию, чтобы снять
    // защиту с чужого аккаунта - то есть второй фактор защищал бы от
    // угона пароля и не защищал бы от угона сессии.
    const р = await twoFactor().выключить(req.userId!, String(req.body?.code ?? ''));
    if (!р.ok) {
      const статус = Number(р.code === 'two_factor_locked') ? 429 : 400;
      return res.status(статус).json({ success: false, code: р.code });
    }
    return res.json({ success: true });
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    return res.status(503).json({ success: false, code: 'two_factor_unavailable', message: e.message });
  }
});

authRouter.post('/2fa/recovery-codes', secureMiddleware, authRateLimiter, async (req: Request, res: Response) => {
  try {
    const р = await twoFactor().проверитьКод(req.userId!, String(req.body?.code ?? ''));
    if (!р.ok) {
      return res.status(400).json({ success: false, code: р.code });
    }
    const коды = await twoFactor().перевыпуститьКоды(req.userId!);
    return res.json({ success: true, recoveryCodes: коды });
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    return res.status(503).json({ success: false, code: 'two_factor_unavailable', message: e.message });
  }
});

// ============================================================
// POST /api/auth/reset-password — сброс пароля (dev)
// ============================================================
authRouter.post('/reset-password', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Укажите email и новый пароль' });
  }
  try {
    await authService.resetPassword(email, password);
    return res.json({ success: true, message: 'Пароль успешно сброшен' });
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    return res.status(400).json({ success: false, code: e.code, message: e.message });
  }
});

// ============================================================
// GET /api/auth/check-username/:username
// ============================================================
authRouter.get('/check-username/:username', async (req: Request, res: Response) => {
  const { username } = req.params;
  if (!username || username.length < 3 || username.length > 20) {
    return res.json({ available: false });
  }
  const available = await authService.isUsernameAvailable(username);
  return res.json({ available });
});

// ============================================================
// GET /api/auth/check-email/:email
// ============================================================
authRouter.get('/check-email/:email', async (req: Request, res: Response) => {
  const { email } = req.params;
  const available = await authService.isEmailAvailable(email);
  return res.json({ available });
});

// ============================================================
// POST /api/auth/reset-rate-limit — сброс rate limiter (dev)
// ============================================================
authRouter.post('/reset-rate-limit', async (_req: Request, res: Response) => {
  try {
    await authService.resetRateLimit('127.0.0.1');
    await authService.resetRateLimit('localhost');
    await authService.resetRateLimit('::1');
    return res.json({ success: true, message: 'Rate limit сброшен' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
