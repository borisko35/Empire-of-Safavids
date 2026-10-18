// Разбор торговых контрактов из server/src/systems/TradeService.ts.
// Контрактов пять, и у них есть name и nameRu — name добавлен в данные,
// потому что раньше было только nameRu, а словарь заполняется из данных.
const fs = require('fs');

const src = fs.readFileSync('server/src/systems/TradeService.ts', 'utf8');

const начало = src.indexOf('TRADE_CONTRACTS');
if (начало === -1) throw new Error('TRADE_CONTRACTS не найден');
const конец = src.indexOf('\n];', начало);
if (конец === -1) throw new Error('конец TRADE_CONTRACTS не найден');
const блок = src.slice(начало, конец);

// Комментарии вырезаются ДО разбора полей. Регулярка, требующая соседства
// id, name и nameRu, ломалась от комментария между ними: контракт выпадал
// из списка молча, а инструмент заполнения — который доверяет этому
// списку — переписывал словарь уже без него. Потеря ключа выглядела как
// успешная работа.
const { stripComments } = require('./helpers/strip-comments.cjs');
const чистый = stripComments(блок);

const объекты = чистый.split(/\n {2}\{\n/).slice(1);
const contracts = [];
for (const объект of объекты) {
  const id = /id:\s*'(trade_[a-z0-9_]+)'/.exec(объект);
  const name = /(?:^|[^\w])name:\s*'([^']*)'/.exec(объект);
  const nameRu = /(?:^|[^\w])nameRu:\s*'([^']*)'/.exec(объект);
  if (!id || !name || !nameRu) continue;
  contracts.push({ id: id[1] ?? '', en: name[1] ?? '', ru: nameRu[1] ?? '' });
}

module.exports = { contracts };

if (require.main === module) {
  console.log('контрактов разобрано:', contracts.length);
  for (const c of contracts) console.log(`${c.id.padEnd(32)} ${c.en.padEnd(30)} | ${c.ru}`);
}