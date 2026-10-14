// HDRI-окружение: эквиректангулярная карта → фон сцены и свет от неё.
//
// ЗАЧЕМ ЭТО, ЕСЛИ СВЕТ УЖЕ ЕСТЬ. Свет в world3d считается вручную: интенсивность
// направленного источника, яркость полусферы, цвет ключевого. Такие числа
// написаны руками и не знают ни про небо, ни про погоду, ни про время суток:
// сменяются они отдельно, и картинка с освещением расходится.
//
// Здесь свет начинает считаться ОТ НЕБА. Карта окружения — это то, что видит
// материал: PMREMGenerator сводит её в ламбертову и зеркальную карты, и дальше
// Three.js сам решает, сколько света отразит металл, камень или ткань. Цифры
// в кадре остаются на месте (солнце и полусфера нужны для теней), но перестают
// быть единственным источником освещения.
//
// ФОН И ОСВЕЩЕНИЕ — РАЗНЫЕ ТЕКСТУРЫ ОДНОЙ КАРТЫ. Фон рисуется как
// эквиректангулярная проекция, свет — через PMREM. Отсюда важное следствие:
// каталог купола-шара (SKY_RADIUS) больше ни при чём, и купол в sky.ts убран.
// Замена не «ещё один слой», а прямо та же картинка неба, что и раньше, только
// теперь у неё есть нижняя половина и зависимость от времени суток.
//
// ЧЕРЕЗ КАКОЙ ТАКТ. Карта пересобирается не каждый кадр, а когда небо
// изменилось существенно: солнце сдвинулось, ночь наступила, тучи подошли.
// Пороги — в unit-величинах солнца и пасмурности, а не в кадрах: иначе на
// слабом ноутбуке карта пересобиралась бы чаще, и свет «дёргался» именно там,
// где его заметнее всего.

import * as THREE from 'three';
import {
  buildEquirect,
  ISFAHAN_DESERT,
  type EquirectMap,
  type SkyState,
  type SkyStyle,
} from './skyEnvironmentMath';

export type { SkyState, SkyStyle } from './skyEnvironmentMath';
export { ISFAHAN_DESERT } from './skyEnvironmentMath';

/** Ширина карты фона. 512 даёт 0.7° на пиксель по высоте: полосы не видно. */
const ШИРИНА = 512;
const ВЫСОТА = 256;

/**
 * Пороги пересборки — «небо заметно изменилось».
 *
 * Значения подобраны не на глаз. Между ними карта не трогается, а при переходе
 * порога свет меняется вместе с картинкой: иначе небо уже новое, а свет ещё
 * старый, и это заметно на гранике смены времени суток.
 */
const ПОРОГ_СОЛНЦА = 0.02;    // сдвиг высоты солнца
const ПОРОГ_НОЧИ = 0.03;      // насколько продвинулась ночь
const ПОРОГ_ПАСМУРНОСТИ = 0.05;
const МИНИМУМ_МЕЖДУ_КАДРАМИ = 0.4; // секунды между пересборками

export interface SkyEnvironmentHandle {
  /** Передать состояние неба. Пересборка — только если небо изменилось. */
  update(state: SkyState, dt: number): void;
  /** Стиль, по которому собрано окружение. */
  readonly style: SkyStyle;
  /** Сколько раз карта пересобрана: для отладки и для стенда. */
  readonly rebuilds: number;
  dispose(): void;
}

export class SkyEnvironment implements SkyEnvironmentHandle {
  private readonly pmrem: THREE.PMREMGenerator;
  private texture: THREE.DataTexture | null = null;
  private target: THREE.WebGLRenderTarget | null = null;
  private last: SkyState | null = null;
  private накоплено = 0;
  private _rebuilds = 0;
  private _style: SkyStyle;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    style: SkyStyle = ISFAHAN_DESERT,
  ) {
    this._style = style;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    // Компиляция шейдера заранее: первый кадр после входа иначе спотыкается о
    // компиляцию, и она попадает в кадр, который игрок видит.
    this.pmrem.compileEquirectangularShader();
    this.rebuild({
      sun: [0.4, 0.85, -0.3],
      moon: [-0.4, -0.85, 0.3],
      sunHeight: 0.85,
      night: 0,
      overcast: 0,
    });
  }

  get style(): SkyStyle { return this._style; }
  get rebuilds(): number { return this._rebuilds; }

  update(state: SkyState, dt: number): void {
    if (this.disposed) return;
    this.накоплено += dt;
    if (!this.изменилосьЛи(state)) return;
    if (this.накоплено < МИНИМУМ_МЕЖДУ_КАДРАМИ) return;
    this.rebuild(state);
  }

  /**
   * Изменилось ли небо достаточно, чтобы трогать GPU.
   *
   * Сравнение по трём величинам, а не «состояние !== прошлое»: состояние —
   * новый объект каждый кадр, и сравнение объектов всегда истинно, то есть
   * пересборка шла бы каждый кадр.
   */
  private изменилосьЛи(состояние: SkyState): boolean {
    const было = this.last;
    if (!было) return true;
    if (Math.abs(состояние.sun[1] - было.sun[1]) > ПОРОГ_СОЛНЦА) return true;
    if (Math.abs(состояние.night - было.night) > ПОРОГ_НОЧИ) return true;
    if (Math.abs(состояние.overcast - было.overcast) > ПОРОГ_ПАСМУРНОСТИ) return true;
    return false;
  }

  private rebuild(состояние: SkyState): void {
    const карта = buildEquirect(this._style, состояние, ШИРИНА, ВЫСОТА);
    const данные = this.вRGBA(карта);

    const текстура = new THREE.DataTexture(
      данные, карта.width, карта.height, THREE.RGBAFormat, THREE.FloatType,
    );
    // Линейный свет, а не sRGB: карта HDR, и декодирование sRGB сломало бы
    // солнце, оставив от него блёклый серый круг.
    текстура.colorSpace = THREE.LinearSRGBColorSpace;
    текстура.mapping = THREE.EquirectangularReflectionMapping;
    текстура.needsUpdate = true;

    const цель = this.pmrem.fromEquirectangular(текстура);

    // Старое освобождаем ПОСЛЕ того, как новое готово. Наоборот — кадр
    // останется без окружения на кадр, и это видно как вспышку.
    const старыйТекст = this.texture;
    const стараяЦель = this.target;
    this.texture = текстура;
    this.target = цель;
    this.scene.background = текстура;
    this.scene.environment = цель.texture;
    this.last = состояние;
    this.накоплено = 0;
    this._rebuilds++;

    if (старыйТекст) старыйТекст.dispose();
    if (стараяЦель) стараяЦель.dispose();
  }

  /** Three.js требует RGBA, а карта считается в RGB: четвёртый канал — единица. */
  private вRGBA(карта: EquirectMap): Float32Array {
    const { data, width, height } = карта;
    const out = new Float32Array(width * height * 4);
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      out[j] = data[i];
      out[j + 1] = data[i + 1];
      out[j + 2] = data[i + 2];
      out[j + 3] = 1;
    }
    return out;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Сцену надо развести с нашими текстурами ДО их уничтожения: иначе
    // Three.js до следующего кадра читает уже освобождённую память GPU.
    if (this.scene.background === this.texture) this.scene.background = null;
    if (this.scene.environment && this.target
        && this.scene.environment === this.target.texture) {
      this.scene.environment = null;
    }
    this.texture?.dispose();
    this.target?.dispose();
    this.pmrem.dispose();
    this.texture = null;
    this.target = null;
  }
}