// Разбор предметов декора из server/src/services/HousingService.ts.
const fs = require('fs');
const { stripComments } = require('./helpers/strip-comments.cjs');

const src = stripComments(fs.readFileSync('server/src/services/HousingService.ts', 'utf8'));

const начало = src.indexOf('DECORATIONS');
if (начало === -1) throw new Error('DECORATIONS не найден');
const блок = src.slice(начало, src.indexOf('\n};', начало));

// Идентификаторы НЕ зашиты в регулярку. Список был зашит, и добавление
// девятого предмета декора выпало бы из разбора молча: восемь записей
// выглядели бы полным списком, а словарь — полным.
const re = /'([a-z][a-z0-9_]*)':\s*\{\s*name:\s*'([^']*)',\s*nameRu:\s*'([^']*)'/g;
let m;
const decorations = [];
while ((m = re.exec(блок)) !== null) {
  const [, id, en, ru] = m;
  decorations.push({ id, en: en ?? '', ru: ru ?? '' });
}

module.exports = { decorations };

if (require.main === module) {
  console.log('предметов декора разобрано:', decorations.length);
  for (const d of decorations) console.log(`${d.id.padEnd(22)} ${d.en.padEnd(22)} | ${d.ru}`);
}