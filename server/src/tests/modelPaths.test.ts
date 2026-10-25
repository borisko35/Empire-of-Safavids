// Пути моделей: один «models/» — тот, что подставляет загрузчик (§339).
//
// ЧТО БЫЛО. `loadDecorModel` сам подставляет `/game/models/`, а вызывающий
// три раза подряд передавал ещё и `models/`: §336 (дома), §337 (городские
// ворота), §334 (ящик, кувшин, навес). Получался
// `/game/models/models/decor/…` — 404, и объекта в мире не было. Ошибки не
// видел никто: `onError` отдаёт `null` молча, а вызывающие молча оставляли
// заглушку.
//
// ЧТО ТЕПЕРЬ. Загрузчик снимает лишний префикс и ругается в консоль. Плюс
// этот сторож: ни один вызов в клиенте не передаёт `models/`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function должен(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

function всеИсходники(папка: string): { путь: string; код: string }[] {
  const итог: { путь: string; код: string }[] = [];
  for (const имя of readdirSync(папка)) {
    const путь = join(папка, имя);
    if (statSync(путь).isDirectory()) {
      итог.push(...всеИсходники(путь));
      continue;
    }
    if (!имя.endsWith('.ts')) continue;
    итог.push({ путь, код: readFileSync(путь, 'utf-8') });
  }
  return итог;
}

const ТЕРРЕЙН = читать('client/src/app/game3d/terrain.ts');

describe('Модели без материалов (§340)', () => {
  // В city-gate.glb и clay-jug.glb материалов нет вовсе: three подставляет
  // белый MeshStandardMaterial. Код одевает их сам — но если модели когда-то
  // получат свои материалы, одёжка станет лишней, и этот сторож об этом скажет.
  function материалыМодели(путь: string): { имя: string }[] | null {
    const буфер = readFileSync(join(корень, путь));
    if (буфер.subarray(0, 4).toString('ascii') !== 'glTF') return null;
    let смещение = 12;
    while (смещение < буфер.length) {
      const длина = буфер.readUInt32LE(смещение);
      const тип = буфер.readUInt32LE(смещение + 4);
      if (тип === 0x4E4F534A) {
        const json = JSON.parse(буфер.subarray(смещение + 8, смещение + 8 + длина).toString('utf-8'));
        return json.materials ?? [];
      }
      смещение += 8 + длина + ((4 - (длина % 4)) % 4);
    }
    return null;
  }

  it('у ворот материалов нет, у кувшина они белые без карт', () => {
    const ворота = материалыМодели('client/src/app/public/models/decor/city-gate.glb');
    должен(ворота !== null, 'city-gate.glb не читается');
    должен(ворота!.length === 0,
      'у ворот появились материалы: одёжка в коде больше не нужна — снять её');
    const кувшин = материалыМодели('client/src/app/public/models/decor/clay-jug.glb');
    должен(кувшин !== null, 'clay-jug.glb не читается');
    // У кувшина материалы есть, но все белые и без карт: three нарисует гипс.
    const белые = (кувшин as unknown as { pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: unknown } }[])
      .every((м) => {
        const pbr = м.pbrMetallicRoughness ?? {};
        const база = pbr.baseColorFactor;
        const бел = база === undefined || (база[0] === 1 && база[1] === 1 && база[2] === 1);
        return бел && pbr.baseColorTexture === undefined;
      });
    должен(белые, 'у кувшина появились цвета/карты: одёжка в коде больше не нужна — снять её');
  });

  it('одёжка не трогает авторские материалы', () => {
    const террейн = читать('client/src/app/game3d/terrain.ts');
    const тело = /export function одетьБелыеМеста\([\s\S]*?\n}/.exec(террейн)?.[0] ?? '';
    должен(/мат\.map/.test(тело) && /0xffffff/.test(тело),
      'одёжка перекрашивает всё подряд: проверки на свою карту и белый цвет нет');
    должен(/одетьБелыеМеста\(ворота, MAT\.gateStone\)/.test(террейн),
      'ворота не одеваются в камень — останутся белым макетом');
    const интерактив = читать('client/src/app/game3d/interactive.ts');
    должен(/одетьБелыеМеста\(вещь, МАТЕРИАЛ_ГЛИНЫ\)/.test(интерактив),
      'кувшин не одевается в глину — останется белым');
  });
});

describe('Пути моделей', () => {
  it('ни один вызов не передаёт models/ — префикс уже внутри загрузчика', () => {
    const плохие: string[] = [];
    for (const { путь, код } of всеИсходники(join(корень, 'client/src'))) {
      if (/loadDecorModel\(\s*[`'"]models\//.test(код)) плохие.push(путь);
    }
    должен(плохие.length === 0,
      'модель грузится по пути с двойным models/: ' + плохие.join(', '));
  });

  it('загрузчик снимает лишний префикс и говорит об этом', () => {
    должен(/const чистый = path\.startsWith\('models\/'\) \? path\.slice\('models\/'\.length\) : path;/.test(ТЕРРЕЙН),
      'загрузчик не чинит путь: 404 снова будет молчаливым');
    должен(/\[models\] lishniy prefiks models\/ uberen: /.test(ТЕРРЕЙН),
      'о лишнем префиксе не сообщается: опечатку не найти');
  });

  it('ворота, ящик, кувшин и навес берут decor/ напрямую', () => {
    for (const файл of ['terrain.ts', 'interactive.ts']) {
      const код = читать('client/src/app/game3d/' + файл);
      должен(!/loadDecorModel\(\s*['"`]models\/decor\//.test(код),
        `${файл} снова грузит модели с лишним models/`);
    }
    должен(/loadDecorModel\('decor\/city-gate\.glb'\)/.test(ТЕРРЕЙН),
      'городские ворота не грузятся: в мире останется заглушка');
    const интерактив = читать('client/src/app/game3d/interactive.ts');
    for (const модель of ['crate', 'clay-jug', 'trade-tent']) {
      должен(new RegExp(`loadDecorModel\\('decor/${модель}\\.glb'\\)`).test(интерактив),
        `интерактивный объект ${модель} не грузится: останется заглушка`);
    }
  });
});
