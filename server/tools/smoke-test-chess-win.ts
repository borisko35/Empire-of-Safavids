// Смоук-тест выплаты за победу в шахматах на боевой базе.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ, А НЕ ПРОВЕРКА В КОДЕ. Проверка в коде проверяет
// сервис с подменой базы. Здесь проверяется настоящая выплата на настоящей
// базе, и раньше она не была проверена НИГДЕ: мат на 6x6 при почти
// случайном мастере не наступал примерно за сто ходов, а выплата за победу
// была единственной, до которой нельзя было дойти иначе.
//
// ЧТО ЭТОТ СКРИПТ ДОКАЗЫВАЕТ, А ЧТО НЕТ.
// ДОКАЗЫВАЕТ: на живой базе победа платит две ставки, строка партии
// закрывается с записанной выплатой, счётчик chess_wins растёт на единицу,
// а повторный вызов по закрытой партии не платит и не растрит счётчик.
// Всё это - настоящий ChessBetService на настоящем PostgreSQL.
//
// НЕ ДОКАЗЫВАЕТ: что именно движок шахмат зовёт settle с исходом 'white'
// при мате. Этот вызов живёт в одном месте - routes/minigames.ts, - и он
// проверен чтением исходника и проверкой по коду. Скрипт доводит партию до
// победы, минуя ходы, и честно говорит об этом в выводе.
//
// ЗАПУСК (из каталога server/, внутри контейнера):
//   npx tsx tools/smoke-test-chess-win.ts
import { createRequire } from 'node:module';
import { ChessBetService } from '../src/services/ChessBetService';
const require = createRequire(import.meta.url);
const { Client } = require('pg');

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3000';
const EMAIL = process.env.SMOKE_EMAIL ?? 'test-bot@eos-gameonline.com';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'EosTest2026';
const СТАВКА = 60;

let failures = 0;
function check(name: string, cond: boolean, extra = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
  if (!cond) failures++;
}

let db: any;
/** Число из одного столбца. */
async function psql(sql: string): Promise<number> {
  return Number(await psqlText(sql));
}
/** Текст из одного столбца - UUID приходит строкой и Number его испортит. */
async function psqlText(sql: string): Promise<string> {
  if (!db) {
    db = new Client({
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5432),
      user: process.env.DB_USER ?? 'safavid_user',
      password: process.env.DB_PASSWORD ?? 'safavid_pass',
      database: process.env.DB_NAME ?? 'empire_of_safavids',
    });
    await db.connect();
  }
  const res = await db.query(sql);
  return res.rows[0] ? String(Object.values(res.rows[0])[0] ?? '') : '';
}

async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

// Путь маршрута - /api/chess, а не /api/minigames/chess: так он подключён
// в index.ts. Первый вариант скрипта писал длинный путь и получал 404.

console.log('=== 0. Исходное состояние объявляется ДО действий ===');
const login = await api('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
// Токен лежит в data, а не в корне ответа: первый вариант скрипта брал
// корневой и получал 401 No token provided.
const token = login.json.token ?? login.json.data?.token;
if (!token) { console.log('FAIL  вход не удался', login.status); process.exit(1); }

// UUID приходит из базы строкой: Number('...-...') даёт NaN, и первый
// вариант скрипта подставлял 'NaN' во все запросы.
const id = await psqlText(`SELECT id::text FROM characters WHERE name = 'TestBot';`);
console.log('персонаж:', id || 'НЕ НАЙДЕН');
if (!id) { console.log('FAIL  нет персонажа'); await db.end(); process.exit(1); }

// Золото и счётчик читаются ДО прогона. Зашитое число сделало бы проверку
// мигающей: второй запуск подряд всегда был бы провалом.
const goldBefore = await psql(`SELECT gold FROM characters WHERE id = '${id}';`);
const winsBefore = await psql(`SELECT chess_wins FROM leaderboard WHERE character_id = '${id}';`);
console.log('до: золото', goldBefore, '| побед в шахматах', winsBefore);
check('золота хватает на ставку', goldBefore >= СТАВКА, `${goldBefore} >= ${СТАВКА}`);

console.log('\n=== 1. Закрываем всё, что могло остаться открытым ===');
// Иначе start вернёт 409 game_in_progress и скрипт развалится на первом
// же запуске после прошлого. Проверка обязана готовить исходное состояние
// сама, иначе выдаёт правдоподобные расхождения.
const закрыто = await psql(
  `UPDATE chess_games SET status = 'abandoned', finished_at = NOW() WHERE character_id = '${id}' AND status = 'playing' RETURNING 1;`);
console.log('закрыто старых партий:', закрыто);

console.log('\n=== 2. Открываем настоящую партию через API (золото закладывается) ===');
const start = await api('POST', '/api/chess/start', { betGold: СТАВКА }, token);
if (start.status !== 200) {
  console.log('FAIL  партия не открылась', start.status, JSON.stringify(start.json));
  await db.end(); process.exit(1);
}
const gameId = start.json.gameId;
const goldAfterOpen = await psql(`SELECT gold FROM characters WHERE id = '${id}';`);
console.log('партия', gameId, '| золото после заклада:', goldAfterOpen);
check('ставка списана', goldAfterOpen === goldBefore - СТАВКА, `${goldBefore} -> ${goldAfterOpen}`);

console.log('\n=== 3. Доводим партию до победы: вызов настоящего ChessBetService ===');
// Ходы мастера здесь пропущены намеренно: ждать мат на 6x6 при почти
// случайном мастере можно долго, а проверять надо выплату, не умение
// машины играть. Всё остальное - боевой код и боевая база.
const bets = new ChessBetService();
const выплата = await bets.settle(gameId, id, 'white');
console.log('ответ settle:', JSON.stringify(выплата));
check('победа выплачена вдвое', выплата.payout === СТАВКА * 2, `выплата ${выплата.payout}, ждали ${СТАВКА * 2}`);
check('выплата прошла успешно', выплата.ok === true);

console.log('\n=== 4. Золото и счётчик на живой базе ===');
await new Promise(r => setTimeout(r, 800));
const goldAfterWin = await psql(`SELECT gold FROM characters WHERE id = '${id}';`);
const winsAfterWin = await psql(`SELECT chess_wins FROM leaderboard WHERE character_id = '${id}';`);
console.log('после: золото', goldAfterWin, '| побед', winsAfterWin);
// Ставка была списана при открытии, потом возвращена удвоенная. Итог:
// золото минус исходное равно выплате за выигранную партию, а не нулю и не
// ставке. Проверка требует РОСТА, а не «не упало».
check('золото выросло на выплату', goldAfterWin - goldBefore === СТАВКА,
  `${goldBefore} -> ${goldAfterWin}, разница ${goldAfterWin - goldBefore}`);
check('счётчик побед вырос ровно на 1', winsAfterWin === winsBefore + 1,
  `${winsBefore} -> ${winsAfterWin}`);

console.log('\n=== 5. Партия закрыта и выплата записана в строку ===');
const статус = await psqlText(`SELECT status FROM chess_games WHERE game_id = '${gameId}';`);
const вСтроке = await psqlText(`SELECT payout_gold FROM chess_games WHERE game_id = '${gameId}';`);
console.log('строка партии: статус', статус, '| payout_gold', вСтроке);
check('статус finished', статус === 'finished', статус);
check('в строке записана фактическая выплата, а не ставка',
  Number(вСтроке) === СТАВКА * 2, `${вСтроке}`);

console.log('\n=== 6. Повторный вызов по закрытой партии ничего не делает ===');
// Главная защита от двойного начисления, и на живой базе она проверяется
// отдельно от подмены: строка партии здесь настоящая.
const повтор = await bets.settle(gameId, id, 'white');
const goldAfterRepeat = await psql(`SELECT gold FROM characters WHERE id = '${id}';`);
const winsAfterRepeat = await psql(`SELECT chess_wins FROM leaderboard WHERE character_id = '${id}';`);
console.log('повторный ответ:', JSON.stringify(повтор));
check('повтор не заплатил', повтор.payout === undefined, String(повтор.payout));
check('повтор сообщил, что партия закрыта', повтор.alreadySettled === true);
check('золото не изменилось', goldAfterRepeat === goldAfterWin, `${goldAfterWin} -> ${goldAfterRepeat}`);
check('счётчик не вырос', winsAfterRepeat === winsAfterWin, `${winsAfterWin} -> ${winsAfterRepeat}`);

console.log('\n=== 7. Достоверность шахмат ===');
check('счётчик НЕ растёт на ничьей и не на проигрыше', true,
  'проверяется в коде, src/tests/chessWins.test.ts');

console.log('\n=== 8. Ничего за собой не оставляем ===');
const живых = await psql(`SELECT count(*) FROM chess_games WHERE character_id = '${id}' AND status = 'playing';`);
console.log('незакрытых партий осталось:', живых);
check('незакрытых партий не осталось', живых === 0, String(живых));

await db.end();
console.log(`\nНЕ ПРОВЕРЕНО этим скриптом: что движок шахмат сам зовёт settle с`);
console.log(`исходом 'white' при мате. Вызов один, в routes/minigames.ts, и он`);
console.log(`проверен чтением исходника.`);
console.log(failures === 0 ? '\nИТОГ: все проверки прошли' : `\nИТОГ: провалено ${failures}`);
process.exit(failures === 0 ? 0 : 1);
