// Создание базы данных empire_of_safavids (если её ещё нет).
// Запуск: npm run db:init (из каталога server/)
const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'safavid_user',
    database: 'postgres',
  });
  await client.connect();
  try {
    const exists = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [process.env.DB_NAME || 'empire_of_safavids']
    );
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE ${process.env.DB_NAME || 'empire_of_safavids'}`);
      console.log('✓ Database created:', process.env.DB_NAME);
    } else {
      console.log('= Database already exists');
    }
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
