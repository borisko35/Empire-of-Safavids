// Бой абордажа и добыча.
//
// ЗАЧЕМ СВОЙ РАСЧЁТ, А НЕ ГОТОВЫЙ БОЙ. Обычный бой в игре — это поток ударов по
// тику: позиции, агро, кулдауны. Абордаж — заход с исходом: подошёл, выбрал
// исход, получил. Считать его «как обычный бой» значило бы притащить в него
// таймеры и позиции, которых у него нет.
//
// ЧТО ВЗЯТО ИЗ ИГРЫ, А НЕ ВЫДУМАНО. Сила удара — из `CombatService.getBaseDamageFor`
// (тот же расчёт, что у обычного удара), защита — из данных монстра. Никакой
// своей формулы урона здесь нет: она бы разошлась с боевой и «сильный игрок»
// в двух местах значил бы разное.
//
// ДВОЙНОЙ ПРИНЦИП. Исход решается одними правилами для обоих режимов. Разница
// только в том, что уходит побеждённому: в PvE монстр просто остаётся жив (на
// нём остаётся награда), а в PvP проигравший теряет часть груза.
import type { BoardMode, BoardOutcome } from './BoardingTypes';
import { boardReward } from './Boarding';

/** Силы сторон в бою. Берутся из игры, а не считаются здесь. */
export interface BoardCombatant {
  /** Удара за подход: из CombatService.getBaseDamageFor (как у обычного удара). */
  attack: number;
  /** Защита: у игрока — из статов, у монстра — из данных. */
  defense: number;
  /** Прочность: HP игрока или монстра. */
  hp: number;
  /** Сколько удара наносит цель в ответ. У монстра — из данных. */
  targetAttack: number;
  /** Сколько прочности у цели. */
  targetHp: number;
  level: number;
  targetLevel: number;
}

export interface BoardFightResult {
  /** Выиграл атакующий. */
  won: boolean;
  /** Сколько оставалось у атакующего. 0 — утонул. */
  hpLeft: number;
  /** Сколько оставалось у цели. */
  targetHpLeft: number;
}

/** Ничья или явная победа: заход не может «повиснуть». */
export const BOARD_MAX_ROUNDS = 12;

/**
 * Разбор боя.
 *
 * КРУГИ, А НЕ ФОРМУЛА. Формула «урон = атака − защита» дала бы мгновенный
 * исход при любой разнице уровней, и рейд 80-х убивал бы 60-го одним ударом.
 * Круги дают накопление: проигравший успевает нанести несколько ударов, и это
 * видно в интерфейсе.
 */
export function resolveBoardFight(силы: BoardCombatant): BoardFightResult {
  let hp = силы.hp;
  let targetHp = силы.targetHp;
  for (let круг = 0; круг < BOARD_MAX_ROUNDS; круг++) {
    if (hp <= 0 || targetHp <= 0) break;
    // Урон по цели: атака минус защита, но не меньше 1. Иначе защита выше
    // атаки сделала бы бой бесконечным.
    targetHp -= Math.max(1, силы.attack - силы.defense);
    if (targetHp <= 0) break;
    // Ответ цели. Урон по атакующему тоже не меньше 1.
    hp -= Math.max(1, силы.targetAttack - Math.round(силы.defense * 0.5));
  }
  return {
    won: targetHp <= 0 && hp > 0,
    hpLeft: Math.max(0, hp),
    targetHpLeft: Math.max(0, targetHp),
  };
}

export interface BoardLootInput {
  mode: BoardMode;
  /** Базовая награда: золото цели в PvP, награда монстра в PvE. */
  baseGold: number;
  /** Груз цели в PvP. В PvE пустой. */
  targetItems: string[];
  /** Предметы, которые несёт атакующий: только им он что-то может выдать. */
  attackerItems: string[];
}

/**
 * Добыча по исходу.
 *
 * PvP и PvE расходятся только в источнике: что награда, а что трофей. Правила
 * одни — победитель забирает золото и трофеи, проигравший остаётся с тем,
 * что унесло.
 */
export function boardLoot(исход: BoardFightResult, что: BoardLootInput): BoardOutcome {
  const gold = исход.won ? boardReward(что.baseGold, что.mode) : 0;
  const items = исход.won ? [...что.targetItems] : [];
  return {
    ok: true,
    attackerWon: исход.won,
    gold,
    items,
  };
}

/**
 * Что теряет проигравший в PvP.
 *
 * Часть груза, а не весь: полная потеря на рейс означала бы, что один
 * неудачный клик обнуляет торговый рейс. Доля — треть, и только если игрок
 * действительно что-то вёз.
 */
export const BOARD_PVP_CARGO_LOSS_SHARE = 1 / 3;

export function pvpCargoLoss(груз: string[]): string[] {
  if (!груз.length) return [];
  const сколько = Math.max(1, Math.floor(груз.length * BOARD_PVP_CARGO_LOSS_SHARE));
  return груз.slice(0, сколько);
}
