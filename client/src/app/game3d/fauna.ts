// ============================================================
// Фауна по биомам — Empire of Safavids
// ============================================================
// Атмосферные существа без серверной логики. Точка спавна выбирает
// биом: пустыня — верблюды и ящерицы, лес — олени и лисы, поля —
// зайцы и овцы, горы — горные козлы, вода — косяки рыб с кругами
// на поверхности. Блуждающая логика: цель в радиусе дома, паузы.

import * as THREE from 'three';
import { CITY, CAMP, LAKE, POND, RIVER_A, RIVER_B, groundHeight, biomeAt, waterMask, waterSurfaceY, FAUNA_COLLIDERS, COLLIDERS } from './terrain';

const mat = (color: number, rough = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: rough });

interface Walker {
  group: THREE.Group;
  legs: THREE.Mesh[];
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
  fish: THREE.Mesh[];
}

interface Splash {
  mesh: THREE.Mesh;
  born: number;
}

function makeQuadruped(
  bodyColor: number, headColor: number, scale = 1, opts?: { hump?: boolean; tall?: boolean; fluffy?: boolean; antlers?: boolean },
): { group: THREE.Group; legs: THREE.Mesh[] } {
  const g = new THREE.Group();
  const legH = opts?.tall ? 0.55 : 0.4;
  const body = new THREE.Mesh(
    opts?.fluffy ? new THREE.SphereGeometry(0.5, 8, 6) : new THREE.BoxGeometry(0.9, 0.5, 0.45),
    mat(bodyColor),
  );
  if (opts?.fluffy) body.scale.set(1.1, 0.9, 0.85);
  body.position.y = legH + 0.32;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.3), mat(headColor));
  head.position.set(0.55, legH + 0.55, 0);
  head.castShadow = true;
  g.add(body, head);

  if (opts?.hump) {
    // У верблюда ДВА горба, а не один: первый над лопатками, второй над
    // крестцом. Тело вытянуто вдоль оси X (голова на +0.55), поэтому второй
    // горб смещается по X, а не по Z. Раньше второй горб клонировали,
    // ставили ему z = 0 — то есть ровно туда же, где стоит первый, — и
    // НЕ добавляли в группу: он создавался, двигался и молча терялся.
    // В итоге верблюд оставался с одним горбом.
    for (const [gx, sc] of [[-0.05, 1.3], [-0.42, 1.15]] as const) {
      const hump = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), mat(bodyColor));
      hump.scale.set(sc, 0.9, 0.9);
      hump.position.set(gx, legH + 0.72, 0);
      hump.castShadow = true;
      g.add(hump);
    }
  }
  if (opts?.antlers) {
    for (const side of [-1, 1]) {
      const antler = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.4, 4), mat(0x6e563a));
      antler.position.set(0.5, legH + 0.86, side * 0.12);
      antler.rotation.z = -0.5;
      g.add(antler);
    }
  }
  // ушки
  const earL = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 4), mat(headColor));
  earL.position.set(0.55, legH + 0.77, 0.08);
  const earR = earL.clone(); earR.position.z = -0.08;
  g.add(earL, earR);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.08), mat(bodyColor));
  tail.position.set(-0.6, legH + 0.4, 0);
  tail.rotation.z = 0.5;
  g.add(tail);

  const legs: THREE.Mesh[] = [];
  const legGeo = new THREE.BoxGeometry(0.1, legH, 0.1);
  for (const [lx, lz] of [[0.3, 0.14], [0.3, -0.14], [-0.3, 0.14], [-0.3, -0.14]]) {
    const leg = new THREE.Mesh(legGeo, mat(bodyColor));
    leg.position.set(lx, legH / 2, lz);
    leg.castShadow = true;
    g.add(leg);
    legs.push(leg);
  }
  g.scale.setScalar(scale);
  return { group: g, legs };
}

function makeBird(wingColor: number): { group: THREE.Group; wingL: THREE.Mesh; wingR: THREE.Mesh } {
  const g = new THREE.Group();
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0, -0.55, 0, 0.16, -0.55, 0, -0.16,
  ]), 3));
  wingGeo.computeVertexNormals();
  const wingMat = new THREE.MeshBasicMaterial({ color: wingColor, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5, 4), wingMat);
  body.rotation.x = Math.PI / 2;
  const wingL = new THREE.Mesh(wingGeo, wingMat);
  const wingR = new THREE.Mesh(wingGeo, wingMat);
  wingR.scale.x = -1;
  g.add(body, wingL, wingR);
  return { group: g, wingL, wingR };
}

function makeFish(color: number, scale = 1): THREE.Mesh {
  const g = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.6, 5), mat(color, 0.5));
  g.rotation.x = Math.PI / 2;   // носит по -Z? повернём вдоль движения
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

  const addWalker = (g: THREE.Group, legs: THREE.Mesh[], x: number, z: number, speed: number, homeR: number, radius: number, home = { x, z }) => {
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
    const fish: THREE.Mesh[] = [];
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
    const duck = makeQuadruped(0x54493a, 0x3a3630, 0.35);
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
