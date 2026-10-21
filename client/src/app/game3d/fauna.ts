// ============================================================
// Фауна по биомам — Empire of Safavids
// ============================================================
// Атмосферные существа без серверной логики. Точка спавна выбирает
// биом: пустыня — верблюды и ящерицы, лес — олени и лисы, поля —
// зайцы и овцы, горы — горные козлы, вода — косяки рыб с кругами
// на поверхности. Блуждающая логика: цель в радиусе дома, паузы.

import * as THREE from 'three';
import { CITY, CAMP, LAKE, POND, RIVER_A, RIVER_B, groundHeight, biomeAt, waterMask, waterSurfaceY, FAUNA_COLLIDERS, COLLIDERS } from './terrain';
import { furTexture, furNormalTexture } from './textures';

/**
 * Материалы зверей — с шерстью.
 *
 * Материал на каждую часть тела — это десятки материалов на зверя и мусор в
 * памяти. Материалы кэшируются по цвету и шероховатости: их десятки, а не
 * сотни.
 */
const МАТЕРИАЛЫ = new Map<string, THREE.MeshStandardMaterial>();
const mat = (color: number, rough = 0.9): THREE.MeshStandardMaterial => {
  const ключ = `${color}:${rough}`;
  let м = МАТЕРИАЛЫ.get(ключ);
  if (!м) {
    const hex = '#' + color.toString(16).padStart(6, '0');
    м = new THREE.MeshStandardMaterial({
      color,
      roughness: rough,
      map: furTexture(hex, 2),
      normalMap: furNormalTexture(2),
      normalScale: new THREE.Vector2(0.5, 0.5),
    });
    МАТЕРИАЛЫ.set(ключ, м);
  }
  return м;
};

interface Walker {
  group: THREE.Group;
  legs: THREE.Object3D[];
  home: { x: number; z: number; r: number };
  target: { x: number; z: number };
  speed: number;
  idleUntil: number;
  phase: number;
  /** Радиус тела для коллайдера с игроком. */
  radius: number;
}

interface Flock {
  pivot: THREE.Group;
  angle: number;
  radius: number;
  speed: number;
  birds: { group: THREE.Group; wingL: THREE.Mesh; wingR: THREE.Mesh; offset: number }[];
}

interface FishSchool {
  pivot: THREE.Group;
  angle: number;
  radius: number;
  speed: number;
  level: number;
  fish: THREE.Group[];
}

interface Splash {
  mesh: THREE.Mesh;
  born: number;
}

/**
 * Четвероногий зверь (§286).
 *
 * БЫЛО: тело — ящик 0.9×0.5×0.45, голова — куб, ноги — тонкие бруски, уши и
 * рога — конусы. В кадре это читалось как картонная коробка на палочках: на
 * кадре §286 горный козёл выглядел именно так.
 *
 * ТЕПЕРЬ: тело — капсула (грудь, спина, сужение к шее), шея и голова — тоже
 * капсулы, морда — сужающийся цилиндр, глаза и копыта — тёмные, ноги — из
 * двух сужающихся звеньев с копытом и коленом, хвост — сужающийся цилиндр,
 * рога — изогнутые дуги. Нога качается от бедра, а не от середины.
 *
 * Ось тела — X, голова в +X (так же, как было): от этого зависит разбег по
 * миру.
 */
function makeQuadruped(
  bodyColor: number, headColor: number, scale = 1, opts?: { hump?: boolean; tall?: boolean; fluffy?: boolean; antlers?: boolean },
): { group: THREE.Group; legs: THREE.Object3D[] } {
  const g = new THREE.Group();
  const legH = opts?.tall ? 0.42 : 0.32;
  const мех = mat(bodyColor);
  const мехГоловы = mat(headColor);
  const тёмный = mat(0x2b2521, 0.7);
  const рогМатериал = mat(0x6e563a, 0.65);

  // ТЕЛО. Капсула: у зверя есть грудь и круп, а ящик был угловатым ящиком.
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(opts?.fluffy ? 0.32 : 0.27, opts?.fluffy ? 0.38 : 0.56, 4, 12),
    мех,
  );
  body.rotation.z = Math.PI / 2; // ось капсулы вдоль X
  body.position.set(0, legH + 0.3, 0);
  body.scale.set(1, 1, opts?.fluffy ? 0.94 : 0.84); // тело уже, чем в высоту
  body.castShadow = true;
  g.add(body);

  // ШЕЯ. Тянется вверх-вперёд из плеча.
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.16, 3, 8), мех);
  neck.position.set(0.33, legH + 0.56, 0);
  neck.rotation.z = -0.75;
  neck.castShadow = true;
  g.add(neck);

  // ГОЛОВА — капсула вдоль X, морда — сужающийся цилиндр.
  const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.11, 3, 10), мехГоловы);
  head.rotation.z = Math.PI / 2;
  head.position.set(0.5, legH + 0.68, 0);
  head.castShadow = true;
  g.add(head);
  const морда = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.09, 0.22, 8), тёмный);
  морда.rotation.z = -Math.PI / 2;
  морда.position.set(0.68, legH + 0.62, 0);
  g.add(морда);

  // ГЛАЗА: тёмные точки по бокам головы — без них голова читается как кусок.
  for (const side of [-1, 1]) {
    const глаз = new THREE.Mesh(new THREE.SphereGeometry(0.024, 6, 5), тёмный);
    глаз.position.set(0.55, legH + 0.73, side * 0.105);
    g.add(глаз);
  }

  // УШИ: конусы, но загнутые назад.
  for (const side of [-1, 1]) {
    const ухо = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.15, 6), мехГоловы);
    ухо.position.set(0.45, legH + 0.82, side * 0.09);
    ухо.rotation.set(side * 0.35, 0, -0.3);
    g.add(ухо);
  }

  if (opts?.hump) {
    // У верблюда ДВА горба, а не один: первый над лопатками, второй над
    // крестцом. Тело вытянуто вдоль оси X (голова на +0.5), поэтому второй
    // горб смещается по X, а не по Z. Раньше второй горб клонировали,
    // ставили ему z = 0 — то есть ровно туда же, где стоит первый, — и
    // НЕ добавляли в группу: он создавался, двигался и молча терялся.
    // В итоге верблюд оставался с одним горбом.
    for (const [gx, sc] of [[0.02, 1.35], [-0.38, 1.2]] as const) {
      const hump = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), мех);
      hump.scale.set(sc, 0.95, 0.9);
      hump.position.set(gx, legH + 0.68, 0);
      hump.castShadow = true;
      g.add(hump);
    }
  }
  if (opts?.antlers) {
    // Рога — изогнутые дуги, а не конусы: у козла и оленя рог загнут назад.
    for (const side of [-1, 1]) {
      const рог = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.028, 6, 14, Math.PI * 0.95), рогМатериал);
      // Дуга лежит в плоскости головы (XY) и загнута назад: без поворота
      // тор лежал плашмя и читался как тёмный блинок на черепе.
      рог.position.set(0.4, legH + 0.84, side * 0.08);
      рог.rotation.set(0, 0, -0.6);
      рог.castShadow = true;
      g.add(рог);
    }
  }
  if (opts?.tall && !opts?.fluffy) {
    // ГРИВА: у оленя и козла она есть, и без неё шея читается как палка.
    const грива = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.2, 3, 6), mat(headColor));
    грива.position.set(0.29, legH + 0.63, 0);
    грива.rotation.z = -0.75;
    грива.scale.set(1, 1, 2.1); // грива — пластина по бокам шеи
    g.add(грива);
  }

  // НОГИ: два сужающихся звена и копыто. Нога качается от бедра — группа
  // стоит в бедре, звенья — её дети.
  const legs: THREE.Object3D[] = [];
  const бедроГео = new THREE.CylinderGeometry(0.075, 0.055, legH * 0.5, 6);
  const голеньГео = new THREE.CylinderGeometry(0.05, 0.038, legH * 0.5, 6);
  const копытоГео = new THREE.CylinderGeometry(0.046, 0.055, 0.06, 6);
  for (const [lx, lz] of [[0.29, 0.13], [0.29, -0.13], [-0.29, 0.13], [-0.29, -0.13]]) {
    const нога = new THREE.Group();
    нога.position.set(lx, legH, lz);
    const бедро = new THREE.Mesh(бедроГео, мех);
    бедро.position.y = -legH * 0.25;
    бедро.castShadow = true;
    const колено = new THREE.Group();
    колено.position.y = -legH * 0.5;
    const голень = new THREE.Mesh(голеньГео, мех);
    голень.position.y = -legH * 0.25;
    голень.rotation.x = 0.14; // небольшой изгиб в суставе
    голень.castShadow = true;
    const копыто = new THREE.Mesh(копытоГео, тёмный);
    копыто.position.y = -(legH * 0.5 - 0.03);
    колено.add(голень, копыто);
    нога.add(бедро, колено);
    g.add(нога);
    legs.push(нога);
  }

  // ХВОСТ: сужающийся конус, у коровы — с кисточкой.
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.045, 0.28, 6), мех);
  tail.position.set(-0.52, legH + 0.4, 0);
  tail.rotation.z = 0.55;
  g.add(tail);

  g.scale.setScalar(scale);
  return { group: g, legs };
}

/**
 * Птица (§286).
 *
 * БЫЛО: тело — конус с четырьмя гранями, крылья — треугольник из трёх
 * вершин, материал без освещения (птица светилась сама, даже в сумерках).
 *
 * ТЕПЕРЬ: тело — капсула, есть голова, клюв и хвост, крыло — изогнутая
 * пластина, материал освещаемый.
 */
function makeBird(wingColor: number, opts?: { flatBeak?: boolean }): { group: THREE.Group; wingL: THREE.Mesh; wingR: THREE.Mesh } {
  const g = new THREE.Group();
  // Крыло: изогнутая пластина. Треугольник из трёх вершин читался как
  // обрывок бумаги, а не как крыло.
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0,
    -0.3, 0.04, 0.17,
    -0.58, 0.02, 0.06,
    -0.26, -0.01, -0.2,
  ]), 3));
  wingGeo.setIndex([0, 1, 2, 0, 2, 3]);
  wingGeo.computeVertexNormals();
  const wingMat = new THREE.MeshStandardMaterial({
    color: wingColor, roughness: 0.85, side: THREE.DoubleSide,
  });
  // Тело: капсула вдоль Z (птица летит носом в -Z).
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.26, 3, 8), wingMat);
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  // Голова и клюв.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), wingMat);
  head.position.set(0, 0.03, -0.2);
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.028, opts?.flatBeak ? 0.1 : 0.13, 5),
    mat(0xc8a45c, 0.6),
  );
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.02, -0.3);
  // Хвост: веер из плоскости.
  const tailGeo = new THREE.BufferGeometry();
  tailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0.1, 0.07, 0, 0.28, -0.07, 0, 0.28,
  ]), 3));
  tailGeo.setIndex([0, 1, 2]);
  tailGeo.computeVertexNormals();
  const tail = new THREE.Mesh(tailGeo, wingMat);
  const wingL = new THREE.Mesh(wingGeo, wingMat);
  const wingR = new THREE.Mesh(wingGeo, wingMat);
  wingR.scale.x = -1;
  g.add(body, head, beak, tail, wingL, wingR);
  return { group: g, wingL, wingR };
}

/**
 * Рыба (§286).
 *
 * БЫЛО: конус. ТЕПЕРЬ: сплюснутое тело и плавник-хвост.
 */
function makeFish(color: number, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const материал = mat(color, 0.45);
  const тело = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.3, 3, 8), материал);
  тело.rotation.x = Math.PI / 2;
  тело.scale.set(1, 0.65, 1);
  const хвост = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 4), материал);
  хвост.rotation.x = Math.PI / 2;
  хвост.position.z = 0.24;
  хвост.scale.set(1, 1, 0.4);
  g.add(тело, хвост);
  g.scale.setScalar(scale);
  return g;
}

export interface FaunaHandle {
  update(dt: number, now: number): void;
  dispose(): void;
}

export function createFauna(scene: THREE.Scene): FaunaHandle {
  const all = new THREE.Group();
  scene.add(all);
  const walkers: Walker[] = [];
  const flocks: Flock[] = [];
  const schools: FishSchool[] = [];
  const splashes: Splash[] = [];

  const addWalker = (g: THREE.Group, legs: THREE.Object3D[], x: number, z: number, speed: number, homeR: number, radius: number, home = { x, z }) => {
    g.position.set(x, groundHeight(x, z), z);
    g.rotation.y = Math.random() * Math.PI * 2;
    all.add(g);
    walkers.push({ group: g, legs, home: { x: home.x, z: home.z, r: homeR }, target: { x, z }, speed, idleUntil: 0, phase: Math.random() * 10, radius });
  };

  // ── Биомные животные: пробные точки по карте ──
  const rng = (() => { let s = 777; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const want: Record<string, number> = { desert: 5, forest: 6, field: 6, mountain: 5 };
  const got: Record<string, number> = {};
  for (let i = 0; i < 900 && Object.entries(want).some(([k, v]) => (got[k] ?? 0) < v); i++) {
    const x = (rng() * 2 - 1) * (WORLD_HALF_SAFE());
    const z = (rng() * 2 - 1) * (WORLD_HALF_SAFE());
    const biome = biomeAt(x, z);
    if ((got[biome] ?? 0) >= (want[biome] ?? 0)) continue;
    // Не спавнить внутри стен Исфахана (город вырос — старые точки накрыло)
    if (Math.hypot(x - CITY.x, z - CITY.z) < CITY.radius + 12) continue;
    if (biome === 'desert') {
      got.desert = (got.desert ?? 0) + 1;
      if (got.desert <= 2) {
        // верблюды: у караван-сарая
        const { group, legs } = makeQuadruped(0xc8a15a, 0xd9b878, 1.15, { hump: true, tall: true });
        const hx = 505 + (rng() - 0.5) * 30, hz = 55 + (rng() - 0.5) * 30;
        addWalker(group, legs, hx, hz, 0.7, 24, 0.9, { x: 505, z: 55 });
      } else {
        // ящерицы: быстрые мелкие
        const { group, legs } = makeQuadruped(0xb09a62, 0xc2ac74, 0.35);
        addWalker(group, legs, x, z, 2.2, 12, 0.35);
      }
    } else if (biome === 'forest') {
      got.forest = (got.forest ?? 0) + 1;
      if (got.forest <= 3) {
        const { group, legs } = makeQuadruped(0x8a5a34, 0x9c6c46, 1.0, { tall: true, antlers: true });
        addWalker(group, legs, x, z, 1.1, 26, 0.7);
      } else {
        const { group, legs } = makeQuadruped(0xc06a30, 0xd07a40, 0.5);
        addWalker(group, legs, x, z, 1.8, 16, 0.4);
      }
    } else if (biome === 'field') {
      got.field = (got.field ?? 0) + 1;
      if (got.field <= 3) {
        const { group, legs } = makeQuadruped(0xe8e2d4, 0xd8d0c0, 0.8, { fluffy: true });
        addWalker(group, legs, x, z, 0.8, 20, 0.6, { x: CITY.x + 150, z: CITY.z + 75 });
      } else {
        const { group, legs } = makeQuadruped(0x9a948a, 0xa8a298, 0.4);
        addWalker(group, legs, x, z, 2.0, 12, 0.35);
      }
    } else if (biome === 'mountain') {
      got.mountain = (got.mountain ?? 0) + 1;
      const { group, legs } = makeQuadruped(0xd8dce4, 0xe8ecf2, 0.75, { tall: true, antlers: true });
      addWalker(group, legs, x, z, 1.0, 18, 0.6);
    }
  }
  function WORLD_HALF_SAFE(): number { return 1100; }

  // ── Птицы: над городом, над озером, над лесом ──
  const flockSpots: [number, number, number][] = [
    [CITY.x, CITY.z, 6], [CAMP.x - 40, CAMP.z - 30, 4], [LAKE.x + 80, LAKE.z, 5], [-460, -330, 4],
  ];
  for (const [cx, cz, count] of flockSpots) {
    const pivot = new THREE.Group();
    pivot.userData.cx = cx;
    pivot.userData.cz = cz;
    pivot.userData.cy = groundHeight(cx, cz) + 34;
    const birds: Flock['birds'] = [];
    for (let i = 0; i < count; i++) {
      const bird = makeBird(i % 2 ? 0x3a3630 : 0x54493a);
      bird.group.position.set((i - count / 2) * 2.4, Math.random() * 1.5, Math.random() * 2);
      pivot.add(bird.group);
      birds.push({ ...bird, offset: Math.random() * Math.PI * 2 });
    }
    all.add(pivot);
    flocks.push({ pivot, angle: Math.random() * Math.PI * 2, radius: 26 + Math.random() * 18, speed: 0.24 + Math.random() * 0.12, birds });
  }

  // ── Рыбы: озеро, оазис, река ──
  const fishColors = [0x8ab0c8, 0xc8b06a, 0x7ac8a0];
  const addSchool = (cx: number, cz: number, level: number, radius: number, count: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(cx, level - 0.5, cz);
    const fish: THREE.Group[] = [];
    for (let i = 0; i < count; i++) {
      const f = makeFish(fishColors[i % fishColors.length], 0.8 + Math.random() * 0.6);
      const a = (i / count) * Math.PI * 2;
      f.position.set(Math.cos(a) * radius * (0.5 + Math.random() * 0.5), Math.random() * 0.3, Math.sin(a) * radius * (0.5 + Math.random() * 0.5));
      pivot.add(f);
      fish.push(f);
    }
    all.add(pivot);
    schools.push({ pivot, angle: Math.random() * Math.PI * 2, radius, speed: 0.5 + Math.random() * 0.4, level, fish });
  };
  addSchool(LAKE.x + 30, LAKE.z + 20, LAKE.level, 42, 6);
  addSchool(LAKE.x - 50, LAKE.z - 40, LAKE.level, 30, 5);
  addSchool(POND.x, POND.z, POND.level, 22, 5);
  addSchool(RIVER_B[2].x, RIVER_B[2].z, LAKE.level, 8, 3);
  addSchool(RIVER_A[2].x, RIVER_A[2].z, LAKE.level, 8, 3);

  // ── Утки на озере (плавают, не ныряют) ──
  for (let i = 0; i < 4; i++) {
    const duck = makeBird(0x54493a, { flatBeak: true });
    const a = (i / 4) * Math.PI * 2;
    const x = LAKE.x + Math.cos(a) * (LAKE.r * 0.5), z = LAKE.z + Math.sin(a) * (LAKE.r * 0.5);
    duck.group.position.set(x, LAKE.level + 0.1, z);
    all.add(duck.group);
    walkers.push({
      group: duck.group, legs: [], home: { x: LAKE.x, z: LAKE.z, r: LAKE.r * 0.55 },
      target: { x, z }, speed: 0.5, idleUntil: 0, phase: Math.random() * 10, radius: 0.4,
    });
  }

  function update(dt: number, now: number): void {
    // Динамические коллайдеры фауны: список собирается заново каждый кадр.
    FAUNA_COLLIDERS.length = 0;
    // Птицы
    for (const f of flocks) {
      f.angle += dt * f.speed;
      const cx = f.pivot.userData.cx as number, cz = f.pivot.userData.cz as number;
      const h = f.pivot.userData.cy as number;
      f.pivot.position.set(cx + Math.cos(f.angle) * f.radius, h + Math.sin(f.angle * 2.3) * 4, cz + Math.sin(f.angle) * f.radius);
      f.pivot.rotation.y = -f.angle;
      for (const b of f.birds) {
        const flap = Math.sin(now / 90 + b.offset) * 0.7;
        b.wingL.rotation.z = flap;
        b.wingR.rotation.z = -flap;
      }
    }

    // Рыбы: косяки кружат, тела покачиваются
    for (const s of schools) {
      s.angle += dt * s.speed;
      for (let i = 0; i < s.fish.length; i++) {
        const f = s.fish[i];
        const a = s.angle + (i / s.fish.length) * Math.PI * 2;
        const r = s.radius * (0.55 + 0.35 * Math.sin(a * 2 + i));
        f.position.set(Math.cos(a) * r, Math.sin(now / 700 + i) * 0.15, Math.sin(a) * r);
        f.rotation.y = -a + Math.PI / 2;
        FAUNA_COLLIDERS.push({
          x: s.pivot.position.x + f.position.x,
          z: s.pivot.position.z + f.position.z,
          r: 0.3,
        });
      }
      // круги на воде
      if (Math.random() < dt * 0.5) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.4, 0.05, 6, 20),
          new THREE.MeshBasicMaterial({ color: 0xdff0f8, transparent: true, opacity: 0.7 }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(s.pivot.position);
        ring.position.x += (Math.random() - 0.5) * s.radius;
        ring.position.z += (Math.random() - 0.5) * s.radius;
        ring.position.y = s.level + 0.05;
        all.add(ring);
        splashes.push({ mesh: ring, born: now });
      }
    }
    for (let i = splashes.length - 1; i >= 0; i--) {
      const sp = splashes[i];
      const t = (now - sp.born) / 1400;
      if (t >= 1) {
        all.remove(sp.mesh);
        sp.mesh.geometry.dispose();
        (sp.mesh.material as THREE.Material).dispose();
        splashes.splice(i, 1);
        continue;
      }
      const k = 1 + t * 3.5;
      sp.mesh.scale.set(k, k, 1);
      (sp.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t);
    }

    // Бродячие животные (утки плавают: y — уровень воды)
    for (const w of walkers) {
      const isDuck = w.legs.length === 0;
      // Коллайдер — всегда, не только на ходу: сквозь стоящего зверя не пройти.
      FAUNA_COLLIDERS.push({ x: w.group.position.x, z: w.group.position.z, r: w.radius });
      if (now < w.idleUntil) {
        for (const leg of w.legs) leg.rotation.x = 0;
        continue;
      }
      const dx = w.target.x - w.group.position.x;
      const dz = w.target.z - w.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.4) {
        // Новую цель сухопутные звери выбирают на суше (до 4 попыток),
        // чтобы не брести через реки и озёра. Утки плавают — им можно.
        let tx = w.home.x, tz = w.home.z;
        for (let tries = 0; tries < 4; tries++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * w.home.r;
          const cx = w.home.x + Math.cos(a) * r, cz = w.home.z + Math.sin(a) * r;
          tx = cx; tz = cz;
          if (isDuck || waterMask(cx, cz) <= 0.3) break;
        }
        w.target = { x: tx, z: tz };
        w.idleUntil = now + 1500 + Math.random() * 4000;
        continue;
      }
      const want = Math.atan2(dx, dz);
      w.group.rotation.y += Math.atan2(Math.sin(want - w.group.rotation.y), Math.cos(want - w.group.rotation.y)) * Math.min(1, dt * 4);
      const step = w.speed * dt;
      let nx = w.group.position.x + Math.sin(w.group.rotation.y) * step;
      let nz = w.group.position.z + Math.cos(w.group.rotation.y) * step;
      // Скольжение вдоль стен и домов: иначе звери идут сквозь город
      for (let pass = 0; pass < 2; pass++) {
        let pushed = false;
        for (const c of COLLIDERS) {
          const dx = nx - c.x, dz = nz - c.z;
          const d = Math.hypot(dx, dz);
          const min = c.r + 0.5;
          if (d < min) {
            if (d > 1e-4) {
              nx = c.x + (dx / d) * min;
              nz = c.z + (dz / d) * min;
            } else {
              nx = c.x + min;
            }
            pushed = true;
          }
        }
        if (!pushed) break;
      }
      // Уткнулись — выбрать новую цель
      if (Math.hypot(nx - w.group.position.x, nz - w.group.position.z) < step * 0.25) {
        const a = Math.random() * Math.PI * 2;
        w.target = { x: w.home.x + Math.cos(a) * w.home.r, z: w.home.z + Math.sin(a) * w.home.r };
        w.idleUntil = now + 1000 + Math.random() * 2000;
      } else {
        w.group.position.x = nx;
        w.group.position.z = nz;
      }
      if (isDuck) {
        w.group.position.y = LAKE.level + 0.1;
      } else {
        // Зверь не уходит под воду: на мелководье идёт вброд у поверхности.
        const gy = groundHeight(w.group.position.x, w.group.position.z);
        const surf = waterSurfaceY(w.group.position.x, w.group.position.z);
        w.group.position.y = surf !== null ? Math.max(gy, surf - 0.35) : gy;
      }
      const swing = Math.sin(now / 1000 * 9 + w.phase) * 0.5;
      if (!isDuck) {
        w.legs[0].rotation.x = swing; w.legs[3].rotation.x = swing;
        w.legs[1].rotation.x = -swing; w.legs[2].rotation.x = -swing;
      }
    }
  }

  function dispose(): void {
    all.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    scene.remove(all);
  }

  return { update, dispose };
}
