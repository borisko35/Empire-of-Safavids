// ============================================================
// Site Content Routes (CMS) — Empire of Safavids
// ============================================================
// Публичная выдача редактируемого контента лендинга и приём
// правок от персонала (разработчики / админы / модераторы).
//
// GET  /api/site/content        — публично: всё, что показывает главная
// GET  /api/site/content/:key   — публично: одна запись
// PUT  /api/site/content/:key   — только персонал: записать контент
//
// Пока в БД нет записи, выдаются дефолты, собранные из локалей
// (site.news_1_t / site.news_1_d …) — редактор открывается сразу
// с уже опубликованными новостями, а не с пустой формой.

import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { secureMiddleware } from '../middleware/auth';
import { siteStaffCheck } from '../middleware/adminCheck';
import { asyncHandler } from '../utils/asyncHandler';
import { DatabaseService } from '../services/DatabaseService';
import { logger } from '../utils/logger';

export const siteRouter = Router();

const db = DatabaseService.getInstance();

/** Ключи, которые вообще можно редактировать (белый список) */
const ALLOWED_KEYS = new Set(['news', 'announcement', 'maintenance']);

// ── Дефолтный контент из локалей ─────────────────────────────
type L10n = Record<string, string>;

function resolveLocalesDir(): string | null {
  const roots = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '..', '..'),
  ];
  for (const root of roots) {
    const dir = path.join(root, 'shared', 'locales');
    if (fs.existsSync(path.join(dir, 'ru.json'))) return dir;
  }
  return null;
}

function loadLocale(dir: string, code: string): L10n {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8')) as L10n;
  } catch {
    return {};
  }
}

function siteSection(dict: L10n): L10n {
  return (dict.site ?? {}) as unknown as L10n;
}

/** 6 новостных карточек, которые раньше были зашиты в index.html */
function defaultNews(): { items: { title: L10n; body: L10n; date: string }[] } {
  const dir = resolveLocalesDir();
  if (!dir) return { items: [] };
  const byLang: Record<string, L10n> = {
    ru: siteSection(loadLocale(dir, 'ru')),
    en: siteSection(loadLocale(dir, 'en')),
    az: siteSection(loadLocale(dir, 'az')),
  };
  const items: { title: L10n; body: L10n; date: string }[] = [];
  for (let i = 1; i <= 6; i++) {
    const title: L10n = {};
    const body: L10n = {};
    for (const [lang, sec] of Object.entries(byLang)) {
      const t = sec[`news_${i}_t`];
      const d = sec[`news_${i}_d`];
      if (t) title[lang] = t;
      if (d) body[lang] = d;
    }
    if (Object.keys(title).length) items.push({ title, body, date: '' });
  }
  return { items };
}

function defaultContent(key: string): unknown {
  if (key === 'news') return defaultNews();
  if (key === 'announcement') return { enabled: false, text: { ru: '', en: '', az: '' } };
  if (key === 'maintenance') return { enabled: false, text: { ru: '', en: '', az: '' } };
  return null;
}

async function readValue(key: string): Promise<unknown> {
  const row = await db.queryOne<{ value: unknown }>(
    'SELECT value FROM site_content WHERE key = $1', [key],
  ).catch(() => null);
  if (row && row.value !== undefined && row.value !== null) return row.value;
  return defaultContent(key);
}

// ── Публичная выдача ─────────────────────────────────────────
siteRouter.get('/content', asyncHandler(async (_req: Request, res: Response) => {
  const rows = await db.query<{ key: string; value: unknown; updated_at: Date }>(
    'SELECT key, value, updated_at FROM site_content',
  ).catch(() => [] as { key: string; value: unknown; updated_at: Date }[]);

  const content: Record<string, unknown> = {};
  const updatedAt: Record<string, string> = {};
  for (const key of ALLOWED_KEYS) content[key] = defaultContent(key);
  for (const r of rows) {
    if (!ALLOWED_KEYS.has(r.key)) continue;
    content[r.key] = r.value;
    updatedAt[r.key] = r.updated_at?.toISOString?.() ?? '';
  }
  return res.json({ content, updatedAt });
}));

siteRouter.get('/content/:key', asyncHandler(async (req: Request, res: Response) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) return res.status(404).json({ error: 'Unknown content key' });
  return res.json({ key, value: await readValue(key) });
}));

// ── Редактирование персоналом ───────────────────────────────
siteRouter.put('/content/:key', secureMiddleware, siteStaffCheck, asyncHandler(async (req: Request, res: Response) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) return res.status(404).json({ error: 'Unknown content key' });

  const value = req.body?.value ?? req.body;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return res.status(400).json({ error: 'value must be an object' });
  }

  // Новости: не больше 12 карточек, каждая — заголовок и текст
  if (key === 'news') {
    const items = (value as { items?: unknown }).items;
    if (!Array.isArray(items) || items.length > 12) {
      return res.status(400).json({ error: 'news.items must be an array of at most 12 items' });
    }
  }

  await db.query(
    `INSERT INTO site_content (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_by = $3, updated_at = NOW()`,
    [key, JSON.stringify(value), req.userId ?? null],
  );

  logger.info(`Site content updated: ${key} by ${req.userId}`);
  return res.json({ success: true, key, value });
}));
