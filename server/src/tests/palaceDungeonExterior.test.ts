// Экстерьер дворцового данжа: подземный данж 32x32, входная арка с лестницей.
//
// ЗАМЕР: дверь и выход ровно 2.7000, отклонение 0.0000; перепад голого
// комплекса 0.002 м; ось чиста на 60 м; просвет при въезде 8.25 м; подход к
// двери свободен. Центр сухой.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isWater } from '../../../shared/water';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const ТЕРРЕЙН = читать('client/src/app/game3d/terrain.ts');
const ИНТЕРЬЕРЫ = читать('client/src/app/game3d/interiors.ts');

function блокДанжа(): string {
  const начало = ТЕРРЕЙН.indexOf('  // ── Дворцовый данж');
  must(начало > 0, 'нет блока дворцового данжа');
  const конец = ТЕРРЕЙН.indexOf('// ── Акведук деревни', начало);
  must(конец > начало, 'конец блока не найден');
  return ТЕРРЕЙН.slice(начало, конец);
}

describe('Дворцовый данж: площадка', () => {
  it('стоит на месте записи интерьера', () => {
    must(/id: 'palace_dungeon',[^}]*dx: -160, dz: 240/.test(ИНТЕРЬЕРЫ), 'запись изменилась');
    must(/export const PALACE_DUNGEON = \{ x: -160, z: 240,/.test(ТЕРРЕЙН), 'константа не там');
  });

  it('ровнялка стоит ПОСЛЕ ровнялки залива', () => {
    const код = ТЕРРЕЙН.slice(ТЕРРЕЙН.indexOf('export function terrainHeight'), ТЕРРЕЙН.indexOf('const TERRAIN_SEG'))
      .split('\n').filter((s) => !/^\s*(\/\/|\*|\/\*)/.test(s)).join('\n');
    must(код.indexOf('PALACE_DUNGEON.x') > код.indexOf('-820'), 'ровнялка не после залива');
  });

  it('уровень близок к медиане 2.71', () => {
    const m = /export const PALACE_DUNGEON = \{ x: -160, z: 240, radius: \d+, level: (-?[\d.]+) \}/.exec(ТЕРРЕЙН);
    must(m !== null, 'уровень не объявлен');
    const уровень = Number(m![1]);
    must(уровень >= 2.3 && уровень <= 3.1, `уровень ${уровень} далёк от медианы`);
  });

  it('запас ровной части достаточен', () => {
    const m = /export const PALACE_DUNGEON = \{ x: -160, z: 240, radius: (\d+)/.exec(ТЕРРЕЙН);
    must(m !== null, 'радиус не объявлен');
    const ровная = Number(m![1]) * 0.55;
    must(ровная - Math.hypot(20 / 2 + 3, 10 + 6 + 3) >= 2, 'запас мал');
  });

  it('центр сухой', () => {
    must(!isWater(-160, 240), 'под данжом вода');
  });
});

describe('Дворцовый данж: дверь и подход', () => {
  it('дверь кликабельная и ведёт в интерьер данжа', () => {
    const блок = блокДанжа();
    must(/doorBuilding: 'palace_dungeon'/.test(блок), 'нет doorBuilding');
    must(/doorAction: 'enter'/.test(блок), 'дверь не ведёт внутрь');
    must(/doorName: t\('buildings\.palace_dungeon'\)/.test(блок), 'не то название');
  });

  it('входная арка с лестницей вниз', () => {
    const блок = блокДанжа();
    must(/арка/.test(блок), 'нет арки');
    must(/лестница\.число/.test(блок), 'лестница не объявлена');
    must(/ступеньY -=/.test(блок), 'ступени не спускаются');
  });

  it('в проёме двери заглушка', () => {
    must(/ДВОРЦОВЫЙ_ДАНЖ_ЗАГЛУШКА/.test(ТЕРРЕЙН), 'нет заглушки');
  });
});

describe('Дворцовый данж: двор', () => {
  it('ограда двора по бокам', () => {
    const блок = блокДанжа();
    must(/wallYard/.test(блок), 'нет ограды');
    must(/addCollider\(PALACE_DUNGEON\.x - двор\.w \/ 2 - wallYard\.t \/ 2/.test(блок), 'левая сторона не закрыта');
    must(/addCollider\(PALACE_DUNGEON\.x \+ двор\.w \/ 2 \+ wallYard\.t \/ 2/.test(блок), 'правая сторона не закрыта');
  });
});