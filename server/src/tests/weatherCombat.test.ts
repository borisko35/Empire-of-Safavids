// Погода в бою (§375) — дальность стрелкового боя и замах подчиняются
// погоде, правило одно для обеих сторон.
//
// ЗА ЧТО БОРЕТСЯ. visibilityMod и speedMod объявлены в WEATHER_EFFECTS и
// читались стражей и движением, но бой их не видел: в песчаную бурю
// стрелковый монстр бил через ту же дальность, что и в ясный день, а замах
// игрока не тянулся. Погода влияла на обход и скорость шага, но не на сам
// бой — половина пункта владельца «погода как геймплей».
//
// ГРАНИЦА ПРАВИЛА. Дальностью погода правит ТОЛЬКО стрелкового бойца:
// порог COMBAT_RANGED_THRESHOLD_M лежит между клинками (2.4–2.7 м) и
// стрелками (12–20 м). Снимить дальность клинку в бурю значило бы сделать
// ближний бой неиграбельным — 2.4 × 0.3 = 0.7 м.
//
// ДВА РОДА ПРОВЕРОК. Поведение ИИ запускается по-настоящему: стрелковый
// монстр в бурю сближается вместо выстрела, клинку погода не мешает.
// Проводка сокет-пути и тика — по исходнику.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AISystem, type TargetPlayer } from '../systems/AISystem';
import { combatReachMod, COMBAT_RANGED_THRESHOLD_M, type Weather } from '../systems/WorldTimeSystem';
import type { MonsterDefinition } from '../data/monsters';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

const обработчик = читать('server/src/socket/GameSocketHandler.ts');
const цикл = читать('server/src/systems/GameLoop.ts');
const спавн = читать('server/src/systems/SpawnSystem.ts');
const предметы = читать('server/src/data/items.ts');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

/** Стрелковый монстр без навыков: на средней дистанции остаётся только basic. */
function стрелок(): MonsterDefinition {
  return {
    id: 'test_weather_sniper',
    name: 'Weather Sniper',
    nameRu: 'Стрелок Проверки',
    type: 'monster',
    faction: 'bandit',
    level: 10,
    hp: 1000,
    mana: 0,
    strength: 10,
    agility: 10,
    intelligence: 10,
    defense: 10,
    moveSpeed: 4,
    attackRange: 20,
    aggroRange: 50,
    expReward: 10,
    goldReward: { min: 1, max: 2 },
    skills: [],
    lootTable: [],
    region: 'isfahan' as MonsterDefinition['region'],
    respawnTime: 60,
    description: 'Проверка погоды в бою.',
  } as unknown as MonsterDefinition;
}

/** Клинковый монстр: attackRange ниже порога, погода ему не судья. */
function клинок(): MonsterDefinition {
  const стрел = стрелок();
  return { ...стрел, id: 'test_weather_melee', nameRu: 'Клинок Проверки', attackRange: 2 } as unknown as MonsterDefinition;
}

const игрок = (x: number): TargetPlayer[] => [{ id: 'p1', position: { x, y: 0, z: 0 }, hp: 1 }];

describe('Арифметика дальности', () => {
  it('порог между клинками и стрелками: 5 м — ВЫБОР, он зафиксирован', () => {
    // Клинки живут в 2.4–2.7 м, стрелковые монстры в 12–20 м. Сдвиг порога
    // в сторону клинков сделал бы ближний бой зависимым от погоды.
    expect(COMBAT_RANGED_THRESHOLD_M).toEqual(5);
  });

  it('клинку погода дальности не снимает, стрелку — снимает', () => {
    expect({
      клинок_в_бурю: combatReachMod('sandstorm', 2.4),
      клинок_в_туман: combatReachMod('fog', 2.7),
      стрелок_в_ясную: combatReachMod('clear', 20),
      стрелок_в_бурю: combatReachMod('sandstorm', 20),
      стрелок_в_бурю_на_границе: combatReachMod('sandstorm', COMBAT_RANGED_THRESHOLD_M),
      мусорная_погода: combatReachMod('метель' as unknown as Weather, 20),
      нет_погоды: combatReachMod(undefined, 20),
      мусорный_радиус: combatReachMod('sandstorm', Number.NaN as unknown as number),
    }).toEqual({
      клинок_в_бурю: 1,
      клинок_в_туман: 1,
      стрелок_в_ясную: 1,
      стрелок_в_бурю: 0.3,
      стрелок_в_бурю_на_границе: 1,
      мусорная_погода: 1,
      нет_погоды: 1,
      мусорный_радиус: 1,
    });
  });
});

describe('AISystem: погода — поведение, а не поле', () => {
  const ai = new AISystem();

  it('стрелковый монстр в бурю сближается, а не бьёт с двенадцати метров', () => {
    const def = стрелок();
    const ctx = ai.spawnMonster(def, { x: 0, y: 0, z: 0 });
    try {
      ctx.state = 'attack';
      ctx.targetId = 'p1';
      ctx.targetPosition = { x: 12, y: 0, z: 0 };

      const ясный = ai.tick(ctx.instanceId, игрок(12), 'clear');
      must(ясный.type === 'attack', `в ясную погоду ждали выстрела, получили ${ясный.type}`);

      const буря = ai.tick(ctx.instanceId, игрок(12), 'sandstorm');
      must(буря.type !== 'attack', `в бурю монстр выстрелил с 12 м при радиусе 6 (${буря.type})`);
    } finally {
      ai.removeInstance(ctx.instanceId);
    }
  });

  it('клинковому монстру погода не судья: бьёт и в бурю', () => {
    const def = клинок();
    const ctx = ai.spawnMonster(def, { x: 0, y: 0, z: 0 });
    try {
      ctx.state = 'attack';
      ctx.targetId = 'p1';
      ctx.targetPosition = { x: 1.8, y: 0, z: 0 };
      const буря = ai.tick(ctx.instanceId, игрок(1.8), 'sandstorm');
      must(буря.type === 'attack', `клинок в бурю не бьёт вплотную (${буря.type})`);
    } finally {
      ai.removeInstance(ctx.instanceId);
    }
  });

  it('без погоды поведение прежнее: undefined значит ясно', () => {
    const def = стрелок();
    const ctx = ai.spawnMonster(def, { x: 0, y: 0, z: 0 });
    try {
      ctx.state = 'attack';
      ctx.targetId = 'p1';
      ctx.targetPosition = { x: 12, y: 0, z: 0 };
      const действие = ai.tick(ctx.instanceId, игрок(12));
      must(действие.type === 'attack', `без погоды ждали прежнего выстрела (${действие.type})`);
    } finally {
      ai.removeInstance(ctx.instanceId);
    }
  });
});

describe('Проводка боевых путей', () => {
  it('игрок: дальность и замах читают погоду мировых часов, а не пакет', () => {
    must(
      /combatReachMod\(время\.weather, weapon\?\.range \?\? DEFAULT_WEAPON\.range\)/.test(обработчик),
      'дальность basic-атаки игрока не умножается на погодный модификатор',
    );
    must(
      /\/ \(замедление \* погодаЗамах\)/.test(обработчик),
      'замах basic-атаки игрока не оттягивается погодой',
    );
    must(
      /GameLoop\.getInstance\(\)\.getWorldTime\(\)/.test(обработчик),
      'погода для боя берётся не из мировых часов',
    );
  });

  it('монстры: тот же combatReachMod, погода приходит из тика GameLoop', () => {
    must(
      /combatReachMod\(погода, ctx\.definition\.attackRange\)/.test(читать('server/src/systems/AISystem.ts')),
      'ИИ не применяет правило погоды к радиусу атаки',
    );
    must(
      /tickAI\(nearbyPlayers, this\.getWorldTime\(\)\.weather\)/.test(цикл),
      'тик ИИ не получает погоду от GameLoop',
    );
    must(
      /this\.ai\.tick\(ctx\.instanceId, players, погода\)/.test(спавн),
      'SpawnSystem теряет погоду по пути в AISystem',
    );
  });

  it('правило живёт в одном месте рядом со справочником погоды', () => {
    // Обе боевые стороны импортируют combatReachMod из WorldTimeSystem, где
    // лежит WEATHER_EFFECTS. Вторая копия арифметики разъехалась бы при
    // первой же правке калибровки.
    for (const [файл, код] of [['обработчик', обработчик], ['цикл', цикл]] as const) {
      must(
        !/visibilityMod \*|visibilityMod\)/.test(код) || /combatReachMod/.test(код),
        `${файл}: погодная арифметика вне combatReachMod`,
      );
    }
    must(
      /export function combatReachMod/.test(читать('server/src/systems/WorldTimeSystem.ts')),
      'combatReachMod не объявлен рядом с WEATHER_EFFECTS',
    );
  });

  it('описание лука больше не обещает дальность, которой нет', () => {
    // В данных weapon.range: 2.4 — как у клинка, а описание обещало 80 метров.
    // Текст приведён к механике; настоящая стрелковая дальность — балансное
    // решение владельца.
    must(!/80 метров/.test(предметы), 'описание лука всё ещё обещает 80 метров');
  });
});
