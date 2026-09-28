// Извлечение НАСТОЯЩЕГО тела функции из исходника TypeScript и его запуск.
//
// ЗАЧЕМ. Правило проекта: тест должен выполнять настоящую функцию из кода, а
// не её копию. Копия — это расхождение: сегодня тест проверяет одно, а завтра
// в коде другое, и тест продолжает быть зелёным, потому что проверяет не
// код, а себя.
//
// Тут ровно обратная задача: тесты лежат в server/src/tests, клиентского
// раннера у них нет, а импортировать world.ts целиком нельзя — он тянет звук,
// сокет и движок. Поэтому берём тело функции ИЗ ФАЙЛА и исполняем его на
// подставных зависимостях. Правка в теле ломает тест; копия логики в тесте
// не ломалась бы никогда.
//
// ПОЧЕМУ ЧЕРЕЗ typescript, А НЕ РЕГУЛЯРКАМИ. Тело функции — это программа на
// TypeScript, и внутри него есть всё: `const out: boolean[] = []`,
// `document.querySelector<HTMLButtonElement>(...)`, возвращаемые типы. Вырезать
// это регулярками нельзя безопасно: `имя: тип` встречается и в теле
// (`const out: boolean[]`), и съедает оттуда половину функции. transpileModule
// делает ровно то, что нужно, и не может испортить код.
//
// ЧТО ЗДЕСЬ НЕ ТЕСТИРУЕТСЯ. Тест не знает про game3d, socket и загрузчики
// панелей — они подставляются заглушками-регистрами, которые только
// запоминают вызов. Их содержимое здесь не важно, важно лишь, что
// openPanelById позвала их в правильном порядке.
import * as ts from 'typescript';

/**
 * Вырезать тело функции по имени.
 *
 * Ищет `function <name>(` (с необязательным `export`), пропускает возвращаемый
 * тип и находит тело по балансу скобок.
 *
 * Пропуск возвращаемого типа сделан по указателю, а не регуляркой: у
 * `outsideCityRange` тип начинается с `{`, и первый `{` после скобки
 * параметров — это его, а не тело. Регулярка на этом месте обрезала бы
 * функцию по `{` типа.
 */
export function extractFunction(source: string, name: string): string {
  const decl = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  if (!decl) throw new Error(`функция ${name} не найдена`);

  // Закрывающая скобка параметров
  let i = decl.index + decl[0].length - 1;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) break;
  }
  const paramsEnd = i;

  // Возвращаемый тип, если он есть
  let afterParams = paramsEnd + 1;
  while (afterParams < source.length && /\s/.test(source[afterParams])) afterParams++;
  if (source[afterParams] === ':') {
    let j = afterParams + 1;
    while (j < source.length && /\s/.test(source[j])) j++;
    if (source[j] === '{') {
      // Объектный тип: до парной скобки, затем хвост `| null`
      let d = 0;
      for (; j < source.length; j++) {
        if (source[j] === '{') d++;
        else if (source[j] === '}' && --d === 0) { j++; break; }
      }
      const rest = /^\s*(\|\s*[A-Za-z_$][\w$]*\s*)*/.exec(source.slice(j));
      j += rest ? rest[0].length : 0;
    } else {
      // Простой тип: идентификатор с дженериками и пробелами
      const simple = /^[A-Za-z_$][\w$<>,.\s.[\]]*/.exec(source.slice(j));
      j += simple ? simple[0].length : 0;
    }
    afterParams = j;
  }

  const bodyStart = source.indexOf('{', afterParams);
  if (bodyStart < 0) throw new Error(`у ${name} нет тела`);

  depth = 0;
  let bodyEnd = -1;
  for (i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) { bodyEnd = i; break; }
  }
  if (bodyEnd < 0) throw new Error(`тело ${name} не закрыто`);

  // `export function` — вне модуля это синтаксическая ошибка, а transpileModule
  // с ModuleKind.None превратит его в обращение к exports, которого тут нет
  return (
    source.slice(decl.index, paramsEnd + 1).replace(/^export\s+/, '') +
    source.slice(bodyStart, bodyEnd + 1)
  );
}

/**
 * Найти парный закрывающий символ для блока, открытого на позиции i.
 * Считает только свой символ — скобки строк и шаблонов приходится игнорировать,
 * но тела функций проекта от них не зависят (иначе не работал бы и extractFunction).
 */
function matchBlock(source: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close && --depth === 0) return i;
  }
  return -1;
}

/**
 * Вырезать стрелочную функцию, присвоенную константе:
 * `const NAME = async (args): Type => { body }`.
 *
 * Так написаны express-middleware в routes/game.ts, и у них нет объявления
 * `function NAME(`, поэтому extractFunction их не находит.
 */
export function extractConstArrow(source: string, name: string): string {
  const decl = new RegExp(`(?:const|let|var)\\s+${name}\\s*=`);
  const m = decl.exec(source);
  if (!m) throw new Error(`нет константы ${name}`);
  let i = m.index + m[0].length;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (/^async\b/.test(source.slice(i))) {
    i += 'async'.length;
    while (i < source.length && /\s/.test(source[i])) i++;
  }
  const start = i;
  if (source[i] !== '(') throw new Error(`${name}: ожидались параметры в скобках`);
  const paramsEnd = matchBlock(source, i, '(', ')');
  if (paramsEnd < 0) throw new Error(`${name}: параметры не закрыты`);

  // Стрелка может быть вложенной: `(field) => async (req, res, next) => { ... }`
  // — именно так написана проверка принадлежности в routes/game.ts
  let cursor = paramsEnd + 1;
  let bodyStart = -1;
  for (let guard = 0; guard < 10 && bodyStart < 0; guard++) {
    const arrow = source.indexOf('=>', cursor);
    if (arrow < 0) throw new Error(`${name}: нет =>`);
    let candidate = arrow + 2;
    while (candidate < source.length && /\s/.test(source[candidate])) candidate++;
    if (source[candidate] === '{') bodyStart = candidate;
    else cursor = arrow + 2;
  }
  if (bodyStart < 0) throw new Error(`${name}: тело не в фигурных скобках`);

  const bodyEnd = matchBlock(source, bodyStart, '{', '}');
  if (bodyEnd < 0) throw new Error(`${name}: тело не закрыто`);
  return source.slice(start, bodyEnd + 1);
}

/**
 * Вырезать метод класса: `async name(args): Type { body }`.
 *
 * Возвращаемые модификаторы (private/async) остаются в срезе — transpileModule
 * их переваривает, а вызывающая сторона кладёт результат в литерал объекта.
 */
export function extractMethod(source: string, name: string): string {
  const decl = new RegExp(
    `(?:^|\\n)[ \\t]*(?:(?:public|private|protected|static|readonly|async|override)\\s+)*${name}\\s*\\(`,
  );
  const m = decl.exec(source);
  if (!m) throw new Error(`нет метода ${name}`);
  const start = m.index + (m[0].startsWith('\n') ? 1 : 0);
  const open = source.indexOf('(', m.index);
  const paramsEnd = matchBlock(source, open, '(', ')');
  if (paramsEnd < 0) throw new Error(`${name}: параметры не закрыты`);

  let j = paramsEnd + 1;
  while (j < source.length && /\s/.test(source[j])) j++;
  if (source[j] === ':') {
    j++;
    while (j < source.length && /\s/.test(source[j])) j++;
    if (source[j] === '{') {
      // Возвращаемый тип-объект: пропускаем его, тело — следующая скобка
      j = matchBlock(source, j, '{', '}');
      if (j < 0) throw new Error(`${name}: возвращаемый тип не закрыт`);
      j++;
    } else {
      while (j < source.length && source[j] !== '{') j++;
    }
  }
  while (j < source.length && /\s/.test(source[j])) j++;
  if (source[j] !== '{') throw new Error(`${name}: тело не найдено`);
  const bodyEnd = matchBlock(source, j, '{', '}');
  if (bodyEnd < 0) throw new Error(`${name}: тело не закрыто`);
  return source.slice(start, bodyEnd + 1).trim();
}

/** Собрать исполняемую стрелочную функцию из настоящего исходника константы. */
export function buildConstRunner(
  source: string,
  name: string,
  deps: Record<string, unknown>,
): (...args: never[]) => unknown {
  // transpileModule доставляет `;` в конец — внутри `return (...)` это
  // ошибка синтаксиса, поэтому хвост снимается
  const arrow = toJs(extractConstArrow(source, name)).trim().replace(/;+$/, '');
  const keys = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  const factory = new Function(...keys, `return (${arrow});`);
  return (factory as (...a: unknown[]) => (...args: never[]) => unknown)(
    ...keys.map((k) => deps[k]),
  );
}

/**
 * Собрать исполняемый метод из настоящего исходника класса (зовётся через .call).
 *
 * Метод транспилируется только внутри литерала объекта: на верхнем уровне
 * `async name(): T { ... }` — не выражение, и компилятор выдаёт мусор
 * вида `async; name(); Promise < number > {`.
 */
export function buildMethodRunner(
  source: string,
  name: string,
  deps: Record<string, unknown>,
): (this: unknown, ...args: never[]) => unknown {
  // transpileModule доставляет `;` и в конец литерала объекта
  const objectLiteral = toJs(`({ ${extractMethod(source, name)} })`).trim().replace(/;+$/, '');
  const keys = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  const factory = new Function(...keys, `return (${objectLiteral})[${JSON.stringify(name)}];`);
  return (factory as (...a: unknown[]) => (this: unknown, ...args: never[]) => unknown)(
    ...keys.map((k) => deps[k]),
  );
}

/**
 * Вырезать обработчик маршрута: `router.get('/x', mw, async (req, res) => {…})`.
 *
 * Маршруты в routes/*.ts пишутся анонимными стрелками — имени для
 * extractConstArrow у них нет, поэтому обработчик ищется по строке-маркеру
 * самого маршрута; переданная строка должна встречаться ровно один раз.
 */
export function extractRouteHandler(source: string, marker: string): string {
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`маршрут ${marker} не найден`);
  const arrow = source.indexOf('=>', at);
  if (arrow < 0) throw new Error(`${marker}: у обработчика нет =>`);
  const start = source.lastIndexOf('async', arrow);
  if (start < 0 || start < at) throw new Error(`${marker}: обработчик не async`);
  const bodyStart = source.indexOf('{', arrow);
  if (bodyStart < 0) throw new Error(`${marker}: нет тела`);
  const bodyEnd = matchBlock(source, bodyStart, '{', '}');
  if (bodyEnd < 0) throw new Error(`${marker}: тело не закрыто`);
  return source.slice(start, bodyEnd + 1);
}

/** Собрать исполняемый обработчик маршрута из настоящего исходника. */
export function buildRouteRunner(
  source: string,
  marker: string,
  deps: Record<string, unknown>,
): (...args: never[]) => unknown {
  const expr = toJs(extractRouteHandler(source, marker)).trim().replace(/;+$/, '');
  const keys = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  const factory = new Function(...keys, `return (${expr});`);
  return (factory as (...a: unknown[]) => (...args: never[]) => unknown)(
    ...keys.map((k) => deps[k]),
  );
}

/** Снять типы: получить из TypeScript настоящий JavaScript. */
function toJs(tsSource: string): string {
  return ts.transpileModule(tsSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.None },
  }).outputText;
}

/**
 * Собрать исполняемую функцию из нескольких настоящих тел.
 *
 * deps — подставляемые заглушки (загрузчики панелей, город, document). Их
 * содержимое тест не проверяет, поэтому передаётся снаружи.
 */
export function buildRunner(
  source: string,
  names: string[],
  deps: Record<string, unknown>,
): (...args: never[]) => Record<string, (...a: never[]) => unknown> {
  const body = names.map((n) => extractFunction(source, n)).join('\n\n');
  const keys = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'document',
    ...keys,
    `${toJs(body)}\nreturn { ${names.join(', ')} };`,
  );
  const values = keys.map((k) => deps[k]);
  return (...args: never[]) =>
    (factory as (...a: unknown[]) => Record<string, (...a: never[]) => unknown>)(
      ...args,
      ...values,
    );
}
