// ============================================================
// 3D-мир: рельеф, биомы, вода, города — Empire of Safavids
// ============================================================
// Бесшовный ландшафт 6350x6350: поля вокруг Исфахана, пустыня с
// дюнами на востоке, лес на северо-западе, северный хребет со
// снежными шапками, озеро с рекой и водопадом. Биомы красят рельеф
// и выбирают флору/фауну. groundHeight() — единственный источник
// высоты для сущностей: билинейная интерполяция видимого меша
// + плита городской площади (иначе персонажи проваливаются).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { clone as копияСкелета } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  sandTexture, plasterTexture, stoneTexture, mosaicTexture, plazaTexture, woodTexture,
  waterTexture, waterfallTexture,
} from './textures';
import { t } from '../i18n';
import { GATE_STELES, inscriptionFor, steleMesh } from './inscriptions';

// Половина стороны мира. Мир 6350x6350 единиц - в семь раз больше прежних
// 2400x2400 по площади, как и просили: (6350/2400)^2 = 7.000.
//
// ЧИСЛО ВЗЯТО ИЗ КОРНЯ, А НЕ ОКРУГЛЕНО. 3175 = 1200 * sqrt(7) = 3174.9.
// Круглое 3200 дало бы (6400/2400)^2 = 7.111 - и проверка «мир стал в семь
// раз больше» перестала бы проверять что-либо. Первую версию этого
// комментария я написал с числом 7.005: арифметика была неверна,
// (6350/2400)^2 равно 7.000, и ошибку поймала проверка, а не глаз.
export const WORLD_HALF = 3175;         // половина стороны мира

/** Половина стороны СТАРОГО мира: 2400x2400. Граница, за которой
 *  начинается рельеф. Внутри него мир сделан руками и не трогается. */
export const СТАРЫЙ_МИР = 1200;
export const CITY = { x: 34, z: 26, radius: 116 }; // Столица: радиус x2 = площадь x4
export const CAMP = { x: 167, z: 132, radius: 16 }; // Полевой лагерь ВНЕ стен (город r=116)

// ── Вода и достопримечательности ─────────────────────────────
// Вода описана в ОДНОМ месте — shared/water.ts. До этого контуры были
// продублированы здесь и на сервере (utils/spawn.ts), и копии разошлись:
// море появилось в клиенте, а сервер о нём не узнал. Реэкспорт нужен для
// существующих потребителей, которые берут LAKE и реки из terrain.ts.
import {
  LAKE, POND, RIVER_A, RIVER_B, BRIDGES, SEA, SEA_ISLANDS,
  seaMask, seaIslandAt, waterMask, isWater, isDeepWater, canFloatAt,
} from '../../../../shared/water';
export {
  LAKE, POND, RIVER_A, RIVER_B, BRIDGES, SEA, SEA_ISLANDS,
  seaMask, seaIslandAt, waterMask, isWater, isDeepWater, canFloatAt,
};

export const WATERFALL = { x: -352, z: -568, width: 11, height: 15 };


/** Проверяет, находится ли точка на мосту. Возвращает высоту поверхности или null */
export function bridgeAt(x: number, z: number): number | null {
  for (const b of BRIDGES) {
    // Преобразуем точку в локальные координаты моста
    const lx = (x - b.x) * b.dx + (z - b.z) * b.dz;   // вдоль моста
    const lz = -(x - b.x) * b.dz + (z - b.z) * b.dx;  // поперёк моста
    if (Math.abs(lx) < b.length / 2 && Math.abs(lz) < b.width / 2) {
      return b.height;
    }
  }
  return null;
}

// ── Поселения (координаты мировые) ───────────────────────────
export const PORT = { x: -225, z: -150, radius: 26, level: -0.6 };     // приозёрный порт
export const CARAVANSERAI = { x: 505, z: 55, radius: 30, level: 1.2 }; // караван-сарай в пустыне
export const VILLAGE = { x: -495, z: -415, radius: 26, level: 2.0 };   // лесная деревня
export const FORT = { x: -320, z: -705, radius: 28, level: 22 };       // горный форт

/** Мировые координаты городских ворот (якорь навигации) */
export const GATE = (() => {
  const a = Math.atan2(-CITY.z, -CITY.x);
  return { x: CITY.x + Math.cos(a) * CITY.radius, z: CITY.z + Math.sin(a) * CITY.radius };
})();

export type Biome = 'desert' | 'forest' | 'field' | 'mountain' | 'water';

/** Цилиндрические коллайдеры построек: персонаж и камера их уважают */
export const COLLIDERS: { x: number; z: number; r: number }[] = [];

/** Динамические коллайдеры фауны: звери движутся, поэтому фауна
 *  перезаписывает этот список каждый кадр (позиции + радиусы). */
export interface FaunaCollider { x: number; z: number; r: number }
export const FAUNA_COLLIDERS: FaunaCollider[] = [];

/** Динамические коллайдеры горожан (перезаписываются каждый кадр). */
export const CIV_COLLIDERS: FaunaCollider[] = [];

function addCollider(x: number, z: number, r: number): void {
  COLLIDERS.push({ x, z, r });
}
export { addCollider };

function fract(v: number): number { return v - Math.floor(v); }

function hash2(x: number, y: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
}

function smoothstep(t: number): number { return t * t * (3 - 2 * t); }

function clamp01(v: number): number { return Math.min(1, Math.max(0, v)); }

/** Гладкий value-noise */
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = smoothstep(xf), v = smoothstep(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, z: number): number {
  return 0.5 * vnoise(x / 96, z / 96) + 0.3 * vnoise(x / 38, z / 38) + 0.2 * vnoise(x / 14, z / 14);
}

// ── Маски биомов и воды ──────────────────────────────────────

/** Пустыня: восток карты (плавная граница 380..560) */
export function desertMask(x: number, z: number): number {
  return clamp01((x - 380) / 180) * clamp01((900 - Math.abs(z - 60)) / 500);
}

/** Лес: северо-запад, вокруг лесной деревни. Граница ломаная шумом. *
 *
 *  СТАРАЯ МАСКА БЫЛА МЁРТВОЙ, И ЭТО ИЗМЕРЕНО. Максимум forestMask на всём
 *  мире равнялся 0.078, а порог биома в biomeAt - 0.4. Лес не был слабым,
 *  его не было: диск радиусом 360 вокруг (-460,-330) лежит в z от -690 до
 *  30, а отсечка clamp01((z+120)/200) равна нулю при z <= -120 и растёт
 *  только после. Окна почти не пересекались, и произведение достигало
 *  максимума 0.078 при z = -45: (30-z)(z+120)/72000 на максимуме даёт
 *  5625/72000 = 0.0781. Ни биома, ни зелёного пятна на земле, ни лесной
 *  фауны, ни плотности деревьев 0.9 - ничего.
 *
 *  Радиус 700 взят под измеренную цель: фауна набирает 6 лесных зверей из
 *  900 случайных проб по всему миру, и при меньшем лесе шестеро не
 *  набираются никогда. Порог 0.4 проходится на расстоянии 420 - это
 *  около 1.4% мира, двенадцать проб из девятисот.
 *
 *  Центр уведён в (-620,-430): от прежнего центра столица в 608 единицах,
 *  и круг радиусом 700 дотянулся бы до Исфахана - земля вокруг столицы
 *  пошла бы зеленеть. От нового центра столица в 800 единицах, маска
 *  там строго ноль.
 */
export function forestMask(x: number, z: number): number {
  // Бугры подмешиваются к расстоянию, а не к самой маске: так граница
  // уезжает то туда, то сюда, а середина леса остаётся настоящим лесом.
  const бугры = (fbm(x / 150 + 21, z / 150 - 13) - 0.5) * 2;
  return clamp01(1 - (Math.hypot(x + 620, z + 430) + бугры * 130) / 700);
}
/** Рельеф новой земли: массивы, гряды и котловины. Вне старого мира. *
 *
 *  Внутри старого мира (|x|,|z| <= 1200) возвращает ровно ноль. Там всё
 *  расставлено руками: города, дороги, лесная деревня, форт. Правка идёт
 *  после базового шума и до края мира, хребта, дюн, площадок городов и
 *  дна водоёмов - иначе рельеф поднял бы берег залива выше уровня моря
 *  и высунул холмы сквозь воду.
 */
export function landformRelief(x: number, z: number): number {
  const d = Math.max(Math.abs(x), Math.abs(z)) - СТАРЫЙ_МИР;
  const т = clamp01(d / 700);
  if (т <= 0) return 0;
  // Две частоты: массивы на 640 единиц и гряды на 230. Одна частота дала бы
  // либо ровные холмы, либо шум - а нужны и широкие массивы, и гребни.
  const массивы = (vnoise(x / 640 + 5.5, z / 640 - 2.5) - 0.5) * 2;
  const гряды = (vnoise(x / 230 - 11.5, z / 230 + 7.5) - 0.5) * 2;
  return т * (массивы * 24 + гряды * 7);
}
/** Северный хребет (внутренний, кроме краевого) */
function ridgeMask(x: number, z: number): number {
  return smoothstep(clamp01((-z - 430) / 220)) * clamp01(1 - desertMask(x, z) * 0.8);
}



/** Уровень поверхности воды в точке или null, если суша.
 *  Озеро и реки — на уровне LAKE, пруд — на своём. */
export function waterSurfaceY(x: number, z: number): number | null {
  // Море проверяется первым: его уровень ниже, чем у озера и пруда, и
  // подстановка общей LAKE.level утащила бы гладь на полметра вверх.
  //
  // Порог 0.45 - тот же, что у biomeAt для биома 'water'. Пока маска
  // меньше половины, точка считается берегом: на прибрежной полосе маска
  // ещё мала, а земля уже выше уровня воды, и объявлять такую точку водой
  // значило бы отдавать отрицательную глубину (пленка воды над склоном).
  if (seaMask(x, z) > 0.45) return SEA.level;
  // Прибрежная полоса залива: маска моря ещё есть, но воды по признаку
  // поверхности тут нет. Возвращать уровень озера здесь нельзя - точка у
  // залива не в озере, и такая подмена отдавала бы берегу высоту чужой
  // воды (замерено: surf = -2.0 при ground = -0.2, то есть вода выше
  // земли наоборот).
  if (seaMask(x, z) > 0.05) return null;
  if (waterMask(x, z) <= 0.05) return null;
  return Math.hypot(x - POND.x, z - POND.z) < POND.r ? POND.level : LAKE.level;
}

function flatten(h: number, x: number, z: number, cx: number, cz: number, r: number, level: number): number {
  const d = Math.hypot(x - cx, z - cz);
  const t = smoothstep(clamp01((d - r * 0.55) / (r * 0.45)));
  return level + (h - level) * t;
}

/** Высота ландшафта в мировых координатах (форма меша) */
export function terrainHeight(x: number, z: number): number {
  let h = (fbm(x, z) - 0.5) * 16;
  h += landformRelief(x, z);
  // Рельеф новой земли. Идёт первым, чтобы край мира, хребет, дюны,
  // площадки городов и дно водоёмов легли поверх него, а не под ним.
  // Дальний хребет по краям мира
  const edge = Math.max(Math.abs(x), Math.abs(z)) / WORLD_HALF;
  h += smoothstep(clamp01((edge - 0.72) / 0.28)) * 55;
  // Северный хребет со скалистыми пиками
  const ridge = ridgeMask(x, z);
  // ГЛУШИМ ХРЕБЕТ В ЗАЛИВЕ, и это вынужденная мера. ridgeMask даёт полную
  // гору при z < -650, то есть юг мира был стеной высотой до 55 м. Море
  // в такую стену упиралось: вода не доходила до берега, а на пологом
  // склоне висела плёнкой в 20 метрах над землёй. Залив - это вода по
  // смыслу, и хребет обязан уступить ему место.
  const вЗамире = clamp01((-520 - z) / 140);
  h += ridge * (26 + fbm(x / 150 + 9, z / 150 - 4) * 34) * (1 - вЗамире);
  // Дюны пустыни
  const dm = desertMask(x, z);
  h = h * (1 - dm * 0.55) + dm * 0.55 * (1.5 + Math.sin(x * 0.021 + fbm(x / 60, z / 60) * 4) * 2.6 + (fbm(x / 25, z / 25) - 0.5) * 3);
  // Плоские площадки: город, возрождение, лагерь, поселения
  h = flatten(h, x, z, CITY.x, CITY.z, 150, 0.4); // плато накрывает кольцо стены (r=116)
  h = flatten(h, x, z, 0, 0, 26, 0.4); // уровень = базе города: иначе у ворот земля ниже и город «висит»
  h = flatten(h, x, z, CAMP.x, CAMP.z, 22, h * 0.35 + 0.3);
  h = flatten(h, x, z, PORT.x, PORT.z, PORT.radius, PORT.level);
  h = flatten(h, x, z, CARAVANSERAI.x, CARAVANSERAI.z, CARAVANSERAI.radius, CARAVANSERAI.level);
  h = flatten(h, x, z, VILLAGE.x, VILLAGE.z, VILLAGE.radius, VILLAGE.level);
  h = flatten(h, x, z, FORT.x, FORT.z, FORT.radius, FORT.level);
  // Площадки городов регионов. Радиус вдвое больше городского не из вкуса:
  // flatten() держит ровную землю только в центральных 55% своего радиуса,
  // а дома стоят на 86% городского. Без запаса они попали бы в зону
  // смешивания, где земля идёт в гору, и дома стояли бы на разной высоте.
  for (const t of REGION_TOWNS) h = flatten(h, x, z, t.x, t.z, t.radius * 2, t.level);
  // Низменность залива. Суша в заливе должна быть выше уровня моря
  // (SEA.level = -3.2), иначе после заливки половина берега окажется под
  // водой. Уровень +3.5 даёт суше 6.7 м над гладью - достаточно, чтобы
  // берег читался берегом.
  h = flatten(h, x, z, 0, -820, 900, 3.5);
  // Русла и озёра: русло углубляется до дна (в хребте это даёт ущелье и водопад)
  const w = waterMask(x, z);
  if (w > 0) {
    // Дно моря отдельное и глубокое: с тем же дном, что у озера, гладь
    // была бы по щиколотку, и плавание (глубже 1.2 м) не наступало бы.
    const sm = seaMask(x, z);
    const bed = sm >= w ? SEA.bed : LAKE.level - 3.2;
    h = h * (1 - w) + bed * w;
    // ПОДРЕЗКА ПО УРОВНЮ МОРЯ. Линейное смешивание с дном оставляет
    // приборжную полосу, где маска ещё мала, а земля выше уровня воды:
    // гладь висит плёнкой в метрах над склоном, и swimNeeded считает
    // глубину отрицательной. Там, где маска моря уже ненулевая, рельеф
    // опускается к уровню воды - получается пляж, а не плёнка.
    if (sm > 0.02 && h > SEA.level) {
      const подрезка = clamp01((sm - 0.02) / 0.15);
      h = h * (1 - подрезка) + Math.min(h, SEA.level + 0.5) * подрезка;
    }
  }
  return h;
}

// Сегментов вдоль стороны. Клетка = (WORLD_HALF * 2) / TERRAIN_SEG.
// 6350 / 450 = 14.1 единицы - ровно как было при 170 на старом мире.
//
// Цена измерена на собранном модуле, а не прикинута. Замеры в мс:
//   SEG 170 - 66 мс, 29241 вершина, 57800 треугольников
//   SEG 300 - 194 мс, 90601 вершина, 180000 треугольников
//   SEG 380 - 323 мс, 145161 вершина, 288800 треугольников
//   SEG 450 - 450 мс, 203401 вершина, 405000 треугольников
//   SEG 520 - 605 мс, 271441 вершина, 540800 треугольников
//
// При новом мире замер дал 488 мс и те же 203401 вершину: предсказание
// совпало с точностью до того, что край мира стал длиннее.
//
// Подробности и оговорки - в комментарии к WORLD_HALF выше.
const TERRAIN_SEG = 450;

/**
 * Высота видимого меша рельефа в точке: билинейная интерполяция вершин.
 * Без городской плиты — используется для постановки построек города.
 */
export function meshHeight(x: number, z: number): number {
  const half = WORLD_HALF;
  const step = (WORLD_HALF * 2) / TERRAIN_SEG;
  const fx = clamp01((x + half) / (WORLD_HALF * 2)) * TERRAIN_SEG;
  const fz = clamp01((z + half) / (WORLD_HALF * 2)) * TERRAIN_SEG;
  const i = Math.min(TERRAIN_SEG - 1, Math.floor(fx));
  const j = Math.min(TERRAIN_SEG - 1, Math.floor(fz));
  const lx = fx - i, lz = fz - j;
  const x0 = -half + i * step, x1 = x0 + step;
  const z0 = -half + j * step, z1 = z0 + step;
  const h00 = terrainHeight(x0, z0), h10 = terrainHeight(x1, z0);
  const h01 = terrainHeight(x0, z1), h11 = terrainHeight(x1, z1);
  return (h00 * (1 - lx) + h10 * lx) * (1 - lz) + (h01 * (1 - lx) + h11 * lx) * lz;
}

/**
 * Высота для сущностей: меш рельефа + плита городской площади.
 * Именно её должны использовать персонажи, NPC и животные — иначе
 * проваливаются между вершинами.
 */
export function groundHeight(x: number, z: number): number {
  let h = meshHeight(x, z);

  // Плита площади Исфахана стоит над землёй — сущности стоят на ней
  const dCity = Math.hypot(x - CITY.x, z - CITY.z);
  if (dCity < CITY.radius * 0.98) {
    const plazaTop = terrainHeight(CITY.x, CITY.z) + 0.3;
    const t = smoothstep(clamp01((CITY.radius * 0.98 - dCity) / 2.5));
    h = Math.max(h, h * (1 - t) + plazaTop * t);
  }
  return h;
}

/** Биом точки (для флоры, фауны и раскраски) */
export function biomeAt(x: number, z: number): Biome {
  if (waterMask(x, z) > 0.45) return 'water';
  const h = terrainHeight(x, z);
  if (h > 20 || ridgeMask(x, z) > 0.5) return 'mountain';
  if (desertMask(x, z) > 0.45) return 'desert';
  if (forestMask(x, z) > 0.4) return 'forest';
  return 'field';
}

export function isRoad(x: number, z: number): boolean {
  const seg = (ax: number, az: number, bx: number, bz: number, w: number) => {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / len2);
    const px = ax + dx * t, pz = az + dz * t;
    return Math.hypot(x - px, z - pz) < w;
  };
  return seg(CITY.x, CITY.z, 0, 0, 3.2) || seg(0, 0, CAMP.x, CAMP.z, 2.6) ||
    seg(CITY.x, CITY.z, PORT.x, PORT.z, 2.4) || seg(CITY.x, CITY.z, CARAVANSERAI.x, CARAVANSERAI.z, 2.2) ||
    Math.hypot(x - CITY.x, z - CITY.z) < CITY.radius * 0.8;
}

// ── Материалы (с процедурными текстурами) ────────────────────
const MAT = {
  sand: new THREE.MeshStandardMaterial({ color: 0xbfae8a, roughness: 1, map: sandTexture(48) }),
  stone: new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 0.95, map: stoneTexture(4) }),
  sandstone: new THREE.MeshStandardMaterial({ color: 0xd8c298, roughness: 0.9, map: plasterTexture('#c9ab7c', 2) }),
  sandstoneDark: new THREE.MeshStandardMaterial({ color: 0xb09468, roughness: 0.9, map: stoneTexture(6) }),
  tealDome: new THREE.MeshStandardMaterial({ color: 0x35a0a0, roughness: 0.45, metalness: 0.2, map: mosaicTexture(4) }),
  gold: new THREE.MeshStandardMaterial({ color: 0xc9a84c, roughness: 0.35, metalness: 0.7 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 1, map: woodTexture(1) }),
  foliage: new THREE.MeshStandardMaterial({ color: 0x4a6a38, roughness: 1 }),
  foliageDark: new THREE.MeshStandardMaterial({ color: 0x2f4a28, roughness: 1 }),
  foliageLight: new THREE.MeshStandardMaterial({ color: 0x5d7a3c, roughness: 1 }),
  brush: new THREE.MeshStandardMaterial({ color: 0x6a6a3c, roughness: 1 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 1 }),
  palmTrunk: new THREE.MeshStandardMaterial({ color: 0x7a6244, roughness: 1 }),
  palmLeaf: new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 1, side: THREE.DoubleSide }),
  white: new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.85 }),
  clothRed: new THREE.MeshStandardMaterial({ color: 0x8b1a1a, roughness: 1 }),
  clothTeal: new THREE.MeshStandardMaterial({ color: 0x2e8b8b, roughness: 1 }),
  clothPurple: new THREE.MeshStandardMaterial({ color: 0x7a5fd0, roughness: 1 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 1 }),
  water: new THREE.MeshStandardMaterial({
    color: 0x2f6f96, roughness: 0.12, metalness: 0.5, transparent: true, opacity: 0.82,
    map: waterTexture(6),
  }),
  waterfall: new THREE.MeshBasicMaterial({
    color: 0xdff0f8, transparent: true, opacity: 0.75, side: THREE.DoubleSide, map: waterfallTexture(2),
  }),
  snow: new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 1 }),
  flower: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
};

// ── Рельеф ───────────────────────────────────────────────────
export function buildTerrain(scene: THREE.Scene): THREE.Mesh {
  const SIZE = WORLD_HALF * 2;
  const SEG = TERRAIN_SEG;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const cSand = new THREE.Color(0x9c8a66);
  const cDesert = new THREE.Color(0xc9a96e);
  const cGrass = new THREE.Color(0x5d7345);
  const cForest = new THREE.Color(0x3d5230);
  const cRock = new THREE.Color(0x7d828e);
  const cSnow = new THREE.Color(0xe8ecf2);
  const cRoad = new THREE.Color(0xb59d72);
  const cBed = new THREE.Color(0x8a7a58);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);

    // Биомная раскраска
    const dm = desertMask(x, z);
    const fm = forestMask(x, z);
    const g = clamp01(fbm(x + 700, z - 300) * 1.6 - 0.55) * clamp01((h + 2) / 5);
    tmp.copy(cSand).lerp(cGrass, g * 0.85);
    tmp.lerp(cForest, fm * 0.8);
    tmp.lerp(cDesert, dm * 0.9);
    if (h > 16) tmp.lerp(cRock, clamp01((h - 16) / 14));
    if (h > 44) tmp.lerp(cSnow, clamp01((h - 44) / 12));
    if (waterMask(x, z) > 0.35) tmp.lerp(cBed, 0.85);
    if (isRoad(x, z)) tmp.lerp(cRoad, 0.75);
    // Лёгкая пестрота
    const n = 0.92 + hash2(x * 3.1, z * 2.7) * 0.16;
    colors[i * 3] = tmp.r * n; colors[i * 3 + 1] = tmp.g * n; colors[i * 3 + 2] = tmp.b * n;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// ── Вода: озеро, пруд, река, водопад ─────────────────────────
export function buildWater(scene: THREE.Scene): void {
  const water = new THREE.Group();
  const discGeo = new THREE.CircleGeometry(1, 28);
  discGeo.rotateX(-Math.PI / 2);

  const lake = new THREE.Mesh(discGeo, MAT.water);
  lake.scale.set(LAKE.r, 1, LAKE.r);
  lake.position.set(LAKE.x, LAKE.level, LAKE.z);
  water.add(lake);

  const pond = new THREE.Mesh(discGeo, MAT.water);
  pond.scale.set(POND.r, 1, POND.r);
  pond.position.set(POND.x, POND.level, POND.z);
  water.add(pond);

  // Море. Одна большая плоскость вместо сетки по маске: острова и берег
  // выше уровня воды, поэтому рельеф сам выступает из глади, и резать
  // геометрию по береговой линии не нужно.
  //
  // Границы посчитаны, а не подобраны на глаз: северный край - там, где
  // берег может зайти севернее всего (SEA.coast + SEA.jitter), южный -
  // край мира. Первая версия обрывала плоскость на 40 м южнее и оставляла
  // полосу воды без поверхности там, где шум уводил берег на север.
  const seaNorth = SEA.coast + SEA.jitter;
  const seaDepth = seaNorth - (-WORLD_HALF);
  const seaGeo = new THREE.PlaneGeometry(WORLD_HALF * 2, seaDepth, 1, 1);
  seaGeo.rotateX(-Math.PI / 2);
  const sea = new THREE.Mesh(seaGeo, MAT.water);
  sea.position.set(0, SEA.level, seaNorth - seaDepth / 2);
  sea.name = 'sea';
  water.add(sea);

  // Река — перекрывающиеся диски вдоль русла
  const riverPts = [...RIVER_A, ...RIVER_B];
  for (let i = 0; i < riverPts.length - 1; i++) {
    const a = riverPts[i], b = riverPts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(len / 9);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const disc = new THREE.Mesh(discGeo, MAT.water);
      disc.scale.set(8.5, 1, 8.5);
      disc.position.set(a.x + (b.x - a.x) * t, LAKE.level, a.z + (b.z - a.z) * t);
      water.add(disc);
    }
  }

  // Водопад: стена воды в ущелье хребта + пена у подножия + валуны
  const wf = new THREE.Mesh(new THREE.PlaneGeometry(WATERFALL.width, WATERFALL.height), MAT.waterfall);
  wf.position.set(WATERFALL.x, terrainHeight(WATERFALL.x, WATERFALL.z) + WATERFALL.height / 2 - 1, WATERFALL.z + 6);
  wf.name = 'waterfall';
  const foam = new THREE.Mesh(discGeo, new THREE.MeshStandardMaterial({ color: 0xeef6fa, transparent: true, opacity: 0.5, roughness: 0.3 }));
  foam.scale.set(9, 1, 7);
  foam.position.set(WATERFALL.x, terrainHeight(WATERFALL.x, WATERFALL.z - 14) + 0.2, WATERFALL.z - 8);
  water.add(wf, foam);
  for (const [rx, rz, rk] of [[-362, -560, 1.6], [-342, -556, 2.1], [-356, -548, 1.2]] as const) {
    const boulder = new THREE.Mesh(new THREE.IcosahedronGeometry(rk, 0), MAT.stone);
    boulder.position.set(rx, terrainHeight(rx, rz) + rk * 0.3, rz);
    boulder.castShadow = true;
    water.add(boulder);
  }

  scene.add(water);
}

// ── Растительность по биомам (InstancedMesh) ─────────────────
export function buildScatter(scene: THREE.Scene): void {
  const rng = (() => { let s = 42; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const spots: { x: number; z: number; h: number; biome: Biome }[] = [];
  for (let i = 0; i < 7000 && spots.length < 2600; i++) {
    const x = (rng() * 2 - 1) * (WORLD_HALF - 60);
    const z = (rng() * 2 - 1) * (WORLD_HALF - 60);
    const dCity = Math.hypot(x - CITY.x, z - CITY.z);
    const dSpawn = Math.hypot(x, z);
    if (dCity < CITY.radius + 6 || dSpawn < 14) continue;
    if (isRoad(x, z)) continue;
    const biome = biomeAt(x, z);
    if (biome === 'water') continue;
    if (waterMask(x, z) > 0.06) continue;
    spots.push({ x, z, h: groundHeight(x, z), biome });
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const color = new THREE.Color();
  const flowerColors = [0xe85a6a, 0xe8c94a, 0xd07ae8, 0xf0f0e0, 0xe88a4a];
  const put = (mesh: THREE.InstancedMesh, idx: number, x: number, y: number, z: number, k: number, rotY = 0, sy = k) => {
    m.compose(v.set(x, y, z), q.setFromEuler(new THREE.Euler(0, rotY, 0)), sc.set(k, sy, k));
    mesh.setMatrixAt(idx, m);
  };

  // Списки по биомам
  const trees = spots.filter(s => (s.biome === 'forest' ? rng() < 0.9 : s.biome === 'field' ? rng() < 0.12 : s.biome === 'mountain' ? rng() < 0.1 : rng() < 0.006));
  const rocks = spots.filter(s => (s.biome === 'mountain' ? rng() < 0.5 : s.biome === 'desert' ? rng() < 0.22 : rng() < 0.06));
  const tufts = spots.filter(s => (s.biome === 'field' ? rng() < 0.6 : s.biome === 'forest' ? rng() < 0.25 : rng() < 0.05));
  const flowers = spots.filter(s => s.biome === 'field' && rng() < 0.45);
  const brushes = spots.filter(s => s.biome === 'desert' && rng() < 0.3);
  const pines = spots.filter(s => s.biome === 'mountain' && s.h < 40 && rng() < 0.5);

  // Стволы + кроны (платан/кипарис по случаю)
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3.2, 6);
  const trunks = new THREE.InstancedMesh(trunkGeo, MAT.trunk, trees.length);
  trunks.castShadow = true;
  const crownGeo = new THREE.ConeGeometry(1.7, 3.4, 7);
  const crowns = new THREE.InstancedMesh(crownGeo, MAT.foliage, trees.length);
  crowns.castShadow = true;
  const crown2Geo = new THREE.SphereGeometry(1.9, 8, 6);
  const crowns2 = new THREE.InstancedMesh(crown2Geo, MAT.foliageLight, trees.length);
  crowns2.castShadow = true;
  trees.forEach((s, idx) => {
    const k = 0.8 + rng() * 1.2;
    put(trunks, idx, s.x, s.h + 1.6 * k, s.z, k);
    const cypress = s.biome !== 'field' && rng() < 0.7 || rng() < 0.4;
    if (cypress) {
      put(crowns, idx, s.x, s.h + 3.9 * k, s.z, k * 0.8, rng() * Math.PI, k * 1.25);
      put(crowns2, idx, s.x, -9999, s.z, 0.001);
    } else {
      put(crowns, idx, s.x, -9999, s.z, 0.001);
      put(crowns2, idx, s.x, s.h + 3.7 * k, s.z, k * 1.05, 0, k);
    }
  });
  trunks.count = trees.length; crowns.count = trees.length; crowns2.count = trees.length;

  // Коллайдеры деревьев (стволы)
  for (const s of trees) {
    addCollider(s.x, s.z, 0.5);
  }

  // Камни
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rocksMesh = new THREE.InstancedMesh(rockGeo, MAT.stone, rocks.length);
  rocksMesh.castShadow = true; rocksMesh.receiveShadow = true;
  rocks.forEach((s, idx) => {
    const k = 0.6 + rng() * (s.biome === 'mountain' ? 2.6 : 1.6);
    m.compose(v.set(s.x, s.h + k * 0.25, s.z), q.setFromEuler(new THREE.Euler(rng() * 0.4, rng() * Math.PI, 0)), sc.set(k, k * 0.75, k));
    rocksMesh.setMatrixAt(idx, m);
  });
  rocksMesh.count = rocks.length;
  // Коллайдеры камней: по размеру (мелочь не мешает, валуны держат)
  for (const s of rocks) {
    const big = s.biome === 'mountain';
    addCollider(s.x, s.z, big ? 1.4 : 0.9);
  }

  // Трава
  const tuftGeo = new THREE.ConeGeometry(0.5, 1.1, 5);
  const tuftsMesh = new THREE.InstancedMesh(tuftGeo, MAT.foliageLight, tufts.length);
  tufts.forEach((s, idx) => {
    const k = 0.7 + rng() * 0.9;
    put(tuftsMesh, idx, s.x, s.h + 0.4 * k, s.z, k);
  });
  tuftsMesh.count = tufts.length;

  // Цветы (только поля)
  const flowerGeo = new THREE.SphereGeometry(0.12, 5, 4);
  const flowersMesh = new THREE.InstancedMesh(flowerGeo, MAT.flower, flowers.length);
  const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4);
  const stemsMesh = new THREE.InstancedMesh(stemGeo, MAT.foliageLight, flowers.length);
  flowers.forEach((s, idx) => {
    const k = 0.8 + rng() * 0.7;
    put(stemsMesh, idx, s.x, s.h + 0.25 * k, s.z, k);
    put(flowersMesh, idx, s.x, s.h + 0.55 * k, s.z, k);
    color.setHex(flowerColors[Math.floor(rng() * flowerColors.length)]);
    flowersMesh.setColorAt(idx, color);
  });
  flowersMesh.count = flowers.length; stemsMesh.count = flowers.length;
  if (flowersMesh.instanceColor) flowersMesh.instanceColor.needsUpdate = true;

  // Пустынный кустарник (саксаул): короткий ствол + оливковый шар
  const brushTrunkGeo = new THREE.CylinderGeometry(0.08, 0.14, 0.9, 5);
  const brushTrunks = new THREE.InstancedMesh(brushTrunkGeo, MAT.trunk, brushes.length);
  const brushGeo = new THREE.SphereGeometry(0.8, 7, 5);
  const brushesMesh = new THREE.InstancedMesh(brushGeo, MAT.brush, brushes.length);
  brushes.forEach((s, idx) => {
    const k = 0.7 + rng() * 1.1;
    put(brushTrunks, idx, s.x, s.h + 0.45 * k, s.z, k);
    put(brushesMesh, idx, s.x, s.h + 1.1 * k, s.z, k, 0, k * 0.8);
  });
  brushTrunks.count = brushes.length; brushesMesh.count = brushes.length;

  // Горная хвоя: тёмные узкие конусы
  const pineGeo = new THREE.ConeGeometry(1.2, 4.4, 6);
  const pinesMesh = new THREE.InstancedMesh(pineGeo, MAT.foliageDark, pines.length);
  const pineTrunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 1.4, 5);
  const pineTrunks = new THREE.InstancedMesh(pineTrunkGeo, MAT.trunk, pines.length);
  pines.forEach((s, idx) => {
    const k = 0.9 + rng() * 0.9;
    put(pineTrunks, idx, s.x, s.h + 0.7 * k, s.z, k);
    put(pinesMesh, idx, s.x, s.h + 3.1 * k, s.z, k);
  });
  pinesMesh.count = pines.length; pineTrunks.count = pines.length;
  // Коллайдеры горной хвои (стволы)
  for (const s of pines) {
    addCollider(s.x, s.z, 0.5);
  }

  // Пальмы-оазисы: берега озера/пруда
  const oasis = spots.filter(s => {
    const wm = waterMask(s.x, s.z);
    return wm > 0.005 && wm < 0.09 && (s.biome === 'desert' || rng() < 0.5);
  }).slice(0, 46);

  scene.add(trunks, crowns, crowns2, rocksMesh, tuftsMesh, flowersMesh, stemsMesh,
    brushTrunks, brushesMesh, pinesMesh, pineTrunks);

  // Пальмы строятся группами (не инстансами — их немного)
  for (const s of oasis) addPalm(scene, s.x, s.z, 0.8 + rng() * 0.6);
}

// ── Дороги: грунтовые и каменные + караванные пути ─────────
/**
 * Материал полотна дороги: утоптанная земля, а не однотонная заливка.
 *
 * ТУТ БЫЛА ПЛОСКАЯ ЗАЛИВКА ЦВЕТОМ, И ЭТО ТОТ САМЫЙ «НЕКРАСИВЫЙ» ВИД. Ровная
 * полоса одного тона поверх земли читается как покрашенная, а не как
 * дорога. Добавлены три вещи, которые делают её похожей на грунт:
 *
 * 1. Светлый центр и потемнение к обочинам — настоящая дорога темнее там,
 *    где её топтали, и светлее посередине, где проезжают повозки.
 * 2. Мелкий щебень и колеи, повторяющиеся текстурой вдоль полотна.
 * 3. Прозрачные кромки. Раньше по краям стояли отдельные бордюры высотой
 *    40 см, и именно они давали ту самую жёсткую тёмную кромку, из-за
 *    которой дорога выглядела наклеенной. Теперь край просто растворяется
 *    в земле, и границы видно только тем, что земля под ними чуть светлее.
 *
 * alphaTest, а не blending: полотно лежит вплотную к земле, и при обычной
 * полупрозрачности сортировка давала бы мерцание, когда игрок вплотную
 * подходит к дороге.
 */
function roadMaterial(stone: boolean): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;

  // Основа: поперёк полотна светлее к центру, темнее к обочинам
  const base = g.createLinearGradient(0, 0, 128, 0);
  const light = stone ? '#a8a294' : '#d9b87e';
  const dark = stone ? '#6f6a5e' : '#a5824f';
  base.addColorStop(0, dark);
  base.addColorStop(0.5, light);
  base.addColorStop(1, dark);
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);

  // Щебень и колеи
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const s = 1 + Math.random() * 2.2;
    const shade = Math.random() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${shade},${shade},${shade},${0.04 + Math.random() * 0.09})`;
    g.fillRect(x, y, s, s);
  }
  for (const lane of [0.32, 0.68]) {
    g.fillStyle = 'rgba(0,0,0,0.10)';
    g.fillRect(Math.round(128 * lane) - 2, 0, 4, 128);
  }

  // Растворяем кромки в землю
  g.globalCompositeOperation = 'destination-out';
  for (const [x0, x1] of [[0, 22], [128, 106]] as const) {
    const grad = g.createLinearGradient(x0, 0, x1, 0);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), 128);
  }
  g.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.95,
    metalness: 0.0,
    alphaTest: 0.5,
  });
}

/**
 * Дороги между settlements — общие данные для полотна и для движения.
 *
 * Вынесены наружу, потому что по этим же линиям теперь ходят караваны и
 * путники (см. roadTraffic.ts). Раньше список жил внутри buildRoads, и караваны
 * были зашиты в него же тремя статичными верблюдами на фиксированных точках:
 * стоят навечно, не идут, и привязаны к ИНДЕКСУ roads[3]. Стоило добавить
 * пятую дорогу в список — и караваны уехали бы на другую.
 */
export const ROAD_PATHS: {
  from: { x: number; z: number };
  to: { x: number; z: number };
  w: number;
  stone: boolean;
}[] = [
  { from: { x: CITY.x, z: CITY.z }, to: { x: 0, z: 0 }, w: 4.0, stone: true },
  { from: { x: 0, z: 0 }, to: { x: CAMP.x, z: CAMP.z }, w: 3.5, stone: false },
  { from: { x: CITY.x, z: CITY.z }, to: { x: PORT.x, z: PORT.z }, w: 3.0, stone: false },
  { from: { x: CITY.x, z: CITY.z }, to: { x: CARAVANSERAI.x, z: CARAVANSERAI.z }, w: 3.0, stone: false },
];

export function buildRoads(scene: THREE.Scene): void {
  const roads = ROAD_PATHS;

  const roadMat = roadMaterial(false);
  const stoneRoadMat = roadMaterial(true);

  // Вспомогательная функция: строит одну дорогу как единый BufferGeometry
  function buildSingleRoad(
    scene: THREE.Scene,
    from: { x: number; z: number },
    to: { x: number; z: number },
    width: number,
    mat: THREE.Material,
  ): void {
    const dx = to.x - from.x, dz = to.z - from.z;
    const totalLen = Math.hypot(dx, dz);
    // ТУТ БЫЛО ДЕЛИМУЮ 2, И ШАГ ПОЛУЧАЛСЯ СЛИШКОМ КРУПНЫМ. Дорога шла
    // двумяметровыми кусками, а рельеф между ними проваливался: полотно
    // провисало или, наоборот, торчало из земли клином. Метр — мельче
    // любой неровности, которую тут можно поймать.
    const segCount = Math.max(8, Math.ceil(totalLen / 1));

    // Нормаль и перпендикуляр
    const angle = Math.atan2(dx, dz);
    const sinA = Math.sin(angle), cosA = Math.cos(angle);
    const px = sinA, pz = cosA;

    // Положим все данные в отдельные массивы
    const posArr: number[] = [];
    const uvArr: number[] = [];
    const idxArr: number[] = [];

    for (let si = 0; si <= segCount; si++) {
      const tt = si / segCount;
      const cx = from.x + dx * tt;
      const cz = from.z + dz * tt;
      // ТУТ БЫЛА ГЛАВНАЯ ОШИБКА ПОЛОТНА. Высота бралась ОДИН РАЗ, в
      // центре полосы, и обе крайние точки ставились на неё же. Но земля
      // по краям дороги лежит на другой высоте, и на любом уклоне или
      // бугорке полотно с одной стороны уходило в землю, а с другой
      // висело над ней. На снимках это читалось как светлая лента, которая
      // то тонет в земле, то повисает в воздухе.
      //
      // Теперь высота снимается в каждой крайней точке, и поднимается над
      // более высокой из них — так полотно никогда не провалится.
      const lx = cx - px * width / 2, lz = cz - pz * width / 2;
      const rx = cx + px * width / 2, rz = cz + pz * width / 2;
      const ly = groundHeight(lx, lz);
      const ry = groundHeight(rx, rz);
      const y = Math.max(ly, ry) + 0.07;
      posArr.push(lx, y, lz, rx, y, rz);
      uvArr.push(0, tt, 1, tt);
    }
    for (let si = 0; si < segCount; si++) {
      const a = si * 2, b = si * 2 + 1, c = (si + 1) * 2, d = (si + 1) * 2 + 1;
      idxArr.push(a, c, b, b, c, d);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    geo.setIndex(idxArr);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    // ТУТ БЫЛ ЧЁРНЫЙ КОСОЙ ШТРИХ ПО ЗЕМЛЕ. Дорога — это полость, лежащая
    // на земле, и она ставила castShadow. Тень от полосы, поднятой на 5 см,
    // ложилась рядом с ней тёмной чертой — на ровной пустыне это и было те
    // чёрные диагонали на снимке. Принимать тень полотно должно (чтобы
    // всадники и деревья клали на дорогу свою тень), а отбрасывать — нет:
    // земля под дорогой и так в тени.
    mesh.castShadow = false;
    scene.add(mesh);
  }

  for (const r of roads) {
    buildSingleRoad(scene, r.from, r.to, r.w, r.stone ? stoneRoadMat : roadMat);
  }

  // Караваны уехали в roadTraffic.ts.
  //
  // ТУТ СТОЯЛИ ТРИ СТАТИЧНЫХ ВЕРБЛЮДА. Они не двигались никогда: стояли в
  // точках 0.2, 0.45 и 0.7 пути и ждали. Поле было пустым не потому, что
  // движения не было, а потому, что его и не существовало — просто три
  // деревянных ящика на обочине. Теперь по дорогам идут настоящие караваны,
  // а заодно и случайные путники с квестами.

  // ── Мосты ──
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x8a7040, roughness: 0.9 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x6a5030, roughness: 0.85 });
  for (const b of BRIDGES) {
    const angle = Math.atan2(b.dx, b.dz);
    const bridgeGroup = new THREE.Group();

    // Дорожное полотно
    const deck = new THREE.Mesh(new THREE.BoxGeometry(b.width, 0.3, b.length), bridgeMat);
    deck.position.y = 0;
    deck.receiveShadow = true;
    deck.castShadow = true;
    bridgeGroup.add(deck);

    // Балки под полотном
    for (let i = -1; i <= 1; i += 2) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, b.length - 0.5), railMat);
      beam.position.set(i * (b.width / 2 - 0.2), -0.4, 0);
      bridgeGroup.add(beam);
    }

    // Перила по бокам
    for (let side = -1; side <= 1; side += 2) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, b.length), railMat);
      rail.position.set(side * (b.width / 2 - 0.05), 0.55, 0);
      bridgeGroup.add(rail);
      // Столбики перил
      for (let p = -b.length / 2 + 1; p <= b.length / 2 - 1; p += 2.5) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 5), railMat);
        post.position.set(side * (b.width / 2 - 0.05), 0.5, p);
        bridgeGroup.add(post);
      }
    }

    bridgeGroup.position.set(b.x, b.height, b.z);
    bridgeGroup.rotation.y = angle;
    scene.add(bridgeGroup);

    // Коллайдеры по краям моста (чтобы не свалиться в воду сбоку)
    const perpX = -b.dz, perpZ = b.dx;
    for (let along = -b.length / 2 + 2; along <= b.length / 2 - 2; along += 4) {
      for (let side = -1; side <= 1; side += 2) {
        const cx = b.x + b.dx * along + perpX * side * (b.width / 2 - 0.5);
        const cz = b.z + b.dz * along + perpZ * side * (b.width / 2 - 0.5);
        COLLIDERS.push({ x: cx, z: cz, r: 0.4 });
      }
    }
  }
}

/** Пальма: изогнутый ствол + веер листьев */
function addPalm(parent: THREE.Object3D, x: number, z: number, k = 1, cityLocal = false): void {
  const palm = new THREE.Group();
  const lean = (Math.random() - 0.5) * 0.28;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * k, 0.26 * k, 5.4 * k, 6), MAT.palmTrunk);
  trunk.position.y = 2.7 * k;
  trunk.rotation.z = lean;
  trunk.castShadow = true;
  palm.add(trunk);
  const topX = -Math.sin(lean) * 5.4 * k, topY = Math.cos(lean) * 5.4 * k;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.34 * k, 2.6 * k, 4), MAT.palmLeaf);
    leaf.position.set(topX + Math.cos(a) * 1.0 * k, topY + 0.15 * k, Math.sin(a) * 1.0 * k);
    leaf.rotation.set(Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25 - lean * 2);
    leaf.castShadow = true;
    palm.add(leaf);
  }
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.12 * k, 6, 5), MAT.trunk);
    nut.position.set(topX + (Math.random() - 0.5) * 0.4 * k, topY - 0.25 * k, (Math.random() - 0.5) * 0.4 * k);
    palm.add(nut);
  }
  palm.position.set(x, groundHeight(x, z), z);
  parent.add(palm);
  if (cityLocal) addCollider(CITY.x + x, CITY.z + z, 0.55);
  else addCollider(x, z, 0.55);
}

// ── Город Исфахан ────────────────────────────────────────────
// Табличка квартала
function quarterSign(text: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a2018';
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#c9a84c';
  g.lineWidth = 4;
  g.strokeRect(3, 3, 250, 58);
  g.fillStyle = '#f5f0e8';
  g.font = 'bold 26px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 1.05),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) }),
  );
}

// Кварталы расширенного города: базар, ремесла, жилые дома, сады.
// Позиции зарезервированы в placed[] выше — процедурные дома их обходят.
function buildQuarters(
  city: THREE.Group,
  canopies: THREE.MeshStandardMaterial[],
  lights: { x: number; z: number; y?: number }[],
): void {
  const streetMat = new THREE.MeshStandardMaterial({ color: 0x9a8a68, roughness: 1 });
  const QUARTERS = [
    { x: 84, z: 0, name: 'Базар' },
    { x: 11.7, z: -83.2, name: 'Ремесла' },
    { x: 59.4, z: 59.4, name: 'Жилой' },
    { x: -31.5, z: 77.9, name: 'Сады' },
  ];

  // Улицы-проспекты от центра к кварталам
  for (const q of QUARTERS) {
    const len = Math.hypot(q.x, q.z);
    // Проспект только по внешнему кольцу (r=30..len-14): центр занят
    // площадью, мечетью и рынком — дорога их не пересекает.
    const r0 = 30, r1 = len - 14;
    const ave = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, r1 - r0), streetMat);
    ave.position.set(q.x / len * ((r0 + r1) / 2), 0.42, q.z / len * ((r0 + r1) / 2));
    ave.rotation.y = Math.atan2(q.x, q.z);
    ave.receiveShadow = true;
    city.add(ave);
    const nx = -q.x / len, nz = -q.z / len;
    const sign = quarterSign(q.name);
    sign.position.set(q.x + nx * 13, 3.2, q.z + nz * 13);
    sign.rotation.y = Math.atan2(nx, nz);
    city.add(sign);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.2, 0.25), MAT.wood);
    post.position.set(q.x + nx * 13, 1.6, q.z + nz * 13);
    city.add(post);
    addCollider(CITY.x + q.x + nx * 13, CITY.z + q.z + nz * 13, 0.5);
  }

  // Базар: два ряда лавок
  const stallKinds = [0, 1, 2, 0, 1, 2] as const;
  const stallSpots: [number, number][] = [[78, -5], [78, 5], [84, -5], [84, 5], [90, -4], [90, 5]];
  stallSpots.forEach(([sx, sz], i) => {
    const stall = buildStall(stallKinds[i], canopies);
    stall.position.set(sx, 0.3, sz);
    stall.rotation.y = (i % 2 ? -0.12 : 0.12);
    city.add(stall);
    addCollider(CITY.x + sx, CITY.z + sz, 2.4);
  });

  // Ремесла: три кузни с горнами
  for (const [hx, hz] of [[8, -80], [16, -86], [6, -88]] as const) {
    const hut = new THREE.Group();
    const hb = new THREE.Mesh(new THREE.BoxGeometry(4.5, 3, 4), MAT.sandstoneDark);
    hb.position.y = 1.5; hb.castShadow = true;
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.4, 0.8), MAT.dark);
    chim.position.set(1.2, 4.0, -0.8);
    const anvil = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.6), MAT.dark);
    anvil.position.set(-3.2, 0.65, 1.2);
    const fire = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.7, 0.9),
      new THREE.MeshStandardMaterial({ color: 0xff8c30, emissive: 0xff6a10, emissiveIntensity: 1.6 }),
    );
    fire.position.set(-3.2, 1.2, 1.2);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 1.5, 9), MAT.wood);
    barrel.position.set(3.0, 0.75, 1.4);
    barrel.castShadow = true;
    hut.add(hb, chim, anvil, fire, barrel);
    hut.position.set(hx, 0.3, hz);
    hut.rotation.y = hx * 0.05;
    city.add(hut);
    addCollider(CITY.x + hx, CITY.z + hz, 3.4);
  }

  // Жилой квартал: семь домов кольцом
  // Радиус коллайдера берётся по диагонали дома (w×0.9), зазор между домами ≥ 2.2 м.
  // Координаты пересчитаны: минимальное расстояние между центрами должно быть
  // > houseR_i + houseR_j + 2.2, иначе дома визуально слипаются.
  const homeOffsets: [number, number, number][] = [
    [-14, -7, 5],   // дом 1 — дальше от дома 4
    [0, -13, 6],    // дом 2
    [14, -7, 4.5],  // дом 3 — дальше от дома 1
    [-14, 3, 5.5],  // дом 4 — дальше от дома 1
    [14, 3, 4.5],   // дом 5
    [-6, 12, 5],    // дом 6
    [6, 12, 6],     // дом 7
  ];
  homeOffsets.forEach(([ox, oz, w], i) => {
    const hx = 59.4 + ox, hz = 59.4 + oz;
    const r = Math.max(2.4, Math.hypot(w, w * 0.9) / 2);
    brickHouse(city, hx, hz, w, 3.6, { balcony: i % 2 === 0, badgirH: i % 3 === 0 ? 1.8 : undefined });
    addCollider(CITY.x + hx, CITY.z + hz, r);
  });

  // Сады: кипарисы, пруд, скамейки
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    cypress(city, -31.5 + Math.cos(a) * 11, 77.9 + Math.sin(a) * 11, 0.3, 0.9 + (i % 3) * 0.2);
  }
  const pond = new THREE.Mesh(new THREE.CircleGeometry(5.5, 24), MAT.water);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(-31.5, 0.5, 77.9);
  city.add(pond);
  addCollider(CITY.x - 31.5, CITY.z + 77.9, 6);
  for (const [bx, bz, ry] of [[-38, 77.9, 0.3], [-25, 77.9, -0.3], [-31.5, 71, 0], [-31.5, 84.8, Math.PI]] as const) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.45, 0.6), MAT.wood);
    bench.position.set(bx, 0.65, bz);
    bench.rotation.y = ry;
    bench.castShadow = true;
    city.add(bench);
    addCollider(CITY.x + bx, CITY.z + bz, 1.3);
  }
  // По фонарю на квартал (ночная подсветка через общий механизм lights)
  for (const [lx, lz] of [[84, 8], [11.7, -75.2], [59.4, 51.4], [-31.5, 69.9]] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 4.4, 6), MAT.dark);
    pole.position.set(lx, 2.4, lz);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.3, 0.5, 8), MAT.gold);
    bowl.position.set(lx, 4.8, lz);
    city.add(pole, bowl);
    lights.push({ x: CITY.x + lx, z: CITY.z + lz });
    addCollider(CITY.x + lx, CITY.z + lz, 0.5);
  }
}

export function buildCity(scene: THREE.Scene): THREE.Group {
  const city = new THREE.Group();
  // База города — сам меш: бугор плиты учитывается отдельно в groundHeight,
  // иначе весь город (стены/ворота) висит над землёй
  const baseY = meshHeight(CITY.x, CITY.z);
  city.position.set(CITY.x, baseY, CITY.z);

  /**
   * Высота земли в локальных координатах группы города.
   *
   * Группа стоит на высоте ЦЕНТРА, а стены и башни — на радиусе 116, где
   * земля уже на другой высоте. Из-за этого всё, что стояло на жёстко
   * зашитой высоте, висело в воздухе: на снимке под башней было видно землю,
   * а по стене шла щель с тенью на песке.
   */
  const localY = (worldX: number, worldZ: number): number =>
    meshHeight(worldX, worldZ) - baseY;
  const landscapeCount = COLLIDERS.length;
  // Копируем коллайдеры ландшафта (деревья/камни), сохранённые до обнуления
  const landscapeCopy: typeof COLLIDERS = [];
  for (let i = 0; i < landscapeCount; i++) landscapeCopy.push(COLLIDERS[i]);
  (city as any).__landscapeColliders = landscapeCopy;
  COLLIDERS.length = 0; // город строится один раз за сессию мира

  const gateAngle = Math.atan2(-CITY.z, -CITY.x); // направление к точке возрождения (0,0)
  const lights: { x: number; z: number; y?: number }[] = []; // фонари (свет — в world3d)

  // Площадь (плитка с узором)
  const plaza = new THREE.Mesh(
    new THREE.CylinderGeometry(CITY.radius * 0.92, CITY.radius, 0.5, 36),
    new THREE.MeshStandardMaterial({ color: 0xc8b48a, roughness: 0.95, map: plazaTexture(10) }),
  );
  plaza.position.y = 0.05;
  plaza.receiveShadow = true;
  city.add(plaza);

  // Фонтан в центре площади
  const fountain = new THREE.Group();
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 1.1, 12), MAT.sandstoneDark);
  basin.position.y = 0.55;
  basin.castShadow = true; basin.receiveShadow = true;
  const water = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.05, 0.16, 12), MAT.water);
  water.position.y = 1.02;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 2.4, 8), MAT.sandstone);
  column.position.y = 1.9;
  column.castShadow = true;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.1, 0.35, 10), MAT.tealDome);
  bowl.position.y = 3.1;
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.5, 6), MAT.water);
  jet.position.y = 4.1;
  jet.rotation.x = Math.PI;
  fountain.add(basin, water, column, bowl, jet);
  fountain.position.set(6, 0.3, 6);
  city.add(fountain);
  addCollider(CITY.x + 6, CITY.z + 6, 4.2);

  // Городские ворота: обзорные башни по бокам, арка, створки и зубцы
  {
    const gx = Math.cos(gateAngle) * CITY.radius, gz = Math.sin(gateAngle) * CITY.radius;
    const dirX = Math.cos(gateAngle + Math.PI / 2), dirZ = Math.sin(gateAngle + Math.PI / 2);
    const inward = (k: number) => ({ x: gx - Math.cos(gateAngle) * k, z: gz - Math.sin(gateAngle) * k });
    for (const side of [-1, 1]) {
      // Привратные башни — СНАРУЖИ стены, по бокам прохода: иначе сливаются с торцами
      const tx = gx + dirX * side * 9 + Math.cos(gateAngle) * 3;
      const tz = gz + dirZ * side * 9 + Math.sin(gateAngle) * 3;
      // Корпус обзорной башни. ТУТ БЫЛО ЗАШИТО 7.5: башня стоит у ворот, а
      // земля там ниже центра города, и башня висела в воздухе.
      const base = localY(tx, tz);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 15, 10), MAT.sandstoneDark);
      tower.position.set(tx, base + 7.5, tz);
      tower.castShadow = true;
      // Площадка с перилами и зубцами по кругу
      const deck = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.0, 0.7, 10), MAT.sandstone);
      deck.position.set(tx, base + 15.2, tz);
      deck.castShadow = true;
      const railing = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.14, 6, 12), MAT.wood);
      railing.position.set(tx, base + 16.1, tz);
      railing.rotation.x = Math.PI / 2;
      city.add(deck, railing);
      // Стойки перил: без них кольцо висело в воздухе
      for (let p = 0; p < 6; p++) {
        const pa = (p / 6) * Math.PI * 2;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6), MAT.wood);
        post.position.set(tx + Math.cos(pa) * 3.2, 15.9, tz + Math.sin(pa) * 3.2);
        city.add(post);
      }
      for (let m = 0; m < 8; m++) {
        const ma = (m / 8) * Math.PI * 2;
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.5), MAT.sandstoneDark);
        merlon.position.set(tx + Math.cos(ma) * 3.2, 16.0, tz + Math.sin(ma) * 3.2);
        merlon.rotation.y = -ma;
        merlon.castShadow = true;
        city.add(merlon);
      }
      // Чаша огня на площадке (открытая обзорная площадка — шатра нет,
      // иначе крыша парила бы над настилом, а чаша пряталась внутри конуса)
      const brazier = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.3, 0.5, 8), MAT.gold);
      brazier.position.set(tx, 15.8, tz);
      const fire = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1, 6), new THREE.MeshStandardMaterial({ color: 0xff8c30, emissive: 0xff6a10, emissiveIntensity: 1.8 }));
      fire.position.set(tx, 16.5, tz);
      city.add(tower, brazier, fire);
      addCollider(CITY.x + tx, CITY.z + tz, 3.4);
      lights.push({ x: CITY.x + tx, z: CITY.z + tz, y: baseY + 16.2 });
    }
    // Арка с зубцами. Балка идёт ВДОЛЬ стены (по касательной):
    // rotation.y = -gateAngle кладёт ось X радиально — был разворот на 90°.
    const tangentRot = -gateAngle - Math.PI / 2;
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(11.6, 1.8, 2.6), MAT.sandstone);
    lintel.position.set(gx, 10.5, gz);
    lintel.rotation.y = tangentRot;
    lintel.castShadow = true;
    // Шахский герб — плакетка на внешней грани балки (по центру, вместо зубца)
    const keystone = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 0.4), MAT.tealDome);
    keystone.position.set(gx + Math.cos(gateAngle) * 1.5, 10.9, gz + Math.sin(gateAngle) * 1.5);
    keystone.rotation.y = tangentRot;
    keystone.castShadow = true;
    city.add(lintel, keystone);
    for (let m = -2; m <= 2; m++) {
      if (m === 0) continue; // место под шахский герб
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.5), MAT.sandstoneDark);
      merlon.position.set(gx + dirX * m * 2.4, 11.8, gz + dirZ * m * 2.4);
      merlon.rotation.y = tangentRot;
      merlon.castShadow = true;
      city.add(merlon);
    }
    // Створки ворот: тёмное дерево, приоткрыты для прохода по центру.
    // Широкая грань — тоже вдоль стены; высота дотянута до балки (9.6), иначе щель.
    for (const side of [-1, 1]) {
      const inner = inward(0.4);
      const door = new THREE.Mesh(new THREE.BoxGeometry(3.4, 9.6, 0.4), MAT.wood);
      door.position.set(inner.x + dirX * side * 2.6, 4.8, inner.z + dirZ * side * 2.6);
      door.rotation.y = tangentRot + side * 0.22;
      door.castShadow = true;
      // оковка створок
      for (let b = 0; b < 3; b++) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.18, 0.5), MAT.dark);
        band.position.set(0, -3.2 + b * 3.0, 0.05);
        door.add(band);
      }
      city.add(door);
    }
    // Крылья стен от дверей к башням: закрывают боковые щели.
    // Отрезок A->B вдоль касательной: поворот кладёт локальный +X на (B-A).
    for (const sgn of [-1, 1]) {
      const ax = gx + dirX * sgn * 4.3, az = gz + dirZ * sgn * 4.3;
      const bx = gx + dirX * sgn * 9.2, bz = gz + dirZ * sgn * 9.2;
      const segLen = Math.hypot(bx - ax, bz - az);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(segLen, 5, 1.2), MAT.sandstoneDark);
      wing.position.set((ax + bx) / 2, 2.5, (az + bz) / 2);
      wing.rotation.y = Math.atan2(-(bz - az), bx - ax);
      wing.castShadow = true; wing.receiveShadow = true;
      city.add(wing);
      addCollider(CITY.x + (ax + bx) / 2, CITY.z + (az + bz) / 2, segLen / 2 + 0.6);
    }
    // фонарь над проходом — висит на стержне под балкой (низ балки 9.6)
    const gateRod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), MAT.dark);
    gateRod.position.set(gx, 9.75, gz);
    const gateLamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshStandardMaterial({ color: 0xffd980, emissive: 0xffa530, emissiveIntensity: 1.3 }));
    gateLamp.position.set(gx, 9.1, gz);
    city.add(gateRod, gateLamp);
    lights.push({ x: CITY.x + gx, z: CITY.z + gz, y: baseY + 9.4 });
  }

  // Базарная аркада
  {
    const streetDir = gateAngle;
    for (let i = 1; i <= 5; i++) {
      const t = -i * 7.5;
      const ax = Math.cos(streetDir) * t * 0.4;
      const az = Math.sin(streetDir) * t * 0.4 + 26;
      for (const side of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 4.4, 1.1), MAT.sandstone);
        pillar.position.set(ax + Math.cos(streetDir + Math.PI / 2) * 3.1 * side, 2.2, az + Math.sin(streetDir + Math.PI / 2) * 3.1 * side);
        pillar.castShadow = true;
        city.add(pillar);
        addCollider(CITY.x + pillar.position.x, CITY.z + pillar.position.z, 0.9);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.7, 1.6), MAT.sandstoneDark);
      top.position.set(ax, 4.7, az);
      top.rotation.y = -streetDir;
      top.castShadow = true;
      city.add(top);
      const awning = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.08, 2.6), i % 2 ? MAT.clothTeal : MAT.clothRed);
      awning.position.set(ax, 4.1, az);
      awning.rotation.y = -streetDir;
      awning.rotation.x = 0.05;
      city.add(awning);
    }
  }

  // Стены: непрерывная дуга по кругу с проёмом ровно под ворота
  // (дискретные сегменты оставляли дыры по бокам ворот)
  const OPEN = 9.5 / CITY.radius; // половина угла проёма ворот (рад)
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xb09468, roughness: 0.9, map: stoneTexture(6), side: THREE.DoubleSide,
  });
  const thetaStart = Math.PI / 2 - gateAngle + OPEN; // стандартный угол φ = π/2 − θ (mod 2π)
  const thetaLength = Math.PI * 2 - OPEN * 2;
  // ТУТ БЫЛО ЗАШИТО: высота стены 6, position.y = 3. То есть стена всегда
  // стояла на отметке 0 в локальных координатах города — а земля под стеной
  // на отметке 0 не лежит: группа города стоит на высоте ЦЕНТРА, а стена идёт
  // по радиусу 116, где рельеф другой. На половине окружности стена уходила
  // в землю, на половине висела над ней с тенью на песке.
  //
  // Стена — одна длинная дуга, поэтому усреднять или брать высоту в одной
  // точке нельзя: в любом месте окружности должно быть видно, что она стоит
  // на земле. Берём САМУЮ НИЗКУЮ точку под всей стеной и от неё считаем
  // вверх, а низ уводим в грунт — тогда зазора не будет нигде.
  let groundMin = Infinity;
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    groundMin = Math.min(groundMin, localY(CITY.x + Math.cos(a) * CITY.radius, CITY.z + Math.sin(a) * CITY.radius));
  }
  const WALL_TOP = 6;      // насколько стена поднимается над самой низкой землёй
  const WALL_SUNK = 1.5;   // насколько уходит в грунт, чтобы не было щели
  const wallHeight = WALL_TOP + WALL_SUNK;
  const wallY = groundMin - WALL_SUNK + wallHeight / 2;

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(CITY.radius, CITY.radius, wallHeight, 192, 1, true, thetaStart, thetaLength),
    wallMat,
  );
  wall.position.y = wallY;
  wall.castShadow = true; wall.receiveShadow = true;
  city.add(wall);
  // Зубцы по гребню стены
  const merlonCount = Math.round(84 * CITY.radius / 58);
  const merlonGeo = new THREE.BoxGeometry(1.6, 0.8, 0.6);
  const merlons = new THREE.InstancedMesh(merlonGeo, MAT.sandstoneDark, merlonCount);
  merlons.castShadow = true;
  {
    const mq = new THREE.Quaternion();
    const mv = new THREE.Vector3();
    const ms = new THREE.Vector3(1, 1, 1);
    const mm = new THREE.Matrix4();
    const stepA = (Math.PI * 2 - OPEN * 2) / merlonCount;
    for (let m = 0; m < merlonCount; m++) {
      const phi = gateAngle + OPEN + stepA * (m + 0.5);
      // Зубцы должны сидеть на гребне стены, а не на зашитой высоте — иначе
      // после переноса стены вниз они остались бы висеть над ней отдельно.
      mv.set(Math.cos(phi) * CITY.radius, wallY + wallHeight / 2 + 0.35, Math.sin(phi) * CITY.radius);
      mq.setFromEuler(new THREE.Euler(0, -phi, 0));
      mm.compose(mv, mq, ms);
      merlons.setMatrixAt(m, mm);
    }
  }
  city.add(merlons);
  // Коллайдеры вдоль дуги (шаг ~5 юнитов)
  for (let phi = gateAngle + OPEN; phi < gateAngle + Math.PI * 2 - OPEN; phi += 5 / CITY.radius) {
    addCollider(CITY.x + Math.cos(phi) * CITY.radius, CITY.z + Math.sin(phi) * CITY.radius, 2.2);
  }
  // Башни по углам
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.6, 9, 10), MAT.sandstoneDark);
    t.position.set(Math.cos(a) * CITY.radius, 4.5, Math.sin(a) * CITY.radius);
    t.castShadow = true;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(3.6, 2.6, 10), MAT.tealDome);
    cap.position.set(Math.cos(a) * CITY.radius, 10.3, Math.sin(a) * CITY.radius);
    city.add(t, cap);
    addCollider(CITY.x + Math.cos(a) * CITY.radius, CITY.z + Math.sin(a) * CITY.radius, 4.1);
  }

  // ── Мечеть в центре ──
  const mosque = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(24, 8, 18), MAT.sandstone);
  base.position.y = 4; base.castShadow = true; base.receiveShadow = true;
  mosque.add(base);
  const portal = new THREE.Mesh(new THREE.BoxGeometry(7, 12, 2), MAT.sandstoneDark);
  portal.position.set(0, 6, 9.4);
  const arch = new THREE.Mesh(new THREE.BoxGeometry(3.4, 6, 0.8), MAT.dark);
  arch.position.set(0, 3, 10.5);
  mosque.add(portal, arch);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(7.5, 18, 14), MAT.tealDome);
  dome.scale.set(1, 1.15, 1);
  dome.position.y = 12.5;
  const domeSpike = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3, 8), MAT.gold);
  domeSpike.position.y = 21.6;
  mosque.add(dome, domeSpike);
  for (const side of [-1, 1]) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 22, 10), MAT.sandstoneDark);
    shaft.position.set(side * 15, 11, 6);
    const balcony = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.9, 10), MAT.gold);
    balcony.position.set(side * 15, 17, 6);
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.5, 4, 10), MAT.tealDome);
    top.position.set(side * 15, 24, 6);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), MAT.gold);
    finial.position.set(side * 15, 26.4, 6);
    shaft.castShadow = true;
    mosque.add(shaft, balcony, top, finial);
  }
  mosque.position.set(0, 0.3, -8);
  city.add(mosque);
  // Минареты — отдельные коллайдеры (база мечети уже накрыта сеткой выше)
  for (const side of [-1, 1]) {
    addCollider(CITY.x + side * 15, CITY.z - 8 + 6, 1.6);
  }

  // Жилые дома: купольные одно- и двухэтажные, с балконами
  const rng = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const canopies = [MAT.clothRed, MAT.clothTeal, MAT.clothPurple];
  // Занятые места площади: мечеть, фонтан, прилавки, аркада, NPC —
  // дома ставятся только с учётом дистанции до них (см. проверку ниже)
  // научный центр): их позиции — в client/.../game3d/interiors.ts (SPOTS),
  // дублируются здесь числом, чтобы не создавать циклический импорт
  // terrain<->interiors (он роняет загрузку мира: CITY ещё в TDZ).
  // При переносе домов править ОБА места!
  const placed: { x: number; z: number; r: number }[] = [
    { x: 0, z: -8, r: 13.5 }, // мечеть
    { x: 6, z: 6, r: 5.5 },   // фонтан
    { x: -18.6, z: -69.5, r: 8 }, // конюшня
    { x: 36.0, z: -62.4, r: 8 },  // казарма
    { x: 67.7, z: -24.6, r: 8 },  // мастерская
    { x: 67.7, z: 24.6, r: 8 },   // таверна
    { x: 24.6, z: 67.7, r: 8 },   // обсерватория
    { x: -65.2, z: 30.4, r: 8 },  // научный центр
    { x: 84, z: 0, r: 13 },       // базарный квартал
    { x: 11.7, z: -83.2, r: 13 }, // ремесленный квартал
    { x: 59.4, z: 59.4, r: 15 },  // жилой квартал
    // Семь кольцевых домов квартала (см. homeOffsets выше): выступают за r=15,
    // каждый резервируем отдельно, иначе процедурные дома встают впритык (1+1=2)
    ...[[-14, -7, 5], [0, -13, 6], [14, -7, 4.5], [-14, 3, 5.5], [14, 3, 4.5], [-6, 12, 5], [6, 12, 6]]
      .map(([ox, oz, w]) => ({ x: 59.4 + ox, z: 59.4 + oz, r: Math.hypot(w, w * 0.9) / 2 })),
    { x: -31.5, z: 77.9, r: 15 }, // сады
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => {
      const a = Math.PI * 0.6 + (i / 7) * Math.PI * 0.8;
      return { x: Math.cos(a) * 20, z: -8 + Math.sin(a) * 20, r: 2.6 };
    }),
    ...[1, 2, 3, 4, 5].map((i) => {
      const t = -i * 7.5;
      return { x: Math.cos(gateAngle) * t * 0.4, z: Math.sin(gateAngle) * t * 0.4 + 26, r: 5 };
    }),
    ...[[-8, 10], [20, 16], [-24, -6], [12, -2], [16, -10], [-14, -14], [-4, 22], [6, -20], [26, 6], [2, -26]]
      .map(([x, z]) => ({ x, z, r: 2 })), // NPC Исфахана (npc.ts)
  ];
  // Corridor reservations for quarter avenues (r=30..70): procedural houses must avoid roads.
  for (const q of [{ x: 84, z: 0 }, { x: 11.7, z: -83.2 }, { x: 59.4, z: 59.4 }, { x: -31.5, z: 77.9 }]) {
    const len = Math.hypot(q.x, q.z);
    const steps = Math.ceil((len - 30) / 8);
    for (let i = 0; i <= steps; i++) {
      const t = 30 + (i / Math.max(1, steps)) * (len - 30);
      placed.push({ x: (q.x / len) * t, z: (q.z / len) * t, r: 4 });
    }
  }
  for (let i = 0; i < 44; i++) {
    const a = rng() * Math.PI * 2;
    const r = 18 + rng() * 78;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = 4 + rng() * 4, h = 3 + rng() * 2.5;
    // Занятые места: мечеть, фонтан, прилавки, аркада, NPC (npc.ts).
    // Дома не должны прилипать друг к другу и к постройкам.
    const houseR = Math.max(2.4, Math.hypot(w, w * 0.9) / 2); // коллайдер по диагонали (дома вращаются случайно)
    if (placed.some(p => Math.hypot(p.x - x, p.z - z) < p.r + houseR + 3.0)) continue;
    placed.push({ x, z, r: houseR });
    const house = new THREE.Group();
    const twoStory = rng() < 0.35;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.9), MAT.sandstone);
    body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true;
    house.add(body);
    if (twoStory) {
      const upper = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, h * 0.7, w * 0.75), MAT.sandstoneDark);
      upper.position.y = h + h * 0.35; upper.castShadow = true; upper.receiveShadow = true;
      const balcony = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 0.14, 1.1), MAT.wood);
      balcony.position.set(0, h - 0.1, w * 0.45);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 0.5, 0.08), MAT.wood);
      rail.position.set(0, h + 0.18, w * 0.45 + 0.5);
      house.add(upper, balcony, rail);
    }
    const domeR = Math.min(w, h * 1.4) * 0.55;
    const domeY = twoStory ? h + h * 0.7 : h;
    const hd = new THREE.Mesh(new THREE.SphereGeometry(domeR, 10, 8), rng() > 0.55 ? MAT.tealDome : MAT.sandstoneDark);
    hd.scale.y = 0.72;
    hd.position.y = domeY;
    house.add(hd);
    const window1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.1), MAT.dark);
    window1.position.set(0, h * 0.55, w * 0.45 + 0.02);
    house.add(window1);
    // Восточный колорит столицы: бадгиры и балконы на части домов
    if (rng() < 0.45) badgir(house, w * 0.26, -w * 0.2, h, 1.8 + rng() * 1.2);
    if (rng() < 0.4) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.12, 0.9), MAT.wood);
      slab.position.set(0, h * 0.6, w * 0.45 + 0.35);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.42, 0.07), MAT.wood);
      rail.position.set(0, h * 0.6 + 0.27, w * 0.45 + 0.75);
      house.add(slab, rail);
    }
    house.position.set(x, 0.25, z);
    house.rotation.y = rng() * Math.PI;
    city.add(house);
    addCollider(CITY.x + x, CITY.z + z, Math.max(2.4, Math.hypot(w, w * 0.9) / 2));
  }

  // ── Конюшня: длинное стойло с крышей и лошадью ──
  {
    const sx = -18.6, sz = -69.5;
    const stable = new THREE.Group();
    // Пол и основание
    const sfloor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.2, 6), MAT.sandstoneDark);
    sfloor.position.set(0, 0.1, 0);
    stable.add(sfloor);
    // Задняя и боковые стены (перед открыт для прохода)
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(9, 3.6, 0.5), MAT.sandstone);
    backWall.position.set(0, 1.8, -2.75);
    backWall.castShadow = true;
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.6, 6), MAT.sandstone);
    leftWall.position.set(-4.25, 1.8, 0);
    leftWall.castShadow = true;
    const rightWall = leftWall.clone(); rightWall.position.x = 4.25;
    stable.add(backWall, leftWall, rightWall);
    // Двускатная крыша (соломенная текстура — тёмно-жёлтая)
    const roofShape = new THREE.Shape();
    roofShape.moveTo(-4.8, 0);
    roofShape.lineTo(0, 2.6);
    roofShape.lineTo(4.8, 0);
    roofShape.lineTo(-4.8, 0);
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 6.8, bevelEnabled: false });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x9a7a30, roughness: 1 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(0, 3.6, -3.4);
    roof.castShadow = true; roof.receiveShadow = true;
    stable.add(roof);
    // Столбики-разделители стойл
    for (const px of [-2, 0, 2]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.8, 0.3), MAT.trunk);
      pillar.position.set(px, 1.4, 1.5);
      stable.add(pillar);
    }
    // Лошадь — простая модель из примитивов
    const horseMat = new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 1 });
    const horse = new THREE.Group();
    const hBody = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 2.2), horseMat);
    hBody.position.y = 1.5;
    const hNeck = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), horseMat);
    hNeck.position.set(0, 2.2, 1.0); hNeck.rotation.x = -0.4;
    const hHead = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.9), horseMat);
    hHead.position.set(0, 2.7, 1.3);
    const hTail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.9, 4), horseMat);
    hTail.position.set(0, 1.9, -1.3); hTail.rotation.x = 0.4;
    // Ноги
    for (const [lx, lz] of [[-0.35, 0.7], [0.35, 0.7], [-0.35, -0.7], [0.35, -0.7]] as const) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.0, 5), horseMat);
      leg.position.set(lx, 0.5, lz);
      horse.add(leg);
    }
    horse.add(hBody, hNeck, hHead, hTail);
    horse.position.set(0, 0.2, 0);
    horse.rotation.y = -Math.PI / 2;
    stable.add(horse);
    stable.position.set(sx, 0.2, sz);
    city.add(stable);
    addCollider(CITY.x + sx, CITY.z + sz, 5.0);
  }

  // Базарные прилавки с товаром у мечети
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * 0.6 + (i / 7) * Math.PI * 0.8;
    const x = Math.cos(a) * 20, z = -8 + Math.sin(a) * 20;
    const stall = buildStall(i % 3, canopies);
    stall.position.set(x, 0.3, z);
    stall.rotation.y = -a + Math.PI / 2;
    city.add(stall);
    addCollider(CITY.x + x, CITY.z + z, 2.6);
  }

  // Пальмы у базара и вдоль улицы к воротам
  // Кварталы расширенного города: базар, ремесла, жилые дома, сады + улицы
  buildQuarters(city, canopies, lights);

  addPalm(city, 24, -14, 1, true);
  addPalm(city, -22, 12, 0.9, true);
  addPalm(city, -2, 30, 1.05, true);
  addPalm(city, 12, 26, 0.85, true);
  addPalm(city, -12, 24, 0.95, true);

  // Городские фонари-чаши
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * CITY.radius * 0.55, z = Math.sin(a) * CITY.radius * 0.55;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 4.4, 6), MAT.dark);
    pole.position.set(x, 2.4, z);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.3, 0.5, 8), MAT.gold);
    bowl.position.set(x, 4.8, z);
    city.add(pole, bowl);
    lights.push({ x: CITY.x + x, z: CITY.z + z });
    addCollider(CITY.x + x, CITY.z + z, 0.5);
  }

  // Коллайдер мечети — строго по корпусу здания (24×18 в локальных -8):
  // ряды внутри контура, ничего не торчит за стену (иначе «невидимая
  // стена» сзади мечети, где стоят Хафиз и Мевлана)
  for (const mx of [-9, -3, 3, 9]) {
    for (const mz of [-5, 0, 5]) {
      addCollider(CITY.x + mx, CITY.z - 8 + mz, 4.4);
    }
  }
  // Портал-арка: коллайдеры по бокам арки (по 1.2), чтобы персонаж
  // мог свободно пройти под аркой в мечеть
  addCollider(CITY.x - 2.2, CITY.z + 9.4, 1.2);
  addCollider(CITY.x + 2.2, CITY.z + 9.4, 1.2);

  city.userData.lights = lights;
  scene.add(city);
  // Возвращаем сохранённые коллайдеры ландшафта (деревья, камни) ПОСЛЕ города,
  // чтобы игрок не проходил сквозь них
  const saved = (city as any).__landscapeColliders;
  if (saved) for (const c of saved) COLLIDERS.push(c);
  return city;
}

/** Прилавок с товаром (кувшины / ящики / рулоны) */
function buildStall(kind: number, canopies: THREE.MeshStandardMaterial[]): THREE.Group {
  const stall = new THREE.Group();
  const table = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 1.6), MAT.wood);
  table.position.y = 0.8; table.castShadow = true;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 2.4), canopies[kind % 3]);
  roof.position.y = 2.6; roof.rotation.x = 0.16;
  const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 5), MAT.wood);
  p1.position.set(-1.4, 1.3, -0.8);
  const p2 = p1.clone(); p2.position.x = 1.4;
  stall.add(table, roof, p1, p2);
  if (kind === 0) {
    for (let j = 0; j < 4; j++) {
      const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.42, 7), MAT.sandstoneDark);
      jar.position.set(-1 + j * 0.65, 1.5, (j % 2 ? 0.25 : -0.25));
      stall.add(jar);
    }
  } else if (kind === 1) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.7), MAT.wood);
    crate.position.set(0.4, 1.55, 0);
    crate.rotation.y = 0.3;
    const crate2 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.6), MAT.wood);
    crate2.position.set(-0.7, 1.5, 0.1);
    stall.add(crate, crate2);
  } else {
    for (let j = 0; j < 3; j++) {
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 8), canopies[(kind + j) % 3]);
      roll.rotation.z = Math.PI / 2;
      roll.position.set(-0.7 + j * 0.7, 1.42, 0.2);
      stall.add(roll);
    }
  }
  return stall;
}

// ── Лагерь разбойников ───────────────────────────────────────
// ── Восточный набор: бадгир, айван, кирпичный дом, кипарис ──
// Единый стиль для всех поселений, у каждого — своя палитра/композиция.

/** Бадгир (ветроуловитель): башня с прорезями и шляпкой. */
function badgir(parent: THREE.Group, x: number, z: number, baseY: number, h: number): void {
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.3, h, 1.3), MAT.sandstone);
  shaft.position.set(x, baseY + h / 2, z);
  shaft.castShadow = true;
  parent.add(shaft);
  for (const [ox, oz, w, d] of [[0, 0.66, 0.7, 0.06], [0, -0.66, 0.7, 0.06], [0.66, 0, 0.06, 0.7], [-0.66, 0, 0.06, 0.7]] as const) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.55, d), MAT.dark);
    slot.position.set(x + ox, baseY + h * 0.62, z + oz);
    parent.add(slot);
  }
  const cap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 1.7), MAT.sandstoneDark);
  cap.position.set(x, baseY + h + 0.17, z);
  cap.castShadow = true;
  parent.add(cap);
}

/** Айван: портал с пилонами, аркой и бирюзовой полосой. */
function tiledIwan(parent: THREE.Group, x: number, z: number, w: number, h: number, ry: number): void {
  const g = new THREE.Group();
  const pw = w * 0.22;
  for (const s of [-1, 1]) {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(pw, h, 1.6), MAT.sandstone);
    pylon.position.set(s * (w / 2 - pw / 2), h / 2, 0);
    pylon.castShadow = true; pylon.receiveShadow = true;
    g.add(pylon);
    const band = new THREE.Mesh(new THREE.BoxGeometry(pw + 0.1, h * 0.3, 1.7), MAT.tealDome);
    band.position.set(s * (w / 2 - pw / 2), h * 0.72, 0);
    g.add(band);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.2, 1.6), MAT.sandstoneDark);
  beam.position.set(0, h * 0.9, 0);
  beam.castShadow = true;
  const arch = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, h * 0.72, 0.5), MAT.dark);
  arch.position.set(0, h * 0.36, 0.4);
  g.add(beam, arch);
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  parent.add(g);
}

/** Кирпичный дом с куполом, балконом и окнами. Возвращает высоту для коллайдера. */
function brickHouse(
  parent: THREE.Group, x: number, z: number, w: number, h: number,
  opts: { dome?: boolean; balcony?: boolean; badgirH?: number; plaster?: THREE.Material } = {},
): number {
  const wallMat = opts.plaster ?? MAT.sandstone;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.9), wallMat);
  body.position.set(x, h / 2, z);
  body.castShadow = true; body.receiveShadow = true;
  parent.add(body);
  if (opts.dome !== false) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(w * 0.32, 10, 8), MAT.tealDome);
    dome.scale.y = 0.72;
    dome.position.set(x, h + 0.1, z);
    dome.castShadow = true;
    parent.add(dome);
  }
  if (opts.balcony) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.14, 1.1), MAT.wood);
    slab.position.set(x, h * 0.62, z + w * 0.45 + 0.4);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.5, 0.08), MAT.wood);
    rail.position.set(x, h * 0.62 + 0.32, z + w * 0.45 + 0.9);
    parent.add(slab, rail);
  }
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.12), MAT.dark);
  win.position.set(x - w * 0.22, h * 0.55, z + w * 0.45 + 0.02);
  const win2 = win.clone();
  win2.position.x = x + w * 0.22;
  parent.add(win, win2);
  if (opts.badgirH) badgir(parent, x + w * 0.28, z - w * 0.2, h, opts.badgirH);
  return Math.max(Math.hypot(w, w * 0.9) / 2, 2.4);
}

/** Кипарис для садов и дворов. */
function cypress(parent: THREE.Group, x: number, z: number, baseY: number, s: number): void {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.7, 6), MAT.trunk);
  trunk.position.set(x, baseY + 0.35, z);
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.85 * s, 3.6 * s, 7), MAT.foliageDark);
  crown.position.set(x, baseY + 0.7 + 1.8 * s, z);
  crown.castShadow = true;
  parent.add(trunk, crown);
  addCollider(CITY.x + x, CITY.z + z, 0.55);
}

export function buildCamp(scene: THREE.Scene): void {
  const camp = new THREE.Group();
  const baseY = groundHeight(CAMP.x, CAMP.z);
  camp.position.set(CAMP.x, baseY, CAMP.z);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5;
    const tent = new THREE.Mesh(new THREE.ConeGeometry(2.6, 3.4, 7), i % 2 ? MAT.clothRed : MAT.dark);
    const x = Math.cos(a) * 10, z = Math.sin(a) * 10;
    tent.position.set(x, 1.7, z);
    tent.castShadow = true;
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.4, 0.9), MAT.clothRed);
    flag.position.set(x, 4.2, z);
    camp.add(tent, flag);
    addCollider(CAMP.x + x, CAMP.z + z, 2.5);
  }
  // Частокол кольцом (с юга — проход) и большой шатёр вождя
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    if (Math.abs(a - Math.PI / 2) < 0.28) continue;
    const px = Math.cos(a) * 15, pz = Math.sin(a) * 15;
    const stake = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.6, 0.35), MAT.trunk);
    stake.position.set(px, 1.3, pz);
    stake.rotation.z = i % 2 ? 0.04 : -0.04;
    stake.castShadow = true;
    camp.add(stake);
  }
  addCollider(CAMP.x + 15, CAMP.z, 1.6);
  addCollider(CAMP.x - 15, CAMP.z, 1.6);
  addCollider(CAMP.x, CAMP.z - 15, 1.6);
  addCollider(CAMP.x, CAMP.z + 15, 1.6);
  const bigTent = new THREE.Mesh(new THREE.ConeGeometry(3.6, 4.6, 8), MAT.clothPurple);
  bigTent.position.set(0, 2.3, -6.5);
  bigTent.castShadow = true;
  const bigFlag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.6, 1.1), MAT.gold);
  bigFlag.position.set(0, 5.6, -6.5);
  camp.add(bigTent, bigFlag);
  addCollider(CAMP.x, CAMP.z - 6.5, 3.4);
  const fire = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 0.4, 9), MAT.dark);
  fire.position.set(0, 0.2, 0);
  addCollider(CAMP.x, CAMP.z, 1.4);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 7), new THREE.MeshStandardMaterial({ color: 0xff8c30, emissive: 0xff6a10, emissiveIntensity: 1.6 }));
  flame.position.set(0, 1, 0);
  flame.name = 'campfire-flame';
  camp.add(fire, flame);
  camp.userData.flame = flame;
  scene.add(camp);
}

// ── Поселения: порт, караван-сарай, деревня, форт ────────────
export function buildSettlements(scene: THREE.Scene): void {
  const rng = (() => { let s = 99; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

  // Приозёрный порт: пирс с лодками, домики, бочки
  {
    const g = new THREE.Group();
    g.position.set(PORT.x, groundHeight(PORT.x, PORT.z), PORT.z);
    for (let i = 0; i < 3; i++) {
      const house = new THREE.Group();
      const w = 4 + rng() * 2, h = 3 + rng();
      // Белёные стены + синий купол — приморский стиль
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.9), MAT.white);
      body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.8, 1.6, 4), MAT.clothTeal);
      roof.position.y = h + 0.8; roof.rotation.y = Math.PI / 4;
      house.add(body, roof);
      if (i === 0) {
        const dome = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), MAT.tealDome);
        dome.scale.y = 0.75;
        dome.position.set(w * 0.2, h + 0.4, 0);
        house.add(dome);
      }
      const a = -0.8 + i * 0.9;
      house.position.set(Math.cos(a) * 9, 0.2, Math.sin(a) * 9);
      house.rotation.y = -a + Math.PI;
      g.add(house);
      addCollider(PORT.x + house.position.x, PORT.z + house.position.z, w * 0.6);
    }
    // пирс к воде (в сторону озера)
    const toLake = Math.atan2(LAKE.x - PORT.x, LAKE.z - PORT.z);
    const pier = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 1.6), MAT.wood);
      plank.position.set(0, 0.55, -i * 1.9);
      plank.castShadow = true;
      pier.add(plank);
      const leg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.4, 5), MAT.trunk);
      leg1.position.set(-1, -0.2, -i * 1.9);
      const leg2 = leg1.clone(); leg2.position.x = 1;
      pier.add(leg1, leg2);
    }
    // лодка у пирса
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.5, 3.4, 7), MAT.wood);
    hull.rotation.x = Math.PI / 2; hull.scale.y = 0.45;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 5), MAT.trunk);
    mast.position.y = 1.4;
    const sail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 0.05), MAT.clothTeal);
    sail.position.set(0, 1.5, 0.1);
    boat.add(hull, mast, sail);
    boat.position.set(1.8, LAKE.level + 0.35, -13);
    pier.add(boat);
    pier.position.set(Math.sin(toLake) * 12, 0, Math.cos(toLake) * 12);
    pier.rotation.y = toLake;
    g.add(pier);

    // Торговые столы у причала (рядом с домиками)
    const tablePositions = [
      { x: -2, z: -3 },   // стол у рыбака
      { x: 3, z: -5 },    // стол у торговца
      { x: -5, z: -6 },   // стол у кок-Салима
    ];
    for (const tp of tablePositions) {
      const table = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 1.0), MAT.wood);
      table.position.set(tp.x, 0.45, tp.z);
      table.castShadow = true;
      g.add(table);
      // Ножки стола
      for (const [lx, lz] of [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]] as const) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 5), MAT.wood);
        leg.position.set(tp.x + lx, 0, tp.z + lz);
        g.add(leg);
      }
      addCollider(PORT.x + tp.x, PORT.z + tp.z, 1.1);
    }

    // Доска объявлений у входа в порт
    {
      const boardX = 8, boardZ = 8;
      const post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 5), MAT.wood);
      post1.position.set(boardX - 0.6, 1.1, boardZ);
      const post2 = post1.clone(); post2.position.x = boardX + 0.6;
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.08), MAT.wood);
      board.position.set(boardX, 1.7, boardZ);
      board.castShadow = true;
      g.add(post1, post2, board);
      addCollider(PORT.x + boardX, PORT.z + boardZ, 0.7);
    }

    // бочки — каждая бочка с коллайдером
    const barrelPositions: { x: number; z: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const bx = -8 + rng() * 4;
      const bz = 4 + rng() * 6;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.7, 8), MAT.wood);
      barrel.position.set(bx, 0.55, bz);
      barrel.castShadow = true;
      g.add(barrel);
      barrelPositions.push({ x: bx, z: bz });
    }
    for (const bp of barrelPositions) {
      addCollider(PORT.x + bp.x, PORT.z + bp.z, 0.8);
    }

    // маячок-фонарь
    const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 5.2, 6), MAT.dark);
    lampPost.position.set(-10, 2.8, -4);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffd980, emissive: 0xffa530, emissiveIntensity: 1.2 }));
    lamp.position.set(-10, 5.6, -4);
    g.add(lampPost, lamp);
    addCollider(PORT.x - 10, PORT.z - 4, 0.6);

    // Маяк на конце пирса + склады у берега
    const lightTower = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.5, 9, 10), MAT.white);
    lightTower.position.set(-2.2, 4.5, -12.5);
    lightTower.castShadow = true;
    const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.2, 8), MAT.dark);
    lampRoom.position.set(-2.2, 9.6, -12.5);
    const lampGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xffd980, emissive: 0xffa530, emissiveIntensity: 1.6 }),
    );
    lampGlow.position.set(-2.2, 9.6, -12.5);
    const lightCap = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.9, 8), MAT.clothRed);
    lightCap.position.set(-2.2, 10.6, -12.5);
    g.add(lightTower, lampRoom, lampGlow, lightCap);
    addCollider(PORT.x - 2.2, PORT.z - 12.5, 1.6);
    for (const [wx, wz, ww] of [[-14, 6, 7], [-15, -2, 5.5]] as const) {
      const store = new THREE.Mesh(new THREE.BoxGeometry(ww, 3.2, 5), MAT.sandstoneDark);
      store.position.set(wx, 1.6, wz);
      store.castShadow = true; store.receiveShadow = true;
      const awn = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.6, 0.15, 2.2), MAT.clothRed);
      awn.position.set(wx, 3.0, wz + 3.2);
      awn.rotation.x = 0.18;
      g.add(store, awn);
      addCollider(PORT.x + wx, PORT.z + wz, ww * 0.62);
    }

    scene.add(g);
  }

  // Караван-сарай в пустыне: двор со стенами, шатры, колодец, верблюжьи стойла
  {
    const g = new THREE.Group();
    g.position.set(CARAVANSERAI.x, groundHeight(CARAVANSERAI.x, CARAVANSERAI.z), CARAVANSERAI.z);
    const wall = new THREE.BoxGeometry(30, 3.2, 1.6);
    for (const [rx, rz, ry] of [[0, -14, 0], [0, 14, 0], [-14, 0, Math.PI / 2]] as const) {
      const w = new THREE.Mesh(wall, MAT.sandstoneDark);
      w.position.set(rx, 1.6, rz);
      w.rotation.y = ry;
      w.castShadow = true; w.receiveShadow = true;
      g.add(w);
    }
    // Коллайдеры стен двора (частые точки вдоль каждой стены)
    for (let wx = -14; wx <= 14; wx += 4) {
      addCollider(CARAVANSERAI.x + wx, CARAVANSERAI.z - 14, 2.0);
      if (Math.abs(wx) > 10) addCollider(CARAVANSERAI.x + wx, CARAVANSERAI.z + 14, 2.0);
    }
    for (let wz = -14; wz <= 14; wz += 4) {
      addCollider(CARAVANSERAI.x - 14, CARAVANSERAI.z + wz, 2.0);
    }
    const gateL = new THREE.Mesh(new THREE.BoxGeometry(1.6, 4.6, 1.6), MAT.sandstoneDark);
    gateL.position.set(-11, 2.3, 14);
    const gateR = gateL.clone(); gateR.position.x = 11;
    g.add(gateL, gateR);
    addCollider(CARAVANSERAI.x - 11, CARAVANSERAI.z + 14, 1.4);
    addCollider(CARAVANSERAI.x + 11, CARAVANSERAI.z + 14, 1.4);
    // Угловые башни крепости
    for (const [tx, tz] of [[-14, -14], [14, -14], [-14, 14], [14, 14]] as const) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 6.5, 9), MAT.sandstone);
      tower.position.set(tx, 3.25, tz);
      tower.castShadow = true;
      const tooth = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.7, 9), MAT.sandstoneDark);
      tooth.position.set(tx, 6.8, tz);
      g.add(tower, tooth);
      addCollider(CARAVANSERAI.x + tx, CARAVANSERAI.z + tz, 2.5);
    }
    // Бирюзовый айван над воротами
    tiledIwan(g, 0, 14, 9, 6.5, 0);
    // Коллайдер в середине ворот УБРАН. Он стоял здесь же и затыкал проём:
    // подойти к воротам можно было, войти - нет. Айван построен НАД проёмом,
    // а коллайдеры в игре двумерные, и затыкать им вход нечего.
    //
    // Дверь стоит ровно там, куда указывают данные: локальные (0, 14) - это мировые
    // (505, 69), и caravanseraiInterior.test.ts сверяет именно эту точку.
    const vorota = new THREE.Mesh(new THREE.BoxGeometry(5.0, 3.4, 0.3), MAT.wood);
    vorota.position.set(0, 1.7, 14);
    vorota.userData = {
      doorBuilding: 'caravanserai',
      doorAction: 'enter',
      doorName: t('buildings.caravanserai'),
    };
    g.add(vorota);
    // Стела у ворот, снаружи: игрок подходит с юга и читает её на пути к двери.
    const nadpisKarav = inscriptionFor('caravanserai');
    const mestoKarav = GATE_STELES.caravanserai;
    if (nadpisKarav && mestoKarav) {
      const steleKarav = steleMesh(nadpisKarav);
      steleKarav.position.set(mestoKarav.x, 0, mestoKarav.z);
      steleKarav.rotation.y = mestoKarav.ry;
      g.add(steleKarav);
    }
    // Внутренняя аркада вдоль северной стены
    for (let ax = -10; ax <= 10; ax += 5) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.4, 0.7), MAT.sandstone);
      pillar.position.set(ax, 1.7, -11.5);
      pillar.castShadow = true;
      g.add(pillar);
    }
    const arcadeBeam = new THREE.Mesh(new THREE.BoxGeometry(21, 0.5, 0.9), MAT.wood);
    arcadeBeam.position.set(0, 3.6, -11.5);
    g.add(arcadeBeam);
    for (let i = 0; i < 5; i++) {
      const tent = new THREE.Mesh(new THREE.ConeGeometry(2.4, 3, 7), i % 2 ? MAT.clothPurple : MAT.clothRed);
      tent.position.set(-9 + (i % 3) * 9, 1.5, -8 + Math.floor(i / 3) * 7);
      tent.castShadow = true;
      g.add(tent);
      addCollider(CARAVANSERAI.x + tent.position.x, CARAVANSERAI.z + tent.position.z, 2.3);
    }
    // колодец
    const well = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 1, 10), MAT.stone);
    well.position.set(6, 0.5, 4);
    const wellRoof = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1, 8), MAT.clothTeal);
    wellRoof.position.set(6, 2.4, 4);
    const wellPost = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 5), MAT.wood);
    wellPost.position.set(6, 1.8, 4);
    g.add(well, wellRoof, wellPost);
    addCollider(CARAVANSERAI.x + 6, CARAVANSERAI.z + 4, 1.8);
    // тюки с товаром
    for (let i = 0; i < 6; i++) {
      const bale = new THREE.Mesh(new THREE.BoxGeometry(1, 0.7, 0.8), MAT.clothTeal);
      bale.position.set(-4 + rng() * 10, 0.4, -12 + rng() * 6);
      bale.rotation.y = rng() * Math.PI;
      bale.castShadow = true;
      g.add(bale);
      addCollider(CARAVANSERAI.x + bale.position.x, CARAVANSERAI.z + bale.position.z, 0.8);
    }
    // Верблюды во дворе: 2 отдыхающих (статичные, на коленях) + место
    // для ходячих из фауны (их дом — центр двора, стены держат коллайдеры)
    for (const [restX, restZ, restRy] of [[-6, 2, 0.6], [9, -2, -0.9]] as const) {
      const rest = new THREE.Group();
      const camelMat = new THREE.MeshStandardMaterial({ color: 0xc8a15a, roughness: 1 });
      const camelDark = new THREE.MeshStandardMaterial({ color: 0xa8823f, roughness: 1 });
      const rbody = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 1.9), camelMat);
      rbody.position.y = 0.55;
      const hump = new THREE.Mesh(new THREE.SphereGeometry(0.42, 7, 6), camelDark);
      hump.position.set(0, 1.05, -0.2);
      const hump2 = hump.clone(); hump2.position.z = 0.45;
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.9, 0.32), camelMat);
      neck.position.set(0, 0.9, 1.05);
      neck.rotation.x = 0.5;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.7), camelMat);
      head.position.set(0, 1.3, 1.4);
      rest.add(rbody, hump, hump2, neck, head);
      rest.position.set(restX, 0.2, restZ);
      rest.rotation.y = restRy;
      rest.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = true; });
      g.add(rest);
      addCollider(CARAVANSERAI.x + restX, CARAVANSERAI.z + restZ, 1.4);
    }
    scene.add(g);
  }

  // Лесная деревня: бревенчатые дома, поленница, стог
  {
    const g = new THREE.Group();
    g.position.set(VILLAGE.x, groundHeight(VILLAGE.x, VILLAGE.z), VILLAGE.z);
    for (let i = 0; i < 4; i++) {
      const house = new THREE.Group();
      const w = 4.4 + rng() * 1.5, h = 3 + rng();
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.85), MAT.wood);
      body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.85, 2, 4), MAT.trunk);
      roof.position.y = h + 1; roof.rotation.y = Math.PI / 4;
      house.add(body, roof);
      // Бадгиры над двумя домами — сельский силуэт
      if (i % 2 === 0) badgir(house, w * 0.28, -w * 0.2, h, 1.6);
      const a = (i / 4) * Math.PI * 2 + 0.4;
      house.position.set(Math.cos(a) * 10, 0.2, Math.sin(a) * 10);
      house.rotation.y = -a + Math.PI;
      g.add(house);
      addCollider(VILLAGE.x + house.position.x, VILLAGE.z + house.position.z, w * 0.6);
    }
    // поленница
    for (let i = 0; i < 8; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.6, 6), MAT.trunk);
      log.rotation.z = Math.PI / 2;
      log.position.set(-6 + (i % 4) * 0.42, 0.2 + Math.floor(i / 4) * 0.36, 8);
      g.add(log);
    }
    addCollider(VILLAGE.x - 6, VILLAGE.z + 8, 1.4);
    // стог сена
    const hay = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0xc8a84c, roughness: 1 }));
    hay.position.set(8, 1.3, 7);
    hay.castShadow = true;
    g.add(hay);
    addCollider(VILLAGE.x + 8, VILLAGE.z + 7, 1.7);
    // Поля: вспаханные делянки с изгородью
    const fieldCols = [
      new THREE.MeshStandardMaterial({ color: 0x5d7a3c, roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: 0x6e563a, roughness: 1 }),
    ];
    [[-14, 10, 0], [-14, 17, 1], [-6, 14, 0]].forEach(([fx, fz, fi], idx) => {
      const field = new THREE.Mesh(new THREE.BoxGeometry(7, 0.15, 5), fieldCols[(idx + fi) % 2]);
      field.position.set(fx, 0.08, fz);
      field.receiveShadow = true;
      g.add(field);
      for (let px = -3; px <= 3; px += 2) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), MAT.trunk);
        post.position.set(fx + px, 0.45, fz - 2.6);
        g.add(post);
      }
    });
    addCollider(VILLAGE.x - 14, VILLAGE.z + 13.5, 4.5);
    scene.add(g);
  }

  // Горный форт: каменная цитадель с башнями и знамёнами
  {
    const g = new THREE.Group();
    g.position.set(FORT.x, groundHeight(FORT.x, FORT.z), FORT.z);
    const keep = new THREE.Mesh(new THREE.BoxGeometry(12, 10, 12), MAT.stone);
    keep.position.y = 5; keep.castShadow = true; keep.receiveShadow = true;
    const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(9, 3.4, 4), MAT.clothRed);
    keepRoof.position.y = 11.7; keepRoof.rotation.y = Math.PI / 4;
    g.add(keep, keepRoof);
    addCollider(FORT.x, FORT.z, 7.5);
    for (const [tx, tz] of [[-9, -9], [9, -9], [-9, 9], [9, 9]] as const) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.4, 8, 9), MAT.stone);
      tower.position.set(tx, 4, tz);
      tower.castShadow = true;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.5, 2, 9), MAT.snow);
      cap.position.set(tx, 9, tz);
      g.add(tower, cap);
      addCollider(FORT.x + tx, FORT.z + tz, 2.7);
    }
    // знамёна
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5, 5), MAT.dark);
      pole.position.set(side * 5, 13.5, 0);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 1.8), MAT.clothRed);
      flag.position.set(side * 5, 14.6, 0.9);
      g.add(pole, flag);
    }
    // Куртины между башнями (кроме южного проёма под ворота)
    for (const [wx, wz, ww, wd] of [[0, -9, 15.5, 1.8], [-9, 0, 1.8, 15.5], [9, 0, 1.8, 15.5]] as const) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(ww, 5.5, wd), MAT.stone);
      wall.position.set(wx, 2.75, wz);
      wall.castShadow = true; wall.receiveShadow = true;
      g.add(wall);
      addCollider(FORT.x + wx, FORT.z + wz, Math.max(ww, wd) / 2);
    }
    // Айван ворот с юга
    tiledIwan(g, 0, 9, 7, 6, 0);
    // Коллайдер в воротах УБРАН: он стоял в проёме и не давал войти. Куртины
    // строятся только с трёх сторон, и южный проём - это и есть ворота.
    const vorotaFort = new THREE.Mesh(new THREE.BoxGeometry(5.0, 3.4, 0.3), MAT.wood);
    vorotaFort.position.set(0, 1.7, 9);
    vorotaFort.userData = {
      doorBuilding: 'fortress',
      doorAction: 'enter',
      doorName: t('buildings.fortress'),
    };
    g.add(vorotaFort);
    // Стела у ворот крепости, снаружи и сбоку от айвана.
    const nadpisFort = inscriptionFor('fortress');
    const mestoFort = GATE_STELES.fortress;
    if (nadpisFort && mestoFort) {
      const steleFort = steleMesh(nadpisFort);
      steleFort.position.set(mestoFort.x, 0, mestoFort.z);
      steleFort.rotation.y = mestoFort.ry;
      g.add(steleFort);
    }
  }
}

// ── Акведук деревни ──────────────────────────────────────────────────
//
// Разрушенная аркада из пяти сегментов к востоку от лесной деревни: строка
// списка владельца требует у деревни акведуки. Сегмент — готовая модель
// (Tripo, децимация до 66к треугольников, Draco, JPEG), цепочка собирается
// кодом: последний сегмент осел и накренился — руина, а не новостройка.
//
// Площадка замерена: сухо, размах 0.2–0.3, вне домов (кольцо r=10) и полей.
// Загрузка асинхронная: нет файла — деревня стоит без аркады, игра не падает.
export const AQUEDUCT = { x: VILLAGE.x + 20, z: VILLAGE.z - 2, count: 5, step: 1.0 };
const AQUEDUCT_MODEL = 'decor/aqueduct-seg.glb';

/**
 * Готовые модели декора: шатёр, кузница, аркада. Один загрузчик на всех,
 * а не копия на модель: копии расходились бы молча (путь, Draco, fallback).
 */
const decorCache = new Map<string, Promise<THREE.Group | null>>();

export function loadDecorModel(path: string): Promise<THREE.Group | null> {
  const готовый = decorCache.get(path);
  if (готовый) return готовый;
  const задача = new Promise<THREE.Group | null>((готово) => {
    try {
      const draco = new DRACOLoader();
      draco.setDecoderPath('/game/draco/');
      const l = new GLTFLoader();
      l.setDRACOLoader(draco);
      l.load(
        `/game/models/${path}`,
        (gltf) => готово((gltf.scene as THREE.Group) ?? null),
        undefined,
        () => готово(null),
      );
    } catch {
      готово(null);
    }
  });
  decorCache.set(path, задача);
  return задача;
}

function placeDecor(
  scene: THREE.Scene,
  path: string,
  px: number,
  pz: number,
  lift: number,
  ry: number,
  colliderR: number,
  scale = 1,
): void {
  // Коллайдер ставится сразу, модель доезжает: иначе в окно загрузки сквозь
  // стену проходят, а потом стена «появляется» вокруг игрока.
  addCollider(px, pz, colliderR);
  void loadDecorModel(path).then((модель) => {
    if (!модель) return;
    const вещь = модель.clone();
    вещь.position.set(px, groundHeight(px, pz) + lift, pz);
    вещь.rotation.y = ry;
    вещь.scale.setScalar(scale);
    вещь.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    scene.add(вещь);
  });
}

export function buildAqueduct(scene: THREE.Scene): void {
  for (let i = 0; i < AQUEDUCT.count; i++) {
    const px = AQUEDUCT.x + (i - (AQUEDUCT.count - 1) / 2) * AQUEDUCT.step;
    const pz = AQUEDUCT.z;
    // Аркада — стена: пролезть между сегментами нельзя, это завал, а не ворота.
    addCollider(px, pz, 0.9);
    void loadDecorModel(AQUEDUCT_MODEL).then((модель) => {
      if (!модель) return;
      const seg = модель.clone();
      seg.position.set(px, groundHeight(px, pz), pz);
      seg.rotation.y = 0.08 * (i % 2 === 0 ? 1 : -1);
      if (i === AQUEDUCT.count - 1) {
        // Последний сегмент осел: руина читается осадкой, а не ровным рядом.
        seg.rotation.z = 0.1;
        seg.position.y -= 0.12;
      }
      seg.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
      });
      scene.add(seg);
    });
  }
}

// ── Шатёр базара и кузница деревни ─────────────────────────────────
// Третий и четвёртый пакеты из Assets: торговый шатёр в базарный квартал
// столицы и кузница в деревню (у деревни кузницы не было — workshop живёт
// в столице). Подъём над землёй — из габаритов моделей: обе отцентрены,
// низ на −0.91/−0.95, ставить на groundHeight значило бы вкопать.
export const TRADE_TENT = { x: CITY.x + 96, z: CITY.z, lift: 0.91, ry: -0.2 };
export const VILLAGE_FORGE = { x: VILLAGE.x, z: VILLAGE.z - 14, lift: 0.95, ry: 0.15 };

export function buildTradeTent(scene: THREE.Scene): void {
  placeDecor(scene, 'decor/trade-tent.glb', TRADE_TENT.x, TRADE_TENT.z, TRADE_TENT.lift, TRADE_TENT.ry, 1.2);
}

export function buildVillageForge(scene: THREE.Scene): void {
  placeDecor(scene, 'decor/village-forge.glb', VILLAGE_FORGE.x, VILLAGE_FORGE.z, VILLAGE_FORGE.lift, VILLAGE_FORGE.ry, 1.0);
}

// ── Бастионы ворот горной крепости ─────────────────────────────────
//
// Седьмой пакет из Assets: два бастиона по бокам ворот крепости (дверь
// fortress в (-320, -677)). Механика дверей не тронута: бастионы стоят
// сбоку проёма, проход 4 м между коллайдерами. База модели на нуле —
// подъём не нужен. Текстура проверена рендером с ambient (без него EEVEE
// даёт чёрный кадр и врёт про материал).
export const FORT_BASTIONS = { z: -677, dx: 10, r: 8 } as const;

export function buildFortBastions(scene: THREE.Scene): void {
  for (const сторона of [-1, 1]) {
    const px = -320 + сторона * FORT_BASTIONS.dx;
    const pz = FORT_BASTIONS.z;
    addCollider(px, pz, FORT_BASTIONS.r);
    void loadDecorModel('decor/bastion.glb').then((модель) => {
      if (!модель) return;
      const бастион = модель.clone();
      бастион.position.set(px, groundHeight(px, pz), pz);
      бастион.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
      });
      scene.add(бастион);
    });
  }
}
// ── Руины: капелла у Месопотамии и двор у святилища ─────────────
//
// Восьмой и девятый пакеты из Assets. Капелла — разрушенная часовня в
// пустыне к востоку от города (свой регион, сухо). Двор — заросший дворик
// у зороастрийского святилища. Обе метровые, база на нуле — подъём не нужен,
// масштаб 8 (иначе кукольные домики в метр). Коллайдеры по габариту.
export const RUIN_CHAPEL = { x: -1105, z: -355, scale: 8 };
export const RUIN_COURT = { x: 1225, z: 1215, scale: 8 };

export function buildRuinChapel(scene: THREE.Scene): void {
  placeDecor(scene, 'decor/ruin-chapel.glb', RUIN_CHAPEL.x, RUIN_CHAPEL.z, 0, 0, 4, RUIN_CHAPEL.scale);
}

export function buildRuinCourt(scene: THREE.Scene): void {
  placeDecor(scene, 'decor/ruin-court.glb', RUIN_COURT.x, RUIN_COURT.z, 0, 0, 4, RUIN_COURT.scale);
}
// ── Дубы у лесной деревни ────────────────────────────────────────
//
// Десятый пакет из Assets (плюс кусты без текстур — пропущены: голая
// низкополигонка ничего не добавляет к процедурным). Три hero-дуба вокруг
// деревни, а не замена всего леса: лес — это рассеивание по маске, его
// трогать нельзя. Площадки замерены: сухо, размах до 0.8, вне домов,
// кузницы, аркады и полей. База модели на нуле — подъём не нужен.
// Альфа листвы MASK: экспорт её не записал, проставлена в glb руками.
export const OAKS = [
  { x: -520, z: -420, ry: 0.4 },
  { x: -515, z: -401, ry: 2.2 },
  { x: -485, z: -435, ry: 4.1 },
] as const;

export function buildOaks(scene: THREE.Scene): void {
  for (const дуб of OAKS) {
    // Коллайдер только ствол (r = 1): крона висит выше роста.
    addCollider(дуб.x, дуб.z, 1);
    void loadDecorModel('decor/oak.glb').then((модель) => {
      if (!модель) return;
      const дерево = модель.clone();
      дерево.position.set(дуб.x, groundHeight(дуб.x, дуб.z), дуб.z);
      дерево.rotation.y = дуб.ry;
      дерево.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
      });
      scene.add(дерево);
    });
  }
}
// ── Рухнувший мост и скалы перевала ──────────────────────────────
//
// Одиннадцатый и двенадцатый пакеты из Assets. Мост — обломок пролёта,
// смытый на восточный берег RIVER_A: лежать поперёк русла ему не хватает
// длины (мокрый разрыв 10 м при пролоте 10 м), а рабочим переходам он
// конкурент, а не замена. Лежит вдоль берега, завал, не переход.
// Скалы — две группы у Кавказского перевала, в своей полосе, вне стен.
//
// Масштаб моста 10 (пролёт 1 м → 10 м), скал 2.5 (валуны 2.5 м).
export const RUIN_BRIDGE = { x: -365, z: -400, ry: -1.75, scale: 10 };
export const PASS_ROCKS = [
  { x: -975, z: 505, ry: 0.6, scale: 2.5 },
  { x: -950, z: 510, ry: 2.4, scale: 2.5 },
] as const;

export function buildRuinBridge(scene: THREE.Scene): void {
  const { x, z, ry, scale } = RUIN_BRIDGE;
  // Завал целиком: три коллайдера вдоль пролёта в мировых единицах,
  // пролезть негде.
  for (const s of [-3, 0, 3]) {
    addCollider(x + Math.cos(ry) * s, z - Math.sin(ry) * s, 2);
  }
  void loadDecorModel('decor/bridge-ruin.glb').then((модель) => {
    if (!модель) return;
    const мост = модель.clone();
    мост.position.set(x, groundHeight(x, z), z);
    мост.rotation.y = ry;
    мост.scale.setScalar(scale);
    мост.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    scene.add(мост);
  });
}

export function buildPassRocks(scene: THREE.Scene): void {
  for (const скалы of PASS_ROCKS) {
    // Группа целиком: коллайдер один, середина тоже камень.
    addCollider(скалы.x, скалы.z, 6);
    void loadDecorModel('decor/pass-rocks.glb').then((модель) => {
      if (!модель) return;
      const группа = модель.clone();
      группа.position.set(скалы.x, groundHeight(скалы.x, скалы.z), скалы.z);
      группа.rotation.y = скалы.ry;
      группа.scale.setScalar(скалы.scale);
      группа.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
      });
      scene.add(группа);
    });
  }
}

// ── Сторожевая башня на дальней восточной дороге ────────────────
//
// Тринадцатый пакет из Assets. Одинокая башня в песках: ориентир для
// путников на краю мира. База модели на нуле — подъём не нужен.
// Фас проверен рендером (камень, окна, дверь со ступенями, балкон).
export const DESERT_TOWER = { x: 2600, z: 800, ry: 0.7 };

export function buildDesertTower(scene: THREE.Scene): void {
  // Коллайдер по основанию (r = 4): башня 7 м в поперечнике.
  addCollider(DESERT_TOWER.x, DESERT_TOWER.z, 4);
  void loadDecorModel('decor/desert-tower.glb').then((модель) => {
    if (!модель) return;
    const башня = модель.clone();
    башня.position.set(DESERT_TOWER.x, groundHeight(DESERT_TOWER.x, DESERT_TOWER.z), DESERT_TOWER.z);
    башня.rotation.y = DESERT_TOWER.ry;
    башня.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    scene.add(башня);
  });
}

// ── Руина ворот у дороги на столицу ──────────────────────────────
//
// Пятый пакет из Assets: замшелая каменная арка поперёк южной дороги, не
// доходя городских ворот. Проход сквозной (коллайдеры только на устоях),
// механики дверей у неё нет и не нужно: рабочие створки стоят в самих
// воротах, их не трогали. Фас проверен рендером: проём вдоль локальной Z.
//
// Масштаб 8: модель метрового обломка (0.98 × 0.74 × 0.94) становится аркой
// 7.8 × 5.9 × 7.5 — в рост дороги, а не садовой аркой.
export const RUIN_GATE = (() => {
  const a = Math.atan2(-CITY.z, -CITY.x);
  const dist = CITY.radius + 35;
  const x = CITY.x + Math.cos(a) * dist;
  const z = CITY.z + Math.sin(a) * dist;
  return {
    x,
    z,
    // Локальная +Z (ось проёма) ложится на радиус дороги.
    ry: Math.atan2(Math.cos(a), Math.sin(a)),
    scale: 8,
  };
})();

export function buildRuinGate(scene: THREE.Scene): void {
  const { x, z, ry, scale } = RUIN_GATE;
  // Устои по бокам проёма: середина свободна, ворота проходные.
  // Смещение ±3.0 в локальных X, повёрнутое на ry.
  const бок = 3.0;
  const dx = Math.sin(ry + Math.PI / 2) * бок;
  const dz = Math.cos(ry + Math.PI / 2) * бок;
  addCollider(x + dx, z + dz, 1.5);
  addCollider(x - dx, z - dz, 1.5);
  void loadDecorModel('decor/gate-ruin.glb').then((модель) => {
    if (!модель) return;
    const арка = модель.clone();
    арка.position.set(x, groundHeight(x, z), z);
    арка.rotation.y = ry;
    арка.scale.setScalar(scale);
    арка.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    scene.add(арка);
  });
}
// ── Города регионов ────────────────────────────────────────────────────
//
// ЧТО БЫЛО. Регионов на карте семь, а построенных поселений шесть, и
// четыре из них стоят в регионе Исфахана. Игрок, который выбрал Тебриз,
// Шираз, Кавказ, Месопотамию, Хорасан или залив, возрождался на своём
// якоре и стоял в пустом поле: ни домов, ни стен, ни торговли.
//
// ПОЧЕМУ НЕ КОПИЯ ГОРОДА. buildCity занимает около пятисот строк и
// рассчитан на столицу: мечеть, базар, караван-сарай, дворец, стена с
// воротами. Шесть его копий — это в шесть раз больше мешей на каждом
// кадре и одинаковый силуэт в семи местах. Здесь построитель маленький:
// дома, стена, торговля, один памятник на характер региона.
//
// ПОЧЕМУ ЗДЕСЬ, А НЕ В ОТДЕЛЬНОМ ФАЙЛЕ. Помощники (brickHouse,
// tiledIwan, cypress, buildStall) и палитра MAT живут в этом модуле
// закрытыми. Вынос потребовал бы сделать их публичными, то есть
// расширить поверхность модуля ради одного файла.
//
// ЧТО ПРОВЕРЯЕТСЯ. spawnPlacement.test.ts требует, чтобы у каждого
// региона, кроме Исфахана, было поселение в его зоне, на суше и на
// ровном месте. Площадки выбраны замером, а не на глаз: сначала скан по
// якорям с отбором по уклону, воде и принадлежности к зоне.
export interface RegionTownDef {
  region: string;
  x: number;
  z: number;
  radius: number;
  /** Уровень площадки. Для склонов взята высота в центре якоря. */
  level: number;
  kind: 'trade' | 'walls' | 'fortress' | 'ruins' | 'oasis' | 'port' | 'gates' | 'outpost' | 'beacon';
  /** Русское имя — для таблицы в проверке, не для отрисовки. */
  nameRu: string;
}

// ── Указатели на дорогах ────────────────────────────────────────
//
// Пятнадцатый пакет из Assets. Четыре указателя вдоль двух дорог. Дорога
// между столицей и площадью вся внутри плато столицы — указателю там негде
// стоять. На дороге к лагерю площадок не нашлось: она короткая, и всё, что
// не внутри плато столицы, оказалось в самих поселениях.
//
// ПОЧЕМУ ДВА УКАЗАТЕЛЯ НА ДОРОГУ, А НЕ ОДИН. Один столб у дороги читается
// как «обломок», а не как знак: непонятно, что он означает и куда указывает.
// Пара — начала и конца участка — читается как дорога.
//
// ПОЧЕМУ СБОКУ ОТ ПОЛОТНА, А НЕ НА НЕМ. Полотно шириной 3-4 м, и столб
// посреди дороги — это препятствие: караваны и путники (roadTraffic.ts)
// идут по линии, и указатель встал бы им на пути. Отступ от края —
// половина ширины плюс 1.2 м.
//
// МЕСТА ВЫБРАНЫ СКАНИРОМ, А НЕ НА ГЛАЗ. Портом чистой математики
// террейна, сверенным с девятью записанными высотами городов: под точкой
// сухо в круге 2 м, размах высот в том же круге не больше 2 м (столб
// 1.83 м на склоне висел бы в воздухе), точка в зоне, и не ближе 150 м
// к центру столицы.
//
// 150 м, а не 220. На дороге к порту при запрете в 220 м кандидаты
// оставались в последних 10% пути: дорога идёт от столицы, и всё, что
// ближе, попадало в запрет. Дорога получалась с одним указателем вместо
// двух, и это выглядело бы как недоделанная дорога.
//
// Поворот ry смотрит на дорогу. У модели узкая сторона — глубина 0.19 м,
// то есть доска тонкая по Y; ось поворота в three.js — Y, поэтому ry и
// разворачивает доску к полотну.
export const SIGNPOSTS: {
  x: number;
  z: number;
  ry: number;
  /** Название дороги из ROAD_PATHS — для читаемости и для проверки. */
  к: string;
}[] = [
  { x: -94, z: -64, ry: -0.644, к: 'столица — порт' },
  { x: -190, z: -119, ry: 2.445, к: 'столица — порт' },
  { x: 199, z: 39, ry: -3.089, к: 'столица — караван-сарай' },
  { x: 435, z: 45, ry: -0.115, к: 'столица — караван-сарай' },
];

export function buildSignposts(scene: THREE.Scene): void {
  for (const s of SIGNPOSTS) {
    // Коллайдер узкий: столб тонкий, и широкий круг не пугал бы игрока,
    // который хочет пройти рядом. 0.45 — столб 1.4 м шириной, игрок к нему
    // подойти может, но сквозь не пройдёт.
    placeDecor(scene, 'decor/signpost.glb', s.x, s.z, 0, s.ry, 0.45);
  }
}

// ── Стол с доской во дворе караван-сарая ───────────────────────
//
// Шестнадцатый и семнадцатый пакеты из Assets: стол (3dexport_table_fbx)
// и настольная игра (3dexport_medieval_gameboard).
//
// ПОЧЕМУ ВО ДВОРЕ КАРАВАН-САРАЯ. Это единственное место в игре, где люди
// сидят и играют: в столице город гудит, а здесь караван остановился на
// ночь и ждёт утра. Шестнадцатый пакет принёс стол, но он был один на весь
// мир; доска без стола — плита на земле, а на земле доска в 53 сантиметра
// читается как ковёр.
//
// ГДЕ ИМЕННО. Двор занят с севера: аркада на z = -11.5, пять шатров от
// z = -8 до z = -1, шесть тюков, колодец в (6, 4), два верблюда. Свободен
// только юг — и он рядом с воротами, то есть игрок, вошедший в караван-сарай,
// видит стол прямо перед собой.
//
// Точка выбрана сканом, а не на глаз: земля под столом и под четырьмя
// стульями должна быть ровной в пределах 5 см, иначе стол с одной ножкой
// повиснет. Размах получился ровно 0 — двор и так выровнен ровнялкой на 1.2.
//
// СТОЛ. Готовый файл, 1.685 на 0.887, высота столешницы 0.80 м — за таким
// столом сидят, а не стоят. Обе модели применяли масштаб объекта: у обеих
// после импорта FBX он был ненулевой (у стола 0.35), и без применения в игру
// уехал бы стол шириной 4.8 метра.
//
// СТУЛЬЯ. Отдельной модели в Assets нет, и искать её за зря: стул из
// примитивов читается правильно и стоит копейки. Сделаны по той же схеме,
// что и скамейка в столице: сиденье, спинка и четыре ножки.
//
// ДОСКА. Лежит на столешнице, а не на земле: её низ на высоте столешницы.
// Лежит она не по центру, а сдвинута к игроку — чтобы читалась как партия в
// процессе, а не как выставочный экспонат.
export const CARAVANSERAI_GAME = {
  x: CARAVANSERAI.x,
  z: CARAVANSERAI.z + 8,
  /** Высота столешницы от земли, замерено по модели стола. */
  стол: 0.8,
  /**
   * Стулья: смещения от центра стола и поворот к столу.
   *
   * Поворот записан ЧИСЛОМ, а не выражением Math.PI. Проверка читает эти
   * записи регуляркой по числам, и стул с `ry: Math.PI` из неё выпадал: в
   * проверке их оказывалось два вместо четырёх, а ломка «два стула в одной
   * точке» оставалась зелёной.
   */
  стулья: [
    { x: -0.45, z: 1.15, ry: 3.141593 },
    { x: 0.45, z: 1.15, ry: 3.141593 },
    { x: -0.45, z: -1.15, ry: 0 },
    { x: 0.45, z: -1.15, ry: 0 },
  ] as const,
  /** Смещение доски на столешнице: к игроку, а не по центру. */
  доска: { dx: -0.18, dz: 0.1, ry: 0.12 },
};

export function buildGameTable(scene: THREE.Scene): void {
  const т = CARAVANSERAI_GAME;
  const земля = groundHeight(т.x, т.z);
  addCollider(т.x, т.z, 1.15);

  void loadDecorModel('decor/carav-table.glb').then((модель) => {
    if (!модель) return;
    const стол = модель.clone();
    стол.position.set(т.x, земля, т.z);
    стол.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    scene.add(стол);
  });

  // Стулья: сиденье, спинка, четыре ножки. Размеры взяты из той же логики,
  // что и скамейка в столице, но под человека: сиденье на 0.45.
  const дерево = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 });
  for (const с of т.стулья) {
    const стул = new THREE.Group();
    const сиденье = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.07, 0.42), дерево);
    сиденье.position.y = 0.45;
    const спинка = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.07), дерево);
    спинка.position.set(0, 0.72, -0.18);
    стул.add(сиденье, спинка);
    for (const [lx, lz] of [[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]] as const) {
      const ножка = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), дерево);
      ножка.position.set(lx, 0.225, lz);
      стул.add(ножка);
    }
    стул.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    стул.position.set(т.x + с.x, земля, т.z + с.z);
    стул.rotation.y = с.ry;
    scene.add(стул);
    addCollider(т.x + с.x, т.z + с.z, 0.35);
  }

  // Доска на столешнице. Подъём — ровно высота стола: низ модели на нуле.
  void loadDecorModel('decor/game-board.glb').then((модель) => {
    if (!модель) return;
    const доска = модель.clone();
    доска.position.set(
      т.x + т.доска.dx,
      земля + т.стол,
      т.z + т.доска.dz,
    );
    доска.rotation.y = т.доска.ry;
    доска.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    scene.add(доска);
  });
}

// ── Коровы на выпасе в лесной деревне ───────────────────────────
//
// Восемнадцатый пакет из Assets: ShepherdValley_Cow_FBX. Первый пакет, где
// масштаб НЕ пришлось применять — у модели scale = 1.0, она пришла в метрах
// и уже стоит на земле. Три предыдущих к каждому приходили с 0.01 и 0.35.
//
// АНИМАЦИЯ В МОДЕЛИ, А НЕ КЛИПОМ ИГРЫ. Игровые клипы лежат в mixamorig:*,
// кости коровы — DEF-*, и клип человека к ней не подойдёт. Своего клипа для
// скота в игре нет. Так что простояка едет в модели.
//
// В пакете было пять настоящих анимаций: 135-219 подвижных кривых и 13-21
// разных поз. Для сравнения, у трёх гражданских анимация была одна — поза
// привязки, 0 подвижных кривых. Разница измерена.
//
// Две коровы, а не одна: одна корова на лугу — это не стадо. Места выбраны
// сканом: под четырьмя копытами размах не больше 10 см, под коровой — сухо,
// и она ни на что не наезжает. Земля в деревне лежит на 2.97-3.04, хотя
// ровнялка задаёт 2.0: ровнялка Залива (центр 0, -820, радиус 900) накрывает
// деревню целиком и тянет вверх. Ровнота проверена между точками, а не до
// уровня.
//
// Скелет клонируется через SkeletonUtils: обычный Object3D.clone делит
// Skeleton с оригиналом, и обе коровы шевелились бы от одной кости.
export const VILLAGE_COWS: { x: number; z: number; ry: number }[] = [
  { x: VILLAGE.x - 9, z: VILLAGE.z - 20, ry: 1.148 },
  { x: VILLAGE.x - 3, z: VILLAGE.z - 20, ry: 1.422 },
];

export function buildCows(scene: THREE.Scene): THREE.AnimationMixer[] {
  const смесители: THREE.AnimationMixer[] = [];
  void loadDecorModel('decor/cow.glb').then((модель) => {
    if (!модель) return;
    const клип = (модель.animations && модель.animations[0]) ?? null;
    if (!клип) return;
    for (const [номер, точка] of VILLAGE_COWS.entries()) {
      const корова = копияСкелета(модель) as THREE.Group;
      корова.position.set(точка.x, groundHeight(точка.x, точка.z), точка.z);
      корова.rotation.y = точка.ry;
      корова.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
      });
      scene.add(корова);
      // Коллайдер — по длине коровы, а не точкой: игрок должен обходить её
      // носом, а не проваливаться между ног. 1.5 при длине 3.0 м: спереди и
      // сзади обходить приходится, сбоку помещается впритык.
      addCollider(точка.x, точка.z, 1.5);
      // Свой смеситель на корову: дорожки клипа ищут кости по именам внутри
      // поддерева, и один смеситель на группу двигал бы обе от первого.
      const смеситель = new THREE.AnimationMixer(корова);
      const действие = смеситель.clipAction(клип);
      действие.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      // Фаза своя: иначе обе коровы жуют синхронно, и это сразу видно.
      действие.time = номер * 3.1;
      смесители.push(смеситель);
    }
  });
  return смесители;
}

/**
 * Двигает коров.
 *
 * Отдельная функция, а не только buildCows: без неё коровы стоят столбом,
 * потому что у mix.update нет вызывающего. Список заполняется асинхронно,
 * когда приедет модель, поэтому update честно берёт наличное.
 */
export function updateCows(смесители: THREE.AnimationMixer[], dt: number): void {
  // Нечисловой кадр ломает смеситель: он начинает считать время в NaN и
  // возвращается к работе только после перезагрузки страницы.
  const шаг = Number.isFinite(dt) ? dt : 1 / 60;
  for (const смеситель of смесители) смеситель.update(шаг);
}

// ── Статуя у базарного квартала ────────────────────────────────
//
// Девятнадцатый пакет из Assets: 3dexport_acient_statue_02_fbx.
//
// ПОЧЕМУ У БАЗАРА, А НЕ В ЦЕНТРЕ. В центре столицы стоят дворец и мечеть, и
// там игрок возрождается. Статуя в центре перекрыла бы то, куда игрок
// приходит. Базарный квартал зарезервирован кругом r = 13 в локальных
// (84, 0) — внутри него торговые ряды, и статуя посреди рядов была бы
// препятствием. Поэтому она стоит снаружи, в 15 метрах от края квартала: её
// видно с улицы, и она не занимает место торговле.
//
// Масштаб 0.01 после импорта FBX применён: без этого в игру уехали бы
// сантиметры. В пакете один FBX, материал от 3ds Max для рендера V-Ray, и ни
// одна карта не приехала — импортёр об этом предупреждает. Статуя покрашена в
// серый камень.
//
// ПОСТАМЕНТ. Решение владельца: делать. Фигура 1.69 м с основанием 0.36 на
// 0.60 стояла прямо на земле и читалась как столб, воткнутый в площадь.
// Постамент в две ступени — 0.94 на 0.94 на 0.08 плита, сверху 0.74 на 0.74
// на 0.12 блок, всего 0.20 м — поднимает фигуру и даёт ей площадку шире
// собственного основания.
//
// Одна ступень, то есть куб 0.9x0.9x0.2, читалась бы как шахматная база:
// ровно тот довод, который владелец слышал про доску караван-сарая, где доска
// 53 см на земле читалась как ковёр. С отступом видно, где кончилась земля.
//
// Цвета разные намеренно: фигура светлая, постамент тёмный гранит. На одном
// цвете постамент сливается с фигурой и перестаёт читаться.
export const BAZAAR_STATUE = { x: 118, z: 41, ry: 0.177 };

export function buildBazaarStatue(scene: THREE.Scene): void {
  // Коллайдер — по плите постамента (0.94) плюс запас: игрок должен обходить
  // статую, а не проходить сквозь неё. По фигуре (0.36) игрок подходил бы
  // вплотную к постаменту и упирался в пустоту.
  addCollider(BAZAAR_STATUE.x, BAZAAR_STATUE.z, 0.65);
  placeDecor(
    scene,
    'decor/statue.glb',
    BAZAAR_STATUE.x,
    BAZAAR_STATUE.z,
    0,
    BAZAAR_STATUE.ry,
    0,
  );
}

export const REGION_TOWNS: RegionTownDef[] = [
  // Шесть центральных городов разнесены по миру: x от -1175 до 1925 (размах 3100),
  // ближайшее соседство 852. Раньше все шесть стояли в радиусе ~1300 от центра.
  // Полосы зон не трогались: каждый город остался в зоне своего региона, иначе якоря
  // и спавны упали бы в чужой регион. Площадки выбраны сеточным сканом портом чистой
  // математики террейна (порт сверен с девятью записанными высотами, шесть сошлись
  // до 0.04): сухой диск r=100, размах высот на r=85, вода рядом только у порта.
  // Хорасан: зона khorasan_oasis, размах 2.2.
  { region: 'khorasan', x: -225, z: 797, radius: 42, level: 0.32, kind: 'oasis', nameRu: 'Хорасан' },
  // Тебриз: восточный край своей полосы, зона tabriz_bazaar, размах 1.7.
  { region: 'tabriz', x: 1925, z: -299, radius: 46, level: 6.28, kind: 'trade', nameRu: 'Тебриз' },
  // Шираз: зона shiraz_east, размах 1.2.
  { region: 'shiraz', x: 1475, z: 493, radius: 44, level: 0.22, kind: 'walls', nameRu: 'Шираз' },
  // Кавказ: запад своей полосы, зона caucasus_pass, размах 1.7.
  { region: 'caucasus', x: -1025, z: 505, radius: 42, level: 2.06, kind: 'fortress', nameRu: 'Кавказ' },
  // Месопотамия: запад, зона mesopotamia_frontier, размах 3.5. Уровень ниже нуля,
  // но суша: диск r=100 сухой, до моря далеко.
  { region: 'mesopotamia', x: -1175, z: -365, radius: 44, level: -1.8, kind: 'ruins', nameRu: 'Месопотамия' },
  // Залив: размах 0, вода в 140 — порт без воды не порт.
  // Ровный берег залива, зона persian_gulf_islands.
  { region: 'persian_gulf', x: -175, z: -567, radius: 44, level: 3.5, kind: 'port', nameRu: 'Залив' },
  // Герат: восьмой регион, которого не было в мире вовсе. Уровень 0.24 —
  // замеренная высота центра до постройки; ровнялка сама выровняет землю.
  { region: 'herat', x: -700, z: 2250, radius: 44, level: 0.24, kind: 'gates', nameRu: 'Герат' },
  // Дальние края: девятый и десятый регионы. Места выбраны перебором
  // края, а не на глаз: на x = 2750 размах высот в окне 400x400 был
  // 47 метров, и город повис бы на уступе. Здесь 15.4 и 15.0 метров.
  // Уровень - измеренная высота центра до постройки.
  { region: 'east_frontier', x: 2950, z: 100, radius: 44, level: 24.68, kind: 'outpost', nameRu: 'Застава' },
  { region: 'west_frontier', x: -2550, z: 2100, radius: 44, level: 11.29, kind: 'beacon', nameRu: 'Маяк' },
];

/**
 * Города регионов.
 *
 * ЧТО ЭТО. Поселения в шести регионах, где их не было. Регионов на
 * карте семь, а к началу этой правки построенных поселений было шесть, и
 * четыре стояли в регионе Исфахана. То есть игрок, выбравший Тебриз,
 * Шираз, Кавказ, Месопотамию, Хорасан или залив, возрождался на своём
 * якоре и стоял в пустом поле.
 *
 * ПОЧЕМУ НЕ КОПИЯ buildCity. Столица занимает около пятисот строк: дворец,
 * мечеть, базар, караван-сарай, стена с воротами. Шесть его копий — в
 * шесть раз больше мешей в кадре и одинаковый силуэт в семи местах.
 * Здесь построитель маленький: дома, стена, торг и один памятник,
 * разный для каждого региона.
 *
 * ПОЧЕМУ ЗДЕСЬ, А НЕ В ОТДЕЛЬНОМ ФАЙЛЕ. Помощники (brickHouse,
 * tiledIwan, buildStall) и палитра MAT закрыты в этом модуле. Вынос
 * города потребовал бы сделать их публичными ради одного файла.
 *
 * ГЛАВНАЯ ОПАСНОСТЬ, И КАК ОНА ОБОЙДЕНА. cypress и addPalm внутри
 * добавляют коллайдер в мировых координатах: первый — от координат
 * столицы (CITY.x + x), второй — от сырых x, z. Оба придут не туда,
 * откуда их звали: у первого все деревья новых городов сузились бы в
 * коллайдеры внутри Исфахана. Поэтому здесь свои локальные деревья, а
 * коллайдеры считаются в мировых координатах явно.
 */
export function buildRegionTowns(scene: THREE.Scene): void {
  for (const t of REGION_TOWNS) {
    const g = new THREE.Group();
    const baseY = groundHeight(t.x, t.z);
    g.position.set(t.x, baseY, t.z);

    // Детерминированный генератор по региону: иначе после перезагрузки
    // страницы город выглядел бы иначе и игрок сравнивал бы его с чужим.
    let seed = t.region.length * 7919 + t.x + t.z;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    // Коллайдер в мировых координатах. Все места в этом файле считают
    // именно так: группа смещена в (t.x, baseY, t.z), поэтому локальные
    // координаты меша сами по себе ни о чём не говорят.
    const коллайдер = (lx: number, lz: number, r: number): void => addCollider(t.x + lx, t.z + lz, r);

    // ── Стена по кольцу с проходом на юге ──────────────────────
    const сегментов = 14;
    const hСтены = t.kind === 'fortress' ? 6.5 : 3.6;
    for (let i = 0; i < сегментов; i++) {
      if (i === сегментов / 2 || i === сегментов / 2 + 1) continue; // ворота
      const a = (i / сегментов) * Math.PI * 2;
      const wx = Math.cos(a) * t.radius;
      const wz = Math.sin(a) * t.radius;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(t.radius * 0.44, hСтены, 1.6), MAT.stone);
      wall.position.set(wx, hСтены / 2, wz);
      wall.rotation.y = -a + Math.PI / 2;
      wall.castShadow = true;
      wall.receiveShadow = true;
      g.add(wall);
      коллайдер(wx, wz, 2.4);
    }
    for (const sgn of [-1, 1]) {
      const a = Math.PI / 2 + sgn * 0.16;
      const px = Math.cos(a) * t.radius;
      const pz = Math.sin(a) * t.radius;
      const башня = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 7.4, 8), MAT.stone);
      башня.position.set(px, 3.7, pz);
      башня.castShadow = true;
      g.add(башня);
      коллайдер(px, pz, 1.9);
    }
    tiledIwan(g, 0, t.radius, 7, 5, 0);
    коллайдер(0, t.radius, 2.4);

    // ── Дома по кольцу лицом к центру ──────────────────────────
    const домов = t.kind === 'fortress' ? 7 : 10;
    for (let i = 0; i < домов; i++) {
      const a = (i / домов) * Math.PI * 2 + 0.35;
      if (Math.abs(a - Math.PI / 2) < 0.55) continue; // проход к воротам
      const r = t.radius * (0.58 + rnd() * 0.2);
      brickHouse(g, Math.cos(a) * r, Math.sin(a) * r, 4 + rnd() * 2.4, 3.4 + rnd() * 2.2, {
        dome: rnd() > 0.72,
        badgirH: rnd() > 0.6 ? 2.6 + rnd() * 1.6 : undefined,
      });
    }

    // ── Площадь: торговые ряды и колодец ───────────────────────
    const рядов = t.kind === 'fortress' ? 2 : 4;
    for (let i = 0; i < рядов; i++) {
      const a = (i / рядов) * Math.PI * 2;
      const stall = buildStall(i, [MAT.clothRed, MAT.clothTeal, MAT.gold]);
      stall.position.set(Math.cos(a) * t.radius * 0.3, 0, Math.sin(a) * t.radius * 0.3);
      stall.rotation.y = -a;
      g.add(stall);
    }
    const колодец = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 1.5, 10), MAT.stone);
    колодец.position.set(0, 0.75, 0);
    колодец.castShadow = true;
    g.add(колодец);
    коллайдер(0, 0, 1.4);

    // ── Памятник региона ───────────────────────────────────────
    // Каждый город обязан отличаться силуэтом: иначе шесть одинаковых
    // поселков на карте читаются как один, скопированный шесть раз.
    switch (t.kind) {
      case 'trade': {
        for (const s of [-1, 1]) {
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 6, 8), MAT.wood);
          col.position.set(s * 3.4, 3, -t.radius * 0.4);
          col.castShadow = true;
          g.add(col);
          коллайдер(s * 3.4, -t.radius * 0.4, 0.8);
        }
        const перемычка = new THREE.Mesh(new THREE.BoxGeometry(8.4, 1, 1.2), MAT.wood);
        перемычка.position.set(0, 6.2, -t.radius * 0.4);
        перемычка.castShadow = true;
        g.add(перемычка);
        break;
      }
      case 'walls': {
        // Сад за стеной: ряд кипарисов и низкая кладка
        for (let i = 0; i < 5; i++) {
          деревоКипарис(g, -14 + i * 7, -t.radius * 0.45, 1.1, коллайдер);
        }
        const кладка = new THREE.Mesh(new THREE.BoxGeometry(34, 2.2, 0.9), MAT.stone);
        кладка.position.set(0, 1.1, -t.radius * 0.45);
        кладка.castShadow = true;
        кладка.receiveShadow = true;
        g.add(кладка);
        коллайдер(0, -t.radius * 0.45, 1.6);
        break;
      }
      case 'fortress': {
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const bx = sx * t.radius * 0.72;
          const bz = sz * t.radius * 0.72;
          const башня = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.7, 10, 8), MAT.stone);
          башня.position.set(bx, 5, bz);
          башня.castShadow = true;
          башня.receiveShadow = true;
          g.add(башня);
          коллайдер(bx, bz, 2.4);
        }
        break;
      }
      case 'ruins': {
        // Обломки колонн: то, что осталось от прежнего города
        for (let i = 0; i < 5; i++) {
          const a = -0.5 + i * 0.55;
          const rx = Math.cos(a) * t.radius * 0.66;
          const rz = Math.sin(a) * t.radius * 0.66;
          const высота = 2.4 + rnd() * 4.2;
          const колонна = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, высота, 9), MAT.stone);
          колонна.position.set(rx, высота / 2, rz);
          колонна.rotation.z = (rnd() - 0.5) * 0.22;
          колонна.castShadow = true;
          g.add(колонна);
          коллайдер(rx, rz, 0.9);
        }
        break;
      }
      case 'oasis': {
        // Финиковая роща: оазис обязан читаться оазисом
        for (let i = 0; i < 6; i++) {
          const a = 1.9 + i * 0.42;
          деревоФиник(g, Math.cos(a) * t.radius * 0.72, Math.sin(a) * t.radius * 0.72, 1.15, коллайдер);
        }
        const бассейн = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 6), MAT.stone);
        бассейн.position.set(0, 0.25, -t.radius * 0.35);
        бассейн.receiveShadow = true;
        g.add(бассейн);
        коллайдер(0, -t.radius * 0.35, 4);
        break;
      }
      case 'gates': {
        // Ворота с аркой: Герат славился воротами, и это его силуэт.
        // Две башни по бокам, арка между ними и ступени подъезда.
        const пролёт = t.radius * 0.5;
        for (const сторона of [-1, 1]) {
          const bx = сторона * пролёт;
          const башня = new THREE.Mesh(new THREE.BoxGeometry(5, 13, 5), MAT.sandstone);
          башня.position.set(bx, 6.5, 0);
          башня.castShadow = true;
          башня.receiveShadow = true;
          g.add(башня);
          коллайдер(bx, 0, 2.4);
        }
        // Арка: три клинья, средний выше — силуэт читается как ворота,
        // а не как плоская стена с прорехой.
        for (const [сдвиг, ширина, высота] of [[0, 3.2, 4.4], [-3.8, 1.8, 3], [3.8, 1.8, 3]] as const) {
          const клин = new THREE.Mesh(new THREE.BoxGeometry(ширина, высота, 3.4), MAT.sandstone);
          клин.position.set(сдвиг, 11.5 + высота / 2, 0);
          клин.castShadow = true;
          g.add(клин);
        }
        // Ступени подъезда — иначе ворота висели бы над землёй.
        for (let i = 0; i < 3; i++) {
          const ступень = new THREE.Mesh(new THREE.BoxGeometry(26 - i * 3, 0.35, 1.6), MAT.stone);
          ступень.position.set(0, 0.17 + i * 0.35, 4 + i * 1.6);
          ступень.receiveShadow = true;
          g.add(ступень);
        }
        break;
      }
      case 'outpost': {
        // Застава на краю: две глухие стены с севера и юга, одна сторожевая
        // башня и сигнальный шест. С запада и востока въезд открыт - иначе
        // застава читалась бы глухой коробкой, а не воротами края.
        const сторона = t.radius * 0.78;
        for (const dz of [-1, 1]) {
          const стена = new THREE.Mesh(new THREE.BoxGeometry(сторона * 2, 3.4, 1.1), MAT.sandstoneDark);
          стена.position.set(0, 1.7, dz * сторона);
          стена.castShadow = true;
          стена.receiveShadow = true;
          g.add(стена);
          коллайдер(0, dz * сторона, 1.4);
        }
        const башня = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.9, 15, 6), MAT.stone);
        башня.position.set(-сторона, 7.5, сторона * 0.55);
        башня.castShadow = true;
        башня.receiveShadow = true;
        g.add(башня);
        коллайдер(-сторона, сторона * 0.55, 2.4);
        const крыша = new THREE.Mesh(new THREE.ConeGeometry(3.1, 3.6, 6), MAT.sandstone);
        крыша.position.set(-сторона, 16.8, сторона * 0.55);
        крыша.castShadow = true;
        g.add(крыша);
        // Сигнальный шест: у заставы должен быть знак, что сюда доходят.
        const шест = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 9, 6), MAT.wood);
        шест.position.set(сторона * 0.55, 4.5, -сторона * 0.55);
        шест.castShadow = true;
        g.add(шест);
        const флаг = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 0.1), MAT.clothRed);
        флаг.position.set(сторона * 0.55 + 1.3, 8.1, -сторона * 0.55);
        g.add(флаг);
        коллайдер(сторона * 0.55, -сторона * 0.55, 0.5);
        break;
      }
      case 'beacon': {
        // Маяк на западе: земля ровная и пустая, и маяк обязан быть единственным
        // вертикалью на всём горизонте - иначе издалека не видно, что здесь
        // вообще кто-то живёт.
        const высотаМаяка = 26;
        const башня = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 4.4, высотаМаяка, 8), MAT.sandstone);
        башня.position.set(0, высотаМаяка / 2, 0);
        башня.castShadow = true;
        башня.receiveShadow = true;
        g.add(башня);
        коллайдер(0, 0, 3.2);
        // Жаровня: чаша из камня и огонь. Огонь сделан двумя усечёнными
        // конусами разного размера - иначе это была бы серая пирамида.
        const чаша = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.2, 1.4, 8), MAT.stone);
        чаша.position.set(0, высотаМаяка + 0.7, 0);
        чаша.castShadow = true;
        g.add(чаша);
        const пламя = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5.2, 7), MAT.gold);
        пламя.position.set(0, высотаМаяка + 3.8, 0);
        g.add(пламя);
        // Кольцо камней по кругу: маяк виден издалека, но к нему надо
        // подойти, а подход должен чем-то обозначаться.
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const камень = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 1.8 + rnd() * 1.1, 6), MAT.stone);
          const rx = Math.cos(a) * t.radius * 0.66;
          const rz = Math.sin(a) * t.radius * 0.66;
          камень.position.set(rx, 0.9, rz);
          камень.castShadow = true;
          камень.receiveShadow = true;
          g.add(камень);
          коллайдер(rx, rz, 1.1);
        }
        break;
      }
      case 'port': {
        // Причал с лодками: залив должен читаться заливом
        const пирс = new THREE.Group();
        for (let i = 0; i < 5; i++) {
          const plank = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 1.7), MAT.wood);
          plank.position.set(0, 0.5, -i * 1.8);
          plank.castShadow = true;
          пирс.add(plank);
        }
        for (let i = 0; i < 3; i++) {
          const лодка = new THREE.Group();
          const корпус = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.45, 3.2, 7), MAT.wood);
          корпус.rotation.x = Math.PI / 2;
          корпус.scale.y = 0.4;
          лодка.add(корпус);
          лодка.position.set(2.8 + i * 0.5, 0.2, -6 - i * 0.9);
          лодка.rotation.y = 0.3;
          пирс.add(лодка);
        }
        пирс.position.set(-t.radius * 0.5, 0, t.radius * 0.2);
        g.add(пирс);
        break;
      }
    }

    // ── Зелень по кольцу, кроме сектора ворот ──────────────────
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.9;
      if (Math.abs(a - Math.PI / 2) < 0.5) continue;
      деревоКипарис(g, Math.cos(a) * t.radius * 0.86, Math.sin(a) * t.radius * 0.86, 0.95, коллайдер);
    }

    scene.add(g);
  }
}

/**
 * Кипарис для городов регионов.
 *
 * Отдельная функция, а не cypress(), потому что cypress ставит коллайдер
 * в координатах столицы (CITY.x + x): внутри группы нового города все
 * деревья дали бы невидимые коллайдеры в Исфахане. Здесь координаты
 * локальные, а коллайдер считает вызывающий.
 */
function деревоКипарис(
  g: THREE.Group, x: number, z: number, s: number,
  коллайдер: (x: number, z: number, r: number) => void,
): void {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.24 * s, 2.2 * s, 6), MAT.trunk);
  trunk.position.set(x, 1.1 * s, z);
  trunk.castShadow = true;
  g.add(trunk);
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.95 * s, 4.4 * s, 7), MAT.palmLeaf);
  crown.position.set(x, 2.2 * s + 2.2 * s, z);
  crown.castShadow = true;
  g.add(crown);
  коллайдер(x, z, 0.55);
}

/** Финиковая пальма для городов регионов. Причина та же, что у кипариса. */
function деревоФиник(
  g: THREE.Group, x: number, z: number, k: number,
  коллайдер: (x: number, z: number, r: number) => void,
): void {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.17 * k, 0.27 * k, 5.4 * k, 6), MAT.palmTrunk);
  trunk.position.set(x, 2.7 * k, z);
  trunk.castShadow = true;
  g.add(trunk);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.34 * k, 2.6 * k, 4), MAT.palmLeaf);
    leaf.position.set(x + Math.cos(a) * 1 * k, 5.4 * k + 0.15 * k, z + Math.sin(a) * 1 * k);
    leaf.rotation.set(Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25);
    leaf.castShadow = true;
    g.add(leaf);
  }
  коллайдер(x, z, 0.55);
}
