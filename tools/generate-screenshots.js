// ============================================================
// Генератор скриншотов и геймплея для сайта — Empire of Safavids
// ============================================================
// Процедурные PNG-витрины в духе арт-дирекшна игры (палитра и приёмы
// как в tools/generate-background.js): силуэты, свечения, зерно,
// виньетка. Детерминировано (mulberry32): повторный запуск даёт те же файлы.
// Результат: client/web/assets/screenshots/*.png (1280x720),
//   client/web/assets/og-screenshot.png (1200x630, для Open Graph).
// Запуск: НЕ ЗАПУСКАТЬ. См. ПРЕДОХРАНИТЕЛЬ ниже, он объясняет почему.
//
// Что здесь было: скрипт рисовал процедурные иллюстрации для лендинга -
// силуэты, свечения, зерно, виньетку. Тогда это и было содержимым страницы.
// Потом кадры заменили настоящими снимками боевого сервера (city.png,
// combat.png, tasks.png, worldmap.png), а скрипт остался в репозитории.
//
// ПРОВЕРЕНО НА СЕБЕ, ДВАЖДЫ. При попытке поставить предохранитель якорь
// не совпал, скрипт запустился, и combat.png вырос со 163 КБ до 1153 КБ.
// Настоящий снимок боя был потерян и вернут только через git checkout. Ни в
// журнале сервера, ни в истории этого не видно: смена файла ассетов не
// ведёт событий. Именно поэтому предохранитель нужен в коде, а не в
// договорённости.

'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Палитра арт-дирекшна
const SKY_TOP = [13, 27, 42];
const SKY_MID = [22, 42, 64];
const SKY_LOW = [35, 62, 88];
const TEAL = [46, 139, 139];
const TEAL_DOME = [64, 160, 160];
const GOLD = [201, 168, 76];
const GOLD_LIGHT = [244, 210, 108];
const CRIMSON = [139, 26, 26];
const SILHOUETTE = [7, 13, 24];
const CREAM = [245, 240, 232];
const SAND = [176, 148, 104];

function mix(a, b, t) {
  t = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function clamp01(v) { return Math.min(1, Math.max(0, v)); }

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeBuf(w, h) {
  return { w, h, buf: Buffer.alloc(w * h * 4) };
}
function setPx(B, x, y, c, a = 1) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= B.w || yi >= B.h) return;
  const i = (yi * B.w + xi) * 4;
  const b = B.buf;
  b[i] = Math.round(b[i] * (1 - a) + c[0] * a);
  b[i + 1] = Math.round(b[i + 1] * (1 - a) + c[1] * a);
  b[i + 2] = Math.round(b[i + 2] * (1 - a) + c[2] * a);
  b[i + 3] = 255;
}
function fillRect(B, x0, y0, x1, y1, c, a = 1) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(B.h, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(B.w, Math.ceil(x1)); x++) {
      setPx(B, x, y, c, a);
    }
  }
}
function disc(B, cx, cy, r, c, a = 1) {
  const rr = Math.ceil(r);
  for (let dy = -rr; dy <= rr; dy++) {
    for (let dx = -rr; dx <= rr; dx++) {
      const d = Math.hypot(dx, dy) / r;
      if (d > 1) continue;
      setPx(B, cx + dx, cy + dy, c, a * (1 - d * 0.55));
    }
  }
}
/** Радиальное свечение: яркий центр, мягкое затухание. */
function glow(B, cx, cy, r, c, strength = 1) {
  const rr = Math.ceil(r);
  for (let dy = -rr; dy <= rr; dy++) {
    for (let dx = -rr; dx <= rr; dx++) {
      const d = Math.hypot(dx, dy) / r;
      if (d > 1) continue;
      setPx(B, cx + dx, cy + dy, c, strength * Math.pow(1 - d, 2.2));
    }
  }
}
function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside;
    j = i;
  }
  return inside;
}
function poly(B, pts, c, a = 1) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(B.h, y1); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(B.w, x1); x++) {
      if (inPoly(x + 0.5, y + 0.5, pts)) setPx(B, x, y, c, a);
    }
  }
}
function seg(B, x0, y0, x1, y1, w, c, a = 1) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disc(B, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, c, a);
  }
}
function grain(B, rnd, amt) {
  for (let i = 0; i < B.buf.length; i += 4) {
    const n = (rnd() - 0.5) * amt;
    B.buf[i] = Math.max(0, Math.min(255, Math.round(B.buf[i] + n)));
    B.buf[i + 1] = Math.max(0, Math.min(255, Math.round(B.buf[i + 1] + n)));
    B.buf[i + 2] = Math.max(0, Math.min(255, Math.round(B.buf[i + 2] + n)));
  }
}
function vignette(B, amt) {
  for (let y = 0; y < B.h; y++) {
    for (let x = 0; x < B.w; x++) {
      const nx = x / B.w * 2 - 1, ny = y / B.h * 2 - 1;
      const v = 1 - amt * Math.pow(Math.min(1, Math.hypot(nx, ny) / 1.42), 2);
      const i = (y * B.w + x) * 4;
      B.buf[i] = Math.round(B.buf[i] * v);
      B.buf[i + 1] = Math.round(B.buf[i + 1] * v);
      B.buf[i + 2] = Math.round(B.buf[i + 2] * v);
    }
  }
}
function stars(B, rnd, count, maxY, tint) {
  for (let n = 0; n < count; n++) {
    const x = Math.floor(rnd() * B.w), y = Math.floor(rnd() * maxY);
    const b = 0.25 + rnd() * 0.65;
    const r = rnd() > 0.93 ? 1.6 : 1.0;
    disc(B, x, y, r, tint, b * 0.8);
  }
}
/** Стая птиц: короткие «галочки»-силуэты. */
function birds(B, rnd, list, c, a = 0.85) {
  for (const [x, y, s] of list) {
    seg(B, x - s, y, x, y - s * 0.45, 1.6, c, a);
    seg(B, x, y - s * 0.45, x + s, y, 1.6, c, a);
  }
}

// ============================================================
// Сцена 1: ночной бой у ворот (combat)
// ============================================================
function sceneCombat(w, h) {
  const B = makeBuf(w, h);
  const rnd = mulberry32(1101);
  const horizon = h * 0.62;
  for (let y = 0; y < h; y++) {
    const t = y / h;
    let sky = t < 0.5 ? mix(SKY_TOP, SKY_MID, t / 0.5) : mix(SKY_MID, SKY_LOW, (t - 0.5) / 0.5);
    if (y > horizon - h * 0.22) {
      const k = clamp01((y - (horizon - h * 0.22)) / (h * 0.22));
      sky = mix(sky, [120, 52, 30], k * k * 0.8);
    }
    fillRect(B, 0, y, w, y + 1, sky.map(Math.round));
  }
  // Луна и звёзды
  glow(B, w * 0.78, h * 0.2, 130, CREAM, 0.35);
  disc(B, w * 0.78, h * 0.2, 34, CREAM, 0.95);
  disc(B, w * 0.78 - 12, h * 0.2 - 8, 30, mix(SKY_TOP, CREAM, 0.12), 0.5);
  stars(B, rnd, 260, horizon * 0.9, CREAM);
  // Стена с зубцами и ворота
  const wallTop = horizon - 70;
  fillRect(B, 0, wallTop, w, horizon + 40, SILHOUETTE);
  for (let x = 0; x < w; x += 44) fillRect(B, x, wallTop - 22, x + 24, wallTop, SILHOUETTE);
  // Башни
  for (const tx of [w * 0.12, w * 0.88]) {
    poly(B, [tx - 46, horizon + 40, tx - 46, wallTop - 60, tx - 30, wallTop - 96, tx - 14, wallTop - 60, tx - 14, horizon + 40], SILHOUETTE);
    glow(B, tx - 30, wallTop - 40, 26, [255, 150, 60], 0.8);
    disc(B, tx - 30, wallTop - 40, 5, GOLD_LIGHT, 0.95);
  }
  // Арка ворот
  poly(B, [w * 0.46, horizon + 40, w * 0.46, horizon - 60, w * 0.5, horizon - 92, w * 0.54, horizon - 60, w * 0.54, horizon + 40], [5, 8, 16]);
  glow(B, w * 0.5, horizon - 30, 60, [255, 140, 50], 0.5);
  // Факелы на стене
  for (let x = 60; x < w; x += 160) {
    if (Math.abs(x - w * 0.12 + 30) < 60 || Math.abs(x - w * 0.88 + 30) < 60) continue;
    glow(B, x, wallTop + 6, 30, [255, 150, 60], 0.7);
    disc(B, x, wallTop + 6, 4, GOLD_LIGHT, 0.95);
  }
  // Земля
  for (let y = Math.floor(horizon + 40); y < h; y++) {
    const t = (y - horizon - 40) / (h - horizon - 40);
    fillRect(B, 0, y, w, y + 1, mix([26, 24, 20], SILHOUETTE, 0.4 + 0.6 * t).map(Math.round));
  }
  // Два воина в схватке (стройные силуэты с золотой окантовкой от искр)
  const duel = (cx, flip, col) => {
    const s = flip ? -1 : 1;
    poly(B, [cx - 10 * s, h - 40, cx - 8 * s, h - 128, cx + 8 * s, h - 128, cx + 10 * s, h - 40], col);
    disc(B, cx + 2 * s, h - 150, 12, col);
    seg(B, cx + 2 * s, h - 148, cx - 22 * s, h - 126, 4, col); // рука
    seg(B, cx + 8 * s, h - 94, cx + 5 * s, h - 40, 8, col); // ноги
    seg(B, cx - 7 * s, h - 94, cx - 10 * s, h - 40, 8, col);
    seg(B, cx - 10 * s, h - 40, cx - 8 * s, h - 128, 1.8, GOLD_LIGHT, 0.55); // окантовка
  };
  duel(w * 0.42, false, [10, 12, 20]);
  duel(w * 0.58, true, [16, 10, 12]);
  // Сабли и искры
  seg(B, w * 0.44 - 20, h - 128, w * 0.47, h - 210, 3, [200, 205, 215], 0.95);
  seg(B, w * 0.56 + 20, h - 128, w * 0.53, h - 210, 3, [200, 205, 215], 0.95);
  glow(B, w * 0.5, h - 210, 90, GOLD_LIGHT, 0.75);
  disc(B, w * 0.5, h - 210, 10, [255, 250, 230], 0.95);
  for (let n = 0; n < 90; n++) {
    const a = rnd() * Math.PI * 2, r = 12 + rnd() * 80;
    const hot = rnd() > 0.4;
    disc(B, w * 0.5 + Math.cos(a) * r, h - 210 + Math.sin(a) * r * 0.7, 1.4,
      hot ? GOLD_LIGHT : [255, 120, 50], 0.85);
  }
  // Трава на переднем плане
  for (let n = 0; n < 260; n++) {
    const x = rnd() * w, y = horizon + 60 + rnd() * (h - horizon - 60);
    seg(B, x, y, x + (rnd() - 0.5) * 8, y - 6 - rnd() * 10, 1.6, [34, 52, 30], 0.8);
  }
  grain(B, rnd, 14);
  vignette(B, 0.32);
  return B;
}

// ============================================================
// Сцена 2: Исфахан днём (isfahan) — w,h параметрические (и og)
// ============================================================
function sceneIsfahan(w, h) {
  const B = makeBuf(w, h);
  const rnd = mulberry32(2202);
  const horizon = h * 0.66;
  for (let y = 0; y < h; y++) {
    const t = y / h;
    let sky;
    if (t < 0.45) sky = mix([96, 170, 180], [168, 208, 205], t / 0.45);
    else if (t < 0.66) sky = mix([168, 208, 205], [244, 224, 170], (t - 0.45) / 0.21);
    else sky = mix([244, 224, 170], [232, 200, 140], (t - 0.66) / 0.34);
    fillRect(B, 0, y, w, y + 1, sky.map(Math.round));
  }
  // Солнце
  const sx = w * 0.7, sy = h * 0.24;
  glow(B, sx, sy, h * 0.28, GOLD_LIGHT, 0.55);
  disc(B, sx, sy, h * 0.055, [255, 250, 235], 0.95);
  birds(B, rnd, [[w * 0.2, h * 0.2, 9], [w * 0.26, h * 0.24, 7], [w * 0.32, h * 0.18, 8], [w * 0.6, h * 0.32, 6]], [60, 60, 65], 0.7);
  // Купол: барабан + полусфера + шпиль
  const cx = w * 0.5, base = horizon, R = w * 0.085, top = horizon - h * 0.3;
  fillRect(B, cx - R * 0.72, top + (base - top) * 0.42, cx + R * 0.72, base, [238, 228, 205]);
  for (let y = Math.floor(top); y < base; y++) {
    const t = (y - top) / (base - top);
    const half = R * Math.pow(Math.sin(Math.min(1, t) * Math.PI / 2), 0.72);
    for (let x = Math.floor(cx - half); x < cx + half; x++) {
      const rib = 0.5 + 0.5 * Math.sin((x - cx) / R * 9);
      const shade = 0.75 + 0.25 * (x > cx ? 1 : -1) * 0.4 + 0.25 * (1 - t);
      let c = mix(TEAL_DOME, [220, 235, 230], rib * 0.18 * shade);
      setPx(B, x, y, c.map(Math.round));
    }
  }
  seg(B, cx, top, cx, top - h * 0.045, 3, GOLD, 0.95);
  disc(B, cx, top - h * 0.05, 4, GOLD_LIGHT, 0.95);
  glow(B, cx, top - h * 0.05, 26, GOLD_LIGHT, 0.5);
  // Минареты
  for (const mx of [cx - R * 1.9, cx + R * 1.9]) {
    const mw = Math.max(5, w * 0.008);
    fillRect(B, mx - mw, top - h * 0.1, mx + mw, base, [232, 220, 195]);
    fillRect(B, mx - mw - 5, top - h * 0.02, mx + mw + 5, top + h * 0.005, [120, 90, 60]);
    poly(B, [mx - mw, top - h * 0.1, mx + mw, top - h * 0.1, mx, top - h * 0.16], TEAL_DOME);
    seg(B, mx, top - h * 0.16, mx, top - h * 0.2, 2.5, GOLD, 0.95);
  }
  // Боковые корпуса и стена
  fillRect(B, cx - R * 3.4, base - h * 0.07, cx - R * 1.2, base, [226, 210, 180]);
  fillRect(B, cx + R * 1.2, base - h * 0.07, cx + R * 3.4, base, [226, 210, 180]);
  disc(B, cx - R * 2.3, base - h * 0.07, R * 0.32, TEAL_DOME, 0.95);
  disc(B, cx + R * 2.3, base - h * 0.07, R * 0.32, TEAL_DOME, 0.95);
  fillRect(B, 0, base, w, base + 8, [200, 180, 145]);
  // Сад: зелень, кипарисы, бассейн
  for (let y = Math.floor(base + 8); y < h; y++) {
    const t = (y - base) / (h - base);
    fillRect(B, 0, y, w, y + 1, mix([96, 128, 70], [60, 88, 52], t).map(Math.round));
  }
  for (let n = 0; n < 26; n++) {
    const x = rnd() * w, y0 = base + 14 + rnd() * (h - base - 20);
    const s = 8 + rnd() * 22;
    poly(B, [x - s * 0.28, y0, x + s * 0.28, y0, x, y0 - s], mix([46, 92, 52], [70, 120, 66], rnd()), 0.95);
  }
  // Бассейн с отражением купола
  const poolY = base + (h - base) * 0.35;
  fillRect(B, w * 0.3, poolY, w * 0.7, poolY + (h - base) * 0.3, [70, 140, 150]);
  fillRect(B, w * 0.3, poolY, w * 0.7, poolY + 3, [220, 235, 230]);
  for (let n = 0; n < 40; n++) {
    const x = w * 0.3 + rnd() * w * 0.4, y = poolY + 4 + rnd() * (h - base) * 0.24;
    seg(B, x, y, x + 8 + rnd() * 20, y, 1.4, [200, 230, 235], 0.5);
  }
  // Цветы
  for (let n = 0; n < 130; n++) {
    const x = rnd() * w, y = base + 10 + rnd() * (h - base - 10);
    disc(B, x, y, 1.6, [n % 3 ? 200 : 220, n % 3 ? 90 : 200, n % 3 ? 110 : 120], 0.9);
  }
  grain(B, rnd, 10);
  vignette(B, 0.22);
  return B;
}

// ============================================================
// Сцена 3: подземелье (dungeon)
// ============================================================
function sceneDungeon(w, h) {
  const B = makeBuf(w, h);
  const rnd = mulberry32(3303);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = y / h;
      const c = mix([8, 10, 16], [26, 20, 16], t);
      const band = 1 + 0.06 * Math.sin(x * 0.02 + y * 0.05) + 0.04 * Math.sin(x * 0.11);
      setPx(B, x, y, [c[0] * band, c[1] * band, c[2] * band]);
    }
  }
  // Сталактиты и сталагмиты
  for (let n = 0; n < 40; n++) {
    const x = rnd() * w, len = 30 + rnd() * 150, wd = 8 + rnd() * 26;
    poly(B, [x - wd, 0, x + wd, 0, x + (rnd() - 0.5) * 10, len], [30, 28, 34]);
    const gx = rnd() * w, gl = 20 + rnd() * 90, gw = 10 + rnd() * 30;
    poly(B, [gx - gw, h, gx + gw, h, gx + (rnd() - 0.5) * 8, h - gl], [34, 30, 26]);
  }
  // Факелы на стенах
  const torches = [[w * 0.16, h * 0.42], [w * 0.84, h * 0.38], [w * 0.62, h * 0.55]];
  for (const [tx, ty] of torches) {
    seg(B, tx, ty + 44, tx, ty + 6, 5, [70, 50, 32]);
    glow(B, tx, ty, 150, [255, 140, 50], 0.55);
    glow(B, tx, ty, 46, GOLD_LIGHT, 0.8);
    disc(B, tx, ty, 7, [255, 220, 150], 0.95);
    for (let n = 0; n < 14; n++) {
      disc(B, tx + (rnd() - 0.5) * 26, ty - 6 - rnd() * 30, 1.6, [255, 150, 60], 0.7);
    }
  }
  // Сундук и золото
  const chx = w * 0.42, chy = h * 0.82;
  poly(B, [chx - 70, chy, chx + 70, chy, chx + 58, chy - 44, chx - 58, chy - 44], [96, 64, 34]);
  poly(B, [chx - 58, chy - 44, chx + 58, chy - 44, chx + 58, chy - 66, chx - 58, chy - 66], [70, 46, 24]);
  fillRect(B, chx - 6, chy - 56, chx + 6, chy - 32, GOLD_LIGHT);
  glow(B, chx, chy - 60, 170, GOLD, 0.5);
  for (let n = 0; n < 60; n++) {
    const x = chx - 70 + rnd() * 140, y = chy - 66 - rnd() * 26;
    disc(B, x, y, 1.8, rnd() > 0.3 ? GOLD_LIGHT : GOLD, 0.9);
  }
  // Россыпь монет на полу
  for (let n = 0; n < 90; n++) {
    const x = rnd() * w, y = h * 0.8 + rnd() * h * 0.18;
    disc(B, x, y, 1.5, [180 + rnd() * 60, 140 + rnd() * 50, 60], 0.75);
  }
  // Туман у пола
  for (let n = 0; n < 60; n++) {
    const x = rnd() * w, y = h * 0.7 + rnd() * h * 0.25;
    disc(B, x, y, 14 + rnd() * 30, [70, 80, 95], 0.10);
  }
  grain(B, rnd, 16);
  vignette(B, 0.42);
  return B;
}

// ============================================================
// Сцена 4: Симург на закате (simurgh)
// ============================================================
function sceneSimurgh(w, h) {
  const B = makeBuf(w, h);
  const rnd = mulberry32(4404);
  const horizon = h * 0.7;
  for (let y = 0; y < h; y++) {
    const t = y / h;
    let sky;
    if (t < 0.35) sky = mix([38, 30, 70], [96, 52, 96], t / 0.35);
    else if (t < 0.6) sky = mix([96, 52, 96], [210, 110, 70], (t - 0.35) / 0.25);
    else sky = mix([210, 110, 70], [250, 200, 130], (t - 0.6) / 0.4);
    fillRect(B, 0, y, w, y + 1, sky.map(Math.round));
  }
  // Солнце слева — птица читается на его фоне, а не закрывает его
  const sx = w * 0.3, sy = horizon - h * 0.06;
  glow(B, sx, sy, h * 0.4, [255, 190, 110], 0.7);
  disc(B, sx, sy, h * 0.075, [255, 236, 200], 0.95);
  // Горные планы
  const ridge = (base, amp, col, seed, step) => {
    const pts = [];
    const r2 = mulberry32(seed);
    const peaks = [];
    for (let x = 0; x <= w; x += step) peaks.push(base - r2() * amp);
    for (let x = 0; x <= w; x += step) pts.push(x, peaks[x / step]);
    pts.push(w, h, 0, h);
    poly(B, pts, col);
  };
  ridge(horizon - 40, 130, [88, 60, 92], 11, 64);
  ridge(horizon + 10, 90, [52, 36, 62], 22, 48);
  // Симург: тело, шея, голова, раскрытые крылья, хвостовые ленты
  const bx = w * 0.5, by = h * 0.34, S = h / 720;
  const bird = [16, 20, 34];
  // Хвостовые ленты
  for (const off of [-1, -0.4, 0.3, 1]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(bx - 40 * S + off * 26 * S + t * 40 * S, by + 30 * S + t * (150 * S + off * 30 * S) + Math.sin(t * 5 + off) * 8 * S);
    }
    for (let i = pts.length - 2; i >= 0; i -= 2) pts.push(pts[i] + 10 * S, pts[i + 1] + 4 * S);
    poly(B, pts, bird, 0.95);
  }
  // Тело и шея + закатная окантовка груди
  poly(B, [bx - 44 * S, by + 34 * S, bx + 44 * S, by + 34 * S, bx + 30 * S, by - 60 * S, bx - 30 * S, by - 60 * S], bird);
  seg(B, bx + 44 * S, by + 34 * S, bx + 30 * S, by - 60 * S, 2.5, [255, 170, 100], 0.7);
  disc(B, bx, by - 78 * S, 22 * S, bird);
  seg(B, bx, by - 78 * S, bx + 26 * S, by - 88 * S, 10 * S, bird); // клюв
  disc(B, bx + 7 * S, by - 82 * S, 3.4 * S, GOLD_LIGHT, 0.95); // глаз
  // Крылья-веера: перья расходятся вверх и в стороны, выемки неглубокие
  for (const side of [-1, 1]) {
    const pts = [bx + side * 18 * S, by - 10 * S];
    const feathers = 5;
    for (let f = 0; f <= feathers; f++) {
      const t = f / feathers;
      const ang = (0.5 + t * 1.0) * side;
      const len = (165 - t * 55) * S;
      pts.push(bx + side * 18 * S + Math.sin(ang) * len, by - 10 * S - Math.cos(ang) * len);
      if (f < feathers) {
        const t2 = (f + 0.5) / feathers;
        const ang2 = (0.5 + t2 * 1.0) * side;
        const len2 = (165 - t2 * 55) * S * 0.8;
        pts.push(bx + side * 18 * S + Math.sin(ang2) * len2, by - 10 * S - Math.cos(ang2) * len2);
      }
    }
    poly(B, pts, bird, 0.95);
  }
  // Золотой контур птицы от заката
  glow(B, bx, by - 40 * S, 200 * S, [255, 170, 90], 0.28);
  // Падающие перья
  for (let n = 0; n < 40; n++) {
    const x = rnd() * w, y = rnd() * h;
    seg(B, x, y, x + 6 * S, y + 10 * S, 1.6, [240, 200, 150], 0.6);
  }
  birds(B, rnd, [[w * 0.16, h * 0.3, 7], [w * 0.22, h * 0.34, 6], [w * 0.8, h * 0.26, 7]], SILHOUETTE, 0.8);
  // Передний гребень
  poly(B, [0, h, 0, h - 60, w * 0.3, h - 110, w * 0.6, h - 70, w, h - 100, w, h], SILHOUETTE);
  grain(B, rnd, 12);
  vignette(B, 0.3);
  return B;
}

// ============================================================
// Запись PNG
// ============================================================
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function makePng(B) {
  const stride = B.w * 4;
  const raw = Buffer.alloc(B.h * (stride + 1));
  for (let y = 0; y < B.h; y++) {
    raw[y * (stride + 1)] = 0;
    B.buf.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(B.w, 0); ihdr.writeUInt32BE(B.h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── ПРЕДОХРАНИТЕЛЬ ────────────────────────────────────────────────────
// Этот скрипт НЕЛЬЗЯ запускать на текущем лендинге. Пояснение - ниже.
//
// Если иллюстрации всё-таки нужны как отдельные материалы: запускайте
// копию этого файла из другого каталога и поправьте выходной путь. Тогда
// они не перезапишут то, что уже отснято с настоящей игры.
process.exit(2);

// Дальше прежний код, и он недостижим намеренно. Удалять нельзя - на него
// ссылается сценарий трейлера, а переписывать целиком значит потерять
// нарисованное, если иллюстрации ещё понадобятся.
const root = path.resolve(__dirname, '..');
const shotsDir = path.join(root, 'client', 'web', 'assets', 'screenshots');
fs.mkdirSync(shotsDir, { recursive: true });

const jobs = [
  ['combat.png', () => sceneCombat(1280, 720)],
  ['isfahan.png', () => sceneIsfahan(1280, 720)],
  ['dungeon.png', () => sceneDungeon(1280, 720)],
  ['simurgh.png', () => sceneSimurgh(1280, 720)],
];
for (const [name, make] of jobs) {
  const png = makePng(make());
  const out = path.join(shotsDir, name);
  fs.writeFileSync(out, png);
  console.log('OK', path.relative(root, out), (png.length / 1024).toFixed(0) + ' KB');
}
const og = makePng(sceneIsfahan(1200, 630));
const ogOut = path.join(root, 'client', 'web', 'assets', 'og-screenshot.png');
fs.writeFileSync(ogOut, og);
console.log('OK', path.relative(root, ogOut), (og.length / 1024).toFixed(0) + ' KB');
console.log('Screenshots generation complete.');
