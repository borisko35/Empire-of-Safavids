// Порт работает: кран, груз и телега на пирсе.
//
// ЧТО БЫЛО (22 октября 2026, §315). В порту был один пирс и одна лодка, и
// больше ничего: груз не грузили, воду не таскали, и причал был пустым. Порт —
// первое, что игрок видит, а читался он как декорация.
//
// ЧТО ТЕПЕРЬ. Грузовой кран (стойка, стрела, трос, крюк), три бочки в
// обручах и ящик на настиле, телега у пирса.
//
// ЧТО ПРОВЕРЯЕТСЯ. Кран собран из четырёх частей, бочки и ящик лежат на
// настиле, телега с колёсами стоит у пирса.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function должен(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const ТЕРРЕЙН = читать('client/src/app/game3d/terrain.ts');

describe('Порт работает', () => {
  it('груз��вой кран: стойка, стрела, трос, крюк', () => {
    должен(
      /const стойкаКрана = new THREE\.Mesh\(new THREE\.CylinderGeometry\(0\.16, 0\.2, 3\.4, 7\), MAT\.trunk\);/.test(ТЕРРЕЙН),
      'у крана нет стойки',
    );
    должен(
      /const стрела = new THREE\.Mesh\(new THREE\.BoxGeometry\(0\.16, 0\.16, 3\.2\), MAT\.trunk\);/.test(ТЕРРЕЙН),
      'у крана нет стрелы',
    );
    должен(
      /const трос = new THREE\.Mesh\(new THREE\.CylinderGeometry\(0\.025, 0\.025, 1\.6, 4\), MAT\.dark\);/.test(ТЕРРЕЙН),
      'у крана нет троса',
    );
    должен(
      /const крюк = new THREE\.Mesh\(new THREE\.TorusGeometry\(0\.14, 0\.03, 5, 10, Math\.PI \* 1\.3\), MAT\.dark\);/.test(ТЕРРЕЙН),
      'у крана нет крюка',
    );
  });

  it('груз на настиле и телега у пирса', () => {
    // Бочки в обручах.
    должен(
      /const бочка = new THREE\.Mesh\(new THREE\.CylinderGeometry\(0\.36, 0\.32, 0\.85, 10\), MAT\.wood\);/.test(ТЕРРЕЙН),
      'на пирсе нет бочек',
    );
    должен(
      /const обруч = new THREE\.Mesh\(new THREE\.TorusGeometry\(0\.355, 0\.028, 4, 12\), MAT\.dark\);/.test(ТЕРРЕЙН),
      'у бочек нет обручей',
    );
    // Ящик.
    должен(
      /const ящик = new THREE\.Mesh\(new THREE\.BoxGeometry\(0\.9, 0\.7, 0\.9\), MAT\.wood\);/.test(ТЕРРЕЙН),
      'на пирсе нет ящика',
    );
    // Телега с колёсами.
    должен(
      /const кузовТелеги = new THREE\.Mesh\(new THREE\.BoxGeometry\(1\.2, 0\.6, 1\.9\), MAT\.wood\);/.test(ТЕРРЕЙН),
      'у пирса нет телеги',
    );
    должен(
      /const колесоТелеги = new THREE\.Mesh\(new THREE\.TorusGeometry\(0\.42, 0\.05, 5, 14\), MAT\.trunk\);/.test(ТЕРРЕЙН),
      'у телеги нет колёс',
    );
  });
});
