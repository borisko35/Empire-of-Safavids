// Дополняет раздел recipes в словарях перевода.
//
// Тот же приём, что в fill-item-names.cjs, и по той же причине: русские и
// английские названия не переводятся, а копируются дословно из
// server/src/data/crafting.ts, где их уже написали авторы проекта. Русское
// название рецепта и его результата обязано совпадать с данными, иначе в
// панели крафта игрок увидит одно, а в предмете другое.
//
// Азербайджанский переводится вручную и лежит в tools/az-recipes.json.
// Уже переведённые значения берутся из самого словаря и не переписываются.
const fs = require('fs');
const path = require('path');
const { recipes } = require('./list-recipes.cjs');
const блок = require('./locale-block.cjs');

const строка = блок.строкаJSON;
const ИМЯ_БЛОКА = 'recipes';

const режим = process.argv[2] ?? 'проверка';

if (режим === 'заполнить') {
  const принятьДанные = process.argv[3] === 'принять-данные';
  for (const [код, поле] of [['ru', 'ru'], ['en', 'en']]) {
    const { значения: текущие } = блок.прочитатьБлок(код, ИМЯ_БЛОКА);
    const значения = {};
    const переписано = [];
    let добавлено = 0;
    for (const r of recipes) {
      const значение = r[поле];
      if (typeof значение !== 'string' || значение === '') throw new Error(`${код}: нет ${поле} у ${r.id}`);
      if (текущие[r.id] !== undefined && текущие[r.id] !== значение) {
        if (!принятьДанные) {
          throw new Error(`${код}: ${r.id} в словаре «${текущие[r.id]}», в данных «${значение}» — расхождение`);
        }
        переписано.push(`${r.id}: «${текущие[r.id]}» -> «${значение}»`);
      }
      if (текущие[r.id] === undefined) добавлено++;
      значения[r.id] = значение;
    }
    блок.заменитьБлок(код, ИМЯ_БЛОКА, recipes.map((r) => `    ${строка(r.id)}: ${строка(значения[r.id])}`));
    console.log(`${код}: записей ${recipes.length}, добавлено ${добавлено}, переписано ${переписано.length}`);
    for (const стр of переписано) console.log(`   ${стр}`);
  }
}

if (режим === 'применить-az') {
  const новые = JSON.parse(fs.readFileSync(path.join(__dirname, 'az-recipes.json'), 'utf8'));
  const { значения: текущие } = блок.прочитатьБлок('az', ИМЯ_БЛОКА);
  const значения = {};
  let взятоСтарых = 0;
  for (const r of recipes) {
    if (typeof новые[r.id] === 'string' && новые[r.id].trim() !== '') {
      значения[r.id] = новые[r.id];
    } else if (typeof текущие[r.id] === 'string' && текущие[r.id].trim() !== '') {
      значения[r.id] = текущие[r.id];
      взятоСтарых++;
    }
  }
  блок.заменитьБлок('az', ИМЯ_БЛОКА, recipes.map((r) => `    ${строка(r.id)}: ${строка(значения[r.id])}`));
  console.log(`az: записей ${recipes.length}, новых переводов ${recipes.length - взятоСтарых}, взято из словаря ${взятоСтарых}`);
}

if (режим === 'проверка') {
  let плохо = 0;
  for (const код of ['ru', 'en', 'az']) {
    let d = {};
    try {
      d = блок.прочитатьБлок(код, ИМЯ_БЛОКА).значения;
    } catch {
      console.log(`${код}: раздела recipes нет`);
      плохо++;
      continue;
    }
    const нет = recipes.filter((r) => !(r.id in d));
    console.log(`${код}: рецептов в словаре ${Object.keys(d).length}, без перевода ${нет.length}${нет.length ? ': ' + нет.map((r) => r.id).join(', ') : ''}`);
    if (нет.length) плохо++;
    for (const r of recipes) {
      if (typeof d[r.id] !== 'string' || d[r.id].trim() === '') { console.log(`${код}: ${r.id} — пустое значение`); плохо++; }
    }
    if (код === 'ru') {
      for (const r of recipes) if (d[r.id] !== r.ru) { console.log(`ru: ${r.id} расходится с данными`); плохо++; }
    }
    if (код === 'en') {
      for (const r of recipes) if (d[r.id] !== r.en) { console.log(`en: ${r.id} расходится с данными`); плохо++; }
    }
  }
  process.exit(плохо ? 1 : 0);
}