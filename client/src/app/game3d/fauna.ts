// ============================================================
// Фауна по биомам — Empire of Safavids
// ============================================================
// Атмосферные существа без серверной логики. Точка спавна выбирает
// биом: пустыня — верблюды и ящерицы, лес — олени и лисы, поля —
// овцы и кролики, горы — горные козлы, вода — косяки рыб с кругами
// на поверхности. Блуждающая логика: цель в радиусе дома, паузы.
//
// ТЕЛО — ИЗ ФАЙЛА, ДВИЖЕНИЕ — ЗДЕСЬ. Каждый вид приезжает готовым GLB
// (animalModels.ts): ригованные звери играют свои клипы Walk/Gallop/Idle
// через миксер на экземпляр, статичные (верблюд, коза, птицы) живут позой.
// Процедурных капсул-четвероногих больше нет: сборка из примитивов
// удалялась вместе с переходом, и если файл вида не доехал — зверь не
// появится (console.warn), а игра продолжит работать.

import * as THREE from 'three';
import { CITY, CAMP, LAKE, POND, RIVER_A, RIVER_B, groundHeight, biomeAt, waterMask, waterSurfaceY, FAUNA_COLLIDERS, COLLIDERS } from './terrain';
import { собратьЗверя, вестиЗверя, type Зверь } from './animalModels';

interface Walker {
  group: THREE.Group;
  /** Ригованный зверь: миксер и клипы. null у статичных видов. */
  зверь: Зверь | null;
  /** Утки плавают: y держится по уровню озера, а не по грунту. */
  плавает: boolean;
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
  birds: { group: THREE.Group; offset: number }[];
}

interface FishSchool {
  pivot: THREE.Group;
  angle: number;
  radius: number;
  speed: number;
  level: number;
  fish: { group: THREE.Group; зверь: Зверь }[];
}

interface Splash {
  mesh: THREE.Mesh;
  born: number;
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

  /**
   * Спавн одного зверя. Асинхронный: файл едет по сети, и createFauna не
   * имеет права на него ждать. Пока файл не доехал, зверя в мире нет —
   * как и у декора placeDecor, где коллайдер ставится сразу, а модель
   * доезжает следом; здесь зверь мирный и без коллайдера обойдётся секунду.
   */
  const заспавнить = (
    вид: string, длина: number, radius: number,
    x: number, z: number, speed: number, homeR: number,
    opts?: { home?: { x: number; z: number }; плавает?: boolean },
  ): void => {
    void собратьЗверя(вид, длина).then((зверь) => {
      if (!зверь) {
        console.warn(`[fauna] вид ${вид} не собрался — на карте его не будет`);
        return;
      }
      const g = зверь.group;
      g.position.set(x, opts?.плавает ? LAKE.level + 0.1 : groundHeight(x, z), z);
      g.rotation.y = Math.random() * Math.PI * 2;
      all.add(g);
      walkers.push({
        group: g, зверь, плавает: opts?.плавает ?? false,
        home: { x: opts?.home?.x ?? x, z: opts?.home?.z ?? z, r: homeR },
        target: { x, z }, speed, idleUntil: 0, phase: Math.random() * 10, radius,
      });
    });
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
        // верблюды: у караван-сарая, статичная модель в позе покоя
        const hx = 505 + (rng() - 0.5) * 30, hz = 55 + (rng() - 0.5) * 30;
        заспавнить('camel', 2.7, 0.9, hx, hz, 0.7, 24, { home: { x: 505, z: 55 } });
      } else {
        // ящерицы: быстрые мелкие
        заспавнить('lizard', 0.55, 0.35, x, z, 2.2, 12);
      }
    } else if (biome === 'forest') {
      got.forest = (got.forest ?? 0) + 1;
      if (got.forest <= 3) {
        заспавнить('stag', 2.1, 0.7, x, z, 1.1, 26);
      } else {
        заспавнить('fox', 1.2, 0.4, x, z, 1.8, 16);
      }
    } else if (biome === 'field') {
      got.field = (got.field ?? 0) + 1;
      if (got.field <= 3) {
        заспавнить('sheep', 1.5, 0.6, x, z, 0.8, 20, { home: { x: CITY.x + 150, z: CITY.z + 75 } });
      } else {
        заспавнить('bunny', 0.5, 0.35, x, z, 2.0, 12);
      }
    } else if (biome === 'mountain') {
      got.mountain = (got.mountain ?? 0) + 1;
      заспавнить('goat', 1.5, 0.6, x, z, 1.0, 18);
    }
  }
  function WORLD_HALF_SAFE(): number { return 1100; }

  // ── Птицы: над городом, над озером, над лесом ──
  // Чайка — статичная модель в позе парения: крылья не машут, стая живёт
  // виражом и покачиванием. Реальная птица вместо треугольника из трёх вершин.
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
      void собратьЗверя('seagull', 0.95).then((зверь) => {
        if (!зверь) return;
        зверь.group.position.set((i - count / 2) * 2.4, Math.random() * 1.5, Math.random() * 2);
        pivot.add(зверь.group);
        birds.push({ group: зверь.group, offset: Math.random() * Math.PI * 2 });
      });
    }
    all.add(pivot);
    flocks.push({ pivot, angle: Math.random() * Math.PI * 2, radius: 26 + Math.random() * 18, speed: 0.24 + Math.random() * 0.12, birds });
  }

  // ── Рыбы: озеро, оазис, река ──
  // Три формы мелкой рыбы + крупные виды на глубине; у каждой свой клип
  // плавания, и хвост бьёт сам — качание процедурной капсулы ушло.
  const addSchool = (cx: number, cz: number, level: number, radius: number, count: number, вид: string, длина: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(cx, level - 0.5, cz);
    const fish: FishSchool['fish'] = [];
    for (let i = 0; i < count; i++) {
      void собратьЗверя(вид, длина).then((зверь) => {
        if (!зверь) return;
        const a = (i / count) * Math.PI * 2;
        зверь.group.position.set(Math.cos(a) * radius * (0.5 + Math.random() * 0.5), Math.random() * 0.3, Math.sin(a) * radius * (0.5 + Math.random() * 0.5));
        pivot.add(зверь.group);
        fish.push({ group: зверь.group, зверь });
      });
    }
    all.add(pivot);
    schools.push({ pivot, angle: Math.random() * Math.PI * 2, radius, speed: 0.5 + Math.random() * 0.4, level, fish });
  };
  addSchool(LAKE.x + 30, LAKE.z + 20, LAKE.level, 42, 6, 'fish-a', 0.45);
  addSchool(LAKE.x - 50, LAKE.z - 40, LAKE.level, 30, 5, 'fish-b', 0.4);
  addSchool(POND.x, POND.z, POND.level, 22, 5, 'koi', 0.45);
  addSchool(RIVER_B[2].x, RIVER_B[2].z, LAKE.level, 8, 3, 'fish-c', 0.35);
  addSchool(RIVER_A[2].x, RIVER_A[2].z, LAKE.level, 8, 3, 'piranha', 0.35);
  // Крупные рыбы озера — редкие, по одной-две.
  addSchool(LAKE.x + 10, LAKE.z - 60, LAKE.level, 55, 1, 'tuna', 0.9);
  addSchool(LAKE.x - 70, LAKE.z + 30, LAKE.level, 50, 1, 'swordfish', 0.95);

  // ── Утки на озере (плавают, не ныряют) ──
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const x = LAKE.x + Math.cos(a) * (LAKE.r * 0.5), z = LAKE.z + Math.sin(a) * (LAKE.r * 0.5);
    заспавнить('duck', 0.55, 0.4, x, z, 0.5, LAKE.r * 0.55, { home: { x: LAKE.x, z: LAKE.z }, плавает: true });
  }

  function update(dt: number, now: number): void {
    // Динамические коллайдеры фауны: список собирается заново каждый кадр.
    FAUNA_COLLIDERS.length = 0;
    // Птицы: вираж стаи; покачивание вместо взмахов — модель в позе парения
    for (const f of flocks) {
      f.angle += dt * f.speed;
      const cx = f.pivot.userData.cx as number, cz = f.pivot.userData.cz as number;
      const h = f.pivot.userData.cy as number;
      f.pivot.position.set(cx + Math.cos(f.angle) * f.radius, h + Math.sin(f.angle * 2.3) * 4, cz + Math.sin(f.angle) * f.radius);
      f.pivot.rotation.y = -f.angle;
      for (const b of f.birds) {
        b.group.position.y = Math.sin(now / 700 + b.offset) * 0.8;
        b.group.rotation.z = Math.sin(now / 500 + b.offset) * 0.25;
      }
    }

    // Рыбы: косяки кружат, клип плавания бьёт хвостом
    for (const s of schools) {
      s.angle += dt * s.speed;
      for (let i = 0; i < s.fish.length; i++) {
        const f = s.fish[i];
        const a = s.angle + (i / s.fish.length) * Math.PI * 2;
        const r = s.radius * (0.55 + 0.35 * Math.sin(a * 2 + i));
        f.group.position.set(Math.cos(a) * r, Math.sin(now / 700 + i) * 0.15, Math.sin(a) * r);
        f.group.rotation.y = -a + Math.PI / 2;
        вестиЗверя(f.зверь, true, dt);
        FAUNA_COLLIDERS.push({
          x: s.pivot.position.x + f.group.position.x,
          z: s.pivot.position.z + f.group.position.z,
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
      // Коллайдер — всегда, не только на ходу: сквозь стоящего зверя не пройти.
      FAUNA_COLLIDERS.push({ x: w.group.position.x, z: w.group.position.z, r: w.radius });
      const стоит = now < w.idleUntil;
      if (!стоит) {
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
            if (w.плавает || waterMask(cx, cz) <= 0.3) break;
          }
          w.target = { x: tx, z: tz };
          w.idleUntil = now + 1500 + Math.random() * 4000;
        } else {
          const want = Math.atan2(dx, dz);
          w.group.rotation.y += Math.atan2(Math.sin(want - w.group.rotation.y), Math.cos(want - w.group.rotation.y)) * Math.min(1, dt * 4);
          const step = w.speed * dt;
          let nx = w.group.position.x + Math.sin(w.group.rotation.y) * step;
          let nz = w.group.position.z + Math.cos(w.group.rotation.y) * step;
          // Скольжение вдоль стен и домов: иначе звери идут сквозь город
          if (!w.плавает) {
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
          if (w.плавает) {
            w.group.position.y = LAKE.level + 0.1 + Math.sin(now / 600 + w.phase) * 0.03;
          } else {
            // Зверь не уходит под воду: на мелководье идёт вброд у поверхности.
            const gy = groundHeight(w.group.position.x, w.group.position.z);
            const surf = waterSurfaceY(w.group.position.x, w.group.position.z);
            w.group.position.y = surf !== null ? Math.max(gy, surf - 0.35) : gy;
          }
        }
      }
      // Анимация: миксер ригованных видов; у статичных — покачивание головы
      if (w.зверь) {
        вестиЗверя(w.зверь, !стоит, dt);
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
