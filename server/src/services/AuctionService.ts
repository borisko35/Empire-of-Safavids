// ============================================================
// Аукционный дом и магазин — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { RedisService } from './RedisService';
import { NotificationService } from './NotificationService';
import { logger } from '../utils/logger';
import { camelizeRow, camelizeRows } from '../utils/camelize';
import { v4 as uuidv4 } from 'uuid';

export interface AuctionListing {
  id: string;
  sellerId: string;
  itemId: string;
  quantity: number;
  enhancement: number;
  price: number;
  buyoutPrice?: number;
  expiresAt: Date;
  createdAt: Date;
}

export interface ShopItem {
  itemId: string;
  price: number;
  currency: 'gold' | 'premium';
  stock?: number;       // undefined = бесконечно
  minLevel?: number;
  discount?: number;    // 0–1
}

// Товары NPC-магазинов по регионам
export const NPC_SHOPS: Record<string, { nameRu: string; items: ShopItem[] }> = {
  'shop_tabriz_general': {
    nameRu: 'Общий Магазин Тебриза',
    items: [
      { itemId: 'con_health_potion_s', price: 15, currency: 'gold' },
      { itemId: 'con_stamina_food', price: 20, currency: 'gold' },
      { itemId: 'mat_iron_ore', price: 8, currency: 'gold' },
      { itemId: 'wpn_iron_sword', price: 60, currency: 'gold', minLevel: 1 },
      { itemId: 'arm_leather_vest', price: 50, currency: 'gold', minLevel: 1 },
    ],
  },
  'shop_isfahan_bazaar': {
    nameRu: 'Базар Исфахана',
    items: [
      { itemId: 'con_health_potion_m', price: 60, currency: 'gold' },
      { itemId: 'con_mana_potion', price: 45, currency: 'gold' },
      { itemId: 'mat_silk', price: 100, currency: 'gold' },
      { itemId: 'mat_saffron', price: 150, currency: 'gold' },
      { itemId: 'con_exp_scroll', price: 600, currency: 'gold', minLevel: 20 },
      { itemId: 'wpn_qizilbash_saber', price: 3000, currency: 'gold', minLevel: 20 },
      { itemId: 'arm_silk_robe', price: 6000, currency: 'gold', minLevel: 25 },
    ],
  },
  'shop_khorasan_rare': {
    nameRu: 'Лавка Редкостей Хорасана',
    items: [
      { itemId: 'mat_turquoise', price: 400, currency: 'gold' },
      { itemId: 'mat_dragon_scale', price: 60000, currency: 'gold', minLevel: 70 },
      { itemId: 'acc_silk_road_amulet', price: 22000, currency: 'gold', minLevel: 60 },
    ],
  },
  'shop_premium': {
    nameRu: 'Премиум Магазин',
    items: [
      { itemId: 'con_exp_scroll', price: 10, currency: 'premium' },
      { itemId: 'mat_dragon_scale', price: 50, currency: 'premium', minLevel: 1 },
    ],
  },
};

export class AuctionService {
  private db = DatabaseService.getInstance();
  private redis = RedisService.getInstance();
  private notifications = new NotificationService();

  async createListing(
    sellerId: string,
    itemId: string,
    quantity: number,
    enhancement: number,
    price: number,
    buyoutPrice?: number,
    durationHours = 24
  ): Promise<AuctionListing> {
    const listing: AuctionListing = {
      id: uuidv4(),
      sellerId,
      itemId,
      quantity,
      enhancement,
      price,
      buyoutPrice,
      expiresAt: new Date(Date.now() + durationHours * 3600 * 1000),
      createdAt: new Date(),
    };

    await this.db.transaction(async (client) => {
      // Эскроу: предмет списывается с продавца при выставлении лота.
      // Без проверки продавец мог выставлять предметы, которых у него нет.
      const taken = await client.query(
        `UPDATE character_items SET quantity = quantity - $1
         WHERE id = (
           SELECT id FROM character_items
           WHERE character_id = $2 AND item_id = $3 AND enhancement = $4 AND quantity >= $1
           FOR UPDATE
         )`,
        [quantity, sellerId, itemId, enhancement]
      );
      if (taken.rowCount === 0) throw new Error('Not enough items to list');
      await client.query(
        `DELETE FROM character_items
         WHERE character_id = $1 AND item_id = $2 AND enhancement = $3 AND quantity <= 0`,
        [sellerId, itemId, enhancement]
      );

      await client.query(
        `INSERT INTO auction_listings
          (id, seller_id, item_id, quantity, enhancement, price, buyout_price, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [listing.id, listing.sellerId, listing.itemId, listing.quantity,
         listing.enhancement, listing.price, listing.buyoutPrice,
         listing.expiresAt, listing.createdAt]
      );
    });

    // Инвалидировать кэш поиска
    await this.redis.publish('auction:new_listing', { itemId, price });

    logger.info(`Auction listing created: ${itemId} x${quantity} for ${price}g by ${sellerId}`);
    return listing;
  }

  async searchListings(
    itemId?: string,
    maxPrice?: number,
    minEnhancement?: number,
    limit = 50,
    offset = 0
  ): Promise<AuctionListing[]> {
    let sql = `SELECT * FROM auction_listings WHERE sold_at IS NULL AND expires_at > NOW()`;
    const params: unknown[] = [];
    let paramIdx = 1;

    if (itemId) { sql += ` AND item_id = $${paramIdx++}`; params.push(itemId); }
    if (maxPrice) { sql += ` AND price <= $${paramIdx++}`; params.push(maxPrice); }
    if (minEnhancement) { sql += ` AND enhancement >= $${paramIdx++}`; params.push(minEnhancement); }

    sql += ` ORDER BY price ASC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    return camelizeRows<AuctionListing>(await this.db.query(sql, params));
  }

  async buyListing(listingId: string, buyerId: string): Promise<{ success: boolean; message: string }> {
    return this.db.transaction(async (client) => {
      const listing = await client.query(
        'SELECT * FROM auction_listings WHERE id = $1 AND sold_at IS NULL AND expires_at > NOW() FOR UPDATE',
        [listingId]
      );

      if (!listing.rows[0]) return { success: false, message: 'Listing not found or expired' };

      const item = camelizeRow<AuctionListing>(listing.rows[0])!;
      const buyer = await client.query('SELECT gold FROM characters WHERE id = $1 FOR UPDATE', [buyerId]);

      if (!buyer.rows[0] || buyer.rows[0].gold < item.price) {
        return { success: false, message: 'Insufficient gold' };
      }

      // Списать золото у покупателя
      await client.query('UPDATE characters SET gold = gold - $1 WHERE id = $2', [item.price, buyerId]);
      // Начислить золото продавцу (минус 5% налог)
      const sellerGold = Math.floor(item.price * 0.95);
      await client.query('UPDATE characters SET gold = gold + $1 WHERE id = $2', [sellerGold, item.sellerId]);
      // Отметить лот как проданный
      await client.query(
        'UPDATE auction_listings SET sold_at = NOW(), buyer_id = $1 WHERE id = $2',
        [buyerId, listingId]
      );

      // Передать предмет покупателю (он был в эскроу с момента выставления)
      await client.query(
        `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (character_id, item_id, enhancement)
         DO UPDATE SET quantity = character_items.quantity + $3`,
        [buyerId, item.itemId, item.quantity, item.enhancement]
      );

      // Уведомить продавца о продаже
      await this.notifications.send(item.sellerId, 'auction_sold', {
        listingId, itemId: item.itemId, price: item.price, buyerId,
      }).catch(err => logger.error('Auction notification failed:', err));

      logger.info(`Auction sale: ${item.itemId} sold to ${buyerId} for ${item.price}g`);
      return { success: true, message: 'Purchase successful' };
    });
  }

  async cancelListing(listingId: string, sellerId: string): Promise<boolean> {
    return this.db.transaction(async (client) => {
      const res = await client.query(
        `DELETE FROM auction_listings
         WHERE id = $1 AND seller_id = $2 AND sold_at IS NULL
         RETURNING item_id, quantity, enhancement`,
        [listingId, sellerId]
      );
      if (res.rows.length === 0) return false;

      // Вернуть предмет из эскроу продавцу
      const l = res.rows[0];
      await client.query(
        `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (character_id, item_id, enhancement)
         DO UPDATE SET quantity = character_items.quantity + $3`,
        [sellerId, l.item_id, l.quantity, l.enhancement]
      );
      return true;
    });
  }

  async getSellerListings(sellerId: string): Promise<AuctionListing[]> {
    return camelizeRows<AuctionListing>(
      await this.db.query(
        'SELECT * FROM auction_listings WHERE seller_id = $1 ORDER BY created_at DESC',
        [sellerId]
      )
    );
  }
}
