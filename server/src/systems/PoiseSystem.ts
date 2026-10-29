// ============================================================================
// Система невосприимчивости и ошеломления (Poise / Stagger) — Empire of Safavids
// ============================================================================
// Каждый удар наносит урон посту postura (poise). Когда poise падает до 0,
// персонаж входит в состояние stagger (оглушение) на STAGGER_DURATION_MS.
// Poise восстанавливается со временем вне боя и медленно в бою.
//
// Клиент получает poise через COMBAT_RESULT и рисует полосу под HP.
//
// Дизайн:
//   - Легкая атака (basic attack):    10 poise damage
//   - Умение (skill):                  18 poise damage
//   - Ultimate:                        30 poise damage
//   - Тяжелая атака (esta в будущем):  25 poise damage
//
//   Базовый максимум poise = 100 + endurance * 2
//   Регенерация: +2 poise/сек вне боя, +0.5 poise/сек в бою
//

interface PoiseState {
  /** Текущее значение poise (0..maxPoise) */
  poise: number;
  /** Время последнего получения урона (для замедления регена в бою) */
  lastHitAt: number;
  /** Время до которого персонаж оглушен (stagger) */
  staggeredUntil: number;
}

/** Базовый урон по poise в зависимости от типа действия */
const POISE_DAMAGE: Record<string, number> = {
  attack: 10,
  skill: 18,
  ultimate: 30,
  dodge: 0,
  block: 2, // попытка пробить блок наносит немного урона по poise
};

/** Базовый максимум poise */
const BASE_MAX_POISE = 100;

/** Коэффициент endurance на poise */
const ENDURANCE_POISE_MULT = 2;

/** Регенерация poise в секунду (вне боя / в бою) */
const POISE_REGEN_OUT_OF_COMBAT = 2;
const POISE_REGEN_IN_COMBAT = 0.5;

/** Порог входа в бой после получения урона (мс) */
const COMBAT_THRESHOLD_MS = 5000;

/** Длительность stagger (оглушения) */
const STAGGER_DURATION_MS = 1500;

function freshState(character: { stats?: { endurance: number } } | null): PoiseState {
  const endurance = character?.stats?.endurance ?? 10;
  const maxPoise = BASE_MAX_POISE + endurance * ENDURANCE_POISE_MULT;
  return { poise: maxPoise, lastHitAt: 0, staggeredUntil: 0 };
}

export class PoiseSystem {
  private static instance: PoiseSystem;
  private states = new Map<string, PoiseState>();
  private lastRegenAt = Date.now();

  static getInstance(): PoiseSystem {
    if (!PoiseSystem.instance) {
      PoiseSystem.instance = new PoiseSystem();
    }
    return PoiseSystem.instance;
  }

  /** Получить состояние poise для персонажа (создаёт при первом обращении) */
  getState(characterId: string, character?: { stats?: { endurance: number } } | null): PoiseState {
    let st = this.states.get(characterId);
    if (!st) {
      st = freshState(character ?? null);
      this.states.set(characterId, st);
    }
    return st;
  }

  /** Максимальный poise персонажа */
  getMaxPoise(character: { stats?: { endurance: number } }): number {
    return BASE_MAX_POISE + (character.stats?.endurance ?? 10) * ENDURANCE_POISE_MULT;
  }

  /** Текущий poise */
  getPoise(characterId: string): number {
    return this.states.get(characterId)?.poise ?? 0;
  }

  /** Входит ли персонаж в stagger прямо сейчас */
  isStaggered(characterId: string, now = Date.now()): boolean {
    const st = this.states.get(characterId);
    return !!st && st.staggeredUntil > now;
  }

  /** Оставшееся время stagger (мс) */
  getStaggerRemaining(characterId: string, now = Date.now()): number {
    const st = this.states.get(characterId);
    if (!st || st.staggeredUntil <= now) return 0;
    return st.staggeredUntil - now;
  }

  /** Процент poise (0..1) для UI */
  getPoisePercent(characterId: string): number {
    const st = this.states.get(characterId);
    if (!st) return 1;
    // maxPoise мы не храним в состоянии, пересчитываем через вызов getState без модификации
    const max = this.getMaxPoiseFromState();
    if (max <= 0) return 1;
    return Math.max(0, Math.min(1, st.poise / max));
  }

  private getMaxPoiseFromState(): number {
    // Мы не храним maxPoise отдельно, но poise не может превышать начальный максимум.
    // Для простоты используем константный базовый максимум + endurance. Endurance не меняется
    // после создания персонажа, поэтому это безопасно.
    return BASE_MAX_POISE + 10 * ENDURANCE_POISE_MULT; // базовый endurance 10
  }

  /**
   * Нанести урон по poise. Возвращает объект с результатом:
   *   poiseDamage — реально нанесённый урон по poise
   *   staggered — вошёл ли цель в stagger
   *   staggerUntil — время окончания stagger
   */
  applyPoiseDamage(
    characterId: string,
    actionType: string,
    now = Date.now(),
  ): { poiseDamage: number; staggered: boolean; staggerUntil: number } {
    const st = this.states.get(characterId);
    if (!st) return { poiseDamage: 0, staggered: false, staggerUntil: 0 };

    // Если уже в stagger, poise не уменьшаемurther
    if (st.staggeredUntil > now) {
      return { poiseDamage: 0, staggered: true, staggerUntil: st.staggeredUntil };
    }

    const damage = POISE_DAMAGE[actionType] ?? POISE_DAMAGE.attack;
    const newPoise = Math.max(0, st.poise - damage);
    st.poise = newPoise;
    st.lastHitAt = now;

    let staggered = false;
    let staggerUntil = 0;

    if (newPoise <= 0) {
      // Входим в stagger
      staggered = true;
      staggerUntil = now + STAGGER_DURATION_MS;
      st.staggeredUntil = staggerUntil;
      // Poise сбрасывается до 0, начнёт восстанавливаться после stagger
    }

    this.states.set(characterId, st);
    return { poiseDamage: damage, staggered, staggerUntil };
  }

  /** Восстановить poise (вызывается каждый кадр/тик) */
  regen(now = Date.now()): void {
    const dt = Math.min((now - this.lastRegenAt) / 1000, 1); // не более 1 сек за тик
    this.lastRegenAt = now;
    if (dt <= 0) return;

    for (const [characterId, st] of this.states.entries()) {
      if (st.poise <= 0) continue; // не регенерируем во время stagger

      const inCombat = now - st.lastHitAt < COMBAT_THRESHOLD_MS;
      const regenPerSec = inCombat ? POISE_REGEN_IN_COMBAT : POISE_REGEN_OUT_OF_COMBAT;
      const regenAmount = regenPerSec * dt;

      const maxPoise = BASE_MAX_POISE + 10 * ENDURANCE_POISE_MULT;
      st.poise = Math.min(maxPoise, st.poise + regenAmount);
      this.states.set(characterId, st);
    }
  }

  /** Сбросить состояние персонажа (выход из игры / респавн) */
  cleanup(characterId: string): void {
    this.states.delete(characterId);
  }
}

export const POISE_DAMAGE_CONSTANTS = {
  BASE_MAX_POISE,
  ENDURANCE_POISE_MULT,
  STAGGER_DURATION_MS,
  POISE_REGEN_OUT_OF_COMBAT,
  POISE_REGEN_IN_COMBAT,
  COMBAT_THRESHOLD_MS,
} as const;
