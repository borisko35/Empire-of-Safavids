// Собирает два варианта одного клипа: с коэффициентом, который применяла игра,
// и с тем, который она должна применять.
//
// Зачем это нужно. Правку нельзя подтвердить числом: пять гипотез подряд
// выводились из чисел и ни одна не подтвердилась, потому что связь нужно было
// увидеть. Здесь получаются два файла, отличающиеся РОВНО одним множителем в
// дорожках перевода. Один и тот же импорт, одна и та же камера, один и тот же
// рендер - и разницу видно глазами.
//
// Перемножаются только дорожки перевода (translation). Повороты и масштабы
// безразмерны, их трогать нельзя: это ровно то же, что делает масштабироватьКлип()
// в realRig.ts.
//
// Запуск: node tools/make-clip-variant.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = join(HERE, '..', 'src', 'app', 'public', 'models');
const OUT = join(process.env.TEMP || '.', 'clip-variants');

const CLIP = process.argv[2] ?? 'standing-idle';
const ВАРИАНТЫ = [
  { имя: 'broken', к: 100 },      // что применяла игра: константа из корневого масштаба
  { имя: 'fixed', к: 231.06 },   // что показало измерение по 55 костям из 55
];

mkdirSync(OUT, { recursive: true });

const src = readFileSync(join(MODELS, `${CLIP}.glb`));

for (const { имя, к } of ВАРИАНТЫ) {
  const buf = Buffer.from(src); // копия: исходный файл не трогаем

  // Смещения в glTF отсчитываются от начала BINARY-чанга.
  let offset = 12;
  let json = null;
  let bin = 0;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(buf.toString('utf8', data, data + len));
    else if (type === 0x004e4942) bin = data;
    offset = data + len + ((4 - (len % 4)) % 4);
  }

  let умножено = 0;
  for (const anim of json.animations ?? []) {
    for (const ch of anim.channels) {
      if (ch.target?.path !== 'translation') continue;
      const acc = json.accessors[anim.samplers[ch.sampler].output];
      // Короткие и целые в дорожках перевода не встречаются, но если встретятся -
      // молча испортить файл хуже, чем отказаться.
      if (acc.componentType !== 5126) throw new Error(`не float: ${acc.componentType}`);
      const view = json.bufferViews[acc.bufferView];
      const stride = view.byteStride ?? 12;
      const base = bin + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      for (let i = 0; i < acc.count; i++) {
        for (let c = 0; c < 3; c++) {
          const at = base + i * stride + c * 4;
          buf.writeFloatLE(buf.readFloatLE(at) * к, at);
        }
      }
      умножено++;
    }
    break;
  }

  const out = join(OUT, `${CLIP}-${имя}.glb`);
  writeFileSync(out, buf);
  console.log(`${имя.padEnd(7)} x${String(к).padEnd(8)} дорожек перевода: ${умножено}  ->  ${out}`);
}
console.log(`\nисходный файл не изменён: ${join(MODELS, `${CLIP}.glb`)}`);