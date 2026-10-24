// Верблюд каравана.
//
// ЧТО БЫЛО (§294). Верблюд собирался из капсул: тело, горбы-шары, ноги из
// цилиндров.
//
// ЧТО ТЕПЕРЬ (§327). Караванный верблюд — готовая статичная модель
// дромадера (Google Poly, CC-BY), на ходу качается корпус. Тюки и попона
// ушли с процедурной сборкой.
//
// ЧТО ПРОВЕРЯЕТСЯ. Модель в манифесте; roadTraffic ставит её через
// собратьЗверя; корпус качается на ходу; капсульной сборки больше нет.
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

describe('Верблюд каравана', () => {
  it('модель дромадера лежит в сборке', () => {
    должен(вМанифесте('animals', 'camel'), 'camel.glb нет в манифесте');
  });

  it('верблюд ставится моделью и качается на ходу', () => {
    должен(/void собратьЗверя\('camel', [\d.]+\)\.then/.test(ТРАФИК),
      'верблюд ставится не моделью');
    должен(/качание: true, копытный: true,/.test(ТРАФИК), 'верблюд не качается и без пыли');
    должен(!/CapsuleGeometry\(0\.42, 1\.05, 4, 12\)/.test(ТРАФИК), 'верблюд снова капсула');
  });
});
