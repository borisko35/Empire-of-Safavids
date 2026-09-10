// ============================================================
// Генератор исторического фона — Empire of Safavids
// ============================================================
// Рисует ночной Исфахан золотого века: лазуритовое небо со
// звёздами, бирюзовое свечение над куполом, силуэт Шахской
// мечети с минаретами и крепостными стенами, орнаментальные
// полосы с восьмилучевыми звёздами (палитра docs/art-direction.md).
// Результат: client/web/assets/bg-history.png (1920x1080 RGBA).
// Запуск: node tools/generate-background.js (зависимостей нет).

'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 1920;
const H = 1080;

// ── Палитра (art-direction.md) ───────────────────────────────
const SKY_TOP = [13, 27, 42];     // #0D1B2A тёмно-синий фон
const SKY_MID = [22, 42, 64];
const SKY_LOW = [35, 62, 88];     // светлее к горизонту
const TEAL = [46, 139, 139];      // #2E8B8B акцент
const GOLD = [201, 168, 76];      // #C9A84C примарный
const GOLD_LIGHT = [244, 210, 108];
const CRIMSON = [139, 26, 26];    // #8B1A1A багровый
const SILHOUETTE = [7, 13, 24];   // почти чёрный силуэт города
const BAND = [9, 18, 32];         // орнаментальная полоса
const CREAM = [245, 240, 232];    // #F5F0E8 текст/звёзды

function mix(a, b, t) {
  t = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Детерминированный ГПСЧ (mulberry32) — одинаковые звёзды при каждом запуске */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Точка внутри выпуклого многоугольника [x0,y0,x1,y1,...] */
function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside;
    j = i;
  }
  return inside;
}

/** Вершины правильного N-угольника */
function regular(cx, cy, r, n, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}

// ── Силуэт города ────────────────────────────────────────────
// Компоновка: Шахская мечеть в центре (купол + барабан + айван),
// два минарета, по сторонам — стены с зубцами и городские постройки.
const GROUND = 940;          // линия земли (верх стен)
const BOTTOM = 1010;         // низ построек (ниже — дымка)

const DOME_CX = 960;
const DOME_R = 150;          // радиус купола
const DOME_TOP = 620;        // вершина купола
const DOME_BASE = 790;       // основание купола
const DRUM_HALF = 108;       // полуширина барабана
const DRUM_BOTTOM = 830;
const MASS_HALF = 175;       // полуширина основного массива
const IWAN_HALF = 52;        // полуширина портала-айвана
const IWAN_TOP = 828;        // вершина стрельчатой арки портала
const MINARET_X = [700, 1220];
const MINARET_HALF = 13;
const MINARET_TOP = 545;
const CAP_TOP = 498;

/** Внутри силуэта города? (без стен-зубцов, они ниже) */
function inCity(x, y) {
  // Основной массив мечети; айван-портал оставляем сплошным —
  // тёплый интерьер арки рисуется отдельным цветом при заливке
  if (y >= DRUM_BOTTOM && y <= BOTTOM && Math.abs(x - DOME_CX) <= MASS_HALF) return true;
  // Барабан под куполом
  if (y >= DOME_BASE - 6 && y <= DRUM_BOTTOM && Math.abs(x - DOME_CX) <= DRUM_HALF) return true;
  // Купол: слегка заострённый полуовал (луковица)
  if (y >= DOME_TOP && y <= DOME_BASE) {
    const t = (y - DOME_TOP) / (DOME_BASE - DOME_TOP);
    const halfR = DOME_R * Math.pow(Math.sin(Math.min(1, t) * Math.PI / 2), 0.72);
    if (Math.abs(x - DOME_CX) <= halfR) return true;
  }
  // Шпиль над куполом
  if (y >= DOME_TOP - 26 && y < DOME_TOP && Math.abs(x - DOME_CX) <= 3 + (DOME_TOP - y) * 0.12) return true;
  // Минареты: ствол, балконы, шатёр (остриё вверх)
  for (const mx of MINARET_X) {
    const dx = Math.abs(x - mx);
    if (y >= MINARET_TOP && y <= BOTTOM && dx <= MINARET_HALF) return true;
    if ((y >= 610 && y <= 622) || (y >= 660 && y <= 672)) { if (dx <= MINARET_HALF + 9) return true; }
    if (y >= CAP_TOP && y < MINARET_TOP && dx <= MINARET_HALF * (y - CAP_TOP) / (MINARET_TOP - CAP_TOP)) return true;
    if (y >= CAP_TOP - 12 && y < CAP_TOP && dx <= 2) return true; // шпиль
  }
  // Стены с зубцами (мерлоны через равные промежутки)
  if (y >= GROUND && y <= BOTTOM) {
    if (y >= GROUND + 16) return true;
    const merlon = 22, gap = 18, period = merlon + gap;
    if (((x % period) + period) % period < merlon) return true;
  }
  // Боковые постройки с малыми куполами
  const blocks = [
    { x0: 240, x1: 470, top: 868, domeCx: 355, domeR: 52, domeBase: 868 },
    { x0: 540, x1: 660, top: 896, domeCx: 0, domeR: 0, domeBase: 0 },
    { x0: 1450, x1: 1680, top: 868, domeCx: 1565, domeR: 52, domeBase: 868 },
    { x0: 1290, x1: 1410, top: 896, domeCx: 0, domeR: 0, domeBase: 0 },
  ];
  for (const b of blocks) {
    if (x >= b.x0 && x <= b.x1 && y >= b.top && y <= BOTTOM) return true;
    if (b.domeR && y >= b.domeBase - b.domeR && y <= b.domeBase) {
      // Купол: остриё сверху, максимальная ширина у основания
      const t = (y - (b.domeBase - b.domeR)) / b.domeR;
      const halfR = b.domeR * Math.pow(Math.sin(Math.min(1, t) * Math.PI / 2), 0.72);
      if (Math.abs(x - b.domeCx) <= halfR) return true;
    }
  }
  return false;
}

function draw() {
  const buf = Buffer.alloc(W * H * 4);

  // Маска силуэта: 1 байт на пиксель
  const mask = new Uint8Array(W * H);
  for (let y = CAP_TOP - 14; y < BOTTOM; y++) {
    for (let x = 0; x < W; x++) {
      if (inCity(x, y)) mask[y * W + x] = 1;
    }
  }

  // ── Небо: градиент + бирюзовое свечение над куполом ────────
  for (let y = 0; y < H; y++) {
    const t = y / H;
    let sky;
    if (t < 0.55) sky = mix(SKY_TOP, SKY_MID, t / 0.55);
    else sky = mix(SKY_MID, SKY_LOW, (t - 0.55) / 0.45);

    for (let x = 0; x < W; x++) {
      let c = sky;
      // Мягкое свечение вокруг мечети (лунный свет на бирюзе)
      const d = Math.hypot(x - DOME_CX, y - (DOME_TOP + 120)) / 560;
      if (d < 1) c = mix(c, TEAL, 0.14 * Math.pow(1 - d, 2));
      // Тёплый отсвет горизонта
      const warm = Math.max(0, 1 - Math.hypot(x - DOME_CX, y - GROUND) / 420);
      if (warm > 0) c = mix(c, CRIMSON, 0.10 * warm * warm);
      const i = (y * W + x) * 4;
      buf[i] = Math.round(c[0]); buf[i + 1] = Math.round(c[1]); buf[i + 2] = Math.round(c[2]); buf[i + 3] = 255;
    }
  }

  // ── Звёзды (детерминированные) ──────────────────────────────
  const rnd = mulberry32(15011901); // год основания империи
  for (let n = 0; n < 460; n++) {
    const sx = Math.floor(rnd() * W);
    const sy = Math.floor(rnd() * GROUND * 0.78);
    const bright = 0.25 + rnd() * 0.65;
    const big = rnd() > 0.93;
    const r = big ? 1.6 : 1.0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const px = sx + dx, py = sy + dy;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const i = (py * W + px) * 4;
        const a = bright * (big ? 0.9 : 0.75) * (d === 0 ? 1 : 0.5);
        const c = mix([buf[i], buf[i + 1], buf[i + 2]], big ? GOLD_LIGHT : CREAM, a);
        buf[i] = Math.round(c[0]); buf[i + 1] = Math.round(c[1]); buf[i + 2] = Math.round(c[2]);
      }
    }
  }

  // ── Силуэт города + золотая кайма по верхнему краю ─────────
  for (let y = CAP_TOP - 14; y < BOTTOM; y++) {
    for (let x = 0; x < W; x++) {
      const m = y * W + x;
      if (!mask[m]) continue;
      const i = m * 4;
      // Вертикальный градиент силуэта: сверху чуть светлее
      const g = Math.min(1, (y - CAP_TOP + 14) / (BOTTOM - CAP_TOP));
      let c = mix([16, 28, 46], SILHOUETTE, 0.35 + 0.65 * g);
      // Тёплый интерьер портала-айвана (стрельчатая арка, свет внизу)
      const ax = Math.abs(x - DOME_CX);
      const archTop = IWAN_TOP + ax * 0.9;
      if (ax <= IWAN_HALF && y >= archTop && y < GROUND) {
        const t = Math.min(1, (y - archTop) / (GROUND - archTop));
        c = mix([26, 22, 18], [122, 78, 34], 0.2 + 0.6 * t);
      }
      // Золотой контур: сосед по вертикали/горизонтали вне силуэта
      const edge =
        (y > 0 && !mask[m - W]) || (y < H - 1 && !mask[m + W]) ||
        (x > 0 && !mask[m - 1]) || (x < W - 1 && !mask[m + 1]);
      if (edge) c = mix(GOLD, GOLD_LIGHT, 0.35 + 0.3 * Math.sin(y / 40));
      buf[i] = Math.round(c[0]); buf[i + 1] = Math.round(c[1]); buf[i + 2] = Math.round(c[2]);
    }
  }

  // Окна города: тёплые огни в стенах и постройках
  const wrnd = mulberry32(1736);
  for (let n = 0; n < 46; n++) {
    const wx = Math.floor(wrnd() * W);
    const wy = GROUND + 20 + Math.floor(wrnd() * (BOTTOM - GROUND - 30));
    if (!mask[wy * W + wx]) continue;
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const px = wx + dx, py = wy + dy;
        if (px >= W || py >= H || !mask[py * W + px]) continue;
        const i = (py * W + px) * 4;
        const c = mix([buf[i], buf[i + 1], buf[i + 2]], GOLD_LIGHT, 0.8);
        buf[i] = Math.round(c[0]); buf[i + 1] = Math.round(c[1]); buf[i + 2] = Math.round(c[2]);
      }
    }
  }

  // ── Дымка у земли ────────────────────────────────────────────
  for (let y = GROUND - 40; y < H; y++) {
    const t = (y - (GROUND - 40)) / (H - GROUND + 40);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const c = mix([buf[i], buf[i + 1], buf[i + 2]], SILHOUETTE, 0.55 * Math.pow(t, 1.4));
      buf[i] = Math.round(c[0]); buf[i + 1] = Math.round(c[1]); buf[i + 2] = Math.round(c[2]);
    }
  }

  // ── Орнаментальные полосы: восьмилучевые звёзды ─────────────
  drawOrnament(buf, 0, 58, true);
  drawOrnament(buf, H - 46, 46, false);

  // ── Виньетка ─────────────────────────────────────────────────
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = x / W * 2 - 1, ny = y / H * 2 - 1;
      const v = 1 - 0.28 * Math.pow(Math.min(1, Math.hypot(nx, ny) / 1.42), 2);
      const i = (y * W + x) * 4;
      buf[i] = Math.round(buf[i] * v); buf[i + 1] = Math.round(buf[i + 1] * v); buf[i + 2] = Math.round(buf[i + 2] * v);
    }
  }

  return buf;
}

/** Полоса орнамента: лазуритовая лента с золотыми 8-конечными звёздами */
function drawOrnament(buf, y0, height, isTop) {
  const starR = Math.min(15, height * 0.34);
  const period = 52;
  for (let y = y0; y < y0 + height; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let c = BAND;
      // Тонкие золотые линии по краям ленты
      const fromTop = y - y0;
      const fromBottom = y0 + height - 1 - y;
      if (fromTop === 0 || fromBottom === 0) c = mix(GOLD, GOLD_LIGHT, 0.4);
      else if (fromTop <= 2 || fromBottom <= 2) c = mix(GOLD, BAND, 0.55);
      else {
        // Звёзды в шахматном ряду
        const row = Math.floor(x / period);
        const cx = row * period + period / 2;
        const cy = y0 + height / 2 + (row % 2 ? 0 : 0); // один ряд, простота
        // Восьмилучевая звезда = два квадрата, повёрнутые на 45°
        const s1 = regular(cx, cy, starR, 4, -Math.PI / 2);
        const s2 = regular(cx, cy, starR, 4, -Math.PI / 4);
        if (inPoly(x, y, s1) || inPoly(x, y, s2)) c = mix(GOLD, GOLD_LIGHT, 0.5);
        // Ромбики между звёздами
        const mx = row * period + period;
        const my = cy;
        if (Math.abs(x - mx) + Math.abs(y - my) < 4) c = mix(GOLD, GOLD_LIGHT, 0.3);
      }
      // Альфа-смешение с фоном: лента полупрозрачна по внутреннему краю
      const blend = isTop
        ? (fromBottom <= 6 ? (6 - fromBottom) / 6 * 0.5 : 1)
        : (fromTop <= 6 ? (6 - fromTop) / 6 * 0.5 : 1);
      const f = mix([buf[i], buf[i + 1], buf[i + 2]], c, blend);
      buf[i] = Math.round(f[0]); buf[i + 1] = Math.round(f[1]); buf[i + 2] = Math.round(f[2]);
    }
  }
}

// ── PNG (вручную: IHDR + IDAT + IEND) — как в generate-icon.js ──
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

function makePng(rgba) {
  const stride = W * 4;
  const raw = Buffer.alloc(H * (stride + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 бит, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = path.resolve(__dirname, '..');
const png = makePng(draw());
const out = path.join(root, 'client', 'web', 'assets', 'bg-history.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('✓', path.relative(root, out), (png.length / 1024 / 1024).toFixed(2) + ' MB');
console.log('Background generation complete.');
