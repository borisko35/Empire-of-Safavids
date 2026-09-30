import { GuildService } from '../services/GuildService';
import { CharacterService } from '../services/CharacterService';
// ============================================================
// Система прокачки и прогрессии — Empire of Safavids
// ============================================================

import { Character, CharacterStats, CharacterClass } from '../types/game.types';
import { DatabaseService } from '../services/DatabaseService';
import { logger } from '../utils/logger';
import { analytics } from '../services/AnalyticsService';

export interface LevelUpResult {
  leveledUp: boolean;
  newLevel: number;
  statGains: Partial<CharacterStats>;
  unlockedSkills: string[];
  newTitle?: string;
}

// Очки характеристик за уровень по классам
const STAT_GAINS_PER_LEVEL: Record<CharacterClass, Partial<CharacterStats>> = {
  [CharacterClass.QIZILBASH]:      { strength: 3, agility: 1, intelligence: 0, endurance: 2, charisma: 0 },
  [CharacterClass.SUFI_MYSTIC]:    { strength: 0, agility: 1, intelligence: 3, endurance: 1, charisma: 2 },
  [CharacterClass.PERSIAN_ARCHER]: { strength: 1, agility: 3, intelligence: 1, endurance: 1, charisma: 0 },
  [CharacterClass.BAZAAR_MERCHANT]:{ strength: 0, agility: 2, intelligence: 1, endurance: 1, charisma: 3 },
  [CharacterClass.COURT_DIPLOMAT]: { strength: 0, agility: 1, intelligence: 2, endurance: 1, charisma: 3 },
};

// Навыки, разблокируемые на определённых уровнях
const LEVEL_UNLOCK_SKILLS: Record<number, Record<CharacterClass, string[]>> = {
  10: {
    [CharacterClass.QIZILBASH]:      ['qiz_shield_bash'],
    [CharacterClass.SUFI_MYSTIC]:    ['sufi_heal'],
    [CharacterClass.PERSIAN_ARCHER]: ['arch_rapid'],
    [CharacterClass.BAZAAR_MERCHANT]:['merch_smoke'],
    [CharacterClass.COURT_DIPLOMAT]: ['dipl_poison'],
  },
  30: {
    [CharacterClass.QIZILBASH]:      ['qiz_war_cry'],
    [CharacterClass.SUFI_MYSTIC]:    ['sufi_sema'],
    [CharacterClass.PERSIAN_ARCHER]: ['arch_rain'],
    [CharacterClass.BAZAAR_MERCHANT]:['merch_bribe'],
    [CharacterClass.COURT_DIPLOMAT]: ['dipl_charm'],
  },
  60: {
    [CharacterClass.QIZILBASH]:      ['qiz_ultimate'],
    [CharacterClass.SUFI_MYSTIC]:    ['sufi_ultimate'],
    [CharacterClass.PERSIAN_ARCHER]: ['arch_ultimate'],
    [CharacterClass.BAZAAR_MERCHANT]:['merch_ultimate'],
    [CharacterClass.COURT_DIPLOMAT]: ['dipl_ultimate'],
  },
};

// Титулы за достижение уровней
const LEVEL_TITLES: Record<number, string> = {
  10:  'Новобранец Империи',
  20:  'Воин Шаха',
  30:  'Ветеран Кызылбаш',
  50:  'Герой Персии',
  60:  'Пробуждённый',
  70:  'Легенда Сефевидов',
  100: 'Бессмертный Шаха',
};

// Пробуждение (GDD п.10): на 60-м уровне — новая сила
const AWAKENING_LEVEL = 60;
const AWAKENING_BONUS: CharacterStats = {
  strength: 5, agility: 5, intelligence: 5, endurance: 5, charisma: 5,
};

export class LevelingSystem {
  private db = DatabaseService.getInstance();

  /** Уровень, с которого доступен навык (0 — доступен с начала) */
  static getSkillUnlockLevel(characterClass: CharacterClass, skillId: string): number {
    for (const [lvl, byClass] of Object.entries(LEVEL_UNLOCK_SKILLS)) {
      if (byClass[characterClass]?.includes(skillId)) return Number(lvl);
    }
    return 0;
  }

  /** Формула опыта: exp = level² × 100 */
  static expForLevel(level: number): number {
    return Math.pow(level, 2) * 100;
  }

  /** Текущий уровень по накопленному опыту */
  static levelFromExp(totalExp: number): number {
    return Math.min(100, Math.floor(Math.sqrt(totalExp / 100)) + 1);
  }

  /** Прогресс до следующего уровня (0–1) */
  static progressToNext(totalExp: number): number {
    const currentLevel = this.levelFromExp(totalExp);
    if (currentLevel >= 100) return 1;
    const currentLevelExp = this.expForLevel(currentLevel - 1);
    const nextLevelExp    = this.expForLevel(currentLevel);
    return (totalExp - currentLevelExp) / (nextLevelExp - currentLevelExp);
  }

  async addExperience(character: Character, amount: number, source: string): Promise<LevelUpResult> {
    const oldLevel = character.level;
    const newTotalExp = character.experience + amount;
    const newLevel = LevelingSystem.levelFromExp(newTotalExp);
    const leveledUp = newLevel > oldLevel;

    const statGains: Partial<CharacterStats> = {};
    const unlockedSkills: string[] = [];
    let newTitle: string | undefined;

    if (leveledUp) {
      const gains = STAT_GAINS_PER_LEVEL[character.class];
      const levelsGained = newLevel - oldLevel;

      // Суммируем прирост характеристик за все уровни и складываем
      // в JS (jsonb-конкатенация «||» заменяет значения, а не прибавляет)
      const newStats: CharacterStats = { ...character.stats };
      for (const [stat, gain] of Object.entries(gains) as [keyof CharacterStats, number][]) {
        statGains[stat] = gain * levelsGained;
        newStats[stat] = (newStats[stat] ?? 0) + gain * levelsGained;
      }

      // Разблокируем навыки
      let awakened = false;
      for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
        const skills = LEVEL_UNLOCK_SKILLS[lvl]?.[character.class];
        if (skills) unlockedSkills.push(...skills);
        if (LEVEL_TITLES[lvl]) newTitle = LEVEL_TITLES[lvl];
        if (lvl === AWAKENING_LEVEL) awakened = true;
      }

      // Пробуждение: разовый бонус ко всем характеристикам
      if (awakened) {
        for (const [stat, bonus] of Object.entries(AWAKENING_BONUS) as [keyof CharacterStats, number][]) {
          statGains[stat] = (statGains[stat] ?? 0) + bonus;
          newStats[stat] = (newStats[stat] ?? 0) + bonus;
        }
      }

      // Обновляем БД
      await this.db.transaction(async (client) => {
        await client.query(
          `UPDATE characters SET
            experience = $1, level = $2,
            stats = $3::jsonb,
            -- База растёт тем же приростом. Поведение не меняется: обе
            -- колонки идут в ногу, и max_hp пока равно base_max_hp.
            -- Смысл разделения - в следующем шаге, где max_hp станет
            -- base_max_hp плюс бонус гильдии, и снять бонус будет от чего.
            -- max_hp в этой транзакции НЕ участвует: он выводится из
            -- base_max_hp и множителя гильдии пересчётом ПОСЛЕ. Раньше
            -- здесь стояло max_hp = max_hp + $4, и бонус оставался бы в
            -- старой пропорции.
            base_max_hp = base_max_hp + $4,
            max_mana = max_mana + $5,
            updated_at = NOW()
           WHERE id = $6`,
          [
            newTotalExp, newLevel,
            JSON.stringify(newStats),
            (statGains.endurance ?? 0) * 10,
            (statGains.intelligence ?? 0) * 8,
            character.id,
          ]
        );

        if (newTitle) {
          await client.query(
            `INSERT INTO character_titles (character_id, title) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [character.id, newTitle]
          );
        }
      });

      // Пересчёт ПОСЛЕ транзакции: он читает уже обновлённую базу.
      // Множитель берётся отдельным запросом ДО боя, а не внутри
      // транзакции - чтобы запрос за уровнями навыка не держал её открытой.
      const множитель = await new GuildService().hpMultiplierFor(character.id).catch(() => 1);
      await new CharacterService().recalcMaxHp(character.id, множитель);

      logger.info(`Level up: ${character.name} ${oldLevel} → ${newLevel} (${source})${awakened ? ' — AWAKENED' : ''}`);

      // Событие level_up тоже было в списке, но не писалось. С ним
      // видно, до какого уровня доходит новичок и где поток рвётся: по
      // одному characters.level этого не узнать, там лежит текущий уровень
      // всех, кто остался в базе, без времени и без порядка.
      analytics.track(
        'level_up',
        { from: oldLevel, to: newLevel, source, awakened },
        character.userId,
        character.id,
      );
    } else {
      await this.db.query(
        'UPDATE characters SET experience = $1, updated_at = NOW() WHERE id = $2',
        [newTotalExp, character.id]
      );
    }

    return { leveledUp, newLevel, statGains, unlockedSkills, newTitle };
  }
}
