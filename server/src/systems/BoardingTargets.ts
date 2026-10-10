// Выбор цели: два режима, одно ядро.
//
// ЗДЕСЬ ЖИВЁТ ГЛАВНАЯ РАЗНИЦА МЕЖДУ РЕЖИМАМИ — откуда берётся цель.
// В PvE это пиратские суда в воде рядом; в PvP — чужая лодка в той же зоне и
// на том же шарде. Всё, что дальше (дистанция, срок, бой, добыча), общее.
//
// ПОЧЕМУ ФИЛЬТР ОДИН. Можно было бы написать «список пиратов» и «список
// игроков» отдельно. Тогда фильтры разошлись бы: в одном режиме цель на суше
// оказалась бы допустимой, в другом нет, и это обнаружилось бы не сразу.
// Поэтому оба режима проходят через ОДИН `boardEligible`: он требует лодки,
// воды, своей зоны и дистанции — одинаково для монстра и для игрока.
import type { Region } from '../types/game.types';
import { MONSTERS_DATABASE } from '../data/monsters';
import type { AISystem } from './AISystem';
import type { BoardMode, BoardTarget } from './BoardingTypes';
import { boardInRange, boardTargetAllowed } from './Boarding';

export interface BoardSearchInput {
  attackerId: string;
  attackerLevel: number;
  attackerRegion: Region;
  attackerShard: string;
  x: number;
  z: number;
  mode: BoardMode;
}

/** Можно ли абордажировать эту цель. Один фильтр на оба режима. */
export function boardEligible(
  target: BoardTarget,
  вход: BoardSearchInput,
  дальность: number
): boolean {
  if (!boardTargetAllowed(target)) return false;
  // Своя зона. Абордаж через всю карту — не абордаж, а дострел издалека.
  if (target.region !== вход.attackerRegion) return false;
  if (!boardInRange(вход.x, вход.z, target.x, target.z, дальность)) return false;
  // Порог разрыва уровней для PvP (10 уровней). В PvE цель — монстр, и
  // разрыв достаточно велик, чтобы не давать 80-му грабить 30-х.
  if (
   target.mode === 'pvp' &&
    Math.abs(вход.attackerLevel - target.level) > 10
  ) {
    return false;
  }
  return true;
}

/**
 * Цели PvE: пиратские суда в воде рядом.
 *
 * Берутся живые экземпляры ИИ у воды в зоне игрока. Монстры на суше
 * (разбойники, волки) не годятся: абордаж — морской бой, и «абордовал
 * разбойника в степи» было бы ошибкой фильтра.
 */
export function pveTargets(
  ai: AISystem,
  вход: BoardSearchInput,
  дальность: number
): BoardTarget[] {
  const цели: BoardTarget[] = [];
  for (const ctx of ai.getAllInstances()) {
    const def = MONSTERS_DATABASE[ctx.monsterId];
    if (!def) continue;
    // Только водные монстры: у них признак aquatic в данных.
    if (!def.aquatic) continue;
    const цель: BoardTarget = {
      id: ctx.instanceId,
      nameRu: def.nameRu,
      mode: 'pve',
      level: def.level,
      region: вход.attackerRegion,
      x: ctx.position.x,
      z: ctx.position.z,
    };
    if (boardEligible(цель, вход, дальность)) цели.push(цель);
  }
  return цели;
}

/**
 * Цели PvP: чужие лодки в той же зоне и шарде.
 *
 * Список игроков региона уже есть в игре (его использует панель приглашений
 * в заход). Своего отсекаем, и оставляем тех, у кого есть лодка — без неё
 * абордаживать некого.
 */
export function pvpTargets(
  вход: BoardSearchInput,
  игроки: { id: string; nameRu: string; level: number; boatId: string; x: number; z: number }[],
  дальность: number
): BoardTarget[] {
  const цели: BoardTarget[] = [];
  for (const игрок of игроки) {
    const цель: BoardTarget = {
      id: игрок.id,
      nameRu: игрок.nameRu,
      mode: 'pvp',
      level: игрок.level,
      region: вход.attackerRegion,
      x: игрок.x,
      z: игрок.z,
    };
    // У самого себя лодка тоже может быть — но абордажировать себя нельзя.
    if (игрок.id === вход.attackerId) continue;
    if (boardEligible(цель, вход, дальность)) цели.push(цель);
  }
  return цели;
}

/** Цели по выбранному режиму. Одна точка входа на оба. */
export function boardTargets(
  ai: AISystem,
  вход: BoardSearchInput,
  игроки: { id: string; nameRu: string; level: number; boatId: string; x: number; z: number }[],
  дальность: number
): BoardTarget[] {
  return вход.mode === 'pve'
    ? pveTargets(ai, вход, дальность)
    : pvpTargets(вход, игроки, дальность);
}
