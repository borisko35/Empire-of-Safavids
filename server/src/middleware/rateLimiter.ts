// ============================================================
// Rate Limiter Middleware — Empire of Safavids
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { RedisService } from '../services/RedisService';
import { logger } from '../utils/logger';

interface RateLimitOptions {
  windowMs: number;   // окно в миллисекундах
  max: number;        // макс запросов за окно
  keyPrefix: string;  // префикс ключа Redis
  message?: string;
}

export function createRateLimiter(options: RateLimitOptions) {
  const redis = RedisService.getInstance();

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip  = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = `ratelimit:${options.keyPrefix}:${ip}`;

    try {
      // Используем Redis INCR + EXPIRE
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, Math.ceil(options.windowMs / 1000));
      }

      res.setHeader('X-RateLimit-Limit', options.max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, options.max - (current ?? 0)));

      if ((current ?? 0) > options.max) {
        logger.warn(`[RateLimit] ${ip} exceeded ${options.keyPrefix}: ${current}/${options.max}`);
        res.status(429).json({
          error: options.message ?? 'Too many requests. Please slow down.',
          retryAfter: Math.ceil(options.windowMs / 1000),
        });
        return;
      }

      next();
    } catch {
      // Если Redis недоступен — пропускаем запрос (fail-open)
      next();
    }
  };
}

// Готовые пресеты
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100, // Увеличено для разработки
  keyPrefix: 'auth',
  message: 'Too many login attempts. Try again in 15 minutes.',
});

export const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 минута
  max: 120,
  keyPrefix: 'api',
});

export const auctionRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: 'auction',
  message: 'Auction rate limit exceeded.',
});

export const chatRateLimiter = createRateLimiter({
  windowMs: 5 * 1000,
  max: 5,
  keyPrefix: 'chat',
  message: 'Chat cooldown active.',
});
