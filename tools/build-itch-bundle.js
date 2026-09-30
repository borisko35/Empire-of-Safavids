// Сборка связки для itch.io: страница трейлера одним архивом.
//
// ЗАЧЕМ ИМЕННО ТАК. Проверено: в собранной игре 169 обращений к /api/ и
// Socket.IO, все по своему адресу, плюс база сборки /game/ - абсолютная.
// itch.io отдаёт статические файлы, сервера там нет. Значит игру выложить
// нельзя: страница на itch.io будет витриной со ссылкой на наш сайт, а
// выкладывать оттуда можно страницу трейлера - она самодостаточна, внешних
// стилей и скриптов не грузит вовсе.
//
// ЗАПУСК
//   node tools/build-itch-bundle.js
// Папка tools/itch-bundle/ и архив tools/itch-bundle.zip.
//
// ПРОВЕРЯЕТСЯ ДВАЖДЫ, И ЭТО СУТЬ. Сначала распакованная папка, потом - сам
// архив после распаковки. Проверка папки ничего не говорит об архиве:
// Compress-Archive кладёт файлы по своим путям, и index.html может оказаться
// не в корне, а во вложенной папке. Тогда площадка откроет 404, и снаружи
// это выглядит как «игра не грузится», а не как «архив собран неверно».
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const корень = path.join(__dirname, '..');
const витрина = path.join(__dirname, 'itch-bundle');
const zip = path.join(__dirname, 'itch-bundle.zip');
const распаковка = path.join(__dirname, 'itch-unpack');
let порт = 38919;
const ОЖИДАЕМО_КАДРОВ = 6;

function must(условие, причина) {
  if (!условие) { console.log('ПРОВАЛ ЯКОРЯ: ' + причина); process.exit(1); }
}

// Собирает витрину из исходников. Два вызова: первый для папки, второй -
// после распаковки архива, уже с чужими файлами.
function собрать(папка) {
  fs.rmSync(папка, { recursive: true, force: true });
  fs.mkdirSync(path.join(папка, 'assets', 'screenshots'), { recursive: true });

  // Трейлер ложится как index.html: витрина itch.io идёт по адресу
  // https://владелец.itch.io/игра/ и открывает корень архива.
  const исходник = fs.readFileSync(path.join(корень, 'client/web/trailer.html'), 'utf8');
  must(/const SHOTS = 'assets\/screenshots\/'/.test(исходник),
    'SHOTS в трейлере снова указывает от корня - связка встанет криво');
  fs.writeFileSync(path.join(папка, 'index.html'), исходник);

  for (const f of ['bg-history.png', 'og-screenshot.png', 'icon-256.png']) {
    const откуда = path.join(корень, 'client/web/assets', f);
    must(fs.existsSync(откуда), 'нет ассета ' + f);
    fs.copyFileSync(откуда, path.join(папка, 'assets', f));
  }
  for (const f of ['city.png', 'combat.png', 'worldmap.png', 'tasks.png']) {
    const откуда = path.join(корень, 'client/web/assets/screenshots', f);
    must(fs.existsSync(откуда), 'нет кадра ' + f);
    fs.copyFileSync(откуда, path.join(папка, 'assets/screenshots', f));
  }

  // Текст лицензии едет в архиве: GPL-3.0 требует передавать его вместе с
  // программой, а ссылка на /LICENSE без самого файла - ссылка в пустоту.
  fs.copyFileSync(path.join(корень, 'client/web/LICENSE'), path.join(папка, 'LICENSE'));
}

function взять(адрес) {
  return new Promise(рез => {
    http.get({ host: '127.0.0.1', port: порт, path: адрес }, r => {
      const куски = [];
      r.on('data', d => куски.push(d));
      r.on('end', () => рез({ код: r.statusCode, тело: Buffer.concat(куски) }));
    }).on('error', () => рез({ код: 0, тело: Buffer.alloc(0) }));
  });
}

/**
 * Поднимает сервер на папке и проверяет так, как всё увидит браузер на
 * itch.io: страница в корне подкаталога, адреса разрешаются относительно неё.
 * Возвращает число плохих.
 */
async function проверить(папка, подпись) {
  let плохо = 0;
  const сервер = http.createServer((запрос, ответ) => {
    const url = decodeURIComponent(запрос.url.split('?')[0]);
    const файл = path.join(папка, url);
    if (!path.resolve(файл).startsWith(path.resolve(папка))) {
      ответ.writeHead(403).end('net');
      return;
    }
    fs.readFile(файл, (ошибка, данные) => {
      if (ошибка) { ответ.writeHead(404).end('net takogo'); return; }
      ответ.writeHead(200, { 'Content-Type': файл.endsWith('.png') ? 'image/png' : 'text/html' });
      ответ.end(данные);
    });
  });
  await new Promise(рез => сервер.listen(порт, '127.0.0.1', рез));

  console.log('\n=== ' + подпись + ' ===');
  const html = fs.readFileSync(path.join(папка, 'index.html'), 'utf8');
  const шоты = /const SHOTS = '([^']*)'/.exec(html);
  must(шоты, 'в index.html витрины нет const SHOTS');
  const проси = [...new Set(
    [...html.matchAll(/img: [^,\n]*?['`]([^'`]*\.png)['`]/g)]
      // Имя без слеша - кадр из SHOTS. С путём - уже полный. Склеивать
      // руками нельзя: файловая система чинит '/x/' + '/assets/y',
      // и поломанная витрина проходит проверку.
      .map(m => (m[1].indexOf('/') >= 0 ? m[1] : шоты[1] + m[1])))];

  const главная = await взять('/index.html');
  const ок = главная.код === 200 && главная.тело.length > 5000;
  if (!ок) плохо++;
  console.log('  ' + (ок ? 'OK  ' : 'NET ') + ' /index.html  ' + главная.код
    + ', ' + главная.тело.length + ' байт');

  // Молчаливый пропуск невозможен: число кадров сверяется.
  if (проси.length !== ОЖИДАЕМО_КАДРОВ) {
    console.log('  ВНИМАНИЕ: кадров ' + проси.length + ', ожидалось ' + ОЖИДАЕМО_КАДРОВ);
    плохо++;
  }
  for (const имя of проси) {
    const путь = new URL(имя, 'http://127.0.0.1:' + порт + '/index.html').pathname;
    const ответ = await взять(путь);
    const верен = ответ.код === 200 && ответ.тело.length > 20000;
    if (!верен) плохо++;
    console.log('  ' + (верен ? 'OK  ' : 'NET ') + ' ' + путь + '  ' + ответ.код
      + ', ' + ответ.тело.length + ' байт');
  }

  const лиц = await взять('/LICENSE');
  const файлЕсть = лиц.код === 200 && лиц.тело.length > 30000;
  const ссылкаЕсть = /href="LICENSE"/.test(html);
  if (!файлЕсть || !ссылкаЕсть) плохо++;
  console.log('  ' + (файлЕсть ? 'OK  ' : 'NET ') + ' /LICENSE  ' + лиц.код
    + ', ' + лиц.тело.length + ' байт');
  console.log('  ' + (ссылкаЕсть ? 'OK  ' : 'NET ') + ' ссылка на LICENSE есть на странице');

  сервер.close();
  return плохо;
}

(async () => {
  let плохо = 0;
  порт = 38919;

  собрать(витрина);
  плохо += await проверить(витрина, 'ПАПКА ВИТРИНЫ');

  // ── Архив ────────────────────────────────────────────────────────────────
  fs.rmSync(zip, { force: true });
  let чем = null;
  try {
    execFileSync('zip', ['-qr', zip, '.'], { cwd: витрина, stdio: 'ignore' });
    чем = 'zip';
  } catch {
    try {
      execFileSync('powershell', ['-NoProfile', '-Command',
        'Compress-Archive -Path (Join-Path $env:LITHDIR \'*\') -DestinationPath $env:LITHDIRZIP -Force'],
        { env: { ...process.env, LITHDIR: витрина, LITHDIRZIP: zip }, stdio: 'ignore' });
      чем = 'Compress-Archive';
    } catch {
      console.log('\nНЕТ АРХИВАТОРА: ни zip, ни Compress-Archive. Папка собрана, '
        + 'заархивируй её вручную.');
    }
  }

  if (fs.existsSync(zip)) {
    const вес = fs.statSync(zip).size;
    console.log('\nархив: ' + path.relative(корень, zip) + '  ' + (вес / 1024).toFixed(0)
      + ' КБ  (' + чем + ')');

    fs.rmSync(распаковка, { recursive: true, force: true });
    fs.mkdirSync(распаковка, { recursive: true });
    let чем2;
    try {
      execFileSync('powershell', ['-NoProfile', '-Command',
        'Expand-Archive -Path $env:LITHPKG -DestinationPath $env:LITHDIR -Force'],
        { env: { ...process.env, LITHPKG: zip, LITHDIR: распаковка }, stdio: 'ignore' });
      чем2 = 'Expand-Archive';
    } catch (ошибка) {
      console.log('  НЕ СМОГ РАСПАКОВАТЬ АРХИВ: ' + ошибка.message.split('\n')[0]);
      console.log('RESULT: FAIL');
      process.exit(1);
    }

    // index.html обязан лежать В КОРНЕ распаковки.
    const коренной = fs.existsSync(path.join(распаковка, 'index.html'));
    if (!коренной) {
      console.log('  NET  index.html не в корне архива, в корне: '
        + fs.readdirSync(распаковка).join(', '));
      плохо++;
    } else {
      console.log('  OK   index.html в корне архива  (' + чем2 + ')');
    }
    if (коренной) {
      порт = 38920;
      плохо += await проверить(распаковка, 'САМ АРХИВ, РАСПАКОВАН');
      fs.rmSync(распаковка, { recursive: true, force: true });
    }
  }

  console.log('\nитого плохих: ' + плохо);
  console.log('RESULT: ' + (плохо === 0 ? 'PASS' : 'FAIL'));
  process.exit(плохо === 0 ? 0 : 1);
})();
