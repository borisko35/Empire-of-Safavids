// ============================================================
// Кэш боевых бонусов экипировки — Empire of Safavids
// ============================================================
// Агрегированные характеристики экипировки персонажа с TTL 60 секунд:
// боевой путь (сокеты, тик ИИ) не должен ходить в БД на каждый удар.
// Инвалидация по TTL достаточно свежая для надевания/снятия предметов.

import { CharacterStats } from '../types/game.types';
import { CharacterService } from './CharacterService';

const CACHE_TTL_MS = 60 * 1000;
const ZERO: CharacterStats = { strength: 0, agility: 0, intelligence: 0, endurance: 0, charisma: 0 };

interface CacheEntry {
  stats: CharacterStats;
  at: number;
}

export class EquipmentCache {
  private static instance: EquipmentCache;
  private cache = new Map<string, CacheEntry>();
  private characters = new CharacterService();

  static getInstance(): EquipmentCache {
    if (!EquipmentCache.instance) {
      EquipmentCache.instance = new EquipmentCache();
    }
    return EquipmentCache.instance;
  }

  /** Бонусы экипировки (нули, если ничего не надето / БД недоступна) */
  async getStats(characterId: string): Promise<CharacterStats> {
    const now = Date.now();
    const cached = this.cache.get(characterId);
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.stats;

    const stats: CharacterStats = { ...ZERO };
    try {
      const equipment = await this.characters.getEquipment(characterId);
      for (const [key, value] of Object.entries(equipment.stats)) {
        if (key in stats) stats[key as keyof CharacterStats] = value;
      }
    } catch {
      /* экипировка недоступна — считаем без бонусов */
    }

    this.cache.set(characterId, { stats, at: now });
    return stats;
  }

  /** Слить бонусы экипировки в копию статов персонажа */
  async mergeInto(character: { id: string; stats: CharacterStats }): Promise<CharacterStats> {
    const bonus = await this.getStats(character.id);
    return {
      strength: character.stats.strength + bonus.strength,
      agility: character.stats.agility + bonus.agility,
      intelligence: character.stats.intelligence + bonus.intelligence,
      endurance: character.stats.endurance + bonus.endurance,
      charisma: character.stats.charisma + bonus.charisma,
    };
  }

  invalidate(characterId: string): void {
    this.cache.delete(characterId);
  }
}
