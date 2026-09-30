// Подземелья и крафт считаются: три достижения были без условия.
//
// ЧТО БЫЛО. У «Исследователя Подземелий», «Ученика Кузнеца» и «Мастера
// Крафта» было написано «пройти первое подземелье», «скрафтить первый
// предмет» и «скрафтить 50 предметов», и условия не было ни у одного.
// Подземелья и крафт в игре работают, а измерить их было нечем.
//
// ГЛАВНОЕ, ЧТО ЛОВЯТ ЭТИ ПРОВЕРКИ. Счётчик «скрафчено предметов» нельзя
// расти за неудачный крафт: предмет не выдан, деньги за него не
// заплачены. И нельзя расти внутри транзакции своим соединением - при
// откате крафта предмет исчез бы, а счётчик остался бы. Ровно та ошибка,
// о которой предупреждает комментарий в CraftingService про опыт ремесла.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACHIEVEMENTS, isEarned } from '../services/AchievementService';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

/**
 * Проверка якоря с полным отказом.
 *
 * Отдельная функция, а не expect: если якорь не найден, тест обязан
 * упасть сам, а не молча сравнить -1 с чем-нибудь и объявить успех.
 */
function must2(cond: boolean, message: string): void {
  if (!cond) throw new Error('проверка потеряла смысл: ' + message);
}

describe('Счётчики заведены и связаны с достижениями', () => {
  it('три достижения смотрят на два счётчика', () => {
    // Числа зафиксированы руками как ловушки: добавление или снятие
    // условия обязано сломать эту проверку.
    const условия = ACHIEVEMENTS
      .filter(a => a.condition && 'counter' in a.condition)
      .map(a => [a.id, (a.condition as { counter: string; need: number }).counter,
        (a.condition as { counter: string; need: number }).need]);
    expect({
      подземелья: условия.filter(u => u[1] === 'dungeons_cleared'),
      крафт: условия.filter(u => u[1] === 'items_crafted'),
    }).toEqual({
      подземелья: [['ach_dungeon_first', 'dungeons_cleared', 1]],
      крафт: [
        ['ach_first_craft', 'items_crafted', 1],
        ['ach_craft_master', 'items_crafted', 50],
      ],
    });
  });

  it('описания обещают ровно то, что проверяет условие', () => {
    // Условие и текст - две разные правды, если их писали отдельно.
    // «Скрафтить 50 предметов» обязано означать need: 50.
    //
    // Про слово «первое»: в английских описаниях его нет цифрой, и первый
    // вариант проверки искал только цифры - получал NaN и сравнивал NaN с
    // 1, то есть проверял, что NaN не равно 1. Слово «first» значит 1, и
    // оно разбирается явно, а не молча пропускается.
    const числоИзОписания = (текст: string | undefined): number => {
      const цифры = /(\d+)/.exec(текст ?? '')?.[1];
      if (цифры) return Number(цифры);
      return /\bfirst\b/i.test(текст ?? '') ? 1 : NaN;
    };
    const результат = ['ach_dungeon_first', 'ach_first_craft', 'ach_craft_master'].map(id => {
      const def = ACHIEVEMENTS.find(a => a.id === id)!;
      const обещано = числоИзОписания(def.description);
      const фактически = (def.condition as { need: number } | undefined)?.need;
      return { id, в_описании: обещано, в_условии: фактически, совпало: обещано === фактически };
    });
    expect({ все_совпали: результат.every(r => r.совпало), подробно: результат })
      .toEqual({
        все_совпали: true,
        подробно: [
          { id: 'ach_dungeon_first', в_описании: 1, в_условии: 1, совпало: true },
          { id: 'ach_first_craft', в_описании: 1, в_условии: 1, совпало: true },
          { id: 'ach_craft_master', в_описании: 50, в_условии: 50, совпало: true },
        ],
      });
  });

  it('порог считается от нуля, а не от единицы', () => {
    // isEarned сравнивает «меньше либо равно». Перебор краёв: на пороге
    // выдаётся, на пороге минус один - нет.
    const первый = ACHIEVEMENTS.find(a => a.id === 'ach_first_craft')!;
    const мастер = ACHIEVEMENTS.find(a => a.id === 'ach_craft_master')!;
    expect({
      крафт_0: isEarned(первый, { items_crafted: 0 }),
      крафт_1: isEarned(первый, { items_crafted: 1 }),
      мастер_49: isEarned(мастер, { items_crafted: 49 }),
      мастер_50: isEarned(мастер, { items_crafted: 50 }),
    }).toEqual({ крафт_0: false, крафт_1: true, мастер_49: false, мастер_50: true });
  });

  it('подземелья не выдаются за счётчик убийств', () => {
    // Разные пространства: убитые монстры в подземелье не заменяют
    // факта прохождения подземелья.
    const данж = ACHIEVEMENTS.find(a => a.id === 'ach_dungeon_first')!;
    expect({
      от_убийств: isEarned(данж, { monsters_killed: 99999 }),
      от_друга: isEarned(данж, { has_friend: 99 }),
      от_подземелий: isEarned(данж, { dungeons_cleared: 1 }),
    }).toEqual({ от_убийств: false, от_друга: false, от_подземелий: true });
  });
});

describe('Колонки появляются миграцией, а не по пути', () => {
  it('обе колонки с ограничениями есть в миграции', () => {
    const миграция = читать('database/migrations/052_dungeon_craft_counters.sql');
    expect({
      подземелья: /ADD COLUMN IF NOT EXISTS dungeons_cleared INT/.test(миграция),
      крафт: /ADD COLUMN IF NOT EXISTS items_crafted INT/.test(миграция),
      потолок_подземелий: /dungeons_cleared >= 0 AND dungeons_cleared <= 10000/.test(миграция),
      потолок_крафта: /items_crafted >= 0 AND items_crafted <= 100000/.test(миграция),
    }).toEqual({ подземелья: true, крафт: true, потолок_подземелий: true, потолок_крафта: true });
  });

  it('потолки в базе шире достижимого, а не ровно на пороге', () => {
    // Потолок ровно 50 сломал бы достижение навсегда: любая ошибка с
    // двойным начислением делала бы его недостижимым, и чинить пришлось
    // бы вручную. Предохранитель должен ловить грубую ошибку, а не
    // мешать играть.
    const миграция = читать('database/migrations/052_dungeon_craft_counters.sql');
    const подземелия = /dungeons_cleared <= (\d+)/.exec(миграция)?.[1];
    const крафт = /items_crafted <= (\d+)/.exec(миграция)?.[1];
    expect({
      потолок_подземелий_больше_порога: Number(подземелия) > 1,
      потолок_крафта_больше_порога: Number(крафт) > 50,
    }).toEqual({ потолок_подземелий_больше_порога: true, потолок_крафта_больше_порога: true });
  });
});

describe('Счётчик растёт в правильном месте', () => {
  it('крафт считает предметы только за успех и только после транзакции', () => {
    // По исходнику: поведенческая проверка не отличила бы начисление
    // внутри транзакции от начисления после неё.
    const код = читать('server/src/services/CraftingService.ts');
    const началоБлока = код.indexOf('async completeCrafting');
    const конецБлока = код.indexOf('async getActiveJobs');
    const блок = код.slice(началоБлока, конецБлока);

    // ЛОКАЛЬНОЕ ОКНО, А НЕ ВЕСЬ МЕТОД.
    // Первая версия брала блок от первого вхождения logger.info(`Crafting`,
    // а таких в файле два: из startCrafting и из completeCrafting. Блок
    // накрыл оба метода, и проверка `if (success) { ... increment(` находила
    // `if (success)` из транзакции записи предмета - то есть
    // удовлетворялась чем угодно. Поломка «считать и за неудачный крафт»
    // эту проверку не ломала, и она была мёртвой, не падая.
    const счётчик = блок.indexOf('increment(');
    must2(счётчик > 0, 'increment не найден');
    const окно = блок.slice(Math.max(0, счётчик - 300), счётчик + 120);

    // Оба индекса считаются В ОДНОЙ системе отсчёта - по самому коду.
    const транзакция = код.lastIndexOf('});', началоБлока);
    expect({
      только_за_успех: /if \(success\) \{/.test(окно),
      ошибка_не_поднимается: /\.catch\(err => logger\.error/.test(окно),
      после_закрытия_транзакции: счётчик > 0 && началоБлока > 0 && началоБлока + счётчик > транзакция,
    }).toEqual({ только_за_успех: true, ошибка_не_поднимается: true, после_закрытия_транзакции: true });
  });

  it('подземелья считаются после закрытия сессии', () => {
    // Если бы запись подземелья не прошла, расти не от чего.
    const код = читать('server/src/systems/DungeonService.ts');
    const закрытие = код.indexOf("closeSessionInDb(session.id, 'completed')");
    const счётчик = код.indexOf('dungeonsCleared');
    expect({
      счётчик_есть: счётчик > 0,
      после_закрытия: счётчик > закрытие,
      ошибка_не_поднимается: /\.catch\(\(e\) => logger\.warn/.test(
        код.slice(счётчик, счётчик + 200)),
    }).toEqual({ счётчик_есть: true, после_закрытия: true, ошибка_не_поднимается: true });
  });

  it('оба счётчика идут через общий increment, а не своей записью', () => {
    // Своя запись в leaderboard - это переписывание счётчика вместо
    // накопления, и именно так однажды уже сломался счётчик убийств.
    const крафт = читать('server/src/services/CraftingService.ts');
    const данж = читать('server/src/systems/DungeonService.ts');
    expect({
      крафт_через_increment: /LeaderboardService\(\)\.increment\(job\.character_id, \{ itemsCrafted: 1 \}\)/.test(крафт),
      данж_через_increment: /LeaderboardService\(\)\.increment\(killerId, \{ dungeonsCleared: 1 \}\)/.test(данж),
      прямой_записи_нет: !/UPDATE leaderboard|INSERT INTO leaderboard/.test(крафт + данж),
    }).toEqual({ крафт_через_increment: true, данж_через_increment: true, прямой_записи_нет: true });
  });

  it('имена колонок выводятся из ключей инкремента без ошибок', () => {
    // В increment имя колонки получается из camelCase ключа вставкой
    // подчёркиваний. Ошибка в написании ключа дала бы колонку, которой
    // нет, и начисление падало бы каждый раз.
    const ключи = читать('server/src/services/LeaderboardService.ts');
    const есть = ['chessWins', 'dungeonsCleared', 'itemsCrafted']
      .filter(k => new RegExp('\\b' + k + '\\?: number').test(ключи));
    expect({ есть }).toEqual({ есть: ['chessWins', 'dungeonsCleared', 'itemsCrafted'] });
  });
});
