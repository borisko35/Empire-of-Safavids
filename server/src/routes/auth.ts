// ============================================================
// Auth Routes — Empire of Safavids
// ============================================================

import { Router, Request, Response } from 'express';
import { AuthService } from '../services/AuthService';
import { authRateLimiter } from '../middleware/rateLimiter';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';

export const authRouter = Router();
const authService = new AuthService();

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
authRouter.get('/me', authMiddleware, async (req: Request, res: Response) => {
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
// POST /api/auth/change-password
// ============================================================
authRouter.post('/change-password', authMiddleware, async (req: Request, res: Response) => {
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
