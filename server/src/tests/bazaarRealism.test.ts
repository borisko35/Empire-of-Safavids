// Базарные ряды.
//
// ЧТО БЫЛО (§237). Прилавок собирался из двух десятков примитивов: стол на
// ножках, купол навеса из треугольников, кувшины на токарном профиле, рулоны
// ткани, корзина из цилиндров.
//
// ЧТО ТЕПЕРЬ (§326). Ряд — готовая модель торгового навеса (market-stand-1/2,
// Quaternius, CC0): навес, прилавок и полки в одном файле. Товар вокруг —
// готовые кувшин, ящик, мешки и бочка.
//
// ЧТО ПРОВЕРЯЕТСЯ. Модели ряда и товара в манифесте; прилавок ставится
// decorВещем, товар рядом; примитивной сборки больше нет.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function должен(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const МАНИФЕСТ = JSON.parse(читать('client/src/app/public/models/manifest.json')) as {
  decor?: { file: string; name: string; bytes: number }[];
  animals?: { file: string; name: string; bytes: number }[];
};
const вМанифесте = (раздел: 'decor' | 'animals', имя: string): boolean =>
  (МАНИФЕСТ[раздел] ?? []).some((д) => д.name === имя);

const ТЕРРЕЙН = читать('client/src/app/game3d/terrain.ts');
const код = ТЕРРЕЙН.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('Базарные ряды', () => {
  it('ряд — готовый навес-прилавок из манифеста', () => {
    for (const имя of ['market-stand-1', 'market-stand-2']) {
      должен(вМанифесте('decor', имя), `${имя}.glb нет в манифесте`);
    }
    const блок = код.split('function buildStall')[1].split('\n}\n')[0];
    должен(/decorВещь\(stall, kind % 2 \? 'market-stand-2' : 'market-stand-1', 0, 0, \{/.test(блок),
      'ряд ставится не готовой моделью');
  });

  it('товар у прилавка — готовые кувшин, ящик, мешки и бочка', () => {
    for (const имя of ['clay-jug', 'crate', 'bags', 'barrel']) {
      должен(вМанифесте('decor', имя), `${имя}.glb нет в манифесте`);
    }
    const блок = код.split('function buildStall')[1].split('\n}\n')[0];
    должен(/'clay-jug'/.test(блок) && /'crate'/.test(блок) && /'bags'/.test(блок) && /'barrel'/.test(блок),
      'товар у прилавка не из готовых моделей');
  });

  it('примитивной сборки прилавка больше нет', () => {
    должен(!/LatheGeometry/.test(код.split('function buildStall')[1].split('\n}\n')[0] ?? ''),
      'кувшины снова на токарном профиле');
    должен(!/const полотнище = new THREE\.Mesh\(/.test(код.split('function buildStall')[1].split('\n}\n')[0]),
      'полотнище вернулось');
  });
});
