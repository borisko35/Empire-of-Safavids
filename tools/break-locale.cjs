// Ломает словарь по требованию: удаляет ключ из блока items ИЛИ подменяет
// его значение. Нужно, чтобы доказать проверку откатом: тест обязан
// заметить и пропавший перевод, и подменённое название, иначе он ничего
// не охраняет.
//
// node break-locale.cjs <файл.json> удалить <ключ>
// node break-locale.cjs <файл.json> заменить <ключ> <новый текст>
const fs = require('fs');

// Имена переменных латиницей — не для красоты: PowerShell теряет
// кириллицу при передаче аргументов командной строки, и переменная
// превращалась в ReferenceError прямо при первом обращении.
const [file, action, key, ...rest] = process.argv.slice(2);
if (!file || !action || !key) {
  console.error('usage: node break-locale.cjs <file.json> delete|replace <key> [text]');
  process.exit(2);
}

const text = fs.readFileSync(file, 'utf8');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

if (action === 'delete') {
  const re = new RegExp(`^ {4}"${escapeRe(key)}": ".*",?\\r?\\n`, 'm');
  if (!re.test(text)) {
    console.error(`key ${key} not found in ${file}`);
    process.exit(1);
  }
  fs.writeFileSync(file, text.replace(re, ''), 'utf8');
  console.log(`deleted key ${key} from ${file}`);
}

if (action === 'replace') {
  const value = rest.join(' ');
  if (!value) {
    console.error('no replacement text given');
    process.exit(2);
  }
  const re = new RegExp(`(^ {4}"${escapeRe(key)}": )"[^"]*"`, 'm');
  if (!re.test(text)) {
    console.error(`key ${key} not found in ${file}`);
    process.exit(1);
  }
  fs.writeFileSync(file, text.replace(re, `$1"${value}"`), 'utf8');
  console.log(`${key} in ${file} replaced with "${value}"`);
}