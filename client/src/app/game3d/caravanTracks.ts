// Следы караванов на дороге (§270).
//
// ЧТО БЫЛО. Караваны ходят по дороге каждый день, а на полотне — только колея
// от повозок. Следов копыт не было, и дорога читалась как пустая лента, по
// которой никто не ходил.
//
// ЧТО ТЕПЕРЬ. Между колёями идёт цепочка следов копыт. На сухом песке следы
// едва видны, на мокром — проступают: мокрый песок держит отпечаток, сухой
// рассыпается. То есть после дождя дорога читается как дорога, по которой
// вчера прошёл караван.
//
// ПОЧЕМУ СЛЕДЫ НЕ СЛЕДУЮТ ЗА КАРАВАНОМ. След остаётся там, где караван
// прошёл: они копятся вдоль дороги, а не бегут за ним.
import * as THREE from 'three';
import { ROAD_PATHS, groundHeight } from './terrain';

/** Ширина полосы следов, метры. */
const ШИРИНА = 1.8;

export interface CaravanTracksHandle {
  update(dt: number, now: number, px: number, pz: number, мокрота: number): void;
  dispose(): void;
}

/** Следы копыт: тёмные пятна парами вдоль ленты. */
function текстураСледов(): THREE.CanvasTexture {
  const канва = document.createElement('canvas');
  канва.width = 128;
  канва.height = 64;
  const g = канва.getContext('2d')!;
  g.clearRect(0, 0, 128, 64);
  // Пары копыт: два пятна рядом, парами вдоль ленты.
  for (let i = 0; i < 26; i++) {
    const x = 6 + Math.random() * (128 - 12);
    const y = 18 + Math.random() * 28;
    for (const сдвиг of [-3.4, 3.4]) {
      const пятно = g.createRadialGradient(x + сдвиг, y, 0, x + сдвиг, y, 3.2);
      пятно.addColorStop(0, 'rgba(84, 68, 46, 0.75)');
      пятно.addColorStop(0.7, 'rgba(96, 78, 52, 0.35)');
      пятно.addColorStop(1, 'rgba(96, 78, 52, 0)');
      g.fillStyle = пятно;
      g.fillRect(x + сдвиг - 4, y - 4, 8, 8);
    }
  }
  const текстура = new THREE.CanvasTexture(канва);
  текстура.wrapS = THREE.RepeatWrapping;
  текстура.wrapT = THREE.ClampToEdgeWrapping;
  текстура.colorSpace = THREE.SRGBColorSpace;
  return текстура;
}

export function createCaravanTracks(scene: THREE.Scene): CaravanTracksHandle {
  const текстура = текстураСледов();
  const материал = new THREE.MeshBasicMaterial({
    map: текстура,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const лента = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), материал);
  лента.rotation.x = -Math.PI / 2;
  лента.renderOrder = 2;
  scene.add(лента);

  const дороги = ROAD_PATHS.map((дорога) => ({
    дорога,
    x: (дорога.from.x + дорога.to.x) / 2,
    z: (дорога.from.z + дорога.to.z) / 2,
    угол: Math.atan2(дорога.to.z - дорога.from.z, дорога.to.x - дорога.from.x),
  }));

  function update(_dt: number, _now: number, px: number, pz: number, мокрота: number): void {
    let ближняя: (typeof дороги)[number] | null = null;
    let лучшее = Infinity;
    for (const д of дороги) {
      const d = Math.hypot(д.x - px, д.z - pz);
      if (d < лучшее) { лучшее = d; ближняя = д; }
    }
    if (!ближняя || лучшее > 260) {
      материал.opacity = 0;
      лента.visible = false;
      return;
    }
    const y = groundHeight(ближняя.x, ближняя.z) + 0.04;
    лента.position.set(ближняя.x, y, ближняя.z);
    лента.rotation.set(-Math.PI / 2, 0, -ближняя.угол);
    // Лента длинная вдоль дороги; следы повторяются по всей длине.
    const длина = Math.hypot(
      ближняя.дорога.to.x - ближняя.дорога.from.x,
      ближняя.дорога.to.z - ближняя.дорога.from.z,
    );
    лента.scale.set(ШИРИНА, длина, 1);
    // Мокрый песок держит отпечаток, сухой рассыпается.
    материал.opacity = 0.22 + Math.max(0, Math.min(1, мокрота)) * 0.42;
    лента.visible = материал.opacity > 0.01;
  }

  function dispose(): void {
    текстура.dispose();
    материал.dispose();
    лента.geometry.dispose();
    scene.remove(лента);
  }

  return { update, dispose };
}
