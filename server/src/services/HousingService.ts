// ============================================================
// Housing Service — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';

export interface House {
  id: number; character_id: string; region: string; house_type: string;
  level: number; decoration_points: number; storage_slots: number;
  craft_bonus: number;
}

export const HOUSE_TYPES: Record<string, { name: string; nameRu: string; basePrice: number; storageSlots: number; craftBonus: number }> = {
  cottage:    { name: 'Cottage', nameRu: 'Хижина', basePrice: 2000, storageSlots: 20, craftBonus: 0 },
  house:      { name: 'House', nameRu: 'Дом', basePrice: 5000, storageSlots: 40, craftBonus: 0.05 },
  villa:      { name: 'Villa', nameRu: 'Вилла', basePrice: 15000, storageSlots: 60, craftBonus: 0.10 },
  mansion:    { name: 'Mansion', nameRu: 'Особняк', basePrice: 40000, storageSlots: 80, craftBonus: 0.15 },
  palace:     { name: 'Palace', nameRu: 'Дворец', basePrice: 100000, storageSlots: 100, craftBonus: 0.20 },
};

export const DECORATIONS: Record<string, { name: string; nameRu: string; price: number; points: number }> = {
  'trophy_boss': { name: 'Boss Trophy', nameRu: 'Трофей Босса', price: 500, points: 10 },
  'silk_rug': { name: 'Silk Rug', nameRu: 'Шёлковый Ковёр', price: 300, points: 5 },
  'persian_vase': { name: 'Persian Vase', nameRu: 'Персидская Ваза', price: 200, points: 3 },
  'oil_painting': { name: 'Oil Painting', nameRu: 'Масляная Картина', price: 800, points: 8 },
  'golden_chandelier': { name: 'Golden Chandelier', nameRu: 'Золотая Люстра', price: 1500, points: 15 },
  'weapon_rack': { name: 'Weapon Rack', nameRu: 'Оружейная Стойка', price: 400, points: 6 },
  'garden_fountain': { name: 'Garden Fountain', nameRu: 'Садовый Фонтан', price: 2000, points: 20 },
  'ancient_bookshelf': { name: 'Ancient Bookshelf', nameRu: 'Древний Шкаф', price: 600, points: 7 },
};

export class HousingService {
  private db = DatabaseService.getInstance();

  async getHouse(charId: string): Promise<House | null> {
    return this.db.queryOne<House>('SELECT * FROM player_houses WHERE character_id = $1', [charId]);
  }

  async buyHouse(charId: string, region: string, houseType: string): Promise<House> {
    const existing = await this.getHouse(charId);
    if (existing) throw new Error('Already own a house');
    const def = HOUSE_TYPES[houseType];
    if (!def) throw new Error('Invalid house type');

    const char = await this.db.queryOne<{ gold: number }>('SELECT gold FROM characters WHERE id = $1', [charId]);
    if (!char || char.gold < def.basePrice) throw new Error('Not enough gold');

    await this.db.query('UPDATE characters SET gold = gold - $1 WHERE id = $2', [def.basePrice, charId]);
    const house = await this.db.queryOne<House>(
      `INSERT INTO player_houses (character_id, region, house_type, storage_slots, craft_bonus)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [charId, region, houseType, def.storageSlots, def.craftBonus]
    );
    logger.info(`[Housing] ${charId} bought ${houseType} in ${region}`);
    return house!;
  }

  async upgradeHouse(charId: string): Promise<House> {
    const house = await this.getHouse(charId);
    if (!house) throw new Error('No house');
    const types = Object.keys(HOUSE_TYPES);
    const currentIdx = types.indexOf(house.house_type);
    if (currentIdx >= types.length - 1) throw new Error('Already max level');
    const nextType = types[currentIdx + 1];
    const def = HOUSE_TYPES[nextType];
    const char = await this.db.queryOne<{ gold: number }>('SELECT gold FROM characters WHERE id = $1', [charId]);
    if (!char || char.gold < def.basePrice) throw new Error('Not enough gold');
    await this.db.query('UPDATE characters SET gold = gold - $1 WHERE id = $2', [def.basePrice, charId]);
    await this.db.query(
      'UPDATE player_houses SET house_type = $1, level = level + 1, storage_slots = $2, craft_bonus = $3 WHERE character_id = $4',
      [nextType, def.storageSlots, def.craftBonus, charId]
    );
    return (await this.getHouse(charId))!;
  }

  async placeDecoration(charId: string, decorId: string): Promise<void> {
    const house = await this.getHouse(charId);
    if (!house) throw new Error('No house');
    const def = DECORATIONS[decorId];
    if (!def) throw new Error('Invalid decoration');
    const char = await this.db.queryOne<{ gold: number }>('SELECT gold FROM characters WHERE id = $1', [charId]);
    if (!char || char.gold < def.price) throw new Error('Not enough gold');
    await this.db.query('UPDATE characters SET gold = gold - $1 WHERE id = $2', [def.price, charId]);
    await this.db.query(
      'INSERT INTO house_decorations (house_id, item_id) VALUES ($1, $2)',
      [house.id, decorId]
    );
    await this.db.query(
      'UPDATE player_houses SET decoration_points = decoration_points + $1 WHERE id = $2',
      [def.points, house.id]
    );
  }

  async getDecorations(charId: string): Promise<{ item_id: string }[]> {
    const house = await this.getHouse(charId);
    if (!house) return [];
    return this.db.query<{ item_id: string }>(
      'SELECT item_id FROM house_decorations WHERE house_id = $1', [house.id]
    );
  }
}
