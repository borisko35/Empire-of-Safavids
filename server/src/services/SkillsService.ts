// ============================================================
// Skills & Professions Service
// ============================================================

import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';

export interface SkillDef {
  id: string;
  name: string;
  nameRu: string;
  professionId: string;
  level: number;
  xp: number;
  manaCost: number;
  staminaCost: number;
  cooldown: number;
  damageMultiplier: number;
  range: number;
  aoe: boolean;
}

export interface ProfessionDef {
  id: string;
  name: string;
  nameRu: string;
  description: string;
  icon: string;
  level: number;
  xp: number;
}

const SKILLS: SkillDef[] = [
  // Warrior skills
  { id: 'power_strike', name: 'power_strike', nameRu: 'Мощный удар', professionId: 'warrior', level: 1, xp: 0, manaCost: 10, staminaCost: 15, cooldown: 2, damageMultiplier: 1.5, range: 3, aoe: false },
  { id: 'whirlwind', name: 'whirlwind', nameRu: 'Вихрь', professionId: 'warrior', level: 5, xp: 100, manaCost: 25, staminaCost: 30, cooldown: 8, damageMultiplier: 1.2, range: 5, aoe: true },
  { id: 'battle_cry', name: 'battle_cry', nameRu: 'Боевой клич', professionId: 'warrior', level: 10, xp: 300, manaCost: 20, staminaCost: 0, cooldown: 30, damageMultiplier: 0, range: 10, aoe: true },
  { id: 'shield_wall', name: 'shield_wall', nameRu: 'Стена щитов', professionId: 'warrior', level: 15, xp: 500, manaCost: 30, staminaCost: 20, cooldown: 45, damageMultiplier: 0, range: 3, aoe: true },
  { id: 'execution', name: 'execution', nameRu: 'Казнь', professionId: 'warrior', level: 25, xp: 1000, manaCost: 40, staminaCost: 40, cooldown: 15, damageMultiplier: 3.0, range: 3, aoe: false },
  // Archer skills
  { id: 'aimed_shot', name: 'aimed_shot', nameRu: 'Прицельный выстрел', professionId: 'archer', level: 1, xp: 0, manaCost: 8, staminaCost: 10, cooldown: 1.5, damageMultiplier: 1.3, range: 12, aoe: false },
  { id: 'rain_arrows', name: 'rain_arrows', nameRu: 'Дождь стрел', professionId: 'archer', level: 5, xp: 100, manaCost: 30, staminaCost: 25, cooldown: 10, damageMultiplier: 0.8, range: 15, aoe: true },
  { id: 'eagle_eye', name: 'eagle_eye', nameRu: 'Орлиный глаз', professionId: 'archer', level: 10, xp: 300, manaCost: 15, staminaCost: 5, cooldown: 60, damageMultiplier: 0, range: 999, aoe: false },
  { id: 'poison_arrow', name: 'poison_arrow', nameRu: 'Отравленная стрела', professionId: 'archer', level: 15, xp: 500, manaCost: 20, staminaCost: 15, cooldown: 8, damageMultiplier: 0.9, range: 12, aoe: false },
  { id: 'headshot', name: 'headshot', nameRu: 'Удар в голову', professionId: 'archer', level: 25, xp: 1000, manaCost: 35, staminaCost: 30, cooldown: 12, damageMultiplier: 4.0, range: 15, aoe: false },
  // Merchant skills
  { id: 'haggle', name: 'haggle', nameRu: 'Торг', professionId: 'merchant', level: 1, xp: 0, manaCost: 0, staminaCost: 5, cooldown: 5, damageMultiplier: 0, range: 0, aoe: false },
  { id: 'bulk_buy', name: 'bulk_buy', nameRu: 'Оптовая покупка', professionId: 'merchant', level: 5, xp: 100, manaCost: 10, staminaCost: 10, cooldown: 30, damageMultiplier: 0, range: 0, aoe: false },
  { id: 'market_insight', name: 'market_insight', nameRu: 'Рыночная мудрость', professionId: 'merchant', level: 10, xp: 300, manaCost: 15, staminaCost: 5, cooldown: 120, damageMultiplier: 0, range: 0, aoe: false },
  // Herbalist skills
  { id: 'herb_gather', name: 'herb_gather', nameRu: 'Сбор трав', professionId: 'herbalist', level: 1, xp: 0, manaCost: 0, staminaCost: 10, cooldown: 3, damageMultiplier: 0, range: 5, aoe: false },
  { id: 'heal_tonic', name: 'heal_tonic', nameRu: 'Лечебный тоник', professionId: 'herbalist', level: 5, xp: 100, manaCost: 20, staminaCost: 10, cooldown: 15, damageMultiplier: 0, range: 0, aoe: false },
  { id: 'antidote', name: 'antidote', nameRu: 'Антидот', professionId: 'herbalist', level: 10, xp: 300, manaCost: 15, staminaCost: 5, cooldown: 20, damageMultiplier: 0, range: 0, aoe: false },
  // Blacksmith skills
  { id: 'forge_weapon', name: 'forge_weapon', nameRu: 'Кузница оружия', professionId: 'blacksmith', level: 1, xp: 0, manaCost: 10, staminaCost: 20, cooldown: 60, damageMultiplier: 0, range: 0, aoe: false },
  { id: 'reinforce_armor', name: 'reinforce_armor', nameRu: 'Укрепление брони', professionId: 'blacksmith', level: 5, xp: 100, manaCost: 15, staminaCost: 15, cooldown: 45, damageMultiplier: 0, range: 0, aoe: false },
  { id: 'masterwork', name: 'masterwork', nameRu: 'Мастерский шедевр', professionId: 'blacksmith', level: 15, xp: 500, manaCost: 30, staminaCost: 30, cooldown: 120, damageMultiplier: 0, range: 0, aoe: false },
  // Explorer skills
  { id: 'spot_secret', name: 'spot_secret', nameRu: 'Поиск секретов', professionId: 'explorer', level: 1, xp: 0, manaCost: 5, staminaCost: 5, cooldown: 10, damageMultiplier: 0, range: 20, aoe: false },
  { id: 'treasure_map', name: 'treasure_map', nameRu: 'Карта сокровищ', professionId: 'explorer', level: 10, xp: 300, manaCost: 20, staminaCost: 10, cooldown: 300, damageMultiplier: 0, range: 0, aoe: false },
];

const PROFESSIONS: ProfessionDef[] = [
  { id: 'warrior', name: 'warrior', nameRu: 'Воин', description: 'Мастер ближнего боя. Увеличивает урон оружием на 15%.', icon: 'sword', level: 1, xp: 0 },
  { id: 'archer', name: 'archer', nameRu: 'Лучник', description: 'Мастер дальнего боя. Увеличивает точность на 20%.', icon: 'bow', level: 1, xp: 0 },
  { id: 'merchant', name: 'merchant', nameRu: 'Торговец', description: 'Скидка 10% на все покупки.', icon: 'coins', level: 1, xp: 0 },
  { id: 'herbalist', name: 'herbalist', nameRu: 'Травник', description: 'Зелья действуют на 20% сильнее.', icon: 'leaf', level: 1, xp: 0 },
  { id: 'blacksmith', name: 'blacksmith', nameRu: 'Кузнец', description: 'Возможность улучшать оружие и броню.', icon: 'hammer', level: 1, xp: 0 },
  { id: 'explorer', name: 'explorer', nameRu: 'Исследователь', description: 'Открывает секретные локации.', icon: 'compass', level: 1, xp: 0 },
];

/**
 * Насколько опыта нужно навыку, чтобы взять следующий уровень.
 *
 * Порог был `level * 100`, а остаток при повышении вычитался как
 * `newLevel * 100`. То есть требовалось по старому уровню, а остаток
 * считался по новому: на втором уровне игрок получал 200 опыта при
 * необходимых 100 и уносил с собой лишнее. Мелочь, из-за которой
 * прокачка шла быстрее задуманного и по-разному на каждом уровне.
 */
/**
 * Сколько урона нужно набрать, чтобы дать одну порцию опыта.
 *
 * Порог нужен по двум причинам. Первый: начисление на каждый удар
 * отдельно округлялось бы в ноль при мелких ударах, и быстрый клинок
 * прокачивался бы медленнее тяжёлого — противоположно смыслу. Второй:
 * без порога каждый удар означал бы запись в базу, а это сотни записей
 * за минуту боя.
 */
export const SKILL_XP_DAMAGE_STEP = 60;

export function skillXpForNextLevel(level: number): number {
  return 100 + (level - 1) * 50;
}

export interface XpGainResult {
  /** Навык после начисления: уровень и остаток опыта. */
  level: number;
  xp: number;
  /** Сколько уровней взято за раз: одна выдача может дать и два. */
  levelsGained: number;
}

/**
 * Посчитать новый уровень и остаток опыта. Чистая функция — ради неё
 * написан тест, который перебирает рубежи: сдвиг на единицу в этой
 * арифметике не виден ни в описании, ни в панели.
 */
export function applySkillXp(currentLevel: number, currentXp: number, xpGain: number): XpGainResult {
  let level = Math.max(1, currentLevel);
  let xp = Math.max(0, currentXp) + Math.max(0, xpGain);
  let levelsGained = 0;
  // Потолок совпадает с потолком в базе: выше 50 навык не растёт, и опыт
  // копится в остатке, а не пропадает молча.
  while (level < 50 && xp >= skillXpForNextLevel(level)) {
    xp -= skillXpForNextLevel(level);
    level++;
    levelsGained++;
  }
  if (level >= 50) xp = Math.min(xp, skillXpForNextLevel(50));
  return { level, xp, levelsGained };
}

export class SkillsService {
  private db = DatabaseService.getInstance();

  /**
   * Начислить опыт навыку от настоящего действия.
   *
   * Единственный путь начисления. Маршрут, где клиент присылал
   * `xp: 1000000`, удалён: он позволял вошедшему игроку прокачать чужой
   * навык на чужого персонажа до потолка одним запросом.
   */
  async gainSkillXp(characterId: string, skillId: string, xpGain: number): Promise<XpGainResult | null> {
    if (!Number.isFinite(xpGain) || xpGain <= 0) return null;
    const row = await this.db.queryOne<{ level: number; xp: number }>(
      'SELECT level, xp FROM character_skills WHERE character_id = $1 AND skill_id = $2',
      [characterId, skillId]
    );
    if (!row) return null;
    const skill = SKILLS.find(s => s.id === skillId);
    if (!skill) return null;

    const result = applySkillXp(Number(row.level), Number(row.xp), xpGain);
    await this.db.query(
      'UPDATE character_skills SET level = $1, xp = $2 WHERE character_id = $3 AND skill_id = $4',
      [result.level, result.xp, characterId, skillId]
    );
    if (result.levelsGained > 0) {
      logger.info(`[Skills] ${characterId} ${skillId} -> level ${result.level} (+${result.levelsGained})`);
    }
    return result;
  }

  /**
   * Профессиональный опыт от того же действия.
   *
   * Порог и остаток считаются той же формулой, что и у навыка: раньше
   * профессия требовала `level * 200` при остатке по новому уровню —
   * та же ошибка, что была в навыках.
   */
  async gainProfessionXp(characterId: string, xp: number): Promise<(ProfessionDef & { levelsGained: number }) | null> {
    if (!Number.isFinite(xp) || xp <= 0) return null;
    const row = await this.db.queryOne<{ profession_id: string; level: number; xp: number }>(
      'SELECT profession_id, level, xp FROM character_professions WHERE character_id = $1',
      [characterId]
    );
    if (!row) return null;
    const prof = PROFESSIONS.find(p => p.id === row.profession_id);
    if (!prof) return null;

    const result = applySkillXp(Number(row.level), Number(row.xp), xp);
    await this.db.query(
      'UPDATE character_professions SET level = $1, xp = $2 WHERE character_id = $3',
      [result.level, result.xp, characterId]
    );
    return { ...prof, level: result.level, xp: result.xp, levelsGained: result.levelsGained };
  }

  async getCharacterSkills(characterId: string): Promise<SkillDef[]> {
    const rows = await this.db.query<{ skill_id: string; level: number; xp: number; unlocked_at: Date }>(
      `SELECT skill_id, level, xp, unlocked_at FROM character_skills WHERE character_id = $1 ORDER BY level DESC`,
      [characterId]
    );
    return rows.map(r => {
      const base = SKILLS.find(s => s.id === r.skill_id);
      if (!base) return null;
      return { ...base, level: r.level, xp: r.xp };
    }).filter((s): s is SkillDef => s !== null);
  }

  async getAvailableSkills(characterId: string, professionId?: string): Promise<SkillDef[]> {
    const owned = await this.getCharacterSkills(characterId);
    const ownedIds = new Set(owned.map(s => s.id));
    const profFilter = professionId || (owned[0]?.professionId);
    return SKILLS.filter(s => 
      !ownedIds.has(s.id) && 
      (!profFilter || s.professionId === profFilter) &&
      s.level <= 30
    );
  }

  async learnSkill(characterId: string, skillId: string, userId: string): Promise<SkillDef> {
    const skill = SKILLS.find(s => s.id === skillId);
    if (!skill) throw new Error('Skill not found');
    
    const existing = await this.db.queryOne(
      'SELECT id FROM character_skills WHERE character_id = $1 AND skill_id = $2',
      [characterId, skillId]
    );
    if (existing) throw new Error('Skill already known');

    const char = await this.db.queryOne<{ profession_id: string | null }>(
      'SELECT profession_id FROM characters WHERE id = $1', [characterId]
    );
    if (char?.profession_id !== skill.professionId) {
      throw new Error(`Requires ${skill.professionId} profession`);
    }

    await this.db.query(
      `INSERT INTO character_skills (character_id, skill_id, level, xp, unlocked_at)
       VALUES ($1, $2, 1, 0, NOW())`,
      [characterId, skillId]
    );

    await this.db.query(
      `UPDATE characters SET play_time = play_time + 60 WHERE id = $1`,
      [characterId]
    );

    logger.info(`[Skills] ${userId} learned ${skillId}`);
    return { ...skill, level: 1, xp: 0 };
  }

  // Professions
  async getCharacterProfession(characterId: string): Promise<ProfessionDef | null> {
    const row = await this.db.queryOne<{ profession_id: string; level: number; xp: number }>(
      'SELECT profession_id, level, xp FROM character_professions WHERE character_id = $1',
      [characterId]
    );
    if (!row) return null;
    const base = PROFESSIONS.find(p => p.id === row.profession_id);
    return base ? { ...base, level: row.level, xp: row.xp } : null;
  }

  async unlockProfession(characterId: string, professionId: string, userId: string): Promise<ProfessionDef> {
    const prof = PROFESSIONS.find(p => p.id === professionId);
    if (!prof) throw new Error('Profession not found');

    const existing = await this.db.queryOne(
      'SELECT id FROM character_professions WHERE character_id = $1',
      [characterId]
    );
    if (existing) throw new Error('Already has a profession');

    await this.db.query(
      `INSERT INTO character_professions (character_id, profession_id, level, xp, unlocked_at)
       VALUES ($1, $2, 1, 0, NOW())`,
      [characterId, professionId]
    );
    await this.db.query(
      `UPDATE characters SET profession_id = $1 WHERE id = $2`,
      [professionId, characterId]
    );

    logger.info(`[Professions] ${userId} unlocked ${professionId}`);
    return { ...prof, level: 1, xp: 0 };
  }

  async getProfessionSkills(professionId: string): Promise<SkillDef[]> {
    return SKILLS.filter(s => s.professionId === professionId);
  }

  /**
   * Опыт до следующего уровня навыка — панели нужен сам порог, а не только
   * накопленное. Без него игрок видит «120 XP» и не понимает, сколько ещё.
   */
  async getSkillProgress(characterId: string, skillId: string): Promise<{ level: number; xp: number; needed: number } | null> {
    const row = await this.db.queryOne<{ level: number; xp: number }>(
      'SELECT level, xp FROM character_skills WHERE character_id = $1 AND skill_id = $2',
      [characterId, skillId]
    );
    if (!row) return null;
    return {
      level: Number(row.level),
      xp: Number(row.xp),
      needed: skillXpForNextLevel(Number(row.level)),
    };
  }

  /**
   * Полный начис по бою: профессия плюс навык.
   *
   * Оба решения принимаются здесь, а не в обработчике сокета, потому что
   * только тут известно, какие навыки у персонажа вообще выучены. Правила
   * честные и проверяемые:
   *
   *  - опыт капает только за урон, который действительно прилетел. Уход
   *    в dodge, промах и удар, снятый щитом, опыта не дают, иначе можно
   *    было бы качать навык, стоя на месте;
   *  - удар навыком даёт больше опыта, чем обычный: навык, в который
   *    игрок вложился, и должен расти быстрее;
   *  - навык качается только тот, которым били. Остальные не растут «за
   *    компанию» — иначе можно было бы выучить дешёвый навык и растить
   *    им дорогой, ни разу его не применив;
   *  - обычный удар растит самый ранний по требованию уровню из выученных,
   *    иначе прокачка навыков жила бы только на классовых умениях.
   */
  async gainProgressForHit(
    characterId: string,
    usedSkillId: string | null,
    damage: number
  ): Promise<{ skill: XpGainResult | null; profession: (ProfessionDef & { levelsGained: number }) | null }> {
    if (!Number.isFinite(damage) || damage <= 0) return { skill: null, profession: null };

    const steps = Math.floor(damage / SKILL_XP_DAMAGE_STEP);
    if (steps < 1) return { skill: null, profession: null };

    const isSkill = !!usedSkillId;
    const profession = await this.gainProfessionXp(characterId, steps * (isSkill ? 2 : 1));

    let targetId = usedSkillId;
    if (!targetId) {
      const learned = await this.db.query<{ skill_id: string }>(
        `SELECT skill_id FROM character_skills
          WHERE character_id = $1
          ORDER BY level ASC, unlocked_at ASC`,
        [characterId]
      ).catch(() => []);
      targetId = learned[0]?.skill_id ?? null;
    }
    const skill = targetId ? await this.gainSkillXp(characterId, targetId, steps * (isSkill ? 3 : 1)) : null;
    return { skill, profession };
  }
}

export const skillsService = new SkillsService();
