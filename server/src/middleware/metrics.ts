// Сбор метрик с каждого HTTP-запроса.
//
// Метрики собираются по событию 'finish' у ответа, а не сразу после
// обработчика: пока ответ не отправлен, запрос ещё не завершён, и время
// ответа неизвестно. Считать «на входе» - значит занижать быстродействие
// всегда.
//
// Время берётся из process.hrtime.bigint(), а не из Date.now(): системные
// часы умеют прыгать (NTP, правка времени вручную, смена часового пояса),
// и на часах прыжок дал бы отрицательное время ответа.
import type { RequestHandler } from 'express';
import { metrics, routeLabel, statusClass } from '../metrics';

/**
 * Запись одного запроса. Вынесена отдельно, чтобы её можно было проверить
 * без поднятия сервера: поднимать HTTP ради проверки счётчика дорого, а
 * проверить надо, что подпись приводится к шаблону и что 5xx не смешивается
 * с 2xx.
 */
export function recordRequest(options: {
  path: string;
  method: string;
  status: number;
  seconds: number;
}): void {
  const labels = {
    route: routeLabel(options.path),
    method: options.method,
    status: statusClass(options.status),
  };
  metrics.count('eos_http_requests_total', 'HTTP-запросы по маршруту и классу кода', labels);
  metrics.observe('eos_http_request_duration_seconds', 'Время обработки HTTP-запроса, секунды', options.seconds, {
    route: labels.route,
  });
}

/** Средний middleware. Ставится ДО маршрутов, иначе ничего не увидит. */
export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    recordRequest({ path: req.originalUrl || req.url, method: req.method, status: res.statusCode, seconds });
  });
  next();
};
