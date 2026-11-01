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
 * не может ни бить, ни уклоняться. Полторы, а не монстровы 2-5 с:
 * парирование — награда за тайминг, а не казнь за промах, и длинный стан
 * на каждый проигранный удар просадил бы PvP до взаимного паралича.
 */
export const PARRY_STUN_MS = 1500;