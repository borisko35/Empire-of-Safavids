// Извлечение НАСТОЯЩЕГО тела функции из исходника TypeScript.
//
// ЗАЧЕМ. Правило проекта: тест должен выполнять настоящую функцию из кода, а
// не её копию. Копия — это расхождение: сегодня тест проверяет одно, а завтра
// в коде другое, и тест продолжает быть зелёным, потому что проверяет не
// код, а себя.
//
// Тут ровно обратная задача: тесты лежат в server/src/tests, под клиентский
// раннер их нет, а импортировать world.ts целиком нельзя — он тянет звук,
// сокет и движок. Поэтому берём тело функции ИЗ ФАЙЛА и исполняем его на
// подставном document. Правка в теле функции ломает тест; правка в
// сигнатуре (новый тип) — нет, и это единственное, что тест не видит.
//
// ЧТО ЗДЕСЬ НЕ ТЕСТИРУЕТСЯ. Тест не знает про game3d, socket и загрузчики
// панелей — они подставляются заглушками-регистрами, которые только
// запоминают вызов. Их содержимое здесь не важно, важно лишь, что
// openPanelById позвала их в правильном порядке.

/**
 * Вырезать тело функции по имени.
 *
 * Ищет `function <name>(` (с необязательным `export`), находит закрывающую
 * скобку тела по балансу и снимает с исходника TypeScript-обвязку:
 *   - аннотации параметров и возвращаемого типа: `(panel: string): void`
 *   - дженерики вызова: `document.querySelector<HTMLButtonElement>(`
 *
 * Обе правки безопасны: аннотация типа идёт до `:` или до `{`, а дженерик
 * вызова — строго между именем метода и открытой скобкой.
 */
export function extractFunction(source: string, name: string): string {
  const decl = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  if (!decl) throw new Error(`функция ${name} не найдена`);

  // Открывающая скобка параметров
  let i = decl.index + decl[0].length - 1;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) break;
  }
  const paramsEnd = i;

  // Открывающая скобка тела
  let bodyStart = source.indexOf('{', paramsEnd);
  if (bodyStart < 0) throw new Error(`у ${name} нет тела`);

  depth = 0;
  let bodyEnd = -1;
  for (i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) { bodyEnd = i; break; }
  }
  if (bodyEnd < 0) throw new Error(`тело ${name} не закрыто`);

  let out = source.slice(decl.index, bodyEnd + 1);
  // export function → function (иначе вне модуля это синтаксическая ошибка)
  out = out.replace(/^export\s+/, '');
  // Аннотации: `name(a: string, b: Foo<Bar>[])` → `name(a, b)`
  const head = out.slice(0, out.indexOf(')'));
  const tail = out.slice(out.indexOf(')'));
  const cleanHead = head.replace(/([A-Za-z_$][\w$]*)\s*:\s*[^,)]+/g, '$1');
  // Возвращаемый тип: `): number {` → `) {`
  out = cleanHead + tail.replace(/\)\s*:\s*[^{]+\{/, ') {');
  // Дженерики вызова: `.querySelector<HTMLButtonElement>(` → `.querySelector(`
  out = out.replace(/\.(querySelector|querySelectorAll|getElementById)\s*<[^<>]*>\s*\(/g, '.$1(');
  return out;
}

/**
 * Собрать исполняемую функцию из нескольких настоящих тел.
 *
 * extra — подставляемые заглушки (загрузчики панелей, переводчик). Их
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
    `${body}\nreturn { ${names.join(', ')} };`,
  );
  const values = keys.map((k) => deps[k]);
  return (...args: never[]) =>
    (factory as (...a: unknown[]) => Record<string, (...a: never[]) => unknown>)(
      ...args,
      ...values,
    );
}
