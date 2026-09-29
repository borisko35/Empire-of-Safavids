// Проходимость данжей.
//
// ГЛАВНОЕ, ЧТО ЗДЕСЬ НАЙДЕНО. Проверка «боссовая комната содержит
// босса» отсутствовала, и из-за этого все три данжа в игре оказались
// без босса. DungeonService добавляет босса в список обязательных только
// при ТОЧНОМ совпадении room.bossId с monsterId одной из групп комнаты:
//
//   if (room.isBossRoom && room.bossId === group.monsterId)
//     session.requiredBossIds.add(ctx.instanceId);
//
// Во всех трёх катакомбах, дворце и пещерах боссовая комната была помечена
// как боссовая и содержала bossId, но самого босса в списке монстров не
// было ни разу. Итог: ни один данж не требовал убить босса, все три
// проходились без финала, а боссы (boss_bandit_king, boss_ottoman_pasha,
// boss_div_arzhang) в данжах не появлялись вообще. Поле bossId было
// декоративными данными, которые врут о том, что ждёт игрока в финале.
//
// Остальные проверки — про то, что данж вообще можно закончить: все
// монстры и предметы существуют, у каждой группы столько же точек
// появления, сколько монстров, и уровни покрыты без дыр.
import { DUNGEONS_DATABASE } from '../data/dungeons';
import { MONSTERS_DATABASE } from '../data/monsters';
import { ITEMS_DATABASE } from '../data/items';
import type { DungeonDefinition } from '../data/dungeons';

const dungeons: DungeonDefinition[] = Object.values(DUNGEONS_DATABASE);

describe('В каждом данже есть настоящий финал', () => {
  it('боссовая комната есть', () => {
    // Данж без боссовой комнаты - это просто три комнаты с мусором
    const noBoss = dungeons.filter(d => !d.rooms.some(r => r.isBossRoom)).map(d => d.id);
    expect(noBoss).toEqual([]);
  });

  it('босс боссовой комнаты реально стоит в этой комнате', () => {
    // ГЛАВНАЯ ПРОВЕРКА ФАЙЛА. Пока босса нет среди монстров комнаты,
    // DungeonService не считает его обязательным, и данж заканчивается
    // без боя. Все три прежних данжа падали здесь.
    const broken = dungeons.flatMap(d =>
      d.rooms
        .filter(r => r.isBossRoom && !(r.monsters ?? []).some(g => g.monsterId === r.bossId))
        .map(r => `${d.id}/${r.id}: босс ${r.bossId ?? '—'} не в списке монстров`),
    );
    expect(broken).toEqual([]);
  });

  it('боссовая группа - самая крупная в своей комнате', () => {
    // Первая версия сравнивала HP ОДНОГО босса с суммой мусора. Если в
    // боссовой комнате мусора нет, сравнение проходило тривиально, и
    // «финалом» могла быть любая группа. Теперь сравниваются суммы: боссовая
    // группа должна быть тяжелее всего остального в комнате вместе взятого,
    // иначе комната не ощущается финалом.
    const weak: string[] = [];
    for (const d of dungeons) {
      for (const r of d.rooms) {
        if (!r.isBossRoom || !r.bossId) continue;
        const hp = (g: { monsterId: string; count: number }) =>
          (MONSTERS_DATABASE[g.monsterId]?.hp ?? 0) * g.count;
        const bossGroup = (r.monsters ?? []).find(g => g.monsterId === r.bossId);
        if (!bossGroup) continue; // отсутствие босса ловит другая проверка
        const bossHp = hp(bossGroup);
        const trashHp = (r.monsters ?? []).filter(g => g.monsterId !== r.bossId).reduce((a, g) => a + hp(g), 0);
        if (bossHp <= trashHp) {
          weak.push(`${d.id}/${r.id}: боссовая группа ${bossHp} hp, мусор ${trashHp} hp`);
        }
      }
    }
    expect(weak).toEqual([]);
  });
});

describe('Данж можно закончить', () => {
  it('все монстры существуют', () => {
    const bad: string[] = [];
    for (const d of dungeons) {
      for (const r of d.rooms) {
        for (const g of r.monsters ?? []) {
          if (!(g.monsterId in MONSTERS_DATABASE)) bad.push(`${d.id}/${r.id}: ${g.monsterId}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('у каждого монстра своя точка появления', () => {
    // positions задаются поштучно. Если их меньше, чем count, часть
    // монстров не появится вовсе, и комната окажется легче задуманного;
    // если больше - они появятся друг в друге
    const bad: string[] = [];
    for (const d of dungeons) {
      for (const r of d.rooms) {
        for (const g of r.monsters ?? []) {
          if (g.positions.length !== g.count) {
            bad.push(`${d.id}/${r.id}: ${g.monsterId} x${g.count} при ${g.positions.length} точках`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('в каждой комнате есть хоть один монстр', () => {
    // Пустая комната с сундуками - это не данж, а лавка
    const bad: string[] = [];
    for (const d of dungeons) {
      for (const r of d.rooms) {
        const total = (r.monsters ?? []).reduce((a, g) => a + g.count, 0);
        if (total === 0) bad.push(`${d.id}/${r.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('в финале есть чем поживиться', () => {
    // Боссовая комната без сундуков обесценивает весь финал
    const bad = dungeons
      .filter(d => d.rooms.some(r => r.isBossRoom))
      .filter(d => !d.rooms.some(r => r.isBossRoom && r.treasureChests > 0))
      .map(d => d.id);
    expect(bad).toEqual([]);
  });
});

describe('Награды не в никуда', () => {
  it('все гарантированные предметы существуют', () => {
    const bad: string[] = [];
    for (const d of dungeons) {
      for (const id of d.rewards.guaranteedItems ?? []) {
        if (!(id in ITEMS_DATABASE)) bad.push(`${d.id}: ${id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('все предметы за шанс существуют и шанс осмысленный', () => {
    const bad: string[] = [];
    for (const d of dungeons) {
      for (const b of d.rewards.bonusItems ?? []) {
        if (!(b.itemId in ITEMS_DATABASE)) bad.push(`${d.id}: ${b.itemId} не существует`);
        if (b.chance <= 0 || b.chance > 1) bad.push(`${d.id}: ${b.itemId} шанс ${b.chance}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('за прохождение платят и опытом, и золотом', () => {
    for (const d of dungeons) {
      expect({ id: d.id, опыт: d.rewards.experience > 0, золото: d.rewards.gold.max > d.rewards.gold.min })
        .toEqual({ id: d.id, опыт: true, золото: true });
    }
  });
});

describe('Уровни покрыты без дыр', () => {
  it('между полосами данжей нет провала в 5 уровней и больше', () => {
    // Было 5–25, 25–50, 60–85: между 50 и 60 пусто десятью уровнями, с 85
    // до сотни — пятнадцатью. Добавленные кавказский (30–52) и ширазский
    // (45–70) закрывают оба провала.
    //
    // Порог 5, а не 25: при двадцати пяти проверка проходила и без новых
    // данжей, то есть не требовала ничего. С таким порогом прежняя дыра в
    // 10 уровней роняла бы проверку.
    const bands = dungeons.map(d => [d.minLevel, d.maxLevel] as const).sort((a, b) => a[0] - b[0]);
    const gaps: string[] = [];
    for (let i = 1; i < bands.length; i++) {
      const gap = bands[i][0] - bands[i - 1][1];
      if (gap > 5) gaps.push(`${bands[i - 1][0]}–${bands[i - 1][1]} → ${bands[i][0]}–${bands[i][1]}: дыра в ${gap} уровней`);
    }
    expect(gaps).toEqual([]);
  });

  it('в каждом данже есть монстр, попадающий в его полосу уровней', () => {
    // Данж, где все монстры сильно ниже или сильно выше полосы, либо
    // тривиален, либо непроходим
    const bad: string[] = [];
    for (const d of dungeons) {
      const mid = (d.minLevel + d.maxLevel) / 2;
      const inBand = d.rooms.some(r =>
        (r.monsters ?? []).some(g => {
          const lvl = MONSTERS_DATABASE[g.monsterId]?.level ?? 0;
          return Math.abs(lvl - mid) <= 15;
        }),
      );
      if (!inBand) bad.push(`${d.id} (${d.minLevel}–${d.maxLevel})`);
    }
    expect(bad).toEqual([]);
  });

  it('нижняя граница не выше 10: новичку данж должен быть доступен', () => {
    // Первый данж открывается на пятом уровне. Если новые откроются с
    // сорок пятого, между 25 и 45 игрок будет без данжей вовсе
    const first = dungeons.reduce((a, b) => (a.minLevel <= b.minLevel ? a : b));
    expect({ id: first.id, уровень: first.minLevel <= 10 }).toEqual({ id: expect.any(String), уровень: true });
  });
});
