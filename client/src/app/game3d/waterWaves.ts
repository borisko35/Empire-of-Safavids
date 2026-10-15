/**
 * Волны на воде — В МЕТРАХ, а не в UV.
 *
 * ЧТО БЫЛО НЕ ТАК (15.10.2026). Шейдер брал волну от `uv`, то есть от
 * координаты 0..1 на КАЖДОЕ водное тело, а смещение складывал в мировые
 * метры. Длина волны «8» означала 8 единиц UV, а метров на единицу UV у тел
 * было разное:
 *
 *   тело      размер          UV            «8 метров» на самом деле
 *   озеро     Ø 340 м         0..1          2720 м - озеро целиком внутри
 *   пруд      Ø 140 м         0..1           1120 м
 *   река      Ø 17 м          0..1            136 м
 *   море      6350 × 6350 м   0..1         50 800 м
 *
 * То есть озеро целиком помещалось в одну восьмую часть одной волны: игрок
 * видел не волны, а медленно кренящуюся плиту. Море, к тому же, было
 * плоскостью 1×1 (четыре вершины) — вершинному смещению негде было звучаться
 * вовсе, гладь стояла идеально ровной.
 *
 * КАК ПРАВИЛЬНО. Параметризуемся мировыми координатами XZ. Тогда «длина волны
 * 9 м» значит 9 метров и на озере, и на море, а плотность сетки выбирается
 * отдельно и осознанно: вершины несут только длинную зыбь, мелкая рябь
 * приходит из фрагментного шейдера через карту нормалей.
 *
 * ОДНА ПРАВДА НА ДВА ЯЗЫКА. Таблица октав живёт здесь, а GLSL для шейдера
 * генерируется из неё же (см. WAVE_GLSL). Расхождение таблицы и шейдера
 * поэтому невозможно по построению, а не «держим в узде».
 */
import { SEA, WORLD_HALF, seaMask } from '../../../../shared/water';

/** Мир и его вода описаны в shared/water, а не здесь: вода про ширину мира
 *  знает (линия берега ищется по всей ширине), и terrain.ts берёт это число
 *  оттуда же. Перевыгружаем, чтобы не тянуть terrain.ts и не заводить круг. */
export { WORLD_HALF };

/** Одна октава волны. Все длины — в метрах. */
export interface WaveOctave {
  /** Полуразмах по вертикали, м. */
  readonly amplitude: number;
  /** Длина волны, м. */
  readonly wavelength: number;
  /** Направление движения в плоскости XZ (нормализуется при расчёте). */
  readonly dirX: number;
  readonly dirZ: number;
  /** Крутизна: горизонтальное смещение гребня. 0 — чистая синусоида. */
  readonly steepness: number;
  /** Множитель скорости: у разных октав она своя. */
  readonly speed: number;
  /**
   * Кто несёт эту октаву.
   *
   * `mesh` — вершинами. Сетка обязана давать на такую волну хотя бы три
   * вершины, иначе она не рисуется вовсе: море было плоскостью 1×1, то есть
   * четырьмя вершинами на 6.3 километра, и вершинного смещения не существовало.
   *
   * `detail` — только картой нормалей в фрагменте. Так держится мелочь: если
   * *каждую* октаву тащить в вершины, на мелкой воде нужна сетка с шагом меньше
   * метра, а на море — с шагом в десятки сантиметров. Ни то, ни другое не
   * считается. Мелочь в вершинах не нужна: глаз читает её по нормали, а не по
   * силуэту, поэтому дешёвая карта нормалей даёт больше, чем дорогая сетка.
   */
  readonly carriedBy: 'mesh' | 'detail';
}

/** Набор октав одного водного тела. */
export interface WaveField {
  readonly name: string;
  /** Общий множитель высоты: штиль это 0.2, шторм это 2. */
  readonly scale: number;
  readonly octaves: readonly WaveOctave[];
}

const нормализоватьНаправление = (x: number, z: number): [number, number] => {
  const d = Math.hypot(x, z) || 1;
  return [x / d, z / d];
};

/**
 * Скорость в глубокой воде: c = sqrt(g / k). Берётся ровно та же формула, что
 * и в GLSL ниже, иначе волны «плыли бы» не с той скоростью, какой их ждёт
 * шейдер.
 */
export function глубокаяСкорость(wavelength: number, gravity = 9.81): number {
  const k = (2 * Math.PI) / wavelength;
  return Math.sqrt(gravity / k);
}

/**
 * Суммарное смещение точки воды: x и z — горизонталь, y — высота.
 *
 * `carried` отбирает октавы: шейдер сетки считает только `mesh`, пробник по
 * умолчанию считает все — так он видит и вершинные волны, и ту мелочь, которая
 * приходит картой нормалей, и может сказать, где какая из них видна.
 */
export function waveOffset(
  field: WaveField,
  x: number,
  z: number,
  time: number,
  scale = 1,
  carried: WaveOctave['carriedBy'] | 'all' = 'all',
): { x: number; y: number; z: number } {
  let ox = 0;
  let oy = 0;
  let oz = 0;
  const s = field.scale * scale;

  for (const o of field.octaves) {
    if (carried !== 'all' && o.carriedBy !== carried) continue;
    const [dx, dz] = нормализоватьНаправление(o.dirX, o.dirZ);
    const k = (2 * Math.PI) / o.wavelength;
    const c = глубокаяСкорость(o.wavelength);
    const f = k * (dx * x + dz * z) - c * o.speed * time;
    const amp = o.amplitude * s;
    // Горизонтальное смещение не должно превышать саму амплитуду: иначе
    // гребни складываются в петли и поверхность переворачивается наизнанку.
    const horiz = Math.min(o.steepness / k, amp * 0.9);
    ox += dx * horiz * Math.sin(f);
    oz += dz * horiz * Math.sin(f);
    oy += amp * Math.cos(f);
  }
  return { x: ox, y: oy, z: oz };
}

export function waveHeight(
  field: WaveField,
  x: number,
  z: number,
  time: number,
  scale = 1,
  carried: WaveOctave['carriedBy'] | 'all' = 'all',
): number {
  return waveOffset(field, x, z, time, scale, carried).y;
}

/** Нормаль по разности высот в соседних точках. Шаг — в метрах. */
export function waveNormal(
  field: WaveField,
  x: number,
  z: number,
  time: number,
  step = 0.5,
  scale = 1,
  carried: WaveOctave['carriedBy'] | 'all' = 'all',
): [number, number, number] {
  const hL = waveHeight(field, x - step, z, time, scale, carried);
  const hR = waveHeight(field, x + step, z, time, scale, carried);
  const hD = waveHeight(field, x, z - step, time, scale, carried);
  const hU = waveHeight(field, x, z + step, time, scale, carried);
  // -dh/dx, 1, -dh/dz: ось Y в мире смотрит вверх.
  const nx = -(hR - hL) / (2 * step);
  const nz = -(hU - hD) / (2 * step);
  const len = Math.hypot(nx, 1, nz) || 1;
  return [nx / len, 1 / len, nz / len];
}

// ── Поля волн по водоёмам ─────────────────────────────────────────────
//
// Числа ОБМЕРЕНЫ, а не подобраны на глаз: главный признак «волны читаются как
// волны» — сколько гребней укладывается в 100 м и насколько крут склон.
// Доли, длины и крутизна подобраны так, чтобы озеро читалось как спокойная
// стоячая вода, а море — как открытое водное пространство. Пробник
// client/tools/check-water-waves.ts печатает эти числа.

/** Озеро: гладь, мелкая рябь от ветра. Крутая короткая волна здесь смешна. */
export const LAKE_WAVES: WaveField = {
  name: 'озеро',
  scale: 1,
  octaves: [
    { amplitude: 0.22, wavelength: 14.0, dirX: 0.8, dirZ: 0.6, steepness: 0.35, speed: 0.6, carriedBy: 'mesh' },
    { amplitude: 0.07, wavelength: 6.5, dirX: -0.3, dirZ: 0.95, steepness: 0.3, speed: 0.9, carriedBy: 'detail' },
    { amplitude: 0.028, wavelength: 2.8, dirX: 0.1, dirZ: 1.0, steepness: 0.25, speed: 1.4, carriedBy: 'detail' },
  ],
};

/**
 * Пруд: ещё спокойнее, ветра почти нет.
 *
 * Амплитуда поднята с 0.11 до 0.20 не на глаз: при длине 9 м склон гребня
 * равен амплитуде умноженной на 2*pi/9, и на 0.11 он выходил 3.0 градуса - то
 * есть стекло. Пробник меряет склон и требует не меньше 3 градусов, поэтому
 * первое значение он и отверг.
 */
export const POND_WAVES: WaveField = {
  name: 'пруд',
  scale: 0.7,
  octaves: [
    { amplitude: 0.20, wavelength: 9.0, dirX: 0.75, dirZ: 0.66, steepness: 0.3, speed: 0.6, carriedBy: 'mesh' },
    { amplitude: 0.045, wavelength: 4.0, dirX: -0.2, dirZ: 0.98, steepness: 0.25, speed: 0.9, carriedBy: 'detail' },
  ],
};

/**
 * Река: течение ломает гладь, но вода в ней стоячая - волны мелкие.
 * Амплитуда 0.16 при длине 5.5 м даёт склон 5.7 градуса (было 0.07 -> 2.4).
 */
export const RIVER_WAVES: WaveField = {
  name: 'река',
  scale: 0.55,
  octaves: [
    { amplitude: 0.16, wavelength: 5.5, dirX: 0.9, dirZ: 0.44, steepness: 0.3, speed: 0.7, carriedBy: 'mesh' },
    { amplitude: 0.03, wavelength: 2.4, dirX: -0.4, dirZ: 0.9, steepness: 0.25, speed: 1.1, carriedBy: 'detail' },
  ],
};

/**
 * Море: длинная зыбь плюс накат. В сетку идут только две октавы — при шаге
 * 5 м на третью (11.5 м) пришлось бы три вершины на волну впритык, а мелочь
 * всё равно читается по нормали.
 */
export const SEA_WAVES: WaveField = {
  name: 'море',
  scale: 1,
  octaves: [
    { amplitude: 0.62, wavelength: 58.0, dirX: 0.86, dirZ: 0.5, steepness: 0.5, speed: 0.5, carriedBy: 'mesh' },
    { amplitude: 0.28, wavelength: 27.0, dirX: -0.35, dirZ: 0.94, steepness: 0.42, speed: 0.75, carriedBy: 'mesh' },
    { amplitude: 0.11, wavelength: 11.5, dirX: 0.1, dirZ: 1.0, steepness: 0.32, speed: 1.1, carriedBy: 'detail' },
  ],
};

/**
 * Множитель высоты волн по погоде.
 *
 * Без этого вода была одинаковой в шторм и в ясный полдень, хотя окружение
 * давно научилось темнеть и краснеть по погоде (§207): игрок видел бурю, а
 * озеро стояло как зеркало. Здесь те же погоды, что и у неба, и порядок тот же.
 */
export const CHOP_BY_WEATHER: Record<string, number> = {
  clear: 0.85,
  cloudy: 0.9,
  fog: 0.55,
  wind: 1.55,
  rain: 1.35,
  sandstorm: 1.45,
  snow: 0.7,
  storm: 2.2,
};

export function chopFor(weather: string): number {
  return CHOP_BY_WEATHER[weather] ?? 1;
}

/**
 * Линия берега моря как функция x — то есть массив, где индексу i отвечает z,
 * на котором вода начинается при данном x.
 *
 * ЗАЧЕМ ЭТО НУЖНО. Берег гуляет: seaMask берёт шум по обеим координатам, и
 * граница воды смещается на ±SEA.jitter (60 м). Описать её прямой SEA.coast нельзя
 * — мелкая полоса уходила бы на 60 м вглубь суши или, наоборот, в море.
 *
 * Раньше глубина в шейдере вообще не считалась (`uWaterLevel - vWorldPos.y`, что
 * для покоящейся воды всегда ноль), и вся вода рисовалась мелкой бирюзой: и море
 * в 8.8 м глубины, и пруд. Теперь расстояние до берега нужно по-настоящему.
 *
 * ЧИСЛА. 1024 шага по x при ширине мира 6350 м дают 6.2 м на шаг - этого с
 * запасом хватает для полосы мелкой воды шириной SEA.ramp (60 м). По z идём с
 * суши на юг шагом 4 м, пока маска не станет водой.
 *
 * РАЗМАХ БЕРЕГА ИЗМЕРЕН, А НЕ ВЗЯТ ИЗ SEA.jitter. SEA.jitter = 60 м, но fbm на
 * таком масштабе гуляет слабо: пробник печатает размах линии (сейчас около 12 м
 * вокруг -721 м). Поэтому опираться на «+-60 м» было бы враньём, а таблица и
 * комментарий обязаны совпадать.
 *
 * ОСТРОВА НЕ УЧТЕНЫ. Профиль ищет первую воду сверху и про острова ничего не
 * знает: вокруг портового острова вода останется глубокой. Это заметно только
 * как отсутствие бирюзовой каймы у островов, и цена исправления - прогонять
 * маску по всей сетке при каждой сборке мира.
 */
export function seaShoreProfile(samples = 1024): Float32Array {
  const профиль = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = -WORLD_HALF + ((i + 0.5) / samples) * WORLD_HALF * 2;
    let найдено = SEA.coast - SEA.ramp;
    for (let z = SEA.coast + SEA.jitter; z > SEA.coast - SEA.ramp * 4; z -= 4) {
      if (seaMask(x, z) >= SEA.waterThreshold) {
        найдено = z;
        break;
      }
    }
    профиль[i] = найдено;
  }
  return профиль;
}

/**
 * Ось с растущим шагом: мелко у начала, крупно к краю.
 *
 * Море тянется на 6.7 километра. Равномерная сетка с шагом 5 м дала бы два с
 * половиной миллиона четырёхугольников - это 4.8 миллиона треугольников на одну
 * воду. Растущий шаг даёт ту же плотность там, где игрок видит воду вблизи, и
 * крупные треугольники там, где она уже в тумане.
 *
 * Отсюда и порог LOD в шейдере: сетка крупнеет от 5 м, и волну в треугольнике
 * шире 30 м рисовать уже нечем, поэтому вершинное смещение гаснет к uLodFar.
 */
export function gradedAxis(от: number, до: number, шаг: number, рост: number): number[] {
  // Без этой проверки NaN на конце оси даёт 4097 точек: сравнение `next >= NaN`
  // всегда ложно, цикл выходит только по предохранителю, и из него
  // получается сетка на 67 миллионов треугольников. Так и вышло, когда пробник
  // подсунул сюда WORLD_HALF, которого в модуле не оказалось.
  if (!Number.isFinite(от) || !Number.isFinite(до) || !Number.isFinite(шаг) || шаг <= 0) {
    throw new Error(
      `gradedAxis получила нечисло: от=${от} до=${до} шаг=${шаг} `
      + '- сетка воды молча раздулась бы до 4097 точек',
    );
  }
  const точки = [от];
  let cur = от;
  let s = шаг;
  const dir = Math.sign(до - от) || 1;
  while (точки.length < 4096) {
    const next = cur + dir * s;
    if ((dir > 0 && next >= до) || (dir < 0 && next <= до)) break;
    точки.push(next);
    cur = next;
    s *= рост;
  }
  точки.push(до);
  return точки;
}

/** Шаг сетки на расстоянии `d` от начала оси: то, во что она превращается вдали. */
export function stepAt(d: number, шаг: number, рост: number): number {
  if (рост === 1 || d <= 0) return шаг;
  return шаг * (1 + d * (рост - 1) / шаг);
}

/** Поля по имени тела — используется при сборке геометрии. */
export const WAVE_FIELDS = {
  lake: LAKE_WAVES,
  pond: POND_WAVES,
  river: RIVER_WAVES,
  sea: SEA_WAVES,
} as const;

export type WaterBody = keyof typeof WAVE_FIELDS;

/**
 * Сетка вершин одного тела.
 *
 * ЧТО БЫЛО. Озеро и пруд строились как CircleGeometry(1, 28) с последующим
 * растягиванием на радиус: двадцать восемь секторов веером на 340 метров, то
 * есть треугольник основанием 12 м и вершиной в центре. Море строилось как
 * PlaneGeometry(..., 1, 1) — четыре вершины на 6.3 километра. При такой сетке
 * вершинному смещению негде звучаться: у моря его не было вовсе, и гладь стояла
 * идеально ровной.
 *
 * Теперь сетка строится в метрах, и её шаг задан явно. Шаг выбран так, чтобы на
 * КАЖДУЮ вершинную октаву приходилось не меньше трёх вершин — иначе волна не
 * рисуется, а превращается в случайный треугольник. Проверяет это пробник
 * check-water-waves.ts, который читает шаг отсюда.
 */
export interface WaterGrid {
  /** Ключ поля: определяет и набор октав, и функцию GLSL. */
  readonly body: WaterBody;
  /** Радиус тела, м (у моря — половина ширины сетки по X). */
  readonly radius: number;
  /** Шаг сетки у центра, м. */
  readonly step: number;
  /** Секторов по кругу для круглых тел. */
  readonly sectors: number;
  /** Во сколько раз шаг растёт на каждом шаге наружу (сетка моря). */
  readonly growth: number;
}

export const WATER_GRIDS: Record<WaterBody, WaterGrid> = {
  lake: { body: 'lake', radius: 170, step: 3.0, sectors: 72, growth: 1 },
  pond: { body: 'pond', radius: 70, step: 2.0, sectors: 64, growth: 1 },
  river: { body: 'river', radius: 8.5, step: 1.5, sectors: 40, growth: 1 },
  // Радиус = половина ширины сетки по X. Берётся из ширины мира плюс запас:
  // сетка едет за камерой, и без запаса на краю мира она не дотянулась бы до
  // противоположного берега.
  sea: { body: 'sea', radius: WORLD_HALF + 200, step: 5.0, sectors: 1, growth: 1.06 },
};

/**
 * Число вершин на длину волны при заданном шаге сетки.
 * Меньше трёх — сетка слишком крупная, и вершинная октава не рисуется.
 */
export function вершинНаВолну(wavelength: number, step: number): number {
  return wavelength / step;
}

/** Самая короткая вершинная октава поля: та, что задаёт нижнюю границу сетки. */
export function корочеВсехВершиннаяОктава(field: WaveField): WaveOctave | null {
  let лучшая: WaveOctave | null = null;
  for (const o of field.octaves) {
    if (o.carriedBy !== 'mesh') continue;
    if (!лучшая || o.wavelength < лучшая.wavelength) лучшая = o;
  }
  return лучшая;
}

// ── GLSL из той же таблицы ───────────────────────────────────────────
//
// Функция НЕ вызывается в браузере: она превращает таблицу октав в текст
// шейдера. Благодаря этому шейдер и пробник считают одно и то же, а разъехаться
// они не могут: если поправить октаву, поправится и то и другое.
//
// ИМЕНА ФУНКЦИЙ ЛАТИНИЦЕЙ. Идентификаторы GLSL ES — только [A-Za-z0-9_],
// поэтому ключ поля (lake, pond, river, sea) и название в комментарии (озеро,
// пруд, река, море) разведены: ключ идёт в имя функции, название — в текст для
// человека. Русское имя в идентификаторе компилятор не принял бы.

const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

/** Имя функции GLSL для поля: латиница из ключа, без пробелов и кириллицы. */
export function glslFieldFunction(fieldKey: WaterBody): string {
  return `gerstner_${fieldKey}`;
}

/**
 * Текст одной октавы в GLSL. В сетку идут только `mesh`: мелочь из `detail`
 * приходит картой нормалей в фрагменте, и тащить её в вершины значило бы
 * требовать шаг сетки меньше метра.
 */
export function glslOctaveField(field: WaveField): string {
  const строки: string[] = [`  // поле «${field.name}», множитель ${f(field.scale)}`];
  for (const o of field.octaves) {
    if (o.carriedBy !== 'mesh') continue;
    // Амплитуда печатается с четыремя знаками: произведение 0.20 * 0.7 в
    // машинной арифметике даёт 0.13999999999999999, и такой текст попадает в
    // шейдер. Он компилируется, но в отладке выглядит как ошибка, и её потом
    // ищут полчаса.
    const amp = Number((o.amplitude * field.scale).toFixed(4));
    строки.push(
      `  gerstner(acc, p, t, ${f(amp)} * scale, ${f(o.wavelength)}, `
      + `vec2(${f(o.dirX)}, ${f(o.dirZ)}), ${f(o.steepness)}, ${f(o.speed)});`,
    );
  }
  return строки.join('\n');
}

/** Полный GLSL: общий аккумулятор и по функции на каждое поле. */
export const WAVE_GLSL = `
  // Сгенерировано из waterWaves.ts. Правь таблицу октав, а не этот текст.
  void gerstner(inout vec3 acc, vec2 p, float t, float amp, float lambda,
                vec2 dir, float steep, float speed) {
    vec2 d = normalize(dir);
    float k = 6.28318 / lambda;
    float c = sqrt(9.81 / k);
    float f = k * dot(d, p) - c * speed * t;
    float horiz = min(steep / k, amp * 0.9);
    acc.x += d.x * horiz * sin(f);
    acc.z += d.y * horiz * sin(f);
    acc.y += amp * cos(f);
  }
${Object.entries(WAVE_FIELDS).map(([ключ, поле]) => `\n  void ${glslFieldFunction(ключ as WaterBody)}(inout vec3 acc, vec2 p, float t, float scale) {\n    acc = vec3(0.0);\n${glslOctaveField(поле)}\n  }\n`).join('')}`;