// Вода в колеях дороги и лужи в пригороде (§269).
//
// ЧТО БЫЛО. После ливня лужи были только на городской площади (§264). В
// пригороде и у дороги сухо: колея, выбитая тысячами колёс, стоит сухой, хотя
// вокруг мокро, и вода, которой есть куда стекать, не стоит в колеях.
//
// ЧТО ТЕПЕРЬ. В колеях дороги после дождя стоит вода — две узкие тёмные
// ленты вдоль полотна, глянцевые, как и всякая вода. И в пригороде, где
// земля мягче и вода стоит целыми лужами, — лужи.
//
// ПОЧЕМУ ВОДА В КОЛЕЯХ, А НЕ ПЛЁНКА ПОД ДОРОГОЙ. Колея в полотне уже есть
// (она нарисована в текстуре дороги, §248), и вода стоит в ней по-настоящему:
// в колее вода глубже, и она глянцевая — в отличие от мокрого песка, который
// просто темнее.
import * as THREE from 'three';
import { ROAD_PATHS, groundHeight } from './terrain';

/** Насколько вглубь от осевой линии стоят колёса, доля от ширины дороги. */
const КОЛЯ = 0.22;

export interface RoadWaterHandle {
  update(dt: number, now: number, px: number, pz: number, мокрота: number): void;
  dispose(): void;
}

/** Лужи пригорода: места и порог, по которому лужа проступает. */
const ПРИГОРОД: { x: number; z: number; r: number; порог: number }[] = [
  { x: 118, z: 113, r: 2.6, порог: 0.1 },
  { x: 123, z: 108, r: 1.8, порог: 0.25 },
  { x: 115, z: 117, r: 3.1, порог: 0.4 },
  { x: 126, z: 116, r: 2.1, порог: 0.55 },
];

export function createRoadWater(scene: THREE.Scene): RoadWaterHandle {
  // Вода в колеях: тёмная и глянцевая, как всякая вода.
  const материалКолей = new THREE.MeshStandardMaterial({
    color: 0x33404c,
    roughness: 0.1,
    metalness: 0.2,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const материалЛуж = new THREE.MeshStandardMaterial({
    color: 0x2b3644,
    roughness: 0.07,
    metalness: 0.15,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  // Две ленты вдоль полотна: левая и правая колея.
  const колеи: THREE.Mesh[] = [];
  for (const сторона of [-1, 1]) {
    const лента = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), материалКолей);
    лента.rotation.x = -Math.PI / 2;
    лента.renderOrder = 2;
    лента.userData.сторона = сторона;
    scene.add(лента);
    колеи.push(лента);
  }

  // Лужи пригорода.
  const лужи = ПРИГОРОД.map((п) => {
    const меш = new THREE.Mesh(new THREE.CircleGeometry(п.r, 18), материалЛуж);
    меш.rotation.x = -Math.PI / 2;
    меш.position.set(п.x, groundHeight(п.x, п.z) + 0.08, п.z);
    меш.renderOrder = 2;
    scene.add(меш);
    return { меш, порог: п.порог };
  });

  const дороги = ROAD_PATHS.map((дорога) => ({
    дорога,
    x: (дорога.from.x + дорога.to.x) / 2,
    z: (дорога.from.z + дорога.to.z) / 2,
    угол: Math.atan2(дорога.to.z - дорога.from.z, дорога.to.x - дорога.from.x),
  }));

  function update(_dt: number, _now: number, px: number, pz: number, мокрота: number): void {
    const м = Math.max(0, Math.min(1, мокрота));
    // Ближайшая дорога: вода стоит в её колеях.
    let ближняя: (typeof дороги)[number] | null = null;
    let лучшее = Infinity;
    for (const д of дороги) {
      const d = Math.hypot(д.x - px, д.z - pz);
      if (d < лучшее) { лучшее = d; ближняя = д; }
    }
    if (ближняя && лучшее < 260) {
      const половина = ближняя.дорога.w * КОЛЯ;
      const y = groundHeight(ближняя.x, ближняя.z) + 0.05;
      for (const лента of колеи) {
        const сторона = лента.userData.сторона as number;
        // Смещение поперёк полотна.
        const nx = -Math.sin(ближняя.угол) * сторона * половина;
        const nz = Math.cos(ближняя.угол) * сторона * половина;
        лента.position.set(ближняя.x + nx, y, ближняя.z + nz);
        // Лента длинная вдоль дороги и узкая поперёк.
        лента.scale.set(1.1, ближняя.дорога.w * 6, 1);
        лента.rotation.set(-Math.PI / 2, 0, -ближняя.угол);
        лента.visible = м > 0.02;
      }
      материалКолей.opacity = м * 0.75;
    } else {
      for (const лента of колеи) лента.visible = false;
      материалКолей.opacity = 0;
    }

    // Лужи пригорода проступают порциями, как и городские (§264).
    for (const л of лужи) {
      const доля = Math.max(0, Math.min(1, (м - л.порог) / 0.3));
      л.меш.visible = доля > 0.01;
      if (л.меш.visible) {
        (л.меш.material as THREE.MeshStandardMaterial).opacity = доля * 0.62;
      }
    }
    материалЛуж.opacity = м * 0.62;
  }

  function dispose(): void {
    for (const лента of колеи) {
      scene.remove(лента);
      лента.geometry.dispose();
    }
    for (const л of лужи) {
      scene.remove(л.меш);
      л.меш.geometry.dispose();
    }
    материалКолей.dispose();
    материалЛуж.dispose();
  }

  return { update, dispose };
}
