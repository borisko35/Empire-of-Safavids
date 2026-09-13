// ============================================================
// Admin Service — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { RedisService } from './RedisService';
import { logger } from '../utils/logger';

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
      `SELECT c.id, c.name, c.class, c.level, c.region, u.email, u.is_banned
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

  async getAdminLogs(limit = 100, offset = 0): Promise<unknown[]> {
    return this.db.query(
      `SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  }
}
