// Пригород оживает.
//
// ЧТО БЫЛО (22 октября 2026, §310). За стеной стояли два дома, склады и
// мастерская — и больше ничего. Место было обжитым, но пустым: ни наковальни,
// ни горна, ни колодца, ни бочек, ни дров.
//
// ЧТО ТЕПЕРЬ. Кузница с горном (угли тлеют), наковальня с рогом и пнем с
// топором; колодец с валом, стойками, верёвкой и ведром; у склада — телега с
// колёсами со спицами и оглоблем, бочки в обручах, мешок и поленница.
//
// ЧТО ПРОВЕРЯЕТСЯ. Кузница, колодец, телега, бочки и поленница есть и собраны
// из настоящих деталей.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function должен(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const ТЕРРЕЙН = читать('client/src/app/game3d/terrain.ts');

describe('Пригород оживает', () => {
  it('кузница: горн с углями, наковальня, пень с топором', () => {
    // Горн.
    должен(
      /const горн = new THREE\.Mesh\(new THREE\.BoxGeometry\(2\.0, 1\.1, 1\.4\), MAT\.sandstone\);/.test(ТЕРРЕЙН),
      'у кузницы нет горна',
    );
    // Угли тлеют.
    должен(
      /const угли = new THREE\.Mesh\(\s*new THREE\.BoxGeometry\(1\.3, 0\.2, 0\.9\),\s*new THREE\.MeshStandardMaterial\(\{ color: 0x3a1a10, emissive: 0xc4400a/.test(ТЕРРЕЙН),
      'в горне нет тлеющих углей',
    );
    // Наковальня с рогом.
    должен(
      /const наковальня = new THREE\.Mesh\(new THREE\.BoxGeometry\(0\.9, 0\.26, 0\.34\), MAT\.dark\);/.test(ТЕРРЕЙН),
      'у кузницы нет наковальни',
    );
    должен(/const рог = new THREE\.Mesh\(new THREE\.ConeGeometry\(0\.13, 0\.5, 7\)/.test(ТЕРРЕЙН),
      'у наковальни нет рога');
    // Топор в пне.
    должен(/const топор = new THREE\.Mesh\(new THREE\.BoxGeometry\(0\.07, 0\.75, 0\.04\)/.test(ТЕРРЕЙН),
      'у кузницы нет топора');
  });

  it('колодец: вал, стойки, верёвка, ведро', () => {
    должен(
      /const вал = new THREE\.Mesh\(new THREE\.CylinderGeometry\(0\.08, 0\.08, 1\.5, 6\), MAT\.trunk\);/.test(ТЕРРЕЙН),
      'у колодца нет вала',
    );
    должен(
      /const верёвка = new THREE\.Mesh\(new THREE\.CylinderGeometry\(0\.02, 0\.02, 1\.1, 4\), MAT\.dark\);/.test(ТЕРРЕЙН),
      'у колодца нет верёвки',
    );
    должен(
      /const ведро = new THREE\.Mesh\(new THREE\.CylinderGeometry\(0\.19, 0\.16, 0\.28, 9\), MAT\.wood\);/.test(ТЕРРЕЙН),
      'у колодца нет ведра',
    );
  });

  it('у склада — телега со спицами, бочки в обручах, поленница', () => {
    // Телега и её колесо со спицами.
    должен(
      /const кузов = new THREE\.Mesh\(new THREE\.BoxGeometry\(1\.3, 0\.7, 2\.2\), MAT\.wood\);/.test(ТЕРРЕЙН),
      'у склада нет телеги',
    );
    должен(/const обод = new THREE\.Mesh\(new THREE\.TorusGeometry\(0\.48, 0\.05, 5, 14\), MAT\.trunk\);/.test(ТЕРРЕЙН),
      'у телеги нет обода колеса');
    должен(
      /const спица = new THREE\.Mesh\(new THREE\.BoxGeometry\(0\.05, 0\.9, 0\.05\), MAT\.wood\);/.test(ТЕРРЕЙН),
      'у колеса телеги нет спиц',
    );
    // Бочка в обручах — сборщик бочек.
    должен(
      /const обруч = new THREE\.Mesh\(new THREE\.TorusGeometry\(0\.355 \* k, 0\.028, 4, 12\), MAT\.dark\);/.test(ТЕРРЕЙН),
      'у бочек нет обручей',
    );
    // Поленница: ряды поленьев.
    должен(/const полено = new THREE\.Mesh\(new THREE\.CylinderGeometry\(0\.13, 0\.13, 1\.5, 6\), MAT\.trunk\);/.test(ТЕРРЕЙН),
      'нет поленницы');
  });
});
