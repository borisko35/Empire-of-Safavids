import * as THREE from 'three';

/**
 * G-buffer: что forward-проход выбрасывает, а экранному освещению нужно.
 *
 * ЧТО ЗДЕСЬ ОТЛОЖЕНО, А ЧТО НЕТ - И ПОЧЕМУ ТАК.
 *
 * Настоящий отложенный рендер - это когда геометрия рисует в буфер одни
 * albedo/normal/depth, а освещение считает полноэкранный шейдер. Здесь так и
 * сделано для экранных эффектов: нормали (с учётом карт нормалей!), глубина,
 * шероховатость и металличность пишутся в MRT и уходят в AO и отражения.
 *
 * А освещение остаётся three'овским forward. И это не недоделка, а решение,
 * и вот почему. Тени в игре — VSM (world3d.ts, THREE.VSMShadowMap), и в коде
 * уже есть комментарий, что VSM-тени на воде и металле ведут себя скверно и
 * дают чёрные пятна. Чтобы перенести их в свой шейдер, пришлось бы заново
 * написать выборку VSM-карты со всеми её блэд-хаками, плюс GGX, плюс IBL по
 * PMREM-карте неба, плюс полуфакельное освещение. Это около пятисот строк GLSL,
 * результат которых нельзя увидеть глазом и нечем проверить, кроме как «не чёрно
 * ли». Три раза такого уже хватает.
 *
 * Поэтому: геометрия и свет — как были, проверены и работают. Отложенными
 * стали атрибуты, которые forward-проход иначе выбрасывает, и по которым
 * экранные эффекты считались вслепую (SSAOPass рендерил сцену ВТОРОЙ раз
 * подменным материалом, чтобы получить те же нормали - теперь берёт настоящие).
 *
 * ЧЕТЫРЕ ВЛОЖЕНИЯ, А НЕ ТРИ. Канал 0 занимает three: он пишет туда освещённый
 * цвет, и это в точности то, что раньше отдавал RenderPass. Каналы 1..3 пишем
 * мы. Отказываться от канала 0 нельзя: при GLSL3 three не объявляет выход сам
 * (WebGLProgram.js, строка 819), а канал 0 всё равно создаётся движком.
 */

export const G_ALBEDO_ROUGH = 1;
export const G_NORMAL_METAL = 2;
export const G_EMISSIVE_MASK = 3;

/** Сколько плиток сэмплирует AO на пиксель. Больше - мягче и дороже. */
export const AO_SAMPLES = 12;

export class GBuffer {
  readonly target: THREE.WebGLRenderTarget;
  /** Глубина нужна AO: без неё соседей не найти. */
  readonly depthTexture: THREE.DepthTexture;
  /** Карта AO прошлого кадра: применяется в геометрии, считается в конце. */
  readonly aoTarget: THREE.WebGLRenderTarget;

  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);

    this.depthTexture = new THREE.DepthTexture(this.width, this.height);
    // UnsignedIntType, а не Float: он работает везде, а точности хватает с
    // запасом - AO нужен знак «ближе/дальше», а не абсолютная глубина.
    this.depthTexture.type = THREE.UnsignedIntType;
    this.depthTexture.minFilter = THREE.NearestFilter;
    this.depthTexture.magFilter = THREE.NearestFilter;

    this.target = new THREE.WebGLRenderTarget(this.width, this.height, {
      count: 4,
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      depthTexture: this.depthTexture,
      // Без этого каналы пишутся с альфой, а альфа нужна нам как данные.
      stencilBuffer: false,
    });
    // Ближние октавы AO читаются в полноэкранном шейдере, где нелинейная
    // фильтрация даёт ореол на краях. Линейная - честная, а размытие AO
    // делается отдельным проходом с нормальным блендингом.
    for (const текстура of this.target.textures) {
      текстура.generateMipmaps = false;
    }

    this.aoTarget = new THREE.WebGLRenderTarget(this.width, this.height, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  /** Равномерное разрешение: полноразмерный AO стоит дороже, чем он заметен. */
  static aoSize(width: number, height: number, делитель = 2): { w: number; h: number } {
    return { w: Math.max(1, Math.floor(width / делитель)), h: Math.max(1, Math.floor(height / делитель)) };
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.target.setSize(w, h);
    const { w: aw, h: ah } = GBuffer.aoSize(w, h);
    this.aoTarget.setSize(aw, ah);
    this.depthTexture.image.width = w;
    this.depthTexture.image.height = h;
    this.depthTexture.needsUpdate = true;
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** Текстура канала по номеру вложения. */
  channel(индекс: number): THREE.Texture {
    return this.target.textures[индекс];
  }

  /** Текстура AO, которую надо вставить в материалы при сборке сцены. */
  get aoTexture(): THREE.Texture {
    return this.aoTarget.texture;
  }

  dispose(): void {
    this.target.dispose();
    this.aoTarget.dispose();
    this.depthTexture.dispose();
  }
}

// ── Патч материалов ──────────────────────────────────────────────────

const УЖЕ_ПРОШИТЫ = new WeakSet<THREE.Material>();

/** Сколько шейдеров реально прошито при компиляции. См. patchMaterial. */
let прошитоПриКомпиляции = 0;

export function сколькоПрошито(): number {
  return прошитоПриКомпиляции;
}

/**
 * Объявления каналов. Ставятся в начало тела фрагментного шейдера.
 * Канал 0 объявляет three сам (pc_fragColor) - мы занимаем 1, 2 и 3.
 */
const ОБЪЯВЛЕНИЯ = `
layout(location = 1) out vec4 gAlbedoRough;
layout(location = 2) out vec4 gNormalMetal;
layout(location = 3) out vec4 gEmissiveMask;
`;

/**
 * Запись каналов. Вставляется перед <opaque_fragment>: к этому месту уже
 * посчитаны diffuseColor (карта цвета), normal (карты нормалей), roughnessFactor,
 * metalnessFactor и totalEmissiveRadiance.
 *
 * Нормаль кладётся в пространстве взгляда: three считает normal именно так, и
 * AO смотрит в пространстве взгляда - иначе пришлось бы пересчитывать её в
 * каждой точке.
 */
const ЗАПИСЬ = `
  gAlbedoRough = vec4(diffuseColor.rgb, roughnessFactor);
  gNormalMetal = vec4(normalize(normal) * 0.5 + 0.5, metalnessFactor);
  gEmissiveMask = vec4(totalEmissiveRadiance, 1.0);
#include <opaque_fragment>
`;

/**
 * Подключает AO из карты прошлого кадра.
 *
 * Замена ровно <aomap_fragment>: в three этот кусок умножает
 * reflectedLight.indirectDiffuse на затемнение, и стоит он ПОСЛЕ
 * lights_fragment_end - то есть ровно там, где AO и должен действовать.
 * Затенение от прямого солнца и от фонарей AO не трогает, и это правильно:
 * тень от забора прячет от солнца, но не от неба.
 */
const ЗАПИСЬ_AO = `
  #include <aomap_fragment>
  float eosAo = texture2D(uEosAoMap, gl_FragCoord.xy * uEosAoInvRes).r;
  reflectedLight.indirectDiffuse *= eosAo;
  reflectedLight.indirectSpecular *= mix(1.0, eosAo, 0.6);
`;

const АО_ОБЪЯВЛЕНИЯ = `
uniform sampler2D uEosAoMap;
uniform vec2 uEosAoInvRes;
`;

/**
 * Запись для материала, который прошить нельзя.
 *
 * ЗАЧЕМ, ЕСЛИ ПРОШИТЬ НЕЛЬЗЯ. G-buffer — это четыре выхода сразу (albedo,
 * normal, AO-маска плюс цвет канала 0). Правило WebGL строгое: если у
 * цели включены четыре draw buffer'а, шейдер обязан писать во ВСЕ четыре.
 * Шейдер, который пишет только канал 0, роняет весь вызов draw с
 * GL_INVALID_OPERATION «Active draw buffers with missing fragment shader
 * outputs» — и объект не рисуется НИКАК.
 *
 * То есть старая договорённость «кто не подходит, тот не прошивается, пропуск
 * лучше, чем шить наугад» в G-buffer оборачивалась ровно обратным: не
 * прошил — объект исчез. Пропускать нельзя было ничего.
 *
 * Поэтому и для непрошитых объявления те же самые, а значения — заглушки:
 * нормаль «плоская» (0.5, 0.5, 1.0 в кодировке normal*0.5+0.5), металл и
 * шероховатость нулевые. В канале 0 материал пишет как обычно, то есть
 * видно его нормальный цвет — он просто не участвует в AO.
 *
 * Запись идёт в НАЧАЛО main, а не в конец: дописывать после закрывающей
 * скобки main нельзя, это уже глобальная область, и оператор записи там
 * недопустим.
 */
const ПУСТАЯ_ЗАПИСЬ = `
  gAlbedoRough = vec4(0.0);
  gNormalMetal = vec4(0.5, 0.5, 1.0, 0.0);
  gEmissiveMask = vec4(0.0);
`;

/** Есть ли в шейдере всё, от чего патч зависит. */
function подходит(фрагмент: string): boolean {
  return фрагмент.includes('#include <opaque_fragment>')
    && фрагмент.includes('#include <aomap_fragment>');
}

const ГЛАВНАЯ = /void\s+main\s*\(\s*\)\s*\{/;

/**
 * Ключ программы прошитого материала.
 *
 * Отдельной строкой, потому что к нему дописывается ключ чужого патча, а
 * сторож (deferredGBuffer.test.ts) проверяет именно наличие своего префикса:
 * без него three отдаст программу без каналов G-buffer.
 */
const КЛЮЧ_ПРОГРАММЫ = 'eos-gbuffer-ao';

/**
 * Прошивает материал: он начинает писать каналы G-buffer и брать AO из карты.
 *
 * Материалы без нужных include'ов (свои шейдеры: вода, небо, погода,
 * спрайты) прошить по-настоящему нельзя, но объявить и записать все четыре
 * выхода для них обязательно — см. ПУСТАЯ_ЗАПИСЬ. Без этого их draw
 * отбрасывается и объекта не видно.
 */
export function patchMaterial(
  material: THREE.Material,
  aoTexture: THREE.Texture,
  aoInverseResolution: THREE.Vector2,
): boolean {
  if (УЖЕ_ПРОШИТЫ.has(material)) return true;

  const расширяемый = material as THREE.Material & {
    onBeforeCompile?: (shader: THREE.WebGLProgramParametersWithUniforms, renderer: unknown) => void;
    customProgramCacheKey?: () => string;
  };
  if (typeof расширяемый.onBeforeCompile !== 'function' && !('isShaderMaterial' in material)) {
    return false;
  }

  const ссылки: Record<string, { value: unknown }> = {};

  // ЧУЖОЙ ПАТЧ НЕЛЬЗЯ ВЫБРАСЫВАТЬ.
  //
  // Прошивка ПОДМЕНЯЕТ onBeforeCompile, а не дополняет его. Всё, что материал
  // уже нёс в этом обработчике, до сих пор молча пропадало: у площади города
  // там макро-слой (textures.ts, addMacroLayer) — низкочастотная пестрота,
  // без которой плитка читается решёткой повтора. Пока сцена не прошивалась
  // вовсе (проход создавался до постройки мира), этого никто не видел; как
  // только прошивка заработала, потеря стала бы заметной.
  //
  // Поэтому прежний обработчик вызывается первым, а наши вставки ложатся
  // поверх уже пропатченного им шейдера.
  const прежнийКомпилятор = расширяемый.onBeforeCompile;
  // Ключ кэша программ тоже чужой: у макро-слоя он 'macroLayer'. Если его
  // потерять, three отдаст такому материалу программу без макро-слоя, и он
  // снова пропадёт — уже без единой ошибки.
  //
  // ЧИТАЕТСЯ ЗНАЧЕНИЕМ И ДО ПОДМЕНЫ. По умолчанию `customProgramCacheKey` у
  // three — метод, который возвращает ТЕКСТ `onBeforeCompile`
  // (Material.customProgramCacheKey). После подмены он вернул бы текст нашего
  // же патча, и в ключ программы уехал бы весь обработчик: замерено —
  // `…,eos-gbuffer-ao|(shader, renderer) => {…}` длиной в килобайты.
  const чужойКлюч = typeof расширяемый.customProgramCacheKey === 'function'
    ? расширяемый.customProgramCacheKey.call(material)
    : '';

  расширяемый.onBeforeCompile = (shader, renderer) => {
    if (typeof прежнийКомпилятор === 'function') {
      прежнийКомпилятор.call(material, shader, renderer);
    }
    if (подходит(shader.fragmentShader)) {
      // Счётчик растёт в момент настоящей компиляции, а не при обходе сцены:
      // обход говорит «материал отдан», а здесь - «шейдер реально прошит».
      // Разница видна в отчёте и ловит материалы без нужных include'ов.
      прошитоПриКомпиляции++;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${ОБЪЯВЛЕНИЯ}\n${АО_ОБЪЯВЛЕНИЯ}`)
        .replace('#include <aomap_fragment>', ЗАПИСЬ_AO.trim())
        .replace('#include <opaque_fragment>', ЗАПИСЬ);
    } else {
      // Не прошит — но писать во все четыре выхода обязан всё равно, иначе
      // его draw отбросят и объекта просто не будет на экране. Объявления
      // уходят в начало шейдера (глобальная область), запись — в начало main.
      const главная = shader.fragmentShader.match(ГЛАВНАЯ);
      if (!главная) {
        // Фрагментный шейдер без main — бракованный, и such бывает только
        // при кривом своём шейдере. Молча пропускать нельзя: материал уйдёт
        // в невидимость, и это будет выглядеть как «объект потерялся».
        console.warn(
          'Eos G-buffer: fragment shader of ' + material.type
          + ' has no main() — the object will not be drawn. Shader: '
          + shader.fragmentShader.slice(0, 120),
        );
        return;
      }
      shader.fragmentShader = `${ОБЪЯВЛЕНИЯ}\n${shader.fragmentShader}`
        .replace(ГЛАВНАЯ, (совпадение) => `${совпадение}\n${ПУСТАЯ_ЗАПИСЬ}`);
    }
    shader.uniforms.uEosAoMap = { value: aoTexture };
    shader.uniforms.uEosAoInvRes = { value: aoInverseResolution };
    // Ссылки на uniform'ы: при смене размера окна инверс разрешения надо
    // обновить во всех материалах, а до uniform'ов готовой программы нельзя
    // добраться снаружи. Без этой ссылки окно после ресайза читало бы AO
    // не по тем координатам.
    ссылки.uEosAoMap = shader.uniforms.uEosAoMap as { value: unknown };
    ссылки.uEosAoInvRes = shader.uniforms.uEosAoInvRes as { value: unknown };
  };

  (material as THREE.Material & { userData: Record<string, unknown> }).userData.eosAoUniforms = ссылки;

  // Ключ обязан отличаться от пустого: иначе three переиспользует программу
  // от материала БЕЗ патча, и каналы G-buffer останутся не заполнены - молча,
  // без единой ошибки. Это ровно тот класс поломки, который мы уже ловили.
  //
  // Чужой ключ дописывается, а не затирается: иначе материал с макро-слоем
  // получил бы программу без него (см. про прежний обработчик выше).
  расширяемый.customProgramCacheKey = () => `${КЛЮЧ_ПРОГРАММЫ}|${чужойКлюч}`;

  УЖЕ_ПРОШИТЫ.add(material);
  material.needsUpdate = true;
  return true;
}

export interface PatchReport {
  /** Сколько уникальных материалов нашли. */
  всего: number;
  /** Сколько прошито. */
  прошито: number;
  /** Имена тех, что остались forward-only. */
  мимо: string[];
}

/**
 * Прошивает сцену: все материалы, которые есть в ней СЕЙЧАС.
 *
 * ВЫЗЫВАТЬ ПОСЛЕ ПОСТРОЙКИ МИРА. Проход создаётся в начале сборки, когда
 * сцена ещё пуста, и прошивка оттуда даёт отчёт «0 из 0»: каналы G-buffer
 * остаются пустыми у всего мира, а AO и экранные отражения считаются по нулям
 * молча. Проверено на живом мире: в сцене 1119 материалов, прошито 0.
 *
 * Материалы появляются и позже — модель игрока, монстры, лошади, караваны
 * грузятся отдельными файлами. Поэтому функцию можно звать повторно: уже
 * прошитые пропускаются по WeakSet, и повторный обход стоит копейки.
 */
export function patchScene(
  scene: THREE.Object3D,
  aoTexture: THREE.Texture,
  aoInverseResolution: THREE.Vector2,
): PatchReport {
  const отчёт: PatchReport = { всего: 0, прошито: 0, мимо: [] };
  const уникальные = new Set<THREE.Material>();

  scene.traverse((объект) => {
    const меш = объект as THREE.Mesh & { material?: THREE.Material | THREE.Material[] };
    if (!меш.material) return;
    const материалы = Array.isArray(меш.material) ? меш.material : [меш.material];
    for (const материал of материалы) {
      if (typeof материал === 'string') continue;
      уникальные.add(материал);
    }
  });

  for (const материал of уникальные) {
    отчёт.всего++;
    if (patchMaterial(материал, aoTexture, aoInverseResolution)) отчёт.прошито++;
    else отчёт.мимо.push(`${материал.type} «${материал.name || 'без имени'}»`);
  }
  return отчёт;
}