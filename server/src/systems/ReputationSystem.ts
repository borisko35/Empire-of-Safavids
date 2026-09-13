// ============================================================
// Система репутации и фракций — Empire of Safavids
// ============================================================

import { DatabaseService } from '../services/DatabaseService';
import { logger } from '../utils/logger';

export type FactionId =
  | 'safavid_empire'
  | 'ottoman_empire'
  | 'silk_road_merchants'
  | 'shiraz_scholars'
  | 'caucasus_tribes'
  | 'persian_gulf_pirates'
  | 'sufi_order';

export type ReputationRank =
  | 'hated'       // -6000 и ниже
  | 'hostile'     // -6000 – -3000
  | 'unfriendly'  // -3000 – 0
  | 'neutral'     //  0 – 3000
  | 'friendly'    //  3000 – 9000
  | 'honored'     //  9000 – 21000
  | 'revered'     //  21000 – 42000
  | 'exalted';    //  42000+

export interface FactionDefinition {
  id: FactionId;
  name: string;
  nameRu: string;
  description: string;
  capital: string;
  enemies: FactionId[];
  allies: FactionId[];
  rewards: Record<ReputationRank, string[]>; // разблокируемые предметы/скидки
}

export const REPUTATION_THRESHOLDS: Record<ReputationRank, number> = {
  hated:      -6000,
  hostile:    -3000,
  unfriendly: 0,
  neutral:    3000,
  friendly:   9000,
  honored:    21000,
  revered:    42000,
  exalted:    Infinity,
};

export const FACTIONS: Record<FactionId, FactionDefinition> = {
  safavid_empire: {
    id: 'safavid_empire',
    name: 'Safavid Empire',
    nameRu: 'Сефевидская Империя',
    description: 'Главная фракция игры. Верность Шаху открывает лучшие награды.',
    capital: 'Tabriz / Isfahan',
    enemies: ['ottoman_empire'],
    allies: ['sufi_order', 'silk_road_merchants'],
    rewards: {
      hated:      [],
      hostile:    [],
      unfriendly: [],
      neutral:    ['access_tabriz_market'],
      friendly:   ['discount_5pct', 'access_royal_armory'],
      honored:    ['discount_10pct', 'elite_guard_mount'],
      revered:    ['discount_15pct', 'qizilbash_armor_set'],
      exalted:    ['discount_20pct', 'shah_title', 'legendary_weapon_token'],
    },
  },
  ottoman_empire: {
    id: 'ottoman_empire',
    name: 'Ottoman Empire',
    nameRu: 'Османская Империя',
    description: 'Главный враг Сефевидов. Репутация здесь даёт доступ к османскому снаряжению.',
    capital: 'Mesopotamia',
    enemies: ['safavid_empire', 'caucasus_tribes'],
    allies: [],
    rewards: {
      hated:      [],
      hostile:    [],
      unfriendly: [],
      neutral:    ['access_ottoman_market'],
      friendly:   ['janissary_armor', 'musket_blueprint'],
      honored:    ['ottoman_warhorse', 'discount_10pct'],
      revered:    ['grand_vizier_robe', 'discount_15pct'],
      exalted:    ['pasha_title', 'ottoman_legendary_set'],
    },
  },
  silk_road_merchants: {
    id: 'silk_road_merchants',
    name: 'Silk Road Merchants Guild',
    nameRu: 'Гильдия Торговцев Шёлкового Пути',
    description: 'Нейтральная фракция. Улучшает цены в аукционном доме и магазинах.',
    capital: 'Isfahan',
    enemies: ['persian_gulf_pirates'],
    allies: ['safavid_empire', 'shiraz_scholars'],
    rewards: {
      hated:      [],
      hostile:    [],
      unfriendly: [],
      neutral:    ['auction_fee_5pct'],
      friendly:   ['auction_fee_4pct', 'merchant_cart_mount'],
      honored:    ['auction_fee_3pct', 'trade_route_bonus'],
      revered:    ['auction_fee_2pct', 'silk_road_amulet'],
      exalted:    ['auction_fee_1pct', 'grand_merchant_title', 'caravan_elephant_mount'],
    },
  },
  shiraz_scholars: {
    id: 'shiraz_scholars',
    name: 'Scholars of Shiraz',
    nameRu: 'Учёные Шираза',
    description: 'Фракция поэтов, алхимиков и учёных. Даёт бонус к опыту и рецептам.',
    capital: 'Shiraz',
    enemies: [],
    allies: ['silk_road_merchants', 'sufi_order'],
    rewards: {
      hated:      [],
      hostile:    [],
      unfriendly: [],
      neutral:    ['exp_bonus_5pct'],
      friendly:   ['exp_bonus_10pct', 'scholar_robe'],
      honored:    ['exp_bonus_15pct', 'rare_recipe_scroll'],
      revered:    ['exp_bonus_20pct', 'hafiz_poetry_buff'],
      exalted:    ['exp_bonus_25pct', 'grand_scholar_title', 'legendary_recipe_scroll'],
    },
  },
  caucasus_tribes: {
    id: 'caucasus_tribes',
    name: 'Caucasus Mountain Tribes',
    nameRu: 'Кавказские Горные Племена',
    description: 'Дикие воины гор. Дают доступ к уникальным горным маршрутам и оружию.',
    capital: 'Caucasus',
    enemies: ['ottoman_empire'],
    allies: ['safavid_empire'],
    rewards: {
      hated:      [],
      hostile:    [],
      unfriendly: [],
      neutral:    ['caucasus_map_access'],
      friendly:   ['mountain_horse_mount', 'tribal_armor'],
      honored:    ['eagle_companion_pet', 'pvp_damage_5pct'],
      revered:    ['warchief_title', 'legendary_tribal_weapon'],
      exalted:    ['khan_title', 'mythic_eagle_mount', 'pvp_damage_10pct'],
    },
  },
  persian_gulf_pirates: {
    id: 'persian_gulf_pirates',
    name: 'Persian Gulf Pirates',
    nameRu: 'Пираты Персидского Залива',
    description: 'Беззаконные мореплаватели. Дают доступ к морским маршрутам и контрабанде.',
    capital: 'Persian Gulf',
    enemies: ['silk_road_merchants', 'safavid_empire'],
    allies: [],
    rewards: {
      hated:      [],
      hostile:    [],
      unfriendly: [],
      neutral:    ['sea_route_access'],
      friendly:   ['pirate_ship_skin', 'smuggler_discount'],
      honored:    ['corsair_armor', 'sea_speed_20pct'],
      revered:    ['pirate_captain_title', 'legendary_cutlass'],
      exalted:    ['pirate_king_title', 'ghost_ship_mount', 'sea_speed_40pct'],
    },
  },
  sufi_order: {
    id: 'sufi_order',
    name: 'Order of the Sufi Mystics',
    nameRu: 'Орден Суфийских Мистиков',
    description: 'Древний орден. Усиливает магические способности и даёт доступ к секретным знаниям.',
    capital: 'Shiraz',
    enemies: [],
    allies: ['safavid_empire', 'shiraz_scholars'],
    rewards: {
      hated:      [],
      hostile:    [],
      unfriendly: [],
      neutral:    ['mana_regen_5pct'],
      friendly:   ['mana_regen_10pct', 'sufi_robe'],
      honored:    ['mana_regen_15pct', 'mystic_staff_skin'],
      revered:    ['mana_regen_20pct', 'dervish_title'],
      exalted:    ['mana_regen_30pct', 'grand_sufi_title', 'rumi_legendary_staff'],
    },
  },
};

export function getReputationRank(points: number): ReputationRank {
  if (points < -6000) return 'hated';
  if (points < -3000) return 'hostile';
  if (points < 0)     return 'unfriendly';
  if (points < 3000)  return 'neutral';
  if (points < 9000)  return 'friendly';
  if (points < 21000) return 'honored';
  if (points < 42000) return 'revered';
  return 'exalted';
}

export class ReputationSystem {
  private db = DatabaseService.getInstance();

  async addReputation(characterId: string, factionId: FactionId, amount: number): Promise<{
    newPoints: number;
    newRank: ReputationRank;
    rankChanged: boolean;
    unlockedRewards: string[];
  }> {
    const existing = await this.db.queryOne<{ points: number; rank: string }>(
      'SELECT points, rank FROM character_reputation WHERE character_id = $1 AND faction = $2',
      [characterId, factionId]
    );

    const oldPoints = existing?.points ?? 0;
    const oldRank   = existing?.rank as ReputationRank ?? 'neutral';
    const newPoints = Math.max(-10000, Math.min(50000, oldPoints + amount));
    const newRank   = getReputationRank(newPoints);
    const rankChanged = newRank !== oldRank;

    await this.db.query(
      `INSERT INTO character_reputation (character_id, faction, points, rank)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (character_id, faction)
       DO UPDATE SET points = $3, rank = $4`,
      [characterId, factionId, newPoints, newRank]
    );

    // Если ранг вырос — возвращаем новые награды
    const unlockedRewards = rankChanged
      ? (FACTIONS[factionId]?.rewards[newRank] ?? [])
      : [];

    // Если фракции враждуют — снижаем репутацию у врагов
    const faction = FACTIONS[factionId];
    if (amount > 0 && faction?.enemies.length) {
      for (const enemyId of faction.enemies) {
        await this.db.query(
          `INSERT INTO character_reputation (character_id, faction, points, rank)
           VALUES ($1, $2, GREATEST(-10000, COALESCE((SELECT points FROM character_reputation WHERE character_id=$1 AND faction=$2), 0) - $3), 'hostile')
           ON CONFLICT (character_id, faction)
           DO UPDATE SET points = GREATEST(-10000, character_reputation.points - $3),
                         rank = CASE WHEN character_reputation.points - $3 < -3000 THEN 'hostile' ELSE character_reputation.rank END`,
          [characterId, enemyId, Math.floor(amount * 0.5)]
        );
      }
    }

    if (rankChanged) {
      logger.info(`Reputation: ${characterId} → ${factionId}: ${oldRank} → ${newRank} (${newPoints}pts)`);
    }

    return { newPoints, newRank, rankChanged, unlockedRewards };
  }

  async getAllReputation(characterId: string): Promise<Record<FactionId, { points: number; rank: ReputationRank }>> {
    const rows = await this.db.query<{ faction: string; points: number; rank: string }>(
      'SELECT faction, points, rank FROM character_reputation WHERE character_id = $1',
      [characterId]
    );
    const result: Partial<Record<FactionId, { points: number; rank: ReputationRank }>> = {};
    for (const row of rows) {
      result[row.faction as FactionId] = { points: row.points, rank: row.rank as ReputationRank };
    }
    return result as Record<FactionId, { points: number; rank: ReputationRank }>;
  }
}
