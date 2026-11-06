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
  /** Идентификатор стойки — полезен при логах и клонировании профиля */
  id: CombatStance;
  /** Множитель урона */
  damage: number;
  /** Множитель скорости атаки: больше — быстрее */
  attackSpeed: number;
  /** Насколько сильнее блок: сколько процентов урона гасится */
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

/** Четыре стойки и их роли (восстановлено: потерялись при правке). */
export const STANCES: Record<CombatStance, StanceProfile> = {
  // Обычный бой: то, что было до появления стоек
  balanced: {
    id: 'balanced', damage: 1.0, attackSpeed: 1.0, blockReduction: 0.6,
    blockStamina: 10, combo: 1.0, reach: 1.0, requiresMount: false,
  },
  // «Танец серпа»: стремительно, но почти без защиты
  //
  // Урон и скорость выше, зато блок почти не держит и тратит больше
  // выносливости. Стиль для агрессии: зашёл вблизи и рубишь, полагаясь
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

// ── Новые способности, доступные в конкретных стойках ──────────────────────
export interface StanceAbility {
  id: string;
  name: string;
  nameRu: string;
  /** Стома, в которой способность активна */
  stance: CombatStance;
  /** Mana cost */
  manaCost: number;
  /** Cooldown в секундах */
  cooldown: number;
  /** Урон (множитель от базового урона оружия) */
  damageMultiplier: number;
  /** Задержка перед действием (мс) */
  castTime: number;
  /** Истинный урон (穿透), минус блокировка */
  armorPenetration: number;
  /** Дополнительный эффект: stamina_boost, speed_boost */
  effect?: 'stamina_boost' | 'speed_boost';
}

/** Способности, привязанные к стойкам */
export const STANCE_ABILITIES: Record<CombatStance, StanceAbility[]> = {
  // balanced: универсальные способности
  balanced: [
    {
      id: 'blk_stamina_boost',
      name: 'Stamina Surge',
      nameRu: 'Выносная Стамина',
      stance: 'balanced',
      manaCost: 10,
      cooldown: 20,
      damageMultiplier: 0,
      castTime: 100,
      armorPenetration: 0,
      effect: 'stamina_boost',
    },
    {
      id: 'blk_speed_boost',
      name: 'Speed Enhancement',
      nameRu: 'Ускорение',
      stance: 'balanced',
      manaCost: 15,
      cooldown: 30,
      damageMultiplier: 0,
      castTime: 80,
      armorPenetration: 0,
      effect: 'speed_boost',
    },
  ],
  // sickle_dance: способности быстрого агрессивного боя
  sickle_dance: [
    {
      id: 'sd_lunging_strike',
      name: 'Lunging Strike',
      nameRu: 'Уступной Удар',
      stance: 'sickle_dance',
      manaCost: 15,
      cooldown: 8,
      damageMultiplier: 2.0,
      castTime: 120,
      armorPenetration: 0.25,
    },
    {
      id: 'sd_quick_step',
      name: 'Quick Step',
      nameRu: 'Быстрый Шаг',
      stance: 'sickle_dance',
      manaCost: 10,
      cooldown: 12,
      damageMultiplier: 0,
      castTime: 80,
      armorPenetration: 0,
    },
  ],
  // shah_shield: оборонительные способности
  shah_shield: [
    {
      id: 'ss_perfect_block',
      name: 'Perfect Block',
      nameRu: 'Идеальный Блок',
      stance: 'shah_shield',
      manaCost: 20,
      cooldown: 15,
      damageMultiplier: 0,
      castTime: 50,
      armorPenetration: 0,
    },
    {
      id: 'ss_counter_thrust',
      name: 'Counter Thrust',
      nameRu: 'Контратака',
      stance: 'shah_shield',
      manaCost: 25,
      cooldown: 20,
      damageMultiplier: 2.5,
      castTime: 100,
      armorPenetration: 0.4,
    },
  ],
  // mounted_archery: конная стрелба имеет свои способности
  mounted_archery: [
    {
      id: 'ma_rapid_shoot',
      name: 'Rapid Fire',
      nameRu: 'Скорострел',
      stance: 'mounted_archery',
      manaCost: 12,
      cooldown: 6,
      damageMultiplier: 1.5,
      castTime: 80,
      armorPenetration: 0.1,
    },
    {
      id: 'ma_spread_shot',
      name: 'Spread Shot',
      nameRu: 'Расстрельный Выстрел',
      stance: 'mounted_archery',
      manaCost: 30,
      cooldown: 15,
      damageMultiplier: 3.0,
      castTime: 150,
      armorPenetration: 0.3,
    },
  ],
};

// ── Констанры парирования ──────────────────────────────────────────────
export const PARRY_WINDOW_MS = 260;
/** Доля отражённого урона: парирование не просто гасит, а возвращает */
export const PARRY_REFLECT = 0.35;
/**
 * Оглушение от парирования (roadmap §412): поймавший удар в окно не только
 * отражает его часть, но и закрывает атакующего на полторы секунды — тот
 * не может ни бить, ни уклоняться. Полetzte, а не монстровы 2-5 с:
 * парирование — награда за тайминг, а не казнь за промах, и длинныйстан
 * на каждый проигранный удар просадил бы PvP до взаимного паралича.
 */
export const PARRY_STUN_MS = 1500;