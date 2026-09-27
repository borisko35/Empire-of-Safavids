// ============================================================
// Feedback Routes — Empire of Safavids
// ============================================================
// Форма на /feedback.html, очередь обращений — в /admin.html.
//
// POST  /api/feedback           — отправить обращение   [auth]
// GET   /api/feedback           — очередь               [персонал]
// PATCH /api/feedback/:id       — статус и/или ответ    [персонал]
//
// Защита от спама: не больше 5 обращений от одного аккаунта в час.

import { Router, Request, Response } from 'express';
import { secureMiddleware } from '../middleware/auth';
import { apiRateLimiter } from '../middleware/rateLimiter';
import { isSiteStaff } from '../middleware/adminCheck';
import { asyncHandler } from '../utils/asyncHandler';
import { DatabaseService } from '../services/DatabaseService';

export const feedbackRouter = Router();

const db = DatabaseService.getInstance();

const MAX_BODY = 2000;
const MIN_BODY = 10;
const MAX_REPLY = 2000;
const RATE_LIMIT = 5;
const RATE_WINDOW_HOURS = 1;

const CATEGORIES = new Set(['bug', 'idea', 'balance', 'donation', 'account', 'other']);
const STATUSES = new Set(['new', 'read', 'closed']);

interface FeedbackRow {
  id: string;
  user_id: string | null;
  category: string;
  message: string;
  status: string;
  reply: string | null;
  replied_at: Date | null;
  created_at: Date;
  handled_at: Date | null;
  author_name?: string;
}

function dto(r: FeedbackRow) {
  return {
    id: r.id,
    category: r.category,
    message: r.message,
    status: r.status,
    reply: r.reply ?? null,
    repliedAt: r.replied_at ?? null,
    authorId: r.user_id,
    authorName: r.author_name ?? 'Аноним',
    createdAt: r.created_at,
    handledAt: r.handled_at,
  };
}

// ── Отправить обращение ─────────────────────────────────────
feedbackRouter.post('/', apiRateLimiter, secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const category = String(req.body?.category ?? 'other');
  const message = String(req.body?.message ?? '').trim();

  if (!CATEGORIES.has(category)) {
    return res.status(400).json({ error: 'Неизвестная категория обращения' });
  }
  if (message.length < MIN_BODY) {
    return res.status(400).json({ error: `Опиши проблему подробнее — минимум ${MIN_BODY} символов` });
  }
  if (message.length > MAX_BODY) {
    return res.status(400).json({ error: `Не длиннее ${MAX_BODY} символов` });
  }

  // Антиспам: не чаще RATE_LIMIT обращений за час
  const recent = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM feedback
     WHERE user_id = $1 AND created_at > NOW() - INTERVAL '${RATE_WINDOW_HOURS} hour'`,
    [req.userId],
  ).catch(() => null);
  if (recent && Number(recent.count) >= RATE_LIMIT) {
    return res.status(429).json({ error: 'Слишком часто. Попробуйте позже.' });
  }

  const row = await db.queryOne<{ id: string }>(
    'INSERT INTO feedback (user_id, category, message) VALUES ($1, $2, $3) RETURNING id',
    [req.userId, category, message],
  );

  return res.status(201).json({ success: true, id: row?.id });
}));

// ── Мои обращения (видит только автор) ──────────────────────
feedbackRouter.get('/mine', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const rows = await db.query<FeedbackRow>(
    `SELECT f.*, COALESCE(u.username, 'Аноним') AS author_name
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.user_id = $1
     ORDER BY f.created_at DESC
     LIMIT 50`,
    [req.userId],
  );
  return res.json({ items: rows.map(dto) });
}));

// ── Очередь обращений ───────────────────────────────────────
feedbackRouter.get('/', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  if (!(await isSiteStaff(req.userId))) {
    return res.status(403).json({ error: 'Требуются права модератора' });
  }

  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const params: unknown[] = [];
  let whereSql = '';
  if (status && STATUSES.has(status)) {
    params.push(status);
    whereSql = `WHERE f.status = $${params.length}`;
  }

  const rows = await db.query<FeedbackRow>(`
    SELECT f.*, COALESCE(u.username, 'Аноним') AS author_name
    FROM feedback f
    LEFT JOIN users u ON u.id = f.user_id
    ${whereSql}
    ORDER BY f.created_at DESC
    LIMIT 200
  `, params);

  const counts = await db.query<{ status: string; count: number }>(
    'SELECT status, COUNT(*)::int AS count FROM feedback GROUP BY status',
  );

  return res.json({
    items: rows.map(dto),
    counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.count)] as const)),
  });
}));

// ── Смена статуса и/или ответ ───────────────────────────────
// Оба поля необязательны, но хотя бы одно обязано прийти:
//   {status:'read'}      — только статус (как раньше)
//   {reply:'текст'}      — записать ответ команды
//   {reply:''}           — убрать ответ
feedbackRouter.patch('/:id', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  if (!(await isSiteStaff(req.userId))) {
    return res.status(403).json({ error: 'Требуются права модератора' });
  }

  const rawStatus = req.body?.status;
  const rawReply = req.body?.reply;
  const hasStatus = rawStatus !== undefined && rawStatus !== null && String(rawStatus).length > 0;
  const hasReply = rawReply !== undefined && rawReply !== null;

  if (!hasStatus && !hasReply) {
    return res.status(400).json({ error: 'Передай статус или ответ' });
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (hasStatus) {
    const status = String(rawStatus);
    if (!STATUSES.has(status)) {
      return res.status(400).json({ error: 'Статус: new | read | closed' });
    }
    params.push(status);
    sets.push(`status = $${params.length}`);
    params.push(req.userId);
    sets.push(`handled_by = $${params.length}`);
    // Ключ статуса подставляем ТОЛЬКО в status = $n. Повторять его в
    // "CASE WHEN $n = 'new'" нельзя: PostgreSQL выведет для одного параметра
    // два типа — varchar из колонки и text из литерала — и запрос упадёт с
    // "inconsistent types deduced for parameter $1". Флаг считаем в JS.
    sets.push(status === 'new' ? 'handled_at = NULL' : 'handled_at = NOW()');
  }

  if (hasReply) {
    const text = String(rawReply).trim();
    if (text.length > MAX_REPLY) {
      return res.status(400).json({ error: `Ответ — не длиннее ${MAX_REPLY} символов` });
    }
    params.push(text || null);
    sets.push(`reply = $${params.length}`);
    if (text) {
      params.push(req.userId);
      sets.push(`replied_by = $${params.length}`);
      sets.push('replied_at = NOW()');
    } else {
      sets.push('replied_by = NULL', 'replied_at = NULL');
    }
  }

  params.push(req.params.id);
  const result = await db.query(
    `UPDATE feedback SET ${sets.join(', ')} WHERE id = $${params.length}`,
    params,
  );
  if (!result.length) return res.status(404).json({ error: 'Not found' });

  return res.json({ success: true });
}));
