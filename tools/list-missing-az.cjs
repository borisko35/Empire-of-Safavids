// Печатает предметы, для которых в az.json ещё нет названия, вместе с
// английским и русским именем из данных. Нужен переводчику: переводить
// по одному идентификатору вслепую нельзя.
const fs = require('fs');
const { items } = require('./list-items.cjs');

const az = JSON.parse(fs.readFileSync('shared/locales/az.json', 'utf8')).items;
const нужны = items.filter((i) => !(i.id in az));

console.log('не переведено:', нужны.length, 'из', items.length);
for (const i of нужны) {
  console.log(
    [
      i.id.padEnd(28),
      String(i.type).padEnd(11),
      String(i.rarity).padEnd(10),
      'ур.' + String(i.level).padEnd(4),
      i.en,
      '| ' + i.ru,
    ].join(' '),
  );
}