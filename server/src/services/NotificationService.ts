// ============================================================
// Notification Service — Empire of Safavids
// ============================================================

import { RedisService } from './RedisService';
import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';

export type NotificationType =
  | 'craft_complete'      // Крафтинг завершён
  | 'siege_starting'      // Осада начинается
  | 'world_boss_spawn'    // Мировой босс появился
  | 'auction_sold'        // Лот продан
  | 'auction_outbid'      // Перебили на аукционе
  | 'guild_invite'        // Приглашение в гильдию
  | 'guild_war'           // Объявление войны
  | 'level_up'            // Повышение уровня
  | 'achievement'         // Достижение
  | 'mail_received'       // Новое письмо
  | 'friend_online'       // Друг вошёл в игру
  | 'pvp_bounty';         // На вас объявлена награда

export interface Notification {
  id: string;
  characterId: string;
  type: NotificationType;
  titleRu: string;
  bodyRu: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  createdAt: Date;
}

const NOTIFICATION_TEMPLATES: Record<NotificationType, { titleRu: string; bodyRu: string }> = {
  craft_complete:   { titleRu: 'Крафтинг завершён',       bodyRu: 'Ваш предмет готов!' },
  siege_starting:   { titleRu: 'Осада начинается!',       bodyRu: 'Через 30 минут начнётся штурм крепости.' },
  world_boss_spawn: { titleRu: 'Мировой Босс появился!',  bodyRu: 'Соберите рейд и отправляйтесь в бой!' },
  auction_sold:     { titleRu: 'Лот продан',              bodyRu: 'Ваш предмет на аукционе продан.' },
  auction_outbid:   { titleRu: 'Вас перебили!',           bodyRu: 'Кто-то предложил большую цену.' },
  guild_invite:     { titleRu: 'Приглашение в гильдию',   bodyRu: 'Вас приглашают вступить в гильдию.' },
  guild_war:        { titleRu: 'Гильдия объявила войну!',  bodyRu: 'Ваша гильдия в состоянии войны.' },
  level_up:         { titleRu: 'Новый уровень!',           bodyRu: 'Поздравляем! Вы достигли нового уровня.' },
  achievement:      { titleRu: 'Достижение разблокировано!', bodyRu: 'Вы получили новое достижение.' },
  mail_received:    { titleRu: 'Новое письмо',             bodyRu: 'У вас есть непрочитанное письмо.' },
  friend_online:    { titleRu: 'Друг в сети',              bodyRu: 'Ваш друг вошёл в игру.' },
  pvp_bounty:       { titleRu: 'На вас объявлена награда!', bodyRu: 'Кто-то объявил награду за вашу голову.' },
};

export class NotificationService {
  private db    = DatabaseService.getInstance();
  private redis = RedisService.getInstance();

  async send(
    characterId: string,
    type: NotificationType,
    data?: Record<string, unknown>
  ): Promise<void> {
    const template = NOTIFICATION_TEMPLATES[type];

    await this.db.query(
      `INSERT INTO notifications (id, character_id, type, title_ru, body_ru, data, is_read, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, FALSE, NOW())`,
      [characterId, type, template.titleRu, template.bodyRu, JSON.stringify(data ?? {})]
    );

    // Real-time push через Socket.IO (один канал — characterId в payload,
    // GameSocketHandler пересылает конкретному сокету)
    await this.redis.publish('player:notification', {
      characterId,
      type,
      titleRu: template.titleRu,
      bodyRu: template.bodyRu,
      data,
    });

    logger.debug(`[Notification] ${type} -> ${characterId}`);
  }

  async sendToRegion(shardId: string, region: string, type: NotificationType, data?: Record<string, unknown>): Promise<void> {
    const template = NOTIFICATION_TEMPLATES[type];
    await this.redis.publish(`region:${shardId}:${region}:notification`, { type, ...template, data });
  }

  async sendGlobal(type: NotificationType, data?: Record<string, unknown>): Promise<void> {
    const template = NOTIFICATION_TEMPLATES[type];
    await this.redis.publish('global:notification', { type, ...template, data });
    logger.info(`[Notification] Global: ${type}`);
  }

  async getUnread(characterId: string): Promise<Notification[]> {
    return this.db.query<Notification>(
      `SELECT * FROM notifications WHERE character_id = $1 AND is_read = FALSE ORDER BY created_at DESC LIMIT 50`,
      [characterId]
    );
  }

  async markAllRead(characterId: string): Promise<void> {
    await this.db.query(
      `UPDATE notifications SET is_read = TRUE WHERE character_id = $1`,
      [characterId]
    );
  }
}
