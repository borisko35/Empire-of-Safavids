// Пыль и дым (§255).
//
// ЧТО БЫЛО. Караван шёл по песку и не поднимал пыли, а костёр в лагере и
// факелы у караван-сарая не дымили. В кадре это читалось как «мир из
// пластика»: движение без пыли, огонь без дыма.
//
// ЧТО ТЕПЕРЬ. Пул короткоживущих клубов на каждое место: у копыт — пыль,
// у больших огней — дым. Клуб живёт недолго, растёт, бледнеет и уходит.
//
// ПОЧЕМУ ПУЛ, А НЕ ЧАСТИЦЫ. Частицы в three.js — это отдельный шейдер и
// отдельный проход; здесь достаточно спрайтов с мягкой текстурой: их можно
// считать штуками и переиспользовать, и они не стоят ничего, когда клуб ушёл.
import * as THREE from 'three';

export interface PuffOptions {
  /** Сколько клубов в пуле. */
  количество: number;
  /** Цвет клуба. */
  цвет: number;
  /** Начальный размер, метры. */
  размер: number;
  /** Насколько клуб вырастает за свою жизнь, метры. */
  рост: number;
  /** Сколько живёт клуб, секунды. */
  жизнь: number;
  /** Подъём, метры в секунду. */
  подъём: number;
  /** Разброс в стороны, метры в секунду. */
  разброс: number;
  /** Прозрачность в начале жизни. */
  непрозрачность?: number;
  /**
   * Насколько быстро клуб бледнеет. Пыль (2) тает сразу, дым (0.8) держится
   * долго и только потом рассеивается — иначе столб дыма не читается.
   */
  затухание?: number;
  /** Вращение клуба, оборотов в секунду. Для пыльного вихря (§257). */
  вращение?: number;
}

export interface Puffs {
  /** Выпустить клуб в точке. */
  всплеск(x: number, y: number, z: number, сила?: number): void;
  update(dt: number): void;
  dispose(): void;
}

/** Мягкий круглый след: один раз на модуль, дешевле и ровнее, чем шум. */
let следТекстура: THREE.CanvasTexture | null = null;
function след(): THREE.CanvasTexture {
  if (следТекстура) return следТекстура;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  следТекстура = new THREE.CanvasTexture(canvas);
  следТекстура.colorSpace = THREE.SRGBColorSpace;
  return следТекстура;
}

export function createPuffs(scene: THREE.Scene, opts: PuffOptions): Puffs {
  const непрозрачность = opts.непрозрачность ?? 0.5;
  const клубы: {
    sprite: THREE.Sprite;
    жизнь: number;
    максимум: number;
    скорость: THREE.Vector3;
    база: number;
  }[] = [];

  for (let i = 0; i < opts.количество; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: след(),
      color: opts.цвет,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
    }));
    sprite.visible = false;
    scene.add(sprite);
    клубы.push({
      sprite,
      жизнь: 0,
      максимум: 1,
      скорость: new THREE.Vector3(),
      база: opts.размер,
    });
  }

  let следующий = 0;

  function всплеск(x: number, y: number, z: number, сила = 1): void {
    const к = клубы[следующий];
    следующий = (следующий + 1) % клубы.length;
    к.sprite.position.set(
      x + (Math.random() - 0.5) * 0.4,
      y,
      z + (Math.random() - 0.5) * 0.4,
    );
    к.максимум = opts.жизнь * (0.8 + Math.random() * 0.4);
    к.жизнь = к.максимум;
    к.база = opts.размер * (0.75 + Math.random() * 0.5) * сила;
    к.скорость.set(
      (Math.random() - 0.5) * opts.разброс,
      opts.подъём * (0.8 + Math.random() * 0.4),
      (Math.random() - 0.5) * opts.разброс,
    );
    к.sprite.scale.set(к.база, к.база, 1);
    к.sprite.visible = true;
    (к.sprite.material as THREE.SpriteMaterial).opacity = непрозрачность;
  }

  function update(dt: number): void {
    for (const к of клубы) {
      if (к.жизнь <= 0) continue;
      к.жизнь -= dt;
      if (к.жизнь <= 0) {
        к.sprite.visible = false;
        (к.sprite.material as THREE.SpriteMaterial).opacity = 0;
        continue;
      }
      к.sprite.position.addScaledVector(к.скорость, dt);
      // Клуб растёт и бледнеет: пыль оседает, дым расползается.
      const доля = к.жизнь / к.максимум;
      const размер = к.база + opts.рост * (1 - доля);
      к.sprite.scale.set(размер, размер, 1);
      (к.sprite.material as THREE.SpriteMaterial).opacity =
        непрозрачность * Math.pow(доля, opts.затухание ?? 2);
      if (opts.вращение) {
        (к.sprite.material as THREE.SpriteMaterial).rotation += opts.вращение * dt;
      }
    }
  }

  function dispose(): void {
    for (const к of клубы) {
      к.sprite.material.dispose();
      scene.remove(к.sprite);
    }
  }

  return { всплеск, update, dispose };
}
