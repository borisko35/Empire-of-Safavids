// ============================================================
// Premium & Battle Pass System — Empire of Safavids
// ============================================================

import { DatabaseService } from '../services/DatabaseService';
import { logger } from '../utils/logger';

// ============================================================
// PREMIUM АККАУНТ
// ============================================================
export interface PremiumBenefits {
  expMultiplier: number;      // 1.5x
  goldMultiplier: number;     // 1.3x
  extraInventorySlots: number; // +50
  craftSpeedBonus: number;    // -20%
  auctionFeeDiscount: number; // -2%
  vipChatAccess: boolean;
  dailyGems: number;          // ежедневные премиум-кристаллы
  extraCharacterSlot: boolean;
}

export const PREMIUM_BENEFITS: PremiumBenefits = {
  expMultiplier: 1.5,
  goldMultiplier: 1.3,
  extraInventorySlots: 50,
  craftSpeedBonus: 0.20,
  auctionFeeDiscount: 0.02,
  vipChatAccess: true,
  dailyGems: 10,
  extraCharacterSlot: true,
};

// ============================================================
// БОЕВОЙ ПРОПУСК
// ============================================================
export interface BattlePassTier {
  tier: number;           // 1–50
  requiredPoints: number; // очки сезона
  freeReward: BattlePassReward;
  premiumReward: BattlePassReward;
}

export interface BattlePassReward {
  type: 'item' | 'gold' | 'gems' | 'mount' | 'pet' | 'title' | 'cosmetic' | 'exp_scroll';
  id?: string;
  amount?: number;
  nameRu: string;
}

export const CURRENT_SEASON = {
  id: 'season_1_safavid_glory',
  nameRu: 'Сезон 1: Слава Сефевидов',
  startDate: new Date('2025-01-01'),
  endDate: new Date('2025-04-01'),
  premiumPrice: 1000, // в гемах
};

export const BATTLE_PASS_TIERS: BattlePassTier[] = [
  { tier: 1,  requiredPoints: 0,    freeReward: { type: 'gold',       amount: 500,   nameRu: '500 золота' },                    premiumReward: { type: 'gems',      amount: 50,    nameRu: '50 гемов' } },
  { tier: 5,  requiredPoints: 400,  freeReward: { type: 'exp_scroll', amount: 2,     nameRu: '2 свитка опыта' },             premiumReward: { type: 'cosmetic',  id: 'skin_tabriz_warrior', nameRu: 'Скин «Воин Тебриза»' } },
  { tier: 10, requiredPoints: 900,  freeReward: { type: 'item',       id: 'mat_turquoise', amount: 5, nameRu: '5 бирюз' },  premiumReward: { type: 'pet',       id: 'pet_desert_fox',      nameRu: 'Питомец Пустынная Лисица' } },
  { tier: 15, requiredPoints: 1400, freeReward: { type: 'gold',       amount: 2000,  nameRu: '2000 золота' },                  premiumReward: { type: 'cosmetic',  id: 'effect_fire_trail',   nameRu: 'Эффект «Огненный След»' } },
  { tier: 20, requiredPoints: 1900, freeReward: { type: 'exp_scroll', amount: 5,     nameRu: '5 свитков опыта' },           premiumReward: { type: 'mount',     id: 'mount_qizilbash_warhorse', nameRu: 'Маунт Кызылбаш' } },
  { tier: 25, requiredPoints: 2400, freeReward: { type: 'item',       id: 'mat_dragon_scale', amount: 2, nameRu: '2 пера Симурга' }, premiumReward: { type: 'title',     id: 'title_season1',       nameRu: 'Титул «Герой Сезона»' } },
  { tier: 30, requiredPoints: 2900, freeReward: { type: 'gold',       amount: 5000,  nameRu: '5000 золота' },                  premiumReward: { type: 'cosmetic',  id: 'armor_skin_isfahan',  nameRu: 'Скин «Доспех Исфахана»' } },
  { tier: 40, requiredPoints: 3900, freeReward: { type: 'gems',       amount: 100,   nameRu: '100 гемов' },                      premiumReward: { type: 'pet',       id: 'pet_saker_falcon',    nameRu: 'Питомец Сапсан Сокол' } },
  { tier: 50, requiredPoints: 4900, freeReward: { type: 'item',       id: 'mat_dragon_scale', amount: 5, nameRu: '5 перьев Симурга' }, premiumReward: { type: 'mount',     id: 'mount_simurgh_chick', nameRu: 'Маунт Молодой Симург' } },
];

export class PremiumSystem {
  private db           = DatabaseService.getInstance();

  // ============================================================
  // Активация Premium
  // ============================================================
  async activatePremium(userId: string, durationDays: number): Promise<void> {
    const expiresAt = new Date(Date.now() + durationDays * 86400 * 1000);
    await this.db.query(
      `INSERT INTO premium_subscriptions (user_id, expires_at, activated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET expires_at = GREATEST(premium_subscriptions.expires_at, $2)`,
      [userId, expiresAt]
    );
    logger.info(`Premium activated: ${userId} until ${expiresAt.toISOString()}`);
  }

  async isPremium(userId: string): Promise<boolean> {
    const row = await this.db.queryOne<{ expires_at: Date }>(
      'SELECT expires_at FROM premium_subscriptions WHERE user_id = $1 AND expires_at > NOW()',
      [userId]
    );
    return !!row;
  }

  async getPremiumBenefits(userId: string): Promise<PremiumBenefits | null> {
    const active = await this.isPremium(userId);
    return active ? PREMIUM_BENEFITS : null;
  }

  // ============================================================
  // Боевой Пропуск
  // ============================================================
  async purchaseBattlePass(characterId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO battle_pass_progress (character_id, season_id, is_premium, points, claimed_tiers)
       VALUES ($1, $2, TRUE, 0, '[]')
       ON CONFLICT (character_id, season_id) DO UPDATE SET is_premium = TRUE`,
      [characterId, CURRENT_SEASON.id]
    );
    logger.info(`Battle Pass purchased: ${characterId}`);
  }

  async addSeasonPoints(characterId: string, points: number): Promise<{ newTiersUnlocked: number[] }> {
    const row = await this.db.queryOne<{ points: number; is_premium: boolean; claimed_tiers: number[] }>(
      `SELECT points, is_premium, claimed_tiers FROM battle_pass_progress
       WHERE character_id = $1 AND season_id = $2`,
      [characterId, CURRENT_SEASON.id]
    );

    if (!row) {
      // Авторегистрация в бесплатном БП
      await this.db.query(
        `INSERT INTO battle_pass_progress (character_id, season_id, is_premium, points, claimed_tiers)
         VALUES ($1, $2, FALSE, $3, '[]')`,
        [characterId, CURRENT_SEASON.id, points]
      );
      return { newTiersUnlocked: [] };
    }

    const newPoints = row.points + points;
    await this.db.query(
      'UPDATE battle_pass_progress SET points = $1 WHERE character_id = $2 AND season_id = $3',
      [newPoints, characterId, CURRENT_SEASON.id]
    );

    // Определяем новые доступные тиры
    const newTiers = BATTLE_PASS_TIERS
      .filter(t => t.requiredPoints <= newPoints && !row.claimed_tiers.includes(t.tier))
      .map(t => t.tier);

    return { newTiersUnlocked: newTiers };
  }

  async claimTierReward(
    characterId: string,
    tier: number,
    isPremiumReward: boolean
  ): Promise<BattlePassReward | null> {
    const progress = await this.db.queryOne<{ points: number; is_premium: boolean; claimed_tiers: number[] }>(
      'SELECT points, is_premium, claimed_tiers FROM battle_pass_progress WHERE character_id = $1 AND season_id = $2',
      [characterId, CURRENT_SEASON.id]
    );
    if (!progress) return null;

    const tierDef = BATTLE_PASS_TIERS.find(t => t.tier === tier);
    if (!tierDef || progress.points < tierDef.requiredPoints) return null;
    if (isPremiumReward && !progress.is_premium) return null;
    if (progress.claimed_tiers.includes(tier)) return null;

    const reward = isPremiumReward ? tierDef.premiumReward : tierDef.freeReward;

    // Выдаём награду
    await this.db.transaction(async (client) => {
      if (reward.type === 'gold' && reward.amount) {
        await client.query('UPDATE characters SET gold = gold + $1 WHERE id = $2', [reward.amount, characterId]);
      } else if (reward.type === 'item' && reward.id && reward.amount) {
        await client.query(
          `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
           VALUES ($1, $2, $3, 0)
           ON CONFLICT (character_id, item_id, enhancement)
           DO UPDATE SET quantity = character_items.quantity + $3`,
          [characterId, reward.id, reward.amount]
        );
      } else if (reward.type === 'title' && reward.id) {
        await client.query(
          'INSERT INTO character_titles (character_id, title) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [characterId, reward.nameRu]
        );
      } else if (reward.type === 'gems' && reward.amount) {
        // Гемы сезона начисляются AZENS — единой премиум-валютой игры.
        await client.query('UPDATE characters SET azens = azens + $1 WHERE id = $2', [reward.amount, characterId]);
      }

      const updatedTiers = [...progress.claimed_tiers, tier];
      await client.query(
        'UPDATE battle_pass_progress SET claimed_tiers = $1 WHERE character_id = $2 AND season_id = $3',
        [JSON.stringify(updatedTiers), characterId, CURRENT_SEASON.id]
      );
    });

    logger.info(`Battle Pass reward claimed: ${characterId} tier ${tier} (${reward.nameRu})`);
    return reward;
  }

  async getProgress(characterId: string) {
    return this.db.queryOne(
      'SELECT * FROM battle_pass_progress WHERE character_id = $1 AND season_id = $2',
      [characterId, CURRENT_SEASON.id]
    );
  }
}
