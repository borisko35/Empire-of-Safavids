// ============================================================
// Admin Middleware — Empire of Safavids
// ============================================================
// Проверяет, что авторизованный пользователь является админом
// с достаточным уровнем доступа.

import { Request, Response, NextFunction } from 'express';
import { DatabaseService } from '../services/DatabaseService';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      isAdmin?: boolean;
      adminRole?: string;
    }
  }
}

const db = DatabaseService.getInstance();

/** Проверка что пользователь — админ */
export async function adminCheck(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  try {
    const row = await db.queryOne<{ is_admin: boolean; admin_role: string }>(
      'SELECT is_admin, admin_role FROM users WHERE id = $1', [req.userId]
    );
    if (!row?.is_admin) {
      res.status(403).json({ error: 'Admin access required', code: 'admin_required' });
      return;
    }
    req.isAdmin = true;
    req.adminRole = row.admin_role;
    next();
  } catch {
    res.status(500).json({ error: 'Failed to verify admin', code: 'server_error' });
  }
}

/** Проверка минимальной роли (для senior_gm+) */
export async function seniorAdminCheck(req: Request, res: Response, next: NextFunction): Promise<void> {
  await adminCheck(req, res, async () => {
    if (req.adminRole === 'gm') {
      res.status(403).json({ error: 'Senior GM+ access required', code: 'senior_admin_required' });
      return;
    }
    next();
  });
}

/** Роли, которым открыто управление контентом сайта */
export const SITE_STAFF_ROLES = new Set([
  'owner', 'administrator', 'admin', 'moderator', 'developer', 'dev', 'gm',
]);

/**
 * Проверка «является ли пользователь персоналом сайта» без HTTP-контекста.
 * Нужна в роутах, где middleware не используется как цепочка (модерация
 * форума: тему может закрыть автор ИЛИ модератор).
 */
export async function isSiteStaff(userId: string | undefined | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const row = await db.queryOne<{ is_admin: boolean; admin_role: string }>(
      'SELECT is_admin, admin_role FROM users WHERE id = $1', [userId],
    );
    if (!row) return false;
    return row.is_admin || SITE_STAFF_ROLES.has(row.admin_role ?? '');
  } catch {
    return false;
  }
}

/**
 * Доступ к панели управления сайтом: разработчики, админы и модераторы.
 * Отличается от adminCheck тем, что пускает и по роли, даже если
 * флаг is_admin не выставлен (модераторы часто работают без него).
 */
export async function siteStaffCheck(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }
  try {
    const row = await db.queryOne<{ is_admin: boolean; admin_role: string }>(
      'SELECT is_admin, admin_role FROM users WHERE id = $1', [req.userId],
    );
    const byRole = SITE_STAFF_ROLES.has(row?.admin_role ?? '');
    if (!row || (!row.is_admin && !byRole)) {
      res.status(403).json({ error: 'Site staff access required', code: 'staff_required' });
      return;
    }
    req.isAdmin = true;
    req.adminRole = row.admin_role;
    next();
  } catch {
    res.status(500).json({ error: 'Failed to verify staff', code: 'server_error' });
  }
}
