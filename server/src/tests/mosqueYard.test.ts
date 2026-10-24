// Двор мечети снаружи.
//
// ЧТО ТЕПЕРЬ (§326). Кипарисы по сторонам подхода — готовая GLB-модель
// кипариса (Google Poly, CC-BY), у входа фонари.
//
// ЧТО ПРОВЕРЯЕТСЯ. Модель кипариса в манифесте; у подхода стоят готовые
// кипарисы с коллайдерами; у входа фонари со светом.
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

describe('Двор мечети снаружи', () => {
  it('к воротам ведёт мостовая', () => {
    должен(/const подход = new THREE\.Mesh\(/.test(код), 'к воротам мечети нет мостовой');
  });

  it('по сторонам подхода готовые кипарисы, у входа фонари', () => {
    должен(вМанифесте('decor', 'cypress'), 'cypress.glb нет в манифесте');
    должен(/decorВещь\(scene, 'cypress', x, z, \{/.test(код), 'у подхода стоят не готовые кипарисы');
    // Опции декорВещь многострочные, поэтому коллайдер ищется рядом отдельно.
    должен(/decorВещь\(scene, 'cypress', x, z, \{[\s\S]{0,400}?\}\);\s*addCollider\(x, z, 0\.6\);/.test(код), 'у кипарисов мечети нет коллайдеров');
    должен(/const высотаОгня = фонарь\(/.test(код), 'у входа нет фонарей');
  });
});
