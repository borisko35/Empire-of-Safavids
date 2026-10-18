// Разбор предметов из данных. Отдельный файл, потому что PowerShell
// портит кавычки в инлайновом node -e, а здесь регулярки с ними.
const fs = require('fs');
const src = fs.readFileSync('server/src/data/items.ts', 'utf8');

const re = /^ {2}'([a-z][a-z0-9_]*)': \{([\s\S]*?)^ {2}\},/gm;
let m;
const items = [];
while ((m = re.exec(src)) !== null) {
  const id = m[1];
  const body = m[2];
  // Имя и nameRu встречаются в двух видах: на своих строках (большинство
  // предметов) и на одной строке с id — так записаны рыбы. Разбор берёт
  // начало строки необязательным: без этого одиннадцать рыб выпадали из
  // списка молча, и выглядело бы так, будто они без названий.
  //
  // Внутри строки допускается экранированный символ. Без этого название
  // 'Scholar\'s Scroll' читалось как 'Scholar\' — с висящим обратным слэшем
  // на конце. Что хуже: расхождение потом выглядит как ошибка в данных
  // предмета, и чинить начинают не разбор, а сам предмет.
  const nm = /(?:^|[^\w])name:\s*(?:'((?:[^'\\]|\\.)*)'|"([^"]*)")/.exec(body);
  const nru = /(?:^|[^\w])nameRu: '((?:[^'\\]|\\.)*)'/.exec(body);
  const rar = /(?:^|[^\w])rarity: ItemRarity\.([A-Z]+)/.exec(body);
  const lvl = /(?:^|[^\w])level: (\d+)/.exec(body);
  const ty = /(?:^|[^\w])type: ItemType\.([A-Z_]+)/.exec(body);
  items.push({
    id,
    // Слэш-экранирование снимается: в файле это синтаксис TypeScript,
    // а в словаре перевода должен попасть сам апостроф, иначе название
    // уедет в JSON вместе со слэшем и станет странным для игрока.
    en: nm ? (nm[1] ?? nm[2]).replace(/\\(.)/g, '$1') : null,
    ru: nru ? nru[1].replace(/\\(.)/g, '$1') : null,
    rarity: rar ? rar[1] : null,
    level: lvl ? Number(lvl[1]) : null,
    type: ty ? ty[1] : null,
  });
}

const словарь = (код) => JSON.parse(fs.readFileSync(`shared/locales/${код}.json`, 'utf8')).items;

module.exports = { items, словарь };

if (require.main === module) {
  console.log('всего предметов разобрано:', items.length);
  console.log('без nameRu:', items.filter((i) => !i.ru).length);
  console.log('без name (en):', items.filter((i) => !i.en).length);
  for (const l of ['ru', 'en', 'az']) {
    const d = словарь(l);
    console.log(`в словаре ${l}: ${Object.keys(d).length}`);
  }
  console.log('\n--- предметы без перевода в ru ---');
  const ru = словарь('ru');
  for (const i of items.filter((x) => !ru[x.id])) {
    console.log(
      [i.id.padEnd(26), (i.ru || '—').padEnd(32), (i.en || '—').padEnd(32),
        `${i.type}/${i.rarity}/ур.${i.level}`].join(' '),
    );
  }
}
