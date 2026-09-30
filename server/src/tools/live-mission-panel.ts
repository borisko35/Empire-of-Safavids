// Проверка панели заданий на живой базе и в ОТДАВАЕМОМ игроку коде.
//
// Запуск из контейнера сервера:
//   docker cp <файл> server:/app/server/src/tools/live-mission-panel.ts
//   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env \
//     exec -T server sh -c 'cd /app/server && npx tsx src/tools/live-mission-panel.ts'
//
// ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ИНСТРУМЕНТ, А НЕ ТЕСТ.
// Ни один тест не выполняет SQL против базы и не ходит по HTTP к живому
// серверу. Именно такие проверки находили поломки, которые тесты видели
// зелёными: вывод типов в LEAST, чужой нулевой UUID вместо персонажа.
//
// ЧТО ЭТОТ ПРОГОН УЖЕ НАШЁЛ (неполный список)
//   - прогресс заданий не писался: column "progress" is of type integer but
//     expression is of type text. LEAST - функция с переменным числом
//     аргументов, и Postgres вывел тип неизвестных параметров как text.
//   - сырой INSERT в characters ломался на обязательной колонке mana.
//   - склейка адресов вида /game/ + /game/assets/... отдавала пустоту.
//
// ТРИ ОШИБКИ САМОГО ПРОГОНА, КОТОРЫЕ ОН ЖЕ И ОБНАРУЖИЛ
// -------------------------------------------------------
// 1. Проверял две ссылки из разметки (29 КБ) и заключал, что панели нет, -
//    двенадцать FAIL подряд. Игра подгружает код кусками: панель в индексе
//    (310 КБ), вызовы API в куске hud (94 КБ), стили в отдельном CSS (58 КБ).
//    Ни один из них в разметке не упомянут. Проверка ищет не там, где лежит.
// 2. Страница ИГРЫ лежит по /game/, а в корне другая. Прогон получал чужой
//    код, в котором панели гильдии быть не может.
// 3. Переводы НЕ в бандле: t() в client/src/app/i18n.ts ходит в рантайме в
//    /locales/<код>.json. Проверка смотрела только на бандл и рапортовала,
//    что русского текста нет. Текст есть, он отдаётся отдельно.
import { Client } from 'pg';

let failures = 0;
function check(name: string, cond: boolean, extra = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
  if (!cond) failures++;
}
function must(условие: unknown, причина: string): void {
  if (!условие) { console.log('ПРОВАЛ ЯКОРЯ: ' + причина); process.exit(1); }
}

const db = new Client({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? 'safavid_user',
  password: process.env.DB_PASSWORD ?? 'safavid_pass',
  database: process.env.DB_NAME ?? 'empire_of_safavids',
});
await db.connect();
const one = async (sql: string, p: unknown[] = []): Promise<string> => {
  const r = await db.query(sql, p);
  return r.rows[0] ? String(Object.values(r.rows[0])[0] ?? '') : '';
};

async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch('http://127.0.0.1:3000' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

const charId = await one(`SELECT id::text FROM characters WHERE name = 'TestBot';`);
must(charId, 'персонаж TestBot не найден');
const снап = async (): Promise<string> => [
  await one(`SELECT COUNT(*) FROM guild_missions`),
  await one(`SELECT COUNT(*) FROM guild_mission_progress`),
  await one(`SELECT COALESCE(SUM(experience),0) FROM guilds`),
  await one(`SELECT COALESCE(SUM(gold),0) FROM guilds`),
].join('/');
const до = await снап();
console.log('TestBot:', charId, '| заданий/прогресса/опыт/золото:', до);

console.log('\n=== 1. СЕРВЕР ОТДАЁТ ЗАДАНИЯ ===');
const login = await api('POST', '/api/auth/login',
  { email: 'test-bot@eos-gameonline.com', password: 'EosTest2026' });
const token = login.json.token ?? login.json.data?.token;
must(token, 'вход не удался');
const список = await api('GET', `/api/guilds/missions?characterId=${charId}`, undefined, token);
check('маршрут отвечает 200', список.status === 200, `HTTP ${список.status}`);
const задания = список.json.missions as any[];
check('три задания', Array.isArray(задания) && задания.length === 3, `${задания?.length}`);
const первое = задания?.[0];
must(первое, 'заданий не пришло');
check('название и описание пришли', !!первое.id && !!первое.nameRu, первое.nameRu);
check('цель с прогрессом',
  Array.isArray(первое.objectives) && typeof первое.objectives[0].progress === 'number',
  JSON.stringify(первое.objectives?.[0]));
check('награда пришла', первое.rewards?.gold > 0 && первое.rewards?.guildExp > 0,
  JSON.stringify(первое.rewards));
check('причину блокировки назвал сервер', первое.blockedBy === 'MISSION_NEEDS_MEMBERS',
  первое.blockedBy || 'пусто');

console.log('\n=== 2. ОТКАЗ ПО СОСТАВУ ===');
// Исходное состояние объявляется, а не предполагается: TestBot глава, но
// состав из одного участника ниже порога. Отказ - правильный результат.
const попытка = await api('POST', '/api/guilds/missions/start',
  { characterId: charId, missionId: первое.id }, token);
check('сервер отказал по существу', попытка.status === 409
  && попытка.json.error === 'MISSION_NEEDS_MEMBERS',
  `HTTP ${попытка.status} ${JSON.stringify(попытка.json)}`);

console.log('\n=== 3. КОД, ОТДАВАЕМЫЙ ИГРОКУ ===');
// У сервиса client нет опубликованных портов: он доступен только по имени
// внутри сети compose. Страница ИГРЫ лежит по /game/, в корне другая.
let база = '';
let корень = '';
for (const адрес of ['http://client/game/', 'http://client/game', 'http://caddy/game/',
  'http://127.0.0.1:8080/game/']) {
  try {
    const r = await fetch(адрес, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) continue;
    if (!/assets\/index-/.test(await r.text())) continue;
    база = адрес.replace(/\/?$/, '/');
    корень = new URL(база).origin;
    break;
  } catch { /* адрес недоступен - это вариант перебора, а не ошибка */ }
}
must(корень, 'клиент недоступен из контейнера сервера - проверять нечего');
console.log('адрес клиента:', база);

const html = await fetch(база).then(r => r.text());
// Адрес собирается от КОРНЯ сайта. Путь из разметки начинается со слэша
// (/game/assets/...), а база кончается слэшем (/game/) - склейка давала бы
// /game//game/... и fetch вернул бы пустоту.
const адрес = (п: string): string => (п.startsWith('http') ? п : корень + п);

const видно = new Set<string>(
  [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(m => m[1]));
const изРазметки = видно.size;
let код = '';
for (const п of [...видно]) {
  код += await fetch(адрес(п)).then(r => r.text()).catch(() => '');
}
// Куски подставляются поимённо из уже скачанного кода, и имена меняются
// при каждой сборке - поэтому ищутся, а не перечисляются.
for (const п of [...видно]) {
  if (!п.endsWith('.js')) continue;
  const свой = await fetch(адрес(п)).then(r => r.text()).catch(() => '');
  for (const m of свой.matchAll(/["'](\/?[\w./-]*assets\/[\w.-]+\.(?:js|css))["']/g)) {
    const путь = m[1].startsWith('/') ? m[1] : '/' + m[1];
    if (видно.has(путь)) continue;
    видно.add(путь);
    код += await fetch(адрес(путь)).then(r => r.text()).catch(() => '');
  }
}
console.log('файлов скачано:', видно.size, '| символов:', код.length);
check('найдено больше, чем лежит в разметке', видно.size > изРазметки,
  `${изРазметки} -> ${видно.size}`);
check('код непустой', код.length > 100000, `${код.length}`);

for (const [что, игла] of [
  ['вызов списка', '/api/guilds/missions?characterId='],
  ['вызов взятия', '/api/guilds/missions/start'],
  ['вызов забора', '/api/guilds/missions/claim'],
  ['заголовок панели', 'missions_title'],
  ['кнопка взять', 'mission_start'],
  ['кнопка забрать', 'mission_claim'],
  ['код отказа', 'MISSION_NEEDS_MEMBERS'],
] as const) {
  check('в отданном коде есть: ' + что, код.includes(игла));
}

console.log('\n=== 4. СТИЛИ, ОТДАВАЕМЫЕ ИГРОКУ ===');
// Ссылка на таблицу стилей живёт в РАЗМЕТКЕ, а не в коде: искать её в коде
// значило объявить «стили не отдаются» о вполне отданных.
const css = [...видно].filter(п => п.endsWith('.css'));
must(css.length > 0, 'в списке скачанных файлов нет ни одного CSS');
let таблица = '';
for (const c of css) таблица += await fetch(адрес(c)).then(r => r.text()).catch(() => '');
console.log('символов в стилях:', таблица.length);
check('стили непустые', таблица.length > 10000, `${таблица.length}`);
for (const класс of ['guild-skill', 'guild-mission-done', 'guild-mission-obj-done']) {
  check('стиль отдан: ' + класс, таблица.includes('.' + класс));
}

console.log('\n=== 5. ПЕРЕВОДЫ, КОТОРЫЕ ИГРОК УВИДИТ ===');
// t() в client/src/app/i18n.ts ходит в рантайме в /locales/<код>.json и при
// отсутствующем ключе ВОЗВРАЩАЕТ САМ ПУТЬ. То есть игрок увидел бы
// «guild.missions_title» вместо текста, и это выглядело бы как ошибка вёрстки.
for (const [язык, ключ, ожидание] of [
  ['ru', 'missions_title', 'Задания гильдии'],
  ['en', 'missions_title', 'Guild missions'],
  ['az', 'missions_title', 'Qərb qətləri'],
  ['ru', 'mission_claim', 'Забрать награду'],
  ['ru', 'err_mission_needs_members', 'Не хватает участников в гильдии.'],
] as const) {
  let словарь: Record<string, Record<string, string>> = {};
  try {
    const r = await fetch(`${корень}/locales/${язык}.json`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) словарь = await r.json() as Record<string, Record<string, string>>;
  } catch { /* объявлено проверкой ниже */ }
  const значение = словарь.guild?.[ключ];
  check(`${язык}: ${ключ} отдан с текстом`, значение === ожидание,
    значение === undefined ? 'КЛЮЧА НЕТ - игрок увидит путь' : String(значение));
}

console.log('\n=== 6. СОСТОЯНИЕ НЕ ИЗМЕНИЛОСЬ ===');
const после = await снап();
check('состояние не изменилось', после === до, 'было ' + до + ', стало ' + после);

await db.end();
console.log(failures === 0 ? '\nИТОГ: все проверки прошли' : `\nИТОГ: провалено ${failures}`);
console.log('\nНЕ ПРОВЕРЕНО: как панель выглядит на экране. Здесь проверено, что');
console.log('код, стили и переводы доходят до игрока в неизменном виде.');
process.exit(failures === 0 ? 0 : 1);
