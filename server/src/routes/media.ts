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
 * Галерея сайта — БЕЗ авторизации.
 *
 * Это отдельный маршрут, а не способ обойти staffOnly: главную страницу
 * видят все, включая гостя и роботов поисковика, и у них нет ни токена,
 * ни прав. Такие файлы попадают в разметку страницы, поэтому специального
 * ограничения отдачи тут не нужно — ограничение в друго�� стороне: в
 * галерею попадают только опубликованные (см. MediaService.gallery).
 *
 * Отдельный Router нужен ещё и потому, что mediaRouter целиком висит под
 * /api/admin/media, и его middleware staffOnly проглатывал бы и этот путь.
 */
export const galleryRouter = Router();

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

// ── Галерея сайта (публичная) ───────────────────────────────
/**
 * Отдаём опубликованные файлы.
 *
 * limit приходит от строки запроса, поэтому берём только число и только
 * в разумных границах. Без проверки «limit=100000» посетитель главной
 * страницы вытянул бы всю таблицу одним запросом, а «limit=abc» уронил бы
 * Postgres ошибкой типа — то есть публичная страница могла бы ронять базу.
 */
galleryRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const raw = Number.parseInt(String(req.query.limit ?? ''), 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 48) : 12;
  const files = await media.gallery(limit);
  return res.json({ files });
}));

// ── Публикация на сайте ─────────────────────────────────────
/**
 * Показать файл в галерее на сайте или убрать оттуда.
 *
 * PATCH, а не POST: меняются поля существующей записи, сам файл не
 * загружается заново. Тело маленькое и в JSON, поэтому обычный
 * express.json достаточно — сырое тело нужно только для загрузки.
 */
mediaRouter.patch('/:id', staffOnly, asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: 'Некорректный идентификатор', code: 'bad_id' });
  }
  // isPublic приводим к true/false строго. Если сюда попадёт строка
  // "false", то в JS она была бы истинной, и файл опубликовался бы
  // при попытке его СНЯТЬ с публикации
  const isPublic = req.body?.isPublic === true || req.body?.isPublic === 'true';
  const caption = typeof req.body?.caption === 'string' ? req.body.caption : null;
  const updated = await media.setPublished(id, isPublic, caption);
  if (!updated) return res.status(404).json({ error: 'Файл не найден', code: 'not_found' });
  return res.json({ file: updated });
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
