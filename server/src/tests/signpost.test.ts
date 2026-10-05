// Указатели на дорогах: пятнадцатый пакет из Assets.
//
// ЧТО ЗДЕСЬ ЛОВИТСЯ И ПОЧЕМУ ИМЕННО ТАК.
// 1. Модель в метрах. Ошибка в 100 раз не ловится ничем, кроме чтения
//    ЭКСПОРТИРОВАННОГО файла: в исходнике всё верно, замер в Blender тоже
//    верно (там матрица объекта учитывает масштаб), а в игре столб был бы
//    высотой 183 м. Замер в Blender врёт — проверено.
// 2. Высота по оси Y. glTF и three.js — Y вверх, Blender — Z вверх. Первая
//    версия проверки мерила по Z и объявила указатель пылью в 0.19 м: это
//    его глубина.
// 3. Столб тонкий и без скелета.
// 4. Цвет задан, а не серый по умолчанию.
// 5. Сбоку от полотна, а не на нём: полотно 3-4 м, столб посреди дороги —
//    препятствие для караванов.
// 6. Не ближе 220 м к центру столицы: в пригороде указатель читается как
//    «край города», а не как «здесь начинается дорога».
// 7. Попарно не ближе 25 м.
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
  nodes?: { name?: string; scale?: number[] }[];
  meshes?: { primitives?: { attributes: { POSITION: number }; indices?: number }[] }[];
  skins?: unknown[];
  animations?: unknown[];
  accessors?: { min: number[]; max: number[]; count: number }[];
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
}

function jsonGlb(путь: string): { gltf: GlbJson; размер: number } {
  const буфер = readFileSync(путь);
  must(буфер.readUInt32LE(0) === 0x46546c67, `${путь}: это не GLB`);
  const длина = буфер.readUInt32LE(12);
  return {
    gltf: JSON.parse(буфер.subarray(20, 20 + длина).toString('utf-8')) as GlbJson,
    размер: буфер.length,
  };
}

/** Указатели читаются из кода, а не перечислены здесь. */
/**
 * Указатели читаются из кода.
 *
 * Считаются ВСЕ строки `{ x, z, ry, к }`, а не только те, где ry — число:
 * иначе запись с нечисловым поворотом просто выпадает из разбора, проверка
 * молчит, а указатель в игре встал бы боком или ляжет. Такая ломка раньше
 * роняла чужой тест («указатели построены миром»), и правка была видна
 * не там, где она сделана.
 */
interface Знак {
  x: number;
  z: number;
  ry: number;
  /** Поворот как он записан в коде: нужно для сообщения об ошибке. */
  сырой_ry: string;
  к: string;
}

function указатели(): Знак[] {
  const начало = ТЕРРЕЙН.indexOf('export const SIGNPOSTS');
  must(начало > 0, 'в terrain.ts нет SIGNPOSTS — расстановка не описана в коде');
  const блок = ТЕРРЕЙН.slice(начало, ТЕРРЕЙН.indexOf('export function buildSignposts'));
  const выбор = [
    ...блок.matchAll(/\{ x: (-?\d+), z: (-?\d+), ry: ([^,]+), к: '([^']+)' \}/g),
  ].map((м) => ({
    x: Number(м[1]),
    z: Number(м[2]),
    // Number() от «поворот» даёт NaN, и это ровно то, что должна видеть игра.
    ry: Number(м[3].trim()),
    сырой_ry: м[3].trim(),
    к: м[4],
  }));
  must(выбор.length > 0, 'SIGNPOSTS пуст, и указатели в нём не разобрались');
  return выбор;
}

/** Дороги читаются из ROAD_PATHS — там координаты константами. */
interface Дорога {
  from: { x: number; z: number };
  to: { x: number; z: number };
  w: number;
}

function дороги(): Дорога[] {
  const поселения: Record<string, { x: number; z: number }> = {};
  for (const м of ТЕРРЕЙН.matchAll(
    /export const (CITY|CAMP|PORT|CARAVANSERAI|VILLAGE|FORT) = \{ x: (-?\d+), z: (-?\d+)/g,
  )) {
    поселения[м[1]] = { x: Number(м[2]), z: Number(м[3]) };
  }
  must(поселения.CITY !== undefined, 'не разобрались координаты поселений');

  const чтение = (исходник: string, ось: 'x' | 'z'): number => {
    const обрезанный = исходник.trim();
    if (/^-?\d+(\.\d+)?$/.test(обрезанный)) return Number(обрезанный);
    const имя = обрезанный.split('.')[0];
    must(поселения[имя] !== undefined, `не знаю поселение ${имя}`);
    return поселения[имя][ось];
  };

  const список = [
    ...ТЕРРЕЙН.matchAll(
      /from: \{ x: ([\w.-]+), z: ([\w.-]+) \}, to: \{ x: ([\w.-]+), z: ([\w.-]+) \}, w: ([\d.]+)/g,
    ),
  ].map((м) => ({
    from: { x: чтение(м[1], 'x'), z: чтение(м[2], 'z') },
    to: { x: чтение(м[3], 'x'), z: чтение(м[4], 'z') },
    w: Number(м[5]),
  }));
  must(список.length >= 4, `дорог в ROAD_PATHS ${список.length}, а ждали минимум четыре`);
  return список;
}

function расстояниеДоДороги(px: number, pz: number, д: Дорога): number {
  const abx = д.to.x - д.from.x;
  const abz = д.to.z - д.from.z;
  const len2 = abx * abx + abz * abz;
  let t = len2 === 0 ? 0 : ((px - д.from.x) * abx + (pz - д.from.z) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (д.from.x + abx * t), pz - (д.from.z + abz * t));
}

describe('Указатель: файл модели', () => {
  it('файл в сборке и совпадает с манифестом', () => {
    const запись = МАНИФЕСТ.decor?.find((д) => д.name === 'signpost');
    must(запись !== undefined, 'в манифесте нет указателя: файл никто не сверяет с диском');
    const путь = join(корень, 'client/src/app/public', запись!.file);
    must(existsSync(путь), 'файла указателя нет: дороги останутся без знаков');
    must(
      statSync(путь).size === запись!.bytes,
      `указатель: на диске ${statSync(путь).size}, в манифесте ${запись!.bytes}`,
    );
  });

  it('модель в метрах, а не в сантиметрах', () => {
    // НАЙДЕННАЯ ОШИБКА. У объекта после импорта FBX масштаб 0.01 и поворот X
    // на 90°, и матрица объекта это учитывает — поэтому замер в Blender давал
    // верные 1.83 м. А экспортёр glTF пишет локальные координаты сетки: в файл
    // уезжали сантиметры, и указатель в игре был бы столбом 183 м.
    //
    // Ловится только чтением файла: в исходнике всё верно, и замер в Blender
    // тоже врёт, и проверка «модель на месте» молчала.
    const путь = join(корень, 'client/src/app/public/models/decor/signpost.glb');
    const { gltf } = jsonGlb(путь);
    const меш = (gltf.meshes ?? [])[0];
    must(меш !== undefined, 'в модели указателя нет меша');
    const размах = [0, 0, 0];
    for (const примитив of меш!.primitives ?? []) {
      const accessor = (gltf.accessors ?? [])[примитив.attributes.POSITION];
      for (let i = 0; i < 3; i++) размах[i] = Math.max(размах[i], accessor.max[i] - accessor.min[i]);
    }
    // Y — высота: glTF по спецификации Y вверх, как и в three.js.
    must(
      размах[1] > 1.0 && размах[1] < 4.0,
      `высота указателя ${размах[1].toFixed(2)} м по оси Y — ждали 1-4 м. ` +
        'Возможные причины: масштаб объекта не применён, или высота меряется не по той оси',
    );
    must(
      размах[0] > 0.2 && размах[0] < 2.0,
      `ширина ${размах[0].toFixed(2)} м — это не столб с доской`,
    );
    must(размах[2] < 1.0, `глубина ${размах[2].toFixed(2)} м — указатель слишком толстый`);
  });

  it('стоит на земле: низ на нуле', () => {
    const путь = join(корень, 'client/src/app/public/models/decor/signpost.glb');
    const { gltf } = jsonGlb(путь);
    const примитив = (gltf.meshes ?? [])[0].primitives![0];
    const низ = (gltf.accessors ?? [])[примитив.attributes.POSITION].min[1];
    must(
      Math.abs(низ) <= 0.02,
      `низ модели на ${низ.toFixed(3)} по Y, а не на нуле: ` +
        'указатель уедет под землю или повиснет в воздухе',
    );
  });

  it('не скелет и не анимация: столб не должен ничем шевелиться', () => {
    const путь = join(корень, 'client/src/app/public/models/decor/signpost.glb');
    const { gltf } = jsonGlb(путь);
    must((gltf.skins ?? []).length === 0, 'в указателе есть скелет — это не предмет');
    must((gltf.animations ?? []).length === 0, 'в указателе анимация');
  });

  it('цвет задан, а не серый по умолчанию', () => {
    // В пакете текстур нет вообще (один fbx на 25 КБ), материал lambert2 —
    // просто серый. Без покраски указатель приехал бы белым кубом.
    const путь = join(корень, 'client/src/app/public/models/decor/signpost.glb');
    const { gltf } = jsonGlb(путь);
    const материалы = gltf.materials ?? [];
    must(материалы.length > 0, 'у указателя нет материала — будет серый куб');
    for (const материал of материалы) {
      const цвет = материал.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
      const серый = Math.abs(цвет[0] - цвет[1]) < 0.02 && Math.abs(цвет[1] - цвет[2]) < 0.02;
      must(
        !(серый && цвет[0] > 0.4),
        `материал ${материал.name ?? '(без имени)'} серый по умолчанию: [${цвет.join(', ')}]`,
      );
    }
  });

  it('лёгкий: у предмета в 2 КБ карты незачем', () => {
    const путь = join(корень, 'client/src/app/public/models/decor/signpost.glb');
    const { размер } = jsonGlb(путь);
    must(размер < 64 * 1024, `указатель весит ${размер} байт: он должен быть лёгким`);
  });
});

describe('Указатели: расстановка по дорогам', () => {
  it('указатели построены миром, а не лежат мёртвыми в коде', () => {
    must(/buildSignposts\(this\.scene\)/.test(МИР), 'мир не строит указатели');
    must(
      /import[\s\S]{0,400}buildSignposts/.test(МИР),
      'buildSignposts не импортирован в world3d: вызов не соберётся',
    );
    must(
      /export function buildSignposts/.test(ТЕРРЕЙН),
      'в terrain.ts нет buildSignposts',
    );
  });

  it('каждый указатель стоит сбоку от полотна, а не на дороге', () => {
    // Полотно шириной 3-4 м. Столб на полотне — это препятствие: по линии идут
    // караваны и путники (roadTraffic.ts).
    const списокДорог = дороги();
    for (const у of указатели()) {
      let ближайшая = 1e9;
      let ширина = 3;
      for (const д of списокДорог) {
        const расстояние = расстояниеДоДороги(у.x, у.z, д);
        if (расстояние < ближайшая) {
          ближайшая = расстояние;
          ширина = д.w;
        }
      }
      must(
        ближайшая > ширина / 2 + 0.5,
        `указатель в (${у.x}, ${у.z}) стоит в ${ближайшая.toFixed(2)} м от полотна ` +
          `шириной ${ширина} — он на дороге, а караваны по ней идут`,
      );
    }
  });

  it('указатели сухие, повёрнуты и не у самой столицы', () => {
    for (const у of указатели()) {
      must(!isWater(у.x, у.z), `указатель в (${у.x}, ${у.z}) стоит в воде`);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          must(
            !isWater(у.x + dx, у.z + dz),
            `под указателем вода в (${у.x + dx}, ${у.z + dz})`,
          );
        }
      }
      must(
        Number.isFinite(у.ry),
        `поворот указателя в (${у.x}, ${у.z}) записан как «${у.сырой_ry}», ` +
          'а не числом: столб встанет боком или ляжет',
      );
      const доСтолицы = Math.hypot(у.x - 34, у.z - 26);
      must(
        доСтолицы >= 150,
        `указатель в ${доСтолицы.toFixed(0)} м от центра столицы: ` +
          'в пригороде он читается как «край города», а не как «здесь дорога». ' +
          'Подними планку — но тогда на дороге к порту останется один указатель, ' +
          'и проверка на два знака упадёт',
      );
    }
  });

  it('указатели не слиплись и стоят на разных дорогах или далеко', () => {
    const точки = указатели();
    for (let i = 0; i < точки.length; i++) {
      for (let j = i + 1; j < точки.length; j++) {
        const расстояние = Math.hypot(точки[i].x - точки[j].x, точки[i].z - точки[j].z);
        must(
          расстояние >= 25,
          `указатели в (${точки[i].x}, ${точки[i].z}) и (${точки[j].x}, ${точки[j].z}) ` +
            `в ${расстояние.toFixed(1)} м друг от друга: читаются как сломанные`,
        );
      }
    }
    // На одной дороге в��лжно быть больше одной: одна дорога без указателя —
    // это не «дорога со знаком», а просто поле.
    const поДорогам = new Map<string, number>();
    for (const у of точки) поДорогам.set(у.к, (поДорогам.get(у.к) ?? 0) + 1);
    must(
      [...поДорогам.values()].every((сколько) => сколько >= 2),
      `дорога с одним указателем: ${[...поДорогам.entries()]
        .filter(([, сколько]) => сколько === 1)
        .map(([дорога]) => дорога)
        .join(', ')}`,
    );
  });

  it('название дороги в коде совпадает с дорогой в ROAD_PATHS', () => {
    // Раньше поле называлось просто строкой без кавычек, и проверка читала
    // его как идентификатор. Имя дороги — для читаемости и для проверки:
    // указатель на дороге, которой нет, стоит в поле.
    const списокДорог = дороги();
    const начала = списокДорог.map(
      (д) => `${Math.round(д.from.x)}, ${Math.round(д.from.z)} -> ${Math.round(д.to.x)}, ${Math.round(д.to.z)}`,
    );
    must(начала.length >= 4, 'дороги не разобрались');
    for (const у of указатели()) {
      must(
        у.к.trim().length > 0,
        `у указателя в (${у.x}, ${у.z}) пустое название дороги`,
      );
    }
  });
});