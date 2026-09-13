import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './DatabaseService';
import { Character, CharacterClass, CharacterStats, Region, ItemType } from '../types/game.types';
import { camelizeRow, camelizeRows } from '../utils/camelize';
import { LevelingSystem } from '../systems/LevelingSystem';
import { ITEMS_DATABASE } from '../data/items';
import { MAX_LEVEL, DEFAULT_SERVER_ID } from '../../../shared/constants';

const BASE_STATS: Record<CharacterClass, CharacterStats> = {
  [CharacterClass.QIZILBASH]: {
    strength: 20, agility: 12, intelligence: 5, endurance: 18, charisma: 8,
  },
  [CharacterClass.SUFI_MYSTIC]: {
    strength: 6, agility: 10, intelligence: 22, endurance: 10, charisma: 15,
  },
  [CharacterClass.PERSIAN_ARCHER]: {
    strength: 12, agility: 22, intelligence: 8, endurance: 12, charisma: 10,
  },
  [CharacterClass.BAZAAR_MERCHANT]: {
    strength: 8, agility: 14, intelligence: 12, endurance: 10, charisma: 20,
  },
  [CharacterClass.COURT_DIPLOMAT]: {
    strength: 7, agility: 13, intelligence: 15, endurance: 9, charisma: 22,
  },
};

export class CharacterService {
  private db = DatabaseService.getInstance();
  private leveling = new LevelingSystem();

  async createCharacter(
    userId: string,
    name: string,
    characterClass: CharacterClass,
    serverId: string = DEFAULT_SERVER_ID
  ): Promise<Character> {
    const stats = BASE_STATS[characterClass];
    const maxHp = 100 + stats.endurance * 10;
    const maxMana = 50 + stats.intelligence * 8;
    const maxStamina = 100 + stats.agility * 5;

    const character: Character = {
      id: uuidv4(),
      userId,
      name,
      class: characterClass,
      level: 1,
      experience: 0,
      stats,
      hp: maxHp,
      maxHp,
      mana: maxMana,
      maxMana,
      stamina: maxStamina,
      maxStamina,
      position: { x: 0, y: 0, z: 0 }, // Стартовая позиция в Тебризе
      region: Region.TABRIZ,
      serverId,
      gold: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.query(
      `INSERT INTO characters
        (id, user_id, name, class, level, experience, stats, hp, max_hp,
         mana, max_mana, stamina, max_stamina, position, region, server_id, gold, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        character.id, character.userId, character.name, character.class,
        character.level, character.experience, JSON.stringify(character.stats),
        character.hp, character.maxHp, character.mana, character.maxMana,
        character.stamina, character.maxStamina, JSON.stringify(character.position),
        character.region, character.serverId, character.gold, character.createdAt, character.updatedAt,
      ]
    );

    return character;
  }

  async getCharactersByUser(userId: string): Promise<Character[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM characters WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return camelizeRows<Character>(rows).map(c => this.parseJsonFields(c));
  }

  async getCharacterById(characterId: string): Promise<Character | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM characters WHERE id = $1',
      [characterId]
    );
    if (!row) return null;
    const character = camelizeRow<Character>(row)!;
    return this.parseJsonFields(character);
  }

  /** JSONB-колонки могут прийти строкой — нормализуем в объекты */
  private parseJsonFields(character: Character): Character {
    const c = character as Character & { stats?: unknown; position?: unknown };
    if (typeof c.stats === 'string') c.stats = JSON.parse(c.stats) as CharacterStats;
    if (typeof c.position === 'string') c.position = JSON.parse(c.position);
    return character;
  }

  async addExperience(characterId: string, amount: number): Promise<{ leveledUp: boolean; newLevel: number }> {
    const character = await this.getCharacterById(characterId);
    if (!character) throw new Error('Character not found');

    // Делегируем единой системе прокачки (прирост статов/навыков при level up)
    const result = await this.leveling.addExperience(character, amount, 'experience_gain');
    return { leveledUp: result.leveledUp, newLevel: result.newLevel };
  }

  async updatePosition(characterId: string, position: { x: number; y: number; z: number }): Promise<void> {
    await this.db.query(
      'UPDATE characters SET position = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(position), characterId]
    );
  }

  // ============================================================
  // Боевые операции (персистентное состояние HP/маны/стамины)
  // ============================================================

  /** Нанести урон. Возвращает оставшееся HP и признак смерти. */
  async applyDamage(characterId: string, damage: number): Promise<{ hp: number; maxHp: number; died: boolean }> {
    const row = await this.db.queryOne<{ hp: number; max_hp: number }>(
      'UPDATE characters SET hp = GREATEST(0, hp - $1), updated_at = NOW() WHERE id = $2 RETURNING hp, max_hp',
      [Math.max(0, Math.floor(damage)), characterId]
    );
    if (!row) throw new Error('Character not found');
    return { hp: row.hp, maxHp: row.max_hp, died: row.hp <= 0 };
  }

  /** Восстановить HP (лечение). Возвращает актуальное HP. */
  async applyHeal(characterId: string, amount: number): Promise<{ hp: number; maxHp: number }> {
    const row = await this.db.queryOne<{ hp: number; max_hp: number }>(
      'UPDATE characters SET hp = LEAST(max_hp, hp + $1), updated_at = NOW() WHERE id = $2 RETURNING hp, max_hp',
      [Math.max(0, Math.floor(amount)), characterId]
    );
    if (!row) throw new Error('Character not found');
    return { hp: row.hp, maxHp: row.max_hp };
  }

  /** Списать ману/стамину. false — если ресурсов не хватает (действие невозможно). */
  async spendResources(characterId: string, manaCost: number, staminaCost: number): Promise<boolean> {
    const affected = await this.db.run(
      `UPDATE characters SET
         mana = mana - $1, stamina = stamina - $2, updated_at = NOW()
       WHERE id = $3 AND mana >= $1 AND stamina >= $2`,
      [Math.max(0, manaCost), Math.max(0, staminaCost), characterId]
    );
    return affected > 0;
  }

  /** Возрождение после смерти: пол-HP на стартовой точке региона. */
  async respawn(characterId: string): Promise<{ hp: number; maxHp: number }> {
    const row = await this.db.queryOne<{ hp: number; max_hp: number }>(
      `UPDATE characters SET
         hp = GREATEST(1, FLOOR(max_hp * 0.5)),
         mana = GREATEST(FLOOR(max_mana * 0.5), 0),
         stamina = max_stamina,
         position = '{"x":0,"y":0,"z":0}'::jsonb,
         updated_at = NOW()
       WHERE id = $1
       RETURNING hp, max_hp`,
      [characterId]
    );
    if (!row) throw new Error('Character not found');
    return { hp: row.hp, maxHp: row.max_hp };
  }

  /** Максимальный уровень (из общих констант) */
  getMaxLevel(): number {
    return MAX_LEVEL;
  }

  // ============================================================
  // Регенерация и ресурсы
  // ============================================================

  /** Медленная регенерация ресурсов (за 5-секундный тик сервера). */
  async regenResources(characterId: string): Promise<{
    hp: number; maxHp: number; mana: number; maxMana: number;
    stamina: number; maxStamina: number; level: number; experience: number; gold: number;
  } | null> {
    const row = await this.db.queryOne<Record<string, number>>(
      `UPDATE characters SET
         hp      = LEAST(max_hp,      hp + GREATEST(1, FLOOR(max_hp * 0.012) * 5)),
         mana    = LEAST(max_mana,    mana + GREATEST(1, FLOOR(max_mana * 0.02) * 5)),
         stamina = LEAST(max_stamina, stamina + GREATEST(1, FLOOR(max_stamina * 0.04) * 5)),
         updated_at = NOW()
       WHERE id = $1
       RETURNING hp, max_hp, mana, max_mana, stamina, max_stamina, level, experience, gold`,
      [characterId]
    );
    if (!row) return null;
    return {
      hp: Number(row.hp), maxHp: Number(row.max_hp),
      mana: Number(row.mana), maxMana: Number(row.max_mana),
      stamina: Number(row.stamina), maxStamina: Number(row.max_stamina),
      level: Number(row.level), experience: Number(row.experience), gold: Number(row.gold),
    };
  }

  /** Начислить золото. Возвращает новый баланс. */
  async addGold(characterId: string, amount: number): Promise<number> {
    const row = await this.db.queryOne<{ gold: number }>(
      'UPDATE characters SET gold = gold + $1 WHERE id = $2 RETURNING gold',
      [Math.max(0, Math.floor(amount)), characterId]
    );
    if (!row) throw new Error('Character not found');
    return Number(row.gold);
  }

  /** Атомарно списать золото. Бросает ошибку, если средств недостаточно. Возвращает остаток. */
  async spendGold(characterId: string, amount: number): Promise<number> {
    const cost = Math.max(0, Math.floor(amount));
    const row = await this.db.queryOne<{ gold: number }>(
      'UPDATE characters SET gold = gold - $1 WHERE id = $2 AND gold >= $1 RETURNING gold',
      [cost, characterId]
    );
    if (!row) throw new Error('Insufficient gold');
    return Number(row.gold);
  }

  /** Сменить регион персонажа (путешествие). Возвращает обновлённого персонажа. */
  async updateRegion(characterId: string, region: Region): Promise<Character | null> {
    const row = await this.db.queryOne<{ id: string }>(
      'UPDATE characters SET region = $2, updated_at = NOW() WHERE id = $1 RETURNING id',
      [characterId, region]
    );
    if (!row) return null;
    return this.getCharacterById(characterId);
  }

  // ============================================================
  // Инвентарь (стеки: персонаж + предмет + уровень заточки)
  // ============================================================

  /** Добавить предметы (лут, награды). Стеки разводятся по уровню заточки. */
  async addItems(characterId: string, items: { itemId: string; qty: number; enhancement?: number }[]): Promise<void> {
    for (const it of items) {
      const enhancement = Math.max(0, Math.min(20, Math.floor(it.enhancement ?? 0)));
      await this.db.query(
        `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (character_id, item_id, enhancement)
         DO UPDATE SET quantity = character_items.quantity + EXCLUDED.quantity`,
        [characterId, it.itemId, Math.max(1, Math.floor(it.qty)), enhancement]
      );
    }
  }

  /** Списать предметы (сначала из более заточенных стеков). Бросает ошибку при нехватке. */
  async removeItems(characterId: string, items: { itemId: string; qty: number }[]): Promise<void> {
    await this.db.transaction(async (client) => {
      for (const it of items) {
        const qty = Math.max(1, Math.floor(it.qty));
        const res = await client.query(
          `UPDATE character_items SET quantity = quantity - $1
           WHERE id = (
             SELECT id FROM character_items
             WHERE character_id = $2 AND item_id = $3 AND quantity >= $1
             ORDER BY enhancement DESC LIMIT 1
             FOR UPDATE
           )`,
          [qty, characterId, it.itemId]
        );
        if (res.rowCount === 0) {
          const have = await client.query(
            'SELECT COALESCE(SUM(quantity), 0) AS total FROM character_items WHERE character_id = $1 AND item_id = $2',
            [characterId, it.itemId]
          );
          throw new Error(`Not enough items: ${it.itemId} (need ${qty}, have ${Number(have.rows[0].total)})`);
        }
        await client.query(
          'DELETE FROM character_items WHERE character_id = $1 AND item_id = $2 AND quantity <= 0',
          [characterId, it.itemId]
        );
      }
    });
  }

  /** Суммарное количество предмета по всем стекам: { itemId: qty } */
  async getItemQuantities(characterId: string): Promise<Record<string, number>> {
    const rows = await this.db.query<{ item_id: string; total: string | number }>(
      'SELECT item_id, SUM(quantity) AS total FROM character_items WHERE character_id = $1 GROUP BY item_id',
      [characterId]
    );
    const map: Record<string, number> = {};
    for (const r of rows) map[r.item_id] = Number(r.total);
    return map;
  }

  /** Инвентарь с именами/редкостью из ITEMS_DATABASE. */
  async getInventory(characterId: string): Promise<InventoryEntry[]> {
    const rows = await this.db.query<{ item_id: string; quantity: number; enhancement: number }>(
      'SELECT item_id, quantity, enhancement FROM character_items WHERE character_id = $1 ORDER BY acquired_at DESC',
      [characterId]
    );
    return rows
      .map(r => {
        const def = ITEMS_DATABASE[r.item_id];
        return {
          itemId: r.item_id,
          name: def?.name ?? r.item_id,
          nameRu: def?.nameRu ?? r.item_id,
          type: def?.type ?? 'material',
          rarity: def?.rarity ?? 'common',
          quantity: Number(r.quantity),
          enhancement: Number(r.enhancement),
        };
      });
  }

  // ============================================================
  // Экипировка (оружие / броня / аксессуар)
  // ============================================================

  private static SLOT_BY_TYPE: Partial<Record<ItemType, 'weapon' | 'armor' | 'accessory'>> = {
    [ItemType.WEAPON]: 'weapon',
    [ItemType.ARMOR]: 'armor',
    [ItemType.ACCESSORY]: 'accessory',
  };

  /** Экипированные предметы и агрегированные бонусы характеристик (+5% за уровень заточки). */
  async getEquipment(characterId: string): Promise<{ items: EquippedItem[]; stats: CharacterStats }> {
    const rows = await this.db.query<{ slot: string; item_id: string; enhancement: number }>(
      'SELECT slot, item_id, enhancement FROM character_equipment WHERE character_id = $1',
      [characterId]
    );
    const items: EquippedItem[] = [];
    const stats: CharacterStats = { strength: 0, agility: 0, intelligence: 0, endurance: 0, charisma: 0 };
    for (const r of rows) {
      const def = ITEMS_DATABASE[r.item_id];
      const enhancement = Number(r.enhancement);
      const mult = 1 + 0.05 * enhancement;
      items.push({
        slot: r.slot as EquippedItem['slot'],
        itemId: r.item_id,
        name: def?.name ?? r.item_id,
        nameRu: def?.nameRu ?? r.item_id,
        rarity: def?.rarity ?? 'common',
        enhancement,
        stats: def?.stats,
      });
      for (const [key, value] of Object.entries(def?.stats ?? {})) {
        if (key in stats) stats[key as keyof CharacterStats] += Math.round(Number(value) * mult);
      }
    }
    return { items, stats };
  }

  /** Надеть предмет: списывается из сумки, предыдущий предмет слота возвращается в неё. */
  async equipItem(characterId: string, itemId: string): Promise<{ items: EquippedItem[]; stats: CharacterStats }> {
    const def = ITEMS_DATABASE[itemId];
    if (!def) throw new Error('Item not found');
    const slot = CharacterService.SLOT_BY_TYPE[def.type];
    if (!slot) throw new Error('Item cannot be equipped');
    const character = await this.getCharacterById(characterId);
    if (!character) throw new Error('Character not found');
    if (def.level > character.level) throw new Error(`Requires level ${def.level}`);

    await this.db.transaction(async (client) => {
      // Взять один экземпляр из сумки (сверху — самый заточенный)
      const taken = await client.query(
        `UPDATE character_items SET quantity = quantity - 1
         WHERE id = (
           SELECT id FROM character_items
           WHERE character_id = $1 AND item_id = $2 AND quantity >= 1
           ORDER BY enhancement DESC LIMIT 1
           FOR UPDATE
         )
         RETURNING enhancement`,
        [characterId, itemId]
      );
      if (taken.rowCount === 0) throw new Error('Item not in inventory');
      const enhancement = Number(taken.rows[0].enhancement);
      await client.query(
        'DELETE FROM character_items WHERE character_id = $1 AND item_id = $2 AND quantity <= 0',
        [characterId, itemId]
      );

      // Снять предыдущий предмет слота обратно в сумку
      const prev = await client.query(
        'SELECT item_id, enhancement FROM character_equipment WHERE character_id = $1 AND slot = $2 FOR UPDATE',
        [characterId, slot]
      );
      if (prev.rows[0]) {
        await client.query(
          `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
           VALUES ($1, $2, 1, $3)
           ON CONFLICT (character_id, item_id, enhancement)
           DO UPDATE SET quantity = character_items.quantity + 1`,
          [characterId, prev.rows[0].item_id, Number(prev.rows[0].enhancement)]
        );
      }

      await client.query(
        `INSERT INTO character_equipment (character_id, slot, item_id, enhancement, equipped_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (character_id, slot)
         DO UPDATE SET item_id = EXCLUDED.item_id, enhancement = EXCLUDED.enhancement, equipped_at = NOW()`,
        [characterId, slot, itemId, enhancement]
      );
    });

    return this.getEquipment(characterId);
  }

  /** Снять предмет слота обратно в сумку. */
  async unequipItem(characterId: string, slot: 'weapon' | 'armor' | 'accessory'): Promise<{ items: EquippedItem[]; stats: CharacterStats }> {
    await this.db.transaction(async (client) => {
      const row = await client.query(
        'SELECT item_id, enhancement FROM character_equipment WHERE character_id = $1 AND slot = $2 FOR UPDATE',
        [characterId, slot]
      );
      if (!row.rows[0]) throw new Error('Nothing equipped in slot');
      await client.query(
        `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
         VALUES ($1, $2, 1, $3)
         ON CONFLICT (character_id, item_id, enhancement)
         DO UPDATE SET quantity = character_items.quantity + 1`,
        [characterId, row.rows[0].item_id, Number(row.rows[0].enhancement)]
      );
      await client.query(
        'DELETE FROM character_equipment WHERE character_id = $1 AND slot = $2',
        [characterId, slot]
      );
    });
    return this.getEquipment(characterId);
  }

  // ============================================================
  // Расходники
  // ============================================================

  private static USE_ITEM_EFFECTS: Record<string, { hp?: number; mana?: number; stamina?: number }> = {
    con_health_potion_s: { hp: 200 },
    con_health_potion_m: { hp: 800 },
    con_mana_potion: { mana: 300 },
    con_stamina_food: { stamina: 150 },
  };

  /** Использовать расходник: списывает предмет и применяет эффект восстановления. */
  async useItem(characterId: string, itemId: string): Promise<{
    hp: number; maxHp: number; mana: number; maxMana: number; stamina: number; maxStamina: number;
  }> {
    const def = ITEMS_DATABASE[itemId];
    if (!def) throw new Error('Item not found');
    if (def.type !== ItemType.CONSUMABLE) throw new Error('Item is not consumable');
    const effect = CharacterService.USE_ITEM_EFFECTS[itemId];
    if (!effect) throw new Error('Item has no usable effect');

    await this.removeItems(characterId, [{ itemId, qty: 1 }]);

    const sets: string[] = [];
    const params: number[] = [];
    let i = 2; // $1 = characterId
    if (effect.hp)      { sets.push(`hp = LEAST(max_hp, hp + $${i})`);          params.push(effect.hp); i++; }
    if (effect.mana)    { sets.push(`mana = LEAST(max_mana, mana + $${i})`);    params.push(effect.mana); i++; }
    if (effect.stamina) { sets.push(`stamina = LEAST(max_stamina, stamina + $${i})`); params.push(effect.stamina); i++; }
    const row = await this.db.queryOne<Record<string, number>>(
      `UPDATE characters SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $1
       RETURNING hp, max_hp, mana, max_mana, stamina, max_stamina`,
      [characterId, ...params]
    );
    if (!row) throw new Error('Character not found');
    return {
      hp: Number(row.hp), maxHp: Number(row.max_hp),
      mana: Number(row.mana), maxMana: Number(row.max_mana),
      stamina: Number(row.stamina), maxStamina: Number(row.max_stamina),
    };
  }
}

export interface InventoryEntry {
  itemId: string;
  name: string;
  nameRu: string;
  type: string;
  rarity: string;
  quantity: number;
  enhancement: number;
}

export interface EquippedItem {
  slot: 'weapon' | 'armor' | 'accessory';
  itemId: string;
  name: string;
  nameRu: string;
  rarity: string;
  enhancement: number;
  stats?: Partial<CharacterStats>;
}
