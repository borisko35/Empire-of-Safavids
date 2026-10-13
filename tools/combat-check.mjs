#!/usr/bin/env node
// ============================================================
// Стенд боя — Empire of Safavids
// ============================================================
//
// ЧТО ЭТО. Проверка боя без браузера. Сценарий входит в игру по HTTP,
// поднимает сокет, идёт к точке спавна, бьёт монстра до смерти и
// записывает, что он видел: урон, смерти, награды.
//
// ЗАЧЕМ. Бой не был проверен ни разу за всё время работы. Причина была
// не в игре, а в инструменте наблюдения: вкладка отдавала управление
// только после клика по канвасу (§174), потом теряла отклик, потом
// закрывалась, и до монстров добраться не вышло. Каждая попытка
// заканчивалась одним и тем же — «дойти не удалось», и что сломалось,
// оставалось неизвестным. Этот стенд снимает зависимость от вкладки:
// бой воспроизводится командой, результат читается из сокета и базы.
//
// ЧТО ПРОВЕРЯЕТ. Полный путь, который до сих пор проверялся только
// по кускам:
//
//   вход → спавн монстра → сближение → удар → урон → смерть → награда
//
// Боевые формулы закрыты 48 проверками в пяти файлах (CombatService,
// combo, defense, stance, blockers), но связка сокета с боевой
// логикой была проверена только текстом, а не поведением: grep по
// GameSocketHandler находят его в тестах как ТЕКСТ, который читают, а
// не как код, который выполняют. Между «формула верна» и «событие
// боя доходит до формулы» был промежуток, и стенд закрывает именно его.
//
// ЗАПУСК
//   node tools/combat-check.mjs
//   node tools/combat-check.mjs --url http://localhost:3000
//   node tools/combat-check.mjs --keep        # не сбрасывать персонажа
//
// ЧТО ЭТО НЕ ДЕЛАЕТ. Не проверяет картинку: анимацию удара, цифры
// урона на экране, звук. Это клиентская половина, и она проверяется
// только живым взглядом. Здесь — серверная половина: что урон
// считается, монстр умирает, награда начисляется.
//
// БЕЗОПАСНОСТЬ. Работает только с тестовым аккаунтом из deploy/.test-account
// и только с тем персонажем, который указан в --char (по умолучу EosProbe).
// Перед заходом персонаж ставится в исходное состояние: полное здоровье,
// нулевой опыт, 100 золота, точка у волков на севере Исфахана.
// Это нужно, чтобы опыт и награду было видно: без сброса не отличить
// «бой дал 12 опыта» от «в базе было 12».
// ============================================================

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// socket.io-client живёт в клиенте: тянуть вторую копию ради стенда
// незачем, а новая зависимость в package.json — это ещё одно, что
// придётся поддерживать.
const require = createRequire(join(ROOT, 'client', 'package.json'));
const { io } = require('socket.io-client');

// ── Аргументы ─────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const URL = argValue('--url', process.env.EOS_GAME_URL ?? 'https://game.eos-gameonline.com');
const CHAR_NAME = argValue('--char', 'EosProbe');
const KEEP = argv.includes('--keep');

// ── Исходная точка: волк на севере Исфахана, sp_isf_nth_01 (200,150) ──
// Рядом с точкой, а не в ней: спавн разбрасывается на ±2.5, и встать
// ровно в чужую позицию — значит оказаться внутри монстра.
const START = { x: 200, y: 0, z: 140 };
const START_REGION = 'isfahan';

// ── Параметры боя, взятые из кода, а не подобратые на глаз ────
const REACH = 2.4;        // EquipmentCache.ts:38 DEFAULT_WEAPON.range
const SPEED_CAP = 12.0;   // AntiCheatSystem.ts:39 MOUNT_ANTICHEAT_CAP_FLOOR
const WALK_SPEED = 3.5;   // половина потолка: запас на дрожание координат
const STOP_AT = 1.6;      // внутри досягаемости с запасом
const ATTACK_EVERY_MS = 700;
const ATTACK_LIMIT = 60;

const log = (...parts) => console.log(...parts);
const say = (mark, text) => log(`  [${mark}] ${text}`);

// ============================================================
// Доступы
// ============================================================
function readAccount() {
  const raw = readFileSync(join(ROOT, 'deploy', '.test-account'), 'utf8');
  const email = raw.match(/почта\s*:\s*(\S+)/)?.[1];
  const password = raw.match(/пароль\s*:\s*(\S+)/)?.[1];
  if (!email || !password) throw new Error('не нашёл почту и пароль в deploy/.test-account');
  return { email, password };
}

// ============================================================
// Исходное состояние персонажа
// ============================================================
// Прямой запрос в базу, а не через API: сброс — это подготовка стенда,
// а не часть игры. Через API такого метода нет и добавлять его ради
// стенда незачем.
function psql(sql) {
  const out = execFileSync(
    'docker',
    ['exec', 'empire-of-safavids-postgres-1', 'psql', '-U', 'safavid_user', '-d', 'empire_of_safavids', '-t', '-A', '-c', sql],
    { encoding: 'utf8' }
  );
  return out.trim();
}

function resetCharacter(id) {
  const pos = JSON.stringify(START);
  psql(
    `UPDATE characters SET position = '${pos}'::jsonb, region = '${START_REGION}', ` +
    `zone = 'isfahan_north', hp = max_hp, experience = 0, gold = 100, updated_at = NOW() ` +
    `WHERE id = '${id}'`
  );
  return readState(id);
}

function readState(id) {
  const row = psql(
    `SELECT position->>'x', position->>'z', region, hp, max_hp, experience, gold, level ` +
    `FROM characters WHERE id = '${id}'`
  );
  const [x, z, region, hp, maxHp, xp, gold, level] = row.split('|');
  return {
    x: Number(x), z: Number(z), region,
    hp: Number(hp), maxHp: Number(maxHp),
    xp: Number(xp), gold: Number(gold), level: Number(level),
  };
}

// ============================================================
// Вход
// ============================================================
async function login(email, password) {
  const res = await fetch(`${URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.data?.token) {
    throw new Error(`вход не удался: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.data.token;
}

async function listCharacters(token) {
  const res = await fetch(`${URL}/api/characters`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`список персонажей не отдан: ${res.status}`);
  return json?.characters ?? [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ============================================================
// Сценарий
// ============================================================
async function main() {
  log('');
  log('=== Стенд боя ===');
  say('адрес', URL);
  say('персонаж', CHAR_NAME);

  const { email, password } = readAccount();
  const token = await login(email, password);
  say('вход', 'получен токен');

  const characters = await listCharacters(token);
  const char = characters.find((c) => c.name === CHAR_NAME);
  if (!char) {
    throw new Error(`персонажа ${CHAR_NAME} нет среди: ${characters.map((c) => c.name).join(', ')}`);
  }
  const me = char.id;
  say('id', me);

  let before = readState(me);
  if (!KEEP) {
    before = resetCharacter(me);
    say('сброс', `опыт ${before.xp}, золото ${before.gold}, здоровье ${before.hp}/${before.maxHp}, точка (${before.x}, ${before.z}), регион ${before.region}`);
  } else {
    say('сброс', 'пропущен (--keep)');
    say('старт', `опыт ${before.xp}, золото ${before.gold}, точка (${before.x}, ${before.z})`);
  }

  // ── Сокет ──────────────────────────────────────────────────
  const socket = io(URL, { transports: ['websocket', 'polling'], timeout: 20000 });

  // Всё, что стенд увидел. Один объект — потом по нему и отчёт,
  // чтобы не печатать выводы в двух местах и не разойтись.
  const seen = {
    spawned: [],
    results: [],
    errors: [],
    hits: [],
    killed: [],
    movesRejected: [],
    zoneChanged: [],
  };
  let pos = { x: START.x, z: START.z };
  let authed = false;

  socket.on('monster:spawned', (m) => { seen.spawned.push(m); });
  socket.on('combat:result', (r) => { seen.results.push(r); });
  socket.on('combat:error', (e) => { seen.errors.push(e); });
  socket.on('combat:hit', (h) => { seen.hits.push(h); });
  socket.on('monster:killed', (k) => { seen.killed.push(k); });
  socket.on('move:rejected', (m) => { seen.movesRejected.push(m); });
  socket.on('zone:changed', (z) => { seen.zoneChanged.push(z); });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('сокет не подключился за 25 секунд')), 25000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(new Error(`сокет не соединился: ${err?.message ?? err}`));
    });
  });
  say('сокет', 'соединён');

  const authResult = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: 'нет ответа на auth' }), 15000);
    socket.on('auth:success', (d) => { clearTimeout(timer); resolve({ ok: true, data: d }); });
    socket.on('auth:error', (d) => { clearTimeout(timer); resolve({ ok: false, reason: JSON.stringify(d) }); });
    socket.emit('auth', { token, characterId: me });
  });
  if (!authResult.ok) throw new Error(`аутентификация не прошла: ${authResult.reason}`);
  authed = true;
  say('auth', 'персонаж принят сервером');

  // ── Шаг: ждём монстра ──────────────────────────────────────
  // Точка спавна уже под ногами, но монстр появляется не сразу:
  // SpawnSystem держит паузу после смерти и респавн по respawnTime.
  say('ждём', `монстра у точки (${START.x}, ${START.z})`);
  const target = await waitForMonster(seen, 60000);
  if (!target) {
    say('монстр', 'не появился за 60 секунд');
    report({ seen, before, after: readState(me), target: null, attacks: 0 });
    return;
  }
  say('монстр', `${target.nameRu} (${target.monsterId}), hp ${target.hp}, id ${target.instanceId}`);

  // ── Шаг: сближение ─────────────────────────────────────────
  // Движение ограничено сверху (SPEED_CAP), и за превышение сервер
  // банит, а не предупреждает. Поэтому скорость стенда — половина
  // потолка, и каждый пакет проверяется на превышение до отправки.
  const walkLog = await walkTo(socket, pos, target, seen);
  say('сближение', `прошёл ${walkLog.прошёл.toFixed(1)} единиц за ${walkLog.шагов} пакетов, до цели ${walkLog.остаток.toFixed(2)}`);

  if (walkLog.остаток > REACH) {
    say('проблема', `до цели ${walkLog.остаток.toFixed(2)}, досягаемость ${REACH} — бой не начнётся`);
    report({ seen, before, after: readState(me), target, attacks: 0 });
    return;
  }

  // ── Шаг: бой ───────────────────────────────────────────────
  say('бой', `удары раз в ${ATTACK_EVERY_MS} мс, до ${ATTACK_LIMIT}`);
  const attacks = await fight(socket, me, pos, target, seen);
  await sleep(1500); // дать долететь награде

  const after = readState(me);
  report({ seen, before, after, target, attacks });
  socket.close();
}

function waitForMonster(seen, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const свежие = seen.spawned.filter((m) => m.position);
      if (свежие.length) {
        clearInterval(timer);
        // Ближайший к текущей точке: так меньше идти.
        const ближайший = свежие.reduce((a, b) =>
          dist(a.position, pos) <= dist(b.position, pos) ? a : b
        );
        resolve(ближайший);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, 500);
  });
}

async function walkTo(socket, start, target, seen) {
  let текущая = { ...start };
  const цель = { x: target.position.x, z: target.position.z };
  let прошёл = 0;
  let шагов = 0;
  const t0 = Date.now();

  while (Date.now() - t0 < 90000) {
    const d = dist(текущая, цель);
    if (d <= STOP_AT) break;

    // Монстр мог подойти сам — пересчитываем цель каждый шаг.
    const шаг = Math.min(WALK_SPEED * 0.5, d - STOP_AT);
    if (шаг <= 0) break;
    const ux = (цель.x - текущая.x) / d;
    const uz = (цель.z - текущая.z) / d;

    // Проверка ДО отправки: превышение потолка — это бан, а не отказ.
    const скорость = шаг / (0.5);
    if (скорость > SPEED_CAP) throw new Error(`стенд сам нарушает лимит скорости: ${скорость.toFixed(2)} > ${SPEED_CAP}`);

    const след = { x: текущая.x + ux * шаг, z: текущая.z + uz * шаг };
    socket.emit('player:move', {
      position: { x: след.x, y: 0, z: след.z },
      direction: { x: ux, y: 0, z: uz },
    });
    текущая = след;
    прошёл += шаг;
    шагов++;
    await sleep(500);
  }
  return { прошёл, шагов, остаток: dist(текущая, цель) };
}

async function fight(socket, characterId, startPos, target, seen) {
  let ударов = 0;
  let поза = { ...startPos };
  const t0 = Date.now();

  while (ударов < ATTACK_LIMIT && Date.now() - t0 < 90000) {
    // Монстр уходит и подходит: цель берём живой, из последнего спавна.
    const ctx = seen.spawned.filter((m) => m.instanceId === target.instanceId).pop();
    if (!ctx) break;

    // Добираемся до монстра перед ударом: он ходит сам.
    const d = dist(поза, ctx.position);
    if (d > REACH * 0.7) {
      const шаг = Math.min(WALK_SPEED * 0.5, d - REACH * 0.5);
      const ux = (ctx.position.x - поза.x) / d;
      const uz = (ctx.position.z - поза.z) / d;
      поза = { x: поза.x + ux * шаг, z: поза.z + uz * шаг };
      socket.emit('player:move', {
        position: { x: поза.x, y: 0, z: поза.z },
        direction: { x: ux, y: 0, z: uz },
      });
    }

    socket.emit('combat:action', {
      characterId,
      actionType: 'attack',
      targetId: target.instanceId,
      position: { x: поза.x, y: 0, z: поза.z },
      direction: { x: 0, y: 0, z: 1 },
      timestamp: Date.now(),
    });
    ударов++;

    // Монстр убит — идти дальше незачем.
    if (seen.killed.some((k) => k.instanceId === target.instanceId)) break;
    if (seen.results.some((r) => r.targetId === target.instanceId && r.targetHp === 0)) break;

    await sleep(ATTACK_EVERY_MS);
  }
  return ударов;
}

// ============================================================
// Отчёт
// ============================================================
function report({ seen, before, after, target, attacks }) {
  log('');
  log('--- ЧТО УВИДЕЛ СТЕНД ---');
  say('спавнов', seen.spawned.length);
  say('ударов отправлено', attacks);
  say('ответов combat:result', seen.results.length);
  say('ошибок боя', seen.errors.length);
  say('ударов по мне', seen.hits.length);
  say('смертей монстра', seen.killed.length);
  say('отказов по движению', seen.movesRejected.length);
  if (seen.zoneChanged.length) say('смена зоны', JSON.stringify(seen.zoneChanged.slice(0, 3)));

  if (seen.errors.length) {
    const сводка = {};
    for (const e of seen.errors) сводка[e.code ?? JSON.stringify(e)] = (сводка[e.code ?? JSON.stringify(e)] ?? 0) + 1;
    say('коды ошибок', JSON.stringify(сводка));
  }

  if (seen.results.length) {
    log('');
    log('  удары по цели:');
    for (const r of seen.results.slice(0, 12)) {
      const d = r.damage ?? '—';
      say(
        `  удар ${String(seen.results.indexOf(r) + 1).padStart(2)}`,
        `урон ${d}${r.isCritical ? ' КРИТ' : ''}${r.isDodged ? ' УКЛОН' : ''} → hp ${r.targetHp ?? '?'}/${r.targetMaxHp ?? '?'}`
      );
    }
  }

  if (seen.hits.length) {
    log('');
    say('первый удар по мне', JSON.stringify({
      урон: seen.hits[0].damage, hp: seen.hits[0].hp, maxHp: seen.hits[0].maxHp,
    }));
  }

  log('');
  log('--- ЧТО СТАЛОСЬ С ПЕРСОНАЖЕМ ---');
  const строка = (k, a, b) => `${k.padEnd(10)} ${String(a).padStart(8)} → ${String(b).padStart(8)}  ${a === b ? '' : (Number(b) > Number(a) ? '+' : '') + (Number(b) - Number(a))}`;
  log('  ' + строка('опыт', before.xp, after.xp));
  log('  ' + строка('золото', before.gold, after.gold));
  log('  ' + строка('здоровье', before.hp, after.hp));
  log('  ' + строка('уровень', before.level, after.level));
  log('  ' + строка('точка x', before.x.toFixed(1), after.x.toFixed(1)));
  log('  ' + строка('точка z', before.z.toFixed(1), after.z.toFixed(1)));

  log('');
  const убит = seen.killed.length > 0 || seen.results.some((r) => r.targetHp === 0);
  const уронБыл = seen.results.some((r) => Number(r.damage) > 0);
  const наградаБыла = after.xp > before.xp || after.gold > before.gold;

  log('--- ВЕРДИКТ ---');
  say('бой начинается', уронБыл ? 'ДА' : 'НЕТ — ни одного урона');
  say('монстр умирает', убит ? 'ДА' : 'НЕТ');
  say('награда начислена', наградаБыла ? 'ДА' : 'НЕТ');
  if (!убит && seen.results.length === 0 && seen.errors.length === 0) {
    say('подсказка', 'ни ответа, ни отказа — стенд не дошёл до удара');
  }
  log('');
}

// ============================================================
main()
  .then(() => process.exit(0))
  .catch((err) => {
    log('');
    say('ОШИБКА', err?.message ?? String(err));
    if (err?.stack) log(err.stack.split('\n').slice(1, 4).join('\n'));
    process.exit(1);
  });