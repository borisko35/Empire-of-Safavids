// Камера и стены (§369): плавное смещение при упоре, отдаление снаружи.
//
// ЗА ЧТО БОРЕТСЯ. Камера стояла на полной дистанции и ВЫТАЛКИВАЛАСЬ из
// коллайдеров: у стены она прыгала кадром — то за стеной, то у носа, — а в
// интерьерах 22-метровых комнат неизменно упиралась в дальнюю стену и
// загораживала вид. Владелец просил ровно это: «плавное смещение при упоре
// в стену, отдаление на открытых местах».
//
// ЧТО ТЕПЕРЬ. Луч от игрока к желаемой точке сэмплируется по статичным
// стенам; найденный потолок — ЦЕЛЬ, а фактическая дистанция доезжает
// экспоненциально: стена не дёргает камеру кадром, исчезновение стены не
// выстреливает её обратно. В интерьерах у цели потолок 5 м. Железная
// страховка resolveCollisions остаётся после сглаживания.
//
// ПОЧЕМУ ПРОВЕРКА ПО ИСХОДНИКУ. Камера — чистый клиентский рендер: запустить
// её без браузера нечем. Как и соседние проверки (dodgeFeel, civiliansNight),
// сторож требует в живом коде решений, из которых складывается механика, и
// падает при вычищении любого из них.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const мир = stripComments(readFileSync(join(repoRoot, 'client/src/app/game3d/world3d.ts'), 'utf-8'));

function число(шаблон: RegExp, что: string): number {
  const найдено = мир.match(шаблон);
  if (!найдено) throw new Error(`не нашёл ${что}: проверка считала бы не то, что в игре`);
  return Number(найдено[1]);
}

describe('Луч камеры: сэмплирование по статичным стенам', () => {
  it('шаг луча меньше диаметра камеры: стена не проскочит', () => {
    const шаг = число(/const CAMERA_SAMPLE_STEP = ([\d.]+);/, 'шаг сэмплирования');
    expect(шаг).toBeGreaterThan(0);
    expect(шаг).toBeLessThanOrEqual(0.7);
  });

  it('луч начинается вне персонажа', () => {
    const мин = число(/const CAMERA_SAMPLE_MIN = ([\d.]+);/, 'минимальная дистанция');
    expect(мин).toBeGreaterThanOrEqual(1);
    expect(мин).toBeLessThan(2);
  });

  it('движущиеся не загораживают: только статичные стены', () => {
    // Звери и горожане движутся — камера, дёргающаяся от каждого прохожего,
    // хуже стены. Три списка: мир, интерьер, карман.
    const метод = мир.slice(мир.indexOf('private камераЗакрыта'), мир.indexOf('private разрешённаяДистанция'));
    expect(метод).toMatch(/COLLIDERS, INTERIOR_COLLIDERS, POCKET_COLLIDERS/);
    expect(метод).not.toMatch(/FAUNA_COLLIDERS|CIV_COLLIDERS/);
  });

  it('быстрый путь: свободная желаемая точка не идёт по лучу', () => {
    const метод = мир.slice(мир.indexOf('private разрешённаяДистанция'), мир.indexOf('private resolveCollisions'));
    // Проверка полной дистанции стоит ДО цикла сэмплирования.
    const быстрая = метод.indexOf('if (!this.камераЗакрыта(');
    const цикл = метод.indexOf('for (let d =');
    expect(быстрая).toBeGreaterThan(-1);
    expect(цикл).toBeGreaterThan(быстрая);
  });
});

describe('Потолок в интерьерах и сглаживание', () => {
  it('в интерьерах дистанция прижата к потолку', () => {
    const потолок = число(/const CAMERA_INDOOR_MAX = ([\d.]+);/, 'потолок интерьеров');
    expect(потолок).toBeGreaterThanOrEqual(4);
    expect(потолок).toBeLessThanOrEqual(6);
    expect(мир).toMatch(/inside \? Math\.min\(желаемая, CAMERA_INDOOR_MAX\) : желаемая/);
  });

  it('фактическая дистанция доезжает экспоненциально, а не прыгает', () => {
    const скорость = число(/const CAMERA_PULL_RATE = ([\d.]+);/, 'скорость сглаживания');
    expect(скорость).toBeGreaterThan(3);
    expect(скорость).toBeLessThanOrEqual(20);
    expect(мир).toMatch(/this\.distCurrent \+= \(разрешено - this\.distCurrent\) \* скорость/);
    // Позиция считается от ФАКТИЧЕСКОЙ дистанции, а не от желаемой.
    expect(мир).toMatch(/Math\.sin\(this\.pitch\) \* this\.distCurrent/);
    expect(мир).not.toMatch(/Math\.sin\(this\.pitch\) \* this\.dist\)/);
  });

  it('колесо и настройки управляют желаемой, а не фактической', () => {
    // Сдвиг фактической в колесе означал бы мгновенный прыжок мимо сглаживания.
    expect(мир).toMatch(/this\.dist \+ e\.deltaY \* 0\.008/);
    expect(мир).toMatch(/this\.dist = Math\.min\(15, Math\.max\(3\.2, dist\)\)/);
  });

  it('страховка коллайдеров остаётся после сглаживания', () => {
    // stripComments убирает комментарии — срезаем по живому коду.
    const камера = мир.slice(мир.indexOf('this.distCurrent +='), мир.indexOf('this.camera.rotateZ'));
    expect(камера).toMatch(/resolveCollisions\(cam, CAMERA_R\)/);
    const страховка = камера.indexOf('resolveCollisions(cam, CAMERA_R)');
    const lookAt = камера.indexOf('lookAt(');
    expect(страховка).toBeGreaterThan(-1);
    expect(страховка).toBeLessThan(lookAt);
  });
});
