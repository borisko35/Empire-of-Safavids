import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './DatabaseService';
import { Character, CharacterClass, CharacterStats, Region } from '../types/game.types';
import { camelizeRow, camelizeRows } from '../utils/camelize';
import { LevelingSystem } from '../systems/LevelingSystem';
import { ITEMS_DATABASE } from '../data/items';
import { MAX_LEVEL } from '../../../shared/constants';

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
    characterClass: CharacterClass
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
      gold: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.query(
      `INSERT INTO characters
        (id, user_id, name, class, level, experience, stats, hp, max_hp,
         mana, max_mana, stamina, max_stamina, position, region, gold, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        character.id, character.userId, character.name, character.class,
        character.level, character.experience, JSON.stringify(character.stats),
        character.hp, character.maxHp, character.mana, character.maxMana,
        character.stamina, character.maxStamina, JSON.stringify(character.position),
        character.region, character.gold, character.createdAt, character.updatedAt,
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
      'UPDATE characters SET gold = gold + $1, updated_at = NOW() WHERE id = $2 RETURNING gold',
      [Math.max(0, Math.floor(amount)), characterId]
    );
    if (!row) throw new Error('Character not found');
    return Number(row.gold);
  }

  // ============================================================
  // Инвентарь (стеки: уникально по персонаж+предмет)
  // ============================================================

  /** Добавить предметы (лут). */
  async addItems(characterId: string, items: { itemId: string; qty: number }[]): Promise<void> {
    for (const it of items) {
      await this.db.query(
        `INSERT INTO character_items (character_id, item_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (character_id, item_id)
         DO UPDATE SET quantity = character_items.quantity + EXCLUDED.quantity`,
        [characterId, it.itemId, Math.max(1, Math.floor(it.qty))]
      );
    }
  }

  /** Инвентарь с именами/редкостью из ITEMS_DATABASE. */
  async getInventory(characterId: string): Promise<{ itemId: string; name: string; nameRu: string; type: string; rarity: string; quantity: number }[]> {
    const rows = await this.db.query<{ item_id: string; quantity: number }>(
      'SELECT item_id, quantity FROM character_items WHERE character_id = $1 ORDER BY acquired_at DESC',
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
        };
      });
  }
}
