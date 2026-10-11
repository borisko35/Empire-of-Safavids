// Склеивает модель и клип в один glb.
//
// ЗАЧЕМ. Blender разбирает файл с анимацией сам и всегда прав: и кости, и меши,
// и поза берутся из одного импорта. Клип, приведённый отдельно, импортировать
// нечем - в нём нет скина, и импортёр не создаёт скелет. А наша задача - увидеть
// позу ИГРЫ, а не пересказ её вручную.
//
// Склейка переносит в буфер модели только то, чего в ней нет: accessors и
// bufferViews анимации, плюс саму анимацию с пересчитанными индексами узлов.
// Меши, скин и материалы остаются нетронутыми - иначе доказательство перестало
// бы что-то доказывать.
//
// Запуск: node tools/merge-clip.mjs <клип> <коэффициент> <выходной файл>

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = join(HERE, '..', 'src', 'app', 'public', 'models');

const CLIP_NAME = process.argv[2] ?? 'standing-idle';
const SCALE = Number(process.argv[3] ?? 1);
const OUT = process.argv[4] ?? join(processed.env.TEMP ?? '.', 'merged.glb');

/** Раскладывает glb на JSON и BINARY. Смещения в glTF считаются от BINARY-чанка. */
function split(path) {
  const buf = readFileSync(path);
  let off = 12, json = null, bin = 0;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = off + 8;
    if (type === 0x4e4f534a) json = JSON.parse(buf.toString('utf8', data, data + len));
    else if (type === 0x004e4942) bin = data;
    off = data + len + ((4 - (len % 4)) % 4);
  }
  return { json, bin: buf.subarray(bin), buf };
}

const pad4 = (n) => (4 - (n % 4)) % 4;
const clean = (n) => String(n ?? '').replace(/\s/g, '_').replace(/[\[\]\.:\/]/g, '');

const M = split(join(MODELS, 'guard-qizilbash.glb'));
const C = split(join(MODELS, `${CLIP_NAME}.glb`));

const outJson = structuredClone(M.json);

// Узлы модели -> индексы. Узлы клипа ищем по очищенному имени.
const modelNodeIndex = new Map();
outJson.nodes.forEach((n, i) => {
  const key = clean(n.name);
  if (key && !modelNodeIndex.has(key)) modelNodeIndex.set(key, i);
});

// Буфер модели, выровненный, и хвост, в который дописывается буфер клипа.
const head = Buffer.from(M.bin);
const pad = Buffer.alloc(pad4(head.length));
const tail = Buffer.from(C.bin);
const mergedBin = Buffer.concat([head, pad, tail]);
const tailBase = head.length + pad.length;
outJson.buffers = [{ byteLength: mergedBin.length }];

const viewMap = new Map();
for (const v of C.json.bufferViews) {
  const view = structuredClone(v);
  view.buffer = 0;
  view.byteOffset = (v.byteOffset ?? 0) + tailBase;
  if (view.byteStride !== undefined && v.byteOffset === undefined) view.byteOffset = tailBase;
  viewMap.set(v, outJson.bufferViews.length);
  outJson.bufferViews.push(view);
}

const accMap = new Map();
for (const a of C.json.accessors) {
  const acc = structuredClone(a);
  acc.bufferView = viewMap.get(C.json.bufferViews[a.bufferView]);
  accMap.set(a, outJson.accessors.length);
  outJson.accessors.push(acc);
}

// Множитель пишем ТОЛЬКО в переводы. Повороты безразмерны: тот же множитель
// исказил бы позу по-другому, чем это делает игра.
const anim = structuredClone(C.json.animations[0]);
let переводов = 0, поворотов = 0;

// Переносить нужно ОБА accessor'а каждого сэмплера: и время (input), и
// значение (output). Перенос только выхода даёт каналу чужое число кадров,
// и импорт падает ровно на этом месте.
for (const s of anim.samplers) {
  s.input = accMap.get(C.json.accessors[s.input]);
  s.output = accMap.get(C.json.accessors[s.output]);
}

// Множитель пишется в САМИ ДАННЫЕ дорожек перевода. Повороты безразмерны:
// тот же множитель исказил бы позу иначе, чем это делает игра.
for (const ch of anim.channels) {
  if (ch.target.path !== 'translation') continue;
  const acc = outJson.accessors[anim.samplers[ch.sampler].output];
  const view = outJson.bufferViews[acc.bufferView];
  if (acc.componentType !== 5126) throw new Error(`перевод не float: ${acc.componentType}`);
  const stride = view.byteStride ?? 12;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < 3; c++) {
      const at = base + i * stride + c * 4;
      mergedBin.writeFloatLE(mergedBin.readFloatLE(at) * SCALE, at);
    }
  }
  if (acc.min) acc.min = acc.min.map((v) => v * SCALE);
  if (acc.max) acc.max = acc.max.map((v) => v * SCALE);
}

for (const ch of anim.channels) {
  const mapped = modelNodeIndex.get(clean(C.json.nodes[ch.target.node]?.name));
  if (mapped === undefined) { ch.target.node = -1; continue; }
  ch.target.node = mapped;
  ch.target.path === 'translation' ? переводов++ : поворотов++;
}
// Каналы, чей узел не нашёлся, выбрасываем: иначе анимация ударит по чужой кости.
anim.channels = anim.channels.filter((c) => c.target.node >= 0);
outJson.animations = [anim];

const jsonBuf = Buffer.from(JSON.stringify(outJson), 'utf8');
// Выравнивание JSON-чанка - ПРОБЕЛАМИ, а не нулями: нули после закрывающей
// скобки парсер считает «лишними данными» и отказывается читать файл.
// Выравнивание BINARY-чанка нулями - можно и нужно.
const jsonPad = Buffer.alloc(pad4(jsonBuf.length), 0x20);
const binPad = Buffer.alloc(pad4(mergedBin.length));
// Длина чанка по спецификации GLB ВКЛЮЧАЕТ выравнивание, и сам чанк должен
// занимать кратное четырём число байт. Если вынести выравнивание наружу, длина
// чанка перестаёт совпадать с фактической и файл не читается вовсе.
const jsonChunkLen = jsonBuf.length + jsonPad.length;
const binChunkLen = mergedBin.length + binPad.length;
const total = 12 + 8 + jsonChunkLen + 8 + binChunkLen;

const header = Buffer.alloc(12);
header.write('glTF', 0, 'ascii');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);

const chunk = (data, pad, type) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(data.length + pad.length, 0);
  h.writeUInt32LE(type, 4);
  return Buffer.concat([h, data, pad]);
};

writeFileSync(OUT, Buffer.concat([
  header,
  chunk(jsonBuf, jsonPad, 0x4e4f534a),
  chunk(mergedBin, binPad, 0x004e4942),
]));

console.log(`клип ${CLIP_NAME}, множитель ${SCALE}: дорожек перевода ${переводов}, прочих ${поворотов}`);
console.log(`узлов в модели ${outJson.nodes.length}, костей в accessors ${outJson.accessors.length}`);
console.log(`-> ${OUT}`);