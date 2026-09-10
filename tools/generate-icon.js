// ============================================================
// Генератор иконки приложения game.ico — Empire of Safavids
// ============================================================
// Рисует восьмилучевую звезду Сефевидов (лазурит + золото +
// кызылбашский багрянец) в 256x256 PNG и упаковывает в ICO.
// Запуск: node tools/generate-icon.js
// (зависимостей нет: PNG собирается вручную через встроенный zlib)

'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

// ── Кисти ────────────────────────────────────────────────────
const LAPIS = [18, 26, 58];      // глубокий лазурит
const LAPIS_EDGE = [10, 15, 36];
const GOLD = [222, 178, 62];     // золото
const GOLD_LIGHT = [244, 210, 108];
const CRIMSON = [186, 42, 55];   // кызылбашский багрянец
const WHITE = [255, 246, 224];

function hexToRgb(hex) { return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]; }

/** Смешение цветов: t=0 → a, t=1 → b */
function mix(a, b, t) { return [0,1,2].map(i => Math.round(a[i] + (b[i]-a[i]) * Math.min(1, Math.max(0, t)))); }

/** Пиксельный буфер RGBA */
function makeBuffer() { return Buffer.alloc(SIZE * SIZE * 4); }

function setPx(buf, x, y, rgb, alpha = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const a = buf[i + 3];
  const na = alpha + (a * (255 - alpha)) / 255; // alpha-composite
  if (na <= 0) return;
  buf[i]   = Math.round((rgb[0] * alpha + buf[i]   * a * (1 - alpha/255)) / na);
  buf[i+1] = Math.round((rgb[1] * alpha + buf[i+1] * a * (1 - alpha/255)) / na);
  buf[i+2] = Math.round((rgb[2] * alpha + buf[i+2] * a * (1 - alpha/255)) / na);
  buf[i+3] = Math.round(na);
}

/** Точка внутри выпуклого многоугольника? */
function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; i += 2) {
    const xi = poly[i], yi = poly[i+1], xj = poly[j], yj = poly[j+1];
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

function draw() {
  const buf = makeBuffer();
  const C = SIZE / 2;

  // Фон: круг-медальон из лазурита с радиальным свечением
  const R_BG = 124;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - C, y - C);
      if (d <= R_BG) {
        const edge = Math.max(0, (d - R_BG + 14) / 14); // мягкий край
        const glow = Math.max(0, 1 - d / R_BG);
        const base = mix(LAPIS_EDGE, LAPIS, glow * 0.8);
        setPx(buf, x, y, base, Math.round(255 * (1 - edge * edge)));
      }
    }
  }

  // Тонкое золотое кольцо-оправа
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - C, y - C);
      if (d > R_BG - 8 && d < R_BG - 3) {
        const t = (Math.atan2(y - C, x - C) + Math.PI) / (Math.PI * 2);
        setPx(buf, x, y, mix(GOLD, GOLD_LIGHT, 0.5 + 0.5 * Math.sin(t * Math.PI * 12)), 235);
      }
    }
  }

  // Восьмилучевая звезда: два квадрата 45° друг к другу
  const sq1 = regular(C, C, 86, 4, -Math.PI / 2);
  const sq2 = regular(C, C, 86, 4, -Math.PI / 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (inPoly(x, y, sq1) || inPoly(x, y, sq2)) {
        // Обводка звезды
        const eps = 1.4;
        const nearEdge =
          !inPoly(x - eps, y, sq1) && !inPoly(x - eps, y, sq2) ||
          !inPoly(x + eps, y, sq1) && !inPoly(x + eps, y, sq2) ||
          !inPoly(x, y - eps, sq1) && !inPoly(x, y - eps, sq2) ||
          !inPoly(x, y + eps, sq1) && !inPoly(x, y + eps, sq2);
        if (nearEdge) {
          setPx(buf, x, y, GOLD, 255);
        } else {
          const d = Math.hypot(x - C, y - C) / 86;
          setPx(buf, x, y, mix(GOLD, GOLD_LIGHT, d * 0.7), 255);
        }
      }
    }
  }

  // Багряный круг в центре (кизилбашская звезда)
  const R_IN = 34;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - C, y - C);
      if (d <= R_IN) {
        setPx(buf, x, y, mix(CRIMSON, [220, 80, 90], Math.max(0, 1 - d / R_IN) * 0.5), 255);
      } else if (d <= R_IN + 4) {
        setPx(buf, x, y, GOLD, 255); // золотая кайма
      }
    }
  }

  // Малая белая восьмилучевая звезда в центре
  const small1 = regular(C, C, 24, 4, -Math.PI / 2);
  const small2 = regular(C, C, 24, 4, -Math.PI / 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (inPoly(x, y, small1) || inPoly(x, y, small2)) setPx(buf, x, y, WHITE, 255);
    }
  }

  return buf;
}

// ── PNG (вручную: IHDR + IDAT + IEND) ───────────────────────
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
  // Свободные строки: каждая начинается с байта фильтра 0
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 бит, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── ICO (PNG-внутри, поддерживается Vista+) ─────────────────
function makeIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0; entry[1] = 0;        // 256 → 0
  entry[2] = 0; entry[3] = 0;        // палитра не задана
  entry.writeUInt16LE(1, 4);         // planes
  entry.writeUInt16LE(32, 6);        // bpp
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);       // данные сразу после заголовка+entry
  return Buffer.concat([header, entry, png]);
}

// ── Запись файлов ────────────────────────────────────────────
const root = path.resolve(__dirname, '..');
const buf = draw();
const png = makePng(buf);
const ico = makeIco(png);

const targets = [
  path.join(root, 'client', 'web', 'favicon.ico'),
  path.join(root, 'install', 'game.ico'),
  path.join(root, 'client', 'web', 'assets', 'icon-256.png'),
];
for (const file of targets) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, file.endsWith('.png') ? png : ico);
  console.log('✓', path.relative(root, file));
}
console.log('Icon generation complete.');
