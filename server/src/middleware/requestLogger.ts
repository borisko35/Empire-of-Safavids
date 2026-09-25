// ============================================================
// Request Logger Middleware — Empire of Safavids
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

const SKIP_PATHS = ['/health', '/locales', '/game/', '/api/game/servers'];

/** Мiddleware: логирование каждого HTTP-запроса */
export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  const start = Date.now();
  const skip = SKIP_PATHS.some(p => req.path.startsWith(p));

  if (skip) {
    next();
    return;
  }

  _res.on('finish', () => {
    const duration = Date.now() - start;
    const level = _res.statusCode >= 500 ? 'error'
      : _res.statusCode >= 400 ? 'warn'
      : 'info';
    logger[level](`${req.method} ${req.path} ${_res.statusCode} ${duration}ms`, {
      ip: req.ip ?? 'unknown',
      userId: (req as unknown as { userId?: string }).userId,
    });
  });

  next();
}

/** Мiddleware: принудительно JSON ответ для API-роутов */
export function apiOnly(req: Request, _res: Response, next: NextFunction): void {
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }
  // Убедимся что Content-Type = JSON
  if (!_res.get('Content-Type')?.includes('application/json')) {
    _res.setHeader('Content-Type', 'application/json');
  }
  next();
}
