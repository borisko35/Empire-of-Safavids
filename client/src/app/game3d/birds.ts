// Птицы над пустыней и городом (§259).
//
// ЧТО БЫЛО. Небо было пустым: в мире, где есть верблюды, коровы, пыльные
// вихри и ветер, который качает зелень, не летает ни одна птица. Небо
// читалось как фон, а не как воздух.
//
// ЧТО ТЕПЕРЬ. Стая: вожатый с двенадцатью птицами по бокам и позади. Стая
// облетает игрока по широкой дуге, крылья бьют вразнобой (у каждой птицы своя
// фаза), и птицы иногда проходят совсем близко над головой.
import * as THREE from 'three';

export interface BirdsHandle {
  update(dt: number, now: number, px: number, pz: number): void;
  dispose(): void;
}

/** Сколько птиц в стае. */
const ПТИЦ = 13;
/**
 * Размах крыльев, метры. Крупная птица: вдалеке обычная ворона — точка, а на
 * кадре такая стая не читалась вовсе.
 */
const РАЗМАХ = 2;
/** Высота полёта над землёй, метры. */
const ВЫСОТА = 30;
/** Радиус облёта вокруг игрока, метры. */
const РАДИУС = 78;

interface Птица {
  группа: THREE.Group;
  крылоЛ: THREE.Mesh;
  крылоП: THREE.Mesh;
  /** Смещение в строю: назад и в стороны. */
  dx: number;
  dz: number;
  /** Своя фаза взмахов. */
  фаза: number;
}

export function createBirds(scene: THREE.Scene): BirdsHandle {
  const материал = new THREE.MeshStandardMaterial({
    color: 0x2e2a26,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const группаСтаи = new THREE.Group();
  scene.add(группаСтаи);

  const птицы: Птица[] = [];
  for (let i = 0; i < ПТИЦ; i++) {
    const группа = new THREE.Group();
    const тело = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.34), материал);
    группа.add(тело);
    // Крылья: тонкие пластины, поставленные под углом, — силуэт «галочки».
    const крылоЛ = new THREE.Mesh(new THREE.BoxGeometry(РАЗМАХ * 0.5, 0.02, 0.16), материал);
    крылоЛ.position.set(-РАЗМАХ * 0.25, 0.02, 0);
    крылоЛ.rotation.z = 0.22;
    const крылоП = new THREE.Mesh(new THREE.BoxGeometry(РАЗМАХ * 0.5, 0.02, 0.16), материал);
    крылоП.position.set(РАЗМАХ * 0.25, 0.02, 0);
    крылоП.rotation.z = -0.22;
    группа.add(крылоЛ, крылоП);
    // Строй: клином назад от вожатого.
    const ряд = i === 0 ? 0 : Math.ceil(i / 2);
    const сторона = i % 2 === 0 ? -1 : 1;
    const dx = i === 0 ? 0 : сторона * ряд * 1.5;
    const dz = i === 0 ? 0 : -ряд * 1.9;
    группаСтаи.add(группа);
    птицы.push({ группа, крылоЛ, крылоП, dx, dz, фаза: Math.random() * 6.28 });
  }

  // Центр стаи ходит по кругу вокруг игрока и медленно поворачивает.
  let угол = 0;
  let направление = 1;
  let центрX = 0;
  let центрZ = 0;
  let начато = false;

  function update(dt: number, now: number, px: number, pz: number): void {
    if (!начато) {
      центрX = px + РАДИУС;
      центрZ = pz;
      начато = true;
    }
    // Стая облетает игрока и не подходит слишком близко.
    // Радиус дышит: то издали, то совсем близко над головой — стая живая.
    угол += dt * 0.085 * направление;
    const радиус = РАДИУС + Math.sin(угол * 0.7) * 28;
    const цельX = px + Math.cos(угол) * радиус;
    const цельZ = pz + Math.sin(угол) * радиус;
    центрX += (цельX - центрX) * Math.min(1, dt * 0.9);
    центрZ += (цельZ - центрZ) * Math.min(1, dt * 0.9);
    // Угол поворота стаи: туда, куда она летит.
    const курс = Math.atan2(центрZ - pz, центрX - px) + Math.PI / 2;
    const взмах = Math.sin(now * 2.4) * 0.5;
    for (const п of птицы) {
      // Птица стоит в строю: смещение поворачивается вместе со стаей.
      const поворот = курс;
      const cs = Math.cos(поворот);
      const sn = Math.sin(поворот);
      const wx = центрX + п.dx * cs - п.dz * sn;
      const wz = центрZ + п.dx * sn + п.dz * cs;
      const wy = ВЫСОТА + Math.sin(now * 0.7 + п.фаза) * 2.2 + (п.dz < 0 ? 1.5 : 0);
      п.группа.position.set(wx, wy, wz);
      п.группа.rotation.y = -курс + Math.PI / 2;
      // Крылья бьют вразнобой: у каждой птицы своя фаза и свой размах.
      const бой = Math.sin(now * 7.5 + п.фаза) * 0.55 + взмах;
      п.крылоЛ.rotation.z = 0.22 - бой;
      п.крылоП.rotation.z = -0.22 + бой;
    }
  }

  function dispose(): void {
    материал.dispose();
    группаСтаи.traverse(o => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    scene.remove(группаСтаи);
  }

  return { update, dispose };
}
