// Проверка pvp_damus бонуса территории вживую (§185).
//
// ЧТО ПРОВЕРЯЕТ. Гильдия, держущая Кавказскую крепость, бьёт в PvP сильнее,
// В КАВКАЗСКОМ РЕГИОНЕ. Проверяются две стороны:
//   • с территорией и в её регионе — урон выше базового;
//   • с территорией, но в ДРУГОМ регионе — урон тот же базовый.
//
// ПОЧЕМУ ВТОРАЯ СТОРОНА ОБЯЗАТЕЛЬНА. Одна первая половина проверяла бы только
// «бонус есть». Вторая проверяет, что он привязан к месту: без неё можно
// подключить бонус глобально, и проверка бы это пропустила.
//
// Точка боя — кавказский перевал у крепости. Монстров там нет, и бой двух
// персонажей никого не тревожит.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('D:/My Projects/Empire of Sefevids/client/package.json');
const { io } = require('socket.io-client');

const URL = process.env.EOS_GAME_URL ?? 'https://game.eos-gameonline.com';
const ИМЯ_ВТОРОГО = 'EosDummy';
// Кавказ: зона caucasus_fort (z 500..700), x около 200 — рядом с крепостью.
const ТОЧКА = { x: 200, y: 0, z: 500 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const лог = (...a) => console.log(...a);

const psql = (sql) => execFileSync('docker', [
  'exec', 'empire-of-safavids-postgres-1', 'psql', '-U', 'safavid_user',
  '-d', 'empire_of_safavids', '-t', '-A', '-c', sql,
], { encoding: 'utf8' }).trim();

const raw = readFileSync('D:/My Projects/Empire of Sefevids/deploy/.test-account', 'utf8');
const вход = await fetch(`${URL}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: raw.match(/почта\s*:\s*(\S+)/)?.[1],
    password: raw.match(/пароль\s*:\s*(\S+)/)?.[1],
  }),
});
const token = (await вход.json()).data.token;
const заголовки = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const список = await (await fetch(`${URL}/api/characters`, { headers: заголовки })).json();
const первый = список.characters.find((c) => c.name === 'EosProbe');
if (!первый) { лог('нет EosProbe'); process.exit(1); }
const me = первый.id;

const ТЕРРИТОРИЯ = 'territory_caucasus_fortress';

function убратьВторого() {
  psql(`DELETE FROM character_items WHERE character_id IN (SELECT id FROM characters WHERE name = '${ИМЯ_ВТОРОГО}')`);
  psql(`DELETE FROM anticheat_violations WHERE character_id IN (SELECT id FROM characters WHERE name = '${ИМЯ_ВТОРОГО}')`);
  psql(`DELETE FROM characters WHERE name = '${ИМЯ_ВТОРОГО}'`);
}

// ── Подготовка: чистка до старта ──
убратьВторого();
// Строку территории НЕ удаляем, а только снимаем владельца. Та же болезнь,
// что в §181: инструмент удалял строку и ломал данные.
psql(`UPDATE guild_territories SET guild_id = NULL, captured_at = NULL WHERE territory_id = '${ТЕРРИТОРИЯ}'`);
psql(`DELETE FROM guild_members WHERE guild_id IN (SELECT id FROM guilds WHERE name = 'Пробная крепость')`);
psql(`DELETE FROM guilds WHERE name = 'Пробная крепость'`);

psql(`INSERT INTO characters (user_id, name, class, level, experience, stats, hp, max_hp,
         mana, max_mana, stamina, max_stamina, position, region, gold, zone, server_id, base_max_hp)
       VALUES ((SELECT user_id FROM characters WHERE id='${me}'), '${ИМЯ_ВТОРОГО}', 'qizilbash', 30, 0,
               '{"agility":14,"charisma":9,"strength":22,"endurance":20,"intelligence":6}',
               900, 900, 80, 160, 200, 200,
               '{"x":${ТОЧКА.x},"y":0,"z":${ТОЧКА.z + 1.5}}', 'caucasus', 0, 'caucasus_fort', 'isfahan', 900)`);
const второйId = psql(`SELECT id FROM characters WHERE name = '${ИМЯ_ВТОРОГО}'`);
if (!второйId) { лог('второй персонаж не создался'); process.exit(1); }

// ── Гильдия и захват крепости ──
psql(`INSERT INTO guilds (name, leader_id, gold) VALUES ('Пробная крепость', '${me}', 0)`);
const гильдия = psql(`SELECT id FROM guilds WHERE name = 'Пробная крепость'`);
psql(`UPDATE characters SET guild_id = '${гильдия}' WHERE id = '${me}'`);
psql(`UPDATE guild_territories SET guild_id = '${гильдия}', captured_at = NOW() WHERE territory_id = '${ТЕРРИТОРИЯ}'`);
лог(`гильдия держит «${ТЕРРИТОРИЯ}», бонус pvp_damus 5%`);

// ── Два сокета в кавказском регионе ──
function сокет(кто) {
  const s = io(URL, { transports: ['websocket', 'polling'], timeout: 20000, autoConnect: false });
  s.кто = кто;
  s.ответы = []; s.ошибки = []; s.поМне = [];
  s.on('combat:result', (r) => s.ответы.push(r));
  s.on('combat:error', (e) => s.ошибки.push(e));
  s.on('combat:hit', (h) => s.поМне.push(h));
  return s;
}
const A = сокет('первый');
const B = сокет('второй');

for (const [s, id] of [[A, me], [B, второйId]]) {
  await new Promise((r, j) => {
    const t = setTimeout(() => j(new Error('сокет ' + s.кто + ' не подключился')), 20000);
    s.on('connect', () => { clearTimeout(t); r(); });
    s.on('connect_error', (e) => { clearTimeout(t); j(new Error(e?.message ?? 'ошибка')); });
    s.connect();
  });
  await new Promise((r, j) => {
    const t = setTimeout(() => j(new Error('нет auth у ' + s.кто)), 15000);
    s.on('auth:success', () => { clearTimeout(t); r(); });
    s.on('auth:error', (e) => { clearTimeout(t); j(new Error(JSON.stringify(e))); });
    s.emit('auth', { token, characterId: id });
  });
  лог(`${s.кто}: в мире`);
}

/**
 * Один удар по второму персонажу из точки firstPos.
 * Возвращает фактический урон из combat:result.
 */
async function удар(x, z) {
  A.ответы.length = 0;
  A.ошибки.length = 0;
  A.emit('player:move', { position: { x, y: 0, z }, direction: { x: 0, y: 0, z: 1 } });
  B.emit('player:move', { position: { x: ТОЧКА.x, y: 0, z: ТОЧКА.z + 1.5 }, direction: { x: 0, y: 0, z: -1 } });
  await sleep(900);
  A.emit('combat:action', {
    characterId: me, actionType: 'attack', targetId: второйId,
    position: { x, y: 0, z }, direction: { x: 0, y: 0, z: 1 }, timestamp: Date.now(),
  });
  await sleep(1800);
  if (A.ошибки.length) return { урон: 0, ошибка: JSON.stringify(A.ошибки[0]).slice(0, 80) };
  const r = A.ответы.find((x2) => x2.targetId === второйId);
  return { урон: Number(r?.damage ?? 0), ответ: r ?? null };
}

// ── Замер 1: в своей территории ──
const сТерриторией = await удар(ТОЧКА.x, ТОЧКА.z);
лог('');
лог('--- 1. В СВОЕЙ ТЕРРИТОРИИ ---');
лог(`  урон: ${сТерриторией.урон}`);
if (сТерриторией.ошибка) лог(`  ошибка: ${сТерриторией.ошибка}`);

// ── Замер 2: уходим из региона ──
// Территория остаётся владельцу, но бой идёт не в кавказском регионе —
// бонус применяться не должен. Место спокойное в Исфахане.
const ВТОРАЯ_ТОЧКА = { x: 505, y: 0, z: 55 };
psql(`UPDATE characters SET region = 'isfahan', zone = 'isfahan_outskirts' WHERE id = '${me}'`);
psql(`UPDATE characters SET region = 'isfahan', zone = 'isfahan_outskirts' WHERE id = '${второйId}'`);
await sleep(600);
const безТерритории = await удар(ВТОРАЯ_ТОЧКА.x, ВТОРАЯ_ТОЧКА.z);
лог('');
лог('--- 2. ВНЕ ТЕРРИТОРИИ (Исфахан, тот же владелец) ---');
лог(`  урон: ${безТерритории.урон}`);
if (безТерритории.ошибка) лог(`  ошибка: ${безТерритории.ошибка}`);

// ── Уборка ──
A.close(); B.close();
убратьВторого();
psql(`UPDATE guild_territories SET guild_id = NULL, captured_at = NULL WHERE territory_id = '${ТЕРРИТОРИЯ}'`);
psql(`DELETE FROM guild_members WHERE guild_id IN (SELECT id FROM guilds WHERE name = 'Пробная крепость')`);
psql(`DELETE FROM guilds WHERE name = 'Пробная крепость'`);
psql(`UPDATE characters SET guild_id = NULL WHERE id = '${me}'`);
лог('убрал за собой: гильдию, захват, второго персонажа');

лог('');
лог('--- ВЕРДИКТ ---');
const базовый = безТерритории.урон;
const сБонусом = сТерриторией.урон;
const выше = базовый > 0 && сБонусом > базовый;
лог(`  ${сБонусом > 0 ? 'ДА' : 'НЕТ'}  удар в своей территории прошёл (${сБонусом})`);
лог(`  ${базовый > 0 ? 'ДА' : 'НЕТ'}  урон вне территории есть (${базовый})`);
лог(`  ${выше ? 'ДА' : 'НЕТ'}  бонус добавил урона: ${базовый} → ${сБонусом} (${сБонусом - базовый > 0 ? '+' : ''}${сБонусом - базовый})`);
process.exit(сБонусом > 0 && базовый > 0 && выше ? 0 : 1);