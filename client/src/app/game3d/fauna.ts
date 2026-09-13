// ============================================================
// Фауна: птицы и бродячие животные — Empire of Safavids
// ============================================================
// Атмосферные существа без серверной логики: две стаи птиц,
// кружащие над городом, кошки и козлы, бродящие по площадям
// и у лагеря. Простая блуждающая логика: случайная цель в радиусе
// дома, ходьба, пауза. Лапки качаются на ходу.

import * as THREE from 'three';
import { CITY, CAMP, terrainHeight } from './terrain';

const mat = (color: number, rough = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: rough });

interface Walker {
  group: THREE.Group;
  legs: THREE.Mesh[];
  home: { x: number; z: number; r: number };
  target: { x: number; z: number };
  speed: number;
  idleUntil: number;
  phase: number;
}

interface Flock {
  pivot: THREE.Group;
  angle: number;
  radius: number;
  height: number;
  speed: number;
  birds: { group: THREE.Group; wingL: THREE.Mesh; wingR: THREE.Mesh; offset: number }[];
}

function makeQuadruped(bodyColor: number, headColor: number, scale = 1): { group: THREE.Group; legs: THREE.Mesh[] } {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.45), mat(bodyColor));
  body.position.y = 0.55;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.3), mat(headColor));
  head.position.set(0.55, 0.75, 0);
  head.castShadow = true;
  // ушки/рожки
  const earL = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 4), mat(headColor));
  earL.position.set(0.55, 0.97, 0.08);
  const earR = earL.clone(); earR.position.z = -0.08;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.08), mat(bodyColor));
  tail.position.set(-0.6, 0.62, 0);
  tail.rotation.z = 0.5;
  g.add(body, head, earL, earR, tail);

  const legs: THREE.Mesh[] = [];
  const legGeo = new THREE.BoxGeometry(0.1, 0.4, 0.1);
  for (const [lx, lz] of [[0.3, 0.14], [0.3, -0.14], [-0.3, 0.14], [-0.3, -0.14]]) {
    const leg = new THREE.Mesh(legGeo, mat(bodyColor));
    leg.position.set(lx, 0.2, lz);
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

export interface FaunaHandle {
  update(dt: number, now: number): void;
  dispose(): void;
}

export function createFauna(scene: THREE.Scene): FaunaHandle {
  const walkers: Walker[] = [];
  const flocks: Flock[] = [];
  const all = new THREE.Group();
  scene.add(all);

  // ── Стая птиц над городом и над лагерем ──
  for (const [cx, cz, count] of [[CITY.x, CITY.z, 6], [CAMP.x - 40, CAMP.z - 30, 4]] as const) {
    const pivot = new THREE.Group();
    pivot.userData.cx = cx;
    pivot.userData.cz = cz;
    pivot.userData.cy = terrainHeight(cx, cz) + 34;
    const birds: Flock['birds'] = [];
    for (let i = 0; i < count; i++) {
      const bird = makeBird(i % 2 ? 0x3a3630 : 0x54493a);
      bird.group.position.set((i - count / 2) * 2.4, Math.random() * 1.5, Math.random() * 2);
      pivot.add(bird.group);
      birds.push({ ...bird, offset: Math.random() * Math.PI * 2 });
    }
    all.add(pivot);
    flocks.push({ pivot, angle: Math.random() * Math.PI * 2, radius: 26 + Math.random() * 18, height: 0, speed: 0.24 + Math.random() * 0.12, birds });
  }

  // ── Кошки в городе, козлы у лагеря ──
  const cats: [number, number, number][] = [
    [CITY.x - 12, CITY.z + 14, 0.55], [CITY.x + 16, CITY.z - 2, 0.5], [CITY.x + 2, CITY.z + 24, 0.45],
    [CITY.x - 20, CITY.z - 16, 0.5],
  ];
  for (const [x, z, s] of cats) {
    const { group, legs } = makeQuadruped(0x77716a, 0x8a847c, s);
    group.position.set(x, terrainHeight(x, z), z);
    group.rotation.y = Math.random() * Math.PI * 2;
    all.add(group);
    walkers.push({ group, legs, home: { x: CITY.x, z: CITY.z, r: 40 }, target: { x, z }, speed: 1.0, idleUntil: 0, phase: Math.random() * 10 });
  }
  const goats: [number, number][] = [
    [CAMP.x - 18, CAMP.z + 8], [CAMP.x - 24, CAMP.z - 12], [CAMP.x - 10, CAMP.z - 20],
  ];
  for (const [x, z] of goats) {
    const { group, legs } = makeQuadruped(0xb8a888, 0xcabb98, 0.85);
    group.position.set(x, terrainHeight(x, z), z);
    group.rotation.y = Math.random() * Math.PI * 2;
    all.add(group);
    walkers.push({ group, legs, home: { x: CAMP.x - 16, z: CAMP.z - 4, r: 22 }, target: { x, z }, speed: 0.8, idleUntil: 0, phase: Math.random() * 10 });
  }

  function update(dt: number, now: number): void {
    // Птицы: стая кружит вокруг своей точки, крылья машут
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

    // Бродячие животные
    for (const w of walkers) {
      const t = now / 1000;
      if (now < w.idleUntil) {
        for (const leg of w.legs) leg.rotation.x = 0;
        continue;
      }
      const dx = w.target.x - w.group.position.x;
      const dz = w.target.z - w.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.4) {
        // новая цель в радиусе дома
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * w.home.r;
        w.target = { x: w.home.x + Math.cos(a) * r, z: w.home.z + Math.sin(a) * r };
        w.idleUntil = now + 1500 + Math.random() * 4000;
        continue;
      }
      const want = Math.atan2(dx, dz);
      w.group.rotation.y += Math.atan2(Math.sin(want - w.group.rotation.y), Math.cos(want - w.group.rotation.y)) * Math.min(1, dt * 4);
      const step = w.speed * dt;
      w.group.position.x += Math.sin(w.group.rotation.y) * step;
      w.group.position.z += Math.cos(w.group.rotation.y) * step;
      w.group.position.y = terrainHeight(w.group.position.x, w.group.position.z);
      const swing = Math.sin(t * 9 + w.phase) * 0.5;
      w.legs[0].rotation.x = swing; w.legs[3].rotation.x = swing;
      w.legs[1].rotation.x = -swing; w.legs[2].rotation.x = -swing;
      // хвост кошки: лёгкое покачивание задаётся вращением головы-группы — упрощённо пропускаем
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
