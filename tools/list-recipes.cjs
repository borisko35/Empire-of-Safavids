// Разбор рецептов крафта из server/src/data/crafting.ts.
// Отдельный от list-items.cjs по той же причине: PowerShell портит
// кавычки в инлайновом node -e, а здесь регулярки с ними.
const fs = require('fs');

const src = fs.readFileSync('server/src/data/crafting.ts', 'utf8');

const re = /^ {2}'(recipe_[a-z0-9_]*)': \{([\s\S]*?)^ {2}\},/gm;
let m;
const recipes = [];
while ((m = re.exec(src)) !== null) {
  const [, id, body] = m;
  // Внутри строки допускается экранированный символ, и имя бывает как в
  // одинарных кавычках, так и в двойных — "Forge Shah's Blade" написан
  // вторым, потому что в имени апостроф. Разбор только одинарных молча
  // терял такие рецепты.
  const nm = /(?:^|[^\w])name: '((?:[^'\\]|\\.)*)'/.exec(body)
    || /(?:^|[^\w])name: "([^"]*)"/.exec(body);
  const nru = /(?:^|[^\w])nameRu: '((?:[^'\\]|\\.)*)'/.exec(body);
  const res = /(?:^|[^\w])resultItemId: '([^']*)'/.exec(body);
  const cat = /(?:^|[^\w])category: '([^']*)'/.exec(body);
  if (!nm || !nru) continue;
  const снять = (s) => s.replace(/\\(.)/g, '$1');
  recipes.push({
    id,
    en: снять(nm[1] ?? ''),
    ru: снять(nru[1] ?? ''),
    result: res ? res[1] : null,
    category: cat ? cat[1] : null,
  });
}

module.exports = { recipes };

if (require.main === module) {
  console.log('рецептов разобрано:', recipes.length);
  for (const r of recipes) {
    console.log([r.id.padEnd(26), r.category.padEnd(16), r.result.padEnd(22), r.en.padEnd(30), '| ' + r.ru].join(' '));
  }
}