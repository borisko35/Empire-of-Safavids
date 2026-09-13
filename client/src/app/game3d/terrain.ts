// ============================================================
// 3D-мир: рельеф, биомы, вода, города — Empire of Safavids
// ============================================================
// Бесшовный ландшафт 2400x2400: поля вокруг Исфахана, пустыня с
// дюнами на востоке, лес на северо-западе, северный хребет со
// снежными шапками, озеро с рекой и водопадом. Биомы красят рельеф
// и выбирают флору/фауну. groundHeight() — единственный источник
// высоты для сущностей: билинейная интерполяция видимого меша
// + плита городской площади (иначе персонажи проваливаются).

import * as THREE from 'three';
import {
  sandTexture, plasterTexture, stoneTexture, mosaicTexture, plazaTexture, woodTexture,
  waterTexture, waterfallTexture,
} from './textures';

export const WORLD_HALF = 1200;         // половина стороны мира
export const CITY = { x: 34, z: 26, radius: 58 };
export const CAMP = { x: 104, z: 82, radius: 16 };

// ── Вода и достопримечательности ─────────────────────────────
export const LAKE = { x: -420, z: -160, r: 170, level: -2.0 };
export const POND = { x: 620, z: 300, r: 70, level: -1.6 };   // оазис в пустыне
export const WATERFALL = { x: -352, z: -568, width: 11, height: 15 };
// Река: хребет -> озеро; озеро -> оазис
export const RIVER_A: { x: number; z: number }[] = [
  { x: -350, z: -575 }, { x: -368, z: -470 }, { x: -398, z: -310 }, { x: -412, z: -220 },
];
export const RIVER_B: { x: number; z: number }[] = [
  { x: -300, z: 20 }, { x: -140, z: 120 }, { x: 120, z: 200 }, { x: 380, z: 270 }, { x: 540, z: 292 },
];

// ── Поселения (координаты мировые) ───────────────────────────
export const PORT = { x: -225, z: -150, radius: 26, level: -0.6 };     // приозёрный порт
export const CARAVANSERAI = { x: 505, z: 55, radius: 30, level: 1.2 }; // караван-сарай в пустыне
export const VILLAGE = { x: -495, z: -415, radius: 26, level: 2.0 };   // лесная деревня
export const FORT = { x: -320, z: -705, radius: 28, level: 22 };       // горный форт

export type Biome = 'desert' | 'forest' | 'field' | 'mountain' | 'water';

/** Цилиндрические коллайдеры построек: персонаж и камера их уважают */
export const COLLIDERS: { x: number; z: number; r: number }[] = [];

function addCollider(x: number, z: number, r: number): void {
  COLLIDERS.push({ x, z, r });
}

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

/** Лес: северо-запад вокруг деревни */
export function forestMask(x: number, z: number): number {
  return clamp01(1 - Math.hypot(x + 460, z + 330) / 360) * clamp01((z + 120) / 200);
}

/** Северный хребет (внутренний, кроме краевого) */
function ridgeMask(x: number, z: number): number {
  return smoothstep(clamp01((-z - 430) / 220)) * clamp01(1 - desertMask(x, z) * 0.8);
}

/** Расстояние до оси реки (обе ветки) в условных единицах */
function riverInfo(x: number, z: number): { d: number } {
  let best = 1e9;
  const seg = (ax: number, az: number, bx: number, bz: number) => {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / len2);
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  };
  for (let i = 0; i < RIVER_A.length - 1; i++) {
    seg(RIVER_A[i].x, RIVER_A[i].z, RIVER_A[i + 1].x, RIVER_A[i + 1].z);
  }
  for (let i = 0; i < RIVER_B.length - 1; i++) {
    seg(RIVER_B[i].x, RIVER_B[i].z, RIVER_B[i + 1].x, RIVER_B[i + 1].z);
  }
  return { d: best };
}

/** Маска воды: 1 в центре русла/озера, 0 на берегу */
export function waterMask(x: number, z: number): number {
  let m = 0;
  m = Math.max(m, clamp01(1 - Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.r));
  m = Math.max(m, clamp01(1 - Math.hypot(x - POND.x, z - POND.z) / POND.r));
  const { d } = riverInfo(x, z);
  m = Math.max(m, clamp01(1 - (d - 3) / 13));
  return m;
}

function flatten(h: number, x: number, z: number, cx: number, cz: number, r: number, level: number): number {
  const d = Math.hypot(x - cx, z - cz);
  const t = smoothstep(clamp01((d - r * 0.55) / (r * 0.45)));
  return level + (h - level) * t;
}

/** Высота ландшафта в мировых координатах (форма меша) */
export function terrainHeight(x: number, z: number): number {
  let h = (fbm(x, z) - 0.5) * 16;
  // Дальний хребет по краям мира
  const edge = Math.max(Math.abs(x), Math.abs(z)) / WORLD_HALF;
  h += smoothstep(clamp01((edge - 0.72) / 0.28)) * 55;
  // Северный хребет со скалистыми пиками
  const ridge = ridgeMask(x, z);
  h += ridge * (26 + fbm(x / 150 + 9, z / 150 - 4) * 34);
  // Дюны пустыни
  const dm = desertMask(x, z);
  h = h * (1 - dm * 0.55) + dm * 0.55 * (1.5 + Math.sin(x * 0.021 + fbm(x / 60, z / 60) * 4) * 2.6 + (fbm(x / 25, z / 25) - 0.5) * 3);
  // Плоские площадки: город, возрождение, лагерь, поселения
  h = flatten(h, x, z, CITY.x, CITY.z, 62, 0.4);
  h = flatten(h, x, z, 0, 0, 26, 0.15);
  h = flatten(h, x, z, CAMP.x, CAMP.z, 22, h * 0.35 + 0.3);
  h = flatten(h, x, z, PORT.x, PORT.z, PORT.radius, PORT.level);
  h = flatten(h, x, z, CARAVANSERAI.x, CARAVANSERAI.z, CARAVANSERAI.radius, CARAVANSERAI.level);
  h = flatten(h, x, z, VILLAGE.x, VILLAGE.z, VILLAGE.radius, VILLAGE.level);
  h = flatten(h, x, z, FORT.x, FORT.z, FORT.radius, FORT.level);
  // Русла и озёра: русло углубляется до дна (в хребте это даёт ущелье и водопад)
  const w = waterMask(x, z);
  if (w > 0) {
    const bed = (w > 0.55 ? LAKE.level : LAKE.level) - 3.2;
    h = h * (1 - w) + bed * w;
  }
  return h;
}

const TERRAIN_SEG = 170;

/**
 * Высота видимой поверхности в точке: билинейная интерполяция вершин
 * меша рельефа + плита городской площади. Именно её должны использовать
 * персонажи, NPC и животные — иначе проваливаются между вершинами.
 */
export function groundHeight(x: number, z: number): number {
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
  let h = (h00 * (1 - lx) + h10 * lx) * (1 - lz) + (h01 * (1 - lx) + h11 * lx) * lz;

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

/** Пальма: изогнутый ствол + веер листьев */
function addPalm(parent: THREE.Object3D, x: number, z: number, k = 1): void {
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
}

// ── Город Исфахан ────────────────────────────────────────────
export function buildCity(scene: THREE.Scene): THREE.Group {
  const city = new THREE.Group();
  const baseY = groundHeight(CITY.x, CITY.z);
  city.position.set(CITY.x, baseY, CITY.z);
  COLLIDERS.length = 0; // город строится один раз за сессию мира

  const gateAngle = Math.atan2(-CITY.z, -CITY.x); // направление к точке возрождения (0,0)

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

  // Городские ворота: две башни + арка в сторону точки возрождения
  {
    const gx = Math.cos(gateAngle) * CITY.radius, gz = Math.sin(gateAngle) * CITY.radius;
    const dirX = Math.cos(gateAngle + Math.PI / 2), dirZ = Math.sin(gateAngle + Math.PI / 2);
    for (const side of [-1, 1]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 12, 10), MAT.sandstoneDark);
      tower.position.set(gx + dirX * side * 5.2, 6, gz + dirZ * side * 5.2);
      tower.castShadow = true;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(3.1, 2.6, 10), MAT.tealDome);
      cap.position.set(gx + dirX * side * 5.2, 13.3, gz + dirZ * side * 5.2);
      city.add(tower, cap);
      addCollider(CITY.x + gx + dirX * side * 5.2, CITY.z + gz + dirZ * side * 5.2, 3.4);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(11.6, 1.8, 2.6), MAT.sandstone);
    lintel.position.set(gx, 10.5, gz);
    lintel.rotation.y = -gateAngle;
    lintel.castShadow = true;
    const keystone = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.5, 10), MAT.tealDome);
    keystone.position.set(gx, 11.8, gz);
    keystone.rotation.x = Math.PI / 2;
    keystone.rotation.z = -gateAngle;
    city.add(lintel, keystone);
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

  // Стены восьмиугольником с воротами к точке возрождения
  const wallSeg = new THREE.BoxGeometry(CITY.radius * 0.82, 6, 2.4);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    let da = Math.abs(((a - gateAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da < 0.45) continue;
    const w = new THREE.Mesh(wallSeg, MAT.sandstoneDark);
    w.position.set(Math.cos(a) * CITY.radius, 3, Math.sin(a) * CITY.radius);
    w.rotation.y = -a + Math.PI / 2;
    w.castShadow = true; w.receiveShadow = true;
    city.add(w);
    const theta = -a + Math.PI / 2;
    const dirX = Math.cos(theta), dirZ = -Math.sin(theta);
    const cx0 = CITY.x + Math.cos(a) * CITY.radius;
    const cz0 = CITY.z + Math.sin(a) * CITY.radius;
    for (const k of [-20, -10, 0, 10, 20]) {
      addCollider(cx0 + dirX * k, cz0 + dirZ * k, 2.2);
    }
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

  // Жилые дома: купольные одно- и двухэтажные, с балконами
  const rng = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const canopies = [MAT.clothRed, MAT.clothTeal, MAT.clothPurple];
  // Занятые места площади: мечеть, фонтан, прилавки, аркада, NPC —
  // дома ставятся только с учётом дистанции до них (см. проверку ниже)
  const placed: { x: number; z: number; r: number }[] = [
    { x: 0, z: -8, r: 13.5 }, // мечеть
    { x: 6, z: 6, r: 5.5 },   // фонтан
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
  for (let i = 0; i < 20; i++) {
    const a = rng() * Math.PI * 2;
    const r = 16 + rng() * 30;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = 4 + rng() * 4, h = 3 + rng() * 2.5;
    // Занятые места: мечеть, фонтан, прилавки, аркада, NPC (npc.ts).
    // Дома не должны прилипать друг к другу и к постройкам.
    const houseR = Math.max(2.4, w * 0.62);
    if (placed.some(p => Math.hypot(p.x - x, p.z - z) < p.r + houseR + 1.4)) continue;
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
    house.position.set(x, 0.25, z);
    house.rotation.y = rng() * Math.PI;
    city.add(house);
    addCollider(CITY.x + x, CITY.z + z, Math.max(2.4, w * 0.62));
  }

  // Базарные прилавки с товаром у мечети
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * 0.6 + (i / 7) * Math.PI * 0.8;
    const x = Math.cos(a) * 20, z = -8 + Math.sin(a) * 20;
    const stall = buildStall(i % 3, canopies);
    stall.position.set(x, 0.3, z);
    stall.rotation.y = -a + Math.PI / 2;
    city.add(stall);
    addCollider(CITY.x + x, CITY.z + z, 1.8);
  }

  // Пальмы у базара и вдоль улицы к воротам
  addPalm(city, 24, -14, 1);
  addPalm(city, -22, 12, 0.9);
  addPalm(city, -2, 30, 1.05);
  addPalm(city, 12, 26, 0.85);
  addPalm(city, -12, 24, 0.95);

  // Городские фонари-чаши
  const lights: { x: number; z: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * CITY.radius * 0.55, z = Math.sin(a) * CITY.radius * 0.55;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 4.4, 6), MAT.dark);
    pole.position.set(x, 2.4, z);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.3, 0.5, 8), MAT.gold);
    bowl.position.set(x, 4.8, z);
    city.add(pole, bowl);
    lights.push({ x: CITY.x + x, z: CITY.z + z });
  }

  // Коллайдер мечети — строго по корпусу здания (24×18 в локальных -8):
  // ряды внутри контура, ничего не торчит за стену (иначе «невидимая
  // стена» сзади мечети, где стоят Хафиз и Мевлана)
  for (const mx of [-9, -3, 3, 9]) {
    for (const mz of [-5, 0, 5]) {
      addCollider(CITY.x + mx, CITY.z - 8 + mz, 4.4);
    }
  }
  // Портал-арка — коллайдер по её положению (локальный z 9.4), а не
  // между аркой и зданием (перекрывал проход)
  addCollider(CITY.x, CITY.z + 9.4, 2.2);

  city.userData.lights = lights;
  scene.add(city);
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
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.9), MAT.wood);
      body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.8, 1.6, 4), MAT.clothTeal);
      roof.position.y = h + 0.8; roof.rotation.y = Math.PI / 4;
      house.add(body, roof);
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
    // бочки
    for (let i = 0; i < 4; i++) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.7, 8), MAT.wood);
      barrel.position.set(-8 + rng() * 4, 0.55, 4 + rng() * 6);
      barrel.castShadow = true;
      g.add(barrel);
    }
    // маячок-фонарь
    const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 5.2, 6), MAT.dark);
    lampPost.position.set(-10, 2.8, -4);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffd980, emissive: 0xffa530, emissiveIntensity: 1.2 }));
    lamp.position.set(-10, 5.6, -4);
    g.add(lampPost, lamp);
    addCollider(PORT.x - 10, PORT.z - 4, 0.6);
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
    const gateL = new THREE.Mesh(new THREE.BoxGeometry(1.6, 4.6, 1.6), MAT.sandstoneDark);
    gateL.position.set(-11, 2.3, 14);
    const gateR = gateL.clone(); gateR.position.x = 11;
    const archTop = new THREE.Mesh(new THREE.BoxGeometry(24, 1, 1.8), MAT.sandstone);
    archTop.position.set(0, 4.9, 14);
    g.add(gateL, gateR, archTop);
    addCollider(CARAVANSERAI.x - 11, CARAVANSERAI.z + 14, 1.4);
    addCollider(CARAVANSERAI.x + 11, CARAVANSERAI.z + 14, 1.4);
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
    // стог сена
    const hay = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0xc8a84c, roughness: 1 }));
    hay.position.set(8, 1.3, 7);
    hay.castShadow = true;
    g.add(hay);
    addCollider(VILLAGE.x + 8, VILLAGE.z + 7, 1.7);
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
    scene.add(g);
  }
}
