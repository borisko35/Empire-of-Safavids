// Катакомбы Тебриза: первое подземелье с геометрией.
//
// ГЛАВНАЯ ПРОВЕРКА ОТСЮДА: босс стоит в (0, 0), то есть в центре комнаты.
// Значит трон обязан быть у дальней стены — иначе босс появлялся бы внутри
// трона. Раньше это было неважно (геометрии не было), теперь стало важно.
//
// ВТОРОЕ: точка входа подземелья равна центру его комнаты. Я сначала задал
// точки входа по регионам, в мире, — для геометрии они были бессмысленны:
// монстры появились бы у двери на улице, а комната стоит в кармане.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTERIORS } from '../data/interiors';
import { DUNGEONS_DATABASE } from '../data/dungeons';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const клиент = читать('client/src/app/game3d/interiors.ts');
const катакомбы = DUNGEONS_DATABASE.dungeon_tabriz_catacombs;
const зал = клиент.slice(клиент.indexOf('function furnishCatacombs('));
const тело = зал.slice(0, зал.indexOf('export const BUILDINGS') > 0 ? зал.indexOf('export const BUILDINGS') : 7000);

describe('Катакомбы: точка входа = центр комнаты', () => {
  it('точка входа подземелья совпадает с комнатой интерьера', () => {
    must(INTERIORS.catacombs !== undefined, 'интерьера катакомб нет');
    must(
      катакомбы.entryX === INTERIORS.catacombs.roomCx && катакомбы.entryZ === INTERIORS.catacombs.roomCz,
      `точка входа (${катакомбы.entryX}, ${катакомбы.entryZ}) не совпадает с комнатой ` +
        `(${INTERIORS.catacombs.roomCx}, ${INTERIORS.catacombs.roomCz}): монстры появятся не в той комнате`
    );
  });

  it('у всех пяти подземелий точка входа не в мире, а рядом с комнатой', () => {
    for (const [id, def] of Object.entries(DUNGEONS_DATABASE)) {
      must(
        def.entryX >= 4000 && def.entryX <= 5100,
        `точка входа ${id} в ${def.entryX} — это не карман построек, монстры окажутся на улице`
      );
    }
  });

  it('босс стоит в центре — значит трон не в центре', () => {
    const босс = катакомбы.rooms.find((р) => р.isBossRoom);
    must(босс !== undefined, 'у катакомб нет боссовой комнаты');
    const позицияБосса = босс!.monsters
      .flatMap((г) => г.positions)
      .find((п) => п.x === 0 && п.z === 0);
    must(позицияБосса !== undefined, 'босс в центре не найден: проверка опоры на точный случай');
    // Трон у дальней стены: cz минус 12, а не ноль.
    must(
      /box\(3\.6, 0\.5, 1\.6, M\.stone, cx, FLOOR_Y \+ 0\.25, cz - 12\)/.test(тело),
      'трон не у дальней стены: босс появляется в (0, 0), то есть внутри трона'
    );
    must(
      !/box\(3\.6, 0\.5, 1\.6, M\.stone, cx, FLOOR_Y \+ 0\.25, cz\)/.test(тело),
      'трон стоит ровно в центре комнаты — это и есть баг'
    );
  });
});

describe('Катакомбы: комнаты данных разложены по геометрии', () => {
  it('геометрия делит зал на три зоны, как в данных три комнаты', () => {
    must(катакомбы.rooms.length === 3, `комнат в данных ${катакомбы.rooms.length}, а зон заложено три`);
    must(/── Зона 1/.test(тело), 'входного зала нет');
    must(/── Зона 2/.test(тело), 'казарм нет');
    must(/── Зона 3/.test(тело), 'тронного зала нет');
    // Зоны на разных расстояниях от входа: иначе это одна комната с декором.
    const расстояния = [...тело.matchAll(/cz ([+-]) ?(\d+(?:\.\d+)?)/g)].map((м) =>
      (м[1] === '-' ? -1 : 1) * Number(м[2])
    );
    must(
      new Set(расстояния).size >= 4,
      'зоны не разнесены по глубине: расстояний ' + расстояния.length + ', разных ' + new Set(расстояния).size
    );
  });

  it('сундуков столько же, сколько в данных', () => {
    const ожидается = катакомбы.rooms.reduce((с, р) => с + р.treasureChests, 0);
    const нарисовано = (тело.match(/box\(1\.1, 0\.8, 0\.8, M\.wood/g) || []).length;
    must(
      нарисовано === ожидается,
      `сундуков нарисовано ${нарисовано}, а в данных ${ожидается} (1 + 2 + 3)`
    );
  });

  it('спуск вниз есть: подземелье идёт под землёй', () => {
    must(
      /FLOOR_Y \+ 0\.08 - i \* 0\.16/.test(тело),
      'спуска нет: в подземелье приходят по лестнице внутри здания'
    );
  });

  it('факелы есть в каждой зоне', () => {
    // Считаются ПАРЫ фонарей, а не вхождения M.fire: четыре факела рисуются
    // одним циклом, и M.fire в коде встречается ровно один раз. Считать
    // вхождения материала здесь — значит всегда увидеть «1» и решить, что
    // фонарей нет.
    const пары = тело.match(/\[cx [+-] ?[\d.]+, cz [+-] ?[\d.]+\]/g) || [];
    must(
      пары.length >= 4,
      `пар фонарей ${пары.length}: подземелье должно освещаться по частям`
    );
    must(/M\.fire/.test(тело), "огня на фонарях нет");
  });

  it('функция обстановки заведена и вызывается', () => {
    must(/function furnishCatacombs\(/.test(клиент), 'функции обстановки нет');
    must(/catacombs: furnishCatacombs,/.test(клиент), 'катакомбы не прописаны в выборе обстановки');
    must(
      /'catacombs'/.test(клиент.split('export type BuildingKind')[1]?.slice(0, 900) ?? ''),
      'в типе BuildingKind нет катакомб'
    );
  });

  it('комната девятнадцатая и граница кармана её покрывает', () => {
    const ключи = Object.keys(INTERIORS);
    must(ключи.length === 19, `построек ${ключи.length}, а должно быть 19`);
    must(ключи[18] === 'catacombs', `на слоте 18 стоит ${ключи[18]}, а ожидались catacombs`);
    const прямоугольник = /POCKET_RECT = \{ x0: (-?\d+), x1: (\d+)/.exec(клиент);
    must(прямоугольник !== null, 'POCKET_RECT не найден');
    must(
      Number(прямоугольник![2]) >= INTERIORS.catacombs!.roomCx + INTERIORS.catacombs!.roomHalf,
      `правый край кармана ${прямоугольник![2]}, а комната кончается на ` +
        `${INTERIORS.catacombs!.roomCx + INTERIORS.catacombs!.roomHalf}`
    );
  });

  it('название переведено во всех трёх языках', () => {
    for (const код of ['ru', 'en', 'az']) {
      const словарь = JSON.parse(читать(`shared/locales/${код}.json`));
      must(
        typeof словарь.buildings?.catacombs === 'string' && словарь.buildings.catacombs.length > 0,
        `в ${код}.json нет названия buildings.catacombs`
      );
    }
  });
});
