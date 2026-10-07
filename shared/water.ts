// ============================================================
// Вода мира — общий источник для клиента и сервера
// ============================================================
// ПОЧЕМУ ЭТОТ ФАЙЛ, А НЕ ДВЕ КОПИИ.
//
// До него вода была описана дважды: в client/src/app/game3d/terrain.ts
// (LAKE, POND, RIVER_A, RIVER_B, BRIDGES и маска воды для рисования) и в
// server/src/utils/spawn.ts (те же контуры для спасения из воды,
// рыбалки, лодок и ИИ водных монстров). Файл на сервере даже предупреждал:
// «при изменении террейна клиента обновить и здесь», но никакой проверки
// не было - и копии разошлись.
//
// Первая же попытка это доказать: море появилось в клиенте, и сервер о нём
// не узнал. Спасение из воды выкидывало бы игрока из залива на сушу, ИИ
// водных монстров не нашёл бы себе воду, лодки и рыбалка в море не работали
// бы. Теперь обе стороны импортируют это одно место, и проверка
// waterGeometry.test.ts сверяет, что сервер и клиент не разошлись.
//
// Шум (fract/hash2/vnoise/fbm) живёт здесь же, потому что линия берега
// моря неровная и должна считаться ОДИНАКОВО на клиенте и на сервере:
// иначе игрок, которого сервер считает стоящим в воде, на экране окажется
// на суше.

export const LAKE = { x: -420, z: -160, r: 170, level: -2.0 };
export const POND = { x: 620, z: 300, r: 70, level: -1.6 };

/** Река: хребет -> озеро; озеро -> оазис */
export const RIVER_A: { x: number; z: number }[] = [
  { x: -350, z: -575 }, { x: -368, z: -470 }, { x: -398, z: -310 }, { x: -412, z: -220 },
];
export const RIVER_B: { x: number; z: number }[] = [
  { x: -300, z: 20 }, { x: -140, z: 120 }, { x: 120, z: 200 }, { x: 380, z: 270 }, { x: 540, z: 292 },
];

/**
 * Мост: центр, ось, габариты и посадка настила.
 *
 * height лежит здесь, а не в клиентской копии, как и раньше: серверу
 * высота настила не нужна, но держать одно поле в одном месте дешевле,
 * чем следить за двумя копиями. slope появился вместе с дугой - без него
 * концы моста не садились бы на береги разной высоты.
 */
export interface BridgeDef {
  x: number; z: number;       // центр
  dx: number; dz: number;     // направление (нормализовано)
  length: number;             // длина
  width: number;              // ширина
  height: number;             // уровень настила на концах, м
  slope: number;              // уклон настила вдоль оси, подъём на метр
}

// ── Мосты ────────────────────────────────────────────────────
//
// ПЕРЕСЕКАЮТ РЕКУ ПОПЕРЁК, а не вдоль неё. Все три лежали вдоль: направление
// взято было от русла, а не поперёк ему - замер по оси моста давал 45-54 м
// воды при ширине русла 11-12 м, пролёт 14-18 м кончался на середине реки и
// никуда не вёл. Теперь центр - проекция на линию реки, ось - перпендикуляр
// руслу, концы на 12 м от оси: видимая вода (диски радиуса 8.5 вдоль ломаной)
// уходит внутрь, на концах обычная земля - водная маска 0.31, уже не дно, и
// по шесть метров берега с каждой стороны.
//
// Вторая половина той же правки - НАСТИЛ ДУГОЙ. Модель medieval-bridge
// арочная: замер профиля настила дал концы 0.278/0.316, корону 1.452 и
// подъём 1.155 в её же метрах. Ходить по ней надо по той же дуге, иначе
// игрок в середине моста висит над настилом, а у концов стоит в досках.
export const BRIDGE_ARCH_RISE = 1.155;  // на сколько середина выше концов, м
export const BRIDGE_DECK_END = 0.297;   // настил над основанием модели на концах, м
export const BRIDGE_SPAN = 10.1859;     // пролёт модели в её же метрах

/** Высота настила моста в точке, отстоящей на k метров вдоль оси
 *  (k < 0 - назад, против dx,dz). На концах дуга равна нулю и остаётся
 *  height - там игрок сходит с берега; в середине прибавляется подъём. */
export function bridgeDeckY(b: BridgeDef, k: number): number {
  const t = (2 * k) / b.length;
  return b.height + b.slope * k + BRIDGE_ARCH_RISE * (1 - t * t);
}

export const BRIDGES: BridgeDef[] = [
  // Исфахан: центр - проекция (-100,130) на RIVER_B, береги -2.00 / -1.95,
  // крен 0.13 градуса.
  { x: -100.65, z: 132.11, dx: -0.2941, dz: 0.9558, length: 24, width: 4.8, height: -1.975, slope: 0.0021 },
  // RIVER_A у входа в озеро: прежний центр (-405,-230) стоял ВНУТРИ озера
  // (LAKE r=170, до берега 72 м), мост переехал ниже по руслу в устье, где
  // это ещё русло, а не гладь; береги 0.88 / 0.33, крен 1.30 градуса.
  { x: -392.4, z: -339.9, dx: -0.9829, dz: -0.1843, length: 24, width: 4.8, height: 0.605, slope: -0.0229 },
  // Восточное пересечение RIVER_B на пути к караван-сараю: береги -0.78 /
  // -0.91, крен 0.30 градуса.
  { x: 320.29, z: 253.92, dx: -0.26, dz: 0.9656, length: 24, width: 4.8, height: -0.845, slope: -0.0054 },
];

/**
 * Море Персидского залива.
 *
 * ГЕОГРАФИЯ ПРИБЛИЗИТЕЛЬНАЯ, и это сказано прямо: полосы зон региона
 * persian_gulf выложены одна за другой по z (harbor -1100..-917, waters
 * -917..-733, islands -733..-550), и настоящий залив так не устроен. Берег
 * идёт волной по шуму, острова вырезаны из воды списком - чтобы игрок мог
 * дойти пешком с суши и не уйти в бесконечное плавание.
 *
 * ЧИСЛА ПОДОБРАНЫ ИЗМЕРЕНИЕМ, а не на глаз. Первая версия брала остров
 * радиусом 175 с мягким краем на 45% радиуса, и такой остров дотягивался
 * до z=-850, гася воду вне гавани: зона «Залив — воды» была мокрой
 * наполовину, а на z=-910 стояла суша.
 */
export const SEA = {
  level: -3.2,          // поверхность воды
  bed: -12.0,           // дно
  coast: -660,          // средняя линия берега по z: южнее - вода
  jitter: 60,           // размах берега
  ramp: 60,             // ширина полосы прибрежного перехода
  islandCore: 0.75,     // доля радиуса острова, где суша
  /** Ниже этой доли маски точка считается водой (как биом 'water'). */
  waterThreshold: 0.45,
};

export interface SeaIsland { x: number; z: number; r: number; имя: string }
export const SEA_ISLANDS: SeaIsland[] = [
  { x: 0,   z: -980, r: 120, имя: 'портовый остров' },
  { x: 60,  z: -600, r: 95,  имя: 'остров Рустама' },
  { x: 300, z: -650, r: 70,  имя: 'восточный риф' },
  { x: -350, z: -640, r: 60, имя: 'западный риф' },
];

// ── Шум ───────────────────────────────────────────────────────
function fract(v: number): number { return v - Math.floor(v); }
function hash2(x: number, y: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
}
function smoothstep(t: number): number { return t * t * (3 - 2 * t); }
function clamp01(v: number): number { return Math.min(1, Math.max(0, v)); }

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = smoothstep(xf), v = smoothstep(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Гладкий шум. Тот же, что в рельефе клиента, - иначе берег разойдётся. */
export function fbmWater(x: number, z: number): number {
  return 0.5 * vnoise(x / 96, z / 96) + 0.3 * vnoise(x / 38, z / 38) + 0.2 * vnoise(x / 14, z / 14);
}

// ── Геометрия воды ────────────────────────────────────────────
function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 === 0 ? 0 : ((px - ax) * abx + (pz - az) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t, cz = az + abz * t;
  return Math.hypot(px - cx, pz - cz);
}

/** Мосты — суша: лодка под мостом не пройдёт. */
export function onBridge(x: number, z: number): boolean {
  for (const b of BRIDGES) {
    const lx = (x - b.x) * b.dx + (z - b.z) * b.dz;
    const lz = -(x - b.x) * b.dz + (z - b.z) * b.dx;
    if (Math.abs(lx) < b.length / 2 && Math.abs(lz) < b.width / 2) return true;
  }
  return false;
}

/** Насколько точка под морем: 0 - суша, 1 - открытая гладь. */
export function seaMask(x: number, z: number): number {
  const берег = SEA.coast + (fbmWater(x / 220 + 31, z / 220 - 17) - 0.5) * 2 * SEA.jitter;
  let m = clamp01((берег - z) / SEA.ramp);
  if (m <= 0) return 0;
  for (const о of SEA_ISLANDS) {
    const d = Math.hypot(x - о.x, z - о.z);
    if (d < о.r) {
      m = Math.min(m, clamp01((d - о.r * SEA.islandCore) / (о.r * (1 - SEA.islandCore))));
    }
  }
  return m;
}

/** Остров, внутри которого точка, или null. */
export function seaIslandAt(x: number, z: number): SeaIsland | null {
  for (const о of SEA_ISLANDS) {
    if (Math.hypot(x - о.x, z - о.z) < о.r * SEA.islandCore) return о;
  }
  return null;
}

/** Общая маска воды: озеро, пруд, реки и море. */
export function waterMask(x: number, z: number): number {
  let m = 0;
  m = Math.max(m, clamp01(1 - Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.r));
  m = Math.max(m, clamp01(1 - Math.hypot(x - POND.x, z - POND.z) / POND.r));
  let близко = 1e9;
  for (const river of [RIVER_A, RIVER_B]) {
    for (let i = 0; i < river.length - 1; i++) {
      близко = Math.min(близко, distToSegment(x, z, river[i].x, river[i].z, river[i + 1].x, river[i + 1].z));
    }
  }
  m = Math.max(m, clamp01(1 - (близко - 3) / 13));
  m = Math.max(m, seaMask(x, z));
  return m;
}

/** Глубокая вода: место, где персонаж плавает, а не стоит. */
export function isDeepWater(x: number, z: number): boolean {
  if (onBridge(x, z)) return false;
  if (seaMask(x, z) > SEA.waterThreshold) return true;
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r - 5) return true;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r - 5) return true;
  for (const river of [RIVER_A, RIVER_B]) {
    for (let i = 0; i < river.length - 1; i++) {
      if (distToSegment(x, z, river[i].x, river[i].z, river[i + 1].x, river[i + 1].z) < 4) return true;
    }
  }
  return false;
}

/** Есть ли вода вообще, включая мелководье у берега. */
export function isWater(x: number, z: number): boolean {
  if (seaMask(x, z) > 0.05) return true;
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r) return true;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r) return true;
  for (const river of [RIVER_A, RIVER_B]) {
    for (let i = 0; i < river.length - 1; i++) {
      if (distToSegment(x, z, river[i].x, river[i].z, river[i + 1].x, river[i + 1].z) < 6) return true;
    }
  }
  return false;
}

/** Можно ли здесь поставить лодку. Мосты — суша. */
export function canFloatAt(x: number, z: number): boolean {
  if (onBridge(x, z)) return false;
  return isWater(x, z);
}