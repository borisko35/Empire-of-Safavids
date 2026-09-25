// ============================================================
// Pet Service — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';

export interface PetDef {
  id: string; name: string; name_ru: string; type: string; rarity: string;
  base_strength: number; base_agility: number; base_intelligence: number;
  ability_name: string; ability_name_ru: string; ability_damage: number;
  ability_cooldown: number; model_path: string;
}

export const PETS_DATABASE: PetDef[] = [
  { id: 'pet_wolf', name: 'Grey Wolf', name_ru: 'Серый Волк', type: 'combat', rarity: 'common',
    base_strength: 5, base_agility: 8, base_intelligence: 0,
    ability_name: 'Fang Strike', ability_name_ru: 'Удар Клыком', ability_damage: 15, ability_cooldown: 8,
    model_path: 'models/pets/wolf.fbx' },
  { id: 'pet_falcon', name: 'Desert Falcon', name_ru: 'Пустынный Сокол', type: 'scout', rarity: 'uncommon',
    base_strength: 2, base_agility: 12, base_intelligence: 5,
    ability_name: 'Eye of the Hawk', ability_name_ru: 'Глаз Сокола', ability_damage: 10, ability_cooldown: 12,
    model_path: 'models/pets/falcon.fbx' },
  { id: 'pet_cat', name: 'Isfahan Cat', name_ru: 'Исфаханская Кошка', type: 'support', rarity: 'common',
    base_strength: 3, base_agility: 10, base_intelligence: 8,
    ability_name: 'Healing Purr', ability_name_ru: 'Целебное Мурлыканье', ability_damage: -20, ability_cooldown: 15,
    model_path: 'models/pets/cat.fbx' },
  { id: 'pet_snake', name: 'Royal Cobra', name_ru: 'Королевская Кобра', type: 'combat', rarity: 'rare',
    base_strength: 8, base_agility: 6, base_intelligence: 10,
    ability_name: 'Venom Spit', ability_name_ru: 'Ядовитое Плевание', ability_damage: 25, ability_cooldown: 10,
    model_path: 'models/pets/snake.fbx' },
  { id: 'pet_simurgh_chick', name: 'Simurgh Chick', name_ru: 'Птенец Симурга', type: 'mythical', rarity: 'epic',
    base_strength: 12, base_agility: 12, base_intelligence: 15,
    ability_name: 'Flame Breath', ability_name_ru: 'Огненное Дыхание', ability_damage: 40, ability_cooldown: 18,
    model_path: 'models/pets/simurgh_chick.fbx' },
  { id: 'pet_dragon', name: 'Baby Dragon', name_ru: 'Малыш Дракон', type: 'mythical', rarity: 'legendary',
    base_strength: 20, base_agility: 15, base_intelligence: 20,
    ability_name: 'Dragon Fire', ability_name_ru: 'Драконий Огонь', ability_damage: 60, ability_cooldown: 20,
    model_path: 'models/pets/baby_dragon.fbx' },
];

export interface PlayerPet {
  id: number; pet_id: string; nickname: string | null; level: number;
  experience: number; is_active: boolean;
}

export class PetService {
  private db = DatabaseService.getInstance();

  async getPets(charId: string): Promise<PlayerPet[]> {
    return this.db.query<PlayerPet>(
      'SELECT id, pet_id, nickname, level, experience, is_active FROM character_pets WHERE character_id = $1 ORDER BY level DESC',
      [charId]
    );
  }

  async getActivePet(charId: string): Promise<PlayerPet | null> {
    return this.db.queryOne<PlayerPet>(
      'SELECT id, pet_id, nickname, level, experience, is_active FROM character_pets WHERE character_id = $1 AND is_active = TRUE',
      [charId]
    );
  }

  async acquirePet(charId: string, petId: string): Promise<PlayerPet> {
    const def = PETS_DATABASE.find(p => p.id === petId);
    if (!def) throw new Error('Pet not found');
    const existing = await this.db.queryOne(
      'SELECT id FROM character_pets WHERE character_id = $1 AND pet_id = $2',
      [charId, petId]
    );
    if (existing) throw new Error('Already own this pet');
    const result = await this.db.queryOne<PlayerPet>(
      'INSERT INTO character_pets (character_id, pet_id) VALUES ($1, $2) RETURNING id, pet_id, nickname, level, experience, is_active',
      [charId, petId]
    );
    logger.info(`[Pet] ${charId} acquired: ${petId}`);
    return result!;
  }

  async setActive(charId: string, petDbId: number): Promise<void> {
    await this.db.query('UPDATE character_pets SET is_active = FALSE WHERE character_id = $1', [charId]);
    await this.db.query('UPDATE character_pets SET is_active = TRUE WHERE character_id = $1 AND id = $2', [charId, petDbId]);
  }

  async addExperience(charId: string, amount: number): Promise<{ levelUp: boolean; newLevel?: number }> {
    const pet = await this.getActivePet(charId);
    if (!pet) return { levelUp: false };
    const xpNeeded = pet.level * 200;
    const newExp = pet.experience + amount;
    if (newExp >= xpNeeded) {
      const newLevel = pet.level + 1;
      await this.db.query(
        'UPDATE character_pets SET experience = $1, level = $2 WHERE id = $3',
        [newExp - xpNeeded, newLevel, pet.id]
      );
      logger.info(`[Pet] Pet leveled up to ${newLevel} for ${charId}`);
      return { levelUp: true, newLevel };
    }
    await this.db.query('UPDATE character_pets SET experience = $1 WHERE id = $2', [newExp, pet.id]);
    return { levelUp: false };
  }

  async renamePet(charId: string, petDbId: number, nickname: string): Promise<void> {
    await this.db.query(
      'UPDATE character_pets SET nickname = $1 WHERE id = $2 AND character_id = $3',
      [nickname.slice(0, 50), petDbId, charId]
    );
  }

  async releasePet(charId: string, petDbId: number): Promise<void> {
    await this.db.query('DELETE FROM character_pets WHERE id = $1 AND character_id = $2', [petDbId, charId]);
  }

  getAllDefs(): PetDef[] { return PETS_DATABASE; }
  getDef(id: string): PetDef | undefined { return PETS_DATABASE.find(p => p.id === id); }
}
