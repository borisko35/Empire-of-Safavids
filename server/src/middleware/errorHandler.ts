// ============================================================
// Error Handling Middleware — Empire of Safavids
// ============================================================
// Централизованный обработчик ошибок: последний middleware
// в цепочке Express. Ловит все необработанные ошибки.

import { Request, Response, ErrorRequestHandler } from 'express';
import { logger } from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

/** Универсальный обработчик ошибок */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const statusCode = (err as AppError).statusCode ?? 500;
  const code = (err as AppError).code ?? 'internal_error';
  const message = err.message || 'Internal Server Error';

  logger.error(`[Error] ${statusCode} ${code}: ${message}`, {
    stack: err.stack,
    path: _req.path,
    method: _req.method,
  });

  const isDev = process.env.NODE_ENV !== 'production';

  // Ошибка СЕРВЕРА не показывается игроку. Настоящее сообщение уже в
  // журнале строкой выше; в теле ответа оно было сырым SQL - «column
  // reference \"reset_date\" is ambiguous» уходило игроку вместе с именем
  // таблицы и колонки.
  //
  // Ошибка КЛИЕНТА (4xx) не трогается: её message написан руками и по
  // нему клиент рисует подсказку. Убирать его - значит сломать интерфейс
  // там, где он работает.
  const виднаИгроку = statusCode < 500;

  res.status(statusCode).json({
    success: false,
    code,
    message: виднаИгроку ? message : 'Внутренняя ошибка. Попробуйте позже.',
    ...(виднаИгроку && isDev && { stack: err.stack }),
  });
};

/** 404 — маршрут не найден */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ success: false, code: 'not_found', message: 'Route not found' });
}

/** Обработчик невалидного JSON в теле запроса */
export const badJsonHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ success: false, code: 'invalid_json', message: 'Invalid JSON body' });
    return;
  }
  next(err);
};


