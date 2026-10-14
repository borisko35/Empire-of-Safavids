// Проверка собранного бандла клиента на подписки внутри подписок.
//
// ЗАЧЕМ. Баг §192 дожил до контейнера: обработчик boarding:result стоял
// внутри тела combat:error. Тесты этого не видели — tsc чист, бандл собран,
// строка события в нём есть. Видно стало только взглядом на исходник.
//
// Инструмент проверяет АРТЕФАКТ, а не исходник: разбирает уже собранный и
// минифицированный бандл тем же разбором дерева, что и сторож на исходнике.
//
// ПРО МИНИФИКАЦИЮ. Минификатор переименовывает переменные, и переменная сокета
// в бандле называется не socket, а коротким именем вида R. Поэтому приёмником
// считается ЛЮБОЙ идентификатор: подписка — это вызов вида
// <идентификатор>.on(<строка>, …). На исходнике это ровно socket.on; в бандле
// после переименования — то же самое по форме.
//
// ЛОЖНЫЕ СРАВНЕНИЯ. В бандле есть и другие `.on(` — не подписки. Критерий
// строгий: важен только вложенный случай, а одиночный `.on(` ничего не
// утверждает. Ноль найденных подписок вовсе считается ОТКАЗОМ инструмента,
// а не успехом: это значит «файл не тот», и проходить здесь нельзя.
//
// ЗАПУСК. node server/tools/check-bundle-subscriptions.ts <путь-к-бандлу.js>
//
// ИМЕНА ЛАТИНИЦЕЙ — СПЕЦИАЛЬНО. Node снимает типы с .ts построчно, и
// `for (const имя of ...)` с кириллическим именем он не разбирает:
// «Expected ')', got 'ident'». Служебному скрипту кириллица не нужна.
import * as ts from 'typescript';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node server/tools/check-bundle-subscriptions.ts <bundle.js>');
  process.exit(2);
}

const code = readFileSync(file, 'utf8');
const source = ts.createSourceFile('bundle.js', code, ts.ScriptTarget.Latest, true);

/** A subscription: <identifier>.on(<string literal>, …) */
const isSubscription = (node) =>
  ts.isCallExpression(node)
  && ts.isPropertyAccessExpression(node.expression)
  && node.expression.name.text === 'on'
  && ts.isIdentifier(node.expression.expression)
  && node.arguments.length > 0
  && node.arguments[0]
  && ts.isStringLiteralLike(node.arguments[0]);

const label = (node) => (node.arguments[0] as ts.StringLiteralLike).text;

const nested = [];
const walkNested = (node, inside) => {
  let here = inside;
  if (isSubscription(node)) {
    if (here) nested.push(label(node));
    here = true;
  }
  ts.forEachChild(node, (child) => walkNested(child, here));
};
ts.forEachChild(source, (node) => walkNested(node, false));

let total = 0;
const countAll = (node) => {
  if (isSubscription(node)) total++;
  ts.forEachChild(node, countAll);
};
ts.forEachChild(source, (node) => countAll(node));

console.log(`${file}: subscriptions ${total}, nested ${nested.length}`);
if (total === 0) {
  console.log('REFUSED: no subscriptions found at all — either this is not a client bundle,');
  console.log('or it is minified past recognition. Passing here would prove nothing.');
  process.exit(2);
}
if (nested.length > 0) {
  console.log('NESTED SUBSCRIPTIONS (they register only when the outer one fires):');
  for (const name of new Set(nested)) console.log('  ' + name);
  process.exit(1);
}
console.log('RESULT: PASS — no nested subscriptions');
