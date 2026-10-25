// НПС без модели: примитив больше не прячется (§341).
//
// ЧТО БЫЛО. `applyRealModel` при неудаче загрузки молча выходил:
// `if (!modelGroup) return;`. Если базовая модель жителя не доехала, NPC
// навсегда оставался процедурным конусом — и ни одной строки в консоли.
// Так торговец в центре площади стоял примитивом (кадр `merchant-probe`),
// хотя вокруг ходили нормальные модели.
//
// ЧТО ТЕПЕРЬ. Не доехала базовая — берём соседнюю (citizen3). Не доехали
// обе — пишем в консоль с id и типом.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function должен(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

describe('НПС: запасная модель', () => {
  const НПС = читать('client/src/app/game3d/npc.ts');
  // Комментарии не считаются кодом: в них разбор «БЫЛО: тихий выход».
  const код = НПС.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('если citizen не доехал — берётся citizen3', () => {
    должен(/let modelGroup = await loadCharacterModel\(modelType\);/.test(НПС),
      'модель снова читается в const без возможности подмены');
    должен(/if \(!modelGroup && modelType === 'citizen'\) \{/.test(НПС),
      'нет запасного пути для базового жителя');
    должен(/modelGroup = await loadCharacterModel\('citizen3'\);/.test(НПС),
      'запасная модель не citizen3: в толпе она уже проверена');
  });

  it('тихого выхода больше нет: о неудаче говорят', () => {
    должен(!/if \(!modelGroup\) return;/.test(код),
      'тихий выход вернулся: примитив снова спрячется');
    должен(/\[npc\] model ne doehal: /.test(НПС),
      'о неудаче не сообщается: причину не найти');
    должен(/ostayotsya primitiv/.test(НПС),
      'в сообщении нет следствия: непонятно, что NPC остался примитивом');
  });
});
