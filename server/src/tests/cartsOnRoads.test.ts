// Телеги на дорогах.
//
// ЧТО БЫЛО (§295). Телега — кузов из ящиков, колёса из торусов со спицами,
// лошадь из капсул; колёса крутились.
//
// ЧТО ТЕПЕРЬ (§327). Телега — готовая модель medieval-cart-lite (та же, что
// у рынка), лошадь — ригованная модель с клипом шага, возница сидит с клипом
// сидения. Колёса у готовой телеги не крутятся — они часть меша.
//
// ЧТО ПРОВЕРЯЕТСЯ. Телега едет из decor, лошадь — из animals; обе ставятся
// собратьЗверем/декором; телеги стоят на дорогах.
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

const ТРАФИК = читать('client/src/app/game3d/roadTraffic.ts');

describe('Телеги на дорогах', () => {
  it('телега — готовая модель из decor', () => {
    должен(вМанифесте('decor', 'medieval-cart-lite'), 'medieval-cart-lite нет в манифесте');
    должен(/void loadDecorModel\('decor\/medieval-cart-lite\.glb'\)\.then/.test(ТРАФИК),
      'телега ставится не готовой моделью');
    должен(!/BoxGeometry\(1\.3, 0\.7, 2\.2\)/.test(ТРАФИК), 'кузов телеги снова ящик');
  });

  it('лошадь в оглобле — ригованная модель, возница сидит', () => {
    должен(вМанифесте('animals', 'horse'), 'horse.glb нет в манифесте');
    должен(/void собратьЗверя\('horse', [\d.]+\)\.then/.test(ТРАФИК), 'лошадь ставится не моделью');
    должен(/собратьПутника\(idx, 'sitIdle'\)/.test(ТРАФИК), 'возница не сидит в клипе сидения');
    должен(!/CapsuleGeometry\(0\.42, 1\.1, 4, 12\)/.test(ТРАФИК), 'лошадь снова капсула');
  });

  it('телеги стоят на дорогах', () => {
    должен(/const телега = makeCart\(12 \+ i\);/.test(ТРАФИК), 'телеги не собираются');
    должен(/телега\.len = roadLength\(road\);/.test(ТРАФИК), 'телеге не назначена дорога');
  });
});
