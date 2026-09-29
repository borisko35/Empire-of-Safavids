// ============================================================
// Кэш боевых бонусов экипировки — Empire of Safavids
// ============================================================
// Агрегированные характеристики экипировки персонажа с TTL 60 секунд:
// боевой путь (сокеты, тик ИИ) не должен ходить в БД на каждый удар.
// Инвалидация по TTL достаточно свежая для надевания/снятия предметов.

import { CharacterStats } from '../types/game.types';
import { CharacterService } from './CharacterService';
import { ITEMS_DATABASE } from '../data/items';

const CACHE_TTL_MS = 60 * 1000;
const ZERO: CharacterStats = { strength: 0, agility: 0, intelligence: 0, endurance: 0, charisma: 0 };

/** Параметры удара оружия, которые читает бой. */
export interface WeaponProfile {
  itemId: string;
  damage: number;
  speed: number;
  range: number;
}

/**
 * Боевые параметры оружия «в руках».
 *
 * Раньше у оружия не было ни урона, ни дальности, ни скорости: урон целиком
 * считался из характеристик, поэтому шамшир, сабля и лук били одинаково.
 * Теперь множитель, досягаемость и время замаха берутся из предмета.
 *
 * Голыми руками и с посохом мистика (посох - оружие по типу, но не клинок)
 * значения остаются боевыми по умолчанию, чтобы бой не ломался у игроков,
 * у которых в слоте ничего нет.
 */
export const DEFAULT_WEAPON: Omit<WeaponProfile, 'itemId'> = {
  damage: 1.0,
  speed: 0.45,
  range: 2.4,
};

interface CacheEntry {
  stats: CharacterStats;
  weapon: WeaponProfile | null;
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
    return (await this.getEntry(characterId)).stats;
  }

  /** Оружие «в руках»: null, если слот пуст или оружие без боевых полей */
  async getWeapon(characterId: string): Promise<WeaponProfile | null> {
    return (await this.getEntry(characterId)).weapon;
  }

  private async getEntry(characterId: string): Promise<CacheEntry> {
    const now = Date.now();
    const cached = this.cache.get(characterId);
    if (cached && now - cached.at < CACHE_TTL_MS) return cached;

    const stats: CharacterStats = { ...ZERO };
    let weapon: WeaponProfile | null = null;
    try {
      const equipment = await this.characters.getEquipment(characterId);
      for (const [key, value] of Object.entries(equipment.stats)) {
        if (key in stats) stats[key as keyof CharacterStats] = value;
      }
      const held = equipment.items.find((i) => i.slot === 'weapon');
      if (held) {
        const def = ITEMS_DATABASE[held.itemId];
        if (def?.weapon) {
          weapon = { itemId: held.itemId, ...def.weapon };
        }
      }
    } catch {
      /* экипировка недоступна — считаем без бонусов */
    }

    const entry: CacheEntry = { stats, weapon, at: now };
    this.cache.set(characterId, entry);
    return entry;
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
