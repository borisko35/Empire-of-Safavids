// Проверка: трейлер встаёт из подкаталога, как его отдаст itch.io.
// Никаких предположений - реальный http-сервер и реальные запросы.
//
// Схема та же, что на itch.io: страница лежит по адресу с подкаталогом,
// файлы рядом с ней. Если в странице абсолютный '/assets/...', браузер
// пойдёт мимо подкаталога, и кадры не загрузятся.
//
// ЧТО ЗДЕСЬ УЖЕ ПОЧИНИЛОСЬ ДВАЖДЫ, И ОБА РАЗА ТАК, ЧТО ПРОВЕРКА ВРАЛА В СВОЮ
// ПОЛЬЗУ. Первая регулярка требовала кавычку и перед именем, и после него, и
// находила только строки вида SHOTS + 'city.png' - четыре кадра из шести.
// Отчёт был «4 кадра загрузились, плохих нет», и два не проверенных кадра в
// нём не упоминались. Вторая регулярка брала имя без папки и запрашивала
// /itchdemo/city.png вместо /itchdemo/assets/screenshots/city.png - то есть
// проверяла то, чего нет. Теперь: кавычка нужна только в конце, берётся
// ПОЛНЫЙ путь, а имя без слеша разрешается через константу SHOTS, прочитанную
// из самой страницы. И сверху стоит требование ровно шести уникальных
// кадров - молчаливый пропуск больше невозможен.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const корень = 'D:/My Projects/Empire of Sefevids/client/web';
const порт = 38917;  // порт фиксирован: проверка запускается вручную, не в CI
const ОЖИДАЕМО_КАДРОВ = 6;

// Разворачиваем копию в подкаталоге: /itchdemo/trailer.html и /itchdemo/assets/...
const кореньСервера = path.join(__dirname, 'trailer-subdir-site');
const витрина = path.join(кореньСервера, 'itchdemo');
fs.rmSync(кореньСервера, { recursive: true, force: true });
fs.mkdirSync(path.join(витрина, 'assets', 'screenshots'), { recursive: true });
fs.copyFileSync(path.join(корень, 'trailer.html'), path.join(витрина, 'trailer.html'));
for (const f of ['bg-history.png', 'og-screenshot.png', 'icon-256.png']) {
  fs.copyFileSync(path.join(корень, 'assets', f), path.join(витрина, 'assets', f));
}
for (const f of ['city.png', 'combat.png', 'worldmap.png', 'tasks.png']) {
  fs.copyFileSync(path.join(корень, 'assets', 'screenshots', f),
                  path.join(витрина, 'assets', 'screenshots', f));
}

const сервер = http.createServer((запрос, ответ) => {
  const url = decodeURIComponent(запрос.url.split('?')[0]);
  const файл = path.join(кореньСервера, url);
  // Выход за пределы каталога запрещён: путь вида /../ не должен читать
  // ничего снаружи. Тут это осознанно, а не для красоты - проверка сама
  // должна быть безопасной.
  if (!path.resolve(файл).startsWith(path.resolve(кореньСервера))) {
    ответ.writeHead(403).end('net');
    return;
  }
  fs.readFile(файл, (ошибка, данные) => {
    if (ошибка) { ответ.writeHead(404).end('net takogo'); return; }
    ответ.writeHead(200, { 'Content-Type': файл.endsWith('.png') ? 'image/png' : 'text/html' });
    ответ.end(данные);
  });
});

function взять(url) {
  return new Promise(рез => {
    http.get({ host: '127.0.0.1', port: порт, path: url }, r => {
      const куски = [];
      r.on('data', d => куски.push(d));
      r.on('end', () => рез({ код: r.statusCode, тело: Buffer.concat(куски) }));
    }).on('error', () => рез({ код: 0, тело: Buffer.alloc(0) }));
  });
}

(async () => {
  await new Promise(рез => сервер.listen(порт, '127.0.0.1', рез));
  let плохо = 0;

  const страница = await взять('/itchdemo/trailer.html');
  console.log('=== STRANITSA IZ PODKATALOGA ===');
  console.log('  /itchdemo/trailer.html -> ' + страница.код + ', ' + страница.тело.length + ' байт');
  if (страница.код !== 200 || страница.тело.length < 5000) плохо++;

  const html = страница.тело.toString('utf8');
  const сцены = [...html.matchAll(/img: /g)].length;
  const шоты = /const SHOTS = '([^']*)'/.exec(html);
  if (!шоты) { console.log('  ВНИМАНИЕ: на странице нет const SHOTS'); плохо++; }
  const префикс = шоты ? шоты[1] : '';
  const проси = [...new Set(
    [...html.matchAll(/img: [^,\n]*?['`]([^'`]*\.png)['`]/g)]
      .map(m => (m[1].indexOf('/') >= 0 ? m[1] : префикс + m[1])))];

  console.log('\n=== KADRY, KOTORYE PROSIT SAM STRANITSA ===');
  console.log('  сцен на странице: ' + сцены + ', уникальных кадров: ' + проси.length
    + ' (SHOTS="' + префикс + '")');
  if (проси.length !== ОЖИДАЕМО_КАДРОВ) {
    console.log('  ВНИМАНИЕ: ожидалось ' + ОЖИДАЕМО_КАДРОВ + ' уникальных кадров, найдено '
      + проси.length + '. Либо страница потеряла кадры, либо регулярка снова что-то пропускает.');
    плохо++;
  }
  for (const имя of проси) {
    // Адрес разрешается ТАК, КАК ЭТО ДЕЛАЕТ БРАУЗЕР: относительный путь
    // против адреса самой страницы. Склеивать строки руками нельзя -
    // файловая система чинит '/itchdemo/' + '/assets/x' в '/itchdemo/assets/x',
    // проверка радостно рапортует «OK», и поломанная страница проходит.
    // Именно так и вышло: один путь сделали абсолютным - проверка осталась
    // зелёной, и я почти поверил, что относительные пути доказаны.
    const адрес = new URL(имя, 'http://127.0.0.1:' + порт + '/itchdemo/trailer.html');
    const путь = адрес.pathname;
    const ответ = await взять(путь);
    const верен = ответ.код === 200 && ответ.тело.length > 20000;
    // И кадр обязан лежать ВНУТРИ витрины. Ушедший в корень кадр мог бы
    // скачаться, только если бы по счастливой случайности нашёлся там с
    // тем же именем - на это опираться нельзя.
    const вВитрине = путь.indexOf('/itchdemo/') === 0;
    if (!верен || !вВитрине) плохо++;
    console.log('  ' + (верен && вВитрине ? 'OK  ' : 'NET ')
      + ' ' + путь + '  ' + ответ.код + ', ' + ответ.тело.length + ' байт'
      + (вВитрине ? '' : '   <-- ВЫШЕЛ ИЗ ВИТРИНЫ'));
  }

  // И главное: путь В КОРНЕ, каким он и был раньше. Он обязан не найтись -
  // иначе проверка ничего не доказывает: загрузилось бы то же самое, и
  // «относительные пути работают» ничего не значило бы.
  console.log('\n=== ABSOLYUTNYE PUTI V KORNE (tak bylo) ===');
  for (const имя of ['bg-history.png', 'og-screenshot.png']) {
    const ответ = await взять('/assets/' + имя);
    const верен = ответ.код === 404;
    if (!верен) плохо++;
    console.log('  ' + (верен ? 'NET  ' : 'EST ') + ' /assets/' + имя + '  ' + ответ.код);
  }

  сервер.close();
  console.log('\nитого плохих: ' + плохо);
  console.log('RESULT: ' + (плохо === 0 ? 'PASS' : 'FAIL'));
  process.exit(плохо === 0 ? 0 : 1);
})();
