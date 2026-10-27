// Точный удар по уязвимому месту (§355): удар в спину.
//
// ЗА ЧТО БОРЕТСЯ. Пункт владельца «уязвимые зоны» стоял в списке механик,
// а у сервера не было ни одного уязвимого места: направление игрока
// транслировалось соседям и нигде не хранилось, у монстра направления не
// было вовсе. Спина не считалась бы даже при желании.
//
// ГЛАВНАЯ ОПАСНОСТЬ — АНТИЧИТ. Порог античита сравнивает урон с базой той
// же формулы. Если множитель спины войдёт в урон, но не в базу, честный
// удар в спину (×1.5) на первом же крихте объявлялся бы подделкой урона —
// мерой 3, перманентным баном. Ровно это уже случалось с оружием, поэтому
// здесь проверяются ОБА места: множитель и в уроне, и в базе.
//
// ВТОРАЯ ОПАСНОСТЬ — «ВЫГОДНОЕ СОМНЕНИЕ». Направления нет (игрок не шёл,
// монстр стоит столбом) — спины нет. Правило обязано трактовать пустоту
// против атакующего, иначе бонус собирался бы из воздуха.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isBehindTarget, BACK_STRIKE_MULT, BACK_STRIKE_COS } from '../../../shared/backStrike';
import { AISystem, type AIContext } from '../systems/AISystem';
import { MONSTERS_DATABASE } from '../data/monsters';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

describe('Геометрия спины', () => {
  const цель = { x: 0, z: 0 };
  const взгляд = { x: 1, z: 0 }; // смотрит на восток

  it('прямо за спиной — спина', () => {
    must(isBehindTarget(цель, взгляд, { x: -5, z: 0 }), 'атакующий точно позади не признан в спину');
  });

  it('прямо перед носом — не спина', () => {
    must(!isBehindTarget(цель, взгляд, { x: 5, z: 0 }), 'атакующий перед лицом цели признан в спину');
  });

  it('строго сбоку — не спина: граница отсекает бок', () => {
    must(!isBehindTarget(цель, взгляд, { x: 0, z: 5 }), 'атакующий сбоку (90°) признан в спину');
    must(!isBehindTarget(цель, взгляд, { x: 0, z: -5 }), 'атакующий с другого бока признан в спину');
  });

  it('граница дуги соответствует объявленной', () => {
    // cos(110°) ≈ -0.342: на границе удар считается точным только за ней.
    must(Math.abs(BACK_STRIKE_COS - Math.cos(110 * Math.PI / 180)) < 0.01,
      `BACK_STRIKE_COS = ${BACK_STRIKE_COS} не совпадает с объявленными 110°`);
    must(BACK_STRIKE_MULT > 1, 'множитель спины меньше единицы: удар в спину слабее обычного');
  });

  it('нет направления — нет спины: сомнение против атакующего', () => {
    must(!isBehindTarget(цель, null, { x: -5, z: 0 }), 'цель без направления открыла спину');
    must(!isBehindTarget(цель, { x: 0, z: 0 }, { x: -5, z: 0 }), 'нулевой вектор взгляда открыл спину');
    must(!isBehindTarget(цель, взгляд, { x: 0, z: 0 }), 'атакующий внутри цели признан в спину');
  });
});

describe('Направление монстра выводится из поведения', () => {
  const ai = new AISystem();
  const определение = Object.values(MONSTERS_DATABASE)[0];

  function контекст(над: Partial<AIContext>): AIContext {
    const базовый = ai.spawnMonster(определение, { x: 0, y: 0, z: 0 }, 'isfahan');
    return { ...базовый, ...над };
  }

  it('патрулирующий смотрит на точку маршрута', () => {
    const ctx = контекст({
      state: 'patrol',
      patrolPoints: [{ x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }],
      patrolIndex: 0,
      targetPosition: null,
    });
    const взгляд = ai.facingOf(ctx);
    must(взгляд !== null, 'патрулирующий смотрит кругом');
    must(взгляд!.x > 0 && Math.abs(взгляд!.z) < 1e-9, 'патрулирующий смотрит не на точку маршрута');
  });

  it('бьющий смотрит на свою цель: спина открыта, только пока он занят другим', () => {
    const ctx = контекст({
      state: 'attack',
      targetPosition: { x: 8, y: 0, z: 0 },
      patrolPoints: [{ x: 0, y: 0, z: 0 }],
      patrolIndex: 0,
    });
    const взгляд = ai.facingOf(ctx);
    must(взгляд !== null && взгляд.x > 0, 'атакующий монстр смотрит не на свою цель');
  });

  it('стоящий столбом смотрит кругом: спины нет', () => {
    const ctx = контекст({ state: 'idle', targetPosition: null, patrolPoints: [], patrolIndex: 0 });
    must(ai.facingOf(ctx) === null, 'стоящий монстр открыл спину');
  });
});

describe('Проводка: множитель и в уроне, и в античит-базе', () => {
  const обработчик = читать('server/src/socket/GameSocketHandler.ts');
  const клиент = читать('client/src/app/world.ts');
  const защита = читать('server/src/systems/DefenseStates.ts');

  it('обе ветви боя умножают урон и базу античита', () => {
    const умноженийУрона = (обработчик.match(/result\.damage = Math\.floor\(result\.damage \* BACK_STRIKE_MULT\)/g) ?? []).length;
    must(умноженийУрона === 2, `ветвей с множителем спины ${умноженийУрона}, а не две (PvE и PvP)`);
    const баз = (обработчик.match(/getBaseDamageForAnticheat\([^)]*\) \* \(вСпину \? BACK_STRIKE_MULT : 1\)/g) ?? []).length;
    must(баз === 2, `античит-база учитывает спину в ${баз} ветвях, а не в двух: честный удар в спину банит`);
  });

  it('только обычный удар: навыки спины не открывают', () => {
    must((обработчик.match(/action\.actionType === 'attack' && !action\.skillId/g) ?? []).length >= 2,
      'проверка обычного удара потерялась: навык издали объявил бы спину');
  });

  it('направление игрока живёт, умирает и берётся из пакета движения', () => {
    // §356: карта направлений переехала в DefenseStates — её читают обе
    // ветви боя. Здесь проверяется запись; чистка и чтение тиком — ниже.
    must(/setFacing\(characterId, \{ x: data\.direction\.x, z: data\.direction\.z \}\)/.test(обработчик),
      'направление не пишется из пакета движения');
    must(/defenseStates\.getFacing\(target\.id\)/.test(обработчик),
      'PvP берёт направление не из DefenseStates');
    must(/getPosition\(attacker\.id\)/.test(обработчик) && /getPosition\(characterId: string\)/.test(защита),
      'спина считается не по серверной позиции досягаемости: уязвимое место разойдётся с ударом');
  });

  it('клиент отличает точный удар от крита', () => {
    must(/isPrecise\?/.test(клиент), 'клиент не читает пометку точного удара');
    must(/isPrecise \? '#9ec8e8'/.test(клиент), 'у точного удара нет своего цвета: неотличим от крита');
    must(/isPrecise \? ' ✧'/.test(клиент), 'у точного удара нет своей пометки');
  });
});

describe('Монстровая ветка: правило одно для всех (§356)', () => {
  const обработчик = читать('server/src/socket/GameSocketHandler.ts');
  const цикл = читать('server/src/systems/GameLoop.ts');
  const защита = читать('server/src/systems/DefenseStates.ts');
  const клиент2 = читать('client/src/app/world.ts');

  it('тик монстров читает ту же геометрию и множит урон', () => {
    must(/isBehindTarget\(\s*\{ x: target\.position\.x, z: target\.position\.z \},\s*this\.defenseStates\.getFacing\(target\.id\),/.test(цикл),
      'монстровый удар считает спину не по позиции игрока и его направлению');
    must(/if \(вСпинуИгрока\) damage = Math\.floor\(damage \* BACK_STRIKE_MULT\);/.test(цикл),
      'монстровый удар в спину не множит урон: правило не для всех');
  });

  it('направление игрока живёт в DefenseStates и доходит до тика', () => {
    must(/setFacing\(characterId, \{ x: data\.direction\.x, z: data\.direction\.z \}\)/.test(обработчик),
      'направление не пишется из пакета движения в DefenseStates');
    must(/facings\.delete\(characterId\)/.test(защита),
      'направление не чистится вместе с состояниями: ушедший игрок оставляет открытую спину');
    must(/getFacing\(target\.id\)/.test(цикл), 'тик не читает направление цели');
    // Отдельной карты в сокет-обработчике больше нет: одна истина.
    must(!/playerFacing/.test(обработчик), 'осталась отдельная карта направлений: копия разойдётся с DefenseStates');
  });

  it('полученный точный удар помечен игроку', () => {
    must(/isPrecise: вСпинуИгрока && !isDodged/.test(цикл), 'публикация удара монстра не помечает точный удар');
    must(/r\.isPrecise \? ' ✧' : ''/.test(клиент2), 'клиент не помечает точный удар по себе');
  });
});
