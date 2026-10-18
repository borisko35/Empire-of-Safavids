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

const re = /id:\s*'(trade_[a-z0-9_]+)',\s*\n\s*name:\s*'([^']*)',\s*\n\s*nameRu:\s*'([^']*)',/g;
let m;
const contracts = [];
while ((m = re.exec(блок)) !== null) {
  const [, id, name, nameRu] = m;
  contracts.push({ id, en: name ?? '', ru: nameRu ?? '' });
}

module.exports = { contracts };

if (require.main === module) {
  console.log('контрактов разобрано:', contracts.length);
  for (const c of contracts) console.log(`${c.id.padEnd(32)} ${c.en.padEnd(30)} | ${c.ru}`);
}