// Растительность полей и гор — не примитивы.
//
// ЧТО БЫЛО (§287). Камни — икосаэдры, трава — клинья, цветы — шары на
// стеблях, саксаул — цилиндр с шарами, ели — конусы в два слоя.
//
// ЧТО ТЕПЕРЬ (§326). Готовые модели (Quaternius): камни (rock-1..5, полем),
// трава (grass-tuft-1..3), цветы (flower-1..4), саксаул (bush-1/bush-2 с
// песочным множителем), ели (pine-1..3).
//
// ЧТО ПРОВЕРЯЕТСЯ. Модели в манифесте; поля собираются decorПолем; наклон
// камней; оттенки травы и саксаула; примитивов больше нет.
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

describe('Растительность полей и гор', () => {
  it('камни — готовые валуны полем', () => {
    for (const имя of ['rock-1', 'rock-2', 'rock-3', 'rock-4', 'rock-5']) {
      должен(вМанифесте('decor', имя), `${имя}.glb нет в манифесте`);
    }
    const блок = ТЕРРЕЙН.split('Камни: готовые валуны')[1].split('Трава: готовые пучки')[0];
    должен(/decorПоле\(scene, имя, rockPoints\[i\], \{ по: 'horizontal'/.test(блок),
      'камни поставлены не полем');
    // Наклон: камень, лежащий ровно, читается арбузом.
    должен(/наклон: \(rng\(\) - 0\.5\) \* 0\.4,/.test(блок), 'камни лежат ровно');
    должен(!/IcosahedronGeometry\(1, 0\)/.test(код), 'камни снова икосаэдры');
    // Коллайдеры камней остались.
    должен(/addCollider\(s\.x, s\.z, big \? 1\.4 : 0\.9\);/.test(блок), 'у камней нет коллайдеров');
  });

  it('трава и цветы — готовые модели', () => {
    for (const имя of ['grass-tuft-1', 'grass-tuft-2', 'grass-tuft-3', 'flower-1', 'flower-2', 'flower-3', 'flower-4']) {
      должен(вМанифесте('decor', имя), `${имя}.glb нет в манифесте`);
    }
    должен(!/const tuftGeo = new THREE\.BufferGeometry\(\);/.test(код), 'трава снова клинья');
    должен(!/const flowerGeo = new THREE\.SphereGeometry\(0\.12, 5, 4\);/.test(код), 'цветы снова шары');
  });

  it('саксаул — куст с песочным множителем', () => {
    должен(вМанифесте('decor', 'bush-1'), 'bush-1.glb нет в манифесте');
    const блок = ТЕРРЕЙН.split('Пустынный кустарник (саксаул)')[1].split('Горная хвоя')[0];
    должен(/tint: new THREE\.Color\(\)\.setHSL\(0\.11, 0\.28/.test(блок),
      'куст саксаула не выцвелен в песок');
    должен(!/SphereGeometry\(0\.8, 7, 5\)/.test(код), 'саксаул снова шары');
  });

  it('горная хвоя — готовые ели', () => {
    for (const имя of ['pine-1', 'pine-2', 'pine-3']) {
      должен(вМанифесте('decor', имя), `${имя}.glb нет в манифесте`);
    }
    const блок = ТЕРРЕЙН.split('Горная хвоя: готовые ели')[1].split('Пальмы-оазисы')[0];
    должен(/decorПоле\(scene, имя, pinePoints\[i\]/.test(блок), 'ели поставлены не полем');
    должен(!/ConeGeometry\(1\.2, 4\.4, 6\)/.test(код), 'ели снова конусы');
    должен(/addCollider\(s\.x, s\.z, 0\.5\);/.test(блок), 'у елей нет коллайдеров');
  });
});
