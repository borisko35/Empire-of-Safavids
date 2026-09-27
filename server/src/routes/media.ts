// ============================================================
// Media Routes — Empire of Safavids
// ============================================================
// Загрузка фото и видео силами сотрудников: разработчика, админов,
// модераторов. Гостю и обычному игроку — 403.
//
// ПОЧЕМУ БЕЗ MULTIPART. Обычно загрузку файла делают формой
// multipart/form-data, для чего нужна библиотека (multer). Тут её нет,
// и ставить новую зависимость на сервере — лишний риск перед
// выкаткой. Поэтому файл принимается «как есть»: тело запроса есть
// байты файла, имя лежит в заголовке X-Filename.
//
// Для видео это даже удобнее: нет накладных расходов на разбор
// границ, нет промежуточного копирования, тело можно писать потоком.

import { Router, Request, Response } from 'express';
import express from 'express';

import { MediaService } from '../services/MediaService';
import { SITE_STAFF_ROLES } from '../middleware/adminCheck';
import { DatabaseService } from '../services/DatabaseService';
import { asyncHandler } from '../utils/asyncHandler';

export const mediaRouter = Router();
const media = new MediaService();
const db = DatabaseService.getInstance();

/**
 * Пропускает только сотрудников сайта.
 *
 * adminCheck проверяет флаг is_admin, но в базе роль хранится строкой
 * и у разработчика может быть 'developer' без флага. Поэтому здесь
 * идёт проверка по обоим признакам — так же, как это делает isSiteStaff.
 */
async function staffOnly(req: Request, res: Response, next: () => void): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }
  const row = await db.queryOne<{ is_admin: boolean; admin_role: string }>(
    'SELECT is_admin, admin_role FROM users WHERE id = $1', [req.userId],
  );
  if (!row || (!row.is_admin && !SITE_STAFF_ROLES.has(row.admin_role ?? ''))) {
    res.status(403).json({ error: 'Staff access required', code: 'admin_required' });
    return;
  }
  next();
}

/** Базовый адрес для ссылки на файл: тот же домен, что и у клиента */
function baseUrl(req: Request): string {
  return process.env.CLIENT_ORIGIN
    ?? `${req.protocol}://${req.get('host') ?? 'localhost'}`;
}

// ── Загрузка ────────────────────────────────────────────────
// Потолок выставлен с запасом сверх лимитов сервиса: отсекаем слишком
// крупные тела на входе, точную проверку делает MediaService.
mediaRouter.post(
  '/',
  staffOnly,
  express.raw({ type: '*/*', limit: '320mb' }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as Buffer | undefined;
    // Имя файла живёт в заголовке. В теле его быть не может: там байты.
    const headerName = req.get('x-filename');
    const name = decodeURIComponent(headerName ?? '').trim() || 'file';
    try {
      const saved = await media.save(
        Buffer.isBuffer(body) ? body : Buffer.alloc(0),
        name,
        req.userId,
        baseUrl(req),
      );
      return res.status(201).json({ file: saved });
    } catch (err) {
      const code = (err as Error & { code?: string }).code ?? 'upload_failed';
      const status = code === 'empty_file' || code === 'unsupported_format' || code === 'file_too_large'
        ? 400 : 500;
      return res.status(status).json({ error: (err as Error).message, code });
    }
  }),
);

// ── Список ──────────────────────────────────────────────────
mediaRouter.get('/', staffOnly, asyncHandler(async (_req: Request, res: Response) => {
  const [files, usage] = await Promise.all([media.list(), media.usage()]);
  return res.json({ files, usage });
}));

// ── Удаление ────────────────────────────────────────────────
// Удалять может любой сотрудник: файлы общие, и оставленная вчерашняя
// ошибка не должна блокировать работу остальных.
mediaRouter.delete('/:id', staffOnly, asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  // UUID проверяем до похода в базу: мусорный id — это 400, а не 500
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: 'Некорректный идентификатор', code: 'bad_id' });
  }
  const removed = await media.remove(id);
  if (!removed) return res.status(404).json({ error: 'Файл не найден', code: 'not_found' });
  return res.json({ success: true });
}));
