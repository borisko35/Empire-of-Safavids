// Горожане ходили за игроком по всему миру.
//
// ЧТО БЫЛО. У горожанина не было своего дома вообще. Каждый раз, когда он
// решал, куда пойти, функция freeSpot вызывалась с координатами ИГРОКА как
// центром — то есть цель выбиралась вокруг игрока. Плюс был «перенос населения
// к игроку»: если горожанин дальше 200 м, его прятали и ставили в случайную
// точку рядом с игроком.
//
// Итог, который и заметил игрок: вышел из города — двадцать два горожанина
// пошли за ним, пошёл бить мобов — они были рядом. Выглядит так, будто толпа
// привязана к игроку, и ломает ощущение живого города: ушёл — толпы нет.
//
// Проверять это пришлось в коде, а не на глаз: тестами «не призывать» не
// проверить. Ни один из прежних тестов этого не ловил — код был исправен,
// неверным был замысел.
import { readFileSync } from 'node:fs';
import { join } from 'path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const civ = stripComments(read('client/src/app/game3d/civilians.ts'));

/** Все места, где задаётся цель блуждания. */
function wanderTargets(): string[] {
  const found: string[] = [];
  const re = /freeSpot\([^)]*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(civ)) !== null) {
    // объявление самой freeSpot — не вызов, а её сигнатура с типами
    if (/^freeSpot\(cx\s*:\s*number/.test(m[0])) continue;
    found.push(m[0]);
  }
  return found;
}

describe('У горожанина есть свой дом', () => {
  it('дом хранится в данных горожанина', () => {
    expect(civ).toMatch(/homeX: number;/);
    expect(civ).toMatch(/homeZ: number;/);
  });

  it('дом выдаётся при создании и не берётся у игрока', () => {
    // Точка, на которой горожанин появился, и есть его дом.
    expect(civ).toMatch(/homeX: p\.x, homeZ: p\.z/);
  });

  it('ни одна цель блуждания не строится вокруг игрока', () => {
    // ГЛАВНОЕ. freeSpot(..., playerX, playerZ) — это ровно тот баг:
    // игрок передавался как «дом», и все шли за ним.
    const calls = wanderTargets();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).not.toMatch(/player[XYZ]/);
    }
  });

  it('уже созданный горожанин блуждает вокруг своего дома', () => {
    // freeSpot(CITY.x, CITY.z) при создании — верно: это исходная точка в
    // городе, из которой потом берётся дом. А вот вызовы уже для живущего
    // горожанина (в них есть c.) обязаны идти от его дома.
    for (const call of wanderTargets()) {
      if (!call.includes('c.group.position')) continue;
      expect(call).toMatch(/c\.homeX, c\.homeZ/);
    }
  });

  it('свой дом используется и при обычном блуждании, и при смене цели', () => {
    // Два места: обычный выбор цели и выбор новой цели у застрявшего.
    // Проверяем оба, потому что «дом = игрок» сидел в обоих.
    const uses = civ.match(/c\.homeX, c\.homeZ/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Горожане не переносятся к игроку', () => {
  it('функции подстановки рядом с игроком больше нет', () => {
    // freeSpotNear ставила горожанина в кольцо вокруг игрока. Удалена
    // вместе с переносом: оставлять мёртвый код незачем.
    expect(civ).not.toMatch(/freeSpotNear/);
  });

  it('координаты горожанина не переписываются на игровые', () => {
    // Признак переноса: позиция горожанина присваивается из точки,
    // посчитанной от координат игрока.
    expect(civ).not.toMatch(/c\.group\.position\.x = p\.x/);
    expect(civ).not.toMatch(/c\.group\.position\.z = p\.z/);
  });

  it('порог скрытия — дальше тумана, а не 200 метров', () => {
    // 200 м — это видимая дистанция: там фигурка ещё хорошо читается,
    // и прятать её значит заставить игрока смотреть на исчезающие фигурки.
    // Туман прячет на 240-850 м, поэтому 900 м — первое число, за которым
    // исчезновение не видно.
    const leash = Number(civ.match(/const LEASH = (\d+)/)?.[1]);
    expect(leash).toBeGreaterThanOrEqual(850);
  });

  it('дальняя проверка только прячет, но не двигает', () => {
    expect(civ).toMatch(/const visible = dist < LEASH && now >= c\.hiddenUntil/);
    expect(civ).toMatch(/c\.group\.visible = visible/);
  });

  it('скрытому горожанину гаснет реплика', () => {
    // Иначе в тумане висит светлый прямоугольник без человека.
    expect(civ).toMatch(/if \(!visible\) \{[\s\S]*?c\.bubble\.visible = false/);
  });
});

describe('Город остаётся живым', () => {
  it('горожан по-прежнему много, и город не опустел', () => {
    // Чинка не должна была выглядеть так, будто город вымер: это был бы
    // слишком лёгкий выход из проблемы.
    const count = Number(civ.match(/const COUNT = (\d+)/)?.[1]);
    expect(count).toBeGreaterThanOrEqual(16);
  });

  it('горожане по-прежнему болтают между собой', () => {
    // Одичавшие, молчаливые фигурки — тоже неживой город.
    expect(civ).toMatch(/const speaker = Math\.random\(\) < 0\.5 \? a : b/);
  });
});
