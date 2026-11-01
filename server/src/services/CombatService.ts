import { Character, CombatAction, CharacterClass } from '../types/game.types';
import { logger } from '../utils/logger';
import { DEFAULT_WEAPON, WeaponProfile } from './EquipmentCache';
import { STANCE_ABILITIES, type StanceAbility, type CombatStance } from '../systems/CombatStance';

/** Урон poise в зависимости от типа действия */
const POISE_DAMAGE: Record<string, number> = {
  attack: 10,
  skill: 18,
  ultimate: 30,
  dodge: 0,
  block: 2,
};

interface DamageResult {
  damage: number;
  isCritical: boolean;
  isBlocked: boolean;
  isDodged: boolean;
  /** Урон poise, который цель получает от этого удара */
  poiseDamage: number;
}

interface SkillDefinition {
  id: string;
  name: string;
  nameRu: string;
  manaCost: number;
  staminaCost: number;
  cooldown: number; // секунды
  damageMultiplier: number;
  range: number;
  aoe: boolean;
  aoeRadius?: number;
}

// Навыки по классам
const CLASS_SKILLS: Record<CharacterClass, SkillDefinition[]> = {
  [CharacterClass.QIZILBASH]: [
    { id: 'qiz_slash', name: 'Crimson Slash', nameRu: 'Алый Удар', manaCost: 10, staminaCost: 20, cooldown: 3, damageMultiplier: 1.8, range: 3, aoe: false },
    { id: 'qiz_shield_bash', name: 'Shield Bash', nameRu: 'Удар Щитом', manaCost: 5, staminaCost: 15, cooldown: 5, damageMultiplier: 1.2, range: 2, aoe: false },
    { id: 'qiz_war_cry', name: 'War Cry', nameRu: 'Боевой Клич', manaCost: 20, staminaCost: 0, cooldown: 30, damageMultiplier: 0, range: 10, aoe: true, aoeRadius: 10 },
    { id: 'qiz_ultimate', name: 'Shah\'s Wrath', nameRu: 'Гнев Шаха', manaCost: 50, staminaCost: 30, cooldown: 180, damageMultiplier: 5.0, range: 5, aoe: true, aoeRadius: 5 },
  ],
  [CharacterClass.SUFI_MYSTIC]: [
    { id: 'sufi_fire', name: 'Sacred Flame', nameRu: 'Священное Пламя', manaCost: 25, staminaCost: 0, cooldown: 4, damageMultiplier: 2.2, range: 15, aoe: false },
    { id: 'sufi_heal', name: 'Divine Blessing', nameRu: 'Божественное Благословение', manaCost: 40, staminaCost: 0, cooldown: 8, damageMultiplier: -2.0, range: 20, aoe: false },
    { id: 'sufi_sema', name: 'Sema Dance', nameRu: 'Танец Сема', manaCost: 60, staminaCost: 20, cooldown: 45, damageMultiplier: 3.0, range: 8, aoe: true, aoeRadius: 8 },
    { id: 'sufi_ultimate', name: 'Ecstasy of Light', nameRu: 'Экстаз Света', manaCost: 80, staminaCost: 0, cooldown: 180, damageMultiplier: 6.0, range: 25, aoe: true, aoeRadius: 15 },
  ],
  [CharacterClass.PERSIAN_ARCHER]: [
    { id: 'arch_rapid', name: 'Rapid Shot', nameRu: 'Быстрый Выстрел', manaCost: 0, staminaCost: 10, cooldown: 1, damageMultiplier: 0.8, range: 30, aoe: false },
    { id: 'arch_parthian', name: 'Parthian Shot', nameRu: 'Парфянский Выстрел', manaCost: 15, staminaCost: 25, cooldown: 8, damageMultiplier: 2.5, range: 25, aoe: false },
    { id: 'arch_rain', name: 'Arrow Rain', nameRu: 'Дождь Стрел', manaCost: 30, staminaCost: 20, cooldown: 20, damageMultiplier: 1.5, range: 20, aoe: true, aoeRadius: 6 },
    { id: 'arch_ultimate', name: 'Eagle\'s Eye', nameRu: 'Орлиный Взор', manaCost: 40, staminaCost: 30, cooldown: 180, damageMultiplier: 8.0, range: 50, aoe: false },
  ],
  [CharacterClass.BAZAAR_MERCHANT]: [
    { id: 'merch_throw', name: 'Knife Throw', nameRu: 'Бросок Ножа', manaCost: 0, staminaCost: 10, cooldown: 2, damageMultiplier: 1.0, range: 15, aoe: false },
    { id: 'merch_smoke', name: 'Smoke Bomb', nameRu: 'Дымовая Бомба', manaCost: 20, staminaCost: 15, cooldown: 15, damageMultiplier: 0.5, range: 10, aoe: true, aoeRadius: 5 },
    { id: 'merch_bribe', name: 'Bribe', nameRu: 'Взятка', manaCost: 30, staminaCost: 0, cooldown: 60, damageMultiplier: 0, range: 5, aoe: false },
    { id: 'merch_ultimate', name: 'Silk Road Ambush', nameRu: 'Засада на Шёлковом Пути', manaCost: 50, staminaCost: 40, cooldown: 180, damageMultiplier: 4.0, range: 20, aoe: true, aoeRadius: 10 },
  ],
  [CharacterClass.COURT_DIPLOMAT]: [
    { id: 'dipl_rapier', name: 'Rapier Thrust', nameRu: 'Укол Рапирой', manaCost: 0, staminaCost: 12, cooldown: 2, damageMultiplier: 1.3, range: 3, aoe: false },
    { id: 'dipl_poison', name: 'Poison Blade', nameRu: 'Отравленный Клинок', manaCost: 20, staminaCost: 10, cooldown: 10, damageMultiplier: 0.8, range: 3, aoe: false },
    { id: 'dipl_charm', name: 'Charm', nameRu: 'Очарование', manaCost: 35, staminaCost: 0, cooldown: 30, damageMultiplier: 0, range: 8, aoe: false },
    { id: 'dipl_ultimate', name: 'Court Conspiracy', nameRu: 'Дворцовый Заговор', manaCost: 60, staminaCost: 20, cooldown: 180, damageMultiplier: 3.5, range: 15, aoe: true, aoeRadius: 8 },
  ],
};

// ── Новые способности, привязанные к стойкам ──────────────────────────────
/**
 * Применяет эффекты способности, привязанной к стойке.
 * Возвращает дополнительный урон, специальные эффекты (block, i-frames) и
 * статусные эффекты (стамина, скорость).
 */
function applyStanceAbilityEffects(
  action: CombatAction,
  attacker: Character,
  target: Character,
  stance: CombatStance,
  weapon: WeaponProfile | null
): { extraDamageMultiplier: number; specialEffect: 'parry' | 'dodge' | 'block_boost' | null; statusEffect: 'stamina_boost' | 'speed_boost' | null } {
  const abilities = STANCE_ABILITIES[stance] ?? [];
  const ability = abilities.find(a => a.id === action.stanceAbilityId);

  if (!ability) {
    return { extraDamageMultiplier: 1, specialEffect: null, statusEffect: null };
  }

  // Особая обработка в зависимости от типа способности
  switch (ability.id) {
    case 'sd_quick_step':
      // Quick Step — это движение, дающее i-frame на 0.3 сек
      return { extraDamageMultiplier: 1, specialEffect: 'dodge', statusEffect: null };

    case 'ss_perfect_block':
      // Идеальный блок: гарантированный блок на 1 сек
      return { extraDamageMultiplier: 1, specialEffect: 'block_boost', statusEffect: null };

    case 'sd_lunging_strike':
      // Удар с ускорением — добавляем проникающий урон
      return { extraDamageMultiplier: ability.damageMultiplier, specialEffect: null, statusEffect: null };

    case 'ss_counter_thrust':
      // Контратака: урон множитель + возможность парирования
      return { extraDamageMultiplier: ability.damageMultiplier, specialEffect: 'parry', statusEffect: null };

    case 'ma_rapid_shoot':
      // Скорострел — небольшой proцент additional damage
      return { extraDamageMultiplier: ability.damageMultiplier, specialEffect: null, statusEffect: null };

    case 'ma_spread_shot':
      // Расстрельный выстрел — AOE, обрабатывается клиентом/рендерером
      return { extraDamageMultiplier: ability.damageMultiplier, specialEffect: null, statusEffect: null };

    case 'blk_stamina_boost':
      // Бонус к стамине на несколько секунд
      return { extraDamageMultiplier: 1, specialEffect: null, statusEffect: 'stamina_boost' };

    case 'blk_speed_boost':
      // Бонус к скорости на несколько секунд
      return { extraDamageMultiplier: 1, specialEffect: null, statusEffect: 'speed_boost' };

    default:
      return { extraDamageMultiplier: ability.damageMultiplier, specialEffect: null, statusEffect: null };
  }
}

// Навыки по классам