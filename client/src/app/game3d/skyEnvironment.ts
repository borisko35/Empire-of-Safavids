// HDRI-окружение: эквиректангулярная карта → фон сцены и свет от неё.
//
// НОВАЯ ВЕРСИЯ ( Владелец скачал настоящий .hdr с Poly Haven и положил
// в Assets → затем в client/src/app/public/hdr/). Изменения:
//
//   • Пока .hdr не загружен (или не нашёлся) — работает ВСЁ как раньше:
//     полностью процедурный цикл (сборка карты каждый кадр при заметных
//     изменениях, PMREM, фон и окружение).
//
//   • Когда .hdr загружен (1k или 2k) — используем его КАК ОКРУЖЕНИЕ, а
//     фон сцены остаётся процедурным: иначе ночное небо выглядело бы днём
//     всегда.
//
//   • С уменьшением солнца окружение тускнеет (\`scene.environmentIntensity\`),
//     а не заменяется — иначе резкий switch между картами.
//
//   • Полная процедура оставлена как fallback для оффлайн/dev.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import {
  buildEquirect,
  ISFAHAN_DESERT,
  type EquirectMap,
  type SkyState,
  type SkyStyle,
} from './skyEnvironmentMath';

export type { SkyState, SkyStyle } from './skyEnvironmentMath';
export { ISFAHAN_DESERT } from './skyEnvironmentMath';

/** Путь к на настоящий HDRI (в папке public, которая отдаёт /game/hdr/...). */
const HDR_PATH = 'hdr/qwantani_noon_puresky_2k.hdr';

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
  // Отдельные текстуры\цели, чтобы их жизненный цикл не спорил.
  private hdrTarget: THREE.WebGLRenderTarget | null = null;
  private texture: THREE.DataTexture | null = null;
  private hdrActive = false;
  private last: SkyState | null = null;
  private накоплено = 0;
  private _rebuilds = 0;
  private _style: SkyStyle;
  private disposed = false;

  private procEnvTarget: THREE.WebGLRenderTarget | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    style: SkyStyle = ISFAHAN_DESERT,
  ) {
    this._style = style;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();

    // Запускаем загрузку настоящего HDR. Если (или когда) он приедет,
    // переключаемся на него, иначе — fallback на процедурную карту.
    this.kickHdrLoad();

    this.rebuildFully({ sun: [0.4, 0.85, -0.3], moon: [-0.4, -0.85, 0.3], sunHeight: 0.85, night: 0, overcast: 0 });
  }

  get style(): SkyStyle { return this._style; }
  get rebuilds(): number { return this._rebuilds; }

  private kickHdrLoad(): void {
    new RGBELoader().load(
      this.hdrPath(),
      (tex) => {
        if (this.disposed) { tex.dispose(); return; }
        try {
          tex.colorSpace = THREE.LinearSRGBColorSpace;
          tex.mapping = THREE.EquirectangularReflectionMapping;
        } catch { /* igoro */ }
        const target = this.pmrem.fromEquirectangular(tex);
        tex.dispose();
        if (this.disposed) { target.dispose(); return; }
        const old = this.hdrTarget;
        this.hdrTarget = target;
        this.hdrActive = true;
        this._rebuilds++;
        // Если процедура уже заменила scene.environment, HDR теперь становится
        // главным: override при следующем update, но лучше сразу, чтобы не
        // ждать порога изменения неба.
        this.scene.environment = target.texture;
        old?.dispose();
      },
      undefined,
      (err) => {
        console.warn('[skyEnvironment] HDR не загрузился — работает процедура:', err);
      },
    );
  }

  private hdrPath(): string { return HDR_PATH; }

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

    // Если HDR ещё не приехал ИЛИ его нет — собираем всё как раньше.
    if (!this.hdrActive) {
      this.rebuildFully(state);
      return;
    }

    // HDR живой: регенерим только фон сцены, env-цель не трогаем, но
    // приглушаем её с наступлением ночи и с пасмурностью.
    this.rebuildBackgroundOnly(state);
    this.переключитьИнтенсивность(state);
    this.last = state;
    this.накоплено = 0;
    this._rebuilds++;
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
    const стараяЦель = this.procEnvTarget;

    this.texture = текстура;
    this.texture = текстура;
    this.procEnvTarget = цель;
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

  private переключитьИнтенсивность(состояние: SkyState): void {
    // Уменьшаем свет окружения при наступлении ночи, и чуть в бурю.
    const ночь = 1 - Math.max(0, Math.min(1, состояние.night));
    
    const доля = состояние.sunHeight > -0.12 ? Math.max(0.3, состояние.sunHeight) : 0.05;
    void ночь;
    this.scene.environmentIntensity = Math.max(0.08, доля * (1 - состояние.overcast * 0.35));
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
    if (this.scene.environment && this.hdrTarget && this.scene.environment === this.hdrTarget.texture) {
      this.scene.environment = null;
    }
    if (this.procEnvTarget) this.scene.environment = null;
    this.texture?.dispose();
    this.procEnvTarget?.dispose();
    this.hdrTarget?.dispose();
    this.pmrem.dispose();
    this.texture = null;
    this.texture = null;
    this.procEnvTarget = null;
    this.hdrTarget = null;
  }
}