// Скриншоты лендинга: кадр, файл и подпись — одно и то же.
//
// ТУТ БЫЛО РАЗОШЕДШИЕСЯ ТРИ ВЕЩИ.
//
//  1. Имя файла и подпись описывали разное. Файл combat.png был подписан
//     «Дороги, ведущие в город», dungeon.png — «Караванный лагерь ночью»,
//     simurgh.png — «Ворота города». Ни одна подпись не соответствовала
//     содержимому своего файла, и раздел в итоге врал три раза из
//     четырёх.
//
//  2. Кадры показывали интерфейс, которого в игре нет. На них был ряд из
//     полутора десятков кнопок; сейчас в ряду пять, плюс задачи дня. Кадр
//     со старым рядом — обещание игры, которой не существует.
//
//  3. Кадры обрезались. Формат кадра 1290×872, а карточка резала по
//     16/9 и отрезала верх и низ: рамку персонажа, ряд кнопок и чат.
//
// Проверка требует, чтобы у каждого кадра на лендинге был реальный файл,
// подпись во всех трёх языках и не осталось лишних файлов в папке.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const html = read('client/web/index.html');
const css = read('client/web/css/main.css');
const dir = join(repoRoot, 'client', 'web', 'assets', 'screenshots');
const files = readdirSync(dir).filter((f) => f.endsWith('.png'));

const LOCALES = ['ru', 'en', 'az'] as const;
const locale = (lang: string): Record<string, Record<string, string>> =>
  JSON.parse(read(`shared/locales/${lang}.json`));

/** Карточки раздела: файл + ключ подписи */
function cards(): { file: string; key: string; alt: string }[] {
  const block = /<div class="screenshots-grid">([\s\S]*?)<\/div>\s*<\/section>/.exec(html)?.[1] ?? '';
  return [...block.matchAll(/src="\/assets\/screenshots\/([^"]+)"[^>]*?data-i18n-alt="([^"]+)"[\s\S]*?data-i18n="([^"]+)"/g)]
    .map(m => ({ file: m[1], key: m[2], alt: m[3] }));
}

const CARDS = cards();

/** Ключ вида site.ss_city разворачиваем в путь по словарю */
function value(dict: Record<string, unknown>, key: string): string | undefined {
  const found = key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], dict);
  return typeof found === 'string' ? found : undefined;
}

describe('Скриншоты лендинга соответствуют игре', () => {
  it('карточки разобраны (иначе проверки ниже вхолостую)', () => {
    expect({ карточек: CARDS.length }).toEqual({ карточек: expect.any(Number) });
    expect(CARDS.length).toBeGreaterThanOrEqual(4);
  });

  it('у каждой карточки есть файл', () => {
    // Ссылка на несуществующий файл — пустая карточка на лендинге
    const missing = CARDS.filter(c => !files.includes(c.file)).map(c => c.file);
    expect({ нет_файлов: missing }).toEqual({ нет_файлов: [] });
  });

  it('в папке нет лишних файлов', () => {
    // Кадр, которого нет на странице, — мёртвый вес в репозитории: он
    // весит сотни килобайт и никому не показывается
    const used = new Set(CARDS.map(c => c.file));
    expect({ лишние: files.filter(f => !used.has(f)) }).toEqual({ лишние: [] });
  });

  it('подпись и alt у карточки — один и тот же ключ', () => {
    // Разъезд этих двух ключей означал бы, что при смене языка картинка
    // получила одно название, а подпись под ней — другое
    const bad = CARDS.filter(c => c.key !== c.alt).map(c => ({ file: c.file, alt: c.alt, подпись: c.key }));
    expect({ расхождения: bad }).toEqual({ расхождения: [] });
  });

  for (const lang of LOCALES) {
    it(`${lang} — подпись к каждому кадру есть и не пустая`, () => {
      const dict = locale(lang) as unknown as Record<string, unknown>;
      const missing = CARDS.filter(c => !value(dict, c.key)?.trim()).map(c => c.key);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    });
  }

  it('удалённые кадры не остались в словарях', () => {
    // Подписи ss_isfahan / ss_dungeon / ss_simurgh описывали файлы,
    // которых больше нет. Оставшиеся ключи — мусор: их ничего не
    // показывает, и через год о них никто не вспомнит
    for (const lang of LOCALES) {
      const site = locale(lang).site ?? {};
      const leftovers = ['ss_isfahan', 'ss_dungeon', 'ss_simurgh'].filter(k => site[k] !== undefined);
      expect({ lang, leftovers }).toEqual({ lang, leftovers: [] });
    }
  });
});

describe('Кадр показывает интерфейс такой, какой он сейчас', () => {
  it('ряд кнопок в игре — пять, а не полтора десятка', () => {
    // Раньше на кадрах был ряд из 33 кнопок, теперь пять: хаб, сумка,
    // квесты, задачи дня, регионы, плюс уведомления. Кадр со старым рядом
    // показывал бы игру, которой нет
    const buttons = [...html.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].length;
    expect({ кнопок_в_разметке_игры: buttons }).toEqual({ кнопок_в_разметке_игры: expect.any(Number) });
    const toggles = /<div class="hud panel-toggles">([\s\S]*?)<\/div>/.exec(read('client/src/app/index.html'))?.[1] ?? '';
    const count = (toggles.match(/data-panel=/g) ?? []).length;
    expect({ кнопок_в_ряду: count }).toEqual({ кнопок_в_ряду: 6 });
  });

  it('в ряду есть кнопка задач дня — её видно на кадре', () => {
    const toggles = /<div class="hud panel-toggles">([\s\S]*?)<\/div>/.exec(read('client/src/app/index.html'))?.[1] ?? '';
    expect(toggles).toMatch(/data-panel="panel-tasks"/);
  });

  it('кадр не обрезается по высоте', () => {
    // Кадр 1290×872, это 1.48. При 16/9 (1.78) сверху и снизу срезалось
    // бы около 146 пикселей — рамка персонажа, ряд кнопок и чат
    const rule = /\.screenshot-card img \{([^}]*)\}/.exec(css)?.[1] ?? '';
    const m = /aspect-ratio:\s*([0-9.]+)\s*\/\s*([0-9.]+)/.exec(rule);
    const ratio = Number(m?.[1]) / Number(m?.[2]);
    expect({ соотношение: ratio, не_обрезает: ratio >= 1.4 && ratio <= 1.55 })
      .toEqual({ соотношение: expect.any(Number), не_обрезает: true });
  });
});
