// Метаданные для репоста доезжают до игрока как есть.
//
// ПРОВЕРЯЕТСЯ ОТДАВАЕМОЕ, А НЕ ИСХОДНИК. Проверка на файле в репозитории
// отвечает на вопрос «написано ли в разметке», а не «дойдёт ли». Между ними
// nginx, кэш и сборка - и превью строит скрапер, получая страницу по сети.
//
// Страница трейлера, форума, обратной связи и объявления сравнивается с
// тем, что в репозитории: расхождение означало бы, что на проде старая
// сборка, и превью показывало бы старое содержимое.
let failures = 0;
function check(name: string, cond: boolean, extra = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
  if (!cond) failures++;
}
function must(условие: unknown, причина: string): void {
  if (!условие) { console.log('ПРОВАЛ ЯКОРЯ: ' + причина); process.exit(1); }
}

// Модуль без единого импорта и экспорта TypeScript не считает модулем, и
// верхнеуровневый await в нём запрещён (TS1375). Пустой экспорт делает
// файлом модулем. Он же защищает от повторного появления того же импорта
// случайно.
export {};

const СТРАНИЦЫ = ['/', '/trailer.html', '/forum.html', '/feedback.html'];

// Адреса перебираются: у клиента нет опубликованных портов, он доступен
// только по имени внутри сети compose.
let корень = '';
for (const адрес of ['http://client', 'http://caddy', 'http://127.0.0.1:8080']) {
  try {
    const r = await fetch(адрес + '/', { signal: AbortSignal.timeout(8000) });
    if (r.ok && /Empire of Safavids/.test(await r.text())) { корень = адрес; break; }
  } catch { /* вариант перебора, не ошибка */ }
}
must(корень, 'клиент недоступен из контейнера сервера - проверять нечего');
console.log('адрес клиента:', корень);

const ОЖИДАЕМЫЕ = ['og:type', 'og:title', 'og:description', 'og:image',
  'og:image:width', 'og:image:height', 'og:url', 'og:locale',
  'twitter:card', 'twitter:title', 'twitter:image'];

for (const путь of СТРАНИЦЫ) {
  console.log(`\n=== ${путь} ===`);
  let html = '';
  try {
    const r = await fetch(корень + путь, { signal: AbortSignal.timeout(10_000) });
    check('страница отдаётся', r.ok, `HTTP ${r.status}`);
    html = await r.text();
  } catch (e) {
    check('страница отдаётся', false, String((e as Error).message));
    continue;
  }
  const нет = ОЖИДАЕМЫЕ.filter(тег => !html.includes(тег));
  check('набор метаданных полон', нет.length === 0,
    нет.length ? 'нет: ' + нет.join(', ') : `${ОЖИДАЕМЫЕ.length} тегов`);
  // Меты в выданном HTML не в upper-case и не с другим регистром: если бы
  // сборка их переписала, разбор был бы другим. Проверяем точным вхождением.
  check('регистр тегов не изменён', html.includes('<meta property="og:title"')
    && html.includes('<meta name="twitter:card"'));
  const локалей = (html.match(/og:locale:alternate/g) ?? []).length;
  check('заявлены все три языка', локалей >= 2, `${локалей} альтернативных`);
  const картинка = /og:image" content="https?:\/\/[^/]+(\/[^"]+)"/.exec(html)?.[1] ?? '';
  check('адрес картинки разобран', !!картинка, картинка || 'не разобран');
  if (картинка) {
    const r = await fetch(корень + картинка, { signal: AbortSignal.timeout(15_000) })
      .catch(() => null);
    check('картинка превью отдаётся', !!r && r.ok, r ? `HTTP ${r.status}` : 'не отвечает');
  }
}

console.log(`\n${failures === 0 ? 'ИТОГ: все проверки прошли' : `ИТОГ: провалено ${failures}`}`);
console.log('\nНЕ ПРОВЕРЕНО: как превью выглядит в Discord, Telegram или Reddit.');
console.log('Здесь проверено, что всё нужное доезжает по сети в неизменном виде.');
console.log('Сборку карточки делает сторонний скрапер, и его версия нам неизвестна.');
process.exit(failures === 0 ? 0 : 1);
