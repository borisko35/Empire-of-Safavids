// Ломающаяся броня (§374) — износ считается, защита падает, ступень
// называется игроку.
//
// ЗА ЧТО БОРЕТСЯ. Панцирь под вычитающей формулой урона затыкает бой:
// baseDamage − defense = 1, и тяжёлая цель непробиваема вечно. Износ —
// ответ бою на панцирь: каждое попадание изнашивает, ступени срезают
// четверть базовой защиты, потолок три ступени.
//
// ДВА РОДА ПРОВЕРОК, как в parryStun. Поведение AISystem запускается
// по-настоящему: счётчик растёт от попаданий и умирает вместе с монстром.
// Проводка сокет-пути и клиента проверяется по исходнику: поднять там
// настоящую обработку нечем, а regex такую проводку страхует — перепишешь
// ветку, тест падает.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AISystem } from '../systems/AISystem';
import { MONSTERS_DATABASE } from '../data/monsters';
import {
  ARMOR_BREAK_HITS_PER_STEP, ARMOR_BREAK_MAX_STEPS, ARMOR_BREAK_STEP,
  armorSteps, effectiveDefense,
} from '../../../shared/armorBreak';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

const обработчик = читать('server/src/socket/GameSocketHandler.ts');
const мир = читать('client/src/app/world.ts');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

describe('Арифметика износа', () => {
  it('ступени по границам: шесть попаданий — первая, восемнадцать — потолок', () => {
    // Числа зафиксированы руками: правка калибровки обязана покраснеть и
    // заставить перечитать шапку shared/armorBreak.ts, где выбор объяснён.
    expect({
      ноль: armorSteps(0),
      до_ступени: armorSteps(ARMOR_BREAK_HITS_PER_STEP - 1),
      первая: armorSteps(ARMOR_BREAK_HITS_PER_STEP),
      вторая: armorSteps(ARMOR_BREAK_HITS_PER_STEP * 2),
      потолок: armorSteps(ARMOR_BREAK_HITS_PER_STEP * ARMOR_BREAK_MAX_STEPS),
      выше_потолка: armorSteps(999),
      мусор: armorSteps(Number.NaN as unknown as number),
      отрицательное: armorSteps(-4),
    }).toEqual({
      ноль: 0,
      до_ступени: 0,
      первая: 1,
      вторая: 2,
      потолок: 3,
      выше_потолка: 3,
      мусор: 0,
      отрицательное: 0,
    });
  });

  it('защита падает на четверть за ступень и не ниже четверти крепости', () => {
    const база = 82;
    expect({
      целая: effectiveDefense(база, 0),
      первая: effectiveDefense(база, ARMOR_BREAK_HITS_PER_STEP),
      третья: effectiveDefense(база, ARMOR_BREAK_HITS_PER_STEP * 3),
      ниже_потолка: effectiveDefense(база, ARMOR_BREAK_HITS_PER_STEP * 10),
    }).toEqual({
      целая: 82,
      первая: 82 * (1 - ARMOR_BREAK_STEP),
      третья: 82 * (1 - ARMOR_BREAK_STEP * 3),
      ниже_потолка: 82 * (1 - ARMOR_BREAK_STEP * ARMOR_BREAK_MAX_STEPS),
    });
  });

  it('ломать нечего: ноль, минус и мусор возвращаются как есть', () => {
    // Множитель не должен превращать «защиты нет» в отрицательную защиту,
    // то есть в прибавку к урону.
    expect({
      ноль: effectiveDefense(0, 50),
      минус: effectiveDefense(-5, 50),
      мусор: effectiveDefense(Number.NaN as unknown as number, 50),
    }).toEqual({ ноль: 0, минус: -5, мусор: Number.NaN as unknown as number });
  });
});

describe('AISystem: износ — поведение, а не поле', () => {
  const ai = new AISystem();

  it('попадания считаются, смерть стирает счёт вместе с монстром', () => {
    const определение = Object.values(MONSTERS_DATABASE)[0];
    const ctx = ai.spawnMonster(определение, { x: 0, y: 0, z: 0 });
    // Через функцию: must(... === 0) сужает тип поля до литерала, и следующее
    // сравнение с ARMOR_BREAK_HITS_PER_STEP не компилируется.
    const счётчик = (): number => ctx.armorHits;
    try {
      must(счётчик() === 0, 'новый экземпляр пришёл с изношенной бронёй');
      for (let i = 0; i < ARMOR_BREAK_HITS_PER_STEP; i++) {
        ai.takeDamage(ctx.instanceId, 1, 'проверка');
      }
      must(счётчик() === ARMOR_BREAK_HITS_PER_STEP,
        `после ${ARMOR_BREAK_HITS_PER_STEP} попаданий счётчик = ${ctx.armorHits}`);
      // Ступень через эффективную защиту: тот же вызов, что и в бою.
      const стала = effectiveDefense(определение.defense, ctx.armorHits);
      must(стала < определение.defense, 'ступень износа не снизила защиту');
    } finally {
      ai.takeDamage(ctx.instanceId, ctx.currentHp, 'проверка');
    }
    must(ai.getContext(ctx.instanceId) === undefined,
      'мёртвый монстр остался в памяти — счётчик пережил бы респавн');
  });
});

describe('Проводка боевого пути', () => {
  it('защита монстра считается с износом в одном месте', () => {
    // monsterAsCharacter — единственное место, где защита справочника
    // превращается в персонажа для формулы урона. effectiveDefense должен
    // стоять именно там, а не рядом с расчётом: иначе абордаж и бой
    // посчитали бы панцирь по-разному.
    must(
      /endurance: Math\.round\(effectiveDefense\(monsterCtx\.definition\.defense, monsterCtx\.armorHits\) \/ 1\.5\)/.test(обработчик),
      'в monsterAsCharacter защита считается без износа',
    );
    must(
      /from '\.\.\/\.\.\/\.\.\/shared\/armorBreak'/.test(обработчик),
      'обработчик не берёт арифметику из shared — копия разъедется',
    );
  });

  it('ступень доходит до клиента ровно один раз, на переходе', () => {
    must(
      /const ступенейДо = armorSteps\(monsterCtx\.armorHits \?\? 0\)/.test(обработчик) &&
      /armorSteps\(monsterCtx\.armorHits \?\? 0\) > ступенейДо/.test(обработчик),
      'ступень не сравнивается с состоянием до удара',
    );
    must(
      /armorBroken: ступеньПройдена/.test(обработчик),
      'флаг ступени не уходит в combat:result',
    );
    must(
      !/armorBroken: true/.test(обработчик),
      'флаг ступени стоит константой — клиент будет spamить на каждом ударе',
    );
  });

  it('клиент называет ступень строкой из словаря, а не своим текстом', () => {
    must(
      /r\.armorBroken/.test(мир) && /t\('world\.armor_broken'\)/.test(мир),
      'клиент не показывает ступень износа или пишет её без словаря',
    );
  });
});

describe('Словари на трёх языках', () => {
  for (const язык of ['ru', 'en', 'az'] as const) {
    it(`${язык}: world.armor_broken на месте и не пустой`, () => {
      const данные = JSON.parse(читать(`shared/locales/${язык}.json`));
      const строка = данные.world?.armor_broken;
      must(typeof строка === 'string' && строка.length > 0,
        `${язык}: world.armor_broken отсутствует или пуст`);
    });
  }
});
