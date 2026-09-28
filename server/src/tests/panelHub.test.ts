// Хаб панелей: тридцать панелей в одном ряду.
//
// ЧТО БЫЛО. В .panel-toggles висело 33 кнопки — 1218 пикселей в ряд,
// перенос на два ряда. Пользоваться можно было, найти нужную панель — нельзя:
// подписи видны только при наведении, а ряд всё время занимал угол экрана.
//
// Теперь ряд — четыре кнопки (хаб, сумка, квесты, карта), а все панели
// разложены по смыслу внутри хаба. Новая панель добавляется одной строкой.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const hub = stripComments(read('client/src/app/hub.ts'));
const html = read('client/src/app/index.html');
const css = read('client/src/app/styles.css');

/** Правило CSS по селектору: поиск по одному слову находит чужое свойство */
function cssRule(source: string, selector: string): string {
  const i = source.indexOf(selector + ' {');
  if (i < 0) throw new Error(`правило ${selector} не найдено`);
  return source.slice(i, source.indexOf('}', i));
}
const panels = stripComments(read('client/src/app/panels.ts'));
const world = stripComments(read('client/src/app/world.ts'));
const hud = stripComments(read('client/src/app/hud.ts'));
const icons = read('client/src/ui/icons.ts');

/** Панели хаба, объявленные в коде */
const hubPanels = [...hub.matchAll(/id: '(panel-[a-z-]+)'/g)].map(m => m[1]);
/** Группы хаба: строка вида `    id: 'combat', icon: 'swords',` */
const hubGroups = [...hub.matchAll(/^\s{4}id: '([a-z]+)', icon: '[a-z0-9]+',$/gm)].map(m => m[1]);

const LOCALES = ['ru', 'en', 'az'] as const;
const locale = (lang: string): Record<string, unknown> =>
  JSON.parse(read(`shared/locales/${lang}.json`));

describe('Хаб панелей: в ряд больше не насыпают панели', () => {
  it('кнопок в ряду мало, и ряд не дотягивается до центра', () => {
    // Изначально в ряду было 33 кнопки на 1218 пикселей. Сейчас их единицы.
    //
    // Проверка не на точное число: ряд пополняется по мере надобности, и
    // закреплять «4» значило бы запретить добавить кнопку уведомлений, без
    // которой игрок не видит непрочитанных. Требуемое одно: ряд остаётся
    // коротким, а его естественная ширина меньше отведённых 46vw.
    const row = html.slice(html.indexOf('class="hud panel-toggles"'));
    const buttons = (row.slice(0, row.indexOf('</div>')).match(/<button/g) ?? []).length;
    const rule = cssRule(css, '.panel-toggles');
    const buttonRule = cssRule(css, '.panel-toggles button');
    const w = Number(/width:\s*(\d+)px/.exec(buttonRule)?.[1] ?? 0);
    const gap = Number(/gap:\s*(\d+)px/.exec(rule)?.[1] ?? 0);
    const natural = buttons * (w + gap);
    expect({
      кнопок: buttons,
      естественная_ширина: natural,
      помещается: natural < 1920 * 0.46,
    }).toEqual({ кнопок: expect.any(Number), естественная_ширина: expect.any(Number), помещается: true });
    expect(buttons).toBeLessThanOrEqual(6);
  });

  it('в ряду есть кнопка хаба', () => {
    const row = html.slice(html.indexOf('class="hud panel-toggles"'));
    expect(row.slice(0, row.indexOf('</div>'))).toMatch(/data-panel="panel-hub"/);
  });

  it('иконка хаба нарисована', () => {
    // Без иконки кнопка была бы пустым квадратом
    expect(icons).toMatch(/^\s*grid: '<path/m);
  });
});

describe('Хаб панелей: все панели на месте', () => {
  it('каждая панель хаба есть в разметке', () => {
    const missing = hubPanels.filter(id => !html.includes(`id="${id}"`));
    expect({ без_разметки: missing }).toEqual({ без_разметки: [] });
  });

  it('у каждой панели есть загрузчик', () => {
    // Инвентарь, квесты и карту грузят hud.ts, журнал квестов — world.ts
    // (refreshQuestPanelJ живёт там и оттуда же открывается по клавише J),
    // остальные — panels.ts
    const elsewhere = ['panel-inventory', 'panel-quests', 'panel-regions', 'panel-quests-j'];
    const missing = hubPanels.filter(id =>
      !elsewhere.includes(id) && !panels.includes(`'${id}'`) && id !== 'panel-hub');
    expect({ без_загрузчика: missing }).toEqual({ без_загрузчика: [] });
  });

  it('ни одна панель не потеряна при переезде в хаб', () => {
    const htmlPanels = [...html.matchAll(/id="(panel-[a-z-]+)"/g)]
      .map(m => m[1])
      // Диалог и панель персонажа — не панели в хабе: диалог открывается
      // щелчком по NPC, панель персонажа — по клавише и из «Кто я»
      .filter(id => !['panel-dialog', 'panel-character', 'panel-hub'].includes(id));
    const orphan = htmlPanels.filter(id => !hubPanels.includes(id));
    expect({ забытые: orphan }).toEqual({ забытые: [] });
  });

  it('все панели разложены по группам', () => {
    // Пустая группа — вкладка, на которой ничего нет
    const empty = hubGroups.filter(g => {
      const i = hub.indexOf(`id: '${g}', icon:`);
      const j = hub.indexOf('panels: [', i);
      return !hub.slice(j, j + 400).includes('titleKey');
    });
    expect({ пустых_групп: empty }).toEqual({ пустых_групп: [] });
    expect(hubGroups.length).toBeGreaterThanOrEqual(5);
  });
});

describe('Хаб панелей: подписи переведены', () => {
  it('у каждой группы и каждой панели есть ключ', () => {
    const used = new Set([...hub.matchAll(/titleKey: 'hub\.([a-z0-9_]+)'/g)].map(m => m[1]));
    for (const g of hubGroups) used.add(g);
    for (const lang of LOCALES) {
      const dict = (locale(lang).hub ?? {}) as Record<string, string>;
      const missing = [...used].filter(k => typeof dict[k] !== 'string' || !dict[k]);
      expect({ lang, без_перевода: missing }).toEqual({ lang, без_перевода: [] });
    }
  });

  it('лишних ключей нет — словарь описывает именно эти панели', () => {
    const used = new Set([...hub.matchAll(/titleKey: 'hub\.([a-z0-9_]+)'/g)].map(m => m[1]));
    for (const g of hubGroups) used.add(g);
    for (const lang of LOCALES) {
      const dict = (locale(lang).hub ?? {}) as Record<string, string>;
      const extra = Object.keys(dict).filter(k => !used.has(k));
      expect({ lang, лишние: extra }).toEqual({ lang, лишние: [] });
    }
  });
});

describe('Хаб панелей: права сотрудников не раздаются всем', () => {
  it('панели админа и загрузки файлов помечены', () => {
    // Раньше их кнопки просто лежали в разметке скрытыми и показывались
    // через classList.toggle. В хабе они тоже скрыты: игроку без прав
    // показывать «Админ» незачем — сервер всё равно ответит 403
    expect(hub).toMatch(/panel-admin'[^\n]*staffOnly: true/);
    expect(hub).toMatch(/panel-media'[^\n]*staffOnly: true/);
  });

  it('хаб получает права от того же места, что и раньше', () => {
    // Роли повторяют серверный SITE_STAFF_ROLES, иначе кнопка была бы видна
    // кому-то, кому сервер всё равно ответит 403
    expect(world).toMatch(/setHubStaff\(isStaff\)/);
    expect(world).toMatch(/const STAFF_ROLES = \[/);
  });
});

describe('Хаб панелей: старая точка входа не сломана', () => {
  it('панель из хаба грузится сразу, а не остаётся пустой', () => {
    // Открытие идёт через world.openPanelById, а не собственным кодом хаба:
    // там список доп. загрузок, и его дублирование через месяц разъехалось бы
    expect(hub).toMatch(/openPanelById\(panelId\)/);
    expect(hub).not.toMatch(/loadInventory\(\)/);
  });

  it('все четыре панели с доп. загрузкой перечислены в одном месте', () => {
    // Инвентарь, квесты, журнал квестов и карта тянут за собой то, что им
    // нужно для отрисовки. Если этот список разъедется по файлам, одна из
    // панелей откроется пустой — и только у того, кто открыл её хоткеем
    const fn = world.slice(world.indexOf('export function openPanelById'));
    const block = fn.slice(0, fn.indexOf('\n}'));
    for (const id of ['panel-inventory', 'panel-quests', 'panel-quests-j', 'panel-regions']) {
      expect({ id, есть_в_списке: block.includes(`'${id}'`) })
        .toEqual({ id, есть_в_списке: true });
    }
  });

  it('открытие по клавише и кликом по NPC продолжает работать', () => {
    // openPanelById ищет кнопку в ряду. Часть панелей оттуда убрана, но
    // поиск должен остаться безопасным: ?. вместо обращения без проверки
    expect(world).toMatch(/openPanelById[\s\S]{0,700}\?\.classList\.add\('active'\)/);
    expect(hud).toBeTruthy();
  });

  it('хаб зарегистрирован в диспетчере панелей', () => {
    expect(panels).toMatch(/'panel-hub':/);
  });
});
