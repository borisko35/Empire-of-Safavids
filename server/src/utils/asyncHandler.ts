// ============================================================
// Обёртка асинхронных маршрутов — Empire of Safavids
// ============================================================

import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Express 4 не перехватывает исключения из async-обработчиков:
 * без обёртки ошибка в БД/Redis роняет процесс.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Единый формат ответа об ошибке для REST API.
 */
export function errorResponse(res: Response, err: unknown, status = 400): Response {
  const message = err instanceof Error ? err.message : 'Unknown error';
  return res.status(status).json({ success: false, error: message });
}
