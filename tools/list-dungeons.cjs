// Разбор подземелий из server/src/data/dungeons.ts.
//
// Берётся ПЕРВОЕ name и nameRu внутри блока подземелья: дальше внутри идут
// боссы и комнаты со своими названиями, и общее совпадение по файлу брало бы
// не то.
const fs = require('fs');
const { stripComments } = require('./helpers/strip-comments.cjs');

const src = stripComments(fs.readFileSync('server/src/data/dungeons.ts', 'utf8'));

const блоки = /^ {2}'(dungeon_[a-z0-9_]*)': \{([\s\S]*?)^ {2}\},/gm;
let m;
const dungeons = [];
while ((m = блоки.exec(src)) !== null) {
  const [, id, body] = m;
  // Имя бывает и в двойных кавычках: у подземелья Шеиха оно «The Sheikh's
  // Tomb», и апостроф заставил автора писать так.
  //
  // ОБЕ ФОРМЫ КАВЫЧЕК В ОДНОЙ РЕГУЛЯРКЕ, А НЕ ЧЕРЕЗ ||. С двумя
  // регулярками вторая проверялась только если первая не нашла ничего
  // ВООБЩЕ, а первая находила «name: 'Tomb Stair'» — название комнаты ниже
  // по блоку. Выбор падал на нём, верхнее поле пропускалось, и в словарь
  // подземелья попадала комната. Проверка сверки с данными это поймала.
  const name = /(?:^|[^\w])name:\s*(?:'((?:[^'\\]|\\.)*)'|"([^"]*)")/.exec(body);
  const nameRu = /(?:^|[^\w])nameRu:\s*'((?:[^'\\]|\\.)*)'/.exec(body);
  if (!name || !nameRu) continue;
  const снять = (s) => s.replace(/\\(.)/g, '$1');
  dungeons.push({ id, en: снять(name[1] ?? name[2] ?? ''), ru: снять(nameRu[1] ?? '') });
}

module.exports = { dungeons };

if (require.main === module) {
  console.log('подземелий разобрано:', dungeons.length);
  for (const d of dungeons) console.log(`${d.id.padEnd(28)} ${d.en.padEnd(30)} | ${d.ru}`);
}