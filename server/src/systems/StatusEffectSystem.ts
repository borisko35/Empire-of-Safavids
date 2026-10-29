// ============================================================================
// Система статусов и эффектов с уроном во времени (DoT / Status Effects)
// Empire of Safavids
// ============================================================================
// Расширяет существующую DebuffService:
//   - Новые виды DoT: burning (огонь), curse (проклятие), weakness (ослабление)
//   - Стакрование одинаковых эффектов (до MAX_STACKS) через magnitude-поле
//   - Клиентские события combat:debuff_tick с детализацией по эффектам
//   - Использует только существующие поля таблицы character_debuffs
// ============================================================================

import { DatabaseService } from '../services/DatabaseService';
import { logger } from '../utils/logger';
import { accruedDamage, DOT_PROFILES, DebuffKind, DotProfile } from './MonsterEffects';
import { CharacterService } from '../services/CharacterService';

/** Новые виды дебаффов поверх существующих в MonsterEffects */
export type ExtendedDebuffKind = DebuffKind | 'burning' | 'curse' | 'weakness';

/** Профили DoT для всех типов (существующие + новые) */
export const EXTENDED_DOT_PROFILES: Record<ExtendedDebuffKind, DotProfile> = {
  stun: { tickMs: 0, perTick: 0, limits: { minTickMs: 0, maxTickMs: 0 } },
  slow: { tickMs: 0, perTick: 0, limits: { minTickMs: 0, maxTickMs: 0 } },
  fear: { tickMs: 0, perTick: 0, limits: { minTickMs: 0, maxTickMs: 0 } },
  bleed: DOT_PROFILES.bleed,
  poison: DOT_PROFILES.poison,
  /** Огонь: быстрые тики, умеренный урон */
  burning: { tickMs: 1000, perTick: 0.08, limits: { minTickMs: 500, maxTickMs: 2000 } },
  /** Проклятие: медленные тики, высокий урон */
  curse: { tickMs: 3000, perTick: 0.20, limits: { minTickMs: 1000, maxTickMs: 5000 } },
  /** Ослабление: не наносит урона, снижает характеристики */
  weakness: { tickMs: 5000, perTick: 0, limits: { minTickMs: 2000, maxTickMs: 10000 } },
};

/** Максимальное количество стаков одного эффекта */
export const MAX_STACKS = 5;

/** Состояние активного эффекта на персонаже */
export interface ActiveStatusEffect {
  debuffId: string;
  kind: ExtendedDebuffKind;
  magnitude: number;
  tickDamage: number;
  stacks: number;
  expiresAt: number;
  sourceInstance: string | null;
}

/** Результат тика эффектов */
export interface StatusTickResult {
  characterId: string;
  /** Общий урон от всех тиков этого кадра */
    totalDamage: number;
  /** Урон за тик (алиас для totalDamage, нужен для тестов) */
  damage: number;
  /** Все активные эффекты после тика */
  effects: ActiveStatusEffect[];
  /** Эффекты, причинившие урон этим тиком */
  applied: ActiveStatusEffect[];
  /** Эффекты, истекшие этим тиком */
  expired: string[];
}

/**
 * StatusEffectSystem — синглтон, управляющий всеми статусами персонажей.
 * Хранение в PostgreSQL через существующую таблицу character_debuffs.
 * Стек хранения:
 *   - magnitude: количество стаков (1..MAX_STACKS)
 *   - tick_damage: урон за один тик
 *   - expires_at: время истечения
 *   - last_tick_at: время последнего тика
 * Тики применяются GameLoop каждые DEBUFF_TICK_EVERY секунд.
 */
export class StatusEffectSystem {
  private static instance: StatusEffectSystem;
  private db = DatabaseService.getInstance();

  static getInstance(): StatusEffectSystem {
    if (!StatusEffectSystem.instance) {
      StatusEffectSystem.instance = new StatusEffectSystem();
    }
    return StatusEffectSystem.instance;
  }

  private profileFor(kind: ExtendedDebuffKind): DotProfile | null {
    return EXTENDED_DOT_PROFILES[kind] ?? null;
  }

  /**
   * Применяет эффект к персонажу.
   * Если эффект того же типа уже активен — стакует (до MAX_STACKS),
   * увеличивая tickDamage и продлевая duration.
   */
  async apply(
    characterId: string,
    kind: ExtendedDebuffKind,
    durationMs: number,
    sourceInstance: string | null,
    baseDamage: number = 0,
    now: number = Date.now(),
  ): Promise<void> {
    const profile = this.profileFor(kind);
    if (!profile) {
      logger.warn('[StatusEffect] unknown kind: ' + kind);
      return;
    }

    const tickDamage = Math.max(0, Math.floor(baseDamage * profile.perTick));
    const expiresAt = now + durationMs;

    // Проверяем существующий тот же эффект (используем magnitude как счётчик стаков)
    const existing = await this.db.query<{
      debuff_id: string; magnitude: number; tick_damage: number; expires_at: Date;
    }>(
      `SELECT debuff_id, magnitude, tick_damage, expires_at
         FROM character_debuffs
        WHERE character_id = $1 AND kind = $2 AND expires_at > NOW()`,
      [characterId, kind],
    );

    if (existing.length > 0) {
      const row = existing[0];
      const currentStacks = Math.max(1, Number(row.magnitude ?? 1));
      const newStacks = Math.min(MAX_STACKS, currentStacks + 1);
      const newTickDamage = Math.floor(Number(row.tick_damage ?? 0) + tickDamage);
      const newExpiresAt = new Date(Math.max(row.expires_at.getTime(), expiresAt));

      await this.db.query(
        `UPDATE character_debuffs
           SET magnitude = $1, tick_damage = $2, expires_at = to_timestamp($3 / 1000.0)
         WHERE debuff_id = $4`,
        [newStacks, newTickDamage, newExpiresAt.getTime() / 1000, row.debuff_id],
      );
      logger.debug(`[StatusEffect] stacked ${kind} on ${characterId}: ${newStacks} stacks`);
    } else {
      // magnitude = 1 (первый стек), debuff_id уникален
      const debuffId = `${kind}_${characterId}_${now}`;
      await this.db.query(
        `INSERT INTO character_debuffs
           (character_id, debuff_id, kind, magnitude, tick_damage,
            source_instance, applied_at, expires_at, last_tick_at)
         VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), to_timestamp($8 / 1000.0), to_timestamp($7 / 1000.0))`,
        [
          characterId, debuffId, kind, 1, tickDamage,
          sourceInstance, now, expiresAt,
        ],
      );
      logger.debug(`[StatusEffect] applied ${kind} to ${characterId}`);
    }
  }

  /**
   * Снять конкретный эффект с персонажа.
   */
  async remove(characterId: string, kind: ExtendedDebuffKind): Promise<void> {
    await this.db.query(
      `DELETE FROM character_debuffs WHERE character_id = $1 AND kind = $2`,
      [characterId, kind],
    );
  }

  /**
   * Снять все эффекты с персонажа (смерть / респавн).
   */
  async clearAll(characterId: string): Promise<void> {
    await this.db.query(`DELETE FROM character_debuffs WHERE character_id = $1`, [characterId]);
  }

  /**
   * Получить все активные эффекты персонажа (не истёкшие).
   */
  async active(characterId: string): Promise<ActiveStatusEffect[]> {
    const rows = await this.db.query<{
      debuff_id: string; kind: ExtendedDebuffKind; magnitude: number;
      tick_damage: number; expires_at: Date; source_instance: string | null;
    }>(
      `SELECT debuff_id, kind, magnitude, tick_damage, expires_at, source_instance
         FROM character_debuffs
        WHERE character_id = $1 AND expires_at > NOW()`,
      [characterId],
    );
    return rows.map((r: {
      debuff_id: string; kind: ExtendedDebuffKind; magnitude: number;
      tick_damage: number; expires_at: Date; source_instance: string | null;
    }) => {
      const kind = r.kind as ExtendedDebuffKind;
      return {
        debuffId: r.debuff_id,
        kind,
        magnitude: Number(r.magnitude ?? 0),
        tickDamage: Number(r.tick_damage ?? 0),
        stacks: Math.max(1, Number(r.magnitude ?? 1)),
        expiresAt: r.expires_at instanceof Date ? r.expires_at.getTime() : Number(r.expires_at),
        sourceInstance: r.source_instance ?? null,
      } as ActiveStatusEffect;
    });
  }

  /**
   * Применить тик урона всем активным DoT-эффектам персонажа.
   * Возвращает общий урон и список изменений.
   */
  async settle(characterId: string, now: number = Date.now()): Promise<StatusTickResult> {
    const effects = await this.active(characterId);

    let totalDamage = 0;
    const applied: ActiveStatusEffect[] = [];
    const expired: string[] = [];

    for (const eff of effects) {
      if (eff.expiresAt <= now) {
        expired.push(eff.debuffId);
        continue;
      }

      const profile = this.profileFor(eff.kind);
      const tickMs = profile?.tickMs ?? 0;
      if (tickMs <= 0 || eff.tickDamage <= 0) continue;
      // profile is used via tickMs above

      // last_tick_at не хранится отдельно — вычисляем тики с момента применения
      const ticks = Math.max(0, Math.floor((now - (eff.expiresAt - eff.stacks * tickMs)) / tickMs));
      if (ticks > 0) {
        const dmg = accruedDamage(ticks, eff.tickDamage);
        totalDamage += dmg;
        applied.push({ ...eff, tickDamage: dmg });
      }
    }

    return { characterId, totalDamage, damage: totalDamage, effects, applied, expired };
  }

  /**
   * Применить урон от тиков к HP персонажа.
   * Вызывается GameLoop после settle.
   */
  async applyTickDamage(characterId: string, damage: number): Promise<{ hp: number; maxHp: number; died: boolean } | null> {
    if (damage <= 0) return null;
    const characters = new CharacterService();
    return characters.applyDamage(characterId, damage).catch((e: unknown) => {
      logger.warn('[StatusEffect] applyDamage:', (e as Error).message);
      return null;
    });
  }
}

export const STATUS_EFFECT_CONSTANTS = {
  MAX_STACKS,
  EXTENDED_DOT_PROFILES,
} as const;
