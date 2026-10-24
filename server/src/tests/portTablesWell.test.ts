// Порт: лодки у причала, столы с сетями.
//
// ЧТО ТЕПЕРЬ (§326). Лодки у причала — готовая GLB-модель (Quaternius);
// столы с сетями остались своими — это рабочее место с предметами, а не
// заглушка.
//
// ЧТО ПРОВЕРЯЕТСЯ. Модель лодки в манифесте; у причала стоят готовые лодки;
// столы и сети на месте.
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

describe('Порт', () => {
  it('лодки у причала — готовые модели', () => {
    должен(вМанифесте('decor', 'boat'), 'boat.glb нет в манифесте');
    const блок = код.split('case \'port\':')[1].split('case ')[0];
    должен(/decorВещь\(пирс, 'boat',/.test(блок), 'у причала стоят не готовые лодки');
    // Сплюснутых цилиндров-поплавков больше нет.
    должен(!/CylinderGeometry\(0\.85, 0\.45, 3\.2, 7\)/.test(код), 'лодки снова поплавки');
  });

  it('стол: столешница, полка, ткань и товар', () => {
    должен(
      /const table = new THREE\.Mesh\(new THREE\.BoxGeometry\(1\.8, 0\.08, 1\.0\), MAT\.wood\);/.test(ТЕРРЕЙН),
      'столешницы стола нет: стол — ящик',
    );
    должен(/const полка = new THREE\.Mesh\(new THREE\.BoxGeometry\(1\.6, 0\.06, 0\.8\), MAT\.wood\);/.test(ТЕРРЕЙН),
      'у стола нет полки с товаром');
    должен(/const горшок = new THREE\.Mesh\(new THREE\.CylinderGeometry\(0\.13, 0\.18, 0\.36, 8\)/.test(ТЕРРЕЙН),
      'на столе нет горшка');
  });

  it('колодец площади региона — готовая модель', () => {
    должен(вМанифесте('decor', 'well'), 'well.glb нет в манифесте');
    должен(/decorВещь\(g, 'well', 0, 0, \{ размер: [\d.]+, y: 0, ry: [\d.]+ \}\);/.test(ТЕРРЕЙН),
      'колодец площади стоит не готовой моделью');
    должен(!/TorusGeometry\(1\.28, 0\.16, 6, 14\)/.test(ТЕРРЕЙН), 'ворот колодца снова торус');
  });

  it('пирс из досок и столы с сетями на месте', () => {
    должен(/const пирс = new THREE\.Group\(\);/.test(код), 'нет пирса');
    должен(/const plank = new THREE\.Mesh\(new THREE\.BoxGeometry\(2\.2, 0\.16, 1\.7\), MAT\.wood\);/.test(код),
      'пирс без досок');
  });
});
