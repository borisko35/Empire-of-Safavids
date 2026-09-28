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
