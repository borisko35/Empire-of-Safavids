// Дорожное движение не двигалось, а верблюды стояли посреди города.
//
// ЧТО БЫЛО, И КАК ЭТО ВЫГЛЯДЕЛО. В travellers складывались путники так:
//
//   travellers.push(w as Walker & { road: RoadDef });
//
// Приведение типа — это подсказка компилятору, а не операция. На рантайме в
// объект ничего не добавляется: w.road === undefined у всех. Цикл обновления
// начинается с `if (!road) continue`, то есть пропускает каждого. Позиция
// фигурки не выставлялась НИ РАЗУ, и все восемнадцать (шесть верблюдов и
// двенадцать людей) оставались в мировом начале координат.
//
// Мировое начало (0,0) — это 43 м от центра Исфахана при радиусе стен 116 м.
// То есть все верблюды стояли ВНУТРИ города. Игрок написал: «Верблюды
// оказались в городе». Это оно.
//
// Второе следствие той же строки: путники с заданиями, на которых можно
// кликнуть и получить задание, не работали никогда — луч клика шёл по фигурке
// на (0,0), а не по той, что на дороге.
//
// ЧТО БЫЛО ЕЩЁ. Все дороги ROAD_PATHS начинаются в центре города (`from` =
// CITY). Пока путники не двигались, это было не видно; как только движение
// починили, караваны пошли бы через городскую площадь. Поэтому дороги ещё и
// ограничены участком ВНЕ стен.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';
import { buildRunner } from './helpers/extractFn';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const traffic = stripComments(read('client/src/app/game3d/roadTraffic.ts'));
const terrain = stripComments(read('client/src/app/game3d/terrain.ts'));

describe('Путник знает свою дорогу', () => {
  it('дорога присваивается, а не «приводится типом»', () => {
    // ГЛАВНОЕ. Приведение типа не добавляет поле: компилятор доволен, а
    // w.road в рантайме нет.
    expect(traffic).not.toMatch(/travellers\.push\(\s*w as\b/);
    expect(traffic).not.toMatch(/as Walker & \{ road/);
    expect(traffic).toMatch(/w\.road = road/);
  });

  it('в travellers попадает ровно одна дорога на путника', () => {
    const assigns = (traffic.match(/w\.road = road/g) ?? []).length;
    const pushes = (traffic.match(/travellers\.push\(/g) ?? []).length;
    // Два места создания: колонна каравана и путники с заданиями
    expect({ присваиваний: assigns, добавлений: pushes }).toEqual({
      присваиваний: assigns,
      добавлений: pushes,
    });
    expect(assigns).toBe(2);
  });

  it('road объявлен полем интерфейса, а не только в приведении', () => {
    // Поле должно быть у самого типа — иначе следующий человек снова напишет
    // `push(w as Walker & {...})` и ничего не заметит.
    expect(traffic).toMatch(/road\?: RoadDef;/);
  });

  it('цикл обновления берёт дорогу из самого путника', () => {
    const fn = traffic.slice(traffic.indexOf('for (const w of travellers)'));
    expect(fn.slice(0, 200)).toMatch(/const road = w\.road;/);
  });
});

describe('Путники не ходят по городу', () => {
  it('у каждого путника свой участок дороги', () => {
    expect(traffic).toMatch(/tMin: number;/);
    expect(traffic).toMatch(/tMax: number;/);
    // Зажим по своему участку, а не по всей дороге
    expect(traffic).toMatch(/if \(w\.t > w\.tMax\)/);
    expect(traffic).toMatch(/if \(w\.t < w\.tMin\)/);
    expect(traffic).toMatch(/clamp\(w\.t \+ w\.lag, w\.tMin, w\.tMax\)/);
  });

  it('откат за конец дороги больше не уводит на полотна, которых нет', () => {
    // Прежний зажим был [-0.05, 1.05]: за концом дороги полотна нет, и
    // путник стоял в воздухе. Плюс лаг колонны выносил замыкающего за стены.
    expect(traffic).not.toMatch(/w\.t > 1\.05/);
    expect(traffic).not.toMatch(/w\.t < -0\.05/);
  });

  it('дорога, целиком внутри города, движения не получает', () => {
    // Дорога от города к точке возрождения — 43 м при радиусе стен 116 м.
    // Каравану на ней идти некуда.
    expect(traffic).toMatch(/outsideCityRange/);
    const caravan = traffic.slice(traffic.indexOf('const caravanRoads'), traffic.indexOf('const PACKS'));
    expect(caravan).toMatch(/x\.range !== null/);
    const walkers = traffic.slice(traffic.indexOf('const walkerRoads'));
    expect(walkers.slice(0, 400)).toMatch(/x\.range !== null/);
  });
});

describe('Почему вообще нужен участок вне стен', () => {
  it('дороги начинаются в центре города — значит без обрезки они идут по площади', () => {
    // Это и есть причина, по которой понадобился outsideCityRange. Проверка не
    // про «правильность» дорог, а про документирование факта: пока это так,
    // путника нельзя пускать на дорогу целиком.
    const froms = [...terrain.matchAll(/from: \{ x: (?:CITY\.x|(-?\d+)), z: (?:CITY\.z|(-?\d+)) \}/g)];
    const atCentre = froms.filter((m) => m[1] === undefined && m[2] === undefined).length;
    expect({ дорог_из_центра: atCentre, всего: froms.length })
      .toEqual({ дорог_из_центра: atCentre, всего: froms.length });
    expect(atCentre).toBeGreaterThanOrEqual(2);
  });

  it('радиус стен известен, и дороги короче него целиком лежат в городе', () => {
    const radius = Number(/export const CITY = \{[^}]*radius: (\d+)/.exec(terrain)?.[1]);
    expect(radius).toBeGreaterThan(0);
    expect(traffic).toMatch(/CITY\.radius \+ OUTSIDE_MARGIN/);
  });
});

describe('outsideCityRange: настоящая функция на настоящих дорогах', () => {
  // Здесь исполняется РЕАЛЬНАЯ функция из файла, а не её копия: она вырезается
  // из roadTraffic.ts и запускается на подставленном городе.
  const CITY = { x: 34, z: 26, radius: 116 };
  // Запас берётся из файла, а не задаётся здесь: иначе тест проверял бы ту
  // цифру, которую сам же и выдумал, и смена её в коде прошла бы мимо.
  const OUTSIDE_MARGIN = Number(/const OUTSIDE_MARGIN = (\d+)/.exec(traffic)?.[1]);
  const run = buildRunner(
    traffic,
    ['outsideCityRange'],
    { CITY, OUTSIDE_MARGIN },
  );
  const range = (road: { from: { x: number; z: number }; to: { x: number; z: number } }) =>
    (run({} as never).outsideCityRange as (r: unknown) => { t0: number; t1: number } | null)(road);

  it('запас от стен не меньше восьми метров', () => {
    // Верблюд с тюками шириной около 3 м. Вплотную к стене тюки уходили бы в
    // кладку, и караван выглядел бы проходящим сквозь башню.
    expect({ OUTSIDE_MARGIN }).toEqual({ OUTSIDE_MARGIN: expect.any(Number) });
    expect(OUTSIDE_MARGIN).toBeGreaterThanOrEqual(8);
  });

  it('дорога, выходящую из города, обрезается по стенам', () => {
    // Ровно та дорога, что в ROAD_PATHS[3]: из центра города на караван-сарай.
    const r = range({ from: { x: 34, z: 26 }, to: { x: 505, z: 55 } });
    expect(r).not.toBeNull();
    // Начало участка — не 0: первые проценты дороги это город
    expect(r!.t0).toBeGreaterThan(0.2);
    expect(r!.t1).toBe(1);
  });

  it('дорога целиком в городе не даёт участка', () => {
    // ROAD_PATHS[0]: из центра к точке возрождения, 43 м при радиусе 116.
    expect(range({ from: { x: 34, z: 26 }, to: { x: 0, z: 0 } })).toBeNull();
  });

  it('обрезка идёт по стенам плюс запас, а не «на глаз»', () => {
    // Граница участка обязана совпадать с местом, где дорога выходит из-под
    // города. Проверяем геометрией, а не числом в коде: начало участка — сразу
    // за стеной с запасом, а шаг назад — уже ближе к стене.
    const road = { from: { x: 34, z: 26 }, to: { x: 505, z: 55 } };
    const r = range(road)!;
    const at = (t: number) => ({
      x: road.from.x + (road.to.x - road.from.x) * t,
      z: road.from.z + (road.to.z - road.from.z) * t,
    });
    const dist = (p: { x: number; z: number }) => Math.hypot(p.x - CITY.x, p.z - CITY.z);
    const roadLen = Math.hypot(road.to.x - road.from.x, road.to.z - road.from.z);
    // Шаг выборки в outsideCityRange — 1/240 дороги, погрешность границы
    const tol = roadLen / 240 + 1;

    const dStart = dist(at(r.t0));
    const dBack = dist(at(Math.max(0, r.t0 - 0.01)));
    expect({ начало_у_стен: dStart, назад_к_стенам: dBack })
      .toEqual({ начало_у_стен: expect.any(Number), назад_к_стенам: expect.any(Number) });
    expect(dStart).toBeGreaterThanOrEqual(CITY.radius + OUTSIDE_MARGIN - tol);
    expect(dBack).toBeLessThan(CITY.radius + OUTSIDE_MARGIN);
    // И ни одна точка участка не попадает в город
    for (let t = r.t0; t <= r.t1 + 1e-9; t += (r.t1 - r.t0) / 20) {
      expect({ t, в_городе: dist(at(t)) < CITY.radius })
        .toEqual({ t: expect.any(Number), в_городе: false });
    }
  });
});
