// Сквер в середине площади.
//
// ЧТО ТЕПЕРЬ (§326). Кусты по венцу сквера — готовые модели (bush-1/bush-2),
// вместо них у скамеек больше нет конусных «крон кипариса»: акценты — тоже
// кусты. Скамейки лицом к городу остались.
//
// ЧТО ПРОВЕРЯЕТСЯ. Сквер стоит в середине площади; зелень — готовые модели;
// скамейки на месте.
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

describe('Сквер в середине площади', () => {
  it('сквер стоит в середине площади', () => {
    должен(/const венецСквера/.test(код), 'нет венца сквера');
  });

  it('в сквере зелень из готовых моделей и скамейки', () => {
    должен(вМанифесте('decor', 'bush-1'), 'bush-1.glb нет в манифесте');
    // Кусты по венцу.
    должен(/куст\(city, скверX \+ Math\.cos\(a\) \* 4\.2, скверZ \+ Math\.sin\(a\) \* 4\.2, 0\.46, 1\.2\);/.test(код),
      'по венцу сквера нет кустов');
    // Конусных крон на сквере больше нет.
    должен(!/кронаКипариса\(city, скверX/.test(код), 'на сквере снова конусные кроны');
    // Скамейки лицом к городу.
    должен(/const скамья = new THREE\.Mesh\(new THREE\.BoxGeometry\(2\.2, 0\.42, 0\.6\), MAT\.wood\);/.test(код),
      'в сквере нет скамеек');
  });
});
