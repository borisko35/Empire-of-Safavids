// ============================================================
// Состояние скрытности игрока — Empire of Safavids
// ============================================================
// Где игрок стоит и присел ли он сейчас. Пишет сокет-обработчик из пакета
// движения (того самого, что уже проверен античитом), читают два места:
// кража кошелька и взятие донесений в сокет-обработчике, и тик стражи в
// GameLoop.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ КЛАСС, А НЕ ПОЛЕ В GameSocketHandler. Правило удара
// стража живёт в общем цикле (GameLoop.tickGuards): удар должен быть по
// времени, а не по пакетам движения. В пакетах движения у стоящего игрока их
// нет вообще - тот, кто стоит на посту, не шлёт пакетов и потому не получил бы
// ни одного удара. Значит тику нужно видеть приседание, а оно жило в приватной
// карте сокета, недоступной извне. Карта стала общей.
//
// Эфемерное состояние: переживать перезапуск сервера не нужно, при следующем
// пакете движения всё перезапишется. Чистится на выходе игрока, иначе карта
// росла бы на каждого зашедшего и держала его id до перезапуска - ровно то, что
// уже было с lastRegenPos и chatLastSent.

import type { Point } from '../../../shared/stealth';

export interface StealthState extends Point {
  /** Игрок присел: обзор стража вдвое меньше (CROUCH_SIGHT) */
  crouch: boolean;
}

export class StealthStates {
  private static instance: StealthStates;
  private states = new Map<string, StealthState>();

  static getInstance(): StealthStates {
    if (!StealthStates.instance) {
      StealthStates.instance = new StealthStates();
    }
    return StealthStates.instance;
  }

  /** Записать состояние. Вызывается из проверенного пакета движения. */
  set(characterId: string, state: StealthState): void {
    this.states.set(characterId, state);
  }

  /** Состояние игрока. null, если пакет движения ещё не приходил. */
  get(characterId: string): StealthState | null {
    return this.states.get(characterId) ?? null;
  }

  /** Забыть игрока. Вызывается на выходе из сессии. */
  cleanup(characterId: string): void {
    this.states.delete(characterId);
  }
}
