// Проверка pvp_damus бонуса территории вживую (§185).
//
// ЧТО ПРОВЕРЯЕТ. Гильдия, держущая Кавказскую крепость, бьёт в PvP сильнее,
// В КАВКАЗСКОМ РЕГИОНЕ. Две стороны:
//   1. с территорией и в её регионе — урон выше базового;
//   2. с территорией, но в ДРУГОМ регионе — урон базовый.
//
// ПОЧЕМУ ВТОРАЯ СТОРОНА ОБЯЗАТЕЛЬНА. Только первая проверила бы «бонус есть».
// Вторая проверяет, что он привязан к месту: без неё можно подключить бонус
// глобально, и проверка бы это пропустила.
//
// ── ПЯТЬ ЛОВУШЕК, НА КОТОРЫЕ ЭТОТ ИНСТРУМЕНТ НАСТУПАЛ ───────────────
// 1. socket.region читается из базы один раз при аутентификации. Регион надо
//    ставить ДО входа, а правкой посреди сессии.
// 2. Тот же токен вторым сокетом даёт «Invalid session»: сервер держит на
//    токен одну сессию. Токен берётся заново перед каждым соединением.
// 3. Прыжок на 360 метров античит считает телепортом («Speed hack: 920.6 u/s»)
//    и банит аккаунт на пятом нарушении за сутки. Старт ставится у точки боя
//    ДО входа — при входе античит сбрасывает позицию, и это не телепорт.
// 4. Защитник должен стоять у ТОЧКИ ТЕКУЩЕГО ЗАМЕРА, а не кавказской всегда:
//    во втором замере иначе его разносит на 700 единиц.
// 5. Молчаливый ноль выглядит как «бонуса нет». Нет ответа по цели — печатается
//    всё, что пришло.
//
// Строку территории НЕ удаляем, а снимаем владельца: удаление строки —
// это поломка игровых данных, а потом «не взялся» тем же текстом, что и при
// настоящей поломке (§181).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('D:/My Projects/Empire of Sefevids/client/package.json');
const { io } = require('socket.io-client');

const URL = process.env.EOS_GAME_URL ?? 'https://game.eos-gameonline.com';
const ИМЯ_ВТОРОГО = 'EosDummy';
const ТЕРРИТОРИЯ = 'territory_caucasus_fortress';
// Кавказ: зона caucasus_fort (z 500..700), у крепости.
const ТОЧКА = { x: 200, y: 0, z: 500 };
// Спокойное место в Исфахане — вне территории.
const ВТОРАЯ = { x: 505, y: 0, z: 55 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const лог = (...a) => console.log(...a);

const psql = (sql) => execFileSync('docker', [
  'exec', 'empire-of-safavids-postgres-1', 'psql', '-U', 'safavid_user',
  '-d', 'empire_of_safavids', '-t', '-A', '-c', sql,
], { encoding: 'utf-8' }).trim();

const raw = readFileSync('D:/My Projects/Empire of Sefevids/deploy/.test-account', 'utf-8');
const ПОЧТА = raw.match(/почта\s*:\s*(\S+)/)?.[1] ?? '';
const ПАРОЛЬ = raw.match(/пароль\s*:\s*(\S+)/)?.[1] ?? '';

/** Токен заново: на один токен сервер держит одну сессию. */
async function войти() {
  const р = await fetch(`${URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ПОЧТА, password: ПАРОЛЬ }),
  });
  const джей = await р.json().catch(() => null);
  if (!джей?.data?.token) {
    лог('ВХОД НЕ УДАЛСЯ: ' + р.status + ' ' + JSON.stringify(джей).slice(0, 160));
    process.exit(1);
  }
  return джей.data.token;
}

let token = await войти();
const заголовки = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
});

const список = await (await fetch(`${URL}/api/characters`, { headers: заголовки() })).json();
const первый = список.characters.find((c) => c.name === 'EosProbe');
if (!первый) { лог('нет EosProbe'); process.exit(1); }
const me = первый.id;

function убратьВторого() {
  psql(`DELETE FROM character_items WHERE character_id IN (SELECT id FROM characters WHERE name = '${ИМЯ_ВТОРОГО}')`);
  psql(`DELETE FROM anticheat_violations WHERE character_id IN (SELECT id FROM characters WHERE name = '${ИМЯ_ВТОРОГО}')`);
  psql(`DELETE FROM characters WHERE name = '${ИМЯ_ВТОРОГО}'`);
}

function убратьГильдию() {
  psql(`UPDATE guild_territories SET guild_id = NULL, captured_at = NULL WHERE territory_id = '${ТЕРРИТОРИЯ}'`);
  psql(`DELETE FROM guild_members WHERE guild_id IN (SELECT id FROM guilds WHERE name = 'Пробная крепость')`);
  psql(`DELETE FROM guilds WHERE name = 'Пробная крепость'`);
  psql(`UPDATE characters SET guild_id = NULL WHERE id = '${me}'`);
}

function поставитьВТочку(точка) {
  // Строки считаем ЗАРАНЕЕ: вложенные одинарные кавычки внутри шаблонной
  // строки ломают её. Было `zone = 'caucasus_fort,` — psql отвечал
  // «syntax error at or near {», и инструмент падал до всякого замера.
  const регион = точка === ТОЧКА ? 'caucasus' : 'isfahan';
  const зона = точка === ТОЧКА ? 'caucasus_fort' : 'isfahan_outskirts';
  const q = (т) => `'{"x":${т.x},"y":0,"z":${т.z}}'::jsonb`;
  const дляПервого = `UPDATE characters SET region = '${регион}', zone = '${зона}', position = ${q(точка)} WHERE id = '${me}'`;
  const дляВторого = `UPDATE characters SET region = '${регион}', zone = '${зона}', position = ${q({ x: точка.x, z: точка.z + 1.5 })} WHERE name = '${ИМЯ_ВТОРОГО}'`;
  psql(дляПервого);
  psql(дляВторого);
}

// ── Подготовка ────────────────────────────────────────────
убратьВторого();
убратьГильдию();
psql(`INSERT INTO characters (user_id, name, class, level, experience, stats, hp, max_hp,
         mana, max_mana, stamina, max_stamina, position, region, gold, zone, server_id, base_max_hp)
       VALUES ((SELECT user_id FROM characters WHERE id='${me}'), '${ИМЯ_ВТОРОГО}', 'qizilbash', 30, 0,
               '{"agility":14,"charisma":9,"strength":22,"endurance":20,"intelligence":6}',
               900, 900, 80, 160, 200, 200,
               '{"x":0,"y":0,"z":0}'::jsonb, 'isfahan', 0, 'isfahan_center', 'isfahan', 900)`);
const второйId = psql(`SELECT id FROM characters WHERE name = '${ИМЯ_ВТОРОГО}'`);
if (!второйId) { лог('второй персонаж не создался'); process.exit(1); }

psql(`INSERT INTO guilds (name, leader_id, gold) VALUES ('Пробная крепость', '${me}', 0)`);
const гильдия = psql(`SELECT id FROM guilds WHERE name = 'Пробная крепость'`);
psql(`UPDATE characters SET guild_id = '${гильдия}' WHERE id = '${me}'`);
psql(`UPDATE guild_territories SET guild_id = '${гильдия}', captured_at = NOW() WHERE territory_id = '${ТЕРРИТОРИЯ}'`);
лог(`гильдия держит «${ТЕРРИТОРИЯ}» — pvp_damage 5%`);
// Кэш владельцев в сервере живёт 30 секунд, а база меняется в обход сервера.
лог('жду 35 секунд, пока сервер перечитает владельцев территорий');
await sleep(35000);

// ── Сокеты ────────────────────────────────────────────────
function сокет(кто) {
  const s = io(URL, { transports: ['websocket', 'polling'], timeout: 20000, autoConnect: false });
  s.кто = кто;
  s.ответы = []; s.ошибки = []; s.поМне = [];
  s.on('combat:result', (r) => s.ответы.push(r));
  s.on('combat:error', (e) => s.ошибки.push(e));
  s.on('combat:hit', (h) => s.поМне.push(h));
  return s;
}

async function войтиПерсонажем(id, кто) {
  const s = сокет(кто);
  token = await войти();
  await new Promise((r, j) => {
    const t = setTimeout(() => j(new Error('сокет ' + кто + ' не подключился')), 20000);
    s.on('connect', () => { clearTimeout(t); r(); });
    s.on('connect_error', (e) => { clearTimeout(t); j(new Error(e?.message ?? 'ошибка')); });
    s.connect();
  });
  await new Promise((r, j) => {
    const t = setTimeout(() => j(new Error('нет auth:success у ' + кто)), 15000);
    s.on('auth:success', () => { clearTimeout(t); r(); });
    s.on('auth:error', (e) => { clearTimeout(t); j(new Error(JSON.stringify(e))); });
    s.emit('auth', { token, characterId: id });
  });
  return s;
}

/**
 * Серия ударов из точки. Защитник встаёт в 1.5 единицах от атакующего.
 *
 * ПОЧЕМУ СЕРИЯ, А НЕ ОДИН УДАР. Первая версия мерила один удар и получила
 * в своей территории 10 с isBlocked: true, а вне её 22 с isBlocked: false —
 * то есть замерила РАЗНУЮ ЗАЩИТУ, а не бонус. Щит держит 45% урона, и
 * 10 против 22 выглядит как «территория ослабляет», хотя это просто блок.
 *
 * Берём только неблокированные удары, помеченные isBlocked: false. Щит в
 * этой игре поднимается действием, а не сам по себе, так что среди пяти
 * ударов неблокированные найдутся. Ни одного — значит защита что-то держит
 * постоянно, и об этом надо сказать, а не тихо сравнить 10 с 22.
 *
 * Пауза 1.3 с между ударами: откат обычной атаки считает сервер, и
 * учащённая серия получала бы combat:error attack_too_fast.
 */
async function серия(a, b, точка, попыток = 5) {
  b.emit('player:move', { position: { x: точка.x, y: 0, z: точка.z + 1.5 }, direction: { x: 0, y: 0, z: -1 } });
  await sleep(900);
  const все = [];
  for (let i = 0; i < попыток; i++) {
    a.ответы.length = 0;
    a.ошибки.length = 0;
    a.emit('player:move', { position: { x: точка.x, y: 0, z: точка.z }, direction: { x: 0, y: 0, z: 1 } });
    a.emit('combat:action', {
      characterId: me, actionType: 'attack', targetId: второйId,
      position: { x: точка.x, y: 0, z: точка.z }, direction: { x: 0, y: 0, z: 1 },
      timestamp: Date.now(),
    });
    await sleep(1300);
    const r = a.ответы.find((x) => x.targetId === второйId);
    if (r) все.push(r);
    if (a.ошибки.length) {
      лог('    ошибка удара: ' + JSON.stringify(a.ошибки[0]).slice(0, 140));
      break;
    }
    if (r && r.isBlocked === false && r.isDodged === false) break;
  }
  if (!все.length) {
    лог('    ответов по цели нет. Пришло всего: ' + a.ответы.length);
    for (const x of a.ответы) лог('      ' + JSON.stringify(x).slice(0, 240));
  }
  return все;
}
/** Печать всех ударов серии — чтобы было видно, какие отброшены как блок. */
function печатьУдары(ответы) {
  const чистые = ответы.filter((r) => r.isBlocked === false && r.isDodged === false);
  лог('  ударов: ' + ответы.length + ', из них неблокированных: ' + чистые.length);
  for (const r of ответы) {
    лог('    урон ' + r.damage + (r.isBlocked ? ' (щит)' : '') + (r.isCritical ? ' (крит)' : '') + (r.isDodged ? ' (уклон)' : ''));
  }
}
// ── Замер 1: в своей территории ───────────────────────────
поставитьВТочку(ТОЧКА);
const A = await войтиПерсонажем(me, 'первый');
const B = await войтиПерсонажем(второйId, 'второй');
лог('оба в мире в кавказском регионе');
const сБонусом = await серия(A, B, ТОЧКА);
лог('');
лог('--- 1. В СВОЕЙ ТЕРРИТОРИИ (Кавказ) ---');
печатьУдары(сБонусом);

// ── Замер 2: вне территории ──────────────────────────────
A.close(); B.close();
поставитьВТочку(ВТОРАЯ);
const A2 = await войтиПерсонажем(me, 'первый');
const B2 = await войтиПерсонажем(второйId, 'второй');
лог('оба перевошли в Исфахан — вне территории');
const безБонуса = await серия(A2, B2, ВТОРАЯ);
лог('');
лог('--- 2. ВНЕ ТЕРРИТОРИИ (Исфахан, та же гильдия с крепостью) ---');
печатьУдары(безБонуса);

A2.close(); B2.close();
убратьВторого();
убратьГильдию();
поставитьВТочку(ТОЧКА);
psql(`UPDATE characters SET region = 'isfahan', zone = 'isfahan_center',
        position = '{"x":300,"y":0,"z":299}'::jsonb WHERE id = '${me}'`);
лог('убрал за собой: гильдию, захват, второго персонажа, позиции');

лог('');
лог('--- ВЕРДИКТ ---');
// Берём только неблокированные удары: сравнение заблокированного с
// неблокированным — это сравнение щита, а не бонуса.
const чистые = (ответы) => ответы.filter((r) => r.isBlocked === false && r.isDodged === false);
const базовыйВсе = чистые(безБонуса);
const сТерриториейВсе = чистые(сБонусом);
const базовый = базовыйВсе[0]?.damage ?? 0;
const сТерриторией = сТерриториейВсе[0]?.damage ?? 0;
лог(`неблокированных: в своей территории ${сТерриториейВсе.length}, вне ${базовыйВсе.length}`);
лог(`  ${сТерриторией > 0 ? 'ДА' : 'НЕТ'}  удар в своей территории прошёл (${сТерриторией})`);
лог(`  ${базовый > 0 ? 'ДА' : 'НЕТ'}  урон вне территории есть (${базовый})`);
лог(`  ${сТерриторией > базовый ? 'ДА' : 'НЕТ'}  бонус добавил урона: ${базовый} → ${сТерриторией} (${сТерриторией - базовый > 0 ? '+' : ''}${сТерриторией - базовый})`);
process.exit(сТерриторией > 0 && базовый > 0 && сТерриторией > базовый ? 0 : 1);