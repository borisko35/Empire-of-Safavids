// ============================================================
// Раннер SQL-миграций — Empire of Safavids
// ============================================================
// Применяет файлы из database/migrations по порядку,
// применённые отслеживает в таблице schema_migrations.
// Запуск: npm run migrate (из каталога server/)

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

async function main(): Promise<void> {
  const migrationsDir = resolveMigrationsDir();

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'empire_of_safavids',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

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

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
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
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
