// ============================================================
// Аукционный дом и магазин — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { RedisService } from './RedisService';
import { NotificationService } from './NotificationService';
import { grantReputation } from '../systems/ReputationGrants';
import { logger } from '../utils/logger';
import { camelizeRow, camelizeRows } from '../utils/camelize';
import { auctionListingFee } from '../utils/economy';
import { MAX_INVENTORY_SLOTS } from '../../../shared/constants';
import { v4 as uuidv4 } from 'uuid';

export interface AuctionListing {
  id: string;
  sellerId: string;
  itemId: string;
  quantity: number;
  enhancement: number;
  price: number;
  buyoutPrice?: number;
  /** null — лот ещё не продан. Раньше поля не было, и «продано» нечем было отличить */
  soldAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface ShopItem {
  itemId: string;
  price: number;
  currency: 'gold' | 'premium' | 'silver' | 'syrian';
  stock?: number;       // undefined = бесконечно
  minLevel?: number;
  discount?: number;    // 0–1
  /**
   * 'boat' — не предмет сумки, а отдельное средство передвижения
   * (как кони). Покупка идёт через BoatSystem, а не addItems.
   * undefined — обычный предмет.
   */
  kind?: 'boat';
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
      // Снаряжение для воды: снимает замедление в реке и экономит выносливость
      { itemId: 'acc_boots_silk', price: 700, currency: 'gold', minLevel: 10 },
      { itemId: 'acc_boots_seafarer', price: 2600, currency: 'gold', minLevel: 25 },
    ],
  },
  'shop_khorasan_rare': {
    nameRu: 'Лавка Редкостей Хорасана',
    items: [
      { itemId: 'mat_turquoise', price: 400, currency: 'gold' },
      { itemId: 'mat_dragon_scale', price: 60000, currency: 'gold', minLevel: 70 },
      { itemId: 'acc_silk_road_amulet', price: 22000, currency: 'gold', minLevel: 60 },
      { itemId: 'acc_cloim_rain', price: 7000, currency: 'gold', minLevel: 40 },
    ],
  },
  // Шираз: рукописи и лекарственные травы. Раньше qst_hafiz_scroll и
  // mat_rose_petals не выдавал НИКТО — три квеста и ежедневное задание
  // «Сбор Трав» было невозможно пройти в принципе.
  'shop_shiraz_scribe': {
    nameRu: 'Писальский ряд Шираза',
    items: [
      { itemId: 'qst_hafiz_scroll', price: 250, currency: 'gold' },
      { itemId: 'mat_rose_petals', price: 90, currency: 'gold' },
      { itemId: 'con_mana_potion', price: 45, currency: 'gold' },
    ],
  },
  'shop_premium': {
    nameRu: 'Премиум Магазин',
    items: [
      { itemId: 'con_exp_scroll', price: 10, currency: 'premium' },
      { itemId: 'mat_dragon_scale', price: 50, currency: 'premium', minLevel: 1 },
    ],
  },
  'shop_silver_goods': {
    nameRu: 'Серебряная лавка',
    items: [
      { itemId: 'con_health_potion_s', price: 5, currency: 'silver' },
      { itemId: 'con_stamina_food', price: 7, currency: 'silver' },
      { itemId: 'mat_iron_ore', price: 3, currency: 'silver' },
      { itemId: 'con_mana_potion', price: 15, currency: 'silver' },
      { itemId: 'con_health_potion_m', price: 20, currency: 'silver' },
      // Лепестки роз для алхимика — дешёвое ежедневное задание
      { itemId: 'mat_rose_petals', price: 2, currency: 'silver' },
    ],
  },
  'shop_isfahan_stable': {
    nameRu: 'Конюшня Исфахана',
    items: [
      { itemId: 'mount_arabian_horse', price: 5000, currency: 'gold', minLevel: 1 },
      { itemId: 'mount_bactrian_camel', price: 8000, currency: 'gold', minLevel: 10 },
      { itemId: 'mount_qizilbash_warhorse', price: 25000, currency: 'gold', minLevel: 30 },
      // Лодки покупаются отдельно (BoatSystem), но продаются в той же
      // конюшне — лодка и конь для игрока одного типа «средство передвижения»
      { itemId: 'boat_rowboat', price: 400, currency: 'gold', minLevel: 1, kind: 'boat' },
      { itemId: 'boat_fishing_skid', price: 1400, currency: 'gold', minLevel: 8, kind: 'boat' },
      { itemId: 'boat_caravel', price: 9000, currency: 'gold', minLevel: 25, kind: 'boat' },
    ],
  },
  // Притирка: рыбаки сдают улов и берут приманку
  'shop_isfahan_fishmonger': {
    nameRu: 'Притирка Исфахана',
    items: [
      { itemId: 'bait_worm', price: 3, currency: 'gold' },
      { itemId: 'fish_sprat', price: 9, currency: 'gold' },
      { itemId: 'fish_crucian', price: 18, currency: 'gold' },
      { itemId: 'fish_pike', price: 70, currency: 'gold' },
      { itemId: 'fish_catfish', price: 48, currency: 'gold' },
    ],
  },
};

/**
 * Отказ аукциона с кодом и данными для перевода.
 *
 * Раньше отказ летел строкой по-английски прямо в игрока: клиент показывает
 * err.message дословно, и текст «need 10 Isfahan silver» оказывался на
 * экране. Теперь код переводится, а сумма приходит числом и подставляется в
 * надпись через {fee}.
 */
export class AuctionError extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, string | number> = {},
    message = code
  ) {
    super(message);
    this.name = 'AuctionError';
  }
}

export class AuctionService {
  private db = DatabaseService.getInstance();
  private redis = RedisService.getInstance();
  private notifications = new NotificationService();

  /**
   * Репутация у «Торговцев Шёлкового пути» — от неё растёт пошлина за лот.
   *
   * Ошибка чтения не должна мешать выставить лот: без репутации пошлина
   * просто базовая, и игрок платит как чужак. Это честнее, чем отказ.
   */
  private async merchantsReputation(characterId: string): Promise<number> {
    try {
      const row = await this.db.queryOne<{ reputation: number | null }>(
        `SELECT reputation FROM character_reputation
         WHERE character_id = $1 AND faction = 'merchants'`,
        [characterId]
      );
      return Number(row?.reputation ?? 0);
    } catch {
      return 0;
    }
  }

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
      soldAt: null,
      expiresAt: new Date(Date.now() + durationHours * 3600 * 1000),
      createdAt: new Date(),
    };

    // Репутация читается один раз перед транзакцией: пошлина зависит от
    // ранга, а ранга нет в объекте персонажа, как и кармы.
    const репутация = await this.merchantsReputation(sellerId);

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

      // Плата за лот — исфаханским серебром, и растёт вместе с рангом у
      // «Торговцев Шёлкового пути». Это и есть обратная сторона репутации:
      // раньше репутация ничего не стоила, теперь известный торговец платит
      // за каждый лот больше.
      const silverFee = auctionListingFee(репутация);
      const fee = await client.query(
        `UPDATE characters SET isfahan_silver = isfahan_silver - $1
         WHERE id = $2 AND isfahan_silver >= $1`,
        [silverFee, sellerId]
      );
      if (fee.rowCount === 0) {
        // Сумма в сообщении — та, что действительно списана попытались, а не
        // зашитая константа: игрок должен видеть, сколько не хватило.
        throw new AuctionError('auction_no_silver', { fee: silverFee });
      }

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
    // Репутация за торговлю. Раньше не начислялась нигде — фракция
    // «Торговцы Шёлкового пути» не могла подняться в принципе.
    void grantReputation(listing.sellerId, 'auctionSale');
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
      //
      // ЧТО БЫЛО. Предмет писался прямо в character_items, минуя
      // CharacterService.addItems, — а тот проверяет вместимость сумки.
      // То есть покупка на аукционе обходила лимит слотов: сумка могла
      // переполниться, и никто этого не замечал.
      //
      // Теперь: если предмет не помещается — он ждёт в почтовом ящике.
      // Это отложенная выдача, а не выброс: игрок освободит место и заберёт
      // письмо. Сумка остаётся честной, вещь не пропадает.
      const used = await client.query(
        `SELECT COUNT(DISTINCT (item_id, enhancement)) AS slots
         FROM character_items WHERE character_id = $1`,
        [buyerId]
      );
      const sameStack = await client.query(
        `SELECT 1 FROM character_items
         WHERE character_id = $1 AND item_id = $2 AND enhancement = $3`,
        [buyerId, item.itemId, item.enhancement]
      );
      const usedSlots = Number(used.rows[0]?.slots ?? 0);
      // Новый стек занимает слот. Такой же предмет — нет, он ляжет в
      // существующий. Поэтому полная сумка не мешает докупить в стек
      const needsNewSlot = sameStack.rows.length === 0;
      const hasRoom = !needsNewSlot || usedSlots < MAX_INVENTORY_SLOTS;

      if (hasRoom) {
        await client.query(
          `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (character_id, item_id, enhancement)
           DO UPDATE SET quantity = character_items.quantity + $3`,
          [buyerId, item.itemId, item.quantity, item.enhancement]
        );
      } else {
        // В той же транзакции, что и списание золота: если письмо не
        // вставится, откатится и покупка — игрок не потеряет ни деньги,
        // ни вещь
        await client.query(
          `INSERT INTO mailbox (recipient_id, subject, body, item_id, item_qty)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            buyerId,
            'Награда с аукциона',
            `Купленное на аукционе не поместилось в сумку (${usedSlots}/${MAX_INVENTORY_SLOTS}). Освободите место и заберите письмо.`,
            item.itemId,
            item.quantity,
          ]
        );
        logger.info(`Auction: сумка полна (${usedSlots}), предмет ушёл в письмо (${item.itemId})`);
      }

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

  /**
   * Вернуть просроченные лоты продавцам.
   *
   * ЧТО БЫЛО. createListing ИЗЫМАЕТ предмет из инвентаря (эскроу) и сразу
   * списывает серебро за выставление. Лот живёт 24 часа. Ни таймера, ни
   * крона, ни задачи игрового цикла на возврат не было НИГДЕ: все обращения
   * к auction_listings — это создание, поиск, покупка, отмена и удаление
   * персонажа. То есть по истечении суток предмет просто исчезал, а
   * продавец получал «покупка не найдена» вместо вещей обратно.
   *
   * Частичный индекс idx_auction_expires ON (expires_at) WHERE sold_at IS
   * NULL был создан ровно под такой запрос — и не использовался.
   *
   * Серебро за выставление не возвращаем: это плата за место в лоте, а не за
   * продажу. Возврат сделал бы бессмысленным «выставил и снял».
   */
  async returnExpiredListings(limit = 200): Promise<number> {
    return this.db.transaction(async (client) => {
      // Забираем пачкой и сразу под FOR UPDATE: два тика подряд не должны
      // вернуть один и тот же предмет дважды
      const expired = await client.query(
        `SELECT id, seller_id, item_id, quantity, enhancement
         FROM auction_listings
         WHERE sold_at IS NULL AND expires_at <= NOW()
         ORDER BY expires_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit]
      );
      if (expired.rows.length === 0) return 0;

      for (const row of expired.rows as {
        id: string; seller_id: string; item_id: string;
        quantity: number; enhancement: number;
      }[]) {
        // Сначала возвращаем предмет, потом убираем лот. Обратный порядок
        // при падении строки потерял бы вещь продавца
        await client.query(
          `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (character_id, item_id, enhancement)
           DO UPDATE SET quantity = character_items.quantity + $3`,
          [row.seller_id, row.item_id, row.quantity, row.enhancement]
        );
        await client.query('DELETE FROM auction_listings WHERE id = $1', [row.id]);
      }

      logger.info(`[Auction] returned ${expired.rows.length} expired listing(s) to sellers`);
      return expired.rows.length;
    });
  }

  /**
   * Мои лоты — живые и просроченные.
   *
   * Раньше getSellerListings существовал и не вызывался ни разу: игрок не
   * мог увидеть, что выставил, и не мог снять.
   */
  async getSellerListings(sellerId: string): Promise<AuctionListing[]> {
    return camelizeRows<AuctionListing>(
      await this.db.query(
        `SELECT * FROM auction_listings WHERE seller_id = $1
         ORDER BY created_at DESC LIMIT 50`,
        [sellerId]
      )
    );
  }
}
