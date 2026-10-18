// Разбор питомцев из server/src/services/PetService.ts.
// У питомца четыре строки текста на двух языках: имя и название умения.
const fs = require('fs');
const { stripComments } = require('./helpers/strip-comments.cjs');

const src = stripComments(fs.readFileSync('server/src/services/PetService.ts', 'utf8'));

const начало = src.indexOf('PET_DEFINITIONS');
const блок = начало === -1 ? src : src.slice(начало, src.indexOf('\n];', начало));

const re = /\{\s*id:\s*'(pet_[a-z0-9_]+)',\s*name:\s*'([^']*)',\s*name_ru:\s*'([^']*)',[\s\S]*?ability_name:\s*'([^']*)',\s*ability_name_ru:\s*'([^']*)'/g;
let m;
const pets = [];
while ((m = re.exec(блок)) !== null) {
  const [, id, name, nameRu, abilityName, abilityNameRu] = m;
  pets.push({
    id,
    en: name ?? '',
    ru: nameRu ?? '',
    abilityEn: abilityName ?? '',
    abilityRu: abilityNameRu ?? '',
  });
}

module.exports = { pets };

if (require.main === module) {
  console.log('питомцев разобрано:', pets.length);
  for (const p of pets) {
    console.log(`${p.id.padEnd(24)} ${p.en.padEnd(20)} | ${p.ru.padEnd(22)} умение: ${p.abilityEn} / ${p.abilityRu}`);
  }
}