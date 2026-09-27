// ============================================================
// PvP: подъём арены и события — Empire of Safavids
// ============================================================
// Здесь живёт единственное место, где сервер «будит» двух игроков и
// объявляет им бой. В самом GameSocketHandler этого быть не могло: сокет
// живёт на контейнере, а REST-маршрут — тоже на этом же процессе, но
// ему нужен доступ к сокету игрока, а он есть только у обработчика.
//
// Поэтому подъём арены делает REST-маршрут через колбэк, который сюда
// и передаёт. Так маршрут не знает про сокеты, а сокет — про REST.

import type { PvPService } from '../services/PvPService';
import { pvpArena, type ArenaFighter } from './PvpArenaService';
import { logger } from '../utils/logger';

/** Кто умеет отправить событие конкретному игроку */
export type Emitter = (characterId: string, event: string, payload: unknown) => void;

let emitToPlayer: Emitter | null = null;
let pvpServiceRef: PvPService | null = null;

/** Вызывается один раз при старте сервера */
export function initPvpArena(emitter: Emitter, service: PvPService): void {
  emitToPlayer = emitter;
  pvpServiceRef = service;
}

/** Собрать карточку бойца из персонажа */
function fighterOf(
  c: { id: string; name: string; class: string; level: number; hp: number; maxHp: number },
  rating: number,
): ArenaFighter {
  return {
    characterId: c.id,
    name: c.name,
    charClass: c.class,
    level: c.level,
    rating,
    hp: c.hp,
    maxHp: c.maxHp,
  };
}

/**
 * Поднять арену для найденного матча и разослать обоим pvp:match_found.
 *
 * Вызывается из маршрута find-match, когда матч укомплектован.
 */
export function startPvpArena(matchId: number, forCharacterId: string): void {
  if (!emitToPlayer || !pvpServiceRef) return;
  if (pvpArena.arenaOf(forCharacterId)) return; // уже бьётся

  void (async () => {
    try {
      const match = await pvpServiceRef!.getMatch(matchId);
      if (!match || !match.player2_id) return;

      const a = await pvpServiceRef!.fighter(match.player1_id);
      const b = await pvpServiceRef!.fighter(match.player2_id);
      if (!a || !b) return;

      const arena = pvpArena.start(matchId,
        fighterOf(a, match.player1_rating),
        fighterOf(b, match.player2_rating),
      );

      // Каждому — своя карточка: «ты» и «соперник»
      const pairs: Array<{ me: typeof a; foe: typeof b }> = [
        { me: a, foe: b },
        { me: b, foe: a },
      ];
      for (const { me, foe } of pairs) {
        emitToPlayer!(me.id, 'pvp:match_found', {
          matchId,
          endsAt: arena.endsAt,
          you: { id: me.id, name: me.name, hp: me.hp, maxHp: me.maxHp },
          opponent: { id: foe.id, name: foe.name, charClass: foe.class, level: foe.level },
        });
      }
      logger.info(`[PvP] Arena ${matchId} announced to both fighters`);
    } catch (err) {
      logger.error('[PvP] failed to start arena:', (err as Error).message);
    }
  })();
}

/** Объявить обоим, что бой закончился */
export function announceArenaEnd(matchId: number, winnerId?: string, reason?: string): void {
  if (!emitToPlayer) return;
  const arena = pvpArena.arenaOfByMatch(matchId);
  const ids = arena
    ? arena.fighters.map((f) => f.characterId)
    : [];
  for (const id of ids) {
    emitToPlayer!(id, 'pvp:ended', {
      matchId,
      winnerId: winnerId ?? null,
      // Каждому игроку показываем его собственную сторону
      youWon: winnerId != null ? winnerId === id : false,
      reason: reason ?? 'hp',
    });
  }
}
