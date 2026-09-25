// ============================================================
// Friends Service — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { RedisService } from './RedisService';
import { logger } from '../utils/logger';

export interface Friend {
  userId: string;
  friendId: string;
  friendName: string;
  status: 'pending' | 'accepted' | 'blocked';
  online: boolean;
  level: number;
  region: string;
  createdAt: Date;
}

export class FriendsService {
  private db = DatabaseService.getInstance();
  private redis = RedisService.getInstance();

  /** Отправить запрос на дружбу */
  async sendRequest(userId: string, friendId: string): Promise<void> {
    if (userId === friendId) {
      throw Object.assign(new Error('Cannot friend yourself'), { code: 'self_friend' });
    }

    const existing = await this.db.queryOne<{ status: string }>(
      'SELECT status FROM friends WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)',
      [userId, friendId]
    );

    if (existing) {
      if (existing.status === 'accepted') throw Object.assign(new Error('Already friends'), { code: 'already_friends' });
      if (existing.status === 'blocked') throw Object.assign(new Error('User is blocked'), { code: 'user_blocked' });
      if (existing.status === 'pending') {
        // Если есть запрос от другого — автоматически принимаем
        const reverse = await this.db.queryOne<{ user_id: string }>(
          'SELECT user_id FROM friends WHERE user_id=$1 AND friend_id=$2 AND status=\'pending\'',
          [friendId, userId]
        );
        if (reverse) {
          await this.acceptRequest(friendId, userId);
          return;
        }
        throw Object.assign(new Error('Request already sent'), { code: 'request_exists' });
      }
    }

    await this.db.query(
      'INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, \'pending\') ON CONFLICT (user_id, friend_id) DO UPDATE SET status = \'pending\'',
      [userId, friendId]
    );
    logger.info(`[Friends] ${userId} sent friend request to ${friendId}`);
  }

  /** Принять запрос */
  async acceptRequest(userId: string, friendId: string): Promise<void> {
    await this.db.query(
      'UPDATE friends SET status = \'accepted\' WHERE user_id = $1 AND friend_id = $2 AND status = \'pending\'',
      [friendId, userId]
    );
    // Создаём запись в обратную сторону если её нет
    await this.db.query(
      'INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, \'accepted\') ON CONFLICT (user_id, friend_id) DO UPDATE SET status = \'accepted\'',
      [userId, friendId]
    );
    logger.info(`[Friends] ${userId} accepted friend request from ${friendId}`);
  }

  /** Удалить друга */
  async removeFriend(userId: string, friendId: string): Promise<void> {
    await this.db.query(
      'DELETE FROM friends WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)',
      [userId, friendId]
    );
    logger.info(`[Friends] ${userId} removed friend ${friendId}`);
  }

  /** Заблокировать */
  async blockUser(userId: string, friendId: string): Promise<void> {
    await this.db.query(
      'DELETE FROM friends WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)',
      [userId, friendId]
    );
    await this.db.query(
      'INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, \'blocked\') ON CONFLICT (user_id, friend_id) DO UPDATE SET status = \'blocked\'',
      [userId, friendId]
    );
    logger.info(`[Friends] ${userId} blocked ${friendId}`);
  }

  /** Список друзей (принятые + входящие pending) */
  async getFriends(userId: string): Promise<Friend[]> {
    const rows = await this.db.query<{
      user_id: string; friend_id: string; status: string; created_at: Date;
      friend_name: string; friend_level: number; friend_region: string; friend_character_id: string;
    }>(
      `SELECT f.user_id, f.friend_id, f.status, f.created_at,
              c.name AS friend_name, c.level AS friend_level, c.region AS friend_region,
              c.id AS friend_character_id
       FROM friends f
       JOIN characters c ON c.user_id = f.friend_id
       WHERE f.user_id = $1
       ORDER BY f.status, f.created_at`,
      [userId]
    );
    // batch online check via Redis
    const charIds = rows.map(r => r.friend_character_id).filter(Boolean);
    const onlineMap = charIds.length ? await this.redis.arePlayersOnline(charIds).catch(() => new Map<string, boolean>()) : new Map<string, boolean>();
    // also check by userId fallback (если у друга несколько персонажей)
    const userOnlineFallback = new Map<string, boolean>();
    await Promise.all(rows.map(async r => {
      if (!onlineMap.get(r.friend_character_id)) {
        const uOnline = await this.redis.isUserOnline(r.friend_id).catch(() => false);
        userOnlineFallback.set(r.friend_id, uOnline);
      }
    }));
    return rows.map(r => ({
      userId: r.user_id,
      friendId: r.friend_id,
      friendName: r.friend_name,
      status: r.status as Friend['status'],
      online: onlineMap.get(r.friend_character_id) ?? userOnlineFallback.get(r.friend_id) ?? false,
      level: r.friend_level,
      region: r.friend_region,
      createdAt: r.created_at,
    }));
  }

  /** Входящие запросы */
  async getPendingRequests(userId: string): Promise<Friend[]> {
    const rows = await this.db.query<{
      user_id: string; friend_id: string; created_at: Date;
      friend_name: string; friend_level: number; friend_region: number; friend_character_id: string;
    }>(
      `SELECT f.user_id, f.friend_id, f.created_at,
              c.name AS friend_name, c.level AS friend_level, c.region AS friend_region,
              c.id AS friend_character_id
       FROM friends f
       JOIN characters c ON c.user_id = f.user_id
       WHERE f.friend_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at`,
      [userId]
    );
    const charIds = rows.map(r => (r as unknown as { friend_character_id: string }).friend_character_id).filter(Boolean);
    const onlineMap = charIds.length ? await this.redis.arePlayersOnline(charIds).catch(() => new Map<string, boolean>()) : new Map<string, boolean>();
    return rows.map(r => ({
      userId: r.user_id,
      friendId: r.friend_id,
      friendName: r.friend_name,
      status: 'pending' as const,
      online: onlineMap.get((r as unknown as { friend_character_id: string }).friend_character_id) ?? false,
      level: r.friend_level,
      region: String(r.friend_region),
      createdAt: r.created_at,
    }));
  }

  /** Проверка — являются ли друзьями */
  async areFriends(userId: string, friendId: string): Promise<boolean> {
    const row = await this.db.queryOne<{ status: string }>(
      'SELECT status FROM friends WHERE user_id=$1 AND friend_id=$2 AND status=\'accepted\'',
      [userId, friendId]
    );
    return !!row;
  }
}
