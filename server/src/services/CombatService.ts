import { Character, CombatAction, CharacterClass } from '../types/game.types';
import { logger } from '../utils/logger';
import { DEFAULT_WEAPON, WeaponProfile } from './EquipmentCache';

interface DamageResult {
  damage: number;
  isCritical: boolean;
  isBlocked: boolean;
  isDodged: boolean;
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

export class CombatService {
  /**
   * comboMultiplier — множитель цепочки лёгких атак (каждый третий удар
   * серии бьёт тяжелее). Передаётся сокет-обработчиком, у монстров и PvP
   * он одинаково легитимен: состояние серии считает сервер.
   *
   * weapon — оружие «в руках». Раньше его не существовало: урон целиком
   * считался из характеристик, поэтому шамшир, сабля и лук били одинаково.
   * Теперь множитель предмета входит в базу удара.
   */
  calculateDamage(
    attacker: Character,
    target: Character,
    action: CombatAction,
    comboMultiplier = 1,
    weapon: WeaponProfile | null = null
  ): DamageResult {
    const baseDamage = this.getBaseDamage(attacker, action, weapon) * comboMultiplier;
    const defense = this.getDefense(target);

    // Шанс уклонения
    const dodgeChance = target.stats.agility * 0.3;
    if (Math.random() * 100 < dodgeChance) {
      return { damage: 0, isCritical: false, isBlocked: false, isDodged: true };
    }

    // Шанс блока
    const blockChance = target.class === CharacterClass.QIZILBASH ? 25 : 10;
    if (action.actionType !== 'skill' && Math.random() * 100 < blockChance) {
      return { damage: Math.floor(baseDamage * 0.2), isCritical: false, isBlocked: true, isDodged: false };
    }

    // Шанс крита
    const critChance = attacker.stats.agility * 0.5;
    const isCritical = Math.random() * 100 < critChance;
    const critMultiplier = isCritical ? 1.5 : 1.0;

    const finalDamage = Math.max(1, Math.floor((baseDamage - defense) * critMultiplier));

    logger.debug(`Combat: ${attacker.name} -> ${target.name}: ${finalDamage} dmg (crit: ${isCritical})`);

    return { damage: finalDamage, isCritical, isBlocked: false, isDodged: false };
  }

  private getBaseDamage(character: Character, action: CombatAction, weapon: WeaponProfile | null = null): number {
    const weaponDamage = weapon?.damage ?? DEFAULT_WEAPON.damage;
    const statDamage = (character.stats.strength * 2 + character.stats.agility) * weaponDamage;

    if (action.actionType === 'skill' && action.skillId) {
      const skills = CLASS_SKILLS[character.class];
      const skill = skills.find(s => s.id === action.skillId);
      if (skill) return statDamage * skill.damageMultiplier;
    }

    return statDamage;
  }

  private getDefense(character: Character): number {
    return character.stats.endurance * 1.5;
  }

  getClassSkills(characterClass: CharacterClass): SkillDefinition[] {
    return CLASS_SKILLS[characterClass];
  }

  /** Найти навык по ID (среди навыков класса персонажа) */
  getSkill(characterClass: CharacterClass, skillId: string): SkillDefinition | undefined {
    return CLASS_SKILLS[characterClass]?.find(s => s.id === skillId);
  }

  /** Лечащие навыки имеют отрицательный damageMultiplier */
  isHealSkill(characterClass: CharacterClass, skillId: string): boolean {
    const skill = this.getSkill(characterClass, skillId);
    return !!skill && skill.damageMultiplier < 0;
  }

  /** Базовый урон персонажа (до множителей) — используется для лечения и анти-чита */
  getBaseDamageFor(character: Character): number {
    return this.getBaseDamage(character, { actionType: 'attack' } as CombatAction);
  }

  /**
   * База анти-чита с учётом оружия.
   *
   * Анти-чит сравнивает урон с базой и отбрасывает слишком большой. Если бы
   * база осталась без множителя оружия, то клинок Шаха (1.25) выглядел бы
   * как законный урон в 1.25 раза больше базы - и на трёхсотом ударе
   * сработал бы порог. Поэтому база считается тем же способом, что и урон.
   */
  getBaseDamageWithWeapon(character: Character, weapon: WeaponProfile | null): number {
    return this.getBaseDamage(character, { actionType: 'attack' } as CombatAction, weapon);
  }
}
