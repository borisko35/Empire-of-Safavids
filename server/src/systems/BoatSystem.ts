// ============================================================
// Boat System — Лодки — Empire of Safavids
// ============================================================
// Лодка — не предмет в сумке, а отдельное «средство передвижения»
// с собственным каталогом (как кони в MountSystem): покупается один
// раз, активируется, и работает только на воде.
//
// Зачем это: вода в игре тормозит и требует выносливости. Лодка
// снимает замедление, добавляет бонус к рыбалке и открывает рыбалку
// в глубокой воде, куда с берега не дойти.

import { DatabaseService } from '../services/DatabaseService';
import { CharacterService } from '../services/CharacterService';
import { canFloatAt } from '../utils/spawn';
import { logger } from '../utils/logger';

export type BoatType = 'rowboat' | 'fishing' | 'caravel' | 'dhow' | 'galley';

export interface BoatDefinition {
  id: string;
  name: string;
  nameRu: string;
  type: BoatType;
  /**
   * Доля снятого замедления воды: 1 — вода не тормозит совсем.
   * Те же значения, что у waterSpeed у сапогов, только масштабнее.
   */
  waterSpeed: number;
  /** Скорость в воде, м/с (считается как SWIM_SPEED + запас) */
  swimSpeed: number;
  /** Множитель удачи на поклёвку: 1.0 — как с берега */
  fishingBonus: number;
  /** Сколько рыбы можно поймать за одну «сессию» без перерыва */
  catchLimit: number;
  /** Сколько стоит лодка в магазине */
  price: number;
  minLevel: number;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  description: string;
  descriptionRu: string;
  iconPath: string;
}

export interface PlayerBoat {
  characterId: string;
  boatId: string;
  isActive: boolean;
  acquiredAt: Date;
  /** Сколько рыбы поймано на этой лодке всего — для статистики */
  totalCatches: number;
  /**
   * Усталость: рыбы, пойманные без выхода на берег. Достигла catchLimit —
   * лодку надо разогнать (выйти и снова встать). Без этого лодка
   * превращалась бы в бесконечный фарм без последствий.
   */
  fatigue: number;
}

export const BOATS: Record<string, BoatDefinition> = {
  'boat_rowboat': {
    id: 'boat_rowboat',
    name: 'Rowboat',
    nameRu: 'Простая Лодка',
    type: 'rowboat',
    waterSpeed: 0.6, swimSpeed: 4.2,
    fishingBonus: 1.0, catchLimit: 10,
    price: 400, minLevel: 1,
    rarity: 'common',
    description: 'Two oars and a leaky bottom. Better than swimming, worse than everything else.',
    descriptionRu: 'Два весла и немного протечек. Лучше, чем плавать, хуже остального.',
    iconPath: 'icons/boats/rowboat.png',
  },
  'boat_fishing_skid': {
    id: 'boat_fishing_skid',
    name: 'Fishing Skiff',
    nameRu: 'Рыбацкая Байда',
    type: 'fishing',
    waterSpeed: 0.7, swimSpeed: 4.6,
    fishingBonus: 1.35, catchLimit: 15,
    price: 1400, minLevel: 8,
    rarity: 'uncommon',
    description: 'Built for the shallows: low sides, a bait box and room for a net.',
    descriptionRu: 'Сделана для мелководья: низкие борта, ящик для приманки и место для невода.',
    iconPath: 'icons/boats/rowboat.png',
  },
  'boat_caravel': {
    id: 'boat_caravel',
    name: 'Caravel',
    nameRu: 'Каравелла',
    type: 'caravel',
    waterSpeed: 0.95, swimSpeed: 6.0,
    fishingBonus: 1.6, catchLimit: 25,
    price: 9000, minLevel: 25,
    rarity: 'rare',
    description: 'Decked and seaworthy. The Gulf fishermen cross to Hormuz in these.',
    descriptionRu: 'С палубой и океанная. На таких заливские рыбаки ходят до Ормуза.',
    iconPath: 'icons/boats/rowboat.png',
  },
  'boat_dhow': {
    id: 'boat_dhow',
    name: 'Dhow of the Gulf',
    nameRu: 'Дхоу Залива',
    type: 'dhow',
    waterSpeed: 1.0, swimSpeed: 6.8,
    fishingBonus: 1.9, catchLimit: 35,
    price: 26000, minLevel: 45,
    rarity: 'epic',
    description: 'Lateen sails of patched cloth. Fast in any wind, and she carries a lot of fish.',
    descriptionRu: 'Поздние паруса из латанной ткани. Быстра при любом ветре и несёт много рыбы.',
    iconPath: 'icons/boats/rowboat.png',
  },
  'boat_galley': {
    id: 'boat_galley',
    name: 'Shah’s Galley',
    nameRu: 'Галея Шаха',
    type: 'galley',
    waterSpeed: 1.0, swimSpeed: 7.6,
    fishingBonus: 2.4, catchLimit: 50,
    price: 80000, minLevel: 65,
    rarity: 'legendary',
    description: 'Twenty-eight oars and a gilded stern. The Shah fishes better than anyone.',
    descriptionRu: 'Двадцать восемь весел и позолоченная корма. Рыбачит шах лучше всех.',
    iconPath: 'icons/boats/rowboat.png',
  },
};

/** Лодка по id; null если лодки у игрока нет */
export function getBoatDef(boatId: string | null | undefined): BoatDefinition | null {
  if (!boatId) return null;
  return BOATS[boatId] ?? null;
}

export class BoatSystem {
  private db = DatabaseService.getInstance();
  private characters = new CharacterService();

  /** Лодки игрока; активная — та, что сейчас под ним */
  async getCharacterBoats(characterId: string): Promise<PlayerBoat[]> {
    return this.db.query<PlayerBoat>(
      'SELECT * FROM character_boats WHERE character_id = $1 ORDER BY acquired_at DESC',
      [characterId]
    ).catch(() => []);
  }

  /** Активная лодка игрока или null */
  async getActiveBoat(characterId: string): Promise<PlayerBoat | null> {
    const row = await this.db.queryOne<PlayerBoat>(
      'SELECT * FROM character_boats WHERE character_id = $1 AND is_active = TRUE LIMIT 1',
      [characterId]
    ).catch(() => null);
    return row ?? null;
  }

  /**
   * Активная лодка вместе с её характеристиками.
   * Частый запрос из рыбалки и из движения, поэтому с кэшем в Redis.
   */
  async getActiveBoatDef(characterId: string): Promise<BoatDefinition | null> {
    const boat = await this.getActiveBoat(characterId);
    return getBoatDef(boat?.boatId);
  }

  /** Купить лодку: списываем золото и выдаём в «гараж» */
  async purchase(characterId: string, boatId: string): Promise<PlayerBoat> {
    const def = BOATS[boatId];
    if (!def) throw new Error('Boat not found');

    const character = await this.characters.getCharacterById(characterId);
    if (!character) throw new Error('Character not found');
    if (character.level < def.minLevel) throw new Error(`Requires level ${def.minLevel}`);

    const already = await this.db.queryOne<{ boat_id: string }>(
      'SELECT boat_id FROM character_boats WHERE character_id = $1 AND boat_id = $2',
      [characterId, boatId]
    ).catch(() => null);
    if (already) throw new Error('Boat already owned');

    await this.characters.addGold(characterId, -def.price);
    const boat: PlayerBoat = {
      characterId, boatId, isActive: false,
      acquiredAt: new Date(), totalCatches: 0, fatigue: 0,
    };
    await this.db.query(
      `INSERT INTO character_boats (character_id, boat_id, is_active, acquired_at, total_catches, fatigue)
       VALUES ($1, $2, FALSE, $3, 0, 0)
       ON CONFLICT (character_id, boat_id) DO NOTHING`,
      [characterId, boatId, boat.acquiredAt]
    );
    logger.info(`[Boat] ${boatId} куплена игроком ${characterId}`);
    return boat;
  }

  /** Сойти на берег: активной лодки больше нет */
  async deactivate(characterId: string): Promise<void> {
    await this.db.query(
      'UPDATE character_boats SET is_active = FALSE WHERE character_id = $1',
      [characterId]
    ).catch(() => {});
  }

  /**
   * Активировать лодку. Встать на воду можно только там, где она есть:
   * сервер проверяет координаты, иначе игрок «пришвартовал» бы лодку
   * в пустыне и ездил на ней по суше.
   */
  async activate(characterId: string, boatId: string, position?: { x: number; z: number }): Promise<BoatDefinition> {
    const def = BOATS[boatId];
    if (!def) throw new Error('Boat not found');

    const owned = await this.db.queryOne<{ boat_id: string }>(
      'SELECT boat_id FROM character_boats WHERE character_id = $1 AND boat_id = $2',
      [characterId, boatId]
    ).catch(() => null);
    if (!owned) throw new Error('Boat not owned');

    if (position) {
      if (!canFloatAt(position.x, position.z)) {
        throw new Error('Not on water');
      }
    }

    await this.db.transaction(async (client) => {
      await client.query('UPDATE character_boats SET is_active = FALSE WHERE character_id = $1', [characterId]);
      // Встали на воду — лодка отдохнула. Без сброса усталости игрок
      // вообще не смог бы рыбачить дальше catchLimit за сессию.
      await client.query(
        'UPDATE character_boats SET is_active = TRUE, fatigue = 0 WHERE character_id = $1 AND boat_id = $2',
        [characterId, boatId]
      );
    });
    logger.info(`[Boat] ${boatId} активирована игроком ${characterId}`);
    return def;
  }

  /** Поймана рыба: счётчик всего и усталость лодки */
  async addCatch(characterId: string, boatId: string): Promise<{ total: number; fatigue: number }> {
    const row = await this.db.queryOne<{ total_catches: number; fatigue: number }>(
      `UPDATE character_boats
          SET total_catches = total_catches + 1,
              fatigue = fatigue + 1
        WHERE character_id = $1 AND boat_id = $2
        RETURNING total_catches, fatigue`,
      [characterId, boatId]
    ).catch(() => null);
    return {
      total: Number(row?.total_catches ?? 0),
      fatigue: Number(row?.fatigue ?? 0),
    };
  }
}
