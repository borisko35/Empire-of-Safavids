// Эффекты монстров: что именно навешивается на игрока.
//
// ЗАЧЕМ ЧИСТЫЙ МОДУЛЬ, А НЕ ЛОГИКА В ИГРОВОМ ЦИКЛЕ. В данных одиннадцати
// способностей монстров объявлены effect и effectDuration, и не читался
// ни один. Если бы решение «какой эффект и с каким уроном» жило в
// GameLoop, единственный способ его проверить - поиск по тексту файла,
// а такой проверке всё равно, применяется эффект или нет: она находит
// строку `skill.effect` и успокаивается. Проверка, которая не может
// упасть, хуже отсутствующей.
//
// ВСЁ, ЧТО МОЖНО ВЫРАЗИТЬ ЧИСЛОМ, ВЫРАЖЕНО ЧИСЛОМ. Сколько тиков урона
// набежало за время отсутствия, сколько будет урона за весь эффект,
// сработает ли замедление - всё считается здесь и проверяется перебором
// границ. В GameLoop остаётся только взять ответ и записать его.
import type { MonsterSkill } from '../data/monsters';

/** Виды эффектов. Ровно те, что принимает CHECK в миграции 047. */
export type DebuffKind = 'stun' | 'slow' | 'bleed' | 'poison' | 'fear';

/** Как часто тикает урон со временем, и какая его доля от удара. */
export interface DotProfile {
  /** Период одного тика, мс. */
  tickMs: number;
  /** Доля урона способности, приходящаяся на один тик. */
  perTick: number;
  /** Не тикает чаще, чем раз в 500 мс, и не реже, чем раз в 2 с. */
  limits: { minTickMs: number; maxTickMs: number };
}

export const DOT_PROFILES: Record<'bleed' | 'poison', DotProfile> = {
  // Кровотечение: часто и слабо. Оно должно ощущаться как надбавка за
  // раненого, а не как второй источник смерти. Чаще раза в секунду
  // тикать незачем: и ощущения не добавит, и записей в базу прибавит.
  bleed: { tickMs: 1000, perTick: 0.06, limits: { minTickMs: 500, maxTickMs: 2000 } },
  // Яд: медленно и больно. Длинный интервал даёт игроку время уйти из
  // боя и выпить зелье - иначе яд был бы приговором без выхода.
  poison: { tickMs: 2000, perTick: 0.12, limits: { minTickMs: 500, maxTickMs: 2000 } },
};

/** Доля замедления, если монстр ничего не указал. */
export const DEFAULT_SLOW_MAGNITUDE = 0.3;

export interface DebuffPlan {
  debuffId: string;
  kind: DebuffKind;
  durationMs: number;
  /** slow: доля замедления. Для остальных 0. */
  magnitude: number;
  /** bleed, poison: урон за тик, целым числом. Для остальных 0. */
  tickDamage: number;
  /** bleed, poison: период тика в мс. Для остащих 0. */
  tickMs: number;
}

const isDot = (k: string): k is 'bleed' | 'poison' => k === 'bleed' || k === 'poison';

/**
 * Превратить способность монстра в план эффекта.
 *
 * null - это решение, а не ошибка: у большинства способностей эффекта
 * нет, и это нормально. Способность с пустым effect обязана вернуть null,
 * а не эффект по умолчанию: «Таран» без оглушения был бы совсем другим
 * ударом, чем тот, что нарисован в данных.
 */
export function debuffPlan(
  skill: Pick<MonsterSkill, 'id' | 'damage' | 'effect' | 'effectDuration'>,
): DebuffPlan | null {
  const kind = skill.effect;
  if (!kind) return null;

  // Срок без длительности - это не эффект, а опечатка в данных. Ноль
  // секунд показал бы игроку иконку, которая сразу исчезает.
  const seconds = Number(skill.effectDuration ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const durationMs = Math.round(seconds * 1000);
  const уронСпособности = Math.max(0, Math.floor(Number(skill.damage ?? 0)));

  if (isDot(kind)) {
    const профиль = DOT_PROFILES[kind];
    const tickMs = Math.min(профиль.limits.maxTickMs, Math.max(профиль.limits.minTickMs, профиль.tickMs));
    const tickDamage = Math.max(1, Math.floor(уронСпособности * профиль.perTick));
    return { debuffId: skill.id, kind, durationMs, magnitude: 0, tickDamage, tickMs };
  }

  return {
    debuffId: skill.id,
    kind,
    durationMs,
    magnitude: kind === 'slow' ? DEFAULT_SLOW_MAGNITUDE : 0,
    tickDamage: 0,
    tickMs: 0,
  };
}

/**
 * Сколько тиков урона набежало, пока игрока не было.
 *
 * ПОЧЕМУ НЕ «ОДИН ТИК ЗА ВЫЗОВ». Наивный вариант тикает по разу на
 * каждую проверку. Игрок, закрывший вкладку на минуту, вернулся бы с
 * одной порцией - и яд оказался бы безвредным. Обратный вариант, тик на
 * каждый пропущенный интервал, убил бы игрока за время отсутствия:
 * двадцать тиков в минуту означали бы двести процентов урона от удара.
 *
 * Считаем от last_tick_at и не дальше expires_at. Эффект, истёкший за
 * время отсутствия, не тикает вовсе: он закончился, и начислять за него
 * нечего. Остаток от деления теряется - зато сумма за все секунды не
 * зависит от того, как часто сервер заглядывал в эффект.
 */
export function accruedTicks(
  now: number,
  lastTickAt: number,
  tickMs: number,
  expiresAt: number,
): number {
  if (!(tickMs > 0)) return 0;
  // Время пошло назад - часы перевели или сервер переехал. Начислять
  // по отрицательному интервалу нельзя, и тикнул бы ноль раз.
  if (now <= lastTickAt) return 0;
  const конец = Math.min(now, expiresAt);
  const прошло = конец - lastTickAt;
  if (прошло <= 0) return 0;
  return Math.floor(прошло / tickMs);
}

/** Урон, который набежал за это время. */
export function accruedDamage(ticks: number, tickDamage: number): number {
  const t = Math.max(0, Math.floor(ticks));
  const d = Math.max(0, Math.floor(tickDamage));
  return t * d;
}

/**
 * Множитель от всех замедлений.
 *
 * Замедления складываются, а не перемножаются: два замедления по 30%
 * дают 40% замедления, а не 51%. Иначе пять монстров с «Топтанием»
 * сделали бы игрока практически бессмертным по скорости, и лечение
 * перестало бы иметь смысла. Потолок - 0.8: ниже игрок не двигался бы
 * совсем, и выйти из боя было бы нечем.
 */
export function slowMultiplier(magnitudes: number[]): number {
  let сумма = 0;
  for (const raw of magnitudes) {
    const m = Number(raw);
    if (Number.isFinite(m) && m > 0) сумма += m;
  }
  return Math.max(0.2, 1 - Math.min(сумма, 0.8));
}

/** Осталось ли хоть что-то из эффекта. */
export function isActive(expiresAt: number, now: number = Date.now()): boolean {
  return Number(expiresAt) > now;
}

/**
 * Осталось ли эффекту хоть немного времени.
 *
 * Отдельная проверка вместо `durationMs > 0`: ноль секунд - это не
 * «эффект с истёкшим сроком», а опечатка, и такую способность нельзя
 * навешивать на игрока даже на мгновение. Порог в четверть секунды -
 * меньше тика урона со временем, и такой эффект всё равно ничего бы не
 * успел сделать.
 */
export function isWorthApplying(durationMs: number): boolean {
  return Number(durationMs) >= 250;
}
