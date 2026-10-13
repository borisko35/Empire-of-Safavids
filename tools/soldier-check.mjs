// Проверка вербовки караула на живом сервере (ROADMAP §178).
//
// ЧТО ПРОВЕРЯЕТ. §177 показал, что стенд боя работает. Здесь он используется
// для другого: нанятый солдат должен действительно бить, а не числиться в
// панели. Три шага: нанять, сразиться, увидеть урон в отдельном пакете.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ФЛАГ У combat-check. Бой и вербовка — разные
// вопросы, и смешивать их значит усложнять стенд, который писался под одну
// задачу.
//
// ЗОЛОТО ДОЛИВАЕТСЯ ПРЯМО В БАЗЕ: это тестовый аккаунт из deploy/.test-account,
// и заработать на нём можно только убив волка. Долить сотню честнее, чем гонять
// ради проверки пять волков.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'client', 'package.json'));
const { io } = require('socket.io-client');

const URL = process.env.EOS_GAME_URL ?? 'https://game.eos-gameonline.com';
const START = { x: 200, z: 140 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const лог = (...a) => console.log(...a);

const psql = (sql) => execFileSync('docker', [
  'exec', 'empire-of-safavids-postgres-1', 'psql', '-U', 'safavid_user',
  '-d', 'empire_of_safavids', '-t', '-A', '-c', sql,
], { encoding: 'utf8' }).trim();

const raw = readFileSync(join(ROOT, 'deploy', '.test-account'), 'utf8');
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
const списокПерсонажей = await (await fetch(`${URL}/api/characters`, { headers: заголовки })).json();
const мой = списокПерсонажей.characters.find((c) => c.name === 'EosProbe');
if (!мой) { лог('персонажа EosProbe нет среди', списокПерсонажей.characters.map((c) => c.name).join(', ')); process.exit(1); }
const me = мой.id;

psql(`UPDATE characters SET position = '{"x":200,"y":0,"z":140}'::jsonb, region='isfahan',
        zone='isfahan_north', hp=max_hp, gold=2000, updated_at=NOW() WHERE id='${me}'`);
лог('персонаж поставлен к волкам, золото долито до 2000');

const каталог = await (await fetch(`${URL}/api/soldiers?characterId=${me}`, { headers: заголовки })).json();
лог(`каталог: долей ${каталог.tiers.length}, нанято ${каталог.hired}, золото ${каталог.gold}`);
for (const доля of каталог.tiers) {
  лог(`  ${доля.id}: ${доля.cost} зол, hp ${доля.maxHp}, урон ${доля.damage}, щит ${Math.round(доля.guardShare * 100)}%, с ${доля.minLevel} ур.`);
}

const нанято = [];
for (const доля of каталог.tiers) {
  const r = await (await fetch(`${URL}/api/soldiers/hire`, {
    method: 'POST', headers: заголовки, body: JSON.stringify({ characterId: me, tier: доля.id }),
  })).json();
  if (r.success) { нанято.push(доля.id); лог(`  нанят ${доля.id}, золота осталось ${r.gold}`); }
  else лог(`  ${доля.id} НЕ нанят: ${r.reason}`);
}
if (!нанято.length) { лог('никого нанять не удалось — проверять нечего'); process.exit(1); }

const сокет = io(URL, { transports: ['websocket', 'polling'], timeout: 20000 });
const спавны = [];
const живые = new Map();
let уронКараула = 0;
let пакетов = 0;
const удары = [];
сокет.on('monster:spawned', (m) => спавны.push(m));
сокет.on('monster:ai_action', (a) => {
  if (a?.action?.destination) живые.set(a.instanceId, { x: a.action.destination.x, z: a.action.destination.z });
});
сокет.on('combat:result', (r) => { if (r.soldiersDamage) уронКараула += r.soldiersDamage; });
сокет.on('combat:soldiers', (p) => {
  пакетов++;
  for (const h of p.hits) удары.push(`${h.tier}=${h.damage}`);
});

await new Promise((r) => сокет.on('connect', r));
await new Promise((r) => { сокет.on('auth:success', r); сокет.emit('auth', { token, characterId: me }); });
лог('вход в мир состоялся');

const t0 = Date.now();
while (спавны.length === 0 && Date.now() - t0 < 60000) await sleep(500);
if (!спавны.length) { лог('монстров не появилось'); process.exit(1); }
const волк = спавны.reduce((a, b) => (d(a.position, START) <= d(b.position, START) ? a : b));
живые.set(волк.instanceId, { x: волк.position.x, z: волк.position.z });
лог(`цель: ${волк.nameRu}, hp ${волк.hp ?? волк.maxHp}`);

let поза = { ...START };
for (let i = 0; i < 40; i++) {
  const живая = живые.get(волк.instanceId);
  if (!живая) break;
  const dd = d(поза, живая);
  if (dd <= 1.2) break;
  const шаг = Math.min(1.7, dd - 1.0);
  const ux = (живая.x - поза.x) / dd;
  const uz = (живая.z - поза.z) / dd;
  поза = { x: поза.x + ux * шаг, z: поза.z + uz * шаг };
  сокет.emit('player:move', { position: { x: поза.x, y: 0, z: поза.z }, direction: { x: ux, y: 0, z: uz } });
  await sleep(500);
}
лог('подошли вплотную');

for (let удар = 0; удар < 8; удар++) {
  if (!живые.has(волк.instanceId)) break;
  сокет.emit('combat:action', {
    characterId: me, actionType: 'attack', targetId: волк.instanceId,
    position: { x: поза.x, y: 0, z: поза.z }, direction: { x: 0, y: 0, z: 1 },
    timestamp: Date.now(),
  });
  await sleep(700);
}
await sleep(1500);

лог('');
лог('--- ИТОГ ---');
лог(`нанято: ${нанято.join(', ')}`);
лог(`пакетов combat:soldiers: ${пакетов}`);
лог(`удары караула: ${удары.length ? удары.join(', ') : 'нет'}`);
лог(`суммарный урон караула: ${уронКараула}`);

const строки = psql(
  `SELECT tier || ':' || hp || '/' || max_hp FROM character_soldiers WHERE character_id='${me}' ORDER BY tier`);
лог('состояние в базе:', строки ? строки.split('\n').join(', ') : 'пусто');

лог('');
лог('--- ВЕРДИКТ ---');
лог(`  ${пакетов > 0 ? 'ДА' : 'НЕТ'}  караул отвечает отдельным пакетом`);
лог(`  ${уронКараула > 0 ? 'ДА' : 'НЕТ'}  караул наносит урон`);
сокет.close();
process.exit(пакетов > 0 && уронКараула > 0 ? 0 : 1);