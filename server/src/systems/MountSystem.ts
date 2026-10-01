// ============================================================
// Mount System — Empire of Safavids
// ============================================================

import { DatabaseService } from '../services/DatabaseService';
import { RedisService } from '../services/RedisService';
import { camelizeRow } from '../utils/camelize';
import { logger } from '../utils/logger';
import { REDIS_CHANNELS } from '../../../shared/constants';

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

/** Скакун глазами игрока: строка базы плюс то, что считал сервер. */
export interface PlayerMountView {
  character_id: string;
  mount_id: string;
  level: number;
  experience: number;
  is_active: boolean;
  acquired_at: Date;
  /** Скорость шагом с учётом уровня скакуна */
  speed: number;
  base_speed: number;
  max_speed: number;
  name: string;
  name_ru: string;
  rarity: MountDefinition['rarity'];
  carry_bonus: number;
  combat_allowed: boolean;
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
    await this.redis.publish(REDIS_CHANNELS.PLAYER_MOUNT(characterId), { mountId, speed: def?.baseSpeed });
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

  /**
   * Скорость скакуна с учётом его уровня.
   *
   * Уровень берётся из character_mounts.level, а не из аргумента: раньше
   * метод был написан, но не вызывался нигде, поэтому купленный конь не
   * давал скорости вообще, а расти ему было нечем.
   */
  async getActiveMount(characterId: string): Promise<{ mount: PlayerMount; def: MountDefinition; speed: number } | null> {
    // camelizeRow, а не голый SELECT *: PostgreSQL отдаёт mount_id и
    // is_active, а интерфейс PlayerMount обещает mountId и isActive. Без
    // перевода типа врут, и обращение к полю падает
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM character_mounts WHERE character_id = $1 AND is_active = TRUE',
      [characterId]
    );
    const mount = camelizeRow<PlayerMount>(row);
    if (!mount) return null;
    const def = MOUNTS[mount.mountId];
    // Запись в базе без записи в MOUNTS — грязь после правки таблицы.
    // Молча возвращаем null: едем пешком, а не падаем на каждом шагу
    if (!def) return null;
    return { mount, def, speed: this.getMountSpeed(def, mount.level) };
  }

  /**
   * Все скакуны персонажа вместе с их скоростью и названиями.
   *
   * Раньше клиент держал свою копию таблицы MOUNTS, причём на три скакуна
   * из шести: боевой слон, Симург и корабль показывались без описания.
   * Скорость считает сервер, у клиента своей копии больше нет.
   */
  async listForPlayer(characterId: string): Promise<PlayerMountView[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM character_mounts WHERE character_id = $1 ORDER BY acquired_at DESC',
      [characterId]
    );
    return rows.map(raw => {
      const row = camelizeRow<PlayerMount>(raw)!;
      const def = MOUNTS[row.mountId];
      return {
        character_id: row.characterId,
        mount_id: row.mountId,
        level: row.level,
        experience: row.experience,
        is_active: row.isActive,
        acquired_at: row.acquiredAt,
        base_speed: def?.baseSpeed ?? 0,
        max_speed: def?.maxSpeed ?? 0,
        speed: def ? this.getMountSpeed(def, row.level) : 0,
        name: def?.name ?? row.mountId,
        name_ru: def?.nameRu ?? row.mountId,
        rarity: def?.rarity ?? 'common',
        carry_bonus: def?.carryBonus ?? 0,
        combat_allowed: def?.combatAllowed ?? false,
      };
    });
  }
}
