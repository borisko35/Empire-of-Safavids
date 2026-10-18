// Ищет предметы, которые называются одинаково. Совпадение имён — не
// вкусовое: игрок получает два разных предмета и не может их различить.
const { items } = require('./list-items.cjs');

const поИмени = new Map();
for (const i of items) {
  if (!i.ru) continue;
  const ключ = i.ru.trim().toLowerCase();
  if (!поИмени.has(ключ)) поИмени.set(ключ, []);
  поИмени.get(ключ).push(i);
}

let нашлось = 0;
for (const [имя, группа] of поИмени) {
  if (группа.length < 2) continue;
  нашлось++;
  console.log(`\n«${имя}» — ${группа.length} предмета:`);
  for (const g of группа) {
    console.log(`   ${g.id.padEnd(24)} ${String(g.type).padEnd(11)} ${String(g.rarity).padEnd(9)} ур.${String(g.level).padEnd(4)} en: ${g.en}`);
  }
}
console.log(`\nгрупп с одинаковым названием: ${нашлось}`);
