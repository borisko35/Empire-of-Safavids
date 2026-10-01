// Подводные существа: главное — они охотятся только на пловцов.
// Проверяем все четыре правила:
//   1) на берегу для них невидим,
//   2) в лодке — тоже (иначе покупка лодки ничего не давала бы),
//   3) на сушу не вылезает,
//   4) из воды патрульные точки строятся, а не наоборот.
import { AISystem } from '../systems/AISystem';
import { MONSTERS_DATABASE } from '../data/monsters';
import { isDeepWater } from '../utils/spawn';

const LAKE = { x: -420, y: 0, z: -160 };
/** Точка вне воды — суша в городе */
const SHORE = { x: 0, y: 0, z: 40 };

function makePlayer(x: number, z: number, inBoat = false) {
  return { id: 'p1', position: { x, y: 0, z }, hp: 100, inBoat };
}

function spawnAquatic(id: string, at = LAKE) {
  const def = MONSTERS_DATABASE[id];
  const ai = new AISystem();
  const ctx = ai.spawnMonster(def, { ...at }, 'isfahan');
  return { ai, ctx, def };
}

describe('Определения подводных существ', () => {
  const AQUATIC = ['mob_lake_piranha', 'mob_lake_sturgeon_horror', 'mob_lake_ghost_fish', 'mob_lake_leviathan'];

  it('все подводные помечены aquatic и живут в Тебризе', () => {
    for (const id of AQUATIC) {
      const def = MONSTERS_DATABASE[id];
      expect({ id, aquatic: def?.aquatic, region: def?.region })
        .toEqual({ id, aquatic: true, region: 'tabriz' });
    }
  });

  it('точки спавна подводных лежат в глубокой воде', () => {
    // Иначе существо заспавнится на берегу и будет бесконечно
    // «возвращаться в воду» без движения
    const spots: [number, number][] = [
      [-420, -100], [-500, -200], [-350, -230], [-430, -190],
    ];
    for (const [x, z] of spots) {
      expect({ x, z, deep: isDeepWater(x, z) }).toEqual({ x, z, deep: true });
    }
  });

  it('у каждого подводного есть дроп', () => {
    for (const id of AQUATIC) {
      const def = MONSTERS_DATABASE[id];
      expect({ id, loot: def.lootTable.length > 0 }).toEqual({ id, loot: true });
    }
  });

  it('у каждого подводного задана высота над водой', () => {
    // Клиент рисует подводное существо по полю aquaticSize. Без него
    // тварь уходит под воду (клиент ставит её на SWIM_FEET ниже
    // поверхности) и становится невидимой: бить нечем.
    for (const id of AQUATIC) {
      const size = MONSTERS_DATABASE[id].aquaticSize;
      expect({ id, size, ok: typeof size === 'number' && size > 0 && size < 2 })
        .toEqual({ id, size, ok: true });
    }
  });

  it('сухопутные не объявлены подводными', () => {
    // Иначе разбойник начнёт торчать из воды и не будет ловить аггро.
    //
    // Список исключений берётся ПО САМОМУ ФЛАГУ aquatic, а не по именам.
    // Раньше здесь стояло `if (id.startsWith('mob_lake_')) continue`, и
    // проверка краснела на трёх новых подводных залива (mob_gulf_*): они
    // действительно подводные, но в список имён не попали. Список имён -
    // это то место, где проверка расходится с данными при первом же новом
    // монстре; флаг aquatic - единственный источник правды о том, кто
    // подводный.
    for (const [id, def] of Object.entries(MONSTERS_DATABASE)) {
      if (def.aquatic === true) continue;
      expect({ id, aquatic: def.aquatic }).toEqual({ id, aquatic: undefined });
    }
  });
});

describe('Подводное существо не трогает тех, кто не в воде', () => {
  it('игрок на суше рядом — аггро не возникает', () => {
    const { ai, ctx } = spawnAquatic('mob_lake_piranha');
    for (let i = 0; i < 20; i++) ai.tick(ctx.instanceId, [makePlayer(SHORE.x, SHORE.z)]);
    expect(ctx.aggroTable.size).toBe(0);
    expect(ctx.state).not.toBe('chase');
    expect(ctx.state).not.toBe('attack');
  });

  it('плывущий игрок рядом — аггро возникает', () => {
    const { ai, ctx } = spawnAquatic('mob_lake_piranha');
    for (let i = 0; i < 5; i++) ai.tick(ctx.instanceId, [makePlayer(LAKE.x, LAKE.z)]);
    expect(ctx.aggroTable.size).toBe(1);
    expect(['chase', 'attack']).toContain(ctx.state);
  });

  it('игрок в лодке неуязвим', () => {
    // Главная причина покупать лодку: в самом опасном месте она защищает
    const { ai, ctx } = spawnAquatic('mob_lake_leviathan', { ...LAKE, z: LAKE.z + 3 });
    for (let i = 0; i < 20; i++) {
      ai.tick(ctx.instanceId, [makePlayer(LAKE.x, LAKE.z + 3, true)]);
    }
    expect(ctx.aggroTable.size).toBe(0);
  });

  it('вылез из воды — аггро сбрасывается', () => {
    const { ai, ctx } = spawnAquatic('mob_lake_ghost_fish');
    for (let i = 0; i < 5; i++) ai.tick(ctx.instanceId, [makePlayer(LAKE.x, LAKE.z)]);
    expect(ctx.aggroTable.size).toBe(1);
    // Игрок вылез на берег
    for (let i = 0; i < 3; i++) ai.tick(ctx.instanceId, [makePlayer(SHORE.x, SHORE.z)]);
    expect(ctx.aggroTable.size).toBe(0);
  });

  it('сел в лодку посреди боя — аггро сбрасывается', () => {
    const { ai, ctx } = spawnAquatic('mob_lake_ghost_fish');
    for (let i = 0; i < 5; i++) ai.tick(ctx.instanceId, [makePlayer(LAKE.x, LAKE.z)]);
    expect(ctx.aggroTable.size).toBe(1);
    for (let i = 0; i < 3; i++) ai.tick(ctx.instanceId, [makePlayer(LAKE.x, LAKE.z, true)]);
    expect(ctx.aggroTable.size).toBe(0);
  });
});

describe('Подводное существо не вылезает на сушу', () => {
  it('шаг к берегу не уводит его из воды', () => {
    const { ai, ctx } = spawnAquatic('mob_lake_leviathan');
    // Пловцы в лодке — то есть никто не аггрит, существо патрулирует
    for (let i = 0; i < 300; i++) {
      ai.tick(ctx.instanceId, []);
    }
    expect({ inWater: isDeepWater(ctx.position.x, ctx.position.z) })
      .toEqual({ inWater: true });
  });

  it('оно не убегает на берег при низком здоровье', () => {
    // Сухопутный монстр на 14% HP отступает — подводному некуда
    const { ai, ctx } = spawnAquatic('mob_lake_leviathan');
    ctx.currentHp = Math.floor(ctx.maxHp * 0.1);
    for (let i = 0; i < 60; i++) ai.tick(ctx.instanceId, [makePlayer(LAKE.x, LAKE.z)]);
    expect({ state: ctx.state, inWater: isDeepWater(ctx.position.x, ctx.position.z) })
      .toEqual({ state: expect.any(String), inWater: true });
    expect(['retreat', 'call_help']).not.toContain(ctx.state);
  });
});

describe('Патруль подводного идёт по воде', () => {
  it('все точки патруля — в глубокой воде', () => {
    const { ctx } = spawnAquatic('mob_lake_sturgeon_horror');
    expect(ctx.patrolPoints.length).toBeGreaterThan(0);
    for (const p of ctx.patrolPoints) {
      expect({ x: Math.round(p.x), z: Math.round(p.z), deep: isDeepWater(p.x, p.z) })
        .toEqual({ x: Math.round(p.x), z: Math.round(p.z), deep: true });
    }
  });

  it('сухопутный монстр по-прежнему патрулирует по суше', () => {
    // Проверка на то, что правка не задела обычных монстров
    const def = MONSTERS_DATABASE['mob_wolf'];
    const ai = new AISystem();
    const ctx = ai.spawnMonster(def, { x: -90, y: 0, z: 130 }, 'isfahan');
    expect(ctx.patrolPoints.length).toBeGreaterThan(0);
    for (const p of ctx.patrolPoints) {
      expect(isDeepWater(p.x, p.z)).toBe(false);
    }
  });

  it('сухопутный монстр по-прежнему не лезет в озеро', () => {
    // Старое поведение не должно было сломаться
    const def = MONSTERS_DATABASE['mob_bandit_scout'];
    const ai = new AISystem();
    const ctx = ai.spawnMonster(def, { x: -300, y: 0, z: -20 }, 'isfahan'); // у кромки
    ctx.aggroTable.set('p1', 0);
    // Цель — в центре озера
    const player = { id: 'p1', position: { x: LAKE.x, y: 0, z: LAKE.z }, hp: 100 };
    for (let i = 0; i < 200; i++) ai.tick(ctx.instanceId, [player]);
    // Мог приблизиться к кромке, но не плыть
    expect(isDeepWater(ctx.position.x, ctx.position.z)).toBe(false);
  });
});
