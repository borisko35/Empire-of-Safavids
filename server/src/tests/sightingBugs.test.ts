// Четыре починки по снимкам из игры.
//
// 1. СТЕНА И БАШНИ ВИСЕЛИ В ВОЗДУХЕ. Группа города стоит на высоте ЦЕНТРА,
//    а стена идёт по радиусу 116, где земля на другой высоте. И то и другое
//    стояло на зашитых числах (position.y = 3, position.y = 7.5), поэтому под
//    башней было видно землю, а по стене шла щель с тенью на песке.
//
// 2. КАРАВАНЫ НЕСЛИСЬ. Скорость переводилась в положение делением на
//    отвлечённое «12» вместо настоящей длины дороги. Дорога в 170 метров
//    проходилась за 7 секунд — это 24 м/с, то есть бег. Теперь делим на
//    реальную длину, и CARAVAN_SPEED — это ровно метры в секунду.
//
// 3. БЕЛОЕ ПЯТНО ПЕРЕД ПЕРСОНАЖЕМ. Песчинки буры зарождались в четырёх
//    метрах от камеры при размере 0,24 мировых единиц. Point рисуется в
//    мировых единицах, поэтому такая песчинка занимала на экране около сотни
//    пикселей, а слой с frustumCulled = false рисовался поверх персонажа.
//    Плюс ореол солнца был 340 единиц при яркости 0,85 — на закате он
//    накрывал полсцены.
//
// 4. МИНИКАРТА ВЫГЛЯДЕЛА СЛОМАНОЙ. Запасная ветка заливала холст тёмно-синим
//    — получалась «пустая сетка», когда слой рельефа не построился.
import { readFileSync } from 'node:fs';
import { join } from 'path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const terrain = stripComments(read('client/src/app/game3d/terrain.ts'));
const traffic = stripComments(read('client/src/app/game3d/roadTraffic.ts'));
const weather = stripComments(read('client/src/app/game3d/weather.ts'));
const sky = stripComments(read('client/src/app/game3d/sky.ts'));
const hud = stripComments(read('client/src/app/hud.ts'));

/** Тело buildCity. */
function cityBuilder(): string {
  const i = terrain.indexOf('export function buildCity');
  return terrain.slice(i, terrain.length);
}

describe('Стена и башни стоят на земле', () => {
  it('высота земли берётся по месту, а не зашивается', () => {
    // ГЛАВНОЕ. Разница между высотой земли в центре и на радиусе стены —
    // и есть та щель, на которой стена висела.
    expect(cityBuilder()).toMatch(/const localY = \(worldX: number, worldZ: number\)/);
    expect(cityBuilder()).toMatch(/meshHeight\(worldX, worldZ\) - baseY/);
  });

  it('стена не стоит на зашитой высоте', () => {
    // ЧТО ЗДЕСЬ БЫЛО. Проверка сторожила прежнюю стену-цилиндр: она требовала
    // `wall.position.y = wallY`, то есть одной общей отметки на всю дугу.
    // Стена переделана в 19 отдельных сегментов (§85), и общей отметки у неё
    // больше нет — у каждого сегмента своя земля под собой. Проверка осталась
    // бы красной и сторожила бы несуществующий код.
    //
    // Теперь то же требование по смыслу: высота стены не зашита, а берётся из
    // земли под точкой. Зашитая высота теперь выглядела бы иначе — числом в
    // `position.y` без обращения к рельефу.
    const body = cityBuilder();
    expect(body).not.toMatch(/wall\.position\.y = 3;/);
    expect(body).toMatch(/земляПод\(phi\) - WALL_SUNK/);
    expect(body).not.toMatch(/wall\.position\.y/);
  });

  it('башня встаёт на землю, а не на семь с половиной', () => {
    const body = cityBuilder();
    expect(body).not.toMatch(/tower\.position\.set\(tx, 7\.5, tz\)/);
    expect(body).toMatch(/tower\.position\.set\(tx, base \+ 7\.5, tz\)/);
  });

  it('стена берёт землю под каждой точкой, а не одну отметку на дугу', () => {
    // ЧТО ЗДЕСЬ БЫЛО. Стена была одной длинной дугой, и для неё бралась
    // САМАЯ НИЗКАЯ точка под всей окружностью: усреднять нельзя, тогда стена
    // в одном месте уйдёт в землю, а в другом зависнет.
    //
    // Теперь стена состоит из 19 отдельных сегментов (§85), и такая усреднённая
    // отметка стала не просто ненужной, а вредной: она приподняла бы или
    // опустила бы половину сегментов, потому что дуга идёт по радиусу 116,
    // где рельеф меняется на метры. У каждого сегмента своя земля под собой.
    //
    // Проверка на отсутствие прежней усреднённой отметки оставлена: если
    // вернуть `groundMin`, стена снова начнёт считаться от одной высоты.
    const body = cityBuilder();
    expect(body).toMatch(/const земляПод = \(phi: number\): number =>/);
    expect(body).toMatch(/localY\(CITY\.x \+ Math\.cos\(phi\) \* CITY\.radius, CITY\.z \+ Math\.sin\(phi\) \* CITY\.radius\)/);
    expect(body).not.toMatch(/groundMin/);
  });

  it('низ стены уходит в грунт, чтобы щели не было', () => {
    expect(cityBuilder()).toMatch(/WALL_SUNK/);
  });

  it('зубцы сидят на гребне стены, а не на зашитой высоте', () => {
    // ЧТО ЗДЕСЬ БЫЛО. Зубцы стояли на общей высоте стены: `wallY + wallHeight/2
    // + 0.35`. Пока стена была одной дугой, это было верно. Теперь сегментов
    // девятнадцать, и гребень кладки идёт по земле — общая отметка оставила бы
    // зубец висящим над тем сегментом, под которым рельеф ниже.
    //
    // Требование по смыслу прежнее: зубец стоит на гребне СВОЕГО сегмента.
    const body = cityBuilder();
    expect(body).not.toMatch(/CITY\.radius, 6\.35, CITY\.radius/);
    expect(body).toMatch(/земляПод\(phi\) \+ WALL_TOP \+ ЗУБЕЦ_ВЫСОТА \/ 2/);
    expect(body).not.toMatch(/wallY \+ wallHeight/);
  });
});

describe('Караваны идут, а не несутся', () => {
  it('скорость делится на настоящую длину дороги', () => {
    // ГЛАВНОЕ. Делить на отвлечённое число нельзя: длина дороги тут от 43
    // до нескольких сотен метров, а «12» означало 7 секунд на всю дорогу.
    expect(traffic).toMatch(/w\.t \+= \(w\.dir \* w\.speed \* dt\) \/ w\.len/);
    expect(traffic).not.toMatch(/dt\) \/ 12/);
  });

  it('длина дороги считается из её концов', () => {
    expect(traffic).toMatch(/function roadLength/);
    expect(traffic).toMatch(/road\.to\.x - road\.from\.x/);
    expect(traffic).toMatch(/w\.len = roadLength\(road\)/);
  });

  it('скорость не выше человеческой, иначе это снова бег', () => {
    const caravan = Number(traffic.match(/const CARAVAN_SPEED = ([\d.]+)/)?.[1]);
    const walker = Number(traffic.match(/const WALKER_SPEED = ([\d.]+)/)?.[1]);
    // Шестеро с половиной — быстрый шаг, бег начинается примерно от 4
    expect(caravan).toBeGreaterThan(0);
    expect(caravan).toBeLessThan(2.2);
    expect(walker).toBeLessThan(caravan);
  });

  it('скорость защищена от нулевой длины', () => {
    // Иначе дорога нулевой длины даёт деление на ноль и всех выбрасывает в Infinity
    expect(traffic).toMatch(/Math\.max\(1, Math\.hypot/);
  });
});

describe('Перед персонажем не бывает молочного пятна', () => {
  it('песчинка не появляется вплотную к камере', () => {
    // ГЛАВНОЕ. Точка в 0,24 единицы в четырёх метрах — это сотня пикселей
    // во весь экран, и слой рисуется поверх персонажа.
    expect(weather).toMatch(/const SAND_NEAR_R = \d+/);
    const near = Number(weather.match(/const SAND_NEAR_R = (\d+)/)?.[1]);
    expect(near).toBeGreaterThanOrEqual(10);
    expect(weather).not.toMatch(/sandRad\[i\] = 4 \+ Math\.random/);
  });

  it('подошедшая близко песчинка пересоздаётся, а не доходит до камеры', () => {
    // Порог был 3 метра — то есть песчинка успевала подойти вплотную
    expect(weather).toMatch(/if \(sandRad\[i\] < SAND_NEAR_R\)/);
    expect(weather).not.toMatch(/if \(sandRad\[i\] < 3\)/);
  });

  it('слой песка прозрачный и не пишет глубину', () => {
    // depthWrite: false — частицы не «вклиниваются» в сцену. Это правильно,
    // но именно поэтому важно, чтобы они не появлялись вплотную к камере:
    // тогда они просто перекрывают кадр. Близкая граница проверяется выше.
    const sandBlock = weather.slice(weather.indexOf('const sandMat'), weather.indexOf('const sandMat') + 220);
    expect(sandBlock).toMatch(/transparent: true/);
    expect(sandBlock).toMatch(/depthWrite: false/);
  });

  it('ореол солнца не накрывает полсцены', () => {
    // 340 единиц на 1000 метров — это около 600 пикселей при яркости 0,85
    const scale = Number(sky.match(/sunGlow\.scale\.set\((\d+)/)?.[1]);
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThanOrEqual(200);
    expect(sky).not.toMatch(/rgba\(255,236,170,0\.85\)/);
  });
});

describe('Миникарта не выглядит сломанной', () => {
  it('запасная ветка рисует хоть что-то, а не пустую сетку', () => {
    // Игрок снял «пустую тёмную сетку» и решил, что карта не работает.
    // На деле это был запасной путь на случай, когда слой не построился.
    const fallback = hud.slice(hud.indexOf('} else {'), hud.indexOf('// Сетка'));
    expect(fallback).not.toMatch(/#0a1628/);
    expect(fallback).toMatch(/fillRect\(0, 0, size, size\)/);
  });

  it('слой рельефа заполняется целиком, без дыр в альфе', () => {
    // Шаг выборки 2 пикселя, но блок 2×2 закрашивается полностью: если бы
    // закрашивался только один пиксель, половина карты осталась бы
    // прозрачной и получилась бы ровно та сетка, о которой сообщили
    const loop = hud.slice(hud.indexOf('for (let py = 0; py < sizePx; py += step)'), hud.indexOf('c.putImageData'));
    expect(loop).toMatch(/for \(let dy = 0; dy < step/);
    expect(loop).toMatch(/for \(let dx = 0; dx < step/);
    expect(loop).toMatch(/data\[i \+ 3\] = 255/);
  });
});
