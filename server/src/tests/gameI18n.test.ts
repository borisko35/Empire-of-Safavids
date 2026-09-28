// Панели игры: переводы и запрет хардкода.
//
// ЗА ЧТО БОРЕТСЯ. В панелях было ~375 русских строк мимо переводчика, и
// игрок с английским языком видел смесь английского и русского: словарь
// подставлялся только в те строки, где автор помнил про t(). Теперь
// хардкода не осталось, и тест не даёт его вернуть.
//
// ДВЕ ПРОВЕРКИ:
//  1) каждый ключ, на который ссылается panels.ts, должен переводиться
//     НАСТОЯЩЕЙ функцией t() из client/src/app/i18n.ts во всех трёх языках;
//  2) в panels.ts не должно остаться ни одной строки с кириллицей —
//     всё идёт через словарь (счётчик растёт только вниз).
//
// t() проверяем импортом из клиентского кода, а не своей копией: именно
// такая функция работает у игрока, и именно её особенность (не нашла
// ключ — вернуть путь) и ловит тест.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { t, loadLocale } from '../../../client/src/app/i18n';

declare global {
  // Окружение браузера, которое i18n.ts трогает в loadLocale(). Типы
  // описаны здесь, потому что серверный tsconfig живёт без DOM-либы, а
  // подмены значения подставляются ниже перед вызовом настоящего кода.
  interface Document {
    documentElement: { lang: string };
    querySelectorAll<T>(selectors: string): Iterable<T>;
  }
  interface HTMLElement {
    textContent: string | null;
    dataset: Record<string, string>;
  }
  interface HTMLInputElement extends HTMLElement {
    placeholder: string;
  }
  interface Navigator {
    language: string;
  }
  // eslint-disable-next-line no-var, @typescript-eslint/no-explicit-any
  var document: Document;
  // eslint-disable-next-line no-var, @typescript-eslint/no-explicit-any
  var navigator: Navigator;
  // eslint-disable-next-line no-var, @typescript-eslint/no-explicit-any
  var localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
}

const repoRoot = join(__dirname, '..', '..', '..');
const PANELS_PATH = join(repoRoot, 'client/src/app/panels.ts');
const LOCALES = ['ru', 'en', 'az'] as const;

// ── разбор panels.ts настоящим парсером TypeScript ───────────
const src = readFileSync(PANELS_PATH, 'utf-8');
const sf = ts.createSourceFile(PANELS_PATH, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const literals: { line: number; raw: string }[] = [];
const usedKeys: { line: number; key: string }[] = [];

function walk(node: ts.Node): void {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  ) {
    const start = node.getStart(sf);
    const raw = src.slice(start + 1, node.getEnd() - 1);
    literals.push({ line: sf.getLineAndCharacterOfPosition(start).line + 1, raw });
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
    const arg = node.arguments[0];
    if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
      const line = sf.getLineAndCharacterOfPosition(arg.getStart(sf)).line + 1;
      usedKeys.push({ line, key: arg.text });
    }
  }
  ts.forEachChild(node, walk);
}
walk(sf);

const KEYS = [...new Set(usedKeys.map((k) => k.key))];
const withCyrillic = literals.filter((l) => /[А-Яа-яЁё]/.test(l.raw));

// ── заглушки браузерного окружения для настоящего loadLocale ─
(globalThis as { fetch?: unknown }).fetch = async (url: string): Promise<unknown> => {
  const file = join(repoRoot, 'shared/locales', String(url).split('/').pop() ?? '');
  return {
    ok: true,
    json: async () => JSON.parse(readFileSync(file, 'utf-8')) as unknown,
  };
};
globalThis.localStorage = { getItem: () => null, setItem: () => undefined };
globalThis.document = {
  documentElement: { lang: '' },
  querySelectorAll: () => [],
} as unknown as Document;

describe('Панели: сканирование не вхолостую', () => {
  it('в panels.ts найдено больше 1000 строковых литералов', () => {
    expect(literals.length).toBeGreaterThan(1000);
  });

  it('найдено больше 150 вызовов t()', () => {
    expect(usedKeys.length).toBeGreaterThan(150);
    expect(KEYS.length).toBeGreaterThan(150);
  });
});

describe('Панели: хардкода русских строк не осталось', () => {
  it('строк с кириллицей в panels.ts — 0', () => {
    // Ратчет: значение может только уменьшаться. Появилась строка вида
    // 'Купить' — тест упадёт, пока её не уберут в словарь.
    const shown = withCyrillic.slice(0, 10).map((l) => `${l.line}: ${l.raw.slice(0, 60)}`);
    expect({ count: withCyrillic.length, shown }).toEqual({ count: 0, shown: [] });
  });
});

describe('Панели: настоящий t() переводит каждый ключ', () => {
  for (const lang of LOCALES) {
    it(`${lang} — t() нашёл все ключи панелей`, async () => {
      await loadLocale(lang);
      // t() при отсутствии ключа возвращает сам путь — это и есть провал.
      const missing = KEYS.filter((key) => t(key) === key || t(key).trim() === '');
      expect({ lang, total: KEYS.length, missing }).toEqual({ lang, total: KEYS.length, missing: [] });
    });
  }

  it('t() действительно переводит, а не возвращает путь (для переведённого ключа)', async () => {
    await loadLocale('ru');
    const translated = KEYS.filter((key) => t(key) !== key);
    // Проверка нехолостотности: если бы словарь не подставлялся, тут было 0.
    expect(translated.length).toBe(KEYS.length);
  });

  it('отсутствующий ключ отдаёт путь — так работает настоящая t()', async () => {
    await loadLocale('ru');
    expect(t('нет.такого.ключа')).toBe('нет.такого.ключа');
  });
});
