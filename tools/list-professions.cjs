// Разбор профессий из server/src/services/SkillsService.ts.
//
// ОТЛИЧИЕ ОТ ОСТАЛЬНЫХ ВИДОВ. У профессий поле name — это НЕ английское
// название, а ключ для перевода: name: 'warrior'. Русское есть (nameRu),
// английского в данных нет, и перевод для en приходится писать руками. Это
// отражено в правилах раздела: для профессий ru берётся из данных, а en и az
// задаются в tools/az-professions.json.
const fs = require('fs');
const { stripComments } = require('./helpers/strip-comments.cjs');

const src = stripComments(fs.readFileSync('server/src/services/SkillsService.ts', 'utf8'));

const начало = src.indexOf('const PROFESSIONS');
if (начало === -1) throw new Error('PROFESSIONS не найден');
const блок = src.slice(начало, src.indexOf('\n];', начало));

const re = /\{\s*id:\s*'([a-z0-9_]+)',\s*name:\s*'([a-z0-9_]+)',\s*nameRu:\s*'([^']*)'/g;
let m;
const professions = [];
while ((m = re.exec(блок)) !== null) {
  const [, id, , nameRu] = m;
  professions.push({ id, ru: nameRu ?? '' });
}

module.exports = { professions };

if (require.main === module) {
  console.log('профессий разобрано:', professions.length);
  for (const p of professions) console.log(`${p.id.padEnd(14)} ${p.ru}`);
}