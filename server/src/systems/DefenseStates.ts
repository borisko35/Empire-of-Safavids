// ============================================================
// Активная защита: уклонение (i-frames) и блок — Empire of Safavids
// ============================================================
// Кратковременные защитные состояния, инициируемые игроком через
// combat:action (actionType dodge/block). Читаются боевым циклом
// (GameLoop) и PvP-путём (GameSocketHandler). Состояния в памяти:
// живут доли секунды и не должны переживать рестарт сервера.

interface DefenseState {
  dodgeUntil: number;
  blockUntil: number;
}

const DODGE_DURATION_MS = 1500;
const BLOCK_DURATION_MS = 2000;
const BLOCK_REDUCTION = 0.6; // блок гасит 60% урона

export class DefenseStates {
  private static instance: DefenseStates;
  private states = new Map<string, DefenseState>();

  static getInstance(): DefenseStates {
    if (!DefenseStates.instance) {
      DefenseStates.instance = new DefenseStates();
    }
    return DefenseStates.instance;
  }

  /** Активировать уклонение: 1.5 секунды полной неуязвимости */
  activateDodge(characterId: string): void {
    const now = Date.now();
    const st = this.states.get(characterId) ?? { dodgeUntil: 0, blockUntil: 0 };
    st.dodgeUntil = now + DODGE_DURATION_MS;
    this.states.set(characterId, st);
  }

  /** Активировать блок: 2 секунды снижения урона на 60% */
  activateBlock(characterId: string): void {
    const now = Date.now();
    const st = this.states.get(characterId) ?? { dodgeUntil: 0, blockUntil: 0 };
    st.blockUntil = now + BLOCK_DURATION_MS;
    this.states.set(characterId, st);
  }

  /** Уклонение активно? */
  isDodging(characterId: string, now = Date.now()): boolean {
    return (this.states.get(characterId)?.dodgeUntil ?? 0) > now;
  }

  /** Множитель входящего урона (1 — без изменений, 0 — промах) */
  getIncomingMultiplier(characterId: string, now = Date.now()): number {
    const st = this.states.get(characterId);
    if (!st) return 1;
    if (st.dodgeUntil > now) return 0;
    if (st.blockUntil > now) return 1 - BLOCK_REDUCTION;
    return 1;
  }

  cleanup(characterId: string): void {
    this.states.delete(characterId);
  }
}
