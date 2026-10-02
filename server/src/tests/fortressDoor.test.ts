// Крепость на перевале: дверь на обеих сторонах одна и та же.
//
// ЗАЧЕМ ЭТА ПРОВЕРКА. Дверь рисует клиент по своей записи, а вход считает
// сервер по своей. Если координаты разойдутся, игрок увидит дверь, нажмёт и
// ничего не получит - ровно тот баг, который стоил 30 сентября почти суток и
// который едва не случился снова с аукционным домом (184 единицы между тем, что
// было нарисовано, и тем, что считалось).
//
// ПОЧЕМУ НЕ ИЩЕМ СТРОКУ. Поиск "fortress" нашёл бы сам факт упоминания. Здесь
// числа берутся из обеих записей и сравниваются.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTERIORS } from '../data/interiors';
import { waterMask } from '../../../shared/water';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

describe('Крепость: дверь одна и та же на клиенте и на сервере', () => {
  it('запись существует на сервере и держит свой слот', () => {
    const def = INTERIORS.fortress;
    must(def !== undefined, 'на сервере нет записи fortress: дверь есть, а войти некуда');
    // Слот 10, а НЕ «последняя запись». После крепости появился дворец, и
    // требование «быть последней» перестало значить то же: слот комнаты
    // считается индексом в SPOTS, а на сервере зашит числом. Значит важно не
    // положение «последняя», а номер слота и соседство с караван-сараем.
    const ключи = Object.keys(INTERIORS);
    const слот = ключи.indexOf('fortress');
    must(
      слот === 10,
      `fortress на слоте ${слот}, а обязана быть десятой: слот считается индексом в SPOTS`
    );
    must(
      ключи[слот - 1] === 'caravanserai',
      `перед крепостью стоит ${ключи[слот - 1]}, а не караван-сарай: ` +
        'вклинившаяся запись разъедет слоты по координатам'
    );
  });

  it('координаты двери на сервере и на клиенте совпадают', () => {
    const def = INTERIORS.fortress!;
    const клиент = читать('client/src/app/game3d/interiors.ts');
    must(клиент.length > 1000, 'interiors.ts на клиенте не прочитан');

    // Запись клиента: dx/dz - дверь, ex/ez - выход наружу.
    const строка = клиент.split('\n').find((l) => l.includes("id: 'fortress'") && l.includes('dx:'));
    must(строка !== undefined, 'в SPOTS на клиенте нет записи fortress');

    const dx = /dx:\s*(-?\d+(?:\.\d+)?)/.exec(строка!);
    const dz = /dz:\s*(-?\d+(?:\.\d+)?)/.exec(строка!);
    const ex = /ex:\s*(-?\d+(?:\.\d+)?)/.exec(строка!);
    const ez = /ez:\s*(-?\d+(?:\.\d+)?)/.exec(строка!);
    must(dx && dz && ex && ez, 'в записи клиента нет всех четырёх координат двери');

    must(
      Number(dx[1]) === def.doorX && Number(dz[1]) === def.doorZ,
      `дверь: сервер (${def.doorX},${def.doorZ}), клиент (${dx[1]},${dz[1]}) - ` +
        'кнопка есть, а войти некуда'
    );
    must(
      Number(ex[1]) === def.exitX && Number(ez[1]) === def.exitZ,
      `выход: сервер (${def.exitX},${def.exitZ}), клиент (${ex[1]},${ez[1]}) - ` +
        'игрок выйдет не туда'
    );
  });

  it('слот комнаты совпадает с позицией в массиве', () => {
    // Слот = POCKET_X + индекс * ROOM_DX. Сервер хранит число. Если эти два
    // посчитать по-разному, комната окажется в другом месте, чем её полагают
    // проверки границ.
    const клиент = читать('client/src/app/game3d/interiors.ts');
    const def = INTERIORS.fortress!;
    must(def !== undefined, 'записи fortress нет');

    const pocketX = /const POCKET_X = (\d+)/.exec(клиент);
    const roomDx = /const ROOM_DX = (\d+)/.exec(клиент);
    must(pocketX !== null && roomDx !== null, 'не найдены POCKET_X или ROOM_DX на клиенте');

    const индекс = Object.keys(INTERIORS).indexOf('fortress');
    const ожидаемый = Number(pocketX[1]) + индекс * Number(roomDx[1]);
    must(
      def.roomCx === ожидаемый,
      `слот: сервер roomCx ${def.roomCx}, а по индексу ${индекс} выходит ${ожидаемый}. ` +
        'Комната встала не туда.'
    );
  });

  it('дверь стоит на суше, а не в воде', () => {
    // Крепость на склоне: вода на юге. Дверь на воде означала бы, что игрок
    // подходит к ней вплавь и половина подхода недоступна.
    const def = INTERIORS.fortress!;
    const w = waterMask(def.doorX, def.doorZ);
    must(w < 0.5, `дверь стоит в воде: waterMask = ${w.toFixed(3)}`);
    const we = waterMask(def.exitX, def.exitZ);
    must(we < 0.5, `выход стоит в воде: waterMask = ${we.toFixed(3)}`);
  });

  it('выход наружу не совпадает с дверью и не улетает далеко', () => {
    const def = INTERIORS.fortress!;
    const d = Math.hypot(def.exitX - def.doorX, def.exitZ - def.doorZ);
    must(d > 0.5, 'выход совпадает с дверью: выходить будет некуда');
    // У караван-сарая выход в 4 единицы от двери (505,69 -> 505,73). Сильно
    // больше - значит точка выбрана на глаз и не проверена.
    must(d <= 8, `выход в ${d.toFixed(1)} единицах от двери: слишком далеко, точка не проверена`);
  });

  it('дверь крепости не путается с другими входами', () => {
    const def = INTERIORS.fortress!;
    const другие = Object.values(INTERIORS).filter((d) => d.id !== 'fortress');
    for (const d of другие) {
      const dist = Math.hypot(def.doorX - d.doorX, def.doorZ - d.doorZ);
      // canEnter пускает в радиусе 26 - если две двери ближе, игрок войдёт не
      // туда, куда хотел.
      must(dist > 52, `двери fortress (${def.doorX},${def.doorZ}) и ${d.id} ` +
        `(${d.doorX},${d.doorZ}) в ${dist.toFixed(0)} единицах: игрок войдёт не туда`);
    }
  });

  it('у крепости есть своя обстановка и перевод', () => {
    const клиент = читать('client/src/app/game3d/interiors.ts');
    must(
      /function furnishFortress\(/.test(клиент),
      'нет функции обстановки: комната откроется, но выглядеть будет как ошибка'
    );
    must(/fortress: furnishFortress,/.test(клиент), 'вид fortress не заведён в реестр обстановки');
    // Реестр не должен откатиться на чужую обстановку.
    must(/caravanserai: furnishCaravanserai,/.test(клиент), 'реестр обстановки повреждён');

    for (const код of ['ru', 'en', 'az']) {
      const словарь = читать(`shared/locales/${код}.json`);
      must(/"fortress"\s*:/.test(словарь), `в ${код}.json нет buildings.fortress`);
    }
  });
});