// Рябь от лодок у причала (§280).
//
// ЧТО БЫЛО. Лодки качаются на волнах (§277), а вода вокруг них стоит стеклом:
// волны шли по всему озеру одинаково, и рядом с лодкой — так же. Причал с
// лодками читался как декорация.
//
// ЧТО ТЕПЕРЬ. От лодки идут круги: волна расходится от борта и гаснет. Круги
// появляются у лодки, расширяются и бледнеют — и вода у причала перестаёт быть
// стеклом.
//
// ЧТО ПРОВЕРЯЕТСЯ. Круги заводятся от лодок, расширяются и гаснут, и их
// немного — иначе причал покроется пеной.
import * as THREE from 'three';

export interface RipplesHandle {
  /** Лодки — мировые позиции. */
  update(dt: number, now: number, лодки: { x: number; y: number; z: number }[]): void;
  dispose(): void;
}

/** Сколько кругов живёт одновременно. */
const КРУГОВ = 8;
/** Начальный и конечный радиус круга, метры. */
const МАЛЫЙ = 0.6;
const БОЛЬШОЙ = 2.6;

/** Кольцо из пены: светлое по краю, прозрачное в середине. */
function текстураКольца(): THREE.CanvasTexture {
  const канва = document.createElement('canvas');
  канва.width = 128;
  канва.height = 128;
  const g = канва.getContext('2d')!;
  g.clearRect(0, 0, 128, 128);
  const кольцо = g.createRadialGradient(64, 64, 40, 64, 64, 62);
  кольцо.addColorStop(0, 'rgba(226, 240, 246, 0)');
  кольцо.addColorStop(0.55, 'rgba(226, 240, 246, 0.75)');
  кольцо.addColorStop(1, 'rgba(226, 240, 246, 0)');
  g.fillStyle = кольцо;
  g.fillRect(0, 0, 128, 128);
  const текстура = new THREE.CanvasTexture(канва);
  текстура.colorSpace = THREE.SRGBColorSpace;
  return текстура;
}

export function createRipples(scene: THREE.Scene): RipplesHandle {
  const картинка = текстураКольца();
  const материал = new THREE.SpriteMaterial({
    map: картинка,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const круги: { sprite: THREE.Sprite; жизнь: number; t: number }[] = [];
  for (let i = 0; i < КРУГОВ; i++) {
    const s = new THREE.Sprite(материал.clone());
    s.visible = false;
    s.renderOrder = 3;
    scene.add(s);
    круги.push({ sprite: s, жизнь: 0, t: 0 });
  }

  let следующий = 0;
  let таймер = 0;

  function update(_dt: number, _now: number, лодки: { x: number; y: number; z: number }[]): void {
    // Новый круг от лодки — не чаще раза в полторы секунды.
    таймер += _dt;
    if (таймер >= 1.5 && лодки.length) {
      таймер = 0;
      const л = лодки[следующий % лодки.length];
      следующий++;
      const к = круги[следующий % круги.length];
      к.sprite.position.set(л.x, л.y + 0.05, л.z);
      к.sprite.visible = true;
      к.жизнь = 2.6;
      к.t = 0;
    }
    for (const к of круги) {
      if (к.жизнь <= 0) continue;
      к.жизнь -= _dt;
      к.t += _dt;
      if (к.жизнь <= 0) {
        к.sprite.visible = false;
        continue;
      }
      const доля = 1 - к.жизнь / 2.6;
      const радиус = МАЛЫЙ + (БОЛЬШОЙ - МАЛЫЙ) * доля;
      к.sprite.scale.set(радиус * 2, радиус * 2, 1);
      (к.sprite.material as THREE.SpriteMaterial).opacity = 0.5 * (1 - доля) * (1 - доля);
    }
  }

  function dispose(): void {
    for (const к of круги) {
      (к.sprite.material as THREE.SpriteMaterial).dispose();
      scene.remove(к.sprite);
    }
    картинка.dispose();
    материал.dispose();
  }

  return { update, dispose };
}
