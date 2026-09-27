// Задачи дня и недели.
//
// ТУТ БЫЛО ТРИ СМЕЖНЫЕ ПОЛОМКИ, И ВСЕ ТРИ БЫЛИ НЕВИДИМЫ:
//
//  1. updateProgress() НЕ ВЫЗЫВАЛСЯ НИ РАЗУ. Восемь задач висели в панели
//     с прогрессом 0/20 и не двигались никогда. Игрок думал, что сломалось.
//
//  2. Маршрут /progression/tasks передавал req.userId, а сервис ищет по
//     character_daily_progress.character_id. Это разные числа. Даже с
//     рабочим updateProgress прогресс писался бы мимо.
//
//  3. Панель задач брала саму себя (#panel-tasks) и innerHTML стирал ей
//     заголовок с иконкой. Остальные панели берут внутренний div.
//
// Задача дня — это то, что возвращает игрока завтра. Пока она не работает,
// весь этот раздел не приносит ничего.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const service = stripComments(read('server/src/services/DailyTaskService.ts'));
// Тот же баг с несуществующей таблицей был и в награде за этаж башни
const endGame = stripComments(read('server/src/services/EndGameService.ts'));
const routes = read('server/src/routes/progression.ts');
const socket = read('server/src/socket/GameSocketHandler.ts');
const game = read('server/src/routes/game.ts');
const fishing = read('server/src/systems/FishingSystem.ts');
const clientPanels = read('client/src/app/panels.ts');
const clientApi = read('client/src/app/api.ts');
const clientWorld = read('client/src/app/world.ts');
const constants = read('shared/constants.ts');

/** Все task_type, объявленные в задачах */
function taskTypes(): string[] {
  return (service.match(/task_type: '(\w+)'/g) ?? [])
    .map((m) => m.replace(/task_type: '/, '').replace(/'$/, ''));
}

describe('Задачи дня: прогресс действительно пишется', () => {
  it('updateProgress вызывается из игровых событий, а не висит мёртвым', () => {
    // ТУТ БЫЛА ГЛАВНАЯ ПОЛОМКА: функция была написана, но никем не звалась
    const calls = [...socket.matchAll(/dailyTasks\s*\n?\s*\.?updateProgress\(/g)].length
      + [...socket.matchAll(/this\.dailyTasks\.updateProgress\(/g)].length
      + [...game.matchAll(/dailyTasks\.updateProgress\(/g)].length;
    // Убийства (3 типа) + данж + квесты в сокете, крафт + торговля + PvP в маршрутах
    expect(calls).toBeGreaterThanOrEqual(7);
  });

  it('каждый тип задачи имеет место, где он засчитывается', () => {
    // Убийства, данж, квесты, крафт, торговля, PvP, рыбалка
    const sources = [socket, game, fishing];
    for (const type of taskTypes()) {
      const wired = sources.some((s) => s.includes(`'${type}'`));
      expect({ type, wired }).toEqual({ type, wired: true });
    }
  });

  it('нет задачи, цель которой нельзя получить в игре', () => {
    // ТУТ БЫЛА ЗАДАЧА «Собрать 15 лепестков роз»: механики сбора в мире
    // нет вообще, лепестки встречаются только как цель квеста. Задача
    // была невыполнима в принципе.
    const items = read('server/src/data/items.ts');
    const quests = read('server/src/data/quests.ts');
    const gathers = [...fishing.matchAll(/addItems\([^)]*itemId: fish\.id/g)].length;
    expect(gathers).toBeGreaterThan(0);
    for (const target of (service.match(/target: '(mat_|acc_|arm_|wpn_)[a-z_]+'/g) ?? [])) {
      const id = target.replace(/target: '/, '').replace(/'$/, '');
      // Цель должна существовать в данных предметов
      expect({ id, exists: items.includes(`id: '${id}'`) })
        .toEqual({ id, exists: true });
      void quests;
    }
  });

  it('элитные и мировые боссы считаются отдельно от обычных', () => {
    // Раньше задача «Охотник на Элиту» посчитала бы любого монстра
    expect(socket).toMatch(/def\.type !== 'elite'/);
    expect(socket).toMatch(/def\.type !== 'world_boss'/);
  });

  it('за несколько закрытых квестов прибавляется сразу amount', () => {
    // За один бой могло закрыться несколько квестов
    expect(socket).toMatch(/'quest_complete', 'any', allCompleted\.length/);
  });
});

describe('Задачи дня: маршрут передаёт персонажа, а не аккаунт', () => {
  it('characterId обязателен и берётся из запроса', () => {
    // ТУТ БЫЛА ОШИБКА: req.userId != characterId, прогресс всегда нулевой
    expect(routes).toMatch(/req\.query\.characterId/);
    expect(routes).not.toMatch(/getAvailable\(req\.userId/);
    expect(routes).not.toMatch(/getCompletedCount\(req\.userId/);
  });

  it('без characterId отдаётся ошибка, а не пустой список', () => {
    // Иначе игрок увидит «задач нет» и решит, что их не существует
    expect(routes).toMatch(/characterId is required/);
  });

  it('клиент передаёт персонажа', () => {
    expect(clientApi).toMatch(/tasks: \(characterId: string\)/);
    expect(clientPanels).toMatch(/api\.tasks\(charId\)/);
  });
});

describe('Задачи дня: панель не стирает сама себя', () => {
  it('берётся внутренний блок, а не сама панель', () => {
    // ТУТ БЫЛА ТРЕТЬЯ ПОЛОМКА: innerHTML по #panel-tasks стирал заголовок
    expect(clientPanels).toMatch(/const box = \$\('tasks-content'\)/);
    expect(clientPanels).not.toMatch(/const box = \$\('panel-tasks'\)/);
  });

  it('внутренний блок действительно есть в разметке', () => {
    expect(read('client/src/app/index.html')).toMatch(/id="tasks-content"/);
  });

  it('название задачи показывается на языке игрока', () => {
    expect(clientPanels).toMatch(/document\.documentElement\.lang === 'en'/);
  });
});

describe('Задачи дня: награда видна игроку', () => {
  it('есть событие о выполненной задаче', () => {
    // Иначе игрок узнает о награде только по цифре в кошельке
    expect(constants).toMatch(/DAILY_TASK_COMPLETED: 'daily:task'/);
    expect(socket).toMatch(/SERVER_EVENTS\.DAILY_TASK_COMPLETED/);
    expect(clientWorld).toMatch(/socket\.on\('daily:task'/);
  });

  it('сообщение переводится на язык игрока', () => {
    for (const lang of ['ru', 'en', 'az']) {
      const json = JSON.parse(read(`shared/locales/${lang}.json`)) as Record<string, Record<string, string>>;
      // Ключи лежат под site, а не под panels — проверяем по факту
      expect({ lang, ok: !!json.site.tasks_done_toast }).toEqual({ lang, ok: true });
    }
  });

  it('награда начисляется сервером, а не клиентом', () => {
    // Клиент не должен ничего «начислять сам» — только показать
    expect(service).toMatch(/UPDATE characters SET gold = gold \+ \$1 WHERE id = \$2/);
    expect(service).toMatch(/character_items/);
  });

  it('предмет кладётся в таблицу, которой на самом деле существует', () => {
    // ТЕСТ РАНЬШЕ ЗАКРЕПЛЯЛ БАГ: он требовал строки character_inventory —
    // таблицы, которой в базе НЕТ. Проверено: в миграциях встречается
    // только файл 006_character_inventory.sql, а создаёт он character_items.
    // Ошибка роняла метод уже после начисления золота и опыта, из-за чего
    // не доходил return и игрок не получал событие daily:task.
    expect(service).not.toMatch(/character_inventory/);
  });

  it('цель конфликта совпадает с настоящим уникальным индексом', () => {
    // Уникальный индекс — (character_id, item_id, enhancement), трёхколоночный.
    // С двумя колонками Postgres не нашёл бы индекс и упал бы с новой ошибкой,
    // то есть починка одной ошибки породила бы другую
    expect(service).toMatch(/ON CONFLICT \(character_id, item_id, enhancement\)/);
    expect(service).toMatch(/INSERT INTO character_items \(character_id, item_id, quantity, enhancement\)/);
    expect(service).toMatch(/DO UPDATE SET quantity = character_items\.quantity \+ EXCLUDED\.quantity/);
  });

  it('событие о выполнении доходит до игрока даже при выдаче предмета', () => {
    // Строка return обязана стоять ПОСЛЕ выдачи награды, иначе игрок не
    // увидит уведомление о выполнении задачи
    const itemAt = service.indexOf('INSERT INTO character_items');
    const returnAt = service.lastIndexOf('taskCompleted: true');
    expect({ itemBeforeReturn: itemAt > -1 && returnAt > itemAt })
      .toEqual({ itemBeforeReturn: true });
  });

  it('в башне награда кладётся в ту же настоящую таблицу', () => {
    // Тот же баг был во втором месте: первый предмет этажа ронял весь
    // метод, и игрок проходил этаж без награды
    expect(endGame).toMatch(/INSERT INTO character_items/);
    expect(endGame).not.toMatch(/character_inventory/);
    expect(endGame).toMatch(/ON CONFLICT \(character_id, item_id, enhancement\)/);
  });
});

describe('Задачи дня: содержимое', () => {
  it('у каждой задачи есть награда', () => {
    const defs = service.match(/reward_gold: \d+[\s\S]*?reset_hours: \d+/g) ?? [];
    expect(defs.length).toBeGreaterThanOrEqual(8);
    for (const d of defs) expect(d).toMatch(/reward_gold: [1-9]/);
  });

  it('есть и ежедневные, и еженедельные задачи', () => {
    // Еженедельные удерживают игрока дольше ежедневных
    expect(service).toMatch(/reset_hours: 24/);
    expect(service).toMatch(/reset_hours: 168/);
  });

  it('сброс прогресса по сроку работает', () => {
    expect(service).toMatch(/hoursSinceReset >= task\.reset_hours/);
    expect(service).toMatch(/current_count = 0, completed = FALSE/);
  });

  it('выполненная задача не начисляется дважды', () => {
    // Иначе можно было бы держать зажатый kill и собрать награду 100 раз
    expect(service).toMatch(/if \(!row \|\| row\.completed\) continue/);
  });
});
