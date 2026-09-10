// ============================================================
// 3D-мир: рельеф, город, лагерь, растительность — Empire of Safavids
// ============================================================
// Бесшовный ландшафт 2400x2400 юнитов на value-noise, дорога от
// города Исфахан к точке возрождения, город с мечетью и минаретами,
// лагерь разбойников у спавна монстров. Один источник правды о
// высоте — terrainHeight(x, z): её же используют персонажи.

import * as THREE from 'three';

export const WORLD_HALF = 1200;         // половина стороны мира
export const CITY = { x: 34, z: 26, radius: 58 };
export const CAMP = { x: 104, z: 82, radius: 16 };

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

/** Высота ландшафта в мировых координатах */
export function terrainHeight(x: number, z: number): number {
  let h = (fbm(x, z) - 0.5) * 16;
  // Дальний хребет по краям мира
  const edge = Math.max(Math.abs(x), Math.abs(z)) / WORLD_HALF;
  h += smoothstep(clamp01((edge - 0.72) / 0.28)) * 55;
  // Плоские площадки: город и точка возрождения, лагерь слегка
  h = flatten(h, x, z, CITY.x, CITY.z, 62, 0.4);
  h = flatten(h, x, z, 0, 0, 26, 0.15);
  h = flatten(h, x, z, CAMP.x, CAMP.z, 22, h * 0.35 + 0.3);
  return h;
}

function flatten(h: number, x: number, z: number, cx: number, cz: number, r: number, level: number): number {
  const d = Math.hypot(x - cx, z - cz);
  const t = smoothstep(clamp01((d - r * 0.55) / (r * 0.45)));
  return level + (h - level) * t;
}

function clamp01(v: number): number { return Math.min(1, Math.max(0, v)); }

/** Высота с учётом городских построек не нужна — персонажи ходят по земле */

export function isRoad(x: number, z: number): boolean {
  // Дорога: город -> точка возрождения -> лагерь (ломаная)
  const seg = (ax: number, az: number, bx: number, bz: number, w: number) => {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / len2);
    const px = ax + dx * t, pz = az + dz * t;
    return Math.hypot(x - px, z - pz) < w;
  };
  return seg(CITY.x, CITY.z, 0, 0, 3.2) || seg(0, 0, CAMP.x, CAMP.z, 2.6) ||
    Math.hypot(x - CITY.x, z - CITY.z) < CITY.radius * 0.8;
}

// ── Материалы ────────────────────────────────────────────────
const MAT = {
  sand: new THREE.MeshStandardMaterial({ color: 0x9c8a66, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x8b8f9a, roughness: 0.95 }),
  sandstone: new THREE.MeshStandardMaterial({ color: 0xc2a878, roughness: 0.9 }),
  sandstoneDark: new THREE.MeshStandardMaterial({ color: 0xa08858, roughness: 0.9 }),
  tealDome: new THREE.MeshStandardMaterial({ color: 0x2e8b8b, roughness: 0.5, metalness: 0.15 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xc9a84c, roughness: 0.35, metalness: 0.7 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6e563a, roughness: 1 }),
  foliage: new THREE.MeshStandardMaterial({ color: 0x3f5a34, roughness: 1 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 1 }),
  white: new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.85 }),
  clothRed: new THREE.MeshStandardMaterial({ color: 0x8b1a1a, roughness: 1 }),
  clothTeal: new THREE.MeshStandardMaterial({ color: 0x2e8b8b, roughness: 1 }),
  clothPurple: new THREE.MeshStandardMaterial({ color: 0x7a5fd0, roughness: 1 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 1 }),
};

// ── Рельеф ───────────────────────────────────────────────────
export function buildTerrain(scene: THREE.Scene): THREE.Mesh {
  const SIZE = WORLD_HALF * 2;
  const SEG = 170;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const cSand = new THREE.Color(0x9c8a66);
  const cGrass = new THREE.Color(0x5d7345);
  const cRock = new THREE.Color(0x7d828e);
  const cRoad = new THREE.Color(0xb59d72);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);

    // Цвет: песок -> трава по шуму и высоте; скалы на крутом подъёме
    const g = clamp01(fbm(x + 700, z - 300) * 1.6 - 0.55) * clamp01((h + 2) / 5);
    tmp.copy(cSand).lerp(cGrass, g * 0.85);
    if (h > 18) tmp.lerp(cRock, clamp01((h - 18) / 22));
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

// ── Растительность и камни (InstancedMesh) ───────────────────
export function buildScatter(scene: THREE.Scene): void {
  const rng = (() => { let s = 42; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const spots: { x: number; z: number; h: number }[] = [];
  for (let i = 0; i < 2600 && spots.length < 900; i++) {
    const x = (rng() * 2 - 1) * (WORLD_HALF - 80);
    const z = (rng() * 2 - 1) * (WORLD_HALF - 80);
    const dCity = Math.hypot(x - CITY.x, z - CITY.z);
    const dSpawn = Math.hypot(x, z);
    if (dCity < CITY.radius + 6 || dSpawn < 14) continue;
    if (isRoad(x, z)) continue;
    spots.push({ x, z, h: terrainHeight(x, z) });
  }

  // Камни
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rocks = new THREE.InstancedMesh(rockGeo, MAT.stone, 170);
  rocks.castShadow = true; rocks.receiveShadow = true;
  // Стволы
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3.2, 6);
  const trunks = new THREE.InstancedMesh(trunkGeo, MAT.trunk, 260);
  trunks.castShadow = true;
  // Кроны: два яруса конусов
  const crownGeo = new THREE.ConeGeometry(1.7, 3.4, 7);
  const crowns = new THREE.InstancedMesh(crownGeo, MAT.foliage, 260);
  crowns.castShadow = true;
  // Пучки травы
  const tuftGeo = new THREE.ConeGeometry(0.5, 1.1, 5);
  const tufts = new THREE.InstancedMesh(tuftGeo, MAT.foliage, 420);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let ri = 0, ti = 0, gi = 0;

  for (const s of spots) {
    const r = rng();
    if (r < 0.2 && ri < 170) {
      const k = 0.6 + rng() * 1.6;
      m.compose(v.set(s.x, s.h + k * 0.25, s.z), q.setFromEuler(new THREE.Euler(rng() * 0.4, rng() * Math.PI, 0)), sc.set(k, k * 0.75, k));
      rocks.setMatrixAt(ri++, m);
    } else if (r < 0.5 && ti < 260) {
      const k = 0.8 + rng() * 0.9;
      m.compose(v.set(s.x, s.h + 1.6 * k, s.z), q.identity(), sc.set(k, k, k));
      trunks.setMatrixAt(ti, m);
      m.compose(v.set(s.x, s.h + 3.6 * k, s.z), q.setFromEuler(new THREE.Euler(0, rng() * Math.PI, 0)), sc.set(k, k, k));
      crowns.setMatrixAt(ti, m);
      ti++;
    } else if (gi < 420) {
      const k = 0.7 + rng() * 0.9;
      m.compose(v.set(s.x, s.h + 0.4 * k, s.z), q.identity(), sc.set(k, k, k));
      tufts.setMatrixAt(gi++, m);
    }
  }
  rocks.count = ri; trunks.count = ti; crowns.count = ti; tufts.count = gi;
  scene.add(rocks, trunks, crowns, tufts);
}

// ── Город Исфахан ────────────────────────────────────────────
export function buildCity(scene: THREE.Scene): THREE.Group {
  const city = new THREE.Group();
  const baseY = terrainHeight(CITY.x, CITY.z);
  city.position.set(CITY.x, baseY, CITY.z);
  COLLIDERS.length = 0; // город строится один раз за сессию мира

  // Площадь
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(CITY.radius * 0.92, CITY.radius, 0.5, 36), MAT.sandstone);
  plaza.position.y = 0.05;
  plaza.receiveShadow = true;
  city.add(plaza);

  // Стены восьмиугольником с воротами к точке возрождения
  const wallSeg = new THREE.BoxGeometry(CITY.radius * 0.82, 6, 2.4);
  const gateAngle = Math.atan2(-CITY.z, -CITY.x); // направление к (0,0)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    // пропуск сегмента у ворот
    let da = Math.abs(((a - gateAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da < 0.45) continue;
    const w = new THREE.Mesh(wallSeg, MAT.sandstoneDark);
    w.position.set(Math.cos(a) * CITY.radius, 3, Math.sin(a) * CITY.radius);
    w.rotation.y = -a + Math.PI / 2;
    w.castShadow = true; w.receiveShadow = true;
    city.add(w);
    // Коллайдеры вдоль сегмента (стена ~48 юнитов длиной)
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
  // портал с аркой
  const portal = new THREE.Mesh(new THREE.BoxGeometry(7, 12, 2), MAT.sandstoneDark);
  portal.position.set(0, 6, 9.4);
  const arch = new THREE.Mesh(new THREE.BoxGeometry(3.4, 6, 0.8), MAT.dark);
  arch.position.set(0, 3, 10.5);
  mosque.add(portal, arch);
  // купол (луковица: сфера, сплюснутая и заострённая)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(7.5, 18, 14), MAT.tealDome);
  dome.scale.set(1, 1.15, 1);
  dome.position.y = 12.5;
  const domeSpike = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3, 8), MAT.gold);
  domeSpike.position.y = 21.6;
  mosque.add(dome, domeSpike);
  // два минарета
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

  // Жилые дома с куполами
  const rng = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const canopies = [MAT.clothRed, MAT.clothTeal, MAT.clothPurple];
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const r = 16 + rng() * 30;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x, z + 8) < 17) continue; // не заступать в мечеть
    const house = new THREE.Group();
    const w = 4 + rng() * 4, h = 3 + rng() * 2.5;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.9), MAT.sandstone);
    body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true;
    const domeR = Math.min(w, h * 1.4) * 0.55;
    const hd = new THREE.Mesh(new THREE.SphereGeometry(domeR, 10, 8), rng() > 0.6 ? MAT.tealDome : MAT.sandstoneDark);
    hd.scale.y = 0.72;
    hd.position.y = h;
    house.add(body, hd);
    house.position.set(x, 0.25, z);
    house.rotation.y = rng() * Math.PI;
    city.add(house);
    addCollider(CITY.x + x, CITY.z + z, Math.max(2.4, w * 0.62));
  }

  // Базарные прилавки у мечети
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * 0.6 + (i / 7) * Math.PI * 0.8;
    const x = Math.cos(a) * 20, z = -8 + Math.sin(a) * 20;
    const stall = new THREE.Group();
    const table = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 1.6), MAT.wood);
    table.position.y = 0.8; table.castShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 2.4), canopies[i % 3]);
    roof.position.y = 2.6; roof.rotation.x = 0.16;
    const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 5), MAT.wood);
    p1.position.set(-1.4, 1.3, -0.8);
    const p2 = p1.clone(); p2.position.x = 1.4;
    stall.add(table, roof, p1, p2);
    stall.position.set(x, 0.3, z);
    stall.rotation.y = -a + Math.PI / 2;
    city.add(stall);
    addCollider(CITY.x + x, CITY.z + z, 1.8);
  }

  // Городские фонари-чаши (металл) — свет добавляет world3d
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

  // Коллайдер мечети (24x18 в локальных -8): сетка цилиндров
  for (const mx of [-9, -3, 3, 9]) {
    for (const mz of [-14.5, -8, -1.5]) {
      addCollider(CITY.x + mx, CITY.z - 8 + mz, 4.4);
    }
  }
  // Портал мечети
  addCollider(CITY.x, CITY.z + 1.6, 3.4);

  city.userData.lights = lights;
  scene.add(city);
  return city;
}

// ── Лагерь разбойников ───────────────────────────────────────
export function buildCamp(scene: THREE.Scene): void {
  const camp = new THREE.Group();
  const baseY = terrainHeight(CAMP.x, CAMP.z);
  camp.position.set(CAMP.x, baseY, CAMP.z);
  // Шатры
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
  // Кострище
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
