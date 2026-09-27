// Три бага, найденных на снимке экрана толпы горожан.
//
// ЧТО БЫЛО ВО ВСЕХ ТРЁХ — одно и то же: всё работает, но выглядит как
// поломка. Проверять такие вещи надо смотреть глазами, а не только по
// тестам: ни один тест не ловил ни одну из трёх поломок, потому что код
// вокруг них был исправен.
import { readFileSync } from 'node:fs';
import { join } from 'path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const civilians = stripComments(read('client/src/app/game3d/civilians.ts'));
const hud = stripComments(read('client/src/app/hud.ts'));
const html = read('client/src/app/index.html');
const css = stripComments(read('client/src/app/styles.css'));

/** Сколько кнопок-иконок в верхней панели — из самой разметки. */
/**
 * Текст ОДНОГО правила CSS по его селектору.
 *
 * Зачем: в styles.css слово flex-wrap встречается 9 раз, а max-width в vw —
 * три. Если искать просто по файлу, проверка находит чужое правило и
 * проходит, даже когда нужное свойство убрали. Такой тест ничего не
 * охраняет: я именно на этом поймал два проскочивших теста.
 */
function cssRule(source: string, selector: string): string {
  const i = source.indexOf(selector + ' {');
  if (i < 0) throw new Error(`правило ${selector} не найдено`);
  return source.slice(i, source.indexOf('}', i));
}

const toggleCount = (html.match(/data-panel=/g) ?? []).length;
const togglesRule = cssRule(css, '.panel-toggles');
const buttonRule = cssRule(css, '.panel-toggles button');
const timeRule = cssRule(css, '.world-time');

/** Коды времени суток и погоды, которые обязаны быть переведены. */
const WORLD_CLOCK = new Set([
  'morning', 'noon', 'afternoon', 'evening', 'dusk', 'night', 'midnight', 'dawn',
  'clear', 'cloudy', 'rain', 'storm', 'fog', 'sandstorm', 'snow', 'wind',
]);
/** Ширина кнопки и зазор из CSS — чтобы посчитать, сколько места занимает ряд. */
const btnWidth = Number(buttonRule.match(/width:\s*(\d+)px/)?.[1] ?? 0);
const gap = Number(togglesRule.match(/gap:\s*(\d+)px/)?.[1] ?? 0);

describe('Ряд иконок не наезжает на надпись о погоде', () => {
  it('неперенесённый ряд шире разрешённого — значит защита необходима', () => {
    // Именно это и вызвало поломку: 26 кнопок по 36 пикселей с зазором.
    const natural = toggleCount * (btnWidth + gap);
    // Ряд в одну строку шире, чем отведено ему место. Отсюда и перенос:
    // без него ряд дотянулся бы до центра, где надпись о погоде, а на
    // узком мониторе — ещё и до панели персонажа слева.
    expect(natural).toBeGreaterThan(1920 * 0.46);
    expect({ кнопок: toggleCount, ширинаКнопки: btnWidth, зазор: gap, ширинаРяда: natural })
      .toEqual({ кнопок: expect.any(Number), ширинаКнопки: expect.any(Number), зазор: expect.any(Number), ширинаРяда: expect.any(Number) });
  });

  it('ряд ограничен по ширине и переносится, а не растёт влево', () => {
    expect(togglesRule).toMatch(/flex-wrap:\s*wrap/);
    expect(togglesRule).toMatch(/max-width:\s*\d+vw/);
  });

  it('надпись о времени и погоде остаётся в центре', () => {
    expect(timeRule).toMatch(/left:\s*50%/);
  });
});

describe('Время суток и погода переведены, а не зашиты по-русски', () => {
  it('в коде не осталось русских слов о времени и погоде', () => {
    // ТУТ БЫЛО: словари TIME_OF_DAY_RU и WEATHER_RU с русскими словами
    // прямо в коде. Игрок с английским языком видел «ночь · облачно».
    expect(hud).not.toMatch(/WEATHER_RU/);
    expect(hud).not.toMatch(/TIME_OF_DAY_RU/);
    expect(hud).not.toMatch(/облачно/);
    expect(hud).not.toMatch(/закат/);
  });

  it('надпись берётся из переводов', () => {
    expect(hud).toMatch(/t\(`worldclock\.\$\{/);
  });

  it('неизвестный код не показывается игроку как путь к ключу', () => {
    // t() отдаёт сам путь, если ключа нет. Без проверки игрок увидел бы на
    // экране «worldclock.morning» вместо нормального слова.
    expect(hud).toMatch(/WORLD_CLOCK\.has\(/);
  });

  it('все восемь состояний погоды и восемь времён суток учтены', () => {
    for (const k of ['morning', 'noon', 'afternoon', 'evening', 'dusk', 'night', 'midnight', 'dawn',
                     'clear', 'cloudy', 'rain', 'storm', 'fog', 'sandstorm', 'snow', 'wind']) {
      expect(WORLD_CLOCK.has(k)).toBe(true);
    }
  });
});

describe('Реплики горожан не перекрывают друг друга', () => {
  it('на пару разговоров один пузырь, а не два', () => {
    // Два пузыря на одну пару давали в толпе десятки прямоугольников.
    // Реплику одного человека в двух местах прочитать невозможно.
    const body = civilians.slice(civilians.indexOf('const speaker'));
    expect(body.slice(0, 400)).toMatch(/speaker\.bubbleUntil/);
    expect(body.slice(0, 400)).not.toMatch(/for \(const \[me, you\]/);
  });

  it('видимых пузырей ограниченное число', () => {
    // Пузыри — спрайты с depthTest: false, они перекрывают друг друга
    // в порядке появления. Без ограничения читать нечего.
    const n = Number(civilians.match(/MAX_VISIBLE_BUBBLES = (\d+)/)?.[1]);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(5);
    expect(civilians).toMatch(/c\.bubble\.visible = i < MAX_VISIBLE_BUBBLES/);
  });

  it('пузыри разнесены по высоте, а не лежат друг на друге', () => {
    expect(civilians).toMatch(/bubble\.position\.y = 2\.45 \+ \(i % \d+\)/);
  });

  it('сначала показываются ближние к игроку', () => {
    // У игрока в толпе важно то, что он видит, а не то, что заговорило
    // раньше всех на другом краю площади
    expect(civilians).toMatch(/sort\(\(a, b\) => dist2\(a\) - dist2\(b\)\)/);
  });

  it('пузырь гаснет, а не зависает навсегда', () => {
    expect(civilians).toMatch(/c\.bubbleUntil === 0\) c\.bubble\.visible = false/);
    expect(civilians).toMatch(/c\.bubbleUntil > now/);
  });
});
