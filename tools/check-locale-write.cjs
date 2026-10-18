// Проверка записи блока словаря на копиях. Работает с настоящими файлами и
// сравнивает их построчно: ошибка в склейке не видна в подсчёте ключей, её
// видно только в том, что JSON перестал разбираться.
//
// node check-locale-write.cjs [имяБлока]
const fs = require('fs');
const path = require('path');
const блок = require('./locale-block.cjs');

const имяБлока = process.argv[2] ?? 'items';
const корень = path.join(__dirname, '..');
let плохо = 0;

for (const код of ['ru', 'en', 'az']) {
  const путь = path.join(корень, 'shared', 'locales', `${код}.json`);
  const было = fs.readFileSync(путь, 'utf8');
  const строкиБыло = было.split('\n').length;
  const g = блок.границы(было, имяБлока);

  // Пишем те же строки, что уже есть, — файл должен остаться тем же.
  const текущие = блок.прочитатьБлок(код, имяБлока).значения;
  const строки = Object.keys(текущие).map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(текущие[k])}`);
  блок.заменитьБлок(код, имяБлока, строки);
  const стало = fs.readFileSync(путь, 'utf8');

  let разбирается = true;
  try {
    JSON.parse(стало);
  } catch (e) {
    разбирается = false;
    console.log(`${код}: JSON НЕ РАЗБИРАЕТСЯ — ${e.message}`);
  }
  const совпало = стало === было;
  const строкСтало = стало.split('\n').length;
  if (!разбирается) плохо++;
  if (!совпало) {
    console.log(`${код}: файл изменился (строк было ${строкиБыло}, стало ${строкСтало})`);
    const i = [...было].findIndex((ch, k) => ch !== стало[k]);
    console.log(`   первое расхождение на позиции ${i}: было ${JSON.stringify(было.slice(i - 40, i + 40))}`);
    console.log(`                                   стало ${JSON.stringify(стало.slice(i - 40, i + 40))}`);
    плохо++;
  } else {
    console.log(`${код}: ${имяБлока} — запись идемпотентна, JSON в порядке`);
  }
}

process.exit(плохо ? 1 : 0);