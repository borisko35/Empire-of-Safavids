// Навыки гильдии: что за них действительно дают.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ФУНКЦИЯ В GUILDSERVICE. В data/guilds.ts
// объявлено пять навыков, и ни один не работал. Если бы решение «можно ли
// купить и что он даёт» жило в сервисе вместе с запросами в базу, единственный
// способ его проверить был бы поиск по тексту файла - а такой проверке всё
// равно, применяется бонус или нет: она находит `guild_exp_boost` и успокаивается.
// Проверка, которая не может упасть, хуже отсутствующей.
//
// ПРО «НЕ ВСЕ НАВЫКИ РАБОТАЮТ». Данных пять, а точек применения - две:
//// опыт и золото. У прироста HP, скорости крафта и силы осады нет места,
// куда их подставить, и молча купить их значило бы взять золото гильдии за
// пустоту. Поэтому за них просто нельзя заплатить: см. WIRED_EFFECTS.
// Это честнее, чем нарисовать иконку и ничего не дать.
import { GUILD_SKILLS } from '../data/guilds';

/** Виды эффектов, объявленных в справочнике. */
export type GuildSkillEffect =
  | 'exp_multiplier' | 'gold_multiplier' | 'max_hp_bonus'
  | 'craft_speed' | 'siege_damage';

/**
 * Эффекты, к которым есть настоящая точка применения.
 *
 * Закрытый список. Навык, эффект которого сюда не входит, покупаться не
 * может - иначе гильдия платила бы золотом за пустоту.
 */
export const WIRED_EFFECTS: readonly GuildSkillEffect[] = ['exp_multiplier', 'gold_multiplier', 'craft_speed'];

/** Множители за один уровень навыка. Берутся из описания в данных. */
export const PER_LEVEL = {
  exp_multiplier: 0.02,
  gold_multiplier: 0.03,
  // Скорость крафта - это УМЕНЬШЕНИЕ времени, а не множитель сверху.
  // Поэтому здесь доля срезаемого, а положительный множитель получается
  // как 1 - срез. Складывать 0.05 десять раз и брать 1 минус остаток
  // означало бы одно и то же, но знак читался бы неверно.
  craft_speed: 0.05,
} as const;

/**
 * Нижняя граница скорости крафта.
 *
 * Навык описан как «-5% за уровень», максимум 10 уровней - это -50%, и
 * время не обнуляется никогда. Нижняя граница страховка: если когда-нибудь
 * появится уровень выше десятого или накопится ошибка, рецепт не станет
 * мгновенным, а останется хотя бы секундным.
 */
export const MIN_CRAFT_SPEED = 0.1;

/** Сколько стоит уровень: стоимость из справочника, а не выдуманная. */
export function costPerLevel(skillId: string): number {
  return GUILD_SKILLS.find(s => s.id === skillId)?.costPerLevel ?? 0;
}

/** Максимальный уровень из справочника. */
export function maxLevel(skillId: string): number {
  return GUILD_SKILLS.find(s => s.id === skillId)?.maxLevel ?? 0;
}

export interface GuildBonuses {
  /** Множитель опыта. 1 - без бонуса. */
  exp: number;
  /** Множитель золота с монстров. 1 - без бонуса. */
  gold: number;
  /** Множитель ВРЕМЕНИ крафта. 1 - без бонуса, меньше 1 - быстрее. */
  craft: number;
  /** id навыков, за которые нельзя заплатить: точка применения не подключена. */
  unavailable: string[];
}

/**
 * Бонусы гильдии по уровням навыков.
 *
 * Чистая функция: ради неё перебираются границы и потолки. Суммирование
 * линейное и без потолка сверху по одной причине - бонус должен быть
 * предсказуемым: игрок вкладывает золото по 5000 за уровень и должен
 * знать, что получит. Потолок здесь был бы «сюрпризом наоборот».
 *
 * Уровень выше потолка из справочника игнорируется, а не учитывается
 * частично: навык нельзя купить выше потолка (запрет в сервисе и CHECK в
 * базе), и если бы строка всё же оказалась выше, бонус посчитал бы по
 * потолку, а не выдал больше.
 */
export function guildBonuses(levels: Record<string, number>): GuildBonuses {
  let exp = 1;
  let gold = 1;
  let craft = 1;
  const unavailable: string[] = [];

  for (const skill of GUILD_SKILLS) {
    const сырой = Number(levels?.[skill.id] ?? 0);
    const level = Number.isFinite(сырой) ? Math.max(0, Math.floor(сырой)) : 0;
    const effect = skill.effect as GuildSkillEffect;

    if (!WIRED_EFFECTS.includes(effect)) {
      // Навык есть в данных, но точка применения не подключена. За него
      // нельзя заплатить, и бонуса он не даёт.
      if (level > 0) unavailable.push(skill.id);
      continue;
    }

    const потолок = Math.min(level, skill.maxLevel);
    if (effect === 'exp_multiplier') exp += потолок * PER_LEVEL.exp_multiplier;
    if (effect === 'gold_multiplier') gold += потолок * PER_LEVEL.gold_multiplier;
    // Время крафта уменьшается, поэтому множитель меньше единицы, и
    // результат зажимается снизу: рецепт не должен стать мгновенным.
    if (effect === 'craft_speed') {
      craft = Math.max(MIN_CRAFT_SPEED, 1 - потолок * PER_LEVEL.craft_speed);
    }
  }

  return { exp, gold, craft, unavailable };
}

/** Можно ли купить этот навык: он есть в справочнике и за него есть точка применения. */
export function isSkillWired(skillId: string): boolean {
  const skill = GUILD_SKILLS.find(s => s.id === skillId);
  if (!skill) return false;
  return WIRED_EFFECTS.includes(skill.effect as GuildSkillEffect);
}

/**
 * Сколько стоит покупка уровней подряд.
 *
 * Считается поштучно, а не «уровень умножается на цену»: покупка сразу
 * десяти уровней за раз должна стоить столько же, сколько десять покупок
 * по одной, иначе в описании цены была бы ложь.
 */
export function upgradeCost(skillId: string, levels: number): number {
  const цена = costPerLevel(skillId);
  if (!цена) return 0;
  const сколько = Math.max(0, Math.floor(levels));
  return цена * сколько;
}
