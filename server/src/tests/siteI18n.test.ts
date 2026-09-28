// Страница сайта и её переводы.
//
// ТУТ БЫЛА СЛОМАНА КНОПКА «Установить на Windows». Она вела на
// /download/installer, а сервер отдавал 404: файл монтировался в контейнер
// как /app/server/site/install, а искался по /app/site/install. Кнопка
// нажималась и ничего не происходило, а рядом стоял текст про ярлыки,
// «Установку и удаление программ» и Node.js 18+ для игрока.
//
// Кнопку и блок убрали. Этот тест защищает от повтора в обе стороны:
//  1) нельзя оставить ссылку на ключ, которого нет в переводах;
//  2) наборы ключей во всех трёх языках должны совпадать;
//  3) нельзя обещать на сайте то, чего в игре нет.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

type Dict = Record<string, unknown>;

function locale(lang: string): Dict {
  return JSON.parse(read(`shared/locales/${lang}.json`)) as Dict;
}

/** Все ключи словаря в виде «a.b.c» */
function keys(d: Dict, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...keys(v as Dict, path));
    else out.push(path);
  }
  return out;
}

function lookup(d: Dict, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (node, p) => (node == null ? undefined : (node as Dict)[p]),
    d,
  );
}

/** Все html-файлы страниц */
function htmlFiles(): string[] {
  const roots = ['client/web', 'client/src/app'];
  const out: string[] = [];
  for (const root of roots) {
    const walk = (dir: string): void => {
      let items: string[];
      try { items = readdirSync(join(repoRoot, dir)); } catch { return; }
      for (const name of items) {
        const rel = `${dir}/${name}`;
        if (statSync(join(repoRoot, rel)).isDirectory()) walk(rel);
        else if (name.endsWith('.html')) out.push(rel);
      }
    };
    walk(root);
  }
  return out;
}

const LOCALES = ['ru', 'en', 'az'] as const;
const DICTS: Record<string, Dict> = Object.fromEntries(LOCALES.map((l) => [l, locale(l)]));
const PAGES = htmlFiles();

describe('Сайт: страницы найдены', () => {
  it('сканируется хотя бы одна страница (иначе проверки ниже вхолостую)', () => {
    expect(PAGES.length).toBeGreaterThan(3);
  });
});

describe('Сайт: каждая ссылка на перевод существует', () => {
  // ГЛАВНЫЙ ТЕСТ ФАЙЛА. Ключ удалили из переводов, а ссылку на него в
  // разметке забыли — игрок видел пустую кнопку. Проверяем каждую
  // страницу и каждый язык.
  for (const page of PAGES) {
    for (const lang of LOCALES) {
      it(`${page} — все data-i18n есть в ${lang}`, () => {
        const html = read(page);
        const refs = [
          ...html.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g),
        ].map((m) => m[1]);
        const missing = refs
          .filter((k) => !k.includes('{{'))
          .filter((k) => lookup(DICTS[lang], k) === undefined);
        expect({ page, lang, missing }).toEqual({ page, lang, missing: [] });
      });
    }
  }
});

describe('Сайт: кнопки не ведут в никуда', () => {
  for (const page of PAGES) {
    it(`${page} — нет ссылки на удалённый установщик`, () => {
      const html = read(page);
      expect(html).not.toMatch(/\/download\/installer/);
    });
  }

  it('на главной странице есть путь в игру', () => {
    // Кнопку установки убрали — должна остаться кнопка «Играть»
    const html = read('client/web/index.html');
    expect(html).toMatch(/href="\/game\/"/);
    expect(html).toMatch(/data-i18n="menu\.play"/);
  });

  it('якорь #download нигде не остался (секции больше нет)', () => {
    for (const page of PAGES) {
      expect(read(page)).not.toMatch(/href="#download"/);
    }
  });
});

describe('Сайт: наборы ключей во всех языках идентичны', () => {
  it('ru = en = az', () => {
    const ru = keys(DICTS.ru).sort();
    for (const lang of ['en', 'az']) {
      const other = keys(DICTS[lang]).sort();
      const onlyRu = ru.filter((k) => !other.includes(k));
      const onlyOther = other.filter((k) => !ru.includes(k));
      expect({ lang, onlyRu, onlyOther }).toEqual({ lang, onlyRu: [], onlyOther: [] });
    }
    expect(ru.length).toBeGreaterThan(500);
  });
});

describe('Сайт: обещания соответствуют игре', () => {
  it('на сайте не обещают установку того, чего нет', () => {
    const text = LOCALES.map((l) => JSON.stringify(DICTS[l])).join(' ');
    // Установщик не работает, и обещать его нельзя
    expect(text).not.toMatch(/Node\.js/);
    expect(text).not.toMatch(/Установке и удалении программ|Tətbiqlər v? imkanlar|Apps & features/);
  });

  it('вместо установки предлагается игра в браузере', () => {
    for (const lang of LOCALES) {
      expect(lookup(DICTS[lang], 'site.play_free_title')).toBeTruthy();
      expect(lookup(DICTS[lang], 'site.play_free_desc')).toBeTruthy();
      expect(lookup(DICTS[lang], 'site.play_free_note')).toBeTruthy();
    }
  });

  it('удалённые ключи скачивания действительно удалены', () => {
    for (const lang of LOCALES) {
      for (const key of [
        'menu.download',
        'site.download_title',
        'site.download_desc',
        'site.download_steps',
        'site.requirements',
      ]) {
        expect({ lang, key, present: lookup(DICTS[lang], key) !== undefined })
          .toEqual({ lang, key, present: false });
      }
    }
  });
});
