// Удар сверху (§376) — голова как уязвимое место из высоты.
//
// ЗА ЧТО БОРЕТСЯ. Высоту земли знал только клиент: монстры жили на сервере
// с y=0, и «бью сверху» было бы пустым словом. Высотная цепочка переехала
// в shared/terrainHeight.ts, монстры встали на настоящий рельеф, и
// превышение стало серверным фактом. Множитель входит в античит-базу —
// как у спины (§355): без этого честный удар сверху объявлялся бы подделкой
// урона с перманентным баном.
//
// ДВА РОДА ПРОВЕРОК. Поведение ИИ по-настоящему: монстр, заспавненный у
// подножия, стоит на высоте земли, и его y идёт за шагом. Проводки трёх
// боевых веток (PvE, PvP, тик монстра) — по исходнику.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AISystem } from '../systems/AISystem';
import { MONSTERS_DATABASE } from '../data/monsters';
import { groundHeight } from '../../../shared/terrainHeight';
import { WORLD_HALF } from '../../../shared/water';
import {
  isAboveTarget, OVERHEAD_ADVANTAGE_M, OVERHEAD_MULT,
} from '../../../shared/overheadStrike';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

const обработчик = читать('server/src/socket/GameSocketHandler.ts');
const цикл = читать('server/src/systems/GameLoop.ts');
const определение = Object.values(MONSTERS_DATABASE)[0];

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

describe('Арифметика превышения', () => {
  it('порог и множитель — ВЫБОР, зафиксированы руками', () => {
    // Правка калибровки обязана покраснеть и заставить перечитать шапку
    // shared/overheadStrike.ts, где выбор объяснён.
    expect({ порог: OVERHEAD_ADVANTAGE_M, множитель: OVERHEAD_MULT })
      .toEqual({ порог: 1.6, множитель: 1.35 });
  });

  it('граница порога: 1.59 не считается, 1.6 считается', () => {
    expect({
      впритык_ниже: isAboveTarget({ y: 1.59 }, { y: 0 }),
      впритык: isAboveTarget({ y: OVERHEAD_ADVANTAGE_M }, { y: 0 }),
      ниже: isAboveTarget({ y: 0 }, { y: 1.6 }),
      отрицательно: isAboveTarget({ y: -5 }, { y: 0 }),
      мусор: isAboveTarget({ y: Number.NaN as unknown as number }, { y: 0 }),
      нет_атакующего: isAboveTarget(null, { y: 0 }),
      нет_цели: isAboveTarget({ y: 10 }, null),
    }).toEqual({
      впритык_ниже: false,
      впритык: true,
      ниже: false,
      отрицательно: false,
      мусор: false,
      нет_атакующего: false,
      нет_цели: false,
    });
  });
});

describe('AISystem: монстр стоит на рельефе', () => {
  const ai = new AISystem();

  /** Точка с заметным рельефом и точка выше по склону. */
  function склон(): { низ: { x: number; z: number }; высоко: { x: number; z: number } } {
    // Ищем в северном хребте (z от -2600): там рельеф гарантирован, и
    // первые же пробы попадают на склоны - без зоны поиск перебирал бы
    // тысячи точек плоской степи.
    //
    // ДВА условия, а не одно. Перепад на всём склоне (>4 м) без перепада
    // на первом шаге находил обрыв с плоской полкой у подножия: монстр
    // шагал по полке, высота не менялась, и проверка y была слепа.
    for (let z = -2600; z <= -800; z += 100) {
      for (let x = -2400; x <= 2400; x += 100) {
        const низ = { x, z };
        const высоко = { x: x + 40, z: z + 40 };
        const hНиз = groundHeight(низ.x, низ.z);
        const hВыс = groundHeight(высоко.x, высоко.z);
        if (hВыс - hНиз <= 4) continue;
        const шаг = groundHeight(низ.x + 3.5, низ.z + 3.5) - hНиз;
        if (шаг > 0.3) return { низ, высоко };
      }
    }
    throw new Error('склон с перепадом 4 м не найден - мир стал плоским?');
  }

  it('спавн ставит монстра на землю, а не на y=0 из данных', () => {
    const { высоко } = склон();
    const ctx = ai.spawnMonster(определение, { x: высоко.x, y: 0, z: высоко.z });
    try {
      must(Math.abs(ctx.position.y - groundHeight(высоко.x, высоко.z)) < 1e-9,
        `монстр на склоне стоит на y=${ctx.position.y}, а земля там ${groundHeight(высоко.x, высоко.z)}`);
    } finally {
      ai.removeInstance(ctx.instanceId);
    }
  });

  it('y идёт за шагом: монстр с подножия поднимается на склон', async () => {
    const { низ, высоко } = склон();
    const ctx = ai.spawnMonster(определение, { x: низ.x, y: 0, z: низ.z });
    try {
      must(ctx.position.y < groundHeight(высоко.x, высоко.z) - OVERHEAD_ADVANTAGE_M,
        'подножие и вершина склона отличаются меньше порога - тест меряет не то');

      ctx.state = 'chase';
      ctx.targetId = 'p1';
      ctx.targetPosition = { x: высоко.x, y: 0, z: высоко.z };
      // Цель дальше aggroRange: без записи в таблице тик её потеряет, и
      // монстр никуда не пойдёт.
      ctx.aggroTable.set('p1', 100);
      // Первый тик с dt=0 не двигает: подделываем прошедшую секунду.
      ctx.lastTickAt = Date.now() - 1000;
      ai.tick(ctx.instanceId, [{ id: 'p1', position: { x: высоко.x, y: 0, z: высоко.z }, hp: 1 }]);

      must(ctx.position.x !== низ.x || ctx.position.z !== низ.z,
        'монстр не сдвинулся с места - шаг не случился');
      const земля = groundHeight(ctx.position.x, ctx.position.z);
      must(Math.abs(ctx.position.y - земля) < 1e-9,
        `монстр шагнул, но висит на y=${ctx.position.y}, а земля под ним ${земля}`);
    } finally {
      ai.removeInstance(ctx.instanceId);
    }
  });

  it('карман интерьера - не рельеф: y приходит из данных, а не с края мира', () => {
    // x = 4000+ - координаты комнат интерьеров. Вызов groundHeight там
    // вернул бы зажатый к краю мира хребет, и данжевый монстр стоял бы
    // на потолке мира.
    must(4836 > WORLD_HALF, 'карман уехал внутрь мира - правило края больше не страхует');
    const ctx = ai.spawnMonster(определение, { x: 4836, y: 0, z: 4836 });
    try {
      must(ctx.position.y === 0, `данжевый монстр получил y=${ctx.position.y} с рельефа края мира`);
    } finally {
      ai.removeInstance(ctx.instanceId);
    }
  });
});

describe('Проводка боевых веток', () => {
  it('игрок по монстру: множитель и античит-база с произведением точных ударов', () => {
    must(
      обработчик.includes('const сверху = isBasic && !result.isDodged && isAboveTarget(attackerPos, monsterCtx.position);'),
      'в PvE-ветке превышение не проверяется',
    );
    must(
      обработчик.split('if (сверху) result.damage = Math.floor(result.damage * OVERHEAD_MULT);').length - 1 === 2,
      'множитель удара сверху стоит не ровно дважды - PvE и PvP, ни больше ни меньше',
    );
    must(
      обработчик.includes('((вСпину ? BACK_STRIKE_MULT : 1) * (сверху ? OVERHEAD_MULT : 1))'),
      'античит-база не знает про удар сверху: честный удар объявят подделкой',
    );
    must(
      обработчик.includes('isPrecise: вСпину || сверху,'),
      'PvE не помечает удар сверху как точный',
    );
  });

  it('PvP: то же правило для игрока против игрока', () => {
    must(
      обработчик.includes('const сверху = isBasicPvP && !result.isDodged && isAboveTarget(attackerPosPvP, targetPosPvP);'),
      'в PvP-ветке превышение не проверяется',
    );
    must(
      обработчик.includes('isPrecise: вСпину || сверху,'),
      'PvP не помечает удар сверху как точный',
    );
  });

  it('монстр по игроку: правило высоты одно для всех', () => {
    must(
      цикл.includes('const сверхуМонстра = !!монстрCtx && isAboveTarget(монстрCtx.position, target.position);'),
      'монстр в тике не проверяет превышение',
    );
    must(
      цикл.includes('isPrecise: (вСпинуИгрока || сверхуМонстра) && !isDodged,'),
      'тик не помечает удар монстра сверху как точный',
    );
  });

  it('арифметика - из shared, без копий', () => {
    must(
      обработчик.includes("from '../../../shared/overheadStrike'") &&
      цикл.includes("from '../../../shared/overheadStrike'"),
      'боевые ветки не берут правило из shared - копия разъедется',
    );
  });
});
