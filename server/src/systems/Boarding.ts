// Ядро абордажа: два режима одной механикой.
//
// Симметрия — главное свойство. Всё, что относится к бою (дистанция, срок,
// награда, ошибки), работает одинаково для 'pve' и 'pvp'. Разница ровно в
// двух местах: откуда берутся цели и чем грозит PvP. Проверка это сторожит:
// новая ошибка или новая возможность обязана появиться в обоих режимах, иначе
// один из них тихо станет беднее.
import type { BoardMode, BoardTarget, BoardSession, BoardErrorCode } from './BoardingTypes';
import { BOARD_RANGE, BOARD_PVP_REWARD_MULT } from './BoardingTypes';

export * from './BoardingTypes';

/** Цель для абордажа: свободна ли она в принципе. */
export function boardTargetAllowed(target: BoardTarget): boolean {
  // Список запрещённых режимов один на оба: цель без режима или с неизвестным
  // не годится ни там, ни там. Ветвление по режиму здесь означало бы, что
  // «не цель» в PvP и «не цель» в PvE — разные вещи.
  return target.mode === 'pve' || target.mode === 'pvp';
}

/** Свою лодку абордажировать нельзя — это не бой, а self-harm. */
export function boardSelfRejected(
  target: BoardTarget,
  attackerId: string
): boolean {
  // В pve цель — монстр, и его id никогда не равен id персонажа. В pvp —
  // другой персонаж, и равенство возможно. Проверка одна: она честно
  // возвращает false для монстра, и не нуждается в ветвлении.
  return target.id === attackerId;
}

/**
 * Дистанция абордажа. Одна на оба режима.
 *
 * Отдельное расстояние под PvP сделало бы PvP опасно не боем, а геометрией:
 * игроки судили бы по «дотянулся/не дотянулся», а не по решению.
 */
export function boardInRange(
  ax: number, az: number,
  tx: number, tz: number,
  range = BOARD_RANGE
): boolean {
  return Math.hypot(ax - tx, az - tz) <= range;
}

/** Заход ещё живой? По истечении срока абордаж засчитан брошенным. */
export function boardAlive(session: BoardSession, now = Date.now()): boolean {
  return now - session.startedAt < session.timeLimitMin * 60_000;
}

/**
 * Награда по режиму. Единственное место, где режимы считаются по-разному.
 *
 * База умножается на BOARD_PVP_REWARD_MULT для PvP. Всё остальное (порог
 * уровня, дистанция, срок, ошибки) общее.
 */
export function boardReward(baseGold: number, mode: BoardMode): number {
  const v = mode === 'pvp' ? baseGold * BOARD_PVP_REWARD_MULT : baseGold;
  return Math.max(0, Math.floor(v));
}

/**
 * Причины отказа — общий список. Он экспортируется как тип, и целевой код
 * добавляется один раз, а не по режиму: иначе в одном режиме отказ имел бы
 * код, а в другом упирался бы в молчание.
 */
export const BOARD_ERRORS: Record<BoardErrorCode, string> = {
  board_no_boat: 'Нужна лодка',
  board_not_on_water: 'Абордаж только на воде',
  board_target_not_found: 'Цель не найдена',
  board_too_far: 'Слишком далеко',
  board_wrong_region: 'Цель в другой зоне',
  board_already_in_fight: 'Уже в бою',
  board_level_too_low: 'Слишком слаб для этой цели',
  board_self: 'Нельзя абордажировать себя',
  board_timeout: 'Время вышло',
};

/**
 * Минимальный уровень для PvP-цели.
 *
 * Разница в 10 уровней закрывает охоту на слабых: иначе рейд из 80-х мог бы
 * бесконечно грабить 30-х. Для PvE такого порога нет — монстры не «слабые
 * игроки», а просто контент.
 */
export function pvpLevelGapAllowed(attackerLevel: number, targetLevel: number): boolean {
  return Math.abs(attackerLevel - targetLevel) <= 10;
}
