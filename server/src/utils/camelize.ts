// ============================================================
// Утилиты маппинга строк БД — Empire of Safavids
// ============================================================

/**
 * PostgreSQL (node-pg) возвращает колонки в snake_case,
 * а TypeScript-типы проекта используют camelCase.
 * Преобразует ключи записи из БД: user_id -> userId, max_hp -> maxHp.
 */
export function camelizeRow<T>(row: Record<string, unknown> | null | undefined): T | null {
  if (!row) return null;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    result[toCamelCase(key)] = value;
  }
  return result as T;
}

export function camelizeRows<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map(r => camelizeRow<T>(r) as T);
}

export function toCamelCase(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
