// Мираж в жару над пустыней (§265).
//
// ЧТО БЫЛО. В пустыне в жару над горизонтом должно «плавать» марево: воздух
// у земли раскалён, и дальний край дороги кажется мокрым. Было чистое небо —
// и пустыня читалась как декорация, а не как место, где жарко.
//
// ЧТО ТЕПЕРЬ. Над горизонтом стоит полоса марева: она поднимается и опускается
// волнами, и город/лагерь/караван за ней размываются. Появляется только в
// жару — в ясный погожий полдень, когда солнце высоко.
//
// ПОЧЕМУ ПОЛОСА, А НЕ ПЯТНО НА ЗЕМЛЕ. Марево у настоящей дороги — это
// отражение неба в раскалённом воздухе у земли, и оно лежит на земле. Но
// земля в мире неровная (рельеф, дюны, городская плита), и плоская лента поверх
// неё то уходит в грунт, то висит в воздухе. Полоса над горизонтом читается
// тем же, а стоит ровно там, где человек ждёт марева.
import * as THREE from 'three';

/** Радиус полосы марева вокруг игрока, метры. */
const РАДИУС = 420;
/** Высота полосы, метры. */
const ВЫСОТА = 26;
/** Насколько полоса сильнее видна в разгар жары. */
const СИЛА = 0.42;

export interface MirageHandle {
  /**
   * px/pz — позиция игрока (полоса идёт за ним).
   * жар — 0..1: насколько сейчас жарко (ясно и солнце высоко).
   */
  update(dt: number, now: number, px: number, pz: number, жар: number): void;
  dispose(): void;
}

/** Текстура марева: мягкие горизонтальные полосы, как дрожь над асфальтом. */
function текстураМарева(): THREE.CanvasTexture {
  const канва = document.createElement('canvas');
  канва.width = 256;
  канва.height = 64;
  const g = канва.getContext('2d')!;
  g.clearRect(0, 0, 256, 64);
  for (let i = 0; i < 64; i++) {
    const y = Math.random() * 64;
    const высота = 1.4 + Math.random() * 3.2;
    const x = Math.random() * 256;
    const ширина = 40 + Math.random() * 110;
    const альфа = 0.2 + Math.random() * 0.5;
    const градиент = g.createLinearGradient(x, 0, x + ширина, 0);
    градиент.addColorStop(0, 'rgba(214, 232, 240, 0)');
    градиент.addColorStop(0.5, `rgba(214, 232, 240, ${альфа})`);
    градиент.addColorStop(1, 'rgba(214, 232, 240, 0)');
    g.fillStyle = градиент;
    g.fillRect(x, y, ширина, высота);
  }
  const текстура = new THREE.CanvasTexture(канва);
  текстура.wrapS = THREE.RepeatWrapping;
  текстура.wrapT = THREE.ClampToEdgeWrapping;
  текстура.repeat.set(9, 1);
  текстура.colorSpace = THREE.SRGBColorSpace;
  return текстура;
}

export function createMirage(scene: THREE.Scene): MirageHandle {
  const текстура = текстураМарева();
  const материал = new THREE.MeshBasicMaterial({
    map: текстура,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  // Кольцо вокруг игрока: полоса марева над горизонтом.
  const кольцо = new THREE.Mesh(
    new THREE.CylinderGeometry(РАДИУС, РАДИУС, ВЫСОТА, 64, 1, true),
    материал,
  );
  кольцо.position.y = ВЫСОТА / 2;
  кольцо.renderOrder = 3;
  scene.add(кольцо);

  function update(_dt: number, now: number, px: number, pz: number, жар: number): void {
    // Полоса идёт за игроком и дышит: две волны разной частоты.
    кольцо.position.x = px;
    кольцо.position.z = pz;
    const волна = Math.sin(now / 1400) * 0.6 + Math.sin(now / 620) * 0.4;
    текстура.offset.x = (now / 2600) % 1;
    текстура.offset.y = волна * 0.04;
    материал.opacity = Math.max(0, Math.min(1, жар)) * СИЛА;
    кольцо.visible = материал.opacity > 0.01;
  }

  function dispose(): void {
    текстура.dispose();
    материал.dispose();
    кольцо.geometry.dispose();
    scene.remove(кольцо);
  }

  return { update, dispose };
}
