// ============================================================
// Admin Service — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { RedisService } from './RedisService';
import { logger } from '../utils/logger';
import { GAME_SERVERS } from '../../../shared/constants';

export type AdminRole = 'gm' | 'senior_gm' | 'admin' | 'superadmin';

export interface AdminAction {
  adminId: string;
  action: string;
  targetId?: string;
  details: string;
  timestamp: Date;
}

export class AdminService {
  private db    = DatabaseService.getInstance();
  private redis = RedisService.getInstance();

  // ============================================================
  // Бан / Разбан
  // ============================================================
  async banUser(
    adminId: string,
    userId: string,
    reason: string,
    durationDays?: number
  ): Promise<void> {
    const banUntil = durationDays
      ? new Date(Date.now() + durationDays * 86400 * 1000)
      : null;

    await this.db.query(
      `UPDATE users SET is_banned = TRUE, ban_reason = $1, ban_until = $2 WHERE id = $3`,
      [reason, banUntil, userId]
    );

    // Кикаем из игры
    await this.redis.publish('admin:kick_user', { userId, reason });
    await this.logAction(adminId, 'ban_user', userId, `Reason: ${reason}, Duration: ${durationDays ?? 'permanent'} days`);
    logger.info(`[Admin] ${adminId} banned user ${userId}: ${reason}`);
  }

  async unbanUser(adminId: string, userId: string): Promise<void> {
    await this.db.query(
      `UPDATE users SET is_banned = FALSE, ban_reason = NULL, ban_until = NULL WHERE id = $1`,
      [userId]
    );
    await this.logAction(adminId, 'unban_user', userId, 'Unbanned');
  }

  // ============================================================
  // Мьют чата
  // ============================================================
  async muteCharacter(
    adminId: string,
    characterId: string,
    durationMinutes: number,
    reason: string
  ): Promise<void> {
    const muteUntil = new Date(Date.now() + durationMinutes * 60 * 1000);
    await this.db.query(
      `INSERT INTO character_mutes (character_id, muted_until, reason, muted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (character_id) DO UPDATE SET muted_until = $2, reason = $3`,
      [characterId, muteUntil, reason, adminId]
    );
    await this.redis.publish('admin:mute', { characterId, muteUntil, reason });
    await this.logAction(adminId, 'mute', characterId, `${durationMinutes}min: ${reason}`);
  }

  // ============================================================
  // Телепорт персонажа
  // ============================================================
  async teleportCharacter(
    adminId: string,
    characterId: string,
    position: { x: number; y: number; z: number },
    region: string
  ): Promise<void> {
    await this.db.query(
      `UPDATE characters SET position = $1, region = $2, updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(position), region, characterId]
    );
    await this.redis.publish('admin:teleport', { characterId, position, region });
    await this.logAction(adminId, 'teleport', characterId, `To ${region} ${JSON.stringify(position)}`);
  }

  // ============================================================
  // Выдача предметов
  // ============================================================
  async giveItem(
    adminId: string,
    characterId: string,
    itemId: string,
    quantity: number,
    enhancement = 0
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (character_id, item_id, enhancement)
       DO UPDATE SET quantity = character_items.quantity + $3`,
      [characterId, itemId, quantity, enhancement]
    );
    await this.redis.publish('admin:give_item', { characterId, itemId, quantity });
    await this.logAction(adminId, 'give_item', characterId, `${itemId} x${quantity} +${enhancement}`);
  }

  // ============================================================
  // Выдача золота
  // ============================================================
  async giveGold(adminId: string, characterId: string, amount: number): Promise<void> {
    await this.db.query(
      `UPDATE characters SET gold = gold + $1 WHERE id = $2`,
      [amount, characterId]
    );
    await this.logAction(adminId, 'give_gold', characterId, `+${amount} gold`);
  }

  // ============================================================
  // Ручное начисление валюты (только senior+ через /admin/grant-currency).
  // Причина обязательна: тихие «допечатки» денег запрещены.
  // Пишет и в журнал грантов, и в общий лог действий.
  // ============================================================
  static readonly GRANT_COLUMNS: Record<string, string> = {
    azens: 'azens',
    gold: 'gold',
    isfahan_silver: 'isfahan_silver',
    syrian_gold: 'syrian_gold',
  };

  async grantCurrency(
    adminId: string,
    characterId: string,
    currency: 'azens' | 'gold' | 'isfahan_silver' | 'syrian_gold',
    amount: number,
    reason: string
  ): Promise<number> {
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      throw new Error('Invalid amount');
    }
    if (!reason || reason.trim().length < 5) {
      throw new Error('Reason is required (min 5 characters)');
    }
    const column = AdminService.GRANT_COLUMNS[currency];
    if (!column) throw new Error('Unknown currency');

    const row = await this.db.queryOne<{ balance: number }>(
      `UPDATE characters SET ${column} = ${column} + $1 WHERE id = $2 RETURNING ${column} AS balance`,
      [currency === 'azens' ? amount : Math.floor(amount), characterId]
    );
    if (!row) throw new Error('Character not found');

    await this.db.query(
      `INSERT INTO admin_grants (admin_id, character_id, currency, amount, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, characterId, currency, amount, reason.trim()]
    );
    await this.logAction(adminId, 'grant_currency', characterId, `+${amount} ${currency}: ${reason.trim()}`);
    return Number(row.balance);
  }

  async getGrants(limit = 100, offset = 0): Promise<unknown[]> {
    return this.db.query(
      `SELECT g.*, c.name AS character_name, u.email AS admin_email
       FROM admin_grants g
       LEFT JOIN characters c ON c.id = g.character_id
       LEFT JOIN users u ON u.id = g.admin_id
       ORDER BY g.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  }

  async getPayments(limit = 100, offset = 0): Promise<unknown[]> {
    return this.db.query(
      `SELECT p.*, c.name AS character_name
       FROM payments p
       LEFT JOIN characters c ON c.id = p.character_id
       ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  }

  // ============================================================
  // Сверка эмиссии: сошлись ли выпущенные AZENS с находящимися
  // на руках + потраченными. Расхождение = утечка/баг начислений.
  // ============================================================
  async getFinanceSummary(): Promise<unknown> {
    const byStatus = await this.db.query(
      `SELECT status, COUNT(*)::int AS count,
              COALESCE(SUM(azens_credited), 0) AS minted,
              COALESCE(SUM(bonus_azens), 0) AS bonus
       FROM payments GROUP BY status`
    );
    const circulating = await this.db.queryOne<Record<string, unknown>>(
      `SELECT COALESCE(SUM(azens), 0) AS azens,
              COALESCE(SUM(gold), 0) AS gold,
              COALESCE(SUM(isfahan_silver), 0) AS silver,
              COALESCE(SUM(syrian_gold), 0) AS syrian,
              COUNT(*) FILTER (WHERE azens < 0)::int AS debtors
       FROM characters`
    );
    const promoGranted = await this.db.queryOne<Record<string, unknown>>(
      `SELECT COALESCE(SUM(p.azens * 1), 0) AS azens,
              COALESCE(SUM(p.silver), 0) AS silver,
              COALESCE(SUM(p.syrian), 0) AS syrian,
              COUNT(*)::int AS redemptions
       FROM promo_uses u JOIN promo_codes p ON p.code = u.code`
    );
    const grants = await this.db.query(
      `SELECT currency, COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS total
       FROM admin_grants GROUP BY currency`
    );
    const velocity = await this.db.query(
      `SELECT user_id, COUNT(*)::int AS completed_24h
       FROM payments WHERE status = 'completed' AND created_at > NOW() - INTERVAL '24 hours'
       GROUP BY user_id HAVING COUNT(*) > 5 ORDER BY 2 DESC LIMIT 50`
    );
    return { byStatus, circulating, promoGranted, grants, velocity };
  }

  // ============================================================
  // Изменение уровня
  // ============================================================
  async setLevel(adminId: string, characterId: string, level: number): Promise<void> {
    if (level < 1 || level > 100) throw new Error('Level must be 1-100');
    const exp = Math.pow(level - 1, 2) * 100;
    await this.db.query(
      `UPDATE characters SET level = $1, experience = $2, updated_at = NOW() WHERE id = $3`,
      [level, exp, characterId]
    );
    await this.logAction(adminId, 'set_level', characterId, `Level set to ${level}`);
  }

  // ============================================================
  // Просмотр логов нарушений
  // ============================================================
  async getViolations(characterId: string): Promise<unknown[]> {
    return this.db.query(
      `SELECT * FROM anticheat_violations WHERE character_id = $1 ORDER BY detected_at DESC LIMIT 50`,
      [characterId]
    );
  }

  // ============================================================
  // Поиск игрока
  // ============================================================
  async findPlayer(query: string): Promise<unknown[]> {
    return this.db.query(
      `SELECT c.id, c.name, c.class, c.level, c.region, u.id AS user_id, u.email, u.is_banned
       FROM characters c JOIN users u ON c.user_id = u.id
       WHERE c.name ILIKE $1 OR u.email ILIKE $1
       LIMIT 20`,
      [`%${query}%`]
    );
  }

  // ============================================================
  // Журнал действий GM
  // ============================================================
  private async logAction(
    adminId: string,
    action: string,
    targetId?: string,
    details?: string
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO admin_logs (admin_id, action, target_id, details, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [adminId, action, targetId ?? null, details ?? '']
    );
  }

  /** Публичная обёртка над журналом для ручных денежных операций из роутов. */
  async logManualAction(adminId: string, action: string, targetId: string, details: string): Promise<void> {
    await this.logAction(adminId, action, targetId, details);
  }

  async getAdminLogs(limit = 100, offset = 0): Promise<unknown[]> {
    return this.db.query(
      `SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  }

  // ============================================================
  // СТАТИСТИКА СЕРВЕРА
  // ============================================================

  /** Общая статистика сервера */
  async getServerStats(): Promise<{
    totalUsers: number;
    totalCharacters: number;
    onlinePlayers: number;
    activeGames: number;
    totalGuilds: number;
    uptime: number;
  }> {
    const redis = RedisService.getInstance();

    const [totalUsers, totalCharacters, totalGuilds] = await Promise.all([
      this.db.queryOne<{ count: string }>('SELECT COUNT(*) AS count FROM users'),
      this.db.queryOne<{ count: string }>('SELECT COUNT(*) AS count FROM characters'),
      this.db.queryOne<{ count: string }>('SELECT COUNT(*) AS count FROM guilds'),
    ]);

    // Считаем онлайн по всем шардам
    let onlinePlayers = 0;
    const shardMembers = await Promise.all(
      GAME_SERVERS.map(srv => redis.getShardOnline(srv.id))
    );
    for (const count of shardMembers) onlinePlayers += count;

    return {
      totalUsers: Number(totalUsers?.count ?? 0),
      totalCharacters: Number(totalCharacters?.count ?? 0),
      onlinePlayers,
      activeGames: GAME_SERVERS.length,
      totalGuilds: Number(totalGuilds?.count ?? 0),
      uptime: process.uptime(),
    };
  }
}
