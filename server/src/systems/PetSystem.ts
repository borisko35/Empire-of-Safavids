// ============================================================
// Pet System — Empire of Safavids
// ============================================================

import { DatabaseService } from '../services/DatabaseService';
import { CharacterStats } from '../types/game.types';

export type PetType = 'cat' | 'falcon' | 'cheetah' | 'fox' | 'monkey' | 'parrot';

export interface PetDefinition {
  id: string;
  name: string;
  nameRu: string;
  type: PetType;
  description: string;
  passiveBonus: Partial<CharacterStats> & {
    goldBonus?: number;       // % бонус к золоту
    expBonus?: number;        // % бонус к опыту
    lootBonus?: number;       // % шанс дополнительного лута
    craftSpeedBonus?: number; // % скорость крафта
    auctionBonus?: number;    // % снижение налога аукциона
  };
  minLevel: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  iconPath: string;
}

export const PETS: Record<string, PetDefinition> = {
  'pet_persian_cat': {
    id: 'pet_persian_cat',
    name: 'Persian Cat',
    nameRu: 'Персидская Кошка',
    type: 'cat',
    description: 'Изящная персидская кошка. Приносит удачу в торговле.',
    passiveBonus: { charisma: 5, auctionBonus: 2 },
    minLevel: 1, rarity: 'common',
    iconPath: 'icons/pets/persian_cat.png',
  },
  'pet_saker_falcon': {
    id: 'pet_saker_falcon',
    name: 'Saker Falcon',
    nameRu: 'Сапсан Сокол',
    type: 'falcon',
    description: 'Боевой сокол. Увеличивает шанс дополнительного лута.',
    passiveBonus: { agility: 8, lootBonus: 5 },
    minLevel: 15, rarity: 'rare',
    iconPath: 'icons/pets/saker_falcon.png',
  },
  'pet_cheetah': {
    id: 'pet_cheetah',
    name: 'Royal Cheetah',
    nameRu: 'Царский Гепард',
    type: 'cheetah',
    description: 'Гепард шаха. Увеличивает ловкость и шанс крита.',
    passiveBonus: { agility: 15, strength: 10 },
    minLevel: 30, rarity: 'epic',
    iconPath: 'icons/pets/royal_cheetah.png',
  },
  'pet_desert_fox': {
    id: 'pet_desert_fox',
    name: 'Desert Fox',
    nameRu: 'Пустынная Лисица',
    type: 'fox',
    description: 'Хитрая лисица. Увеличивает опыт и золото.',
    passiveBonus: { intelligence: 10, expBonus: 5, goldBonus: 3 },
    minLevel: 20, rarity: 'rare',
    iconPath: 'icons/pets/desert_fox.png',
  },
  'pet_bazaar_monkey': {
    id: 'pet_bazaar_monkey',
    name: 'Bazaar Monkey',
    nameRu: 'Базарная Обезьяна',
    type: 'monkey',
    description: 'Ловкая обезьяна. Ускоряет крафтинг.',
    passiveBonus: { charisma: 8, craftSpeedBonus: 10 },
    minLevel: 10, rarity: 'common',
    iconPath: 'icons/pets/bazaar_monkey.png',
  },
  'pet_simurgh_feather_spirit': {
    id: 'pet_simurgh_feather_spirit',
    name: 'Simurgh Spirit',
    nameRu: 'Дух Симурга',
    type: 'falcon',
    description: 'Мифический дух Симурга. Даёт бонусы ко всему.',
    passiveBonus: { intelligence: 20, expBonus: 10, lootBonus: 10, goldBonus: 5 },
    minLevel: 80, rarity: 'legendary',
    iconPath: 'icons/pets/simurgh_spirit.png',
  },
};

export class PetSystem {
  private db = DatabaseService.getInstance();

  async addPet(characterId: string, petId: string): Promise<void> {
    const def = PETS[petId];
    if (!def) throw new Error('Pet not found');
    await this.db.query(
      `INSERT INTO character_pets (character_id, pet_id, level, experience, is_active, acquired_at)
       VALUES ($1, $2, 1, 0, FALSE, NOW())
       ON CONFLICT (character_id, pet_id) DO NOTHING`,
      [characterId, petId]
    );
  }

  async activatePet(characterId: string, petId: string): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query('UPDATE character_pets SET is_active = FALSE WHERE character_id = $1', [characterId]);
      await client.query(
        'UPDATE character_pets SET is_active = TRUE WHERE character_id = $1 AND pet_id = $2',
        [characterId, petId]
      );
    });
  }

  async getActivePetBonus(characterId: string): Promise<PetDefinition['passiveBonus']> {
    const row = await this.db.queryOne<{ pet_id: string }>(
      'SELECT pet_id FROM character_pets WHERE character_id = $1 AND is_active = TRUE',
      [characterId]
    );
    if (!row) return {};
    return PETS[row.pet_id]?.passiveBonus ?? {};
  }

  async getCharacterPets(characterId: string) {
    return this.db.query(
      'SELECT * FROM character_pets WHERE character_id = $1 ORDER BY acquired_at DESC',
      [characterId]
    );
  }
}
