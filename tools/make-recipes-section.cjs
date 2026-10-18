// Создаёт пустой раздел recipes в словарях, если его ещё нет.
// Нужен, чтобы новый раздел появился в правильном месте файла — рядом с
// craft, — а не в конце словаря, куда его положило бы простое дописывание.
const fs = require('fs');
const path = require('path');

const корень = path.join(__dirname, '..');

for (const код of ['ru', 'en', 'az']) {
  const путь = path.join(корень, 'shared', 'locales', `${код}.json`);
  const текст = fs.readFileSync(путь, 'utf8');
  if (new RegExp(`^ {2}"recipes":`, 'm').test(текст)) {
    console.log(`${код}: раздел recipes уже есть`);
    continue;
  }
  const блокCraft = /^ {2}"craft": \{[\s\S]*?\r?\n {2}\},/m.exec(текст);
  if (!блокCraft) {
    console.error(`${код}: блок craft не найден — раздел recipes не создан`);
    process.exit(1);
  }
  // Перевод строки берётся из САМОГО файла, а не выводится по последнему
  // символу блока craft. Блок craft заканчивается «  },» без перевода
  // строки, поэтому endsWith('\r\n') всегда было ложно: в файл с LF
  // вставлялась строка с CRLF, и граница блока recipes соскальзывала на
  // символ. Раздел закрывался не там, где стоял, и следующий ключ
  // приклеивался к скобке.
  const переводСтроки = текст.includes('\r\n') ? '\r\n' : '\n';
  const вставка = `${блокCraft[0]}${переводСтроки}  "recipes": {},`;
  fs.writeFileSync(путь, текст.replace(блокCraft[0], вставка), 'utf8');
  // Проверка сразу: раздел только что вставлен, и если что-то не так —
  // это видно здесь, а не через час в игре.
  const j = JSON.parse(fs.readFileSync(путь, 'utf8'));
  console.log(`${код}: раздел recipes создан, JSON разбирается, разделов ${Object.keys(j).length}`);
}