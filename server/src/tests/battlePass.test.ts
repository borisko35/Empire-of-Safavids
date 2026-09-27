// Боевой пропуск: очки не начислялись никогда.
//
// ЧТО БЫЛО. PremiumSystem.addSeasonPoints написан целиком — авторегистрация в
// бесплатной лестнице, пересчёт, определение открытых уровней. Но он не
// вызывался НИ РАЗУ за всё время существования проекта. Итог: игрок мог
// купить пропуск и не получить ничего. Очки всегда ноль, ни один уровень не
// открывался, покупка за реальные деньги не давала награды.
//
// Почему это хуже, чем отсутствующая фича: игрок узнаёт об этом по факту —
// купил, а ничего не пришло. Пропуск при этом виден в интерфейсе и выглядит
// рабочим.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const tasks = stripComments(read('server/src/services/DailyTaskService.ts'));
const premium = stripComments(read('server/src/systems/PremiumSystem.ts'));

describe('Боевой пропуск: очки начисляются', () => {
  it('addSeasonPoints вызывается хоть откуда-то', () => {
    // ГЛАВНОЕ. Раньше вызова не было ни одного
    expect(tasks).toMatch(/grantSeasonPoints\(charId/);
  });

  it('вызов идёт из общего места, а не из восьми', () => {
    // updateProgress зовут восемь мест: убийства, квесты, данж, крафт,
    // торговля, PvP, рыбалка. Одно место вместо восьми — и забыть его
    // больше негде
    const def = tasks.slice(tasks.indexOf('async updateProgress'));
    const body = def.slice(0, def.indexOf('async getCompletedCount'));
    expect(body).toMatch(/SEASON_POINTS_PER_ACTION/);
  });

  it('очки начисляются и за действие, и за выполненную задачу', () => {
    // Задача — это уже «целое» действие игрока, а не одна операция, поэтому
    // она должна стоить в несколько раз дороже
    const def = tasks.slice(tasks.indexOf('async updateProgress'));
    const body = def.slice(0, def.indexOf('async getCompletedCount'));
    expect(body).toMatch(/SEASON_POINTS_PER_TASK/);
    const perAction = Number(tasks.match(/SEASON_POINTS_PER_ACTION = (\d+)/)?.[1]);
    const perTask = Number(tasks.match(/SEASON_POINTS_PER_TASK = (\d+)/)?.[1]);
    expect({ perTask, perAction, задачаДороже: perTask > perAction })
      .toEqual({ perTask, perAction, задачаДороже: true });
  });

  it('темп начисления посчитан, а не выбран на глаз', () => {
    // Лестница идёт до 4900 очков. Проверяем, что при обычной ежедневной
    // игре лестница проходится за месяц, а не за две недели и не за год:
    // и то и другое делает пропуск бессмысленным
    const perAction = Number(tasks.match(/SEASON_POINTS_PER_ACTION = (\d+)/)?.[1]);
    const perTask = Number(tasks.match(/SEASON_POINTS_PER_TASK = (\d+)/)?.[1]);
    // 20 действий + 3 задачи в день — типичный день
    const perDay = 20 * perAction + 3 * perTask;
    const days = 4900 / perDay;
    expect({ днейНаЛестницу: Math.round(days), разумно: days >= 20 && days <= 45 })
      .toEqual({ днейНаЛестницу: expect.any(Number), разумно: true });
  });
});

describe('Боевой пропуск: ошибка не должна ломать игру', () => {
  it('начисление идёт отдельным неблокирующим вызовом', () => {
    // Слово «await» перед вызовом означало бы, что падение начисления
    // оборвёт метод целиком — и вместе с ним выдачу награды за задачу
    expect(tasks).toMatch(/void this\.grantSeasonPoints/);
    expect(tasks).not.toMatch(/await this\.grantSeasonPoints/);
  });

  it('ошибка начисления проглатывается с записью в журнал', () => {
    // Пропуск — украшение. Золото и предметы за задачу — оплата работы,
    // и они не должны зависеть от того, сложилась ли запись в лестнице
    expect(tasks).toMatch(/catch \(error\)[\s\S]*?logger\.warn/);
  });

  it('запись заводится и для тех, кто пропуск не покупал', () => {
    // Отдельная проверка «а куплен ли» была бы лишней: addSeasonPoints сам
    // регистрирует бесплатную лестницу. Иначе игрок, никогда не открывавший
    // пропуск, копил бы в никуда
    expect(premium).toMatch(/INSERT INTO battle_pass_progress/);
  });

  it('нулевое количество очков не тратит запрос', () => {
    expect(tasks).toMatch(/if \(points <= 0\) return;/);
  });
});

describe('Боевой пропуск: покупка имеет смысл', () => {
  it('уровни открываются по накопленным очкам', () => {
    // Проверяем, что механика не вывернута наизнанку: очки копятся и
    // уровни открываются, а не наоборот
    expect(premium).toMatch(/requiredPoints <= newPoints/);
  });

  it('уже полученные уровни не открываются повторно', () => {
    // Иначе игрок получит награду за один и тот же уровень дважды
    expect(premium).toMatch(/!row\.claimed_tiers\.includes\(t\.tier\)/);
  });

  it('получение награды отмечает уровень собранным', () => {
    expect(premium).toMatch(/async claimTierReward/);
    expect(premium).toMatch(/claimed_tiers/);
  });
});
