// Товар на базарных рядах.
//
// ЧТО ТЕПЕРЬ (§326). Ряды стоят в столице (у стен и у мечети) и в городах
// регионов; каждый ряд — готовая модель с товаром у прилавка.
//
// ЧТО ПРОВЕРЯЕТСЯ. Ряды расставлены в столице и в регионах; ряд добавляется
// в сцену, а не строится впустую.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function должен(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const ТЕРРЕЙН = читать('client/src/app/game3d/terrain.ts');
const код = ТЕРРЕЙН.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('Товар на рядах', () => {
  it('ряды стоят в столице и в городах регионов', () => {
    // Два места вызова buildStall в столице + регионы.
    должен((код.match(/buildStall\(/g) || []).length >= 4, `рядов мало: ${(код.match(/buildStall\(/g) || []).length}`);
  });

  it('ряд добавляется в сцену', () => {
    должен(/const stall = buildStall\(stallKinds\[i\], canopies\);/.test(код), 'ряд не собирается');
    должен(/stall\.rotation\.y = -a;/.test(код), 'ряд не повёрнут к проходу');
  });
});
