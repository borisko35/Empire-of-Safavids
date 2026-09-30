// Подземелье без единой смерти: считается честно.
//
// ГЛАВНАЯ ПРОВЕРКА. Счётчик должен начисляться по ОДНОМУ за ЗАХОД без
// смертей, а не по числу смертей. Начисление «по числу смертей» - это
// ровно то, что обещает достижение НЕ считать: пять заходов по одной
// смерти дадут пять, и «ни разу не умер» закроется.
//
// ВТОРОЕ. Отметка смерти не должна ждать. Она зовётся из боевого тика на
// каждой смерти каждого игрока, и ожидание здесь означало бы встающий тик.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACHIEVEMENTS, isEarned } from '../services/AchievementService';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

const подземелья = читать('server/src/systems/DungeonService.ts');
const тик = читать('server/src/systems/GameLoop.ts');

describe('Условие «без единой смерти»', () => {
  it('смотрит на счётчик заходов, а не смертей', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_no_death')!;
    expect({ условие: def.condition }).toEqual({ условие: { counter: 'dungeons_no_death', need: 1 } });
  });

  it('одного захода достаточно', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_no_death')!;
    expect({
      ноль: isEarned(def, { dungeons_no_death: 0 }),
      один: isEarned(def, { dungeons_no_death: 1 }),
    }).toEqual({ ноль: false, один: true });
  });

  it('награда не тронута', () => {
    // Награда - это дизайн, а не решение программиста. Я поставил свои
    // цифры и откатил: 1000 золота и 2000 опыта стояли в справочнике до
    // моей правки и должны остаться.
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_no_death')!;
    expect({ золото: def.reward_gold, опыт: def.reward_experience })
      .toEqual({ золото: 1000, опыт: 2000 });
  });
});

describe('Засчитывается заход, а не смерти', () => {
  it('условие проверяет нулевые смерти', () => {
    expect({
      читает: /const смертей = session\.deaths\.get\(killerId\) \?\? 0;/.test(подземелья),
      требует_нуля: /if \(смертей === 0\)/.test(подземелья),
    }).toEqual({ читает: true, требует_нуля: true });
  });

  it('прибавляется ровно единица, а не число смертей', () => {
    // ГЛАВНАЯ ПРОВЕРКА ФАЙЛА. Прибавление «по числу смертей» превратило бы
    // достижение в «сколько раз умер», а оно обещало обратное.
    expect({
      единица: /dungeonsNoDeath: 1\b/.test(подземелья),
      не_число_смертей: !/dungeonsNoDeath: смертей/.test(подземелья),
    }).toEqual({ единица: true, не_число_смертей: true });
  });

  it('условие не становится «смертей ноль или больше»', () => {
    // >= 0 истинно всегда, и счётчик рос бы за любой заход.
    expect({ подозрительных_условий: /if \([^)]*смертей[^)]*>=/.test(подземелья) })
      .toEqual({ подозрительных_условий: false });
  });
});

describe('Смерть считается в единственном месте', () => {
  it('отметка стоит в боевом тике на applied.died', () => {
    // Урон монстра наносится только здесь, и applied.died - единственный
    // честный признак смерти. Считать в CharacterService означало бы
    // ловить все смерти, включая PvP, а достижение про подземелье.
    expect({
      в_тике: /if \(applied\.died\) DungeonService\.getInstance\(\)\.recordDeath\(target\.id\);/.test(тик),
    }).toEqual({ в_тике: true });
  });

  it('отметка не ждёт - тик не должен вставать', () => {
    // Горячий путь: урон каждому игроку в каждом регионе каждый тик.
    // await здесь означал бы ожидание на каждой смерти.
    expect({
      без_await: /if \(applied\.died\) DungeonService/.test(тик),
      ровно_один_вызов: (тик.match(/recordDeath\(target\.id\)/g) ?? []).length,
    }).toEqual({ без_await: true, ровно_один_вызов: 1 });
  });

  it('recordDeath возвращает void и никуда не пишет', () => {
    // Писать в базу из отметки смерти означало бы запрос на каждый тик.
    expect({
      сигнатура: /recordDeath\(characterId: string\): void/.test(подземелья),
      без_базы: !/async recordDeath/.test(подземелья),
    }).toEqual({ сигнатура: true, без_базы: true });
  });
});

describe('Сессия помнит смерти', () => {
  it('поле есть и проинициализировано в обоих местах создания', () => {
    // Два места: новая сессия и восстановленная из базы. Пропущенное
    // означало бы undefined на первой же смерти.
    expect({
      поле: /deaths: Map<string, number>/.test(подземелья),
      новая: /startedAt: Date\.now\(\),\s*\n\s*deaths: new Map\(\)/.test(подземелья),
      восстановленная: /startedAt: new Date\(row\.started_at\)\.getTime\(\),\s*\n[\s\S]{0,300}?deaths: new Map\(\)/.test(подземелья),
    }).toEqual({ поле: true, новая: true, восстановленная: true });
  });

  it('вне подземелья отметка безвредна', () => {
    // Смерть на поле не отменяет «прошёл без смертей» в подземелье, и
    // вызов из тика идёт каждому умершему, а не только участникам.
    expect({
      проверяет_сессию: /const sessionId = this\.characterToSession\.get\(characterId\);\s*\n\s*if \(!sessionId\) return;/.test(подземелья),
    }).toEqual({ проверяет_сессию: true });
  });
});

describe('Колонка появляется миграцией', () => {
  it('dungeons_no_death с ограничением', () => {
    const миграция = читать('database/migrations/059_dungeon_no_death.sql');
    expect({
      колонка: /ADD COLUMN IF NOT EXISTS dungeons_no_death INT NOT NULL DEFAULT 0/.test(миграция),
      потолок: /dungeons_no_death >= 0 AND dungeons_no_death <= 10000/.test(миграция),
    }).toEqual({ колонка: true, потолок: true });
  });

  it('поле есть в типе счётчика', () => {
    const lb = читать('server/src/services/LeaderboardService.ts');
    expect({ поле: /dungeonsNoDeath\?: number/.test(lb) })
      .toEqual({ поле: true });
  });
});
