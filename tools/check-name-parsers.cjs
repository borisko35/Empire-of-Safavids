// Ищет блоки, где первое поле name не совпадает с тем, что лежит в данных
// под ключом, — то есть разборы с двумя регулярками через || берут не то.
//
// node check-name-parsers.cjs
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./helpers/strip-comments.cjs');

const корень = path.join(__dirname, '..');

/** Все вхождения name: в теле блока, обе формы кавычек. */
function всеИмена(тело) {
  const ре = /(?:^|[^\w])name:\s*(?:'((?:[^'\\]|\\.)*)'|"([^"]*)")/g;
  const список = [];
  let m;
  while ((m = ре.exec(тело)) !== null) список.push(m[1] ?? m[2] ?? '');
  return список;
}

const ФАЙЛЫ = [
  ['server/src/systems/BoatSystem.ts', 'boat_'],
  ['server/src/data/items.ts', null],
  ['server/src/data/crafting.ts', 'recipe_'],
];

for (const [файл, префикс] of ФАЙЛЫ) {
  const src = stripComments(fs.readFileSync(path.join(корень, файл), 'utf8'));
  const блоки = /^ {2}'([a-z][a-z0-9_]*)': \{([\s\S]*?)^ {2}\},/gm;
  let m;
  let всего = 0;
  let подозрительных = 0;
  while ((m = блоки.exec(src)) !== null) {
    const [, id, тело] = m;
    if (префикс && !id.startsWith(префикс)) continue;
    const имена = всеИмена(тело);
    if (имена.length === 0) continue;
    всего++;
    // Настоящее имя — первое, оно идёт сразу за id. Если следующие поля
    // name описывают вложенные сущности (комнаты, боссы), это нормально,
    // но их значения не должны быть тем, что попадёт в словарь.
    if (имена.length > 1) {
      подозрительных++;
      console.log(`${файл}: ${id}: полей name ${имена.length}, первое «${имена[0]}»`);
    }
  }
  console.log(`${файл}: блоков с именем ${всего}, из них с несколькими полями name ${подозрительных}\n`);
}