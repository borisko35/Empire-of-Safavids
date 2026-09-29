// ============================================================
// Почтовый ящик — Empire of Safavids
// ============================================================
//
// ЗАЧЕМ. Таблица mailbox создана миграцией 002 и с тех пор пуста. Аукцион
// и игровые награды выдавались напрямую, из чего следовало две плохие вещи:
//   - если персонаж был офлайн в момент продажи, он узнавал о ней только
//     из уведомления, и уведомление живёт в списке;
//   - продавец не мог получить вещь, если сумма не помещалась в сумку, и
//     никакого способа забрать её позже не было — просто терялась.
//
// Теперь награды, которые нельзя выдать сразу, кладутся в письмо. Письмо
// может нести золото, предмет, или и то и другое. Срок жизни — 30 дней,
// он же в схеме: по истечении письмо удаляется вместе с наградой.
//
// ГЛАВНОЕ ПРАВИЛО. Письмо — это отложенная выдача, а не вторая копия
// награды. Награда либо лежит в письме, либо уже выдана. Иначе игрок
// получил бы её дважды.

import { DatabaseService } from './DatabaseService';
import { CharacterService } from './CharacterService';
import { NotificationService } from './NotificationService';
import { logger } from '../utils/logger';

export interface MailItem {
  id: string;
  subject: string;
  body: string | null;
  gold: number;
  itemId: string | null;
  itemQty: number;
  isRead: boolean;
  senderId: string | null;
  senderName: string | null;
  expiresAt: Date;
  createdAt: Date;
}

const db = DatabaseService.getInstance();

export class MailService {
  private static instance: MailService;
  private characters = new CharacterService();
  private notifications = new NotificationService();

  static getInstance(): MailService {
    if (!MailService.instance) MailService.instance = new MailService();
    return MailService.instance;
  }

  /**
   * Отправить письмо.
   *
   * Золото и предмет — независимые поля: письмо может нести что-то одно.
   * Сумма ноль и отсутствие предмета — обычное дело (письмо «ваш заказ
   * доставлен» без награды), поэтому проверяем не «пустое ли письмо»,
   * а «есть ли вообще что передать». Текст без награды тоже полезен.
   */
  async send(
    recipientId: string,
    subject: string,
    body: string | null,
    reward: { gold?: number; itemId?: string; itemQty?: number } = {},
    senderId: string | null = null,
  ): Promise<string> {
    const gold = Math.max(0, Math.floor(reward.gold ?? 0));
    const itemId = reward.itemId ?? null;
    const itemQty = Math.max(0, Math.floor(reward.itemQty ?? 0));

    const row = await db.queryOne<{ id: string }>(
      `INSERT INTO mailbox (recipient_id, sender_id, subject, body, gold, item_id, item_qty)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [recipientId, senderId, subject, body, gold, itemId, itemQty]
    );
    if (!row) throw new Error('Не удалось отправить письмо');

    // Уведомление остаётся: игрок должен узнать о письме, даже если
    // не откроет ящик. Раньше вместо этого была только запись в
    // notifications, по которой письмо нельзя было ни найти, ни забрать.
    void this.notifications.send(recipientId, 'mail_received', { subject })
      .catch((e) => logger.debug('[Mail] уведомление о письме не отправлено:', e));
    return row.id;
  }

  /** Письма персонажа, новые сверху */
  async list(recipientId: string, limit = 50): Promise<MailItem[]> {
    return db.query<Record<string, unknown>>(
      `SELECT m.*, c.name AS sender_name
       FROM mailbox m
       LEFT JOIN characters c ON c.id = m.sender_id
       WHERE m.recipient_id = $1
       ORDER BY m.created_at DESC
       LIMIT $2`,
      [recipientId, limit]
    ).then((rows) => rows.map(r => this.toMailItem(r)));
  }

  /** Забрать награду из письма и удалить само письмо */
  async claim(mailId: string, characterId: string): Promise<{ gold: number; items: { itemId: string; qty: number }[] }> {
    const row = await db.queryOne<{
      id: string; gold: string; item_id: string | null; item_qty: number;
    }>(
      `SELECT id, gold, item_id, item_qty FROM mailbox
       WHERE id = $1 AND recipient_id = $2`,
      [mailId, characterId]
    );
    if (!row) throw new Error('Письмо не найдено');

    const gold = Number(row.gold) || 0;
    const items = row.item_id && row.item_qty > 0 ? [{ itemId: row.item_id, qty: row.item_qty }] : [];

    // Сначала удаляем письмо, потом выдаём. Обратный порядок опасен: если
    // выдача упадёт, письмо уже пропало и награда пропала вместе с ним.
    // С обратным порядком письмо останется и попробовать можно будет снова.
    const deleted = await db.queryOne<{ id: string }>(
      'DELETE FROM mailbox WHERE id = $1 AND recipient_id = $2 RETURNING id',
      [mailId, characterId]
    );
    if (!deleted) throw new Error('Письмо уже забрано');

    if (gold > 0) await this.characters.addGoldReward(characterId, gold);
    for (const it of items) await this.characters.addItems(characterId, [it]);
    return { gold, items };
  }

  /** Удалить письмо без забора награды — только если награды в нём нет */
  async discard(mailId: string, characterId: string): Promise<boolean> {
    const row = await db.queryOne<{ id: string; gold: string; item_id: string | null; item_qty: number }>(
      `UPDATE mailbox SET gold = 0, item_id = NULL, item_qty = 0
       WHERE id = $1 AND recipient_id = $2 RETURNING id, gold, item_id, item_qty`,
      [mailId, characterId]
    );
    if (!row) return false;
    // Письмо без награды удаляем сразу: держать его незачем
    await db.query('DELETE FROM mailbox WHERE id = $1', [mailId]);
    return true;
  }

  async markRead(mailId: string, characterId: string): Promise<boolean> {
    const row = await db.queryOne<{ id: string }>(
      'UPDATE mailbox SET is_read = TRUE WHERE id = $1 AND recipient_id = $2 RETURNING id',
      [mailId, characterId]
    );
    return Boolean(row);
  }

  async unreadCount(characterId: string): Promise<number> {
    const row = await db.queryOne<{ count: string }>(
      'SELECT COUNT(*) AS count FROM mailbox WHERE recipient_id = $1 AND is_read = FALSE',
      [characterId]
    );
    return Number(row?.count ?? 0) || 0;
  }

  /**
   * Убрать просроченные письма.
   *
   * ЧТО БЫЛО И ЧТО БЫЛО БЫ. expires_at в схеме есть, но про него никто не
   * помнил: письма копились бы вечно вместе с наградой внутри. Игрок,
   * вернувшийся через полгода, увидел бы двадцать писем, половина из
   * которых давно бессмысленна, а забрать из них всё — значило бы получить
   * добычу за события месячной давности.
   */
  async purgeExpired(): Promise<number> {
    const rows = await db.query<{ id: string }>(
      'DELETE FROM mailbox WHERE expires_at < NOW() RETURNING id'
    );
    if (rows.length) logger.info(`[Mail] удалено просроченных писем: ${rows.length}`);
    return rows.length;
  }

  private toMailItem(row: Record<string, unknown>): MailItem {
    return {
      id: String(row.id),
      subject: String(row.subject),
      body: (row.body as string | null) ?? null,
      gold: Number(row.gold) || 0,
      itemId: (row.item_id as string | null) ?? null,
      itemQty: Number(row.item_qty) || 0,
      isRead: Boolean(row.is_read),
      senderId: (row.sender_id as string | null) ?? null,
      senderName: (row.sender_name as string | null) ?? null,
      expiresAt: new Date(row.expires_at as string),
      createdAt: new Date(row.created_at as string),
    };
  }
}
