// ============================================================
// Сборщик установщика игры — Empire of Safavids
// ============================================================
// Упаковывает комплект (иконка, система ярлыков, лаунчер,
// деинсталлятор, readme) в base64-контейнер и приклеивает его
// к телу install/installer-template.cmd — получается
// самораспаковочный установщик install/install-game.cmd,
// который сервер раздаёт по адресу /download/installer.
//
// Контейнер: [u16 длина имени][имя UTF-8][u32 длина][данные]...
// Распаковка — PowerShell-кодом внутри шаблона (после exit /b).
//
// Запуск: node tools/build-installer.js

'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const installDir = path.join(root, 'site', 'install');

const PAYLOAD_FILES = [
  'game.ico',
  'shortcuts.ps1',
  'launcher.cmd',
  'uninstall-game.cmd',
  'readme.txt',
];

function packContainer(dir, names) {
  const chunks = [];
  for (const name of names) {
    let data = name.endsWith('.cmd')
      ? readCmdFile(name)
      : fs.readFileSync(path.join(dir, name));
    // PowerShell 5.1 читает UTF-8 без BOM как ANSI — гарантируем BOM
    if (name.endsWith('.ps1') && !(data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF)) {
      data = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), data]);
    }
    const nameBuf = Buffer.from(name, 'utf8');
    const len = Buffer.alloc(2);
    len.writeUInt16LE(nameBuf.length);
    const dataLen = Buffer.alloc(4);
    dataLen.writeUInt32LE(data.length);
    chunks.push(len, nameBuf, dataLen, data);
  }
  return Buffer.concat(chunks);
}

function toBase64Block(buf, width = 76) {
  const b64 = buf.toString('base64');
  const lines = [];
  for (let i = 0; i < b64.length; i += width) lines.push(b64.slice(i, i + width));
  return lines.join('\r\n');
}

// ── Кодировка CP1251 для .cmd ────────────────────────────────
// cmd.exe с chcp 65001 (UTF-8) известен багом парсинга: много-байтовые
// символы на границах блоков чтения сбивают позицию парсера — batch
// начинает выполнять «хвосты» строк. Поэтому все .cmd установщика
// собираются в однобайтовой CP1251 (байт = символ, бага нет).
// Исходники хранятся в UTF-8, конвертация — на этапе сборки.
const cp1251Decoder = new TextDecoder('windows-1251');
const cp1251Map = new Map();
for (let b = 0; b < 256; b++) {
  const ch = cp1251Decoder.decode(Uint8Array.of(b));
  if (!cp1251Map.has(ch)) cp1251Map.set(ch, b);
}

function encodeCp1251(str) {
  const bytes = [];
  for (const ch of str) {
    const b = cp1251Map.get(ch);
    if (b !== undefined) bytes.push(b);
    else bytes.push(...Buffer.from(ch, 'utf8'));
  }
  return Buffer.from(bytes);
}

/** Файл .cmd из комплекта: UTF-8 на диске -> CP1251 + chcp 1251 */
function readCmdFile(file) {
  const text = fs.readFileSync(path.join(installDir, file), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/chcp 65001/g, 'chcp 1251')
    .replace(/\n/g, '\r\n');
  return encodeCp1251(text);
}

const container = packContainer(installDir, PAYLOAD_FILES);
let template = fs.readFileSync(path.join(installDir, 'installer-template.cmd'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/chcp 65001/g, 'chcp 1251');

if (!template.includes(':::PAYLOAD:::')) {
  console.error('✗ В installer-template.cmd нет маркера :::PAYLOAD:::');
  process.exit(1);
}

const installerText =
  template.trimEnd().replace(/\n/g, '\r\n') + '\r\n' + toBase64Block(container) + '\r\n';

const out = path.join(installDir, 'install-game.cmd');
fs.writeFileSync(out, encodeCp1251(installerText)); // CP1251 — однобайтовая кодировка для cmd

console.log('✓', path.relative(root, out), (installerText.length / 1024).toFixed(1) + ' KB',
  `(комплект: ${PAYLOAD_FILES.join(', ')})`);
console.log('Installer build complete.');
