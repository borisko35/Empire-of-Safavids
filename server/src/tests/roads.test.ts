// Дороги, караваны и путники.
//
// ЧТО БЫЛО С ДОРОГАМИ. Три поломки, все видны на обычном снимке из игры.
//
// 1. Высота полотна бралась ОДИН РАЗ, в центре полосы, и обе крайние точки
//    ставились на неё же. Земля по краям дороги лежит на другой высоте, и на
//    любом уклоне полотно с одной стороны уходило в землю, с другой висело.
//    На снимке это светлая лента, которая то тонет, то повисает в воздухе.
//
// 2. Полотно поднималось на 5 см и при этом ставило castShadow. Тень от
//    полосы, лежащей на земле, ложилась рядом тёмной чертой — это и были
//    чёрные диагонали на пустыне.
//
// 3. По краям стояли отдельные бордюры высотой 40 см. Из-за них дорога
//    выглядела наклеенной: жёсткая тёмная кромка вместо перехода в землю.
//
// ЧТО БЫЛО С ДВИЖЕНИЕМ. Караванов не было. В buildRoads стояли три
// статичных верблюда в точках 0.2, 0.45 и 0.7 пути, и они не двигались
// никогда. Поле было пустым не из-за того, что движения не было, а из-за
// того, что его не существовало вовсе.
import { readFileSync } from 'node:fs';
import { join } from 'path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const terrain = stripComments(read('client/src/app/game3d/terrain.ts'));
const traffic = stripComments(read('client/src/app/game3d/roadTraffic.ts'));
const world = stripComments(read('client/src/app/game3d/world3d.ts'));

/** Тело buildSingleRoad. */
function roadBuilder(): string {
  const i = terrain.indexOf('function buildSingleRoad');
  return terrain.slice(i, terrain.indexOf('for (const r of roads)', i));
}

describe('Дорога лежит на земле, а не над ней и не в ней', () => {
  it('высота снимается у каждого края, а не одна в центре', () => {
    // ГЛАВНАЯ ОШИБКА ПОЛОТНА. Одна выборка на всю ширину дороги — значит
    // на уклоне половина полосна торчит, половина проваливается.
    const body = roadBuilder();
    expect(body).toMatch(/groundHeight\(lx, lz\)/);
    expect(body).toMatch(/groundHeight\(rx, rz\)/);
  });

  it('полотно приподнято над более высоким краем', () => {
    // Иначе на склоне полотно уйдёт в землю по одной из сторон.
    const body = roadBuilder();
    expect(body).toMatch(/Math\.max\(ly, ry\) \+ 0\.0\d/);
  });

  it('полотно не отбрасывает тень', () => {
    // Именно это давало чёрные диагонали на земле. Тень принимать можно.
    const body = roadBuilder();
    expect(body).toMatch(/castShadow = false/);
    expect(body).toMatch(/receiveShadow = true/);
  });

  it('шаг сегментов не больше метра', () => {
    // Двухметровые куски шли поверх неровностей: полотно провисало между
    // точками, где земля поднималась.
    const body = roadBuilder();
    expect(body).toMatch(/totalLen \/ 1\)/);
    expect(body).not.toMatch(/totalLen \/ 2\)/);
  });
});

describe('Дорога выглядит как грунт, а не как покрашенная полоса', () => {
  it('высоких бордюров больше нет', () => {
    // Бордюр 40 см давал жёсткую кромку, из-за которой дорога читалась как
    // наклеенная сверху.
    expect(terrain).not.toMatch(/ch \+ 0\.4/);
    expect(terrain).not.toMatch(/edgeMat/);
  });

  it('есть текстура полотна', () => {
    expect(terrain).toMatch(/function roadMaterial\(/);
    expect(terrain).toMatch(/CanvasTexture/);
  });

  it('края дороги растворяются, а не обрываются', () => {
    expect(terrain).toMatch(/destination-out/);
  });

  it('полупрозрачность через отсев, а не через смешивание', () => {
    // При обычном blending полотно, лежащее вплотную к земле, даёт
    // мерцание, когда игрок подходит к дороге вплотную.
    expect(terrain).toMatch(/alphaTest: 0\.5/);
  });
});

describe('Дороги и движение пользуются одними и теми же данными', () => {
  it('список дорог вынесен наружу', () => {
    expect(terrain).toMatch(/export const ROAD_PATHS/);
    expect(traffic).toMatch(/ROAD_PATHS/);
  });

  it('караваны не привязаны к индексу дороги', () => {
    // Раньше путь каравана был roads[3]. Стоило вставить дорогу в середину
    // списка — и караваны поехали бы в другую сторону.
    expect(terrain).not.toMatch(/roads\[3\]/);
    expect(traffic).not.toMatch(/ROAD_PATHS\[3\]\s*;/);
  });

  it('статичных верблюдов в полотне больше нет', () => {
    expect(terrain).not.toMatch(/const caravanPath/);
  });
});

describe('По дорогам кто-то идёт', () => {
  it('караваны и путники создаются', () => {
    expect(traffic).toMatch(/export function createRoadTraffic/);
    expect(traffic).toMatch(/makeCamel/);
    expect(traffic).toMatch(/makePerson/);
  });

  it('есть покадровое обновление, иначе они снова застынут', () => {
    expect(traffic).toMatch(/update\(dt: number, now: number, px: number, pz: number\)/);
    expect(world).toMatch(/this\.roadTraffic\.update\(dt, now, me\.pos\.x, me\.pos\.z\)/);
  });

  it('движение меняет положение, а не только рисует', () => {
    expect(traffic).toMatch(/w\.t \+=/);
    expect(traffic).toMatch(/w\.group\.position\.set\(/);
  });

  it('шаг читается: ноги в противофазе', () => {
    expect(traffic).toMatch(/i % 2 === 0\) \? swing : -swing/);
  });

  it('идут туда-обратно, а не пропадают за концом дороги', () => {
    expect(traffic).toMatch(/if \(w\.t > 1\.05\)/);
    expect(traffic).toMatch(/if \(w\.t < -0\.05\)/);
  });

  it('колонна растянута, а не слипается в кучу', () => {
    // У всех в колонне одна и та же точка — верблюды стояли бы друг в друге.
    expect(traffic).toMatch(/const lags = \[/);
    expect(traffic).toMatch(/w\.lag/);
  });
});

describe('Путника с заданием можно нажать', () => {
  it('есть кликабельные цели', () => {
    // «Случайные НПС с квестами», на которые нельзя подойти, — это
    // просто фигурки. userData должен совпадать с городскими NPC.
    expect(traffic).toMatch(/clickTargets: THREE\.Object3D\[\]/);
    expect(traffic).toMatch(/userData\.npcPanel = 'panel-quests'/);
    expect(traffic).toMatch(/userData\.npcName/);
  });

  it('луч клика попадает и в городских NPC, и в путников', () => {
    expect(world).toMatch(/\[\.\.\.this\.npcs\.clickTargets, \.\.\.this\.roadTraffic\.clickTargets\]/);
  });

  it('над таким путником видна метка задания', () => {
    expect(traffic).toMatch(/function questMarker/);
  });
});

describe('Дорожное движение не съедает кадры', () => {
  it('дальнее не рисуется', () => {
    // Дороги длинные, а ходьба идёт всегда: без отсечения по дальности
    // список объектов растёт вместе с миром.
    expect(traffic).toMatch(/VISIBLE_DIST/);
    expect(traffic).toMatch(/w\.group\.visible = !far/);
  });
});
