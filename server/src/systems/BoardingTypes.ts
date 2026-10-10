// Типы абордажа.
//
// Решение владельца — ДВОЙНОЙ ПРИНЦИП: режим выбирает атакующий. PvE (пираты)
// и PvP (чужая лодка) идут через одно ядро, и типы здесь общие на оба режима.
// Отдельный набор типов под PvP означал бы, что режимы — разные механики, и
// правка одной не досталась бы другой.
import type { Region } from '../types/game.types';

/** Режим абордажа. Выбирает атакующий. */
export type BoardMode = 'pve' | 'pvp';

export interface BoardTarget {
  /** Идентификатор цели: id монстра (pve) или персонажа (pvp). */
  id: string;
  /** Имя для показа: не «UUID», а «Корабль Рустама». */
  nameRu: string;
  mode: BoardMode;
  /** Уровень цели — по нему атакующий понимает, с кем связываться. */
  level: number;
  /** Зона, где цель находится. Абордаж только в своей зоне. */
  region: Region;
  /** Долгота/широкая цель в воде. Абордаж — на дальности, а не в упор. */
  x: number;
  z: number;
}

export interface BoardSession {
  id: string;
  attackerId: string;
  targetId: string;
  mode: BoardMode;
  region: Region;
  /** Момент начала. По нему считается таймаут. */
  startedAt: number;
  /** Срок: минут. Дольше — заход считается брошенным. */
  timeLimitMin: number;
}

export interface BoardOutcome {
  ok: boolean;
  /** Победил атакующий? В pve false — цель уцелела. */
  attackerWon: boolean;
  /** Сколько золота перешло. В pve — награда, в pvp — груз цели. */
  gold: number;
  /** Что забрал атакующий. */
  items: string[];
  /** Почему не вышло — код для интерфейса, а не для лога. */
  code?: BoardErrorCode;
}

/**
 * Причины отказа. Общий список на оба режима.
 *
 * Добавляется один раз: иначе в одном режиме отказ имел бы код, а в другом
 * упирался бы в молчание.
 */
export type BoardErrorCode =
  | 'board_no_boat'
  | 'board_not_on_water'
  | 'board_target_not_found'
  | 'board_too_far'
  | 'board_wrong_region'
  | 'board_already_in_fight'
  | 'board_level_too_low'
  | 'board_self'
  | 'board_timeout';

/** Срок абордажа. 10 минут: меньше — не успеть, больше — провисший заход. */
export const BOARD_TIME_LIMIT_MIN = 10;

/**
 * До какого расстояния можно абордаживать, в метрах.
 *
 * 24 метра — тот же радиус, что у входа в интерьер (`canEnter`): игрок уже
 * привык к нему как к «настолько близко, чтобы взаимодействовать».
 */
export const BOARD_RANGE = 24;

/**
 * Во сколько раз PvP награда выше PvE.
 *
 * 2.5 — иначе PvP не стоил бы риска: в PvE проигрыш ничего не стоит (ты
 * просто не получил награду), а в PvP можно лишиться груза. При равной
 * награде выбор был бы об очках, а не о риске.
 */
export const BOARD_PVP_REWARD_MULT = 2.5;
