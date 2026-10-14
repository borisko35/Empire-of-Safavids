// Контактный лист HDRI-окружения: PNG для просмотра глазами.
//
// ЗАЧЕМ, ЕСЛИ ЕСТЬ ПРОБНИК. Пробник меряет числа: яркость неба, отношение
// неба и песка, наличие ключевого света. Он не показывает ПОЛОСЫ на градиенте,
// не показывает, где горизонт выглядит грязным, и не показывает, что солнце
// съело полнеба. Для этого нужна картинка.
//
// Рендер здесь честный в том смысле, что важен: та же карта, тот же
// тонмаппинг ACES и то же sRGB-преобразование, что в игре. Разница одна —
// здесь нет геометрии.
//
// ЗАПУСК: из client/ →  npx tsx tools/export-sky-sheet.ts
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import {
  ISFAHAN_DESERT,
  buildEquirect,
  type SkyState,
} from '../src/app/game3d/skyEnvironmentMath';

type Vec3 = [number, number, number];

// ── Мини-энкодер PNG. В проекте нет pngjs, а писать картинку ради проверки
//    одной строкой через zlib — стандартный приём: PNG это zlib-архив
//    отфильтрованных строк плюс CRC. ────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(тип: string, данные: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(данные.length, 0);
  const тело = Buffer.concat([Buffer.from(тип, 'ascii'), данные]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(тело), 0);
  return Buffer.concat([len, тело, crc]);
}

/** RGB8-данные → файл PNG. */
function writePng(файл: string, w: number, h: number, rgb: Uint8Array): void {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // глубина
  ihdr[9] = 2;    // тип: truecolor
  // Фильтр 0 (None) на каждой строке — проще и для градиента достаточно.
  const строки = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    const начало = y * (w * 3 + 1);
    строки[начало] = 0;
    Buffer.from(rgb.subarray(y * w * 3, (y + 1) * w * 3)).copy(строки, начало + 1);
  }
  writeFileSync(файл, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(строки, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ── Тонмаппинг как в игре ──────────────────────────────────────────────────
/** ACES, приближённая версия Three.js: та же кривая, что в рендерере. */
function aces(x: number): number {
  const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return Math.min(1, Math.max(0, (x * (a * x + b)) / (x * (c * x + d) + e)));
}

const toSRGB = (v: number): number => {
  const c = Math.min(1, Math.max(0, v));
  return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
};

function солнце(высота: number, азимут: number): Vec3 {
  const гориз = Math.sqrt(Math.max(0, 1 - высота * высота));
  return [гориз * Math.cos(азимут), высота, гориз * Math.sin(азимут)];
}

const norm = (v: Vec3): Vec3 => {
  const d = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / d, v[1] / d, v[2] / d];
};

const state = (sunHeight: number, night: number, overcast: number, azimuth = 0): SkyState => {
  const s = солнце(sunHeight, azimuth);
  return { sun: s, moon: norm([-s[0], -s[1], -s[2]]), sunHeight, night, overcast };
};

const МОМЕНТЫ: { имя: string; s: SkyState }[] = [
  { имя: 'полдень, ясно', s: state(0.92, 0, 0) },
  { имя: 'рассвет', s: state(0.2, 0.2, 0, 1.2) },
  { имя: 'закат', s: state(0.1, 0.3, 0) },
  { имя: 'сумерки', s: state(-0.06, 0.8, 0.05) },
  { имя: 'ночь', s: state(-0.45, 1, 0) },
  { имя: 'полдень, буря', s: state(0.92, 0, 1) },
];

// Полоса неба во всю ширину: 512×64 на момент. Шесть полос в одном листе.
const W = 512;
const H = 64;
const ШАГ = 6;
const лист = new Uint8Array(W * H * ШАГ * 3);

МОМЕНТЫ.forEach((момент, индекс) => {
  const карта = buildEquirect(ISFAHAN_DESERT, момент.s, W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const src = (y * W + x) * 3;
      const dst = ((индекс * H + y) * W + x) * 3;
      for (let k = 0; k < 3; k++) {
        лист[dst + k] = toSRGB(aces(карта.data[src + k]));
      }
    }
  }
});

writePng('sky-sheet.png', W, H * ШАГ, лист);
console.log('файл: sky-sheet.png, полос: ' + ШАГ);
console.log('сверху вниз: ' + МОМЕНТЫ.map((м) => м.имя).join(' | '));
console.log('тонмаппинг: ACES, как в игре. Солнце должно быть маленьким ярким пятном,');
console.log('небо — без белой заливки, горизонт — без полос.');