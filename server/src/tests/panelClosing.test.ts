// Панели не закрывались, накрывали друг друга, и у них не было ни кнопки
// выхода, ни реакции на Esc.
//
// ЧТО БЫЛО. Игрок сообщил: «они не закрываются и не исчезают с поля экрана, а
// закрывают другие панели. То есть у них нет кнопок выхода и клавиши отмены-Esc».
// Проверено в браузере на проде — порядок панелей после кликов по кнопкам:
//
//   клик по хабу        → открыта [хаб]
//   клик по сумке       → открыты [сумка, хаб]
//   клик по задачам     → открыты [задачи, сумка, хаб]
//
// Три панели друг на друге. Причина три:
//   1. openPanelById снимал класс hidden со своей панели и ничего не закрывал.
//   2. Кнопки «×» не было ни у одной из 37 панелей (в разметке — ноль).
//   3. Esc переключал меню, но панели не трогал: строка `} else if (e.code ===
//      'Escape')` уходила в overlay-menu и всё.
//
// Ни один прежний тест этого не ловил: panelHub.test.ts проверяет, что
// панели ЕСТЬ и что у них есть загрузчики, но не проверяет, что они
// закрываются. Панель может быть на месте, подписана, переведена, с
// загрузчиком — и при этом быть неуправляемой.
//
// Тесты ниже гоняют НАСТОЯЩИЕ функции из world.ts на подставном document
// (см. helpers/extractFn). Правка в их теле ломает тест; копия логики в тесте
// не ломалась бы никогда.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';
import { buildRunner } from './helpers/extractFn';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const world = stripComments(read('client/src/app/world.ts'));
const hub = stripComments(read('client/src/app/hub.ts'));
const css = read('client/src/app/styles.css');

/** Минимальный document: всё, чего касаются функции работы с панелями */
function fakeDom(ids: string[]): {
  document: unknown;
  open: () => string[];
  buttons: Map<string, Set<string>>;
} {
  const buttons = new Map<string, Set<string>>();
  const el = (id: string) => {
    const cls = new Set<string>(['hud', 'side-panel', 'hidden']);
    return {
      id,
      classList: {
        add: (...c: string[]) => c.forEach((x) => cls.add(x)),
        remove: (...c: string[]) => c.forEach((x) => cls.delete(x)),
        contains: (c: string) => cls.has(c),
      },
    };
  };
  const nodes = new Map(ids.map((id) => [id, el(id)]));
  for (const id of ids) buttons.set(id, new Set<string>());
  const document = {
    getElementById: (id: string) => nodes.get(id) ?? null,
    querySelectorAll: (sel: string) =>
      sel.includes('side-panel') ? ids.map((id) => nodes.get(id)) : [],
    // Кнопка в ряду — интересует только класс active
    querySelector: (sel: string) => {
      const m = /data-panel="([^"]+)"/.exec(sel);
      if (!m) return null;
      const active = buttons.get(m[1])!;
      return {
        classList: {
          add: (c: string) => active.add(c),
          remove: (c: string) => active.delete(c),
          contains: (c: string) => active.has(c),
        },
      };
    },
  };
  return { document, open: () => ids.filter((id) => !nodes.get(id)!.classList.contains('hidden')), buttons };
}

const IDS = ['panel-hub', 'panel-inventory', 'panel-quests', 'panel-regions'];

/** Настоящие функции панели + заглушки-регистры вместо загрузчиков */
function panelApi(document: unknown) {
  const calls: string[] = [];
  const rec = (name: string) => (..._a: never[]) => { calls.push(name); };
  const run = buildRunner(
    world,
    ['allPanels', 'openPanelById', 'closePanel', 'closeAllPanels', 'togglePanel'],
    {
      loadInventory: rec('loadInventory'),
      loadQuests: rec('loadQuests'),
      refreshQuestPanelJ: rec('refreshQuestPanelJ'),
      loadRegions: rec('loadRegions'),
      loadPanelContent: rec('loadPanelContent'),
      onTutorialAction: rec('onTutorialAction'),
    },
  );
  return { api: run(document as never), calls };
}

describe('Панель открывается поверх других, а не поверх них же', () => {
  it('открытие новой панели закрывает прежние', () => {
    // ГЛАВНАЯ ОШИБКА. Повторяю ровно тот порядок кликов, которым игрок
    // довёл экран до трёх панелей друг на друге.
    const dom = fakeDom(IDS);
    const { api } = panelApi(dom.document);
    api.openPanelById('panel-hub' as never);
    expect(dom.open()).toEqual(['panel-hub']);
    api.openPanelById('panel-inventory' as never);
    expect({ после_сумки: dom.open() }).toEqual({ после_сумки: ['panel-inventory'] });
    api.openPanelById('panel-quests' as never);
    expect({ после_задач: dom.open() }).toEqual({ после_задач: ['panel-quests'] });
  });

  it('открытой панели можно коснуться ещё раз — и она закроется', () => {
    const dom = fakeDom(IDS);
    const { api } = panelApi(dom.document);
    api.togglePanel('panel-quests' as never);
    expect(dom.open()).toEqual(['panel-quests']);
    api.togglePanel('panel-quests' as never);
    expect(dom.open()).toEqual([]);
  });

  it('переключение другой панели убирает прежнюю', () => {
    const dom = fakeDom(IDS);
    const { api } = panelApi(dom.document);
    api.togglePanel('panel-hub' as never);
    api.togglePanel('panel-inventory' as never);
    expect(dom.open()).toEqual(['panel-inventory']);
  });

  it('закрытая панель гасит кнопку в ряду, а открытая — зажигает', () => {
    // Раньше кнопка оставалась подсвеченной, когда панель закрывали иначе:
    // подсветку ставил только обработчик кнопки, а hotkey и NPC-клик её не
    // трогали. Игрок видел «горит, а панели нет».
    const dom = fakeDom(IDS);
    const { api } = panelApi(dom.document);
    api.openPanelById('panel-hub' as never);
    expect(dom.buttons.get('panel-hub')!.has('active')).toBe(true);
    api.closeAllPanels();
    expect(dom.buttons.get('panel-hub')!.has('active')).toBe(false);
  });

  it('содержимое панели перезапрашивается при каждом открытии', () => {
    // Повторное открытие панели должно заново тянуть данные: кнопка в ряду
    // раньше делала только classList.toggle и показывала прошлый рисунок.
    const dom = fakeDom(IDS);
    const { api, calls } = panelApi(dom.document);
    api.openPanelById('panel-inventory' as never);
    api.closeAllPanels();
    api.openPanelById('panel-inventory' as never);
    expect(calls.filter((c) => c === 'loadInventory').length).toBe(2);
    expect(calls.filter((c) => c === 'loadPanelContent').length).toBe(2);
  });

  it('несуществующей панели открытие не ломает', () => {
    const dom = fakeDom(IDS);
    const { api } = panelApi(dom.document);
    expect(() => api.openPanelById('panel-нет-такой' as never)).not.toThrow();
    expect(dom.open()).toEqual([]);
  });
});

describe('Кнопка в ряду открывает панель один раз, а не два', () => {
  /** Кусок обработчика кнопок в ряду — как он есть в коде */
  const handler = /for \(const btn of document\.querySelectorAll<HTMLButtonElement>\('\.panel-toggles button'\)\) \{[\s\S]*?\n {2}\}/.exec(world)?.[0];

  it('обработчик найден (иначе проверки ниже вхолостую)', () => {
    expect(typeof handler).toBe('string');
  });

  it('содержимое не грузится второй раз', () => {
    // ГЛАВНОЕ. togglePanel уходит в openPanelById, а тот уже вызывает и
    // список, и loadPanelContent. Второй вызов в обработчике запускал ту же
    // асинхронную загрузку параллельно, и содержимое выводилось дважды:
    // в панели квестов было 16 карточек вместо 8, в задачах дня — две
    // одинаковые таблицы. Нашлось на скриншоте для лендинга.
    for (const loader of ['loadPanelContent', 'loadQuests', 'loadInventory', 'loadRegions']) {
      expect({ loader, встречается: new RegExp(`\\b${loader}\\(`).test(handler ?? '') })
        .toEqual({ loader, встречается: false });
    }
  });

  it('открытие идёт через togglePanel — он умеет и закрывать', () => {
    // Возврат к прямому openPanelById сломал бы повторный клик: панель
    // не закрывалась бы, а кнопка не гасилась
    expect(handler).toMatch(/togglePanel\(panel\)/);
    expect(handler).not.toMatch(/openPanelById\(/);
  });

  it('openPanelById по-прежнему грузит содержимое — один раз за открытие', () => {
    // Правка не должна была убрать загрузку altogether: с пустой панелью
    // игрок увидит, что данные не приходят
    const dom = fakeDom(IDS);
    const { api, calls } = panelApi(dom.document);
    api.togglePanel('panel-quests' as never);
    expect(calls.filter((c) => c === 'loadQuests').length).toBe(1);
    expect(calls.filter((c) => c === 'loadPanelContent').length).toBe(1);
  });
});

describe('Esc закрывает панель, а не открывает поверх неё меню', () => {
  it('Esc сперва закрывает открытые панели', () => {
    // Раньше обработчик шёл прямо в overlay-menu. Панель оставалась на
    // экране, а меню открывалось поверх — то есть панель по-прежнему было
    // нечем снять.
    expect(world).toMatch(/e\.code === 'Escape'\)[\s\S]{0,400}closeAllPanels\(\) > 0\) return;/);
  });

  it('закрыв панели, Esc уже не трогает меню', () => {
    // Иначе игрок нажимает Esc, чтобы убрать панель, и вместо этого получает
    // меню — а панель остаётся.
    //
    // Якорь — строка проверки настроек: она есть только в нужной ветке Esc.
    // Простой indexOf('Escape') попадал в ВТОРУЮ ветку, ветку катсцены, где
    // Esc пропускает заставку, — и проверка смотрела не туда.
    const anchor = world.indexOf("!$('overlay-settings')?.classList.contains('hidden')");
    expect(anchor).toBeGreaterThan(-1);
    const branch = world.slice(anchor, anchor + 500);
    const closeAt = branch.indexOf('closeAllPanels()');
    const menuAt = branch.indexOf('overlay-menu');
    expect({ порядок: closeAt >= 0 && menuAt > closeAt }).toEqual({ порядок: true });
  });

  it('closeAllPanels возвращает число закрытых — на этом держится Esc', () => {
    // Если бы возвращала void, условие `> 0` было бы всегда ложным и Esc
    // вёл бы себя как раньше, тихо и неправильно.
    const dom = fakeDom(IDS);
    const { api } = panelApi(dom.document);
    api.openPanelById('panel-hub' as never);
    api.openPanelById('panel-quests' as never);
    expect(api.closeAllPanels() as unknown as number).toBe(1);
    expect(api.closeAllPanels() as unknown as number).toBe(0);
  });
});

describe('У панели есть кнопка выхода', () => {
  it('крестик ставится в каждую панель скриптом, а не в разметке', () => {
    // Кнопок в разметке не было ни одной. Ставить их в 37 панелей руками —
    // значит забыть в тридцать восьмой, поэтому ставит скрипт.
    expect(world).toMatch(/function installPanelCloseButtons\(\)/);
    expect(world).toMatch(/panel\.className = 'panel-close'|\.className = 'panel-close'/);
    expect(world).toMatch(/panel\.prepend\(btn\)/);
  });

  it('повторный вызов не наслаивает кнопки', () => {
    // wireInput дергается при каждом входе в мир. Без проверки на
    // существующую кнопку в углу панели росла бы вторая «×» поверх первой.
    expect(world).toMatch(/if \(panel\.querySelector\(':scope > \.panel-close'\)\) continue;/);
  });

  it('крестик закрывает панель', () => {
    expect(world).toMatch(/closePanel\(panel\.id\)/);
  });

  it('установка крестиков вызывается при входе в мир', () => {
    const wire = world.slice(world.indexOf('function wireInput'));
    expect(wire.slice(0, wire.indexOf('wireSettings()'))).toMatch(/installPanelCloseButtons\(\)/);
  });

  it('подпись крестика переведена на всех трёх языках', () => {
    // aria-label берётся из переводов: без него закрытие недоступно с
    // клавиатуры обходом, и на нерусском языке кнопка остаётся безымянной.
    for (const lang of ['ru', 'en', 'az']) {
      const dict = JSON.parse(read(`shared/locales/${lang}.json`)) as {
        common?: Record<string, string>;
      };
      expect({ lang, close: dict.common?.close }).toEqual({ lang, close: expect.any(String) });
    }
  });

  it('крестик не уезжает при прокрутке панели', () => {
    // Панель скроллится (overflow-y: auto). Без position: absolute кнопка
    // уехала бы вверх вместе с содержимым и пропала из виду.
    const rule = css.slice(css.indexOf('.panel-close {'), css.indexOf('}', css.indexOf('.panel-close {')));
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/z-index:\s*\d/);
  });
});

describe('Хаб не показывает две одинаковые вкладки', () => {
  it('идентификаторы групп не повторяются', () => {
    // БЫЛО: две группы с id 'social' — одна с уведомлениями, вторая с
    // гильдией. В интерфейсе это две одинаковые вкладки «Общество» рядом,
    // а список панели всегда показывал уведомления: GROUPS.find() берёт
    // ПЕРВОЕ совпадение, а GROUPS[0].id — тоже 'social'.
    const groups = [...hub.matchAll(/^\s{4}id: '([a-z]+)', icon: '[a-z0-9]+',$/gm)].map(m => m[1]);
    const dupes = groups.filter((g, i) => groups.indexOf(g) !== i);
    expect({ повторов: [...new Set(dupes)] }).toEqual({ повторов: [] });
  });

  it('панели хаба не попали в две группы сразу', () => {
    const panels = [...hub.matchAll(/id: '(panel-[a-z-]+)'/g)].map(m => m[1]);
    const dupes = panels.filter((p, i) => panels.indexOf(p) !== i);
    expect({ повторов: [...new Set(dupes)] }).toEqual({ повторов: [] });
  });
});
