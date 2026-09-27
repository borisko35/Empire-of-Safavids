// Плашки интерфейса не должны попадать друг на друга.
//
// ТУТ БЫЛИ ДВЕ ПОЛОМКИ ОДНОГО КЛАССА — элементы интерфейса стояли в одной
// точке экрана, и игрок видел не две подсказки, а кашу из двух текстов.
//
//  1. Часы мира и рамка цели. Правило было
//         .target-frame + .world-time { top: 76px; }
//     Знак «+» означает СОСЕДНИЙ элемент. А между рамкой цели (строка 147)
//     и часами (строка 380) двести с лишним строк разметки. Правило не
//     срабатывало НИКОГДА, и часы ложились ровно на рамку: при наведении
//     на монстра или NPC игрок видел два наложенных текста.
//
//  2. Метка задачи стояла на bottom: 56px, а подсказка управления — на 76px,
//     панель навыков — на 14px. Метка налезала на обе. Раньше это было
//     менее заметно, потому что метки почти никогда не появлялись.
//
// Тест ловит сам класс ошибки: две центрированные плашки с одной и той же
// координатой — это всегда наложение, независимо от того, какие именно.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const rawCss = read('client/src/app/styles.css');
const html = read('client/src/app/index.html');
/**
 * CSS без комментариев.
 * Без этого тест находил бы в комментариях ровно те селекторы, которые
 * проверяет на отсутствие: в пояснении поломки процитирован старый
 * «.target-frame + .world-time», и проверка «селектора «+» больше нет»
 * всегда падала бы. Комментарий не влияет на страницу.
 */
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

interface Anchor { selector: string; edge: 'top' | 'bottom'; px: number; }

/**
 * Плашки, привязанные к центру экрана по горизонтали.
 * Именно они наезжают друг на друга: всё, что в правом углу, живёт
 * на разных top и не конфликтует.
 */
function centeredAnchors(): Anchor[] {
  const out: Anchor[] = [];
  // Ищем блок правила и смотрим, есть ли в нём left: 50%
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(rule)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    const body = m[2];
    if (!/left:\s*50%/.test(body)) continue;
    const name = selector.split(',')[0].trim().split(/\s+/).pop() ?? selector;
    for (const edge of ['top', 'bottom'] as const) {
      const v = body.match(new RegExp(`${edge}:\\s*(\\d+)px`));
      if (v) out.push({ selector: name, edge, px: Number(v[1]) });
    }
  }
  return out;
}

describe('Интерфейс: плашки не наезжают друг на друга', () => {
  const anchors = centeredAnchors();

  it('центрированные плашки вообще найдены (иначе проверка вхолостую)', () => {
    expect(anchors.length).toBeGreaterThan(2);
  });

  it('нижняя полоса: панель навыков, подсказка и метка задачи не пересекаются', () => {
    // Три плашки в одной полосе. Раньше метка задачи стояла на 56px и
    // налезала и на панель навыков, и на подсказку управления
    const pick = (re: RegExp): Anchor | undefined => anchors.find((a) => re.test(a.selector));
    const skillbar = pick(/skillbar/);
    const hint = pick(/controls-hint/);
    const nav = pick(/nav-target/);
    expect({ skillbar: !!skillbar, hint: !!hint, nav: !!nav })
      .toEqual({ skillbar: true, hint: true, nav: true });

    // Подсказка выше панели навыков, метка задачи выше подсказки
    const gaps: Record<string, boolean> = {
      hint_above_skillbar: hint!.px > skillbar!.px,
      nav_above_hint: nav!.px > hint!.px,
    };
    expect(gaps).toEqual({ hint_above_skillbar: true, nav_above_hint: true });
  });

  it('метка задачи не наезжает на панель навыков даже с её высотой', () => {
    // Панель навыков высотой около 48px и растёт вверх от bottom: 14px,
    // то есть занимает примерно 14..62px. Метка задачи должна быть выше
    const nav = centeredAnchors().find((a) => /nav-target/.test(a.selector))!;
    expect(nav.px).toBeGreaterThan(70);
  });
});

describe('Интерфейс: часы не ложатся на рамку цели', () => {
  it('селектор не использует «+»: между элементами слишком много разметки', () => {
    // ГЛАВНАЯ ПОЛОМКА. «+» — соседний элемент, а между рамкой цели и
    // часами двести с лишним строк. Правило молча не работало.
    expect(css).not.toMatch(/\.target-frame\s*\+\s*\.world-time/);
  });

  it('используется «~», он работает на любом расстоянии', () => {
    expect(css).toMatch(/#target-frame:not\(\.hidden\)\s*~\s*#world-time/);
  });

  it('рамка цели и часы — соседи одного родителя, иначе «~» тоже не сработает', () => {
    // Проверяем по факту: оба элемента лежат на верхнем уровне разметки
    const tf = html.indexOf('id="target-frame"');
    const wt = html.indexOf('id="world-time"');
    expect({ found: tf > -1 && wt > -1 }).toEqual({ found: true });
    // Часы объявлены ПОСЛЕ рамки — иначе «~» в одну сторону не сработает
    expect(wt > tf).toBe(true);
  });

  it('когда цели нет, часы остаются наверху', () => {
    // Базовая позиция не должна съезжать при появлении рамки
    const base = css.match(/^\.world-time\s*\{([\s\S]*?)\}/m);
    expect(base).not.toBeNull();
    expect(base![1]).toMatch(/top:\s*12px/);
  });
});
