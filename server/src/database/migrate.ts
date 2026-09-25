// ============================================================
// Раннер SQL-миграций — Empire of Safavids
// ============================================================
// Применяет файлы из database/migrations по порядку,
// применённые отслеживает в таблице schema_migrations.
// Запуск вручную: npm run migrate (из каталога server/)
// Автоматически: импортируется в src/index/index.ts bootstrap
//   await migrate() — перед GameLoop.start()

import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'database', 'migrations'),      // контейнер (cwd=/app)
    path.resolve(process.cwd(), '..', 'database', 'migrations'), // локальная разработка (cwd=server)
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(`Migrations directory not found. Looked in:\n${candidates.join('\n')}`);
}

/**
 * Применяет все неприменённые миграции.
 * @param externalPool — если передан, использует его (не закрывает); иначе создаёт временный Pool.
 */
export async function migrate(externalPool?: Pool): Promise<void> {
  const migrationsDir = resolveMigrationsDir();

  const pool = externalPool ?? new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'empire_of_safavids',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });
  const ownsPool = !externalPool;

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = new Set(
      (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(r => r.filename)
    );

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found.');
      return;
    }

    let pending = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`= ${file} (already applied)`);
        continue;
      }

      // SQL-файлы лежат с UTF-8 BOM — node-pg, в отличие от psql,
      // его не переваривает (syntax error at or near ""). Срезаем.
      // Используем явный \uFEFF чтобы не зависеть от кодировки исходника.
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8').replace(/^\uFEFF/, '');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`✓ ${file} applied`);
        pending++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : err}`);
      } finally {
        client.release();
      }
    }

    if (pending === 0) {
      console.log('Database is up to date.');
    }
  } finally {
    if (ownsPool) {
      await pool.end();
    }
  }
}

// Алиас для удобства импорта `import { runMigrations }`
export const runMigrations = migrate;

// ── CLI: запускать только при прямом вызове `npx tsx src/database/migrate.ts` ──
// В ESM `require.main` недоступен — проверяем argv.
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('database/migrate.ts')
  || process.argv[1]?.replace(/\\/g, '/').endsWith('database/migrate.js');
if (isDirectRun) {
  migrate()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Migration failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
