// ============================================================
// Съёмка кадра мира без браузерной панели (в игру не входит)
// ============================================================
//
// ЗАЧЕМ. Кадр нужен на каждом шаге правки мира: «стало ли похоже на
// город» проверяется глазами, а не тестами. Браузерная панель для этого
// не годится — она рвёт соединение на тяжёлой сцене и не отдаёт ошибки
// страницы. Здесь тот же Chrome, но управляемый кодом: он открывает
// стенд world-check.html, ждёт, пока кадр уедет в приёмник
// (tools/shot-server.mjs), и печатает всё, что страница сказала в консоль.
//
// Запуск:
//   node tools/shots.mjs "<url стенда с shot=...>" [таймаут, мс]
//
// Стенд снимает сам себя (см. world-check.ts) и отдаёт JPEG по POST.
// Скрипт только водит браузер и слушает консоль — если страница упала,
// причина будет видна здесь, а не в пустом чёрном кадре.

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const URL_СТЕНДА = process.argv[2];
const ТАЙМАУТ = Number(process.argv[3] ?? 120000);
if (!URL_СТЕНДА) {
  console.error('нужен адрес стенда: node tools/shots.mjs "<url>" [мс]');
  process.exit(2);
}

const ИМЯ = new URL(URL_СТЕНДА).searchParams.get('shot') ?? 'shot';
const ПАПКА = join(process.cwd(), 'tools', 'shots');
mkdirSync(ПАПКА, { recursive: true });

const ГДЕ_CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean).find((p) => existsSync(p));
if (!ГДЕ_CHROME) {
  console.error('Chrome не найден: задайте CHROME_PATH');
  process.exit(2);
}

// СЪЁМКА В ОКНЕ, А НЕ В HEADLESS. Софтверный GL в headless даёт четыре секунды
// на кадр: за отведённое время успевает 2 кадра, AO не накапливается, и
// картинка получается хуже игровой. Окно с настоящим GPU рендерит десятки
// кадров в секунду — кадр совпадает с тем, что видит игрок.
const браузер = await puppeteer.launch({
  executablePath: ГДЕ_CHROME,
  headless: process.env.SHOT_HEADLESS === '1',
  defaultViewport: null,
  args: [
    '--window-size=1290,780',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    // Окно съёмки никто не смотрит: без этих флагов Chrome режет кадры
    // фоновой вкладки до одного в секунду, и стенд снимает второй кадр.
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    ...(process.env.SHOT_HEADLESS === '1'
      ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox']
      : []),
  ],
});

let код = 0;
try {
  const страница = await браузер.newPage();
  await страница.setViewport({ width: 1280, height: 720 });
  await страница.bringToFront();
  const журнал = [];
  страница.on('console', (m) => журнал.push(`[${m.type()}] ${m.text()}`));
  страница.on('pageerror', (e) => журнал.push(`[pageerror] ${e.message}`));
  страница.on('requestfailed', (r) => {
    if (!r.url().includes('favicon')) журнал.push(`[requestfailed] ${r.url()} — ${r.failure()?.errorText}`);
  });

  await страница.goto(URL_СТЕНДА, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const начало = Date.now();
  let сводка = '';
  while (Date.now() - начало < ТАЙМАУТ) {
    сводка = await страница.evaluate(
      () => document.getElementById('сводка')?.textContent ?? '',
    );
    if (сводка.includes('отправлено') || сводка.includes('приёмник не ответил')) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  const файл = join(ПАПКА, `${ИМЯ}.jpg`);
  // Сводка по сцене: сколько в мире мешей и у скольких материалов есть
  // настоящая карта цвета. Иначе «плоско» — вкус, а не число.
  const сцена = await страница.evaluate(() => {
    const с = window.__стенд;
    if (!с || !с.scene) return null;
    let мешей = 0, сКартой = 0, безКарты = 0;
    const материалы = new Set();
    с.scene.traverse((o) => {
      if (!o.isMesh) return;
      мешей++;
      const список = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of список) {
        if (!m || typeof m !== 'object') continue;
        материалы.add(m);
        if (m.map) сКартой++; else безКарты++;
      }
    });
    const и = с.renderer && с.renderer.info ? с.renderer.info.render : null;
    return { мешей, материалов: материалы.size, сКартой, безКарты, calls: и ? и.calls : 0, triangles: и ? и.triangles : 0 };
  });
  if (сцена) {
    console.log(`сцена: мешей ${сцена.мешей}, материалов ${сцена.материалов}, с картой ${сцена.сКартой}, без карты ${сцена.безКарты}`);
    console.log(`кадр: вызовов ${сцена.calls}, треугольников ${сцена.triangles}`);
  }
  if (process.env.PROBE === '1') {
    const проба = await страница.evaluate(() => {
      const с = window.__стенд;
      if (!с || !с.scene) return null;
      const строки = [];
      const видел = new Map();
      с.scene.traverse((o) => {
        if (!o.isMesh) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!m || typeof m !== 'object') return;
        const ключ = (m.type || '?') + '|' + (m.name || '') + '|' + (m.map ? 'map' : 'nomap')
          + '|' + (m.color ? m.color.getHexString() : '-');
        const запись = видел.get(ключ) || { n: 0, mapW: m.map && m.map.image ? m.map.image.width : 0, geo: o.geometry ? o.geometry.type : '' };
        запись.n++;
        видел.set(ключ, запись);
      });
      for (const [k, v] of видел) строки.push(`${k} x${v.n} карта ${v.mapW} геом ${v.geo}`);
      строки.sort((a, b) => Number(b.split(' x')[1]) - Number(a.split(' x')[1]));
      return строки.slice(0, 25);
    });
    if (проба) {
      console.log('— материалы по частоте —');
      for (const строка of проба) console.log(строка);
    }
  }
  if (process.env.PROBE === '2') {
    const ближние = await страница.evaluate(() => {
      const с = window.__стенд;
      if (!с || !с.scene) return [];
      const камера = с.camera;
      const строки = [];
      с.scene.updateMatrixWorld(true);
      с.scene.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const поз = new o.position.constructor();
        o.getWorldPosition(поз);
        const dx = поз.x - камера.position.x;
        const dz = поз.z - камера.position.z;
        if (Math.hypot(dx, dz) > 50) return;
        if (поз.y < 2.2 || поз.y > 9) return;
        o.geometry.computeBoundingBox();
        const б = o.geometry.boundingBox;
        const размер = [б.max.x - б.min.x, б.max.y - б.min.y, б.max.z - б.min.z].map((v) => v.toFixed(1)).join('x');
        строки.push(`${o.geometry.type} ${размер} y=${поз.y.toFixed(1)} x=${поз.x.toFixed(0)} z=${поз.z.toFixed(0)} мат=${o.material && o.material.color ? o.material.color.getHexString() : '-'}`);
      });
      return строки.slice(0, 40);
    });
    console.log('— ближние высокие меши —');
    for (const строка of ближние) console.log(строка);
  }
  console.log(`сводка: ${сводка || '(пусто)'}`);
  console.log(`файл: ${existsSync(файл) ? 'есть' : 'НЕТ'} — ${файл}`);
  for (const строка of журнал) console.log(строка);
  if (!existsSync(файл) || !сводка.includes('отправлено')) код = 1;
} catch (e) {
  console.error(`съёмка не удалась: ${String(e)}`);
  код = 1;
} finally {
  await браузер.close();
}
process.exit(код);
