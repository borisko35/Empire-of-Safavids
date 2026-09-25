require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const c = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'safavid_user',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'empire_of_safavids',
  });
  await c.connect();
  const sql = fs.readFileSync(path.resolve(__dirname, '..', '..', 'database', 'migrations', '019_packs_promo.sql'), 'utf8');
  await c.query(sql);
  await c.query("INSERT INTO schema_migrations (filename) VALUES ('019_packs_promo.sql') ON CONFLICT DO NOTHING");
  const r = await c.query(
    'SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name IN ($2, $3, $4) ORDER BY 1',
    ['characters', 'azens', 'isfahan_silver', 'syrian_gold']
  );
  console.log('currency columns:', r.rows.map((x) => x.column_name).join(','));
  await c.end();
}

main().catch((e) => { console.error('MIGRATE FAIL:', e.message); process.exit(1); });
