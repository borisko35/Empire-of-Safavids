import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GBuffer, patchScene, type PatchReport } from './gbuffer';
import { GBufferAo, type AoSettings } from './gbufferAo';

/**
 * Отложенный проход: геометрия в G-buffer, AO по нему, результат в composer.
 *
 * НЕБО В КАНАЛАХ G-BUFFER: ИЗВЕСТНОЕ СВОЙСТВО, А НЕ ДЕФЕКТ.
 *
 * При фоне-цвете three не рисует его геометрией, а ЗАТИРАЕТ ФРЕЙМБУФЕР
 * цветом через glClear. А glClear затирает ВСЕ вложения сразу - не только
 * канал с цветом. Значит на небе в каналах альбедо, нормалей и эмиссии лежит
 * тот же цвет фона, а не честные значения.
 *
 * Первой попыткой было починить это отдельным проходом с gl.drawBuffers. Не
 * вышло, и вот почему: читать depth-текстуру, пока он же привязан к
 *Framebuffer'у, в который идёт отрисовка, - обратная связь, драйвер отдаёт
 * единицу, и discard не срабатывает; квадрат затирал альбедо всей сцены
 * нулями. Откачено.
 *
 * Обойти это можно было бы только запретив three чистить фон, то есть
 * заменив фон-цвет небом-куполом - а это отдельная правка неба и рефракций,
 * которая ничего не даёт AO: он и так отбрасывает небо по depth == 1.
 * Поэтому канал нормалей на небе считается МУСОРНЫМ, и читать его там нельзя.
 * Сторож это проверяет.
 *
 * ЗАМЕНЯЕТ РАБОТУ RenderPass, а не добавляется после него. Цепочка была
 * RenderPass -> SSAOPass -> SSRPass -> BloomPass -> OutputPass, и SSAOPass
 * рисовал сцену ВТОРОЙ раз подменным материалом ради нормалей и глубины.
 * Теперь RenderPass заменён этим проходом, SSAOPass убран (его работу делает
 * GBufferAo по настоящим нормалям), а SSRPass, BloomPass и OutputPass остались
 * нетронутыми: они работают с картинкой и не знают, откуда она взялась.
 *
 * ПОЧЕМУ ОСВЕЩЕНИЕ ОСТАЛОСЬ FORWARD. Полный отложенный рендер означал бы
 * переписать PBR three вместе с VSM-тенями, GGX и IBL по PMREM-карте неба.
 * Это около пятисот строк GLSL, которые нельзя увидеть глазом, а проверить
 * можно только «не чёрный ли экран». Тени в игре - VSM, и в коде уже есть
 * комментарий, что на воде и металле они дают чёрные пятна. Ломать их вслепую
 * ради архитектурной чистоты - плохая сделка. Отложенными стали атрибуты,
 * которые forward-проход иначе выбрасывает.
 *
 * ПОРЯДОК В КАДРЕ И ПРИЧИНА ЗАДЕРЖКИ В ОДИН КАДР:
 *   1. сцена рисуется в G-buffer и одновременно читает AO ПРОШЛОГО кадра;
 *   2. AO считается по только что заполненному G-buffer;
 *   3. канал 0 (освещённый цвет) копируется в composer.
 *
 * Задержка неустранима: читать из цели, в которую пишешь, нельзя. На картинку
 * она не влияет - AO меняется медленно, а движение камеры компенсируется тем,
 * что карта берётся по экранным координатам.
 */
export class DeferredPass extends Pass {
  readonly gbuffer: GBuffer;
  readonly ao: GBufferAo;
  /** Отчёт о прошивке: сколько материалов попало в G-buffer, а сколько нет. */
  readonly patchReport: PatchReport;

  private readonly copyMaterial: THREE.ShaderMaterial;
  private readonly copyQuad: FullScreenQuad;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
  ) {
    super();
    this.needsSwap = false;
    this.gbuffer = new GBuffer(width, height);
    this.ao = new GBufferAo();

    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      // Прямая копия без преобразований: и G-buffer, и composer - обычные
      // цели рендера без цветового пространства, значения в них одинаковые.
      // Любое «улучшение» тут было бы двойным преобразованием.
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(tDiffuse, vUv);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.copyQuad = new FullScreenQuad(this.copyMaterial);


    this.patchReport = patchScene(
      scene,
      this.gbuffer.aoTexture,
      // Инверс разрешения берётся от ПОЛНОГО размера кадра, а не от карты AO.
      // gl_FragCoord идёт в пикселях полного кадра, а размер текстуры для
      // выборки не важен - она нормализует координаты сама. От инверса
      // полуразмерной карты UV уезжал бы вдвое за единицу.
      new THREE.Vector2(1 / Math.max(1, width), 1 / Math.max(1, height)),
    );
  }

  setSize(width: number, height: number): void {
    this.gbuffer.setSize(width, height);
    this.updateAoInverseResolution(width, height);
  }

  /**
   * При смене размера окна инверс разрешения в материалах становится неверным.
   * Uniform лежит в зашитом виде в программе, до неё добраться нельзя, поэтому
   * инверс обновляется через uniform'ы всех прошитых материалов.
   */
  private updateAoInverseResolution(width: number, height: number): void {
    const inv = new THREE.Vector2(1 / Math.max(1, width), 1 / Math.max(1, height));
    this.scene.traverse((объект) => {
      const меш = объект as THREE.Mesh & { material?: THREE.Material | THREE.Material[] };
      if (!меш.material) return;
      const материалы = Array.isArray(меш.material) ? меш.material : [меш.material];
      for (const материал of материалы) {
        if (typeof материал === 'string') continue;
        const программа = (материал as THREE.Material & { userData: Record<string, unknown> })
          .userData;
        const uniforms = программа?.eosAoUniforms as
          | { uEosAoInvRes?: { value: THREE.Vector2 } }
          | undefined;
        if (uniforms?.uEosAoInvRes) uniforms.uEosAoInvRes.value.copy(inv);
      }
    });
  }

  setAoSettings(настройки: Partial<AoSettings>): void {
    this.ao.setSettings(настройки);
  }

  get aoSettings(): AoSettings {
    return this.ao.settings;
  }

  // writeBuffer не используется: needsSwap = false, результат идёт в
  // readBuffer, и composer считает, что ничего не поменялось.
  

render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const прежняяЦель = renderer.getRenderTarget();

    // 1. Геометрия в G-buffer. Материалы в этот момент читают AO прошлого кадра.
    renderer.setRenderTarget(this.gbuffer.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);


    // 2. AO по свежему G-buffer.
    this.ao.render(
      renderer,
      this.gbuffer.channel(2),
      this.gbuffer.depthTexture,
      this.camera,
      this.gbuffer.aoTarget,
    );

    // 4. Канал 0 - ровно тот кадр, что RenderPass отдавал composer'у.
    this.copyMaterial.uniforms.tDiffuse.value = this.gbuffer.channel(0);
    renderer.setRenderTarget(readBuffer);
    if (this.clear) renderer.clear();
    this.copyQuad.render(renderer);

    renderer.setRenderTarget(прежняяЦель);
  }

  dispose(): void {
    this.gbuffer.dispose();
    this.ao.dispose();
    this.copyMaterial.dispose();
    this.copyQuad.dispose();
  }
}