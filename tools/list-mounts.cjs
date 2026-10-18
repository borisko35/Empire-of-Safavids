// Разбор маунтов из server/src/systems/MountSystem.ts.
const fs = require('fs');
const { stripComments } = require('./helpers/strip-comments.cjs');

const src = stripComments(fs.readFileSync('server/src/systems/MountSystem.ts', 'utf8'));

const начало = src.indexOf('MOUNTS');
const блок = начало === -1 ? src : src.slice(начало, src.indexOf('\n};', начало));

const re = /id:\s*'(mount_[a-z0-9_]+)',\s*name:\s*'([^']*)',\s*nameRu:\s*'([^']*)'/g;
let m;
const mounts = [];
while ((m = re.exec(блок)) !== null) {
  const [, id, name, nameRu] = m;
  mounts.push({ id, en: name ?? '', ru: nameRu ?? '' });
}

module.exports = { mounts };

if (require.main === module) {
  console.log('маунтов разобрано:', mounts.length);
  for (const x of mounts) console.log(`${x.id.padEnd(30)} ${x.en.padEnd(24)} | ${x.ru}`);
}