// Проверка defense_bonus бонуса территории вживую (§186).
//
// ЧТО ПРОВЕРЯЕТ. Гильдия, держущая Кавказскую крепость, ПОЛУЧАЕТ на 20% меньше
// урона в PvP, когда дерётся в кавказском регионе. Измеряется защитник.
//
// ПОЧЕМУ ИЗМЕРЯЕТСЯ ЗАЩИТНИК, А НЕ АТАКУЮЩИЙ. §185 уже проверялся с другой
// стороны — урон, который бьёт владелец. Здесь обратная сторона: сколько урона
// владелец ПОЛУЧАЕТ. Оба числа считаются в одном месте боя, но одно — множитель
// атаки (1 + 0.05), другое — множитель защиты (1 - 0.20). Проверка только
// атакующего показала бы, что бонус есть, но не показала бы, что он защищает.
//
// ПОЧЕМУ АТАКУЮЩИЙ БЕЗ ГИЛЬДИИ. Иначе на него действовал бы pvp_damage §185
// (1 + 0.05), и разница между замерами была бы смесью двух бонусов: 1.05 атаки
// в обоих замерах это сокращает, но не убирает, и «защита 0.8» перестала бы
// читаться из чисел. Здесь у атакующего гильдии нет вообще — множитель ровно 1.
//
// ── ЛОВУШКИ, НА КОТОРЫЕ ЭТОТ ИНСТРУМЕНТ УЖЕ НАСТУПАЛ ──────────────────────
// 1. socket.region читается из базы один раз при аутентификации. Регион и
//    позицию ставлю ДО входа, а правкой посреди сессии.
// 2. На один токен сервер держит одну сессию: «Invalid session». Токен берётся
//    заново перед каждым соединением.
// 3. Прыжок на сотни метров античит считает телепортом и банит аккаунт. Старт
//    ставится у точки боя ДО входа — при входе античит сбрасывает позицию.
// 4. Щит держит 45% урона. Первый замер в pvp-territory-check сравнил 10
//    заблокированных с 22 незаблокированными и «увидел», что территория
//    ослабляет. Берёмся ТОЛЬКО за удары с isBlocked === false.
// 5. Урон разбросан. Сравнение одного удара — сравнение двух случайных чисел.
//    Берём несколько неблокированных и смотрим на МАКСИМУМ каждой серии: урон
//    атаки домножается на защиту, и максимум домножается тем же самым.
// 6. Кэш владельцев территорий живёт 30 секунд, а база меняется в обход
//    сервера. Без паузы второй замер показал бы первый.
// 7. Строку территории НЕ удаляем, а снимаем владельца: удаление строки —
//    поломка игровых данных, а потом «не взялся» тем же текстом, что и при
//    настоящей поломке (§181).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('D:/My Projects/Empire of Sefevids/client/package.json');
const { io } = require('socket.io-client');

const URL = process.env.EOS_GAME_URL ?? 'https://game.eos-gameonline.com';
const ЗАЩИТНИК = 'EosDummy';
const ТЕРРИТОРИЯ = 'territory_caucasus_fortress';
// Кавказ: зона caucasus_fort (z 500..700), у крепости.
const ТОЧКА = { x: 200, y: 0, z: 500 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const лог = (...a) => console.log(...a);

const psql = (sql) => execFileSync('docker', [
  'exec', 'empire-of-safavids-postgres-1', 'psql', '-U', 'safavid_user',
  '-d', 'empire_of_safavids', '-t', '-A', '-c', sql,
], { encoding: 'utf-8' }).trim();

const raw = readFileSync('D:/My Projects/Empire of Sefevids/deploy/.test-account', 'utf-8');
const ПОЧТА = raw.match(/почта\s*:\s*(\S+)/)?.[1] ?? '';
const ПАРОЛЬ = raw.match(/пароль\s*:\s*(\S+)/)?.[1] ?? '';

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
const атакующийId = первый.id;

function убратьЗащитника() {
  psql(`DELETE FROM character_items WHERE character_id IN (SELECT id FROM characters WHERE name = '${ЗАЩИТНИК}')`);
  psql(`DELETE FROM anticheat_violations WHERE character_id IN (SELECT id FROM characters WHERE name = '${ЗАЩИТНИК}')`);
  // Лидер гильдии удаляется БАЗОЙ ЗАПРЕЩЁН: guilds.leader_id → characters.id
  // с ON DELETE NO ACTION. Без этого шага удаление падает с
  // «violates foreign key constraint guilds_leader_id_fkey», и скрипт
  // валится на уборке, оставляя после себя гильдию и захват — то есть ровно
  // то состояние, из которого следующий прогон не может выйти.
  psql(`UPDATE characters SET guild_id = NULL WHERE name = '${ЗАЩИТНИК}'`);
  psql(`DELETE FROM characters WHERE name = '${ЗАЩИТНИК}'`);
}

function убратьГильдию() {
  psql(`UPDATE guild_territories SET guild_id = NULL, captured_at = NULL WHERE territory_id = '${ТЕРРИТОРИЯ}'`);
  psql(`DELETE FROM guild_members WHERE guild_id IN (SELECT id FROM guilds WHERE name = 'Пробная крепость')`);
  psql(`DELETE FROM guilds WHERE name = 'Пробная крепость'`);
  psql(`UPDATE characters SET guild_id = NULL WHERE guild_id IN (SELECT id FROM guilds WHERE name = 'Пробная крепость')`);
}

function поставитьТочку() {
  // Строки считаются ЗАРАНЕЕ: вложенные одинарные кавычки внутри шаблонной
  // строки ломают её (бывший сбой: «syntax error at or near {»).
  const q = (x, z) => `'{"x":${x},"y":0,"z":${z}}'::jsonb`;
  psql(`UPDATE characters SET region = 'caucasus', zone = 'caucasus_fort',
          position = ${q(ТОЧКА.x, ТОЧКА.z)} WHERE id = '${атакующийId}'`);
  psql(`UPDATE characters SET region = 'caucasus', zone = 'caucasus_fort',
          position = ${q(ТОЧКА.x, ТОЧКА.z + 1.5)} WHERE name = '${ЗАЩИТНИК}'`);
}

// ── Подготовка ──────────────────────────────────────────────
// Порядок важен: сначала гильдия, потом персонаж. Иначе удаление лидера
// упирается во внешний ключ (см. убратьЗащитника).
убратьГильдию();
убратьЗащитника();
psql(`INSERT INTO characters (user_id, name, class, level, experience, stats, hp, max_hp,
         mana, max_mana, stamina, max_stamina, position, region, gold, zone, server_id, base_max_hp)
       VALUES ((SELECT user_id FROM characters WHERE id='${атакующийId}'), '${ЗАЩИТНИК}', 'qizilbash', 30, 0,
               '{"agility":14,"charisma":9,"strength":22,"endurance":20,"intelligence":6}',
               900, 900, 80, 160, 200, 200,
               '{"x":0,"y":0,"z":0}'::jsonb, 'caucasus', 0, 'caucasus_fort', 'isfahan', 900)`);
const защитникId = psql(`SELECT id FROM characters WHERE name = '${ЗАЩИТНИК}'`);
if (!защитникId) { лог('защитник не создался'); process.exit(1); }

// Гильдия ЗАЩИТНИКА, не атакующего: у атакующего гильдии нет вовсе.
psql(`INSERT INTO guilds (name, leader_id, gold) VALUES ('Пробная крепость', '${защитникId}', 0)`);
const гильдия = psql(`SELECT id FROM guilds WHERE name = 'Пробная крепость'`);
psql(`UPDATE characters SET guild_id = '${гильдия}' WHERE id = '${защитникId}'`);
psql(`UPDATE guild_territories SET guild_id = '${гильдия}', captured_at = NOW() WHERE territory_id = '${ТЕРРИТОРИЯ}'`);

// ЧТО ЗДЕСЬ ПОявилось ПОСЛЕ ПРЕРВАННОГО ПРОГОНА. Скрипт ставил захват, печатал
// «гильдия держит крепость» — и больше ничего не проверял. Прогон сорвался на
// середине, захват в базе оказался пустым, и стенд ушёл бы дальше мерить
// «бонус, которого нет».
//
// Молчаливый ноль неотличим от «бонуса нет»: тот же пустой ответ сервера, тот
// же правдоподобный вывод. Поэтому состояние читается обратно из базы сразу
// после записи — и после ожидания кэша, где кто-то мог его снять.
const владеет = (кто) => {
  const v = psql(`SELECT COALESCE(guild_id::text, '') FROM guild_territories WHERE territory_id = '${ТЕРРИТОРИЯ}'`);
  return v === гильдия ? 'ДА' : `НЕТ (в базе '${v || 'пусто'}')`;
};
if (!гильдия) { лог('гильдия не создалась — захват некуда вешать'); process.exit(1); }
лог(`гильдия ЗАЩИТНИКА держит «${ТЕРРИТОРИЯ}» — defense_bonus 20%`);
лог(`  захват записан в базу: ${владеет()}`);
if (владеет() !== 'ДА') { лог('  ЗАХВАТ НЕ ВСТАЛ — мерить нечего'); process.exit(1); }
лог('у атакующего гильдии нет — pvp_damage §185 не вмешивается');
поставитьТочку();

// ── Сокеты ──────────────────────────────────────────────────
function сокет() {
  const s = io(URL, { transports: ['websocket', 'polling'], timeout: 20000, autoConnect: false });
  s.ответы = []; s.ошибки = [];
  s.on('combat:result', (r) => s.ответы.push(r));
  s.on('combat:error', (e) => s.ошибки.push(e));
  return s;
}

async function войтиПерсонажем(id) {
  const s = сокет();
  token = await войти();
  await new Promise((r, j) => {
    const t = setTimeout(() => j(new Error('сокет не подключился')), 20000);
    s.on('connect', () => { clearTimeout(t); r(); });
    s.on('connect_error', (e) => { clearTimeout(t); j(new Error(e?.message ?? 'ошибка')); });
    s.connect();
  });
  await new Promise((r, j) => {
    const t = setTimeout(() => j(new Error('нет auth:success')), 15000);
    s.on('auth:success', () => { clearTimeout(t); r(); });
    s.on('auth:error', (e) => { clearTimeout(t); j(new Error(JSON.stringify(e))); });
    s.emit('auth', { token, characterId: id });
  });
  return s;
}

/**
 * Серия ударов атакующего по защитнику.
 *
 * Возвращает только НЕБЛОКИРОВАННЫЕ: щит держит 45% урона, и сравнение
 * заблокированного с неблокированным — это сравнение щита, а не защиты.
 *
 * Пауза 1.3 с между ударами: откат обычной атаки считает сервер, учащённая
 * серия получала бы combat:error attack_too_fast.
 */
async function серия(a, попыток = 12) {
  const чистые = [];
  for (let i = 0; i < попыток && чистые.length < 4; i++) {
    a.ответы.length = 0;
    a.ошибки.length = 0;
    a.emit('player:move', { position: { x: ТОЧКА.x, y: 0, z: ТОЧКА.z }, direction: { x: 0, y: 0, z: 1 } });
    a.emit('combat:action', {
      characterId: атакующийId, actionType: 'attack', targetId: защитникId,
      position: { x: ТОЧКА.x, y: 0, z: ТОЧКА.z }, direction: { x: 0, y: 0, z: 1 },
      timestamp: Date.now(),
    });
    await sleep(1300);
    const r = a.ответы.find((x) => x.targetId === защитникId);
    if (a.ошибки.length) {
      лог('    ошибка удара: ' + JSON.stringify(a.ошибки[0]).slice(0, 140));
      break;
    }
    if (r && r.isBlocked === false && r.isDodged === false) чистые.push(r.damage);
  }
  if (!чистые.length) лог('    неблокированных ударов нет — защита держит постоянно');
  return чистые;
}

function печать(подпись, удары) {
  лог(`  ${подпись}: [${удары.join(', ')}]  макс ${удары.length ? Math.max(...удары) : 0}`);
}

async function замер(подпись) {
  лог('');
  лог(`--- ${подпись} ---`);
  лог(`  владение перед замером: ${владеет()}`);
  лог('жду 35 секунд: кэш владельцев территорий в сервере живёт 30');
  await sleep(35000);
  // Кэш мог быть сброшен чем-то, чего не видно: проверяем и ДАЛЬШЕ.
  if (владеет() !== 'ДА') лог('  ВНИМАНИЕ: за время ожидания владение пропало');
  const A = await войтиПерсонажем(атакующийId);
  const B = await войтиПерсонажем(защитникId);
  await sleep(600);
  const удары = await серия(A);
  печать('урон, полученный защитником', удары);
  A.close(); B.close();
  return удары;
}

// ── Замер 1: защитник в своей территории ────────────────────
const сТерриторией = await замер('1. ЗАЩИТНИК ПОД СВОЕЙ КРЕПОСТЬЮ (Кавказ)');

// ── Замер 2: та же точка, та же гильдия, но без захвата ────
// Только снимается ВЛАДЕЛЕЦ, регион остаётся кавказским. Иначе замерялось бы
// два разных места, а разницу объяснить было бы нечем.
psql(`UPDATE guild_territories SET guild_id = NULL, captured_at = NULL WHERE territory_id = '${ТЕРРИТОРИЯ}'`);
лог('');
лог('снял владельца крепости; строку территории НЕ удалял');
const безТерритории = await замер('2. ТОТ ЖЕ БОЙ, БЕЗ ЗАХВАТА');

// ── Уборка ──────────────────────────────────────────────────
убратьГильдию();
убратьЗащитника();
psql(`UPDATE characters SET region = 'isfahan', zone = 'isfahan_center',
        position = '{"x":300,"y":0,"z":299}'::jsonb WHERE id = '${атакующийId}'`);
лог('');
лог('убрал за собой: гильдию, захват, защитника, позиции');

лог('');
лог('--- ВЕРДИКТ ---');
const макс = (a) => (a.length ? Math.max(...a) : 0);
const под = макс(сТерриторией);
const без = макс(безТерритории);
лог(`неблокированных ударов: под крепостью ${сТерриторией.length}, без захвата ${безТерритории.length}`);
лог(`  ${под > 0 ? 'ДА' : 'НЕТ'}  защитник под крепостью получил урон (${под})`);
лог(`  ${без > 0 ? 'ДА' : 'НЕТ'}  защитник без захвата получил урон (${без})`);
лог(`  ${под < без ? 'ДА' : 'НЕТ'}  под крепостью урона МЕНЬШЕ: ${без} → ${под} (${под - без})`);

const отношение = без > 0 ? под / без : 0;
лог(`  отношение ${отношение.toFixed(3)} — ожидаем около 0.80 (защита 20%)`);
const близко = отношение > 0.65 && отношение < 0.92;
// Разумный коридор, а не точное равенство: урон округляется вниз и разбросан.
лог(`  ${близко ? 'ДА' : 'НЕТ'}  отношение в коридоре 0.65..0.92`);

process.exit(под > 0 && без > 0 && под < без && близко ? 0 : 1);
