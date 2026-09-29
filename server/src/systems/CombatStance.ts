// ============================================================
// Боевые стойки и парирование — Empire of Safavids
// ============================================================
// Три боевых стиля кызылбаша плюс обычный бой. Смысл каждой стойки —
// в компромиссе: за скорость платим защитой, за защиту — скоростью, за
// дальнюю стрельбу — тем, что она недоступна пешком.
//
// СтоЙКИ ХРАНЯТСЯ В БАЗЕ (characters.combat_stance), а не в памяти:
// переключение должно переживать перезаход. Временные состояния боя
// (блок, рывок) остались в памяти - они живут доли секунды.

export type CombatStance = 'balanced' | 'sickle_dance' | 'shah_shield' | 'mounted_archery';

export interface StanceProfile {
  id: CombatStance;
  /** Множитель урона */
  damage: number;
  /** Множитель скорости атаки: больше — быстрее */
  attackSpeed: number;
  /** Насколько сильнее блок: сколько процента урона гасится */
  blockReduction: number;
  /** Сколько стамины стоит блок */
  blockStamina: number;
  /** Множитель множителя комбо (третий удар серии) */
  combo: number;
  /** Досягаемость удара, множитель к дальности оружия */
  reach: number;
  /** Требуется ли скакун (конная стрельба) */
  requiresMount: boolean;
}

export const STANCES: Record<CombatStance, StanceProfile> = {
  // Обычный бой: то, что было до появления стоек
  balanced: {
    id: 'balanced', damage: 1.0, attackSpeed: 1.0, blockReduction: 0.6,
    blockStamina: 10, combo: 1.0, reach: 1.0, requiresMount: false,
  },
  // «Танец серпа»: стремительно, но почти без защиты
  //
  // Урон и скорость выше, зато блок почти не держит и тратит больше
  // выносливости. Стиль для агрессии: зашёл вблизь и рубишь, полагаясь
  // на скорость, а не на щит.
  sickle_dance: {
    id: 'sickle_dance', damage: 1.25, attackSpeed: 1.3, blockReduction: 0.25,
    blockStamina: 14, combo: 1.5, reach: 0.95, requiresMount: false,
  },
  // «Шахский щит»: оборона, но медленно
  //
  // Блок держит почти всё, стоит копейку, урон ниже и замах медленный.
  // Стиль для терпеливого боя: держишь дистанцию и ждёшь ошибки.
  shah_shield: {
    id: 'shah_shield', damage: 0.85, attackSpeed: 0.8, blockReduction: 0.85,
    blockStamina: 6, combo: 1.0, reach: 1.0, requiresMount: false,
  },
  // «Конная стрельба»: только верхом
  //
  // Дальность удвоена, урон ниже, блок не держит совсем. Пешком недоступна:
  // иначе это был бы просто «дальний бой», а не конный.
  mounted_archery: {
    id: 'mounted_archery', damage: 0.8, attackSpeed: 1.1, blockReduction: 0.15,
    blockStamina: 12, combo: 1.0, reach: 2.0, requiresMount: true,
  },
};

export const STANCE_IDS = Object.keys(STANCES) as CombatStance[];

export function isCombatStance(value: string): value is CombatStance {
  return value in STANCES;
}

/**
 * Окно парирования и отражение.
 *
 * Парирование - это не отдельное действие, а первые миллисекунды блока:
 * игрок жмёт щит за мгновение до удара и удар гасится полностью, а
 * атакующего отбрасывает. Проверка идёт по времени начала блока, поэтому
 * игрок не отмечает ничего лишнего - тот же щит, тот же отклик.
 */
export const PARRY_WINDOW_MS = 260;
/** Доля отражённого урона: парирование не просто гасит, а возвращает */
export const PARRY_REFLECT = 0.35;
