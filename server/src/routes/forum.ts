// ============================================================
// Forum Routes — Empire of Safavids
// ============================================================
// Чтение форума открыто всем, запись — только авторизованным
// (токен сессии из localStorage, тот же, что в /admin.html).
//
// GET  /api/forum/categories            — разделы со счётчиками
// GET  /api/forum/topics                — список тем (фильтр/поиск/страница)
// GET  /api/forum/topics/:id            — тема + ответы (+1 просмотр)
// POST /api/forum/topics                — создать тему          [auth]
// POST /api/forum/topics/:id/posts      — ответить              [auth]
// POST /api/forum/topics/:id/solve      — отметить ответ решением [автор|персонал]
// POST /api/forum/topics/:id/moderate   — закрепить/закрыть     [персонал]
// DELETE /api/forum/topics/:id          — удалить тему          [персонал]
// DELETE /api/forum/posts/:id           — удалить ответ         [автор|персонал]

import { Router, Request, Response } from 'express';
import { secureMiddleware, optionalAuth } from '../middleware/auth';
import { apiRateLimiter } from '../middleware/rateLimiter';
import { isSiteStaff } from '../middleware/adminCheck';
import { asyncHandler } from '../utils/asyncHandler';
import { DatabaseService } from '../services/DatabaseService';

export const forumRouter = Router();

const db = DatabaseService.getInstance();

const PAGE_SIZE = 20;
const MAX_TITLE = 160;
const MAX_BODY = 5000;

interface TopicRow {
  id: string;
  category_id: string;
  user_id: string;
  title: string;
  body: string;
  views: number;
  pinned: boolean;
  locked: boolean;
  solved_post_id: string | null;
  created_at: Date;
  last_post_at: Date;
  author_name?: string;
  replies?: number;
}

interface PostRow {
  id: string;
  topic_id: string;
  user_id: string;
  body: string;
  created_at: Date;
  author_name?: string;
}

function topicDto(r: TopicRow) {
  return {
    id: r.id,
    categoryId: r.category_id,
    title: r.title,
    body: r.body,
    views: Number(r.views ?? 0),
    pinned: !!r.pinned,
    locked: !!r.locked,
    solved: !!r.solved_post_id,
    solvedPostId: r.solved_post_id ?? null,
    authorId: r.user_id,
    authorName: r.author_name ?? '—',
    replies: Number(r.replies ?? 0),
    createdAt: r.created_at,
    lastPostAt: r.last_post_at,
  };
}

function postDto(p: PostRow, solvedPostId?: string | null) {
  return {
    id: p.id,
    topicId: p.topic_id,
    authorId: p.user_id,
    authorName: p.author_name ?? '—',
    body: p.body,
    createdAt: p.created_at,
    isBest: !!solvedPostId && p.id === solvedPostId,
  };
}

/** Тема с автором и числом ответов */
const TOPIC_SELECT = `
  SELECT t.*, u.username AS author_name,
         (SELECT COUNT(*) FROM forum_posts p WHERE p.topic_id = t.id)::int AS replies
  FROM forum_topics t
  JOIN users u ON u.id = t.user_id`;

// ── Разделы ─────────────────────────────────────────────────
forumRouter.get('/categories', asyncHandler(async (_req: Request, res: Response) => {
  const rows = await db.query<{
    id: string; name: unknown; description: unknown; sort_order: number;
    topics_count: number; last_post_at: Date | null;
  }>(`
    SELECT c.id, c.name, c.description, c.sort_order,
           COUNT(t.id)::int AS topics_count,
           MAX(t.last_post_at) AS last_post_at
    FROM forum_categories c
    LEFT JOIN forum_topics t ON t.category_id = c.id
    GROUP BY c.id
    ORDER BY c.sort_order, c.id
  `);

  return res.json({
    categories: rows.map((r) => ({
      id: r.id,
      name: (r.name ?? {}) as Record<string, string>,
      description: (r.description ?? {}) as Record<string, string>,
      topicsCount: Number(r.topics_count ?? 0),
      lastPostAt: r.last_post_at,
    })),
  });
}));

// ── Список тем ──────────────────────────────────────────────
forumRouter.get('/topics', asyncHandler(async (req: Request, res: Response) => {
  const category = typeof req.query.category === 'string' ? req.query.category : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const page = Math.max(1, Number(req.query.page) || 1);

  const where: string[] = [];
  const params: unknown[] = [];
  if (category) {
    params.push(category);
    where.push(`t.category_id = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(t.title ILIKE $${params.length} OR t.body ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM forum_topics t ${whereSql}`, params,
  );
  const total = Number(totalRow?.count ?? 0);

  params.push(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const rows = await db.query<TopicRow>(
    `${TOPIC_SELECT} ${whereSql}
     ORDER BY t.pinned DESC, t.last_post_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return res.json({
    topics: rows.map(topicDto),
    page,
    pageSize: PAGE_SIZE,
    total,
  });
}));

// ── Тема + ответы ───────────────────────────────────────────
// optionalAuth обязателен: без него req.userId пуст и сервер считает
// автора темы посторонним (isAuthor/canModerate = false).
forumRouter.get('/topics/:id', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  const topic = await db.queryOne<TopicRow>(
    `${TOPIC_SELECT} WHERE t.id = $1`, [req.params.id],
  );
  if (!topic) return res.status(404).json({ error: 'Topic not found' });

  // Просмотр считаем для всех, кроме автора
  if (topic.user_id !== req.userId) {
    await db.query('UPDATE forum_topics SET views = views + 1 WHERE id = $1', [topic.id])
      .catch(() => undefined);
    topic.views = Number(topic.views ?? 0) + 1;
  }

  const posts = await db.query<PostRow>(`
    SELECT p.*, u.username AS author_name
    FROM forum_posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.topic_id = $1
    ORDER BY p.created_at ASC
  `, [topic.id]);

  const staff = await isSiteStaff(req.userId);
  // Решение — наверху списка ответов
  const ordered = topic.solved_post_id
    ? [...posts.filter((p) => p.id === topic.solved_post_id), ...posts.filter((p) => p.id !== topic.solved_post_id)]
    : posts;

  return res.json({
    topic: {
      ...topicDto(topic),
      isAuthor: !!req.userId && req.userId === topic.user_id,
      canModerate: staff,
    },
    posts: ordered.map((p) => postDto(p, topic.solved_post_id)),
    viewer: { isStaff: staff },
  });
}));

// ── Создать тему ────────────────────────────────────────────
forumRouter.post('/topics', apiRateLimiter, secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const categoryId = String(req.body?.categoryId ?? '').trim();
  const title = String(req.body?.title ?? '').trim();
  const body = String(req.body?.body ?? '').trim();

  if (!categoryId) return res.status(400).json({ error: 'Выбери раздел' });
  if (title.length < 3) return res.status(400).json({ error: 'Заголовок — минимум 3 символа' });
  if (title.length > MAX_TITLE) return res.status(400).json({ error: `Заголовок — не длиннее ${MAX_TITLE} символов` });
  if (!body) return res.status(400).json({ error: 'Напиши текст темы' });
  if (body.length > MAX_BODY) return res.status(400).json({ error: `Текст — не длиннее ${MAX_BODY} символов` });

  const cat = await db.queryOne<{ id: string }>(
    'SELECT id FROM forum_categories WHERE id = $1', [categoryId],
  );
  if (!cat) return res.status(400).json({ error: 'Раздел не найден' });

  const row = await db.queryOne<{ id: string }>(
    `INSERT INTO forum_topics (category_id, user_id, title, body)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [categoryId, req.userId, title, body],
  );

  return res.status(201).json({ success: true, id: row?.id });
}));

// ── Ответить ────────────────────────────────────────────────
forumRouter.post('/topics/:id/posts', apiRateLimiter, secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'Пустой ответ' });
  if (body.length > MAX_BODY) return res.status(400).json({ error: `Текст — не длиннее ${MAX_BODY} символов` });

  const topic = await db.queryOne<{ id: string; locked: boolean }>(
    'SELECT id, locked FROM forum_topics WHERE id = $1', [req.params.id],
  );
  if (!topic) return res.status(404).json({ error: 'Topic not found' });

  const staff = await isSiteStaff(req.userId);
  if (topic.locked && !staff) {
    return res.status(403).json({ error: 'Тема закрыта для ответов' });
  }

  const row = await db.queryOne<{ id: string }>(
    `INSERT INTO forum_posts (topic_id, user_id, body) VALUES ($1, $2, $3) RETURNING id`,
    [topic.id, req.userId, body],
  );
  await db.query('UPDATE forum_topics SET last_post_at = NOW() WHERE id = $1', [topic.id])
    .catch(() => undefined);

  return res.status(201).json({ success: true, id: row?.id });
}));

// ── Отметить ответ решением ─────────────────────────────────
forumRouter.post('/topics/:id/solve', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const postId = String(req.body?.postId ?? '').trim();

  const topic = await db.queryOne<{ id: string; user_id: string; category_id: string }>(
    'SELECT id, user_id, category_id FROM forum_topics WHERE id = $1', [req.params.id],
  );
  if (!topic) return res.status(404).json({ error: 'Topic not found' });

  const staff = await isSiteStaff(req.userId);
  if (topic.user_id !== req.userId && !staff) {
    return res.status(403).json({ error: 'Отметить решение может только автор темы' });
  }

  // Снимаем отметку, если нажали на уже отмеченный ответ
  if (postId) {
    const post = await db.queryOne<{ id: string }>(
      'SELECT id FROM forum_posts WHERE id = $1 AND topic_id = $2', [postId, topic.id],
    );
    if (!post) return res.status(400).json({ error: 'Ответ не найден' });
    await db.query('UPDATE forum_topics SET solved_post_id = $1 WHERE id = $2', [postId, topic.id]);
  } else {
    await db.query('UPDATE forum_topics SET solved_post_id = NULL WHERE id = $1', [topic.id]);
  }

  return res.json({ success: true });
}));

// ── Модерация: закрепить / закрыть ──────────────────────────
forumRouter.post('/topics/:id/moderate', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  if (!(await isSiteStaff(req.userId))) {
    return res.status(403).json({ error: 'Требуются права модератора' });
  }
  const topic = await db.queryOne<{ id: string }>(
    'SELECT id FROM forum_topics WHERE id = $1', [req.params.id],
  );
  if (!topic) return res.status(404).json({ error: 'Topic not found' });

  const sets: string[] = [];
  const params: unknown[] = [];
  if (typeof req.body?.pinned === 'boolean') {
    params.push(req.body.pinned);
    sets.push(`pinned = $${params.length}`);
  }
  if (typeof req.body?.locked === 'boolean') {
    params.push(req.body.locked);
    sets.push(`locked = $${params.length}`);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(topic.id);
  await db.query(`UPDATE forum_topics SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  return res.json({ success: true });
}));

// ── Удалить тему ────────────────────────────────────────────
forumRouter.delete('/topics/:id', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  if (!(await isSiteStaff(req.userId))) {
    return res.status(403).json({ error: 'Требуются права модератора' });
  }
  const result = await db.query('DELETE FROM forum_topics WHERE id = $1', [req.params.id]);
  if (!result.length) return res.status(404).json({ error: 'Topic not found' });
  return res.json({ success: true });
}));

// ── Удалить ответ ───────────────────────────────────────────
forumRouter.delete('/posts/:id', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const post = await db.queryOne<{ id: string; user_id: string; topic_id: string }>(
    'SELECT id, user_id, topic_id FROM forum_posts WHERE id = $1', [req.params.id],
  );
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const staff = await isSiteStaff(req.userId);
  if (post.user_id !== req.userId && !staff) {
    return res.status(403).json({ error: 'Можно удалять только свои ответы' });
  }

  await db.query('DELETE FROM forum_posts WHERE id = $1', [post.id]);
  // Если удалили отмеченный ответ — снимаем отметку
  await db.query(
    'UPDATE forum_topics SET solved_post_id = NULL WHERE id = $1 AND solved_post_id = $2',
    [post.topic_id, post.id],
  ).catch(() => undefined);
  return res.json({ success: true });
}));
