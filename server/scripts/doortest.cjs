require('dotenv').config();
const { Client } = require('pg');
const redis = require('redis');

async function main() {
  const mode = process.argv[2] || 'setup';
  const c = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'safavid_user',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'empire_of_safavids',
  });
  await c.connect();
  if (mode === 'setup') {
    const tag = Date.now().toString(36);
    const u = await c.query(
      "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'test') RETURNING id",
      [`doortest_${tag}`, `doortest_${tag}@example.com`]
    );
    const ch = await c.query(
      `INSERT INTO characters (user_id, name, class, stats, hp, max_hp, mana, max_mana,
         stamina, max_stamina, position, region, gold)
       VALUES ($1, $2, 'qizilbash', '{}', 100, 100, 50, 50, 100, 100,
         '{"x":3.6,"y":0.4,"z":48.7}', 'tabriz', 100) RETURNING id`,
      [u.rows[0].id, `DoorTest_${tag}`]
    );
    const r = redis.createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
    await r.connect();
    const token = `doortest_${tag}`;
    await r.setEx(`session:${token}`, 3600, u.rows[0].id);
    await r.disconnect();
    await c.end();
    console.log(JSON.stringify({ token, userId: u.rows[0].id, characterId: ch.rows[0].id }));
  } else {
    const userId = process.argv[3];
    const token = process.argv[4];
    const v = await c.query(
      'SELECT COUNT(*)::int AS n FROM anticheat_violations WHERE character_id IN (SELECT id FROM characters WHERE user_id = $1)',
      [userId]
    );
    console.log('violations:', v.rows[0].n);
    await c.query('DELETE FROM payments WHERE user_id = $1', [userId]);
    await c.query('DELETE FROM characters WHERE user_id = $1', [userId]);
    await c.query('DELETE FROM users WHERE id = $1', [userId]);
    await c.end();
    if (token) {
      const r = redis.createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
      await r.connect();
      await r.del(`session:${token}`);
      await r.disconnect();
    }
    console.log('cleaned');
  }
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
