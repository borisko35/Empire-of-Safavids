// ============================================================
// PvP Arena — Empire of Safavids
// ============================================================
// Арена 1×1. Матчмейкинг был написан, но это была пустая запись в таблице:
// соперник не уведомлялся, боя не было, интерфейса не было.
//
// Урон по игроку в коде УЖЕ считается (combatPlayerVsPlayer): если цель —
// UUID персонажа, а не монстра, сервер сам применяет урон и шлёт сопернику
// COMBAT_HIT. Поэтому арена — это не переделка боя, а надстройка:
//
//   1. нашли друг друга → обоим уходит pvp:match_found;
//   2. бой идёт обычными ударами, сервер считает HP и следит за таймером;
//   3. чей HP ушёл в ноль (или время вышло) → pvp:ended обоим;
//   4. дальше игроки подтверждают исход, и только тогда меняется рейтинг
//      (см. PvPService.reportResult).
//
// ПОЧЕМУ HP АРЕНЫ НЕ ПИШЕТСЯ В ПЕРСОНАЖА ПОСЛЕ БОЯ: иначе проигравший
// остался бы с 1 HP и не мог бы выйти из города, а «поиграть в PvP»
// испортило бы обычную игру. Урон в бою честный, последствия — нет.
//
// ПОЧЕМУ ВРЕМЯ ВАЖНО: бой без ограничения длится, пока кто-то не надоест.
// По истечении побеждает тот, у кого больше осталось здоровья, — иначе
// ничья была бы наградой за бегство.

import { logger } from '../utils/logger';

/** Сколько длится бой, секунд */
export const ARENA_DURATION_SEC = 120;
/** Сколько ждём подтверждения исхода после конца боя, секунд */
export const ARENA_CONFIRM_SEC = 90;

export interface ArenaFighter {
  characterId: string;
  name: string;
  charClass: string;
  level: number;
  rating: number;
  hp: number;
  maxHp: number;
}

export interface Arena {
  matchId: number;
  fighters: [ArenaFighter, ArenaFighter];
  startedAt: number;
  endsAt: number;
  ended: boolean;
  winnerId?: string;
  /** 'hp' — нокаут, 'time' — время вышло, 'forfeit' — сдался */
  reason?: 'hp' | 'time' | 'forfeit';
}

const arenas = new Map<number, Arena>();
/** персонаж → арена: быстрый ответ «ты сейчас в бою?» */
const byPlayer = new Map<string, number>();

export class PvpArenaService {
  /** Начать бой. Если такой матч уже идёт — вернём его */
  start(
    matchId: number,
    a: Omit<ArenaFighter, 'hp' | 'maxHp'> & { hp: number; maxHp: number },
    b: Omit<ArenaFighter, 'hp' | 'maxHp'> & { hp: number; maxHp: number },
  ): Arena {
    const existing = arenas.get(matchId);
    if (existing) return existing;
    const now = Date.now();
    const arena: Arena = {
      matchId,
      fighters: [a, b],
      startedAt: now,
      endsAt: now + ARENA_DURATION_SEC * 1000,
      ended: false,
    };
    arenas.set(matchId, arena);
    byPlayer.set(a.characterId, matchId);
    byPlayer.set(b.characterId, matchId);
    logger.info(`[PvP] Arena ${matchId} started: ${a.name} vs ${b.name}`);
    return arena;
  }

  /** Арена, в которой сейчас бьётся игрок */
  arenaOf(characterId: string): Arena | null {
    const id = byPlayer.get(characterId);
    if (id === undefined) return null;
    return arenas.get(id) ?? null;
  }

  /** Арена по номеру матча — нужно, чтобы объявить результат обоим */
  arenaOfByMatch(matchId: number): Arena | null {
    return arenas.get(matchId) ?? null;
  }

  /** Соперник игрока в текущем бою */
  opponentOf(characterId: string): ArenaFighter | null {
    const arena = this.arenaOf(characterId);
    if (!arena) return null;
    return arena.fighters.find((f) => f.characterId !== characterId) ?? null;
  }

  /**
   * Урон в бою. Возвращает соперника, если пришлось его обновить,
   * чтобы сервер отправил ему COMBAT_HIT с верным HP.
   */
  applyDamage(attackerId: string, targetHp: number, targetMaxHp: number): ArenaFighter | null {
    const arena = this.arenaOf(attackerId);
    if (!arena || arena.ended) return null;
    const target = arena.fighters.find((f) => f.characterId !== attackerId);
    if (!target) return null;
    target.hp = Math.max(0, targetHp);
    target.maxHp = targetMaxHp;
    return target;
  }

  /** Следит за таймером. Возвращает арену, только что закончившуюся по времени */
  checkTimeout(): Arena | null {
    const now = Date.now();
    for (const arena of arenas.values()) {
      if (arena.ended) continue;
      if (now < arena.endsAt) continue;
      // Побеждает тот, у ком�� больше осталось здоровья; при равенстве — ничья
      const [a, b] = arena.fighters;
      const pa = a.maxHp > 0 ? a.hp / a.maxHp : 0;
      const pb = b.maxHp > 0 ? b.hp / b.maxHp : 0;
      if (Math.abs(pa - pb) < 0.001) {
        this.finish(arena, undefined, 'time');
      } else {
        this.finish(arena, pa > pb ? a.characterId : b.characterId, 'time');
      }
      return arena;
    }
    return null;
  }

  /** Нокаут: чей HP ушёл в ноль */
  knockout(loserId: string): Arena | null {
    const arena = this.arenaOf(loserId);
    if (!arena || arena.ended) return null;
    const winner = arena.fighters.find((f) => f.characterId !== loserId);
    this.finish(arena, winner?.characterId, 'hp');
    return arena;
  }

  /** Закончить бой. winnerId = undefined означает ничью */
  finish(arena: Arena, winnerId: string | undefined, reason: 'hp' | 'time' | 'forfeit'): void {
    if (arena.ended) return;
    arena.ended = true;
    arena.winnerId = winnerId;
    arena.reason = reason;
    for (const f of arena.fighters) byPlayer.delete(f.characterId);
    logger.info(
      `[PvP] Arena ${arena.matchId} finished: winner=${winnerId ?? 'draw'} reason=${reason}`,
    );
  }

  /** Убрать арену из памяти, когда матч окончательно закрыт */
  release(matchId: number): void {
    const arena = arenas.get(matchId);
    if (!arena) return;
    for (const f of arena.fighters) byPlayer.delete(f.characterId);
    arenas.delete(matchId);
  }

  /** Отменить бой, если игрок вышел до начала (disconnect) */
  cancelByPlayer(characterId: string): Arena | null {
    const arena = this.arenaOf(characterId);
    if (!arena || arena.ended) return null;
    this.finish(arena, undefined, 'forfeit');
    return arena;
  }

  /** Для диагностики и тестов */
  count(): number {
    return arenas.size;
  }
}

export const pvpArena = new PvpArenaService();
