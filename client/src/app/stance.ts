// Стойка на клиенте: общее состояние, переключение, отправка на сервер.
//
// Вынесено отдельно от world.ts, потому что стойкой пользуются и бой, и
// панель персонажа, и подсказка по управлению: держать это в одном файле с
// сокетами значило бы тащить весь мир боя ради смены стиля.

export type Stance = 'balanced' | 'sickle_dance' | 'shah_shield' | 'mounted_archery';

export interface StanceInfo {
  id: Stance;
  /** Нужен ли скакун: если да, стойка недоступна пешком */
  requiresMount: boolean;
}

/**
 * Порядок стоек в панели.
 *
 * Обычный бой идёт первым и не выделяется: это состояние «по умолчанию»,
 * а не стиль. Остальные три — как раз те, что описаны в документе владельца.
 */
export const STANCE_ORDER: Stance[] = ['balanced', 'sickle_dance', 'shah_shield', 'mounted_archery'];

export const STANCES: Record<Stance, StanceInfo> = {
  balanced: { id: 'balanced', requiresMount: false },
  sickle_dance: { id: 'sickle_dance', requiresMount: false },
  shah_shield: { id: 'shah_shield', requiresMount: false },
  mounted_archery: { id: 'mounted_archery', requiresMount: true },
};

export function isStance(value: string): value is Stance {
  return value in STANCES;
}

let current: Stance = 'balanced';
const listeners = new Set<(s: Stance) => void>();

export function getStance(): Stance {
  return current;
}

/** Применить стойку. Возвращает применённую — она может отличаться от запрошенной. */
export function setStance(stance: Stance): Stance {
  if (!isStance(stance) || stance === current) return current;
  current = stance;
  for (const l of listeners) l(current);
  return current;
}

/** Подписаться на смену стойки */
export function onStanceChange(cb: (s: Stance) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Следующая стойка по кругу — для переключения одной клавишей */
export function nextStance(): Stance {
  const i = STANCE_ORDER.indexOf(current);
  return STANCE_ORDER[(i + 1) % STANCE_ORDER.length];
}
