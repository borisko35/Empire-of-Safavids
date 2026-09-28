// Секция «Особенности» на лендинге: под переведённым заголовком пусто.
//
// ЧТО БЫЛО. Заголовок переводился во всех трёх языках, а под ним стоял пустой
// div#features-grid, на который не обращался никто. Я это починил — и починил
// неправильно: карточки собирались обращением dict.site[f.titleKey], где
// titleKey — ПОЛНЫЙ путь вроде 'site.guild_title'. Такой поиск ищет ключ с
// точкой внутри группы site и всегда даёт undefined, все шесть карточек
// отсеивались фильтром, и раздел снова остался пустым. Код при этом выглядел
// правильно, и проверка «все ключи на месте» проходила.
//
// Теперь ключи ищутся разбором пути, и тест проверяет именно РЕЗОЛЬВ каждого
// ключа на настоящем словаре, а не наличие строки в коде.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const main = read('client/web/js/main.js');
const html = read('client/web/index.html');
const css = read('client/web/css/main.css');
const icons = read('client/web/js/icons.js');

type Dict = Record<string, unknown>;
const LOCALES = ['ru', 'en', 'az'] as const;
const locale = (lang: string): Dict => JSON.parse(read(`shared/locales/${lang}.json`));

/** Ключи из массива FEATURES в main.js */
const entries = [...main.matchAll(/icon: '([a-z0-9_]+)', titleKey: '([^']+)', descKey: '([^']+)'/g)]
  .map(m => ({ icon: m[1], title: m[2], desc: m[3] }));

/**
 * Настоящая функция pick из main.js, а не её переписывание в тесте.
 *
 * ПЕРВАЯ ВЕРСИЯ ТЕСТА объявляла собственный разбор пути — правильный — и
 * спокойно проходила при сломанном коде. Проверять надо то, что реально
 * отдаётся браузеру, поэтому функция вырезается из исходника и выполняется
 * здесь. Сломается разборщик в коде — упадёт и тест.
 */
const pickSource = /function pick\(dict, path\)\s*\{[\s\S]*?\n\}/.exec(main)?.[0];
if (!pickSource) throw new Error('в main.js нет функции pick — тест не может проверить ключи');
// eslint-disable-next-line no-new-func
const pick = new Function('dict', 'path',
  `${pickSource.replace('function pick(dict, path)', 'function __pick(dict, path)')}\n  return __pick(dict, path);`
) as (dict: unknown, path: string) => unknown;

describe('Секция «Особенности» заполнена', () => {
  it('в main.js есть карточки', () => {
    expect({ карточек: entries.length }).toEqual({ карточек: 6 });
  });

  it('ГЛАВНОЕ: каждый ключ РЕАЛЬНО находится в словаре', () => {
    // Прошлый чек смотрел, что строка ключа есть в коде, — и проходил при
    // неработающем поиске. Здесь ключ разрешается в настоящем словаре.
    const broken: string[] = [];
    for (const lang of LOCALES) {
      const dict = locale(lang);
      for (const e of entries) {
        const title = pick(dict, e.title);
        const desc = pick(dict, e.desc);
        if (typeof title !== 'string' || !title) broken.push(`${lang}: ${e.title}`);
        if (typeof desc !== 'string' || !desc) broken.push(`${lang}: ${e.desc}`);
      }
    }
    expect({ не_найдено: broken }).toEqual({ не_найдено: [] });
  });

  it('поиск идёт разбором пути, а не обращением внутрь группы', () => {
    // Ровно та ошибка, что дала пустую секцию: dict.site['site.x']
    expect(main).not.toMatch(/dict\.site\[f\./);
    expect(main).toMatch(/function pick\(dict, path\)/);
    expect(main).toMatch(/path\.split\('\.'\)\.reduce/);
  });

  it('описание фичи — не подпись кнопки и не пустое состояние', () => {
    // Прежние site.* — это «Найти бой», «Нет данных о репутации», «У вас нет
    // дома». В карточке они читались бы как извинение за неработающую фичу
    const forbidden = ['pvp_find', 'reputation_none', 'house_none', 'tasks_title', 'tower_start', 'guild_create'];
    expect({ использованы_пустые_состояния: entries.filter(e => forbidden.includes(e.desc)).map(e => e.desc) })
      .toEqual({ использованы_пустые_состояния: [] });
  });

  it('описания не пустые и не слишком длинные', () => {
    // Карточка на сетке в три колонки: длинный текст растянет её по вертикали
    for (const lang of LOCALES) {
      const dict = locale(lang);
      for (const e of entries) {
        const desc = pick(dict, e.desc) as string;
        expect({ lang, ключ: e.desc, длина: desc.length, разумно: desc.length > 10 && desc.length < 140 })
          .toEqual({ lang, ключ: e.desc, длина: expect.any(Number), разумно: true });
      }
    }
  });

  it('иконки существуют', () => {
    // В наборе сайта нет `home`, который используется в игровом интерфейсе
    const have = new Set([...icons.matchAll(/^\s*([a-z0-9_]+):/gm)].map(m => m[1]));
    expect({ отсутствуют: entries.map(e => e.icon).filter(i => !have.has(i)) })
      .toEqual({ отсутствуют: [] });
  });
});

describe('Секция «Осменности» видна на странице', () => {
  it('контейнер есть в разметке', () => {
    expect(html).toMatch(/id="features-grid"/);
  });

  it('рендер вызывается при смене языка', () => {
    // Смена языка перерисовывает всё: если забыть карточки, они останутся
    // на старом языке до перезагрузки страницы
    expect(main).toMatch(/eos:locale[\s\S]{0,200}renderFeatures\(e\.detail\)/);
  });

  it('для карточек есть стили', () => {
    for (const cls of ['feature-card', 'feature-icon', 'feature-name', 'feature-desc', 'features-grid']) {
      expect({ cls, есть_стиль: css.includes(`.${cls} {`) }).toEqual({ cls, есть_стиль: true });
    }
  });

  it('смена языка не оставляет карточки на старом языке', () => {
    // replaceChildren, а не append: повторный вызов на том же языке иначе
    // удвоил бы карточки — на каждый клик по переключателю
    expect(main).toMatch(/grid\.replaceChildren\(frag\)/);
    expect(main).not.toMatch(/grid\.append\(frag\)/);
  });
});
