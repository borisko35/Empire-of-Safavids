import { Request, Response, NextFunction } from 'express';
import { RedisService } from '../services/RedisService';
import { DatabaseService } from '../services/DatabaseService';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const redis = RedisService.getInstance();
const db = DatabaseService.getInstance();

const BAN_CACHE_TTL = 300;

/** Основное middleware: проверка валидности сессии */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const userId = await redis.getSession(token);
  if (!userId) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  req.userId = userId;
  next();
}

/**
 * Опциональная аутентификация: заполняет req.userId, если токен передан
 * и валиден, но НЕ блокирует запрос без токена.
 *
 * Нужна публичным GET-роутам, которым всё равно нужно знать, кто смотрит:
 * форум отдаёт isAuthor/canModerate и не считает просмотр автору темы.
 * Без неё req.userId на чтении остаётся undefined и автор перестаёт
 * быть автором (кнопка «Отметить решение» пропадала даже у владельца).
 *
 * Любой сбой трактуем как анонимный запрос: чтение важнее аутентификации.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    next();
    return;
  }
  try {
    const userId = await redis.getSession(token);
    if (userId) req.userId = userId;
  } catch {
    // токен не разобрался / redis недоступен — остаёмся анонимом
  }
  next();
}

/** Middleware: блокирует доступ забаненным пользователям */
export async function bannedCheck(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  try {
    const cachedBan = await redis.get(`user:banned:${req.userId}`);
    if (cachedBan === '1') {
      res.status(403).json({ error: 'Account is banned', code: 'account_banned' });
      return;
    }

    const row = await db.queryOne<{ is_banned: boolean }>(
      'SELECT is_banned FROM users WHERE id = $1', [req.userId]
    );
    if (row?.is_banned) {
      await redis.set(`user:banned:${req.userId}`, '1', BAN_CACHE_TTL);
      res.status(403).json({ error: 'Account is banned', code: 'account_banned' });
      return;
    }

    await redis.del(`user:banned:${req.userId}`);
    next();
  } catch {
    next();
  }
}

/** Верифицированный доступ: auth + banned check */
export async function secureMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  await authMiddleware(req, res, async () => {
    await bannedCheck(req, res, next);
  });
}
