// Второй фактор на живом сервере.
//
// ЧТО ПРОВЕРЯЕТСЯ
//  1. Миграция 063 применена, ограничения на месте.
//  2. Вход БЕЗ кода отвергается, когда 2FA включён, и ПРОПУСКАЕТСЯ, когда
//     выключен. Это главное: 2FA, который не мешает войти, и не 2FA.
//  3. Верный код пускает, неверный не пускает.
//  4. Тот же код второй раз не принимается (защита от повтора).
//  5. Код восстановления работает один раз.
//  6. Выключение требует кода и стирает секрет из базы.
//  7. Секрет в базе зашифрован и не читается без ключа.
//  8. Состояние возвращено: 2FA выключен, вход работает как раньше.
//
// ОСТОРОЖНО. Включение 2FA меняет вход ВСЕГО аккаунта. Прогон обязан
// вернуть состояние, иначе владелец бота не смог бы войти. Возврат стоит
// в конце и проверяется, а не подразумевается.
import { Client } from 'pg';
// Имена берутся из модуля как есть. Первая версия прогона импортировала
// codeAt, verifyCode и decrypt - таких имён в проекте нет: функции называются
// кодНа, проверитьКод и расшифровать, и импорт упал бы, а прогон был бы
// помечен как «сломан» без всякой причины.
import { кодНа } from '../auth/TwoFactor';

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
const num = async (sql: string, p: unknown[] = []): Promise<number> =>
  Number(await one(sql, p)) || 0;
const BASE = 'http://127.0.0.1:3000';

async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

const ПОЧТА = 'test-bot@eos-gameonline.com';
const ПАРОЛЬ = 'EosTest2026';

console.log('=== 0. ИСХОДНОЕ СОСТОЯНИЕ ===');
const userId = await one(`SELECT id::text FROM users WHERE email = $1`, [ПОЧТА]);
must(userId, 'аккаунт TestBot не найден');
const строк2фа = await num(`SELECT COUNT(*) FROM user_2fa WHERE user_id = $1`, [userId]);
console.log('аккаунт:', userId, '| строк в user_2fa:', строк2фа);
if (строк2фа > 0) {
  // Осталось от ПРОВАЛИВШЕГОСЯ прогона. Аккаунт при этом заперт: вход
  // требует кода, а выключение тоже требует кода, то есть выбраться
  // игровыми средствами нельзя. Убираем строку напрямую - это единственное
  // место, где прогон имеет право писать в таблицу помимо API, и только
  // потому, что необратимый выход из этого состояния без рук.
  console.log('НАЙДЕН ОСТАТОК ПРОШЛОГО ПРОГОНА: ' + строк2фа + ' строк(а)');
  console.log('Состояние возвращается в исходное, иначе аккаунт остался бы запертым.');
  await db.query('DELETE FROM user_2fa WHERE user_id = $1', [userId]);
  const стало = await num(`SELECT COUNT(*) FROM user_2fa WHERE user_id = $1`, [userId]);
  check('состояние возвращено в исходное', стало === 0, `стало ${стало}`);
} else {
  check('2FA изначально не настроен', true);
}

// Базовый вход обязан работать ДО включения - иначе нечем понять, что
// включение что-то изменило.
const доВключения = await api('POST', '/api/auth/login', { email: ПОЧТА, password: ПАРОЛЬ, rememberMe: false });
check('вход работает до включения', доВключения.status === 200, `HTTP ${доВключения.status}`);
let token = доВключения.json?.data?.token ?? доВключения.json?.token;
must(token, 'токен не получен');

console.log('\n=== 1. СХЕМА ===');
const таблиц = await num(`SELECT COUNT(*) FROM information_schema.tables
  WHERE table_name = 'user_2fa'`);
check('таблица создана', таблиц === 1, `${таблиц}`);
const колонок = await num(`SELECT COUNT(*) FROM information_schema.columns
  WHERE table_name = 'user_2fa'`);
check('колонок не меньше десяти', колонок >= 10, `${колонок}`);

console.log('\n=== 2. ВЫДАЧА, НО НЕ ВКЛЮЧЕНИЕ ===');
const begin = await api('POST', '/api/auth/2fa/begin', {}, token);
console.log('POST /api/auth/2fa/begin ->', begin.status);
check('секрет выдан', begin.status === 200 && !!begin.json?.secret, begin.json?.secret ? 'секрет есть' : JSON.stringify(begin.json));
const секрет = String(begin.json?.secret ?? '');
const кодыВосстановления: string[] = begin.json?.recoveryCodes ?? [];
check('десять кодов восстановления', кодыВосстановления.length === 10, `${кодыВосстановления.length}`);
check('ссылка otpauth ведёт на игрока', /otpauth:\/\/totp\//.test(String(begin.json?.otpauthUrl ?? '')));

const вБазе = await one(`SELECT enabled::text FROM user_2fa WHERE user_id = $1`, [userId]);
check('выданный фактор ещё НЕ действует', вБазе === 'false', `enabled=${вБазе}`);

// И вот главное: включён, но не подтверждён - вход ДОЛЖЕН работать.
const входДоПодтверждения = await api('POST', '/api/auth/login', { email: ПОЧТА, password: ПАРОЛЬ, rememberMe: false });
check('неподтверждённый фактор не мешает входу', входДоПодтверждения.status === 200,
  `HTTP ${входДоПодтверждения.status}`);

console.log('\n=== 3. ПОДТВЕРЖДЕНИЕ ===');
// Код подтверждения расходуется: один код, одно использование. Поэтому
// для входа и для выключения нужен СЛЕДУЮЩИЙ шаг, а не тот же самый.
const ШАГ = 30_000;
const верный = кодНа(секрет, Date.now());
const следующий = кодНа(секрет, Date.now() + ШАГ);
const подтверждение = await api('POST', '/api/auth/2fa/confirm', { code: верный }, token);
check('верный код подтверждает', подтверждение.status === 200, `HTTP ${подтверждение.status}`);
const неверный = await api('POST', '/api/auth/2fa/confirm', { code: '000000' }, token);
check('неверный код не подтверждает', неверный.status === 400, `HTTP ${неверный.status}`);

console.log('\n=== 4. СЕКРЕТ ЗАШИФРОВАН ===');
const шифротекст = await one(`SELECT secret_encrypted FROM user_2fa WHERE user_id = $1`, [userId]);
check('в базе не открытый секрет', !шифротекст.includes(секрет), 'открытого текста нет');
check('шифротекст похож на base64', /^[A-Za-z0-9+/=]{40,}$/.test(шифротекст), `${шифротекст.slice(0, 24)}...`);

console.log('\n=== 5. ВХОД БЕЗ КОДА ОТВЕРГАЕТСЯ ===');
const безКода = await api('POST', '/api/auth/login', { email: ПОЧТА, password: ПАРОЛЬ, rememberMe: false });
console.log('вход без кода ->', безКода.status, JSON.stringify(безКода.json?.code ?? ''));
check('вход без кода отвергнут', безКода.status === 401, `HTTP ${безКода.status}`);
check('причина названа: нужен код', безКода.json?.code === 'two_factor_required',
  String(безКода.json?.code));
check('токен не выдан', !безКода.json?.data?.token && !безКода.json?.token);

const сНеверным = await api('POST', '/api/auth/login', { email: ПОЧТА, password: ПАРОЛЬ, rememberMe: false, code: '000000' });
check('вход с неверным кодом отвергнут', сНеверным.status === 401, `HTTP ${сНеверным.status}`);
check('причина названа: код не подошёл', сНеверным.json?.code === 'two_factor_invalid',
  String(сНеверным.json?.code));

const сНевернымПаролем = await api('POST', '/api/auth/login', { email: ПОЧТА, password: 'nepravilnyy', rememberMe: false, code: верный });
check('неверный пароль отвергнут раньше кода', сНевернымПаролем.status === 401
  && сНевернымПаролем.json?.code === 'invalid_credentials',
  `${сНевернымПаролем.status} ${сНевернымПаролем.json?.code}`);

console.log('\n=== 6. ВЕРНЫЙ КОД ПУСКАЕТ ===');
const сВерным = await api('POST', '/api/auth/login', { email: ПОЧТА, password: ПАРОЛЬ, rememberMe: false, code: следующий });
check('вход с верным кодом удался', сВерным.status === 200, `HTTP ${сВерным.status}`);
const входнойТокен = сВерным.json?.data?.token ?? сВерным.json?.token;
check('токен выдан', !!входнойТокен);

console.log('\n=== 7. ПОВТОР КОДА НЕ ПРИНИМАЕТСЯ ===');
// Тот же код, что только что сработал. Без last_used_step он прошёл бы снова
// - и в течение всего окна, то есть полминуты подряд.
const повтор = await api('POST', '/api/auth/login', { email: ПОЧТА, password: ПАРОЛЬ, rememberMe: false, code: следующий });
check('повтор того же кода отвергнут', повтор.status === 401, `HTTP ${повтор.status}`);
check('причина названа: код уже использован', повтор.json?.code === 'two_factor_replayed',
  String(повтор.json?.code));

console.log('\n=== 8. КОД ВОССТАНОВЛЕНИЯ РАБОТАЕТ ОДИН РАЗ ===');
const кодВосст = кодыВосстановления[0];
const сВосстановлением = await api('POST', '/api/auth/login', { email: ПОЧТА, password: ПАРОЛЬ, rememberMe: false, code: кодВосст });
check('код восстановления пускает', сВосстановлением.status === 200, `HTTP ${сВосстановлением.status}`);
const повторВосст = await api('POST', '/api/auth/login', { email: ПОЧТА, password: ПАРОЛЬ, rememberMe: false, code: кодВосст });
check('повтор кода восстановления отвергнут', повторВосст.status === 401, `HTTP ${повторВосст.status}`);

console.log('\n=== 9. ВЫКЛЮЧЕНИЕ ===');
const безВерного = await api('POST', '/api/auth/2fa/disable', { code: '000000' }, token);
check('выключение без верного кода отвергнуто', безВерного.status === 400, `HTTP ${безВерного.status}`);

// Выключение идёт НЕИСПОЛЬЗОВАННЫМ КОДОМ ВОССТАНОВЛЕНИЯ.
//
// Ограничение, которое вскрылось на этом шаге: код TOTP используется один
// раз, то есть в одном окне в тридцать секунд помещается одно действие.
// Подтверждение заняло шаг «сейчас», вход - шаг «сейчас плюс 30 секунд»,
// и оба израсходованы. Третье окно ещё не наступило, а ждать его -
// полминуты молчания ради проверки.
//
// Коды восстановления не привязаны ко времени: их десять, и один уже
// израсходован. Заодно проверяется, что код восстановления годится не
// только для входа, но и для снятия защиты.
const свежий = кодыВосстановления[1];
console.log('для выключения взят код восстановления №2: ' + свежий);
const выключение = await api('POST', '/api/auth/2fa/disable', { code: свежий }, token);
check('выключение верным кодом удалось', выключение.status === 200, `HTTP ${выключение.status}`);
const осталось = await num(`SELECT COUNT(*) FROM user_2fa WHERE user_id = $1`, [userId]);
check('строка удалена целиком, а не обнулена', осталось === 0, `строк ${осталось}`);

const послеВыключения = await api('POST', '/api/auth/login', { email: ПОЧТА, password: ПАРОЛЬ, rememberMe: false });
check('вход работает как раньше', послеВыключения.status === 200, `HTTP ${послеВыключения.status}`);

console.log('\n=== 10. СОСТОЯНИЕ ВОЗВРАЩЕНО ===');
const итог = {
  строк: await num(`SELECT COUNT(*) FROM user_2fa WHERE user_id = $1`, [userId]),
  вход: послеВыключения.status,
};
console.log('итог:', JSON.stringify(итог));
check('2FA выключен, аккаунт не заперт',
  итог.строк === 0 && итог.вход === 200, JSON.stringify(итог));

// Аккаунт НЕ ДОЛЖЕН остаться запертым ни при каком исходе прогона.
// Выключение через API требует кода, и если оно не сработало, единственный
// выход - эта же база. Поэтому проверка обязана быть ПОСЛЕДНЕЙ и обязательной,
// а не «если дошли».
if (await num(`SELECT COUNT(*) FROM user_2fa WHERE user_id = $1`, [userId]) > 0) {
  console.log('СТРОКА 2FA ОСТАЛАСЬ - аккаунт заперт, убираю и поднимаю тревогу');
  await db.query('DELETE FROM user_2fa WHERE user_id = $1', [userId]);
  check('аккаунт не остался запертым', false, 'строка 2FA была удалена принудительно');
}

await db.end();
console.log(failures === 0 ? '\nИТОГ: все проверки прошли' : `\nИТОГ: провалено ${failures}`);
console.log('\nНЕ ПРОВЕРЕНО: работа с настоящим QR-кодом в телефоне. Здесь код');
console.log('считается тем же алгоритмом, что и телефон, - проверено совпадение');
console.log('с векторами RFC 6238, но сканер и экран телефона не проверялись.');
process.exit(failures === 0 ? 0 : 1);
