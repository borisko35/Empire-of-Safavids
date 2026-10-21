// Отражения фонарей в мокрой земле (§276).
//
// ЧТО БЫЛО. Лужи и вода в колеях дороги (§264, §269) ловят только небо: это
// карта окружения, а не фонари. Ночная площадь после дождя выглядела мёртвой,
// хотя под ней стоят два фонаря, — и мокрый камень без отражений читается как
// сухой.
//
// ЧТО ТЕПЕРЬ. Под каждым фонарём, где земля мокрая, тянется отблеск вниз —
// вертикальная полоса света, как отражение фонаря в луже. Это не зеркало: от
// настоящего отражения в мире потребовалась бы проба с кубом карт, а полоса
// даёт то же чтение за копейки.
//
// ЧТО ПРОВЕРЯЕТСЯ. Отблески есть, они появляются только на мокрой земле, их
// видно только у ближних фонарей (дальние отблеск не читаются), и они гаснут,
// когда земля сохнет.
import * as THREE from 'three';

/** Сколько отблесков держим в мире. */
const ОТБЛЕСКОВ = 10;
/** Дальше какого расстояния отблеск не читается, метры. */
const ДАЛЕКО = 34;
/** Высота отблеска, метры. */
const ВЫСОТА = 3.2;

export interface GlintsHandle {
  /** Лампы — мировые позиции источников. */
  update(dt: number, now: number, px: number, pz: number, мокрота: number, лампы: { x: number; y: number; z: number }[]): void;
  dispose(): void;
}

/** Полоса света: яркая сверху, тает вниз. */
function текстура(): THREE.CanvasTexture {
  const канва = document.createElement('canvas');
  канва.width = 32;
  канва.height = 128;
  const g = канва.getContext('2d')!;
  g.clearRect(0, 0, 32, 128);
  const градиент = g.createLinearGradient(0, 0, 0, 128);
  градиент.addColorStop(0, 'rgba(255, 196, 120, 0.85)');
  градиент.addColorStop(0.35, 'rgba(255, 176, 96, 0.32)');
  градиент.addColorStop(1, 'rgba(255, 170, 90, 0)');
  g.fillStyle = градиент;
  g.fillRect(0, 0, 32, 128);
  // Блик по центру ярче: отражение фонаря узкое.
  const узкий = g.createLinearGradient(0, 0, 32, 0);
  узкий.addColorStop(0, 'rgba(255, 210, 140, 0)');
  узкий.addColorStop(0.5, 'rgba(255, 220, 160, 0.5)');
  узкий.addColorStop(1, 'rgba(255, 210, 140, 0)');
  g.fillStyle = узкий;
  g.fillRect(0, 0, 32, 128);
  const текст = new THREE.CanvasTexture(канва);
  текст.colorSpace = THREE.SRGBColorSpace;
  return текст;
}

export function createGlints(scene: THREE.Scene): GlintsHandle {
  const картинка = текстура();
  const материал = new THREE.SpriteMaterial({
    map: картинка,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const полосы: THREE.Sprite[] = [];
  for (let i = 0; i < ОТБЛЕСКОВ; i++) {
    const s = new THREE.Sprite(материал.clone());
    s.visible = false;
    s.renderOrder = 4;
    scene.add(s);
    полосы.push(s);
  }

  function update(
    _dt: number,
    now: number,
    px: number,
    pz: number,
    мокрота: number,
    лампы: { x: number; y: number; z: number }[],
  ): void {
    const м = Math.max(0, Math.min(1, мокрота));
    // Ближние лампы: дальше отблеск не читается, а спрайт стоит кадр.
    const ближние = лампы
      .map((л) => ({ л, d: Math.hypot(л.x - px, л.z - pz) }))
      .filter((в) => в.d < ДАЛЕКО)
      .sort((a, b) => a.d - b.d)
      .slice(0, ОТБЛЕСКОВ);
    for (let i = 0; i < полосы.length; i++) {
      const s = полосы[i];
      const в = ближние[i];
      if (!в || м < 0.05) {
        s.visible = false;
        continue;
      }
      s.visible = true;
      s.position.set(в.л.x, в.л.y - ВЫСОТА * 0.5, в.л.z);
      // Полоса чуть колышется: отражение на воде не стоит столбом.
      s.scale.set(1.1 + Math.sin(now / 900 + i) * 0.08, ВЫСОТА, 1);
      (s.material as THREE.SpriteMaterial).opacity = м * 0.5 * (1 - в.d / ДАЛЕКО);
    }
  }

  function dispose(): void {
    for (const s of полосы) {
      (s.material as THREE.SpriteMaterial).dispose();
      scene.remove(s);
    }
    картинка.dispose();
    материал.dispose();
  }

  return { update, dispose };
}
