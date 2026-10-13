// Пробник боя: один удар в упор и полный журнал того, что приходит в ответ.
//
// ЗАЧЕМ. Стенд боя (tools/combat-check.mjs) отправил 60 ударов и получил
// НОЛЬ `combat:result` и НОЛЬ `combat:error`. Все пути отказа в
// handleCombatAction шлют COMBAT_ERROR — значит обработчик не доходил до
// расчёта, и вопрос «почему» без прямого наблюдения не решается.
//
// ЧТО ЗДЕСЬ. Входит, ждёт монстра, подходит вплотную и бьёт ОДИН раз,
// печатая каждое событие, которое пришло от сервера, и каждый исходящий
// пакет. Ничего не предполагает.
//
// ПОЧЕМУ ПЕРЕД ВХОДОМ ПРАВИТСЯ БАЗА. Первая версия сброса не делала и
// отвалилась сама, показав ошибку вместо ответа:
//
//   force:disconnect {"reason":"Анти-чит: Speed hack: 201.1 u/s (max 12.0)"}
//
// Персонаж после прошлого боя лежал в городе (0,0) — его туда вернул сервер
// после смерти. Пробник отправлял движение из (200,140), то есть первый же
// пакет был прыжком на 245 метров, и меня отключили ДО удара. Позиция,
// на которую считается античит, берётся из базы на входе, поэтому её надо
// ставить ДО входа, а не после.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(join(ROOT, 'client', 'package.json'));
const { io } = require('socket.io-client');

const URL = process.env.EOS_GAME_URL ?? 'https://game.eos-gameonline.com';
const START = { x: 200, y: 0, z: 140 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function лог(...a) { console.log(...a); }

const raw = readFileSync(join(ROOT, 'deploy', '.test-account'), 'utf8');
const email = raw.match(/почта\s*:\s*(\S+)/)?.[1];
const password = raw.match(/пароль\s*:\s*(\S+)/)?.[1];

const res = await fetch(`${URL}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const token = (await res.json()).data.token;
const chars = await (await fetch(`${URL}/api/characters`, { headers: { Authorization: `Bearer ${token}` } })).json();
const мой = chars.characters.find((c) => c.name === 'EosProbe');
const me = мой.id;

// Ставим персонажа к волкам ДО входа: античит берёт базовую точку из базы
// при аутентификации, и сдвиг после входа читается как телепорт.
execFileSync('docker', [
  'exec', 'empire-of-safavids-postgres-1', 'psql', '-U', 'safavid_user', '-d', 'empire_of_safavids',
  '-c',
  `UPDATE characters SET position = '{"x":200,"y":0,"z":140}'::jsonb, region='isfahan', zone='isfahan_north', hp=max_hp, updated_at=NOW() WHERE id='${me}'`,
], { encoding: 'utf8' });
лог('вошли как', мой.name, me, '— позиция в базе поставлена к волкам, здоровье полное');

const socket = io(URL, { transports: ['websocket', 'polling'], timeout: 20000 });

// Логируем ВСЁ, что приходит. Наблюдение, а не выборка.
const пришли = [];
socket.onAny((имя, ...args) => {
  пришли.push(имя);
  if (имя === 'monster:spawned') return; // шум, их много
  const коротко = JSON.stringify(args).slice(0, 400);
  лог(`  ПРИШЛО ${имя}: ${коротко}`);
});

await new Promise((res2) => socket.on('connect', res2));
лог('соединены');

await new Promise((res2) => {
  socket.on('auth:success', res2);
  socket.emit('auth', { token, characterId: me });
});
лог('аутентифицированы');

// Ждём любого монстра.
const спавны = [];
socket.on('monster:spawned', (m) => спавны.push(m));
const t0 = Date.now();
while (спавны.length === 0 && Date.now() - t0 < 60000) await sleep(500);
if (!спавны.length) { лог('монстров нет — выходим'); process.exit(1); }

const ближайший = спавны.reduce((a, b) => (d(a.position, START) <= d(b.position, START) ? a : b));
лог('монстр:', ближайший.nameRu, ближайший.monsterId, 'hp', ближайший.hp ?? ближайший.maxHp,
    'в точке', JSON.stringify(ближайший.position), 'id', ближайший.instanceId);

// Подходим крупными шагами ровно до монстра — без мелкой доводки.
let поза = { ...START };
for (let i = 0; i < 40; i++) {
  const dist = d(поза, ближайший.position);
  if (dist <= 1.2) break;
  const шаг = Math.min(1.7, dist - 1.0);
  const ux = (ближайший.position.x - поза.x) / dist;
  const uz = (ближайший.position.z - поза.z) / dist;
  поза = { x: поза.x + ux * шаг, z: поза.z + uz * шаг };
  socket.emit('player:move', {
    position: { x: поза.x, y: 0, z: поза.z },
    direction: { x: ux, y: 0, z: uz },
  });
  await sleep(500);
}
лог('подошли на', d(поза, ближайший.position).toFixed(2), 'после', Math.round((Date.now() - t0) / 1000), 'с');

// Один удар.
лог('--- ОДИН УДАР ---');
socket.emit('combat:action', {
  characterId: me,
  actionType: 'attack',
  targetId: ближайший.instanceId,
  position: { x: поза.x, y: 0, z: поза.z },
  direction: { x: 0, y: 0, z: 1 },
  timestamp: Date.now(),
});
лог('пакет отправлен, ждём ответ 8 секунд');
await sleep(8000);

лог('');
лог('=== ВСЕ СОБЫТИЯ ЗА ПРОГОН ===');
лог('пришло событий:', пришли.length);
лог('combat:result:', пришли.filter((x) => x === 'combat:result').length);
лог('combat:error:', пришли.filter((x) => x === 'combat:error').length);
лог('combat:hit:', пришли.filter((x) => x === 'combat:hit').length);
лог('уникальные:', [...new Set(пришли)].join(', '));
socket.close();
process.exit(0);