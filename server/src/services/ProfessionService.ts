// Считывание профессии и её уровня для мест, где нужен бонус.
// Отдельная функция, потому что иначе каждый потребитель писал бы свой
// запрос в базу - и рано или поздно один из них забыл бы про level.

import { DatabaseService } from '../services/DatabaseService';

/** Кэш: бонус нужен на каждый удар, а уровень профессии меняется редко. */
interface CacheEntry { key: string; at: number; }
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

/**
 * Ключ бонуса для персонажа.
 *
 * Кэш живёт 30 секунд: уровень профессии растёт от боя, и при перечитывании
 * на каждый удар это была бы лишняя поход в базу. 30 секунд - компромисс
 * между нагрузкой и тем, чтобы игрок увидел новый бонус не через час.
 */
export async function professionOf(characterId: string): Promise<{ id: string; level: number } | null> {
  const hit = cache.get(characterId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.key === '' ? null : (JSON.parse(hit.key) as { id: string; level: number });
  }
  const row = await DatabaseService.getInstance().queryOne<{ profession_id: string; level: number }>(
    'SELECT profession_id, level FROM character_professions WHERE character_id = $1',
    [characterId]
  ).catch(() => null);
  const value = row?.profession_id ? { id: row.profession_id, level: Number(row.level) } : null;
  cache.set(characterId, { key: value ? JSON.stringify(value) : '', at: Date.now() });
  return value;
}

/** Сброс кэша: при выходе в мир кэш не должен пережить персонажа. */
export function clearProfessionCache(characterId?: string): void {
  if (characterId) cache.delete(characterId);
  else cache.clear();
}
