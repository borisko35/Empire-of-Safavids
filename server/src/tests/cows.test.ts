// Коровы на выпасе в лесной деревне.
//
// Первый пакет из Assets, где масштаб НЕ пришлось применять: у модели
// scale = 1.0, она пришла в метрах. Три предыдущих к каждому приходили с
// 0.01 и 0.35, и проверка на метры обязана быть здесь по той же причине —
// иначе первый же пакет без масштаба её отключит.
//
// ЧТО ЛОВИТСЯ И ПОЧЕМУ ТАК.
// 1. Модель в метрах по оси Y.
// 2. Анимация В МОДЕЛИ. Игровые клипы лежат в mixamorig:*, кости коровы —
//    DEF-*, клип человека к ней не подойдёт, и своего для скота нет. Без
//    анимации корова стоит столбом, и это видно только в игре.
// 3. Анимация не прорежена. По умолчанию экспортёр оставляет по два ключа на
//    дорожку, и корова перетекает из одной позы в другую.
// 4. Скелет клонируется через SkeletonUtils: обычный клон делит Skeleton с
//    оригиналом, и обе коровы шевелились бы от одной кости.
// 5. Смеситель свой у каждой коровы и кто-то его двигает.
// 6. Синхронный жевательный жест: без разных фаз обе коровы жуют в один такт,
//    и это видно сразу.
// 7. Места: сухо под коровой, не в доме, не в поле, не в стоге.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isWater } from '../../../shared/water';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const ТЕРРЕЙН = читать('client/src/app/game3d/terrain.ts');
const МИР = читать('client/src/app/game3d/world3d.ts');
const МАНИФЕСТ = JSON.parse(читать('client/src/app/public/models/manifest.json')) as {
  decor?: { file: string; name: string; bytes: number }[];
};

interface GlbJson {
  nodes?: { name: string; children?: number[]; translation?: number[]; rotation?: number[] }[];
  meshes?: { primitives?: { attributes: { POSITION: number }; indices?: number }[] }[];
  skins?: { joints: number[] }[];
  animations?: {
    name?: string;
    channels?: { target: { node: number } }[];
    samplers?: { input: number }[];
  }[];
  accessors?: { min: number[]; max: number[]; count: number }[];
  materials?: {
    name?: string;
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      baseColorTexture?: unknown;
      metallicRoughnessTexture?: unknown;
    };
    normalTexture?: unknown;
  }[];
  textures?: unknown[];
}

function jsonGlb(путь: string): GlbJson {
  const буфер = readFileSync(путь);
  must(буфер.readUInt32LE(0) === 0x46546c67, `${путь}: это не GLB`);
  const длина = буфер.readUInt32LE(12);
  return JSON.parse(буфер.subarray(20, 20 + длина).toString('utf-8')) as GlbJson;
}

const ФАЙЛ = join(корень, 'client/src/app/public/models/decor/cow.glb');

interface Корова {
  x: number;
  z: number;
  ry: number;
}

/**
 * Коровы читаются из кода.
 *
 * Смещения парсятся со знаком: `VILLAGE.x - 9` и `VILLAGE.x + 9` — разные
 * точки. Прежняя регулярка требовала минус, и запись со знаком плюс просто
 * выпадала из разбора: корова в коде есть, а проверка видела её как
 * отсутствующую — и ругалась «коров меньше двух» вместо «корова стоит на
 * месте поленницы». Правка была бы видна не там, где она сделана.
 */
function коровы(): Корова[] {
  const начало = ТЕРРЕЙН.indexOf('export const VILLAGE_COWS');
  must(начало > 0, 'в terrain.ts нет VILLAGE_COWS — коровы не описаны');
  const блок = ТЕРРЕЙН.slice(начало, ТЕРРЕЙН.indexOf('export function buildCows'));
  const выбор = [
    ...блок.matchAll(
      /\{ x: VILLAGE\.x ([+-]) (\d+), z: VILLAGE\.z ([+-]) (\d+), ry: (-?[\d.]+) \}/g,
    ),
  ].map((м) => ({
    x: м[1] === '-' ? -Number(м[2]) : Number(м[2]),
    z: м[3] === '-' ? -Number(м[4]) : Number(м[4]),
    ry: Number(м[5]),
  }));
  must(выбор.length > 0, 'VILLAGE_COWS пуст, и записи не разобрались');
  const деревня = /export const VILLAGE = \{ x: (-?\d+), z: (-?\d+)/.exec(ТЕРРЕЙН);
  must(деревня !== null, 'VILLAGE не найден');
  return выбор.map((т) => ({
    x: Number(деревня[1]) + т.x,
    z: Number(деревня[2]) + т.z,
    ry: т.ry,
  }));
}

describe('Корова: модель', () => {
  it('файл в сборке и совпадает с манифестом', () => {
    const запись = МАНИФЕСТ.decor?.find((д) => д.name === 'cow');
    must(запись !== undefined, 'в манифесте нет коровы: файл никто не сверяет с диском');
    must(запись!.file === 'models/decor/cow.glb', 'путь к корове в манифесте не тот');
    must(existsSync(ФАЙЛ), 'файла коровы нет на диске');
    must(
      statSync(ФАЙЛ).size === запись!.bytes,
      `корова: на диске ${statSync(ФАЙЛ).size}, в манифесте ${запись!.bytes}`,
    );
  });

  it('модель в метрах, а не в дюймах исходника', () => {
    const gltf = jsonGlb(ФАЙЛ);
    const меш = (gltf.meshes ?? [])[0];
    must(меш !== undefined, 'в модели коровы нет меша');
    const размах = [0, 0, 0];
    for (const примитив of меш!.primitives ?? []) {
      const accessor = (gltf.accessors ?? [])[примитив.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        размах[i] = Math.max(размах[i], accessor.max[i] - accessor.min[i]);
      }
    }
    // Y — высота, glTF и three.js смотрят вверх на Y.
    must(
      размах[1] > 0.6 && размах[1] < 1.9,
      `рост коровы ${размах[1].toFixed(2)} м по оси Y: ждали 0.6-1.9. ` +
        'Возможные причины: масштаб объекта не применён либо высота меряется не по той оси',
    );
    must(
      размах[2] > 1.5 && размах[2] < 2.8,
      `длина коровы ${размах[2].toFixed(2)} м: корова должна быть длиннее, чем высока`,
    );
  });

  it('стоит на земле: низ на нуле', () => {
    const gltf = jsonGlb(ФАЙЛ);
    const примитив = (gltf.meshes ?? [])[0].primitives![0];
    const низ = (gltf.accessors ?? [])[примитив.attributes.POSITION].min[1];
    must(
      Math.abs(низ) < 0.05,
      `низ коровы на ${низ.toFixed(3)} по Y: она уедет под землю или повиснет над лугом`,
    );
  });

  it('анимация вшита в модель, а не берётся клипом игры', () => {
    // Игровые клипы лежат в mixamorig:*, кости коровы — DEF-*. Клип человека к
    // ней не привяжется, а своего клипа для скота в игре нет: без анимации в
    // модели корова стоит столбом, и это видно только в игре.
    const gltf = jsonGlb(ФАЙЛ);
    must((gltf.animations ?? []).length > 0, 'в корове нет анимации: она стоит столбом');
  });

  it('анимация не прорежена до двух ключей на дорожку', () => {
    // НАЙДЕННАЯ ОШИБКА. По умолчанию экспортёр glTF оптимизирует анимацию и
    // оставляет по два ключа на дорожку: из 16 429 ключей подвижных кривых
    // оставалось 312. Корова медленно перетекает из одной позы в другую —
    // выглядит живой, стоит как деревянная.
    const gltf = jsonGlb(ФАЙЛ);
    for (const анимация of gltf.animations ?? []) {
      const сэмплеры = анимация.samplers ?? [];
      must(сэмплеры.length > 0, `клип «${анимация.name}» без сэмплеров`);
      let ключей = 0;
      for (const сэмплер of сэмплеры) {
        ключей += (gltf.accessors ?? [])[сэмплер.input]?.count ?? 0;
      }
      const вСреднем = ключей / сэмплеры.length;
      must(
        вСреднем >= 3,
        `в клипе «${анимация.name}» в среднем ${вСреднем.toFixed(1)} ключа на дорожку: ` +
          'анимацию проредили до линейной растяжки между двумя позами',
      );
    }
  });

  it('клип длинный и правдоподобный', () => {
    // Время в glTF записано в секундах. Прежняя проверка делила его на частоту
    // сцены и получала 0.28 с вместо честных 8.33 — то есть врала сама.
    const gltf = jsonGlb(ФАЙЛ);
    for (const анимация of gltf.animations ?? []) {
      let максимум = 0;
      for (const сэмплер of анимация.samplers ?? []) {
        const accessor = (gltf.accessors ?? [])[сэмплер.input];
        if (accessor?.max) максимум = Math.max(максимум, accessor.max[0]);
      }
      must(
        максимум > 1 && максимум < 20,
        `длительность клипа ${максимум.toFixed(2)} с: либо пусто, либо растянули на полминуты`,
      );
    }
  });

  it('скелет есть и он достаточно длинный', () => {
    const gltf = jsonGlb(ФАЙЛ);
    const скины = gltf.skins ?? [];
    must(скины.length === 1, `скинов ${скины.length}, ждали один`);
    must(
      скины[0].joints.length >= 40,
      `костей ${скины[0].joints.length}: на корове нужен риг, иначе она не шевелится`,
    );
  });

  it('шерсть покрашена картами: цвет, нормали, шероховатость', () => {
    // В пакете три карты по буквам: B — цвет, N — нормали, R — шероховатость.
    const gltf = jsonGlb(ФАЙЛ);
    must((gltf.materials ?? []).length > 0, 'у коровы нет материала');
    for (const материал of gltf.materials ?? []) {
      must(
        материал.pbrMetallicRoughness?.baseColorTexture !== undefined,
        `${материал.name}: нет карты цвета — корова будет серым блоком`,
      );
      must(материал.normalTexture !== undefined, `${материал.name}: нет карты нормалей`);
      must(
        материал.pbrMetallicRoughness?.metallicRoughnessTexture !== undefined,
        `${материал.name}: нет карты шероховатости`,
      );
    }
    must((gltf.textures ?? []).length >= 3, 'карт меньше трёх: шерсть не читается');
  });
});

describe('Коровы: стоят и шевелятся', () => {
  it('мир строит коров и двигает их', () => {
    must(/buildCows\(this\.scene\)/.test(МИР), 'мир не строит коров');
    must(/import[\s\S]{0,400}buildCows/.test(МИР), 'buildCows не импортирован');
    must(/updateCows\(this\.cowMixers, dt\)/.test(МИР), 'мир не двигает коров');
    must(/export function updateCows/.test(ТЕРРЕЙН), 'в terrain.ts нет updateCows');
    must(
      /private cowMixers: THREE\.AnimationMixer\[\]/.test(МИР),
      'у мира нет списка смесителей: кто-то должен их хранить',
    );
  });

  it('скелет клонируется правильно', () => {
    must(
      /SkeletonUtils\.js/.test(ТЕРРЕЙН),
      'нет импорта SkeletonUtils: клоны делят скелет и обе коровы замирают',
    );
    must(
      /копияСкелета\(модель\)/.test(ТЕРРЕЙН),
      'корова клонируется не через SkeletonUtils',
    );
  });

  it('у каждой коровы свой смеситель и своя фаза', () => {
    // Один смеситель на группу двигал бы обе от первой дорожки, а одинаковая
    // фаза заставила бы коров жевать синхронно — это видно сразу.
    must(
      /new THREE\.AnimationMixer\(корова\)/.test(ТЕРРЕЙН),
      'смеситель не на корову: обе будут двигаться от одного',
    );
    must(
      /действие\.time = номер \* [\d.]+/.test(ТЕРРЕЙН),
      'фаза у коров одна: они жуют синхронно и это видно',
    );
    must(
      /this\.cowMixers = buildCows\(this\.scene\)/.test(МИР),
      'мир не сохраняет смесители: updateCows нечего двигать',
    );
  });

  it('updateCows переживает нечисловой кадр', () => {
    // Нечисловой кадр ломает смеситель: он начинает считать время в NaN и
    // возвращается к работе только после перезагрузки страницы.
    const блок = ТЕРРЕЙН.slice(
      ТЕРРЕЙН.indexOf('export function updateCows'),
      ТЕРРЕЙН.indexOf('export const REGION_TOWNS'),
    );
    must(/Number\.isFinite\(dt\)/.test(блок), 'updateCows не проверяет кадр на число');
    must(/\? dt : 1 \/ 60/.test(блок), 'updateCows не подставляет запасной шаг');
  });

  it('коров не меньше двух, и они не стоят друг в друге', () => {
    const список = коровы();
    must(
      список.length >= 2,
      `коров ${список.length}: одна корова на лугу — это не стадо, а одинокая корова`,
    );
    for (let i = 0; i < список.length; i++) {
      for (let j = i + 1; j < список.length; j++) {
        const расстояние = Math.hypot(список[i].x - список[j].x, список[i].z - список[j].z);
        must(
          расстояние >= 4,
          `коровы в (${список[i].x}, ${список[i].z}) и (${список[j].x}, ${список[j].z}) ` +
            `в ${расстояние.toFixed(1)} м друг от друга: они слиплись в одну зверю`,
        );
      }
    }
  });

  it('коровы стоят на суше, не в доме, не в поле и не в стоге', () => {
    // Занятое в деревне перечислено из кода: четыре дома на радиусе 10,
    // поленница (-6, 8), стог сена (8, 7), три поля на юго-западе.
    const деревня = { x: -495, z: -415 };
    const занято = [
      { имя: 'дом', x: 10, z: 0, r: 3.5 },
      { имя: 'дом', x: 0, z: 10, r: 3.5 },
      { имя: 'дом', x: -10, z: 0, r: 3.5 },
      { имя: 'дом', x: 0, z: -10, r: 3.5 },
      { имя: 'поленница', x: -6, z: 8, r: 1.6 },
      { имя: 'стог сена', x: 8, z: 7, r: 1.9 },
      { имя: 'поле', x: -14, z: 10, r: 4.5 },
      { имя: 'поле', x: -14, z: 17, r: 4.5 },
      { имя: 'поле', x: -6, z: 14, r: 4.5 },
    ];
    for (const т of коровы()) {
      must(!isWater(т.x, т.z), `корова в (${т.x}, ${т.z}) стоит в воде`);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          must(!isWater(т.x + dx, т.z + dz), `под коровой вода в (${т.x + dx}, ${т.z + dz})`);
        }
      }
      for (const з of занято) {
        const d = Math.hypot(т.x - (деревня.x + з.x), т.z - (деревня.z + з.z));
        must(
          d > з.r + 1.6,
          `корова в (${т.x}, ${т.z}) стоит на месте: ${з.имя} в (${з.x}, ${з.z}) — ` +
            `расстояние ${d.toFixed(1)} м, корова длиной 2 м`,
        );
      }
      const доДеревни = Math.hypot(т.x - деревня.x, т.z - деревня.z);
      must(
        доДеревни < 22,
        `корова в ${доДеревни.toFixed(0)} м от деревни: это не выпас, а луг`,
      );
      must(Number.isFinite(т.ry), `поворот коровы в (${т.x}, ${т.z}) не число`);
    }
  });

  it('коллайдер коровы по длине коровы, а не точкой', () => {
    // Корова 1.996 м длиной. Коллайдер точкой означал бы, что игрок проходит
    // между ног и упирается в корову носом, не дойдя до неё.
    const блок = ТЕРРЕЙН.slice(
      ТЕРРЕЙН.indexOf('export function buildCows'),
      ТЕРРЕЙН.indexOf('export function updateCows'),
    );
    must(/addCollider\(точка\.x, точка\.z, 1\.1\)/.test(блок), 'у коровы нет коллайдера');
  });
});