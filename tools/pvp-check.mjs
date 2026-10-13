// Проверка PvP-боя через сокет — последний непроверенный путь боя (ROADMAP §182).
//
// ЧТО ЗДЕСЬ. §177 проверил PvE: удары по монстру, смерть, опыт, лут. PvP
// проходил по сокету ноль раз, хотя ветка combatPlayerVsPlayer живёт рядом и
// отличается от PvE всем сразу: цель — не монстр, у неё есть UUID, у неё есть
// стойка и защита, и она умеет отвечать.
//
// Второй персонаж создаётся напрямую в базе под тем же аккаунтом. Регистрация
// второго аккаунта не нужна: для PvP важны два персонажа и два сокета, а
// PvP-исход всё равно разбирает матч арены отдельно (PvPService.reportResult
// проверен: вызывающий обязан быть участником, победитель только из двоих,
// расхождение — ничья).
//
// ЗАЧЕМ ВТОРОЙ ПЕРСОНАЖ УДАЛЯЕТСЯ. Он не настоящий игрок, и оставлять его в
// базе значило бы засорять тестовую базу чужим именем. Стирается в конце при
// любом исходе.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('D:/My Projects/Empire of Sefevids/client/package.json');
const { io } = require('socket.io-client');

const URL = process.env.EOS_GAME_URL ?? 'https://game.eos-gameonline.com';
const ИМЯ_ВТОРОГО = 'EosSparring';
const ТОЧКА = { x: 200, y: 0, z: 60 };   // спокойное место у дороги, без монстров
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
const userId = первый.userId ?? (await psql(`SELECT user_id FROM characters WHERE id='${первый.id}'`));

function убратьВторого() {
  psql(`DELETE FROM character_items WHERE character_id IN (SELECT id FROM characters WHERE name = '${ИМЯ_ВТОРОГО}')`);
  psql(`DELETE FROM anticheat_violations WHERE character_id IN (SELECT id FROM characters WHERE name = '${ИМЯ_ВТОРОГО}')`);
  psql(`DELETE FROM characters WHERE name = '${ИМЯ_ВТОРОГО}'`);
}

async function создатьВторого() {
  убратьВторого();
  psql(`INSERT INTO characters
          (user_id, name, class, level, experience, stats, hp, max_hp, mana, max_mana,
           stamina, max_stamina, position, region, gold, zone, server_id, base_max_hp)
        VALUES ('${userId}', '${ИМЯ_ВТОРОГО}', 'qizilbash', 12, 0,
                '{"agility":14,"charisma":9,"strength":22,"endurance":20,"intelligence":6}',
                400, 400, 60, 120, 180, 180,
                '{"x":${ТОЧКА.x},"y":0,"z":${ТОЧКА.z + 1.5}}', 'isfahan', 500, 'isfahan_outskirts', 'isfahan', 400)`);
  return psql(`SELECT id FROM characters WHERE name = '${ИМЯ_ВТОРОГО}'`);
}

// ── Подготовка ────────────────────────────────────────────
const второйId = await создатьВторого();
if (!второйId) { лог('второй персонаж не создался'); process.exit(1); }
psql(`UPDATE characters SET position = '{"x":${ТОЧКА.x},"y":0,"z":${ТОЧКА.z}}'::jsonb,
        region='isfahan', zone='isfahan_outskirts', hp=max_hp, level=12 WHERE id='${первый.id}'`);
лог(`первый: ${первый.id} (уровень 12)`);
лог(`второй: ${второйId} (уровень 12, создан для проверки)`);

// ── Два сокета ────────────────────────────────────────────
function подключить(id, кто) {
  // autoConnect: false обязателен. По умолчанию socket.io-client начинает
  // подключаться сразу при создании, и событие 'connect' успевает пройти ДО
  // того, как мы повесили обработчик. Первый сокет успевал, второй — нет, и
  // скрипт висел вечно без единой строки в журнале сервера.
  const s = io(URL, { transports: ['websocket', 'polling'], timeout: 20000, autoConnect: false });
  s.кто = кто;
  s.попадания = []; s.ошибки = []; s.попаданияПоМне = []; s.визуал = [];
  s.on('combat:result', (r) => s.попадания.push(r));
  s.on('combat:error', (e) => s.ошибки.push(e));
  s.on('combat:hit', (h) => s.попаданияПоМне.push(h));
  s.on('combat:visual', (v) => s.визуал.push(v));
  return s;
}

async function дождатьсяСокета(s) {
  await new Promise((r, j) => {
    // Таймаут обязателен по той же причине, что и autoConnect:false. Молчаливое
    // ожидание хуже отказа: оно выглядит как «сервер думает».
    const t = setTimeout(() => j(new Error(`сокет ${s.кто} не подключился за 20 секунд`)), 20000);
    s.on('connect', () => { clearTimeout(t); r(); });
    s.on('connect_error', (e) => { clearTimeout(t); j(new Error(`сокет ${s.кто}: ${e?.message ?? e}`)); });
    s.connect();
  });
}

const A = подключить(первый.id, 'первый');
const B = подключить(второйId, 'второй');

for (const [s, id] of [[A, первый.id], [B, второйId]]) {
  await дождатьсяСокета(s);
  await new Promise((r, j) => {
    const t = setTimeout(() => j(new Error('нет auth:success у ' + s.кто)), 15000);
    s.on('auth:success', () => { clearTimeout(t); r(); });
    s.on('auth:error', (e) => { clearTimeout(t); j(new Error('auth:error ' + JSON.stringify(e))); });
    s.emit('auth', { token, characterId: id });
  });
  лог(`${s.кто}: вошёл в мир`);
}

// ── Свести вплотную ───────────────────────────────────────
let позаA = { x: ТОЧКА.x, z: ТОЧКА.z };
let позаB = { x: ТОЧКА.x, z: ТОЧКА.z + 1.5 };
for (let i = 0; i < 12; i++) {
  A.emit('player:move', { position: { x: позаA.x, y: 0, z: позаA.z }, direction: { x: 0, y: 0, z: 1 } });
  B.emit('player:move', { position: { x: позаB.x, y: 0, z: позаB.z }, direction: { x: 0, y: 0, z: -1 } });
  await sleep(400);
}
лог(`расстояние между ними: ${d(позаA, позаB).toFixed(2)} (досягаемость 2.4)`);

// ── Удар: первый бьёт второго ─────────────────────────────
лог('');
лог('--- ОДИН УДАР ПО ИГРОКУ ---');
A.emit('combat:action', {
  characterId: первый.id,
  actionType: 'attack',
  targetId: второйId,
  position: { x: позаA.x, y: 0, z: позаA.z },
  direction: { x: 0, y: 0, z: 1 },
  timestamp: Date.now(),
});
await sleep(2500);

лог('');
лог('--- ЧТО ПРИШЛО ---');
лог(`первому: combat:result ${A.попадания.length}, combat:error ${A.ошибки.length}`);
for (const r of A.попадания) лог('  результат: ' + JSON.stringify(r).slice(0, 200));
for (const e of A.ошибки) лог('  ошибка: ' + JSON.stringify(e).slice(0, 160));
лог(`второму: combat:hit ${B.попаданияПоМне.length}`);
for (const h of B.попаданияПоМне) {
  лог(`  удар по второму: урон ${h.damage}, hp ${h.hp}/${h.maxHp}, щит ${h.isBlocked}, уклон ${h.isDodged}`);
}

const hpВторого = Number(psql(`SELECT hp FROM characters WHERE id='${второйId}'`));
const hpПервого = Number(psql(`SELECT hp FROM characters WHERE id='${первый.id}'`));
лог(`в базе: первый ${hpПервого}, второй ${hpВторого}`);

// ── Уборка ────────────────────────────────────────────────
A.close(); B.close();
убратьВторого();
лог('второй персонаж удалён');

лог('');
лог('--- ВЕРДИКТ ---');
const уронПрошёл = B.попаданияПоМне.some((h) => Number(h.damage) > 0);
const цельБылаИгроком = A.попадания.some((r) => r.targetId === второйId);
лог(`  ${цельБылаИгроком ? 'ДА' : 'НЕТ'}  цель опознана как игрок, а не как монстр`);
лог(`  ${уронПрошёл ? 'ДА' : 'НЕТ'}  PvP-удар нанёс урон`);
process.exit(цельБылаИгроком && уронПрошёл ? 0 : 1);