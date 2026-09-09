// ============================================================
// Mount System — Empire of Safavids
// ============================================================

import { DatabaseService } from '../services/DatabaseService';
import { RedisService } from '../services/RedisService';
import { logger } from '../utils/logger';

export type MountType = 'horse' | 'camel' | 'elephant' | 'warhorse' | 'mythical';

export interface MountDefinition {
  id: string;
  name: string;
  nameRu: string;
  type: MountType;
  baseSpeed: number;       // базовая скорость
  maxSpeed: number;        // макс скорость при 100 уровне
  stamina: number;         // выносливость
  carryBonus: number;      // бонус к весу груза
  combatAllowed: boolean;  // можно ли атаковать верхом
  minLevel: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'mythical';
  description: string;
  iconPath: string;
}

export interface PlayerMount {
  characterId: string;
  mountId: string;
  level: number;           // 1–10
  experience: number;
  isActive: boolean;
  customName?: string;
  acquiredAt: Date;
}

export const MOUNTS: Record<string, MountDefinition> = {
  'mount_arabian_horse': {
    id: 'mount_arabian_horse',
    name: 'Arabian Horse',
    nameRu: 'Арабский Скакун',
    type: 'horse',
    baseSpeed: 6.0, maxSpeed: 9.0,
    stamina: 100, carryBonus: 0,
    combatAllowed: false, minLevel: 1,
    rarity: 'common',
    description: 'Быстрый арабский скакун. Идеальный для путешествий.',
    iconPath: 'icons/mounts/arabian_horse.png',
  },
  'mount_bactrian_camel': {
    id: 'mount_bactrian_camel',
    name: 'Bactrian Camel',
    nameRu: 'Двугорбый Верблюд',
    type: 'camel',
    baseSpeed: 4.5, maxSpeed: 6.5,
    stamina: 200, carryBonus: 50,
    combatAllowed: false, minLevel: 10,
    rarity: 'common',
    description: 'Выносливый верблюд. Идеален для торговли и долгих путешествий.',
    iconPath: 'icons/mounts/bactrian_camel.png',
  },
  'mount_war_elephant': {
    id: 'mount_war_elephant',
    name: 'War Elephant',
    nameRu: 'Боевой Слон',
    type: 'elephant',
    baseSpeed: 3.5, maxSpeed: 5.0,
    stamina: 500, carryBonus: 200,
    combatAllowed: true, minLevel: 40,
    rarity: 'epic',
    description: 'Мощный боевой слон. Может атаковать врагов в бою. Увеличивает урон от топтания.',
    iconPath: 'icons/mounts/war_elephant.png',
  },
  'mount_qizilbash_warhorse': {
    id: 'mount_qizilbash_warhorse',
    name: 'Qizilbash Warhorse',
    nameRu: 'Боевой Конь Кызылбаша',
    type: 'warhorse',
    baseSpeed: 7.0, maxSpeed: 11.0,
    stamina: 150, carryBonus: 20,
    combatAllowed: true, minLevel: 30,
    rarity: 'rare',
    description: 'Боевой конь гвардейцев Кызылбаша. Увеличивает урон от тарана.',
    iconPath: 'icons/mounts/qizilbash_warhorse.png',
  },
  'mount_simurgh_chick': {
    id: 'mount_simurgh_chick',
    name: 'Young Simurgh',
    nameRu: 'Молодой Симург',
    type: 'mythical',
    baseSpeed: 10.0, maxSpeed: 16.0,
    stamina: 300, carryBonus: 0,
    combatAllowed: true, minLevel: 80,
    rarity: 'mythical',
    description: 'Мифическая птица Симург. Умеет летать. Дроп с мирового босса Симург.',
    iconPath: 'icons/mounts/young_simurgh.png',
  },
  'mount_ghost_ship': {
    id: 'mount_ghost_ship',
    name: 'Ghost Ship',
    nameRu: 'Корабль-Призрак',
    type: 'mythical',
    baseSpeed: 12.0, maxSpeed: 18.0,
    stamina: 400, carryBonus: 100,
    combatAllowed: false, minLevel: 90,
    rarity: 'mythical',
    description: 'Призрачный корабль пиратов Персидского залива. Только для морских зон.',
    iconPath: 'icons/mounts/ghost_ship.png',
  },
};

export class MountSystem {
  private db    = DatabaseService.getInstance();
  private redis = RedisService.getInstance();

  async addMount(characterId: string, mountId: string): Promise<PlayerMount> {
    const def = MOUNTS[mountId];
    if (!def) throw new Error('Mount not found');

    const mount: PlayerMount = {
      characterId, mountId,
      level: 1, experience: 0,
      isActive: false,
      acquiredAt: new Date(),
    };

    await this.db.query(
      `INSERT INTO character_mounts (character_id, mount_id, level, experience, is_active, acquired_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (character_id, mount_id) DO NOTHING`,
      [characterId, mountId, 1, 0, false, mount.acquiredAt]
    );
    logger.info(`Mount added: ${mountId} -> ${characterId}`);
    return mount;
  }

  async activateMount(characterId: string, mountId: string): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query(
        'UPDATE character_mounts SET is_active = FALSE WHERE character_id = $1',
        [characterId]
      );
      await client.query(
        'UPDATE character_mounts SET is_active = TRUE WHERE character_id = $1 AND mount_id = $2',
        [characterId, mountId]
      );
    });
    const def = MOUNTS[mountId];
    await this.redis.publish(`player:mount:${characterId}`, { mountId, speed: def?.baseSpeed });
  }

  async addMountExperience(characterId: string, mountId: string, amount: number): Promise<{ leveledUp: boolean; newLevel: number }> {
    const row = await this.db.queryOne<{ level: number; experience: number }>(
      'SELECT level, experience FROM character_mounts WHERE character_id = $1 AND mount_id = $2',
      [characterId, mountId]
    );
    if (!row) throw new Error('Mount not found for character');

    const newExp   = row.experience + amount;
    const newLevel = Math.min(10, Math.floor(Math.sqrt(newExp / 50)) + 1);
    const leveledUp = newLevel > row.level;

    await this.db.query(
      'UPDATE character_mounts SET experience = $1, level = $2 WHERE character_id = $3 AND mount_id = $4',
      [newExp, newLevel, characterId, mountId]
    );
    return { leveledUp, newLevel };
  }

  getMountSpeed(def: MountDefinition, mountLevel: number): number {
    const t = (mountLevel - 1) / 9;
    return def.baseSpeed + (def.maxSpeed - def.baseSpeed) * t;
  }

  async getCharacterMounts(characterId: string): Promise<PlayerMount[]> {
    return this.db.query<PlayerMount>(
      'SELECT * FROM character_mounts WHERE character_id = $1 ORDER BY acquired_at DESC',
      [characterId]
    );
  }
}
