// ============================================================
// Генератор спрайтов v2 — «нарисованный» стиль — Empire of Safavids
// ============================================================
// Вместо квадратных тайлов — бесшовная текстура земли (value-noise
// с периодической решёткой), персонажи и монстры 64x64 с объёмной
// штриховкой, мягкими краями и обводкой. Декор: камни, кусты, трава.
// Результат: client/src/app/assets/sprites/*.png
// Запуск: node tools/generate-sprites.js

'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.resolve(__dirname, '..', 'client', 'src', 'app', 'assets', 'sprites');

// ── Палитра ──────────────────────────────────────────────────
const C = {
  skin: [228, 178, 132], skinDark: [188, 138, 98],
  hairDark: [44, 32, 26],
  gold: [201, 168, 76], goldLight: [244, 210, 108],
  crimson: [186, 42, 55], crimsonDark: [128, 26, 36],
  teal: [46, 139, 139], tealDark: [28, 92, 92],
  purple: [122, 95, 208], purpleDark: [80, 58, 150],
  green: [74, 168, 106], greenDark: [48, 116, 70],
  amber: [208, 168, 58], amberDark: [158, 124, 40],
  blue: [58, 143, 194], blueDark: [38, 100, 140],
  steel: [178, 184, 196], steelDark: [104, 110, 122],
  leather: [116, 86, 54], leatherDark: [76, 56, 34],
  white: [245, 240, 232], black: [18, 16, 20],
};

function mix(a, b, t) {
  t = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (t) => t * t * (3 - 2 * t);

/** Детерминированный ГПСЧ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Мини-холст с мягкой графикой ─────────────────────────────
class Px {
  constructor(size) {
    this.size = size;
    this.buf = Buffer.alloc(size * size * 4);
  }
  /** alpha-composite точка */
  px(x, y, [r, g, b], alpha = 255) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    const a = this.buf[i + 3];
    const na = alpha + (a * (255 - alpha)) / 255;
    if (na <= 0) return;
    this.buf[i] = (r * alpha + this.buf[i] * a * (1 - alpha / 255)) / na;
    this.buf[i + 1] = (g * alpha + this.buf[i + 1] * a * (1 - alpha / 255)) / na;
    this.buf[i + 2] = (b * alpha + this.buf[i + 2] * a * (1 - alpha / 255)) / na;
    this.buf[i + 3] = na;
  }
  /** Эллипс: мягкий край (feather px), обводка, горизонтальная светотень */
  ellipse(cx, cy, rx, ry, color, opts = {}) {
    const { feather = 1.4, outline = null, outlineW = 1.6, shade = 0.35 } = opts;
    const x0 = Math.floor(cx - rx - 2), x1 = Math.ceil(cx + rx + 2);
    const y0 = Math.floor(cy - ry - 2), y1 = Math.ceil(cy + ry + 2);
    const dark = mix(color, C.black, shade);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);          // 1 = край
        if (d > 1 + feather / Math.min(rx, ry)) continue;
        const edgePx = (1 - d) * Math.min(rx, ry);        // глубина внутри в px
        let c = mix(color, dark, clamp01((x + 0.5 - cx) / rx * 0.5 + 0.5) * shade);
        if (outline && edgePx < outlineW) c = outline;
        const a = clamp01(edgePx / feather) * 255;
        if (a > 0) this.px(x, y, c, a);
      }
    }
  }
  /** Мягкий вертикально-сужающийся «халат»: трапеция со скруглением */
  robe(cx, top, bottom, halfTop, halfBottom, color, opts = {}) {
    const { shade = 0.4 } = opts;
    const dark = mix(color, C.black, shade);
    for (let y = top; y <= bottom; y++) {
      const t = (y - top) / (bottom - top);
      const half = halfTop + (halfBottom - halfTop) * t;
      for (let x = Math.floor(cx - half - 1); x <= Math.ceil(cx + half + 1); x++) {
        const dx = Math.abs(x + 0.5 - cx) / half;
        if (dx > 1.12) continue;
        const edge = (1 - dx) * half;                     // px до края
        const c = mix(mix(color, dark, t * 0.45), dark, clamp01(dx) * 0.55);
        const a = clamp01(edge / 1.4) * 255;
        if (a > 0) this.px(x, y, c, a);
      }
    }
  }
  /** Тонкая линия (для травы, перьев) */
  line(x1, y1, x2, y2, color, w = 1.2) {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      for (let oy = -w; oy <= w; oy++) {
        for (let ox = -w; ox <= w; ox++) {
          if (ox * ox + oy * oy <= w * w) this.px(x + ox, y + oy, color, 235);
        }
      }
    }
  }
  toPng() { return encodePng(this.buf, this.size, this.size); }
}

// ── Земля: бесшовная текстура 512x512 ────────────────────────
function periodicGrid(n, seed) {
  const rnd = mulberry32(seed);
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return (x, y) => {
    // билинейная интерполяция с заворотом (бесшовность)
    const gx = x / (512 / n), gy = y / (512 / n);
    const x0 = Math.floor(gx) % n, y0 = Math.floor(gy) % n;
    const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const fx = gx - Math.floor(gx), fy = gy - Math.floor(gy);
    const v00 = g[y0 * n + x0], v10 = g[y0 * n + x1];
    const v01 = g[y1 * n + x0], v11 = g[y1 * n + x1];
    return mix2(mix2(v00, v10, fx), mix2(v01, v11, fx), fy);
  };
  function mix2(a, b, t) { return a + (b - a) * t; }
}

function buildGround() {
  const S = 512;
  const p = new Px(S);
  const n1 = periodicGrid(4, 11);    // крупные пятна биомов
  const n2 = periodicGrid(8, 23);
  const n3 = periodicGrid(16, 37);
  const fine = periodicGrid(64, 53); // зерно
  const peb = periodicGrid(48, 71);  // камешки

  const STONE = [72, 78, 92], SAND = [96, 84, 62], GRASS = [62, 78, 52];
  const SAND_LIGHT = [110, 96, 71], GRASS_LIGHT = [74, 92, 62];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const t = clamp01(0.52 * n1(x, y) + 0.28 * n2(x, y) + 0.2 * n3(x, y));
      let c;
      if (t < 0.42) c = mix(STONE, SAND, smooth(t / 0.42));           // каменистые проплешины
      else if (t < 0.6) c = mix(SAND, SAND_LIGHT, smooth((t - 0.42) / 0.18) * 0.6);
      else c = mix(SAND, GRASS, smooth((t - 0.6) / 0.4));             // травяные острова
      // трава чуть светлее на буграх
      if (t > 0.75) c = mix(c, GRASS_LIGHT, smooth((t - 0.75) / 0.25) * 0.5);
      // зерно яркости
      const b = (fine(x, y) - 0.5) * 0.16;
      c = [c[0] * (1 + b), c[1] * (1 + b), c[2] * (1 + b)];
      // редкие камешки
      if (peb(x, y) > 0.972) c = mix(c, STONE, 0.7);
      else if (peb(x, y) < 0.012) c = mix(c, C.black, 0.25);
      p.px(x, y, c);
    }
  }
  return p;
}

// ── Декор: камень, куст, трава ───────────────────────────────
function buildDecor() {
  // Камень
  const rock = new Px(64);
  rock.ellipse(30, 44, 17, 12, [92, 96, 108], { outline: [58, 62, 72], shade: 0.5 });
  rock.ellipse(42, 48, 10, 7, [104, 108, 120], { outline: [64, 68, 78], shade: 0.5 });
  rock.ellipse(24, 38, 6, 4, [126, 130, 142], { shade: 0.2 }); // блик

  // Куст (сухой, тёмная зелень)
  const bush = new Px(64);
  bush.ellipse(32, 44, 16, 11, [46, 62, 40], { outline: [30, 42, 26], shade: 0.45 });
  bush.ellipse(22, 38, 9, 7, [54, 72, 46], { shade: 0.35 });
  bush.ellipse(42, 39, 8, 6, [50, 66, 44], { shade: 0.35 });
  const brnd = mulberry32(5);
  for (let i = 0; i < 16; i++) {
    bush.px(18 + brnd() * 28, 34 + brnd() * 16, [86, 108, 70], 220);
  }

  // Пучок травы
  const grass = new Px(64);
  const grnd = mulberry32(9);
  for (let i = 0; i < 9; i++) {
    const x = 22 + i * 2.5 + grnd() * 2;
    const h = 12 + grnd() * 12;
    const lean = (grnd() - 0.5) * 8;
    grass.line(x, 52, x + lean, 52 - h, i % 2 ? [88, 110, 66] : [70, 92, 54], 1.1);
  }

  return { decor_rock: rock, decor_bush: bush, decor_grass: grass };
}

// ── Персонажи 64x64: объёмные, с оружием и головными уборами ──
function humanoid({ robe, robeDark, hat = null, hatColor = C.gold, weapon = null, belt = C.gold }) {
  const frames = [];
  for (let f = 0; f < 2; f++) {
    const p = new Px(64);
    const bob = f === 0 ? 0 : 1;          // покачивание корпуса
    const legSwing = f === 0 ? 3 : -3;    // шаг ногами

    // ноги (видны из-под халата)
    p.robe(28, 50 + bob, 60, 4, 3.2, robeDark, { shade: 0.25 });
    p.robe(37, 50 + bob, 60 + (f === 0 ? -2 : 0), 4, 3.2, robeDark, { shade: 0.25 });
    p.ellipse(28 - legSwing * 0.3, 60, 4.5, 3, C.hairDark, { shade: 0.3 });   // ступни
    p.ellipse(37 + legSwing * 0.3, 60 - (f === 0 ? 2 : 0), 4.5, 3, C.hairDark, { shade: 0.3 });

    // халат: расширяется книзу
    p.robe(32, 22 + bob, 54, 9, 14, robe, { shade: 0.42 });
    // пояс
    p.ellipse(32, 44 + bob, 12.5, 2.6, belt, { shade: 0.3 });
    p.px(32, 44 + bob, C.goldLight); // пряжка

    // руки
    p.ellipse(21, 34 + bob, 3.4, 8, robe, { outline: robeDark, shade: 0.4 });
    p.ellipse(43, 34 + bob, 3.4, 8, robe, { outline: robeDark, shade: 0.4 });
    p.ellipse(21, 43 + bob, 2.6, 2.6, C.skin, { shade: 0.2 });   // кисти
    p.ellipse(43, 43 + bob, 2.6, 2.6, C.skin, { shade: 0.2 });

    // голова
    p.ellipse(32, 15 + bob, 8.6, 9, C.skin, { outline: C.skinDark, shade: 0.28 });
    // глаза + брови
    p.px(29, 15 + bob, C.hairDark); p.px(30, 15 + bob, C.hairDark);
    p.px(34, 15 + bob, C.hairDark); p.px(35, 15 + bob, C.hairDark);
    // борода (лёгкая тень подбородка)
    p.ellipse(32, 21 + bob, 4.5, 2.2, C.hairDark, { shade: 0 });

    // головной убор
    if (hat === 'turban') {
      p.ellipse(32, 9 + bob, 10, 5.4, hatColor, { outline: mix(hatColor, C.black, 0.35), shade: 0.3 });
      p.ellipse(32, 6 + bob, 6, 3, hatColor, { shade: 0.25 });
      p.ellipse(32, 11.5 + bob, 10, 1.4, C.gold, { shade: 0.2 });
    } else if (hat === 'helmet') {
      p.ellipse(32, 9 + bob, 10, 7, hatColor, { outline: C.steelDark, shade: 0.4 });
      p.robe(32, 2 + bob, 6 + bob, 1.6, 1.6, hatColor, { shade: 0.3 });    // гребень
      p.ellipse(32, 15 + bob, 10, 1.6, C.steelDark, { shade: 0.3 });       // обод
    } else if (hat === 'hood') {
      p.ellipse(32, 12 + bob, 11, 10, hatColor, { outline: mix(hatColor, C.black, 0.4), shade: 0.4 });
      p.ellipse(32, 17 + bob, 7.4, 6, C.skinDark, { shade: 0.35 });        // тень лица
      p.ellipse(32, 15.5 + bob, 6.4, 5, C.skin, { shade: 0.2 });
    } else if (hat === 'cap') {
      p.ellipse(32, 9 + bob, 9.4, 4.6, hatColor, { outline: mix(hatColor, C.black, 0.35), shade: 0.35 });
      p.ellipse(41, 9.5 + bob, 3, 1.4, hatColor, { shade: 0.2 });          // козырёк
    }

    // оружие
    if (weapon) weapon(p, bob);
    frames.push(p);
  }
  return frames;
}

// Оружие (правая рука, x≈47)
const wSword = (p, bob) => {
  p.robe(47, 10 + bob, 40, 1.9, 1.2, C.steel, { shade: 0.45 });   // клинок сужается
  p.ellipse(47, 42 + bob, 4.5, 1.6, C.gold, { shade: 0.25 });     // гарда
  p.robe(47, 43 + bob, 50, 1.4, 1.4, C.leatherDark, { shade: 0.2 });
  p.ellipse(47, 51 + bob, 2, 2, C.gold, { shade: 0.2 });          // навершие
};
const wStaff = (p, bob) => {
  p.robe(47, 8 + bob, 54, 1.6, 1.6, C.leatherDark, { shade: 0.3 });
  p.ellipse(47, 7 + bob, 4.6, 4.6, C.teal, { outline: C.tealDark, shade: 0.25 });
  p.ellipse(45.6, 5.6 + bob, 1.6, 1.6, [160, 230, 230], { shade: 0 }); // блик сферы
};
const wBow = (p, bob) => {
  // дуга лука
  for (let t = -1.2; t <= 1.2; t += 0.05) {
    const x = 48 + Math.cos(t) * 3.2, y = 28 + bob + Math.sin(t) * 13;
    p.px(x, y, C.leatherDark, 235);
    p.px(x + 1, y, mix(C.leatherDark, C.black, 0.3), 200);
  }
  p.line(46, 15 + bob, 46, 41 + bob, C.white, 0.7);                // тетива
};
const wDagger = (p, bob) => {
  p.robe(47, 26 + bob, 40, 1.7, 0.9, C.steel, { shade: 0.45 });
  p.ellipse(47, 42 + bob, 3.4, 1.4, C.gold, { shade: 0.25 });
  p.ellipse(47, 45 + bob, 1.7, 2, C.leatherDark, { shade: 0.2 });
};
const wRapier = (p, bob) => {
  p.robe(47, 8 + bob, 42, 1.2, 0.7, C.steel, { shade: 0.4 });     // тонкий клинок
  p.ellipse(47, 43 + bob, 4.6, 2.4, C.gold, { outline: C.amberDark, shade: 0.3 }); // чашка
  p.robe(47, 45 + bob, 51, 1.3, 1.3, C.leatherDark, { shade: 0.2 });
};

function buildCharacters() {
  return {
    char_qizilbash: { frames: humanoid({ robe: C.crimson, robeDark: C.crimsonDark, hat: 'helmet', hatColor: C.steel, weapon: wSword }) },
    char_sufi_mystic: { frames: humanoid({ robe: C.purple, robeDark: [64, 46, 122], hat: 'turban', hatColor: C.teal, weapon: wStaff }) },
    char_persian_archer: { frames: humanoid({ robe: C.green, robeDark: C.greenDark, hat: 'hood', hatColor: C.leather, weapon: wBow }) },
    char_bazaar_merchant: { frames: humanoid({ robe: C.amber, robeDark: C.amberDark, hat: 'turban', hatColor: C.white, weapon: wDagger }) },
    char_court_diplomat: { frames: humanoid({ robe: C.blue, robeDark: C.blueDark, hat: 'cap', hatColor: C.steel, weapon: wRapier }) },
  };
}

// ── Монстры 64x64 ────────────────────────────────────────────
function buildMonsters() {
  const bandit = (robe, robeDark, hatColor) =>
    humanoid({ robe, robeDark, hat: 'hood', hatColor, weapon: wSword });

  return {
    mon_bandit_scout: { frames: bandit([96, 82, 66], [64, 54, 44], C.leatherDark) },
    mon_bandit_warrior: { frames: bandit([76, 66, 60], [48, 42, 38], C.black) },
    mon_ottoman_janissary: { frames: humanoid({ robe: [66, 100, 76], robeDark: [44, 68, 52], hat: 'cap', hatColor: C.white, weapon: wSword }) },
    mon_mongol_raider: { frames: humanoid({ robe: [88, 70, 54], robeDark: [60, 48, 38], hat: 'helmet', hatColor: C.leatherDark, weapon: wBow }) },
    mon_div_fire: { frames: (() => {
      const frames = [];
      for (let f = 0; f < 2; f++) {
        const p = new Px(64);
        const wob = f === 0 ? 0 : 1.6;
        // массивное тело
        p.ellipse(32, 38, 19, 16, [186, 62, 30], { outline: [122, 36, 18], shade: 0.45 });
        p.ellipse(32, 24, 13, 10, [204, 84, 36], { outline: [130, 44, 20], shade: 0.4 });
        // рога
        p.line(24, 18, 18, 8, C.gold, 2.2); p.line(40, 18, 46, 8, C.gold, 2.2);
        p.px(17, 7, C.goldLight); p.px(47, 7, C.goldLight);
        // глаза с огнём
        p.ellipse(27, 24, 2.6, 2, C.goldLight, { shade: 0 });
        p.ellipse(37, 24, 2.6, 2, C.goldLight, { shade: 0 });
        // лапы
        p.ellipse(24, 54, 5, 4, [140, 44, 22], { shade: 0.4 });
        p.ellipse(40, 54, 5, 4, [140, 44, 22], { shade: 0.4 });
        // огненный нимб (мягкие искры)
        const rnd = mulberry32(7 + f);
        for (let i = 0; i < 26; i++) {
          const a = rnd() * Math.PI * 2, r = 24 + rnd() * 7;
          const c = rnd() > 0.5 ? [240, 170, 60] : [230, 110, 40];
          p.px(32 + Math.cos(a) * r, 36 + Math.sin(a) * r * 0.8 + wob, c, 160);
        }
        frames.push(p);
      }
      return frames;
    })() },
    mon_simurgh: { frames: (() => {
      const frames = [];
      for (let f = 0; f < 2; f++) {
        const p = new Px(64);
        const flap = f === 0 ? 0 : 5;
        // крылья
        p.ellipse(14, 26 - flap, 15, 6.5, C.gold, { outline: [150, 120, 44], shade: 0.4 });
        p.ellipse(50, 26 - flap, 15, 6.5, C.gold, { outline: [150, 120, 44], shade: 0.4 });
        // тело
        p.ellipse(32, 36, 10, 15, C.goldLight, { outline: C.gold, shade: 0.3 });
        // голова
        p.ellipse(32, 18, 7.5, 7, C.goldLight, { outline: C.gold, shade: 0.25 });
        p.robe(38, 16, 19, 4.5, 1.2, [222, 160, 64], { shade: 0.3 });  // клюв
        p.px(30, 17, C.hairDark); p.px(33, 17, C.hairDark);
        // хвост: три длинных пера
        p.line(27, 50, 20, 62, C.teal, 2.4);
        p.line(32, 52, 32, 63, C.gold, 2.6);
        p.line(37, 50, 44, 62, C.crimson, 2.4);
        // лапы
        p.line(28, 50, 27, 58, [190, 140, 66], 2);
        p.line(36, 50, 37, 58, [190, 140, 66], 2);
        frames.push(p);
      }
      return frames;
    })() },
  };
}

// ── PNG ──────────────────────────────────────────────────────
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
function encodePng(rgba, w, h) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Запись ───────────────────────────────────────────────────
// Старые тайлы больше не нужны
for (const old of ['tile_sand', 'tile_grass', 'tile_stone', 'tile_road']) {
  const f = path.join(OUT, old + '.png');
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

fs.mkdirSync(OUT, { recursive: true });
let count = 0;
const write = (name, pxObj) => {
  fs.writeFileSync(path.join(OUT, name + '.png'), pxObj.toPng());
  count++;
};

write('ground', buildGround());
for (const [name, d] of Object.entries(buildDecor())) write(name, d);
for (const [name, spr] of Object.entries(buildCharacters())) {
  spr.frames.forEach((f, i) => write(`${name}_${i}`, f));
}
for (const [name, spr] of Object.entries(buildMonsters())) {
  spr.frames.forEach((f, i) => write(`${name}_${i}`, f));
}
console.log(`✓ ${count} файлов (земля + декор + персонажи + монстры) в ${path.relative(process.cwd(), OUT)}`);
