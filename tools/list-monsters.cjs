// Разбор монстров из server/src/data/monsters.ts.
const fs = require('fs');
const { stripComments } = require('./helpers/strip-comments.cjs');

const src = stripComments(fs.readFileSync('server/src/data/monsters.ts', 'utf8'));

const re = /^ {2}'([a-z][a-z0-9_]*)': \{([\s\S]*?)^ {2}\},/gm;
let m;
const monsters = [];
while ((m = re.exec(src)) !== null) {
  const [, id, body] = m;
  const name = /(?:^|[^\w])name:\s*'((?:[^'\\]|\\.)*)'/.exec(body);
  const nameRu = /(?:^|[^\w])nameRu:\s*'((?:[^'\\]|\\.)*)'/.exec(body);
  const aquatic = /\baquatic:\s*true/.test(body);
  const level = /(?:^|[^\w])level:\s*(\d+)/.exec(body);
  if (!name || !nameRu) continue;
  monsters.push({
    id,
    en: name[1].replace(/\\(.)/g, '$1'),
    ru: nameRu[1].replace(/\\(.)/g, '$1'),
    aquatic,
    level: level ? Number(level[1]) : null,
  });
}

module.exports = { monsters };

if (require.main === module) {
  const args = process.argv.slice(2);
  const список = args.includes('--aquatic') ? monsters.filter((x) => x.aquatic) : monsters;
  console.log('разобрано:', monsters.length, '| водных:', monsters.filter((x) => x.aquatic).length);
  for (const x of список) {
    console.log(`${x.id.padEnd(28)} ур.${String(x.level).padEnd(4)} ${x.aquatic ? 'водный' : '      '} ${x.en.padEnd(30)} | ${x.ru}`);
  }
}