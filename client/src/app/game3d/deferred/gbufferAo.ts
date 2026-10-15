import * as THREE from 'three';
import { AO_SAMPLES } from './gbuffer';

/**
 * Ambient occlusion по G-buffer.
 *
 * ЗАЧЕМ ЭТО ОТЛОЖЕННЫЙ ПРОХОД, А НЕ КАК РАНЬШЕ.
 *
 * Раньше AO считал SSAOPass: он рендерил сцену ВТОРОЙ раз подменным
 * MeshNormalMaterial, чтобы получить нормали и глубину, и нормали у AO были
 * геометрическими - карты нормалей он не видел. Теперь нормали берутся
 * настоящие, из канала G-buffer вместе с текстурой рельефа, и вторая
 * отрисовка сцены не нужна вовсе.
 *
 * ГДЕ ПРИМЕНЯЕТСЯ. AO умножает рассеянный свет от неба (indirectDiffuse) и
 * часть зеркального отражения. Прямое солнце и факелы не трогает: тень от
 * забора прячет от солнца, но небо освещает её края. Раньше AO применялся к
 * готовому цвету и затемнял солнце тоже, и картинка в тенях уходила в грязь.
 *
 * ПОЧЕМУ ИМЕННО ТАК. Полусферическое сэмплирование бьёт в hemisphere и не
 * считает, что поверхность освещена сверху: на открытой местности это даёт
 * грязное пятно на земле под небом. Здесь AO - только затемнение, а свет по
 * прежнему решает forward-проход: небо, солнце и факелы.
 *
 * ИДЕНТИФИКАТОРЫ ТОЛЬКО ЛАТИНИЦЕЙ. Первая версия этого шейдера была написана с
 * русскими именами переменных (взгляд, касат, сценаГлубина) и не скомпилировалась:
 * синтаксическая ошибка в строке 95, а на экране - просто чёрный AO. Спецификация
 * GLSL ES допускает не-ASCII в идентификаторах не на всех драйверах, и проверять
 * это приходится на той машине, где билет не отлавливается ничем. В waterWaves
 * латиница тоже стоит: в waterGlslProbe это сторож.
 */

// GLSL: идентификаторы латиницей, комментарии по-русски.
const AO_FRAG = `
precision highp float;

uniform sampler2D uNormalMetal;
uniform sampler2D uDepth;
uniform mat4 uProjection;
uniform mat4 uProjectionInverse;
uniform mat4 uViewInverse;
uniform vec3 uEye;
uniform float uRadius;
uniform float uBias;
uniform float uIntensity;
uniform vec2 uResolution;

varying vec2 vUv;

// Точка экрана в мир по своей глубине.
vec3 worldFromDepth(vec2 uv, float d) {
  vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 view = uProjectionInverse * clip;
  view /= view.w;
  return (uViewInverse * vec4(view.xyz, 1.0)).xyz;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
}

void main() {
  float d = texture2D(uDepth, vUv).x;
  // Небо и за краем кадра: заполняем единицей, иначе верх картинки темнеет.
  if (d >= 0.999999) {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
    return;
  }

  vec4 nm = texture2D(uNormalMetal, vUv);
  vec3 nrm = normalize(nm.xyz * 2.0 - 1.0);
  vec3 view = normalize((uViewInverse * vec4(nrm, 0.0)).xyz);
  vec3 world = worldFromDepth(vUv, d);

  // Касательное пространство взгляда: без него сэмплы уезжают в небо.
  vec3 tangent = normalize(cross(view, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 1e-4, 0.0));
  vec3 bitangent = cross(view, tangent);

  float noise = hash(gl_FragCoord.xy);
  float occluded = 0.0;
  float considered = 0.0;

  for (int i = 0; i < ${AO_SAMPLES}; i++) {
    float fi = float(i);
    // Золотой угол: сэмплы расходятся ровнее, чем на равномерной спирали.
    float angle = fi * 2.39996323 + noise * 6.28318531;
    float r = sqrt((fi + 0.5) / ${AO_SAMPLES}.0);
    float h = sqrt(max(0.0, 1.0 - r * r));
    vec3 dir = normalize(
      tangent * (cos(angle) * r) + bitangent * (sin(angle) * r) + view * h);

    // Радиус растёт по золотой пропорции: ближние сэмплы плотнее, и AO не
    // зависит от того, насколько далеко до угла.
    float march = uRadius * fract(noise + fi * 0.6180339887);
    vec3 sampleWorld = world + dir * march;

    vec4 clip = uProjection * vec4(sampleWorld, 1.0);
    vec2 uv = (clip.xy / clip.w) * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;

    float sceneDepth = texture2D(uDepth, uv).x;
    if (sceneDepth >= 0.999999) continue;

    // Разница в МИРЕ, а не в буфере глубины: буфер нелинеен, и рядом с
    // камерой одно и то же число означает разные расстояния.
    vec3 sceneWorld = worldFromDepth(uv, sceneDepth);
    if (length(sceneWorld - uEye) < length(sampleWorld - uEye) - uBias) occluded += 1.0;
    considered += 1.0;
  }

  float ao = considered > 0.0 ? 1.0 - occluded / considered : 1.0;
  ao = mix(1.0, ao, uIntensity);
  gl_FragColor = vec4(clamp(ao, 0.0, 1.0), 1.0, 1.0, 1.0);
}
`;

/**
 * Размытие крестом за один проход.
 *
 * Считать размытие на месте нельзя: соседи по экрану не обязаны быть
 * соседями по поверхности, и усреднение там, где край стены соприкасается с
 * небом, затирает шов. Крест из 8 отсчётов с весами дешевле двух проходов и для
 * AO достаточно.
 */
const BLUR_FRAG = `
precision highp float;
uniform sampler2D uAo;
uniform vec2 uTexel;
varying vec2 vUv;

void main() {
  float c = texture2D(uAo, vUv).r;
  float s = c * 0.25;
  s += texture2D(uAo, vUv + vec2( uTexel.x,  uTexel.y)).r * 0.125;
  s += texture2D(uAo, vUv + vec2(-uTexel.x,  uTexel.y)).r * 0.125;
  s += texture2D(uAo, vUv + vec2( uTexel.x, -uTexel.y)).r * 0.125;
  s += texture2D(uAo, vUv + vec2(-uTexel.x, -uTexel.y)).r * 0.125;
  s += texture2D(uAo, vUv + vec2( uTexel.x * 2.0, 0.0)).r * 0.0625;
  s += texture2D(uAo, vUv + vec2(-uTexel.x * 2.0, 0.0)).r * 0.0625;
  s += texture2D(uAo, vUv + vec2(0.0,  uTexel.y * 2.0)).r * 0.0625;
  s += texture2D(uAo, vUv + vec2(0.0, -uTexel.y * 2.0)).r * 0.0625;
  gl_FragColor = vec4(vec3(s), 1.0);
}
`;

const FULLSCREEN_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export interface AoSettings {
  /** Радиус сэмплирования, м. */
  radius: number;
  /** Смещение против самозаслонения, м. */
  bias: number;
  /** Сила: 1 — как посчитано. 0 — AO выключен. */
  intensity: number;
}

export const AO_DEFAULT: AoSettings = { radius: 1.7, bias: 0.05, intensity: 0.8 };

export class GBufferAo {
  private readonly aoMaterial: THREE.ShaderMaterial;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** Промежуточная цель для размытия: писать из цели в саму себя нельзя. */
  private readonly temp: THREE.WebGLRenderTarget;

  constructor() {
    this.aoMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: AO_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uNormalMetal: { value: null },
        uDepth: { value: null },
        uProjection: { value: new THREE.Matrix4() },
        uProjectionInverse: { value: new THREE.Matrix4() },
        uViewInverse: { value: new THREE.Matrix4() },
        uEye: { value: new THREE.Vector3() },
        uRadius: { value: AO_DEFAULT.radius },
        uBias: { value: AO_DEFAULT.bias },
        uIntensity: { value: AO_DEFAULT.intensity },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
    });

    this.blurMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uAo: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.aoMaterial);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.temp = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
  }

  setSettings(настройки: Partial<AoSettings>): void {
    const u = this.aoMaterial.uniforms;
    if (настройки.radius !== undefined) u.uRadius.value = настройки.radius;
    if (настройки.bias !== undefined) u.uBias.value = настройки.bias;
    if (настройки.intensity !== undefined) u.uIntensity.value = настройки.intensity;
  }

  get settings(): AoSettings {
    const u = this.aoMaterial.uniforms;
    return { radius: u.uRadius.value, bias: u.uBias.value, intensity: u.uIntensity.value };
  }

  /**
   * Считает AO из G-buffer в цель. Карта применяется в геометрии СЛЕДУЮЩЕГО
   * кадра: считать AO и читать его в том же кадре нельзя, он ещё не готов.
   */
  render(
    renderer: THREE.WebGLRenderer,
    normalMetal: THREE.Texture,
    depth: THREE.Texture,
    camera: THREE.PerspectiveCamera,
    цель: THREE.WebGLRenderTarget,
  ): void {
    const u = this.aoMaterial.uniforms;
    u.uNormalMetal.value = normalMetal;
    u.uDepth.value = depth;
    u.uProjection.value.copy(camera.projectionMatrix);
    u.uProjectionInverse.value.copy(camera.projectionMatrixInverse);
    u.uViewInverse.value.copy(camera.matrixWorld);
    u.uEye.value.setFromMatrixPosition(camera.matrixWorld);
    u.uResolution.value.set(цель.width, цель.height);

    if (this.temp.width !== цель.width || this.temp.height !== цель.height) {
      this.temp.setSize(цель.width, цель.height);
    }
    this.blurMaterial.uniforms.uTexel.value.set(1 / цель.width, 1 / цель.height);

    const прежняя = renderer.getRenderTarget();

    this.quad.material = this.aoMaterial;
    renderer.setRenderTarget(this.temp);
    renderer.render(this.scene, this.camera);

    this.quad.material = this.blurMaterial;
    this.blurMaterial.uniforms.uAo.value = this.temp.texture;
    renderer.setRenderTarget(цель);
    renderer.render(this.scene, this.camera);

    renderer.setRenderTarget(прежняя);
  }

  dispose(): void {
    this.aoMaterial.dispose();
    this.blurMaterial.dispose();
    this.temp.dispose();
  }
}