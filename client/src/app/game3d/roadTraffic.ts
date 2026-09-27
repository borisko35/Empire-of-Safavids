// ============================================================
// Дорожное движение: караваны и случайные путники с квестами
// ============================================================
//
// ЗАЧЕМ. Горожане живут в городе и никуда не идут — это правильно, но из-за
// этого за пределами города было пусто: поле, по которому шёл игрок, не
// содержало вообще никого. Три статичных верблюда в buildRoads не считали:
// они стояли в точках 0.2, 0.45 и 0.7 пути и не двигались никогда.
//
// Что здесь: караваны, которые идут по дороге туда-обратно, и путники,
// которые бредут по дороге пешком. Путники с пометкой «дают задание»
// кликабельны и открывают панель задач — так же, как городские NPC с
// флагом quest.
//
// Дорожное полотно рисует terrain.ts. Данные о дорогах общие (ROAD_PATHS),
// чтобы движение шло ровно по нарисованной дороге, а не рядом с ней.

import * as THREE from 'three';
import { ROAD_PATHS, groundHeight } from './terrain';

export interface RoadTrafficHandle {
  /**
   * px/pz — позиция игрока. Нужна, чтобы не рисовать то, чего не видно:
   * дороги длинные, а караваны и путники на них всегда идут.
   */
  update(dt: number, now: number, px: number, pz: number): void;
  /** Кликабельные путники: у них userData.npcPanel и userData.npcName */
  clickTargets: THREE.Object3D[];
  dispose(): void;
}

/** Дальше которой движение перестаёт рисоваться. */
const VISIBLE_DIST = 460;

/** Скорость каравана, м/с. Верблюд с грузом идёт медленнее пешехода. */
const CARAVAN_SPEED = 1.7;
/** Скорость путника, м/с. */
const WALKER_SPEED = 1.35;

const M = {
  camel: new THREE.MeshStandardMaterial({ color: 0xc0a074, roughness: 1 }),
  camelDark: new THREE.MeshStandardMaterial({ color: 0x9a7d54, roughness: 1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 1 }),
  pack1: new THREE.MeshStandardMaterial({ color: 0x2e8b8b, roughness: 1 }),
  pack2: new THREE.MeshStandardMaterial({ color: 0x8b1a1a, roughness: 1 }),
  pack3: new THREE.MeshStandardMaterial({ color: 0x7a5fd0, roughness: 1 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xe4b284, roughness: 0.9 }),
  robe: [
    new THREE.MeshStandardMaterial({ color: 0x6a5636, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x4c5a6a, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x6a4a5a, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x5a6a4a, roughness: 1 }),
  ],
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xc9a84c, roughness: 0.4, metalness: 0.5 }),
};

/** Точка на дороге: t = 0 — начало, t = 1 — конец. */
function pointOn(path: { from: { x: number; z: number }; to: { x: number; z: number } }, t: number): { x: number; z: number; y: number; angle: number } {
  const { from, to } = path;
  const x = from.x + (to.x - from.x) * t;
  const z = from.z + (to.z - from.z) * t;
  return { x, z, y: groundHeight(x, z), angle: Math.atan2(to.x - from.x, to.z - from.z) };
}

/** Кто-то, кто идёт по дороге: свой t, скорость и фазa шага. */
interface Walker {
  group: THREE.Group;
  legs: THREE.Object3D[];
  /** 0..1 — где он на дороге. Уходит за 1 и начинает с 0, либо наоборот. */
  t: number;
  dir: 1 | -1;
  speed: number;
  phase: number;
  /** Насколько отстаёт от ведущего по t, чтобы шли колонной, а не стеной. */
  lag: number;
}

/**
 * Один человек. Примитивы, как у горожан: у них нет текстур, зато дешево и
 * выглядит уместно рядом с остальным миром.
 */
function makePerson(robeColor: number, hat: 'turban' | 'cap' | 'none'): Walker {
  const g = new THREE.Group();
  const robe = new THREE.MeshStandardMaterial({ color: robeColor, roughness: 1 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.36, 1.0, 8), robe);
  body.position.y = 1.05;
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 7), M.skin);
  head.position.y = 1.72;
  head.castShadow = true;
  g.add(head);

  if (hat === 'turban') {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.16, 8), M.skin);
    t.position.y = 1.9;
    g.add(t);
  } else if (hat === 'cap') {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.24, 0.14, 8), M.dark);
    c.position.y = 1.88;
    g.add(c);
  }

  const legs: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.95, side * 0.13);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.95, 6), M.dark);
    leg.position.y = -0.47;
    leg.castShadow = true;
    pivot.add(leg);
    g.add(pivot);
    legs.push(pivot);
  }

  return { group: g, legs, t: 0, dir: 1, speed: WALKER_SPEED, phase: 0, lag: 0 };
}

/** Верблюд с тюком. Ноги — четыре отдельные, чтобы шаг читался. */
function makeCamel(packColor: THREE.Material): Walker {
  const g = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 1.9), M.camel);
  body.position.y = 1.35;
  body.castShadow = true;
  g.add(body);

  // Горбы
  for (const z of [-0.4, 0.35]) {
    const hump = new THREE.Mesh(new THREE.SphereGeometry(0.36, 7, 6), M.camelDark);
    hump.position.set(0, 1.85, z);
    hump.castShadow = true;
    g.add(hump);
  }

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 6), M.camel);
  neck.position.set(0, 1.85, 0.85);
  neck.rotation.x = 0.5;
  g.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, 0.55), M.camelDark);
  head.position.set(0, 2.2, 1.2);
  head.castShadow = true;
  g.add(head);

  // Тюки по бокам: караван видно издалека именно по ним
  for (const side of [-1, 1]) {
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.7), packColor);
    pack.position.set(side * 0.62, 1.5, -0.1);
    pack.castShadow = true;
    g.add(pack);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.9), M.wood);
  top.position.set(0, 2.25, -0.3);
  top.castShadow = true;
  g.add(top);

  const legs: THREE.Object3D[] = [];
  for (const x of [-0.34, 0.34]) {
    for (const z of [-0.62, 0.62]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.95, z);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.95, 5), M.camelDark);
      leg.position.y = -0.47;
      leg.castShadow = true;
      pivot.add(leg);
      g.add(pivot);
      legs.push(pivot);
    }
  }

  return { group: g, legs, t: 0, dir: 1, speed: CARAVAN_SPEED, phase: 0, lag: 0 };
}

/** Жёлтый восклицательный знак над тем, кто даёт задание. */
function questMarker(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = '#f4d26c';
  g.strokeStyle = '#2a2018';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(32, 6); g.lineTo(44, 24); g.lineTo(20, 24); g.closePath();
  g.fill(); g.stroke();
  g.beginPath();
  g.arc(32, 36, 5, 0, Math.PI * 2);
  g.fill(); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(0.5, 0.5, 1);
  sp.position.y = 2.35;
  return sp;
}

/** Имена путников. Тот, кто даёт задание, должен звучать как человек. */
const WALKER_NAMES = [
  'Караванщик Мамед', 'Странник Расул', 'Купец Али', 'Путница Назар',
  'Обозник Джафар', 'Нищий Ибрагим', 'Торговец Фатали', 'Послушник Абдул',
];

export function createRoadTraffic(scene: THREE.Scene): RoadTrafficHandle {
  const group = new THREE.Group();
  scene.add(group);
  const clickTargets: THREE.Object3D[] = [];

  const travellers: Walker[] = [];
  const caravanPaths: typeof ROAD_PATHS = [];

  // ── Караваны ───────────────────────────────────────────────
  // Идут по дальним дорогам, чтобы не резать игроку путь в город. Три штуки
  // с разными стартовыми точками — иначе они слипаются в одну колонну.
  const caravanRoads = [ROAD_PATHS[3], ROAD_PATHS[1], ROAD_PATHS[2]].filter(Boolean);
  for (const road of caravanRoads) caravanPaths.push(road);

  const PACKS = [M.pack1, M.pack2, M.pack3];
  caravanRoads.forEach((road, ci) => {
    // Колонна: замыкающий, верблюд, верблюд, замыкающий постом сзади.
    const column: Walker[] = [
      makePerson(0x6a5636, 'cap'),
      makeCamel(PACKS[ci % PACKS.length]),
      makeCamel(PACKS[(ci + 1) % PACKS.length]),
      makePerson(0x4c5a6a, 'turban'),
    ];
    // Отставание по t: метры вдоль дороги между соседями
    const lags = [0, -0.018, -0.036, -0.054];
    column.forEach((w, i) => {
      w.t = 0.15 + ci * 0.3;
      w.dir = ci % 2 === 0 ? 1 : -1;
      w.lag = lags[i];
      // Сзади идёт замыкающий, поэтому у него знак минус: он позади
      group.add(w.group);
      travellers.push({ ...w, road } as Walker & { road: unknown });
    });
  });

  // ── Путники с заданиями ────────────────────────────────────
  // Шестеро. Двое из них дают задание — на них можно кликнуть, и откроется
  // панель задач, ровно как у городских NPC с флагом quest.
  const WALKERS_PER_ROAD = 3;
  for (let i = 0; i < WALKERS_PER_ROAD * 2; i++) {
    const road = ROAD_PATHS[i % ROAD_PATHS.length];
    const hasQuest = i % 3 === 0;
    const name = WALKER_NAMES[i % WALKER_NAMES.length];
    const w = makePerson(0x3a3a42 + (i % 4) * 0x0a1410, i % 2 === 0 ? 'turban' : 'cap');
    w.t = (i * 0.17) % 1;
    w.dir = i % 2 === 0 ? 1 : -1;
    w.speed = WALKER_SPEED * (0.85 + (i % 3) * 0.12);

    if (hasQuest) {
      const marker = questMarker();
      w.group.add(marker);
      w.group.userData.npcPanel = 'panel-quests';
      w.group.userData.npcName = name;
      w.group.userData.npcId = `road_wanderer_${i}`;
      clickTargets.push(w.group);
    }
    group.add(w.group);
    travellers.push({ ...w, road } as Walker & { road: unknown });
  }

  function update(dt: number, now: number, px: number, pz: number): void {
    for (const entry of travellers) {
      const w = entry as Walker & { road: (typeof ROAD_PATHS)[number] };
      const road = w.road;
      if (!road) continue;

      // Идём вперёд. Отставание держит колонну: у каждого своё t, но оно
      // сдвинуто на lag, поэтому задние идут ровно позади передних.
      w.t += (w.dir * w.speed * dt) / 12; // 12 — условная длина дороги в t
      if (w.t > 1.05) { w.t = 1.05; w.dir = -1; }
      if (w.t < -0.05) { w.t = -0.05; w.dir = 1; }

      const along = THREE.MathUtils.clamp(w.t + w.lag, 0, 1);
      const p = pointOn(road, along);
      w.group.position.set(p.x, p.y, p.z);
      w.group.rotation.y = w.dir > 0 ? p.angle : p.angle + Math.PI;

      // Не рисуем то, чего не видно. Проверка дешёвая, а дороги длинные.
      const far = Math.hypot(p.x - px, p.z - pz) > VISIBLE_DIST;
      if (w.group.visible === !far) w.group.visible = !far;
      if (far) continue;

      // Шаг: ноги в противофазе, частота от скорости
      w.phase += dt * w.speed * 3.1;
      const swing = Math.sin(w.phase) * 0.55;
      for (let i = 0; i < w.legs.length; i++) {
        w.legs[i].rotation.x = (i % 2 === 0) ? swing : -swing;
      }
      // Метка над головой чуть покачивается, чтобы её было видно издалека
      const marker = w.group.children.find(c => c instanceof THREE.Sprite);
      if (marker) {
        marker.position.y = 2.35 + Math.sin(now / 320) * 0.06;
      }
    }
  }

  function dispose(): void {
    group.traverse(o => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        const g = o.geometry;
        g?.dispose?.();
        const m = o.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach(x => x.dispose?.());
        else m?.dispose?.();
      }
    });
    scene.remove(group);
  }

  return { update, clickTargets, dispose };
}
