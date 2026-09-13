// ============================================================
// 3D-мир: рельеф, город, лагерь, растительность — Empire of Safavids
// ============================================================
// Бесшовный ландшафт 2400x2400 юнитов на value-noise, дорога от
// города Исфахан к точке возрождения, город с мечетью и минаретами,
// лагерь разбойников у спавна монстров. Один источник правды о
// высоте — terrainHeight(x, z): её же используют персонажи.

import * as THREE from 'three';
import {
  sandTexture, plasterTexture, stoneTexture, mosaicTexture, plazaTexture, woodTexture,
} from './textures';

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
  foliageLight: new THREE.MeshStandardMaterial({ color: 0x5d7a3c, roughness: 1 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 1 }),
  palmTrunk: new THREE.MeshStandardMaterial({ color: 0x7a6244, roughness: 1 }),
  palmLeaf: new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 1, side: THREE.DoubleSide }),
  white: new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.85 }),
  clothRed: new THREE.MeshStandardMaterial({ color: 0x8b1a1a, roughness: 1 }),
  clothTeal: new THREE.MeshStandardMaterial({ color: 0x2e8b8b, roughness: 1 }),
  clothPurple: new THREE.MeshStandardMaterial({ color: 0x7a5fd0, roughness: 1 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 1 }),
  water: new THREE.MeshStandardMaterial({ color: 0x3f7fa8, roughness: 0.15, metalness: 0.55, transparent: true, opacity: 0.85 }),
  flower: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
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
  for (let i = 0; i < 4200 && spots.length < 1400; i++) {
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
  const rocks = new THREE.InstancedMesh(rockGeo, MAT.stone, 180);
  rocks.castShadow = true; rocks.receiveShadow = true;
  // Стволы
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3.2, 6);
  const trunks = new THREE.InstancedMesh(trunkGeo, MAT.trunk, 340);
  trunks.castShadow = true;
  // Кроны двух типов: конус (кипарис) и шар (платан)
  const crownGeo = new THREE.ConeGeometry(1.7, 3.4, 7);
  const crowns = new THREE.InstancedMesh(crownGeo, MAT.foliage, 340);
  crowns.castShadow = true;
  const crown2Geo = new THREE.SphereGeometry(1.9, 8, 6);
  const crowns2 = new THREE.InstancedMesh(crown2Geo, MAT.foliageLight, 340);
  crowns2.castShadow = true;
  // Пучки травы
  const tuftGeo = new THREE.ConeGeometry(0.5, 1.1, 5);
  const tufts = new THREE.InstancedMesh(tuftGeo, MAT.foliage, 900);
  // Цветы: маленькие шары с индивидуальным цветом
  const flowerGeo = new THREE.SphereGeometry(0.12, 5, 4);
  const flowers = new THREE.InstancedMesh(flowerGeo, MAT.flower, 700);
  const flowerStemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4);
  const flowerStems = new THREE.InstancedMesh(flowerStemGeo, MAT.foliageLight, 700);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const color = new THREE.Color();
  const flowerColors = [0xe85a6a, 0xe8c94a, 0xd07ae8, 0xf0f0e0, 0xe88a4a];
  let ri = 0, ti = 0, gi = 0, fi = 0;

  for (const s of spots) {
    const r = rng();
    if (r < 0.18 && ri < 180) {
      const k = 0.6 + rng() * 1.6;
      m.compose(v.set(s.x, s.h + k * 0.25, s.z), q.setFromEuler(new THREE.Euler(rng() * 0.4, rng() * Math.PI, 0)), sc.set(k, k * 0.75, k));
      rocks.setMatrixAt(ri++, m);
    } else if (r < 0.44 && ti < 340) {
      const k = 0.8 + rng() * 1.1;
      m.compose(v.set(s.x, s.h + 1.6 * k, s.z), q.identity(), sc.set(k, k, k));
      trunks.setMatrixAt(ti, m);
      if (rng() < 0.55) {
        // кипарис: узкая высокая крона
        m.compose(v.set(s.x, s.h + 3.9 * k, s.z), q.setFromEuler(new THREE.Euler(0, rng() * Math.PI, 0)), sc.set(k * 0.8, k * 1.25, k * 0.8));
        crowns.setMatrixAt(ti, m);
        m.compose(v.set(0, -9999, 0), q.identity(), sc.set(0.001, 0.001, 0.001));
        crowns2.setMatrixAt(ti, m);
      } else {
        // платан: шарообразная крона
        m.compose(v.set(0, -9999, 0), q.identity(), sc.set(0.001, 0.001, 0.001));
        crowns.setMatrixAt(ti, m);
        m.compose(v.set(s.x, s.h + 3.7 * k, s.z), q.identity(), sc.set(k * 1.05, k, k * 1.05));
        crowns2.setMatrixAt(ti, m);
      }
      ti++;
    } else if (r < 0.75 && gi < 900) {
      const k = 0.7 + rng() * 0.9;
      m.compose(v.set(s.x, s.h + 0.4 * k, s.z), q.identity(), sc.set(k, k, k));
      tufts.setMatrixAt(gi++, m);
    } else if (fi < 700) {
      // цветок: стебель + цветная головка
      const k = 0.8 + rng() * 0.7;
      m.compose(v.set(s.x, s.h + 0.25 * k, s.z), q.identity(), sc.set(k, k, k));
      flowerStems.setMatrixAt(fi, m);
      m.compose(v.set(s.x, s.h + 0.55 * k, s.z), q.identity(), sc.set(k, k, k));
      flowers.setMatrixAt(fi, m);
      color.setHex(flowerColors[Math.floor(rng() * flowerColors.length)]);
      flowers.setColorAt(fi, color);
      fi++;
    }
  }
  rocks.count = ri; trunks.count = ti; crowns.count = ti; crowns2.count = ti;
  tufts.count = gi; flowers.count = fi; flowerStems.count = fi;
  if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
  scene.add(rocks, trunks, crowns, crowns2, tufts, flowers, flowerStems);
}

/** Пальма: изогнутый ствол + веер листьев (в городе, у базара) */
function addPalm(parent: THREE.Group, x: number, z: number, k = 1): void {
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
  // кокосы
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.12 * k, 6, 5), MAT.trunk);
    nut.position.set(topX + (Math.random() - 0.5) * 0.4 * k, topY - 0.25 * k, (Math.random() - 0.5) * 0.4 * k);
    palm.add(nut);
  }
  palm.position.set(x, 0.25, z);
  parent.add(palm);
}

// ── Город Исфахан ────────────────────────────────────────────
export function buildCity(scene: THREE.Scene): THREE.Group {
  const city = new THREE.Group();
  const baseY = terrainHeight(CITY.x, CITY.z);
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
    // арка над проёмом
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

  // Базарная аркада: ряд арок вдоль улицы к воротам
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
      // навесы-полотна между арками
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

  // Жилые дома: купольные одно- и двухэтажные, с балконами
  const rng = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const canopies = [MAT.clothRed, MAT.clothTeal, MAT.clothPurple];
  for (let i = 0; i < 20; i++) {
    const a = rng() * Math.PI * 2;
    const r = 16 + rng() * 30;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x, z + 8) < 17) continue; // не заступать в мечеть
    if (Math.hypot(x - 6, z - 6) < 6.5) continue; // и в фонтан
    const house = new THREE.Group();
    const w = 4 + rng() * 4, h = 3 + rng() * 2.5;
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
    // окно-арка на фасаде (тёмная ниша)
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
    const stall = new THREE.Group();
    const table = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 1.6), MAT.wood);
    table.position.y = 0.8; table.castShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 2.4), canopies[i % 3]);
    roof.position.y = 2.6; roof.rotation.x = 0.16;
    const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 5), MAT.wood);
    p1.position.set(-1.4, 1.3, -0.8);
    const p2 = p1.clone(); p2.position.x = 1.4;
    stall.add(table, roof, p1, p2);
    // товар: кувшины, ящики, рулоны ткани
    const kind = i % 3;
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
        const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 8), canopies[(i + j) % 3]);
        roll.rotation.z = Math.PI / 2;
        roll.position.set(-0.7 + j * 0.7, 1.42, 0.2);
        stall.add(roll);
      }
    }
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
