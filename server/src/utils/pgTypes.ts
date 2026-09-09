// ============================================================
// Настройка типов node-postgres — Empire of Safavids
// ============================================================

import pg from 'pg';

/**
 * pg возвращает BIGINT (OID 20) строкой, из-за чего experience/gold/price
 * приходят "100" вместо 100 и ломают арифметику. Все BIGINT-значения
 * проекта (опыт ~1e6, золото, цены) far ниже Number.MAX_SAFE_INTEGER,
 * поэтому безопасно парсить их в number.
 */
pg.types.setTypeParser(20, (val: string) => parseInt(val, 10));
