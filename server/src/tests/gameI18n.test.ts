// Переводы игрового клиента и запрет хардкода.
//
// ЗА ЧТО БОРЕТСЯ. В панелях было ~375 русских строк мимо переводчика, и
// игрок с английским языком видел смесь английского и русского: словарь
// подставлялся только в те строки, где автор помнил про t(). Хардкод
// убрали из панелей, затем из HUD и экрана создания персонажа, и тест не
// даёт ему вернуться.
//
// ТРИ ПРОВЕРКИ:
//  1) каждый ключ, на который ссылаются panels.ts, hud.ts и chars.ts,
//     должен переводиться НАСТОЯЩЕЙ функцией t() из client/src/app/i18n.ts
//     во всех трёх языках;
//  2) в этих файлах не должно остаться ни одной строки с кириллицей —
//     всё идёт через словарь;
//  3) в index.html русский текст виден игроку только внутри элемента с
//     data-i18n (или в комментарии / названии языка).
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
    title: string;
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
  //
  // ЗАГЛУШКА ДОЛЖНА БЫТЬ ПОЛНОЙ. Это объявление глобальное, и оно видно
  // ВСЕЙ программе, а не только этому файлу. Раньше здесь были только
  // getItem и setItem, и на этом держался весь набор: другой тест
  // (`fxCursor`) подтянул `entities.ts`, а тот — `state.ts`, где
  // `persistAuth` и `clearAuth` вызывают `localStorage.removeItem`.
  // Сборка образа падала на четырёх строках:
  //   TS2339: Property 'removeItem' does not exist on type
  //   '{ getItem(key: string): string | null; setItem(...): void; }'
  //
  // Это была не только поломка сборки, но и замаскированная ошибка
  // в рантайме: подставляемый ниже объект тоже не имел removeItem, то есть
  // любой вызов под тестом дал бы `TypeError: not a function` — и тип это
  // молча разрешал. Набор заглушек дополнен до того, что реально умеет
  // браузерный Storage.
  var localStorage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    clear(): void;
    key(index: number): string | null;
    readonly length: number;
  };
}

const repoRoot = join(__dirname, '..', '..', '..');
const LOCALES = ['ru', 'en', 'az'] as const;

// Файлы, из которых убран русский хардкод. Пороги в тестах ниже завязаны
// на эти же файлы: добавили файл — добавьте и порог, иначе проверка
// «скан не вхолостую» его не накроет.
const SOURCE_FILES = [
  'client/src/app/panels.ts',
  'client/src/app/hud.ts',
  'client/src/app/screens/chars.ts',
  'client/src/app/game3d/interiors.ts',
  'client/src/app/game3d/world3d.ts',
  'client/src/app/dialogue.ts',
  'client/src/app/cutscene.ts',
  'client/src/app/world.ts',
  'client/src/app/connectionIndicator.ts',
  'client/src/app/media.ts',
  'client/src/app/tutorial.ts',
  'client/src/app/main.ts',
] as const;
const HTML_FILE = 'client/src/app/index.html';

// ── разбор настоящим парсером TypeScript ─────────────────────
type Scan = {
  rel: string;
  literals: { line: number; raw: string }[];
  withCyrillic: { line: number; raw: string }[];
  usedKeys: { line: number; key: string }[];
  keyLike: string[];
};

// Литерал, похожий на путь перевода: 'zones.isfahan_bazaar'. Такие значения
// живут в картах (REGION_NAMES, ZONE_NAMES, SERVER_NAMES, SHOP_ITEM_NAMES) и
// попадают в t() динамически — вызов t(ZONE_NAMES[z]) парсер не разберёт,
// поэтому без этой проверки опечатка в ключе никем не была бы поймана.
const LOOKS_LIKE_KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

// Но не всякая похожая строка — ключ: localStorage.getItem('eos.locale')
// тоже проходит по маске. Смотрим только на литералы-значения из карт:
// { tabriz: 'regions.tabriz' }, константы и массивы.
function inMapContext(node: ts.Node): boolean {
  const p = node.parent;
  if (!p) return false;
  return (
    ts.isPropertyAssignment(p) ||
    ts.isPropertyDeclaration(p) ||
    ts.isVariableDeclaration(p) ||
    ts.isArrayLiteralExpression(p)
  );
}

function scan(rel: string): Scan {
  const path = join(repoRoot, rel);
  const src = readFileSync(path, 'utf-8');
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const literals: { line: number; raw: string }[] = [];
  const usedKeys: { line: number; key: string }[] = [];
  const keyLike: string[] = [];

  const walk = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const start = node.getStart(sf);
      const raw = src.slice(start + 1, node.getEnd() - 1);
      literals.push({ line: sf.getLineAndCharacterOfPosition(start).line + 1, raw });
    }
    if (ts.isTemplateExpression(node)) {
      // У ШАБЛОНА с подстановками берём ТОЛЬКО текстовые куски.
      //
      // Раньше сюда попадал весь шаблон целиком, вместе с выражениями
      // ${...}. Из-за этого любая переменная с кириллическим именем
      // внутри подстановки выглядела как «русский текст в коде»:
      //   `${t('bounty.placed')}${сумма}`  <- попадало в отчёт
      // хотя в интерфейсе показывается перевод из словаря, а «сумма» -
      // имя переменной, а не текст. Игрок с латинским интерфейсом
      // ничего русского не увидел бы.
      const start = node.getStart(sf);
      const номерСтроки = sf.getLineAndCharacterOfPosition(start).line + 1;
      const начало = node.head;
      literals.push({ line: номерСтроки, raw: начало.text });
      for (const кусок of node.templateSpans) {
        literals.push({ line: номерСтроки, raw: кусок.literal.text });
      }
    }
    if (ts.isStringLiteral(node) && LOOKS_LIKE_KEY.test(node.text) && inMapContext(node)) {
      keyLike.push(node.text);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
      const arg = node.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
        const line = sf.getLineAndCharacterOfPosition(arg.getStart(sf)).line + 1;
        usedKeys.push({ line, key: arg.text });
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);

  return {
    rel,
    literals,
    withCyrillic: literals.filter((l) => /[А-Яа-яЁё]/.test(l.raw)),
    usedKeys,
    keyLike,
  };
}

const SCANS = SOURCE_FILES.map(scan);
const KEYS = [...new Set(SCANS.flatMap((s) => s.usedKeys.map((k) => k.key)))];
// Ключи, которые в t() попадают не литералом, а значением из карты.
const DIRECT = new Set(KEYS);
const DYN_KEYS = [
  ...new Set(SCANS.flatMap((s) => s.keyLike)).values(),
].filter((k) => !DIRECT.has(k));
const ALL_LITERALS = SCANS.reduce((n, s) => n + s.literals.length, 0);
const ALL_T_CALLS = SCANS.reduce((n, s) => n + s.usedKeys.length, 0);

// ── заглушки браузерного окружения для настоящего loadLocale ─
(globalThis as { fetch?: unknown }).fetch = async (url: string): Promise<unknown> => {
  const file = join(repoRoot, 'shared/locales', String(url).split('/').pop() ?? '');
  return {
    ok: true,
    json: async () => JSON.parse(readFileSync(file, 'utf-8')) as unknown,
  };
};
// Объём localStorage внутри набора: getItem всегда null, то есть «ничего не
// сохранено», и setItem ничего не пишет. Заглушка хранится в Map, иначе
// removeItem и clear пришлось бы объявлять вслепую — а вслепую они и были
// объявлены, и это кончилось ошибкой сборки.
const хранилищеТеста = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => хранилищеТеста.get(k) ?? null,
  setItem: (k: string, v: string) => { хранилищеТеста.set(k, v); },
  removeItem: (k: string) => { хранилищеТеста.delete(k); },
  clear: () => { хранилищеТеста.clear(); },
  key: (i: number) => [...хранилищеТеста.keys()][i] ?? null,
  get length() { return хранилищеТеста.size; },
};
globalThis.document = {
  documentElement: { lang: '' },
  querySelectorAll: () => [],
} as unknown as Document;

describe('Перевод клиента: скан не вхолостую', () => {
  // Пороги ниже реальных значений: скан сломался и ничего не нашёл —
  // тест упадёт, а не «зелёнеет» на пустом наборе.
  it('в панелях больше 1000 строковых литералов', () => {
    expect(SCANS[0].literals.length).toBeGreaterThan(1000);
  });
  it('в HUD больше 400 строковых литералов', () => {
    expect(SCANS[1].literals.length).toBeGreaterThan(400);
  });
  it('в экране создания персонажа больше 90 строковых литералов', () => {
    expect(SCANS[2].literals.length).toBeGreaterThan(90);
  });
  it('каждый файл скана содержит больше 25 литералов (файл не читается — проверка ниже вхолостую)', () => {
    const empty = SCANS.filter((s) => s.literals.length <= 25).map((s) => s.rel);
    expect({ пустых: empty }).toEqual({ пустых: [] });
  });
  it('вызовов t() больше 450, ключей больше 350', () => {
    expect(ALL_T_CALLS).toBeGreaterThan(450);
    expect(KEYS.length).toBeGreaterThan(350);
    expect(ALL_LITERALS).toBeGreaterThan(3400);
  });
});

describe('Перевод клиента: хардкода русских строк не осталось', () => {
  for (const s of SCANS) {
    it(`${s.rel} — строк с кириллицей 0`, () => {
      // Ратчет: значение может только уменьшаться. Появилась строка вида
      // 'Купить' — тест упадёт, пока её не уберут в словарь.
      const shown = s.withCyrillic.slice(0, 10).map((l) => `${l.line}: ${l.raw.slice(0, 60)}`);
      expect({ file: s.rel, count: s.withCyrillic.length, shown }).toEqual({
        file: s.rel,
        count: 0,
        shown: [],
      });
    });
  }
});

describe('Перевод клиента: настоящий t() переводит каждый ключ', () => {
  for (const lang of LOCALES) {
    it(`${lang} — t() нашёл все ключи файлов`, async () => {
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

describe('Перевод клиента: ключи из карт тоже переводятся', () => {
  // Эти ключи не лежат в t('...') — они попадают в функцию через значение
  // карты (ZONE_NAMES[z] ?? z). Проверка нехолостая только при достаточном
  // количестве: нашли пару штук — значит парсер ключи не собрал.
  it('найдено больше 70 таких ключей', () => {
    expect(DYN_KEYS.length).toBeGreaterThan(70);
  });

  for (const lang of LOCALES) {
    it(`${lang} — t() нашёл все ключи карт`, async () => {
      await loadLocale(lang);
      const missing = DYN_KEYS.filter((key) => t(key) === key || t(key).trim() === '');
      expect({ lang, total: DYN_KEYS.length, missing }).toEqual({
        lang,
        total: DYN_KEYS.length,
        missing: [],
      });
    });
  }
});

// Второй эшелон переводов: серверные сущности с фиксированным id. У зоны и
// шарда имя в интерфейде берётся по id из shared/constants — добавили зону и
// забыли ключ, и игрок на английском увидит либо путь, либо русское имя с
// сервера.
describe('Перевод клиента: id зон и шардов перекрыты ключами', () => {
  const constants = readFileSync(join(repoRoot, 'shared/constants.ts'), 'utf-8');
  const ZONE_IDS = [...constants.matchAll(/\{ id: '([a-z_]+)', region: '[a-z]+', name: /g)].map(
    (m) => m[1],
  );
  const SERVER_IDS = [...constants.matchAll(/export const GAME_SERVERS[\s\S]*?\n\];/g)].flatMap(
    (m) => [...m[0].matchAll(/\{ id: '([a-z_]+)'/g)].map((x) => x[1]),
  );

  it('нашёл зоны и шарды в constants (иначе проверка вхолостую)', () => {
    expect(ZONE_IDS.length).toBeGreaterThanOrEqual(15);
    expect(SERVER_IDS.length).toBeGreaterThanOrEqual(6);
  });

  const ALL_KEYS = [
    ...ZONE_IDS.map((id) => `zones.${id}`),
    ...SERVER_IDS.map((id) => `servers.${id}`),
  ];

  for (const lang of LOCALES) {
    it(`${lang} — t() переводит имя каждой зоны и каждого шарда`, async () => {
      await loadLocale(lang);
      const missing = ALL_KEYS.filter((key) => t(key) === key);
      expect({ lang, total: ALL_KEYS.length, missing }).toEqual({
        lang,
        total: ALL_KEYS.length,
        missing: [],
      });
    });
  }
});

// ── index.html: русский текст только под data-i18n ───────────
//
// Страница собрана руками, тут нет ни литералов, ни t() — текст подставляется
// при старте из атрибута data-i18n. Значит проверка такая: вырезаем
// комментарии (в них по-русски можно, это не видит игрок), вырезаем текст
// внутри элементов с data-i18n и атрибуты, которые берёт на себя
// data-i18n-placeholder / data-i18n-title, и требуем, чтобы кириллицы
// не осталось. Названия языков (Русский / English / Azərbaycan) в селекторе
// языка намеренно остаются на своём языке.
function visibleHardcode(): { line: number; text: string }[] {
  const html = readFileSync(join(repoRoot, HTML_FILE), 'utf-8');
  // Комментарии вырезаем посимвольно, кроме переводов строк — иначе
  // номера строк в сообщении об ошибке поедут.
  const noComments = html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  const out: { line: number; text: string }[] = [];
  let inLangSelect = false;

  noComments.split('\n').forEach((line, i) => {
    if (line.includes('<select id="set-lang"')) inLangSelect = true;
    if (inLangSelect) {
      if (line.includes('</select>')) inLangSelect = false;
      return;
    }
    let s = line;
    // Текст элемента с data-i18n заменяется целиком при старте.
    s = s.replace(
      /<([a-zA-Z][^>]*\bdata-i18n(?:-placeholder|-title)?="[^"]*"[^>]*)>([^<]*)</g,
      (m, _tag: string, text: string) => m.replace(text, ' '.repeat(text.length)),
    );
    // Атрибуты, которые переводит data-i18n-placeholder / data-i18n-title.
    s = s.replace(/<[^>]*>/g, (tag) => {
      let outTag = tag;
      if (/\bdata-i18n-title="/.test(tag)) outTag = outTag.replace(/\btitle="[^"]*"/g, 'title=""');
      if (/\bdata-i18n-placeholder="/.test(tag))
        outTag = outTag.replace(/\bplaceholder="[^"]*"/g, 'placeholder=""');
      return outTag;
    });
    if (/[А-Яа-яЁё]/.test(s)) out.push({ line: i + 1, text: line.trim().slice(0, 110) });
  });
  return out;
}

const HTML_REFS = [
  ...readFileSync(join(repoRoot, HTML_FILE), 'utf-8').matchAll(
    /data-i18n(?:-placeholder|-title)?="([^"]+)"/g,
  ),
].map((m) => m[1]);

describe('index.html: русский текст виден игроку только под data-i18n', () => {
  it('видимой кириллицы без data-i18n — 0', () => {
    expect(visibleHardcode()).toEqual([]);
  });

  it('на странице больше 40 ссылок на переводы (иначе проверка вхолостую)', () => {
    expect(HTML_REFS.length).toBeGreaterThan(40);
  });

  for (const lang of LOCALES) {
    it(`${lang} — настоящий t() переводит каждый ключ index.html`, async () => {
      await loadLocale(lang);
      const missing = HTML_REFS.filter((key) => t(key) === key || t(key).trim() === '');
      expect({ lang, total: HTML_REFS.length, missing }).toEqual({
        lang,
        total: HTML_REFS.length,
        missing: [],
      });
    });
  }
});
