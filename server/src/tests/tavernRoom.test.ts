// Зал таверны: glb-диорама в кармане вместо процедурной коробки.
//
// ЧТО ОСОБЕННОГО В ЭТОЙ ПОСТРОЙКЕ. В архиве medieval_tavern оказался не дом,
// а интерьер-диорама без крыши (пол, стены, стойка, столы, сцена, верхняя
// галерея), 30.92x58.77, пол на 0.40, все 16 материалов unlit. Владелец велел
// делать карманную комнату. Поэтому: слот и центр прежние (слоты соседей не
// сдвинулись), а зал вырос до 30x30, спавн перемерен по сетке проходимости,
// unlit переведён на lit (иначе зал светился бы ночью).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTERIORS } from '../data/interiors';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const клиент = читать('client/src/app/game3d/interiors.ts');
const МАНИФЕСТ = JSON.parse(читать('client/src/app/public/models/manifest.json')) as {
  decor?: { file: string; name: string; bytes: number }[];
};

type Глб = {
  extensionsUsed?: string[];
  materials?: {
    name?: string;
    pbrMetallicRoughness?: { baseColorFactor?: number[] };
    extensions?: Record<string, unknown>;
  }[];
  images?: { mimeType?: string }[];
  nodes?: { name?: string; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives: { attributes: { POSITION: number } }[] }[];
  accessors?: { min: number[]; max: number[] }[];
};

function файл(): { buf: Buffer; json: Глб } {
  const путь = join(корень, 'client/src/app/public/models/decor/tavern-room.glb');
  must(existsSync(путь), 'файла tavern-room.glb нет: проверять нечего');
  const buf = readFileSync(путь);
  const json = JSON.parse(buf.slice(20, 20 + buf.readUInt32LE(12)).toString('utf-8')) as Глб;
  return { buf, json };
}

function габариты(): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  const { json } = файл();
  let minX = Infinity, maxX = -Infinity, minY = Infinity;
  let maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    must(
      node.rotation === undefined && node.scale === undefined,
      `узел ${node.name ?? '?'} повёрнут или масштабирован: пол уедет от FLOOR_Y`
    );
    for (const prim of json.meshes![node.mesh].primitives) {
      const acc = json.accessors![prim.attributes.POSITION];
      const t = node.translation ?? [0, 0, 0];
      minX = Math.min(minX, acc.min[0] + t[0]);
      maxX = Math.max(maxX, acc.max[0] + t[0]);
      minY = Math.min(minY, acc.min[1] + t[1]);
      maxY = Math.max(maxY, acc.max[1] + t[1]);
      minZ = Math.min(minZ, acc.min[2] + t[2]);
      maxZ = Math.max(maxZ, acc.max[2] + t[2]);
    }
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

describe('Таверна-зал: модель диорамы', () => {
  it('файл в источнике сборки, совпадает с манифестом и сжат Draco', () => {
    must(МАНИФЕСТ.decor !== undefined, 'в манифесте нет раздела decor');
    const запись = МАНИФЕСТ.decor!.find((d) => d.name === 'tavern-room');
    must(запись !== undefined, 'записи tavern-room нет в манифесте: файл никто не сверяет с диском');
    const { buf, json } = файл();
    must(buf.length === запись.bytes, `tavern-room: на диске ${buf.length}, в манифесте ${запись.bytes}`);
    must(
      (json.extensionsUsed ?? []).includes('KHR_draco_mesh_compression'),
      'tavern-room без Draco: 62 тыс. вершин поедут сырыми'
    );
    must(
      buf.length < 10 * 1024 * 1024,
      `tavern-room весит ${(buf.length / 1048576).toFixed(1)} МБ: в веб столько не возят`
    );
  });

  it('16 текстур на месте, unlit вычищен — зал берёт свет', () => {
    const { json } = файл();
    must((json.images ?? []).length === 16, `картинок ${(json.images ?? []).length} вместо 16: текстуры потеряны`);
    must((json.materials ?? []).length === 16, `материалов ${(json.materials ?? []).length} вместо 16`);
    must(
      !(json.extensionsUsed ?? []).includes('KHR_materials_unlit'),
      'unlit в extensionsUsed: зал будет светиться ночью, мимо ламп'
    );
    for (const m of json.materials ?? []) {
      must(
        m.extensions?.['KHR_materials_unlit'] === undefined,
        `материал ${m.name ?? '?'} остался unlit: светиться будет кусками`
      );
    }
  });

  it('габариты: 30.92x58.77, пол на 0.40', () => {
    const г = габариты();
    const ширина = г.maxX - г.minX;
    const глубина = г.maxZ - г.minZ;
    const высота = г.maxY - г.minY;
    must(Math.abs(ширина - 30.92) < 0.05, `ширина ${ширина.toFixed(2)} вместо 30.92: модель перевыпущена`);
    must(Math.abs(глубина - 58.77) < 0.05, `глубина ${глубина.toFixed(2)} вместо 58.77: коллайдеры врут`);
    must(Math.abs(высота - 16.34) < 0.05, `высота ${высота.toFixed(2)} вместо 16.34: галерея не та`);
    // Пол модели на 0.40 = FLOOR_Y: ниже только фундамент (0.363), выше —
    // сцена 1.35 и галерея 7–8. Низ на нуле означал бы парящий пол.
    must(г.minY > 0.3 && г.minY < 0.45, `низ на ${г.minY.toFixed(3)} вместо ~0.40: пол не на FLOOR_Y`);
  });
});

describe('Таверна-зал: сервер держит слот, зал и спавн', () => {
  it('слот третий, центр прежний — соседи не сдвинулись', () => {
    const ключи = Object.keys(INTERIORS);
    must(ключи.indexOf('tavern') === 3, `таверна на слоте ${ключи.indexOf('tavern')}: слоты соседей разъехались`);
    const зал = INTERIORS.tavern!;
    must(зал.roomCx === 4132 && зал.roomCz === 4000, `центр (${зал.roomCx}, ${зал.roomCz}) вместо (4132, 4000)`);
    const записи = [...клиент.matchAll(/\{ id: '([a-z_]+)', kind: '[a-z_]+'/g)].map((м) => м[1]);
    must(записи.indexOf('tavern') === 3, `на клиенте таверна на слоте ${записи.indexOf('tavern')}: сервер шлёт в чужую комнату`);
  });

  it('зал 30x30: диорама влезает, проверка границ её покрывает', () => {
    const зал = INTERIORS.tavern!;
    must(зал.roomHalf === 30, `половина ${зал.roomHalf} вместо 30: концы зала за проверкой границ`);
    const м = /export const POCKET_RECT = \{ x0: (\d+), x1: (\d+), z0: (\d+), z1: (\d+) \};/.exec(клиент);
    must(м !== null, 'POCKET_RECT не найден: под залом может не быть земли');
    must(
      зал.roomCx - зал.roomHalf >= Number(м![1]) && зал.roomCx + зал.roomHalf <= Number(м![2]),
      `зал ${зал.roomCx - зал.roomHalf}…${зал.roomCx + зал.roomHalf} вылез за плиту ${м![1]}…${м![2]}`
    );
    must(
      зал.roomCz - зал.roomHalf >= Number(м![3]) && зал.roomCz + зал.roomHalf <= Number(м![4]),
      `зал ${зал.roomCz - зал.roomHalf}…${зал.roomCz + зал.roomHalf} вылез за плиту ${м![3]}…${м![4]}`
    );
  });

  it('спавн на открытом полу, а не в стене', () => {
    const зал = INTERIORS.tavern!;
    // Замер сеткой 1 м по модели: клетка (-8, +6) — пол есть, до ближайшей
    // стены/мебели 2.8 м. Старый спавн (4132, 4005.5) стоял в стене.
    must(зал.spawnX === 4124 && зал.spawnZ === 4006, `спавн (${зал.spawnX}, ${зал.spawnZ}) вместо (4124, 4006): замер сетки`);
    must(
      Math.abs(зал.spawnX - зал.roomCx) <= зал.roomHalf && Math.abs(зал.spawnZ - зал.roomCz) <= зал.roomHalf,
      `спавн (${зал.spawnX}, ${зал.spawnZ}) вне зала — игрок появится за проверкой границ`
    );
  });
});

describe('Таверна-зал: клиент строит диораму, а не коробку', () => {
  it('buildRoom отдаёт таверну построителю диорамы', () => {
    must(
      /if \(def\.kind === 'tavern'\) return buildTavernRoom\(scene, def\);/.test(клиент),
      'маршрута в buildTavernRoom нет: таверна строится процедурной коробкой 22x16'
    );
    must(
      !/function furnishTavern/.test(клиент),
      'furnishTavern на месте: две таверны (коробка и диорама) — одна врёт'
    );
  });

  it('диорама грузится с Draco-декодером и встаёт в центр зала', () => {
    must(
      /const TAVERN_ROOM_MODEL = 'decor\/tavern-room\.glb';/.test(клиент),
      'константа модели зала не найдена: грузится неизвестно что'
    );
    must(
      /draco\.setDecoderPath\('\/game\/draco\/'\)/.test(клиент) &&
        /\/game\/models\/\$\{TAVERN_ROOM_MODEL\}/.test(клиент),
      'загрузчик без Draco или не тем путём: сжатая диорама не разберётся'
    );
    must(
      /зал\.position\.set\(cx, 0, cz\);/.test(клиент),
      'диорама ставится не в центр зала: спавн и коллайдеры разъедутся с геометрией'
    );
  });

  it('148 кругов по замеру, дверь и жаровни на месте', () => {
    const м = /const TAVERN_COLLIDERS: \[number, number\]\[\] = \[([\s\S]*?)\];/.exec(клиент);
    must(м !== null, 'TAVERN_COLLIDERS не найден: стенам не из чего считать круги');
    const круги = м![1].match(/\[-?\d+\.\d\d, [+-]?\d+\.\d\d\]/g) ?? [];
    must(круги.length === 148, `кругов ${круги.length} вместо 148: стены дырявые или лишние`);
    must(
      /const TAVERN_EXIT: \[number, number\] = \[-1, -16\];/.test(клиент),
      'дверь выхода не у устья коридора: игрок выйдет из стены'
    );
    const ж = /const TAVERN_BRAZIERS: \[number, number\]\[\] = \[([\s\S]*?)\];/.exec(клиент);
    must(ж !== null, 'жаровни не найдены: зал без света');
    const точки = ж![1].match(/\[-?\d+, -?\d+\]/g) ?? [];
    must(точки.length === 4, `жаровен ${точки.length} вместо 4: углы зала тёмные`);
    must(
      /doorBuilding: def\.id,\s*\r?\n\s*doorAction: 'exit',/.test(клиент),
      'дверь выхода без метки exit: клик не выпустит наружу'
    );
    // Метка обязана стоять именно в построителе зала: общая проверка выше
    // видит и обычную дверь buildRoom — подмену в таверне она бы пропустила.
    const с = клиент.indexOf('function buildTavernRoom(');
    must(с > 0, 'buildTavernRoom не найден: залу негде встать');
    const х = клиент.slice(с);
    const к = х.search(/\r?\n\}\r?\n/);
    const тело = к > 0 ? х.slice(0, к) : '';
    must(/doorAction: 'exit',/.test(тело), 'дверь зала без метки exit: клик по ней не выпустит наружу');
  });
});
