// HDRI-окружение: фон сцены + свет от неба.
//
// ИНВЕНТАРЬ. Четыре настоящих HDRI (Poly Haven, qwantani_*_puresky_2k, CC0)
// лежат в public/hdr/. Каждый отвечает за своё время суток; когда нужен, он
// грузится раз и остаётся в кэше.
//
// ВЫБОР СЛОЯ. Момент считается по высоте солнца и глубине ночи:
//   • night   — солнце глубоко за горизонтом   (env — тёмный пакет)
//   • dusk    — закатные доли                   (env — вечерний пакет)
//   • morning — утренние доли                   (env — утренний пакет)
//   • noon    — всё остальное                   (env — полдневный пакет)
//
// ФОН СЦЕНЫ по-прежнему рисуется процедурной эквирект-картой — ей нужно
// меняться со временем суток, а HDR — один кадр. Это правильное разделение:
// HDR отвечает за отражения и рассеянный свет (которого мы вручную не ставили),
// а фон — за видимое небо ( которое мы реновируем руками).
//
// ФОЛЛБЭК. .hdr может не доехать (stage без копий, dev-машина): пока ни
// один пакет не загрузится, env собирается процедурно. Никакого «белого
// экрана» или «отсутствия света» не наступает.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import {
  buildEquirect,
  ISFAHAN_DESERT,
  type EquirectMap,
  type SkyState,
  type SkyStyle,
} from './skyEnvironmentMath';
import type { WeatherKind } from './weather';

export type { SkyState, SkyStyle } from './skyEnvironmentMath';
export { ISFAHAN_DESERT } from './skyEnvironmentMath';

type Variant = 'noon' | 'morning' | 'dusk' | 'night';

const HDR: Record<Variant, string> = {
  noon: 'hdr/qwantani_noon_puresky_2k.hdr',
  morning: 'hdr/qwantani_morning_puresky_2k.hdr',
  dusk: 'hdr/qwantani_dusk_1_puresky_2k.hdr',
  night: 'hdr/qwantani_night_puresky_2k.hdr',
};
const ALL_VARIANTS: Variant[] = ['noon', 'morning', 'dusk', 'night'];

const ШИРИНА = 512;
const ВЫСОТА = 256;
const ПОРОГ_СОЛНЦА = 0.02;
const ПОРОГ_НОЧИ = 0.03;
const ПОРОГ_ПАСМУРНОСТИ = 0.05;
const МИНИМУМ_МЕЖДУ_КАДРАМИ = 0.4;

export interface SkyEnvironmentHandle {
  update(state: SkyState, dt: number): void;
  readonly style: SkyStyle;
  readonly rebuilds: number;
  dispose(): void;
}

export class SkyEnvironment implements SkyEnvironmentHandle {
  private readonly pmrem: THREE.PMREMGenerator;
  private texture: THREE.DataTexture | null = null;     // процедурная карта фона
  private procEnv: THREE.WebGLRenderTarget | null = null; // env-цель процедурная
  private hdr: Map<Variant, THREE.WebGLRenderTarget | null> = new Map();
  private hdrPromise: Map<Variant, Promise<THREE.WebGLRenderTarget | null>> = new Map();
  private hdrAny = false;                              // хотя бы один HDR дошёл
  private activeVariant: Variant = 'noon';
  private last: SkyState | null = null;
  private накоплено = 0;
  private _rebuilds = 0;
  private _style: SkyStyle;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
   _renderer: THREE.WebGLRenderer,
   // eslint-disable-next-line no-unused-vars
    style: SkyStyle = ISFAHAN_DESERT,
  ) {
    this._style = style;
    this.pmrem = new THREE.PMREMGenerator(_renderer);
    this.pmrem.compileEquirectangularShader();

    // Kick off параллельную загрузку ВСЕХ вариантов. Как только каждый
    // приедет, он остаётся в кэше; применится при выборе нужного.
    for (const v of ALL_VARIANTS) this.hdrPromise.set(v, this.loadHdrVariant(_renderer, v));

    this.rebuildFully({ sun: [0.4, 0.85, -0.3], moon: [-0.4, -0.85, 0.3], sunHeight: 0.85, night: 0, overcast: 0 });
  }

  get style(): SkyStyle { return this._style; }
  get rebuilds(): number { return this._rebuilds; }

  private loadHdrVariant(_renderer: THREE.WebGLRenderer, v: Variant): Promise<THREE.WebGLRenderTarget | null> {
    return new Promise((resolve) => {
      try {
        // HDRLoader вместо RGBELoader: с three 0.18x старый загрузчик объявлен
        // устаревшим и печатает предупреждение при каждом вызове, а их четыре
        // (по варианту неба на старте). Приёмник тот же — DataTexture в
        // линейном пространстве; mapping и colorSpace ниже задаются явно.
        new HDRLoader().load(
          HDR[v],
          (tex) => {
            if (this.disposed) { tex.dispose(); resolve(null); return; }
            try {
              tex.colorSpace = THREE.LinearSRGBColorSpace;
              tex.mapping = THREE.EquirectangularReflectionMapping;
            } catch { /* и так */ }
            const target = this.pmrem.fromEquirectangular(tex);
            tex.dispose();
            if (this.disposed) { target.dispose(); resolve(null); return; }
            this.hdr.set(v, target);
            this.hdrAny = true;
            resolve(target);
          },
          undefined,
          (err) => {
            console.warn('[skyEnvironment] HDR ' + v + ' не загрузился — ' + err);
            this.hdr.set(v, null);
            resolve(null);
          },
        );
      } catch (e) {
        console.warn('[skyEnvironment] HDR ' + v + ' — ошибка:', e);
        this.hdr.set(v, null);
        resolve(null);
      }
    });
  }

  update(state: SkyState, dt: number): void {
    if (this.disposed) return;
    this.накоплено += dt;

    let изменилось = false;
    const было = this.last;
    if (!было) изменилось = true;
    else if (Math.abs(state.sun[1] - было.sun[1]) > ПОРОГ_СОЛНЦА) изменилось = true;
    else if (Math.abs(state.night - было.night) > ПОРОГ_НОЧИ) изменилось = true;
    else if (Math.abs(state.overcast - было.overcast) > ПОРОГ_ПАСМУРНОСТИ) изменилось = true;

    if (!изменилось) return;
    if (this.накоплено < МИНИМУМ_МЕЖДУ_КАДРАМИ) return;

    // Фон сцены перерисуем, env-цель — если она процедурая ИЛИ HDR ещё не
    // приехал. Если HDR живой, env-ткрытие мы не заменяем каждую секунду
    // (сцена env-переключается только на границе вариантов).
    const wantVariant = this.выбратьVariant(state);
    const нуженFullProc = !this.hdrAny;

    if (нуженFullProc) {
      this.rebuildFully(state);
      this.last = state;
      this.накоплено = 0;
      return;
    }

    this.rebuildBackgroundOnly(state);

    if (wantVariant && wantVariant !== this.activeVariant) {
      const target = this.hdr.get(wantVariant) ?? null;
      if (target) {
        this.activeVariant = wantVariant;
        this.scene.environment = target.texture;
        this._rebuilds++;
      }
    }

    this.переключитьИнтенсивность(state, wantVariant);

    this.last = state;
    this.накоплено = 0;
  }

  private выбратьVariant(state: SkyState): Variant {
    if (state.night > 0.85 || state.sunHeight < -0.2) return 'night';
    if (state.sunHeight < 0.05) return 'dusk';
    if (state.sunHeight < 0.3) return 'morning';
    return 'noon';
  }

  private rebuildFully(состояние: SkyState): void {
    const карта = buildEquirect(this._style, состояние, ШИРИНА, ВЫСОТА);
    const данные = this.вRGBA(карта);

    const текстура = new THREE.DataTexture(
      данные, карта.width, карта.height, THREE.RGBAFormat, THREE.FloatType,
    );
    текстура.colorSpace = THREE.LinearSRGBColorSpace;
    текстура.mapping = THREE.EquirectangularReflectionMapping;
    текстура.needsUpdate = true;

    const цель = this.pmrem.fromEquirectangular(текстура);

    const старыйТекст = this.texture;
    const стараяЦель = this.procEnv;

    this.texture = текстура;
    this.procEnv = цель;
    this.scene.background = текстура;
    this.scene.environment = цель.texture;
    this.last = состояние;
    this.накоплено = 0;
    this._rebuilds++;

    if (старыйТекст && старыйТекст !== текстура) старыйТекст.dispose();
    if (стараяЦель && стараяЦель !== цель) стараяЦель.dispose();
  }

  private rebuildBackgroundOnly(состояние: SkyState): void {
    const карта = buildEquirect(this._style, состояние, ШИРИНА, ВЫСОТА);
    const данные = this.вRGBA(карта);
    const текстура = new THREE.DataTexture(
      данные, карта.width, карта.height, THREE.RGBAFormat, THREE.FloatType,
    );
    текстура.colorSpace = THREE.LinearSRGBColorSpace;
    текстура.mapping = THREE.EquirectangularReflectionMapping;
    текстура.needsUpdate = true;

    const старыйТекст = this.texture;
    this.texture = текстура;
    this.scene.background = текстура;
    this.last = состояние;
    if (старыйТекст && старыйТекст !== текстура) старыйТекст.dispose();
  }

  private множительПоПогоде(p?: WeatherKind): number {
    // Отражательная способность окружения с дождь/грозой должна быть заметно
    // ниже, иначе HDR-небо продолжает светить так, будто на улице солнце.
    switch (p) {
      case 'storm': return 0.42;
      case 'rain': return 0.55;
      case 'fog': return 0.35;
      case 'sandstorm': return 0.62;
      case 'snow': return 1.08;
      case 'cloudy': return 0.82;
      case 'wind': return 0.88;
      default: return 1.0;
    }
  }

  private переключитьИнтенсивность(состояние: SkyState, в: Variant | string): void {
    // Приглушаем рассеянный свет с наступлением ночи — круто падаем при
    // глубокой ночи, чтобы звёзд/луна-блик оставались мягче.
    const базовая = состояние.sunHeight > -0.12
      ? Math.max(0.3, состояние.sunHeight) * 0.5
      : 0.15 + (состояние.sunHeight + 1) * 0.05;
    const инт = Math.max(0.02, базовая * (1 - состояние.overcast * 0.4)
      * (в === 'night' ? 0.5 : 1) * this.множительПоПогоде(состояние.weather));
    this.scene.environmentIntensity = инт;
  }

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
    if (this.scene.background === this.texture) this.scene.background = null;
    // Сбросим env-ссылку только если она указывает на мышечную proc или hdr.
    this.scene.environment = null;
    this.texture?.dispose();
    this.procEnv?.dispose();
    for (const t of this.hdr.values()) t?.dispose();
    this.pmrem.dispose();
    this.texture = null;
    this.procEnv = null;
    this.hdr.clear();
    this.hdrPromise.clear();
  }
}