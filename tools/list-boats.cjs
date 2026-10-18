// Разбор лодок из server/src/systems/BoatSystem.ts.
//
// У лодок четыре строки текста на двух языках: название и описание, плюс
// то же самое в nameRu и descriptionRu. Разбор нужен для заполнения
// словарей по тому же правилу, что предметы и рецепты: русский и английский
// копируются дословно из данных, переводится только азербайджанский.
const fs = require('fs');

const src = fs.readFileSync('server/src/systems/BoatSystem.ts', 'utf8');

const re = /^ {2}'(boat_[a-z0-9_]+)': \{([\s\S]*?)^ {2}\},/gm;
let m;
const boats = [];
while ((m = re.exec(src)) !== null) {
  const [, id, body] = m;
  // Апостроф в «Shah's Galley» заставит данные писать имя в двойных
  // кавычках, поэтому берём оба вида.
  const имя = /(?:^|[^\w])name: '((?:[^'\\]|\\.)*)'/.exec(body)
    || /(?:^|[^\w])name: "([^"]*)"/.exec(body);
  const имяRu = /(?:^|[^\w])nameRu: '((?:[^'\\]|\\.)*)'/.exec(body);
  const описание = /(?:^|[^\w])description: '((?:[^'\\]|\\.)*)'/.exec(body)
    || /(?:^|[^\w])description: "([^"]*)"/.exec(body);
  const описаниеRu = /(?:^|[^\w])descriptionRu: '((?:[^'\\]|\\.)*)'/.exec(body);
  if (!имя || !имяRu || !описание || !описаниеRu) continue;
  const снять = (s) => s.replace(/\\(.)/g, '$1');
  boats.push({
    id,
    en: снять(имя[1] ?? ''),
    ru: снять(имяRu[1] ?? ''),
    descEn: снять(описание[1] ?? ''),
    descRu: снять(описаниеRu[1] ?? ''),
  });
}

module.exports = { boats };

if (require.main === module) {
  console.log('лодок разобрано:', boats.length);
  for (const b of boats) console.log(`${b.id.padEnd(18)} ${b.en.padEnd(20)} | ${b.ru}`);
}