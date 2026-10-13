// ============================================================
// Караул — данные о вербуемых солдатах
// ============================================================
//
// ЗАЧЕМ. «Вербовка караула»: игрок нанимает солдат в казармах и выводит их
// в бой. Идея из очереди идей карты (ROADMAP §3, пункт 2).
//
// ПОЧЕМУ НЕ МОНСТРЫ ИЗ ТАБЛИЦЫ МОНСТРОВ. Монстр живёт по своим правилам:
// спавнится в своём регионе, сам выбирает жертву, умирает и респавнится по
// своему таймеру. Наёмник должен жить по правилам хозяина: стоять там, куда
// его привели, бить, куда скажут, и умирать не по расписанию, а от удара.
// Поэтому это своя сущность со своим здоровьем, а не строка из чужой
// таблицы.
//
// ПОЧЕМУ ТРИ ДОЛИ, А НЕ ОДНА СТАТЬЯ. Караван скупает серебро: за копейку
// не берут, а за полную цену дают толпу. Разброс по трём долям делает
// выбор настоящим: дёшево и много, дорого и сильно.
//
// ЦЕНЫ. Подобраны от наблюдения, а не от выдумки: замер боя в §177 дал
// 47 урона обычным ударом и 170 опыта за волка. Ополченец должен быть
// слабее одного удара игрока (иначе нанимать бессмысленно), ветеран — на
// уровень одного удара, гвардеец — заметно выше, но за цену, которую
// новичку не выдать случайно.
import type { LocaleCode } from '../../../shared/i18n';

export type SoldierTier = 'levy' | 'veteran' | 'elite';

export interface SoldierDefinition {
  id: SoldierTier;
  /** Порядок в панели: от дешёвого к дорогому. */
  order: number;
  names: Record<LocaleCode, string>;
  /** Сколько золота стоит наём. */
  cost: number;
  maxHp: number;
  /** Урон за удар в бою. Считается против защиты цели по общей формуле. */
  damage: number;
  /** Доля урона, которую солдат забирает на себя вместо игрока. */
  guardShare: number;
  /** Доля опыта за убийство, доходящая солдату (в записи боя, не игроку). */
  minLevel: number;
  description: Record<LocaleCode, string>;
}

export const SOLDIERS: Record<SoldierTier, SoldierDefinition> = {
  levy: {
    id: 'levy',
    order: 1,
    names: { ru: 'Ополченец', en: 'Levy', az: 'Əsgər' },
    cost: 250,
    maxHp: 60,
    damage: 12,
    guardShare: 0.25,
    minLevel: 1,
    description: {
      ru: 'Хватка есть, доспеха нет. Дёшев и много — держит удар, но сам слаб.',
      en: 'No armour, plenty of numbers. Cheap and many, but he is weak.',
      az: 'Zirh yoxdur, say çoxdur. Ucuzdur, amma zəifdir.',
    },
  },
  veteran: {
    id: 'veteran',
    order: 2,
    names: { ru: 'Ветеран', en: 'Veteran', az: 'Veteran' },
    cost: 900,
    maxHp: 140,
    damage: 28,
    guardShare: 0.4,
    minLevel: 5,
    description: {
      ru: 'Прошёл караван и не разучился. Дорог, но забирает на себя удар.',
      en: 'Walked the caravan and kept his trade. Costly, but he takes the blow.',
      az: 'Karvanı keçdi, işini bilir. Bahalıdır, amma zərbəni özünə götürür.',
    },
  },
  elite: {
    id: 'elite',
    order: 3,
    names: { ru: 'Гвардеец', en: 'Guard', az: 'Qvardiyа' },
    cost: 2600,
    maxHp: 300,
    damage: 55,
    guardShare: 0.55,
    minLevel: 12,
    description: {
      ru: 'Личная стража хозяина. Бьёт сильнее, чем игрок, и стоит как крыша.',
      en: 'A personal guard. Hits harder than his master and costs like a roof.',
      az: 'Şahın şəxsi qvardiyası. Sahibindən güclü vurur, qiyməti damdan aşıqdır.',
    },
  },
};

/** Доли по порядку панели. */
export const SOLDIER_TIERS: SoldierDefinition[] = Object.values(SOLDIERS).sort((a, b) => a.order - b.order);

/** Больше этого нанять нельзя: караул у двери должен оставаться караулом. */
export const MAX_SOLDIERS = 6;

/** Восстановление здоровья в покое: доля в минуту. */
export const SOLDIER_REST_RATE_PER_MIN = 0.12;

/**
 * Сколько здоровья солдат восстановит за `минут` минут без боя.
 *
 * Порог в одну минуту, а не ноль: солдат, который секунду не бил, не должен
 * «отдохнуть». И потолок снизу в 1: полное здоровье должно быть достижимо
 * целиком, а не asymptotically.
 */
export function отдых(hp: number, maxHp: number, минут: number): number {
  if (минут <= 0) return hp;
  const полное = Math.ceil(maxHp * SOLDIER_REST_RATE_PER_MIN * минут);
  return Math.min(maxHp, Math.max(1, hp + полное));
}