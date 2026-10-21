// Пыль над дорогой в жару (§268).
//
// ЧТО БЫЛО. Над полотном дороги в жару должно висеть марево пыли: воздух над
// раскалённой дорогой дрожит, и дальний конец полотна тонет в мутном воздухе.
// Было чисто — дорога шла по пустыне стерильной лентой.
//
// ЧТО ТЕПЕРЬ. Над дорогой в жару стоит полоса пыли: она тянется вдоль
// полотна, слегка колышется и держит в себе дальний конец дороги.
//
// ПОЧЕМУ НЕ НАД ВСЕЙ ПУСТЫНЕЙ. Пыль висит там, где нагрет асфальт и
// утоптанный песок, — то есть над дорогой. Над ровной пустыней её нет, и
// поэтому полоса идёт за дорогой, а не за игроком.
import * as THREE from 'three';
import { ROAD_PATHS, groundHeight } from './terrain';

/** Ширина полосы пыли вдоль дороги, метры. */
const ШИРИНА = 60;
/** Высота полосы над полотном, метры. */
const ВЫСОТА = 3.4;

export interface RoadDustHandle {
  /**
   * px/pz — позиция игрока: пыль идёт только по дороге рядом с ним.
   * жар — 0..1: насколько сейчас жарко.
   */
  update(dt: number, now: number, px: number, pz: number, жар: number): void;
  dispose(): void;
}

/** Мягкое пятно пыли: светлее в центре, тает к краям. */
function текстураПыли(): THREE.CanvasTexture {
  const канва = document.createElement('canvas');
  канва.width = 128;
  канва.height = 128;
  const g = канва.getContext('2d')!;
  g.clearRect(0, 0, 128, 128);
  // Основное пятно.
  const основа = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  основа.addColorStop(0, 'rgba(228, 210, 178, 0.55)');
  основа.addColorStop(0.55, 'rgba(228, 210, 178, 0.3)');
  основа.addColorStop(1, 'rgba(228, 210, 178, 0)');
  g.fillStyle = основа;
  g.fillRect(0, 0, 128, 128);
  // Клочья: пыль не ровное пятно, а волоски.
  for (let i = 0; i < 34; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const r = 4 + Math.random() * 16;
    const пятно = g.createRadialGradient(x, y, 0, x, y, r);
    пятно.addColorStop(0, 'rgba(236, 219, 188, 0.35)');
    пятно.addColorStop(1, 'rgba(236, 219, 188, 0)');
    g.fillStyle = пятно;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const текстура = new THREE.CanvasTexture(канва);
  текстура.wrapS = THREE.ClampToEdgeWrapping;
  текстура.wrapT = THREE.ClampToEdgeWrapping;
  текстура.colorSpace = THREE.SRGBColorSpace;
  return текстура;
}

export function createRoadDust(scene: THREE.Scene): RoadDustHandle {
  const текстура = текстураПыли();
  const материал = new THREE.MeshBasicMaterial({
    map: текстура,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const полоса = new THREE.Mesh(
    new THREE.PlaneGeometry(ШИРИНА, 11),
    материал,
  );
  // Пыль лежит НАД полотном, а не стоит стеной поперёк дороги.
  полоса.rotation.x = -Math.PI / 2;
  полоса.renderOrder = 3;
  scene.add(полоса);

  // Дороги: полоса пыли встаёт на каждую, что рядом с игроком.
  const дороги = ROAD_PATHS.map((дорога) => ({
    дорога,
    // Точка на дороге: полоса стоит поперёк полотна.
    x: (дорога.from.x + дорога.to.x) / 2,
    z: (дорога.from.z + дорога.to.z) / 2,
    угол: Math.atan2(дорога.to.z - дорога.from.z, дорога.to.x - дорога.from.x),
  }));

  function update(_dt: number, now: number, px: number, pz: number, жар: number): void {
    // Ищем ближайшую дорогу: пыль над дорогой, а не над пустыней.
    let ближняя: (typeof дороги)[number] | null = null;
    let лучшее = Infinity;
    for (const д of дороги) {
      const d = Math.hypot(д.x - px, д.z - pz);
      if (d < лучшее) { лучшее = d; ближняя = д; }
    }
    if (!ближняя || лучшее > 220) {
      материал.opacity = 0;
      полоса.visible = false;
      return;
    }
    // Полоса лежит над полотном, вдоль дороги.
    const y = groundHeight(ближняя.x, ближняя.z);
    полоса.position.set(ближняя.x, y + ВЫСОТА, ближняя.z);
    полоса.rotation.set(-Math.PI / 2, 0, -ближняя.угол);
    // Колышется: пыль не стоит столбом, а медленно ползёт.
    полоса.position.x += Math.sin(now / 1900) * 1.6;
    полоса.position.z += Math.cos(now / 2100) * 1.6;
    материал.opacity = Math.max(0, Math.min(1, жар)) * 0.5;
    полоса.visible = материал.opacity > 0.01;
  }

  function dispose(): void {
    текстура.dispose();
    материал.dispose();
    полоса.geometry.dispose();
    scene.remove(полоса);
  }

  return { update, dispose };
}
