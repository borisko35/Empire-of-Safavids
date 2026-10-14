// Проверка абордажа PvP вживую, оба исхода (§191, §193).
//
// ЧТО ПРОВЕРЯЕТ. Правило владельца: победитель забирает груз цели, проигравший
// теряет треть своего. Проверяются ОБА конца — ответ сокета и состояние базы
// после него. Ответ без базы — слова; база без ответа — молчание.
//
// ПОЧЕМУ ДВА ЗАХОДА. Исход боя детерминирован (resolveBoardFight считает круги,
// броска нет), и на равных персонажах атакующий проигрывает всегда. Значит
// «победа» и «поражение» нельзя получить одним и тем же стендом: их надо
// поставить по отдельности, иначе проверяется только поражение.
//
// ── ЛОВУШКИ, НА КОТОРЫЕ ЭТОТ ИНСТРУМЕНТ УЖЕ НАСТУПАЛ ────────────────────
// 1. socket.region читается из базы один раз при аутентификации. Регион и
//    позиции ставятся ДО входа, а правкой посреди сессии.
// 2. На один токен сервер держит одну сессию: «Invalid session». Токен берётся
//    заново перед каждым соединением.
// 3. Цели PvP берутся из Redis `region:players:{шард}:{регион}`. Если оба не
//    вошли в одну и ту же пару шард+регион, список окажется пустым и заход не
//    начнётся — и это выглядело бы как «абордаж не работает». Поэтому набор
//    печатается ДО захода.
// 4. Список целей строится ТОГДА, когда сервер ищет, а не когда игрок смотрит.
//    Стенд печатает и список, и заход: пустой список и пустой ответ — разные
//    поломки, и без печати они неразличимы.
// 5. Груз надо задать ДО входа обеих сторон: список целей строится в момент
//    запроса, и предмет, добавленный после, в заход не попадёт.
// 6. Строку лодки НЕ удаляем на уборке без снятия is_active: у персонажа может
//    быть только одна активная лодка, и вторая вставка упала бы на uq_boats.
// 7. Набор Redis надо чистить между прогонами: остаточный id удалённого
//    персонажа выглядит как «игрок онлайн» и путает любой опрос набора.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('D:/My Projects/Empire of Sefevids/client/package.json');
const { io } = require('socket.io-client');

const URL = process.env.EOS_GAME_URL ?? 'https://game.eos-gameonline.com';
const ЖЕРТВА = 'EosDummy';
const РЕГИОН = 'persian_gulf';
const ШАРД = 'isfahan';
const ЗОНА = 'persian_gulf_islands';
// Вода у порта: x -175, z -567 (см. REGION_TOWNS, kind: 'port').
const ТОЧКА = { x: -175, y: 0, z: -567 };
const ПРЕДМЕТ = 'trophy_wolf_pelt';
const ГРУЗ = 9;              // нечётное: треть от 9 — ровно 3, без округлений
const ЗОЛОТО_ЖЕРТВЫ = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const лог = (...a) => console.log(...a);

const psql = (sql) => execFileSync('docker', [
  'exec', 'empire-of-safavids-postgres-1', 'psql', '-U', 'safavid_user',
  '-d', 'empire_of_safavids', '-t', '-A', '-c', sql,
], { encoding: 'utf-8' }).trim();

const redis = (...args) => execFileSync('docker',
  ['exec', 'empire-of-safavids-redis-1', 'redis-cli', ...args],
  { encoding: 'utf-8' }).trim();

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
const список = await (await fetch(`${URL}/api/characters`, {
  headers: { Authorization: `Bearer ${token}` },
})).json();
const атакующий = список.characters.find((c) => c.name === 'EosProbe');
if (!атакующий) { лог('нет EosProbe'); process.exit(1); }
const мойId = атакующий.id;
const былоЗолото = Number(psql(`SELECT gold FROM characters WHERE id = '${мойId}'`) || '0');

function убратьВторого() {
  psql(`UPDATE character_boats SET is_active = FALSE WHERE character_id IN (SELECT id FROM characters WHERE name = '${ЖЕРТВА}')`);
  psql(`DELETE FROM character_items WHERE character_id IN (SELECT id FROM characters WHERE name = '${ЖЕРТВА}')`);
  psql(`DELETE FROM characters WHERE name = '${ЖЕРТВА}'`);
  psql(`DELETE FROM character_items WHERE character_id = '${мойId}' AND item_id = '${ПРЕДМЕТ}'`);
  psql(`DELETE FROM character_boats WHERE character_id = '${мойId}' AND boat_id = 'boat_rowboat'`);
  psql(`DELETE FROM anticheat_violations WHERE character_id IN (SELECT id FROM characters WHERE name = '${ЖЕРТВА}')`);
  // Остаточный id в наборе Redis выглядит как «игрок онлайн» и ломает любой
  // опрос набора. Чистим набор целиком: стенд владеет этой парой шард+регион.
  redis('DEL', `region:players:${ШАРД}:${РЕГИОН}`, `shard:members:${ШАРД}`);
}

function активнаяЛодка(ид) {
  psql(`UPDATE character_boats SET is_active = FALSE WHERE character_id = '${ид}'`);
  psql(`DELETE FROM character_boats WHERE character_id = '${ид}' AND boat_id = 'boat_rowboat'`);
  psql(`INSERT INTO character_boats (character_id, boat_id, is_active) VALUES ('${ид}', 'boat_rowboat', TRUE)`);
}

function статы(сила, endurance) {
  return `{"agility":10,"charisma":5,"strength":${сила},"endurance":${endurance},"intelligence":5}`;
}

const сколькоУ = (ид) => Number(psql(
  `SELECT COALESCE(SUM(quantity),0) FROM character_items WHERE character_id = '${ид}' AND item_id = '${ПРЕДМЕТ}'`) || '0');
const золотоУ = (ид) => Number(psql(`SELECT COALESCE(gold,0) FROM characters WHERE id = '${ид}'`) || '0');

// ── Подготовка ───────────────────────────────────────────────
убратьВторого();
psql(`INSERT INTO characters (user_id, name, class, level, experience, stats, hp, max_hp,
         mana, max_mana, stamina, max_stamina, position, region, gold, zone, server_id, base_max_hp)
       VALUES ((SELECT user_id FROM characters WHERE id='${мойId}'), '${ЖЕРТВА}', 'qizilbash', 30, 0,
               '${статы(1, 1)}',
               900, 900, 80, 160, 200, 200,
               '{"x":0,"y":0,"z":0}'::jsonb, '${РЕГИОН}', ${ЗОЛОТО_ЖЕРТВЫ}, '${ЗОНА}', '${ШАРД}', 900)`);
const жертваId = psql(`SELECT id FROM characters WHERE name = '${ЖЕРТВА}'`);
if (!жертваId) { лог('жертва не создалась'); process.exit(1); }

активнаяЛодка(мойId);
активнаяЛодка(жертваId);

const q = (x, z) => `'{"x":${x},"y":0,"z":${z}}'::jsonb`;
psql(`UPDATE characters SET region = '${РЕГИОН}', zone = '${ЗОНА}', server_id = '${ШАРД}',
         position = ${q(ТОЧКА.x, ТОЧКА.z)} WHERE id = '${мойId}'`);
psql(`UPDATE characters SET region = '${РЕГИОН}', zone = '${ЗОНА}', server_id = '${ШАРД}',
         position = ${q(ТОЧКА.x + 5, ТОЧКА.z)} WHERE id = '${жертваId}'`);
psql(`INSERT INTO character_items (character_id, item_id, quantity) VALUES ('${жертваId}', '${ПРЕДМЕТ}', ${ГРУЗ})`);

лог(`жертва ${жертваId}: золото ${золотоУ(жертваId)}, груз ${сколькоУ(жертваId)} × ${ПРЕДМЕТ}`);
лог('жду 35 секунд: кэш владельцев территорий в сервере живёт 30');
await sleep(35000);

// ── Сокеты ───────────────────────────────────────────────────
async function войтиПерсонажем(ид) {
  const s = io(URL, { transports: ['websocket', 'polling'], timeout: 20000, autoConnect: false });
  s.ответы = [];
  s.on('boarding:result', (r) => s.ответы.push(r));
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
    s.emit('auth', { token, characterId: ид });
  });
  return s;
}

const A = await войтиПерсонажем(мойId);
const B = await войтиПерсонажем(жертваId);
лог('оба в мире, один шард и регион');
await sleep(1500);

лог('набор Redis: ' + (redis('SMEMBERS', `region:players:${ШАРД}:${РЕГИОН}`).split('\n').join(', ') || '(ПУСТО)'));

/** Один заход: заход атакующего, ответы обеих сторон, состояние базы после. */
async function заход(метка) {
  A.ответы.length = 0;
  B.ответы.length = 0;

  const цели = await (await fetch(
    `${URL}/api/game/boarding/targets?characterId=${мойId}&mode=pvp`,
    { headers: { Authorization: `Bearer ${token}` } },
  )).json().catch(() => null);
  лог(`  цели PvP: ${JSON.stringify(цели).slice(0, 220)}`);

  const было = { золотоА: золотоУ(мойId), золотоЖ: золотоУ(жертваId), грузА: сколькоУ(мойId), грузЖ: сколькоУ(жертваId) };

  A.emit('boarding:start', { targetId: жертваId, mode: 'pvp' });
  await sleep(3500);

  const стало = { золотоА: золотоУ(мойId), золотоЖ: золотоУ(жертваId), грузА: сколькоУ(мойId), грузЖ: сколькоУ(жертваId) };
  лог(`  ответ атакующего: ${JSON.stringify(A.ответы[0] ?? null).slice(0, 220)}`);
  лог(`  ответ жертвы:     ${JSON.stringify(B.ответы[0] ?? null).slice(0, 220)}`);
  лог(`  золото: атакующий ${было.золотоА} → ${стало.золотоА} (${стало.золотоА - было.золотоА})`
    + `, жертва ${было.золотоЖ} → ${стало.золотоЖ} (${стало.золотоЖ - было.золотоЖ})`);
  лог(`  груз:   атакующий ${было.грузА} → ${стало.грузА}, жертва ${было.грузЖ} → ${стало.грузЖ}`);
  return { ответ: A.ответы[0] ?? null, ответЖ: B.ответы[0] ?? null, было, стало };
}

// ══ ЗАХОД 1. Победа: атакующий сильнее в разы ═════════════════════════════
лог('');
лог('=== ЗАХОД 1. Атакующий сильнее: ждём победу и полный перенос ===');
psql(`UPDATE characters SET stats = '${статы(90, 90)}', hp = 900, max_hp = 900 WHERE id = '${мойId}'`);
psql(`UPDATE characters SET stats = '${статы(1, 1)}', hp = 900, max_hp = 900 WHERE id = '${жертваId}'`);
await sleep(500);
const первый = await заход('победа');

лог('');
лог('--- ПРОВЕРКА ЗАХОДА 1 ---');
const проверка1 = [];
const п1 = (ок, текст) => { проверка1.push(ок); лог(`  ${ок ? 'ДА' : 'НЕТ'}  ${текст}`); };
п1(первый.ответ?.youWon === true, 'атакующему сообщено о победе');
п1(первый.ответ?.targetNameRu === ЖЕРТВА, 'ответ называет жертву');
п1(первый.стало.грузЖ === 0, `груз жертвы забран целиком (осталось ${первый.стало.грузЖ} из ${первый.было.грузЖ})`);
п1(первый.стало.грузА === первый.было.грузА + ГРУЗ, `груз перешёл атакующему (${первый.стало.грузА})`);
const dA = первый.стало.золотоА - первый.было.золотоА;
const dJ = первый.стало.золотоЖ - первый.было.золотоЖ;
п1(dJ === -ЗОЛОТО_ЖЕРТВЫ, `у жертвы снято всё золото (${dJ})`);
п1(dA === -dJ,
  `золото ушло атакующему ровно столько, сколько снято с жертвы: +${dA} против ${dJ}`
  + (dA > -dJ ? ` — БОЛЬШЕ, ЧЕМ БЫЛО СНЯТО: ЗОЛОТО НАПИСАНО ИЗ ВОЗДУХА` : ''));
п1(первый.ответЖ?.youWon === false, 'жертве сообщено о поражении (youWon=false)');

// ══ ЗАХОД 2. Поражение: атакующий много слабее ════════════════════════════
лог('');
лог('=== ЗАХОД 2. Атакующий много слабее: ждём поражение и треть груза ===');
// Груз переносим атакующему: терять должен он, а на нём должен лежать груз.
psql(`UPDATE characters SET hp = 900, max_hp = 900, gold = 0 WHERE id = '${мойId}'`);
psql(`UPDATE characters SET hp = 900, max_hp = 900, gold = ${ЗОЛОТО_ЖЕРТВЫ} WHERE id = '${жертваId}'`);
psql(`DELETE FROM character_items WHERE character_id = '${жертваId}' AND item_id = '${ПРЕДМЕТ}'`);
psql(`DELETE FROM character_items WHERE character_id = '${мойId}' AND item_id = '${ПРЕДМЕТ}'`);
psql(`INSERT INTO character_items (character_id, item_id, quantity) VALUES ('${мойId}', '${ПРЕДМЕТ}', ${ГРУЗ})`);
psql(`INSERT INTO character_items (character_id, item_id, quantity) VALUES ('${жертваId}', '${ПРЕДМЕТ}', ${ГРУЗ})`);
psql(`UPDATE characters SET stats = '${статы(1, 1)}' WHERE id = '${мойId}'`);
psql(`UPDATE characters SET stats = '${статы(90, 90)}' WHERE id = '${жертваId}'`);
await sleep(500);
лог(`  перед заходом: груз атакующего ${сколькоУ(мойId)}, груз жертвы ${сколькоУ(жертваId)}`);
const второй = await заход('поражение');

лог('');
лог('--- ПРОВЕРКА ЗАХОДА 2 ---');
const проверка2 = [];
const п2 = (ок, текст) => { проверка2.push(ок); лог(`  ${ок ? 'ДА' : 'НЕТ'}  ${текст}`); };
const потеряно = второй.было.грузА - второй.стало.грузА;
const треть = Math.floor(ГРУЗ / 3);
п2(второй.ответ?.youWon === false, 'атакующему сообщено о поражении');
п2(второй.ответЖ?.youWon === true, 'жертве сообщено о победе (youWon=true)');
п2(второй.стало.грузЖ === второй.было.грузЖ, `груз жертвы не тронут (${второй.стало.грузЖ})`);
п2(потеряно === треть,
  `проигравший потерял треть своего груза: ${потеряно} из ${второй.было.грузА}`
  + (потеряно === 0 ? ' — НИЧЕГО, правило не работает' : потеряно > треть ? ' — БОЛЬШЕ ТРЕТИ, весь стек' : ''));
п2(второй.стало.грузА === ГРУЗ - потеряно, `у проигравшего осталось ${второй.стало.грузА}`);

// ── Уборка ───────────────────────────────────────────────────
A.close(); B.close();
убратьВторого();
psql(`UPDATE characters SET region = 'isfahan', zone = 'isfahan_center',
         position = '{"x":300,"y":0,"z":299}'::jsonb WHERE id = '${мойId}'`);
лог('');
лог('убрал за собой: второго персонажа, лодки, груз, набор Redis, позиции');
лог(`золото EosProbe было ${былоЗолото}, стало ${золотоУ(мойId)}`);

const всеОк = [...проверка1, ...проверка2].every(Boolean);
лог('');
лог(всеОк ? 'ИТОГ: все проверки пройдены' : 'ИТОГ: есть расхождения, см. строки НЕТ');
process.exit(всеОк ? 0 : 1);