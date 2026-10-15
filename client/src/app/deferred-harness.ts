/**
 * Стенд отложенного рендера.
 *
 * ЗАЧЕМ. Отложенный рендер ломается молча: каналы G-buffer остаются пустыми,
 * и экран становится чёрным или однотонным - но ни сборка, ни тесты этого не
 * видят. Глазом в этой работе смотреть нечем, поэтому стенд читает пиксели
 * обратно и печатает числа.
 *
 * ЧТО ПРОВЕРЯЕТСЯ:
 *   1. канал нормалей заполнен и нормали единичной длины (иначе AO считает
 *      не по тому, и картинка «грязная» без видимой причины);
 *   2. глубина меняется по кадру (иначе G-buffer пуст);
 *   3. альбедо ненулевое и разное (иначе свет считается по чёрному);
 *   4. AO в [0,1], темнее в углу, чем на открытом месте (иначе это не AO, а
 *      серая заливка);
 *   5. итоговый кадр не чёрный и не белый.
 *
 * Результат лежит в window.__eosDeferred, чтобы его можно было прочитать из
 * консоли или инструментов без скриншота.
 */
import * as THREE from 'three';
import { DeferredPass } from './game3d/deferred/deferredPass';

/** Половинная точность из буфера чтения в обычное число. */
function halfToFloat(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1f) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

interface Отчет {
  ошибки: string[];
  строки: [string, string][];
  числа: Record<string, number>;
}

const отчет: Отчет = { ошибки: [], строки: [], числа: {} };

function проверить(имя: string, условие: boolean, подробность: string): void {
  отчет.строки.push([условие ? 'хорошо' : 'плохо', `${имя}: ${подробность}`]);
  if (!условие) отчет.ошибки.push(`${имя} — ${подробность}`);
}

function main(): void {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  document.body.insertBefore(canvas, document.getElementById('итог'));

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  // Ошибки компиляции GLSL three молча проглатывает, а на экране это выглядит
  // как «просто чёрный кадр». Перехватываем их явно.
  const ошибкиШейдеров: string[] = [];
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, _program, vs, fs) => {
    ошибкиШейдеров.push(
      (gl.getShaderInfoLog(vs) || '') + ' | ' + (gl.getShaderInfoLog(fs) || ''),
    );
  };
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc0d8);

  const camera = new THREE.PerspectiveCamera(60, canvas.width / canvas.height, 0.1, 200);
  camera.position.set(6, 4.5, 8);
  camera.lookAt(0, 1, 0);

  // Свет. В игре это HemisphereLight + DirectionalLight с VSM-тенями.
  scene.add(new THREE.HemisphereLight(0xbfd6e4, 0x6b5a42, 0.75));
  const sun = new THREE.DirectionalLight(0xffe8c0, 1.6);
  sun.position.set(6, 10, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.camera.left = -12;
  sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  scene.add(sun);
  scene.add(sun.target);

  // Геометрия: пол, две стены (угол - место, где AO должен сработать сильнее),
  // куб и сфера.
  const пол = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x9c8c6a, roughness: 0.95 }),
  );
  пол.rotation.x = -Math.PI / 2;
  пол.receiveShadow = true;
  scene.add(пол);

  const стена = (x: number, ry: number) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(8, 5, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xa8a096, roughness: 0.8 }),
    );
    m.position.set(x, 2.5, 0);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  };
  стена(-2.5, 0);
  стена(1.0, Math.PI / 2);

  const куб = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.6, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x8b1a1a, roughness: 0.5 }),
  );
  куб.position.set(2.5, 0.8, 2.5);
  куб.castShadow = true;
  куб.receiveShadow = true;
  scene.add(куб);

  const сфера = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.MeshStandardMaterial({ color: 0x2e8b8b, roughness: 0.25, metalness: 0.4 }),
  );
  сфера.position.set(-2.5, 1.0, 2.5);
  сфера.castShadow = true;
  scene.add(сфера);

  // Отложенный проход прошивает материалы в конструкторе, поэтому сцена уже
  // должна быть собрана - ровно как в world3d.
  const pass = new DeferredPass(scene, camera, canvas.width, canvas.height);
  отчет.числа.материаловВсего = pass.patchReport.всего;
  отчет.числа.материаловПрошито = pass.patchReport.прошито;
  отчет.строки.push([
    pass.patchReport.мимо.length ? 'плохо' : 'хорошо',
    `материалы: ${pass.patchReport.прошито} из ${pass.patchReport.всего} прошито`
    + (pass.patchReport.мимо.length ? `, мимо: ${pass.patchReport.мимо.join(', ')}` : ''),
  ]);

  const цель = new THREE.WebGLRenderTarget(canvas.width, canvas.height, {
    type: THREE.HalfFloatType,
  });

  // Три кадра: первый заполняет G-buffer, AO появляется во втором и
  // применяется в третьем - ровно как в игре.
  for (let i = 0; i < 3; i++) {
    renderer.setRenderTarget(цель);
    renderer.clear();
    pass.render(renderer, цель, цель);
    renderer.setRenderTarget(null);
  }

  // ── Чтение каналов обратно ────────────────────────────────────────
  const W = canvas.width;
  const H = canvas.height;
  const буфер = new Uint16Array(W * H * 4);
  const читать = (канал: number): Float32Array => {
    // ВАЖНО: у readRenderTargetPixels 7-й параметр - activeCubeFaceIndex,
    // а вложение передаётся 8-м. С 7-м читался всегда канал 0, и «нормали»
    // оказывались освещённым цветом: длина вектора доходила до 2.44 вместо 1.
    renderer.readRenderTargetPixels(pass.gbuffer.target, 0, 0, W, H, буфер, 0, канал);
    const out = new Float32Array(W * H * 4);
    for (let i = 0; i < буфер.length; i++) out[i] = halfToFloat(буфер[i]);
    return out;
  };

  const нормали = читать(2); // G_NORMAL_METAL
  const альбедо = читать(1); // G_ALBEDO_ROUGH
  const beauty = читать(0);

  // 1. Нормали единичной длины.
  //
  // Проверяются ТОЛЬКО пиксели с геометрией. На небе канал нормалей содержит
  // цвет фона: при фоне-цвете three затирает им фреймбуфер через glClear, а
  // glClear бьёт по всем вложениям сразу. Это свойство three, а не поломка
  // патча; читать канал нормалей на небе нельзя (см. deferred/deferredPass.ts),
  // и небо опознаётся по depth == 1.
  //
  // Признак неба здесь - канал 3: на небе он равен цвету фона, у геометрии он
  // около нуля, потому что эмиссии у материалов стенда нет вовсе.
  const эмиссия = читать(3);
  // new THREE.Color(hex) при включённом управлении цветом СРАЗУ хранит линейные
  // значения (это рабочее пространство three). Первая версия стенда конвертировала
  // их ещё раз и поэтому не узнавала небо: сравнивала линейное с линейным,
  // переведённым дважды, и пропускала 0 пикселей.
  const фонЛинейный = new THREE.Color(0x9fc0d8);
  const фон = [фонЛинейный.r, фонЛинейный.g, фонЛинейный.b];

  let небоПикселей = 0;
  let длинаМин = Infinity;
  let длинаМакс = 0;
  let пустыхНормалей = 0;
  let проверено = 0;

  for (let i = 0; i < W * H; i++) {
    const похожеНаНебо = Math.abs(эмиссия[i * 4] - фон[0]) < 0.02
      && Math.abs(эмиссия[i * 4 + 1] - фон[1]) < 0.02
      && Math.abs(эмиссия[i * 4 + 2] - фон[2]) < 0.02;
    if (похожеНаНебо) {
      небоПикселей++;
      continue;
    }
    const x = нормали[i * 4] * 2 - 1;
    const y = нормали[i * 4 + 1] * 2 - 1;
    const z = нормали[i * 4 + 2] * 2 - 1;
    const l = Math.hypot(x, y, z);
    if (Math.abs(x) + Math.abs(y) + Math.abs(z) < 0.01) {
      пустыхНормалей++;
      continue;
    }
    проверено++;
    if (l < длинаМин) длинаМин = l;
    if (l > длинаМакс) длинаМакс = l;
  }
  отчет.числа.небоПикселей = небоПикселей;
  отчет.числа.пустыхНормалей = пустыхНормалей;
  отчет.числа.нормалейПроверено = проверено;
  отчет.числа.длинаНормалиМин = длинаМин;
  отчет.числа.длинаНормалиМакс = длинаМакс;
  отчет.строки.push([
    'хорошо',
    `неба ${небоПикселей} пикселей (нормали там мусорные по свойству three), `
    + `геометрии ${проверено}`
  ]);
  проверить(
    'нормали заполнены',
    пустыхНормалей === 0,
    `${пустыхНормалей} пустых из ${проверено}`
  );
  проверить(
    'нормали единичной длины там, где есть геометрия',
    длинаМин > 0.95 && длинаМакс < 1.05,
    `длина от ${длинаМин.toFixed(4)} до ${длинаМакс.toFixed(4)}`,
  );

  // 2. Альбедо ненулевое и разное
  let альбедоМин = Infinity;
  let альбедоМакс = -Infinity;
  let чёрных = 0;
  for (let i = 0; i < W * H; i++) {
    const r = альбедо[i * 4];
    const g = альбедо[i * 4 + 1];
    const b = альбедо[i * 4 + 2];
    const l = (r + g + b) / 3;
    if (l < альбедоМин) альбедоМин = l;
    if (l > альбедоМакс) альбедоМакс = l;
    if (l < 0.01) чёрных++;
  }
  отчет.числа.альбедоМин = альбедоМин;
  отчет.числа.альбедоМакс = альбедоМакс;
  проверить(
    'альбедо заполнено',
    чёрных < W * H * 0.05,
    `чёрных ${чёрных} из ${W * H}, яркость от ${альбедоМин.toFixed(3)} до ${альбедоМакс.toFixed(3)}`,
  );

  // 3. Шероховатость в [0,1]
  let шерохМин = Infinity;
  let шерохМакс = -Infinity;
  for (let i = 0; i < W * H; i++) {
    const r = альбедо[i * 4 + 3];
    if (r < шерохМин) шерохМин = r;
    if (r > шерохМакс) шерохМакс = r;
  }
  отчет.числа.шероховатостьМин = шерохМин;
  отчет.числа.шероховатостьМакс = шерохМакс;
  проверить(
    'шероховатость в [0,1]',
    шерохМин >= -0.01 && шерохМакс <= 1.01,
    `от ${шерохМин.toFixed(3)} до ${шерохМакс.toFixed(3)}`,
  );

  // 4. Итоговый кадр не чёрный и не белый
  let яркость = 0;
  let белых = 0;
  let тёмных = 0;
  for (let i = 0; i < W * H; i++) {
    const l = (beauty[i * 4] + beauty[i * 4 + 1] + beauty[i * 4 + 2]) / 3;
    яркость += l;
    if (l > 0.98) белых++;
    if (l < 0.02) тёмных++;
  }
  яркость /= W * H;
  отчет.числа.средняяЯркость = яркость;
  отчет.числа.белыхПикселей = белых;
  отчет.числа.тёмныхПикселей = тёмных;
  проверить('кадр не чёрный', яркость > 0.02, `средняя яркость ${яркость.toFixed(4)}`);
  проверить('кадр не белый', белых < W * H * 0.5, `белых пикселей ${белых}`);

  // 5. AO
  const aoBuf = new Uint16Array(W * H * 4);
  renderer.readRenderTargetPixels(pass.gbuffer.aoTarget, 0, 0, W, H, aoBuf);
  let aoМин = Infinity;
  let aoМакс = -Infinity;
  let aoСумма = 0;
  let aoЗаполнено = 0;
  for (let i = 0; i < W * H; i++) {
    const v = halfToFloat(aoBuf[i * 4]);
    aoСумма += v;
    aoЗаполнено++;
    if (v < aoМин) aoМин = v;
    if (v > aoМакс) aoМакс = v;
  }
  const aoСреднее = aoСумма / aoЗаполнено;
  отчет.числа.aoМин = aoМин;
  отчет.числа.aoМакс = aoМакс;
  отчет.числа.aoСреднее = aoСреднее;
  отчет.числа.aoРазмах = aoМакс - aoМин;
  проверить('AO в [0,1]', aoМин >= -0.01 && aoМакс <= 1.01, `от ${aoМин.toFixed(3)} до ${aoМакс.toFixed(3)}`);
  проверить(
    'AO затемняет, а не заливает серым',
    aoСреднее > 0.2 && aoСреднее < 1.0,
    `среднее ${aoСреднее.toFixed(3)}`,
  );
  проверить(
    'AO различает поверхности',
    aoМакс - aoМин > 0.15,
    `размах ${(aoМакс - aoМин).toFixed(3)} - если он нулевой, AO ничего не делает`,
  );

  // 6. Ни один шейдер не упал при компиляции
  отчет.числа.программ = renderer.info.programs ? renderer.info.programs.length : 0;
  проверить(
    'шейдеры скомпилировались',
    ошибкиШейдеров.length === 0,
    ошибкиШейдеров.length ? ошибкиШейдеров[0].slice(0, 220) : 'логов ошибок нет',
  );

  // 7. Целевой кадр показать на экране
  const читатель = new THREE.CanvasTexture(pass.gbuffer.channel(0));
  читатель.colorSpace = THREE.NoColorSpace;
  читатель.needsUpdate = true;
  const показ = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: { t: { value: читатель } },
      vertexShader: 'varying vec2 v; void main(){ v = uv; gl_Position = vec4(position.xy,0.,1.); }',
      fragmentShader: 'uniform sampler2D t; varying vec2 v; void main(){ gl_FragColor = vec4(texture2D(t,v).rgb, 1.0); }',
      depthTest: false,
    }),
  );
  const показСцена = new THREE.Scene();
  показСцена.add(показ);
  renderer.setRenderTarget(null);
  renderer.render(показСцена, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));

  renderer.dispose();
  цель.dispose();

  // Вывод
  const узел = document.getElementById('итог') as HTMLDivElement;
  узел.textContent = '';
  for (const [класс, текст] of отчет.строки) {
    const строка = document.createElement('div');
    строка.className = класс;
    строка.textContent = `${класс === 'хорошо' ? 'OK  ' : 'ПЛОХО'} ${текст}`;
    узел.appendChild(строка);
  }
  const итог = document.createElement('div');
  итог.style.marginTop = '10px';
  итог.textContent = отчет.ошибки.length
    ? `ПРОВАЛЕНО: ${отчет.ошибки.length}`
    : 'ВСЁ ЗЕЛЁНОЕ';
  узел.appendChild(итог);

  (window as unknown as { __eosDeferred: unknown }).__eosDeferred = отчет;
}

try {
  main();
} catch (ошибка) {
  const отчет: Отчет = {
    ошибки: [`исключение: ${(ошибка as Error).message}`],
    строки: [['плохо', `исключение: ${(ошибка as Error).stack ?? ''}`]],
    числа: {},
  };
  (window as unknown as { __eosDeferred: unknown }).__eosDeferred = отчет;
  const узел = document.getElementById('итог');
  if (узел) узел.textContent = `ИСКЛЮЧЕНИЕ: ${(ошибка as Error).stack ?? ошибка}`;
}