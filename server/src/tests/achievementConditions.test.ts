// Достижения перестали быть бесплатным золотом: у каждого есть условие,
// а выдать невыполнимое нечем.
//
// ЧТО БЫЛО. Условий не было ни у одного из двадцати достижений, а
// `checkAndUnlock` условие не проверял: брал что попросят и платил награду.
// Панель честно показывала «0 / 20» и показывала бы вечно, потому что
// звать выдачу было неоткуда. Поле `perfect_blocks`, на которое указывала
// дорожная карта, не существовало в базе: миграция 016 объявляла его в
// `CREATE TABLE IF NOT EXISTS combat_logs`, но таблицу уже создала 001.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AchievementService, ACHIEVEMENTS, isEarned, COUNTER_COLUMN, STATE_SOURCE,
} from '../services/AchievementService';
import type { AchievementCounter } from '../services/AchievementService';

jest.mock('../services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => ({ query: jest.fn(), queryOne: jest.fn() }) },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const CHAR = '11111111-1111-4111-8111-111111111111';
const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

/**
 * Подмена базы.
 *
 * Счётчики приходят одним SELECT из leaderboard, а выданные достижения -
 * одним SELECT из character_achievements. Отвечаем по тексту запроса, а не
 * по порядку вызовов: порядок не часть контракта, и проверка, зависящая
 * от него, проверяла бы саму себя.
 */
function подменить(opts: {
  счётчики?: Partial<Record<AchievementCounter, number>>;
  выданы?: string[];
  /** Строки leaderboard нет вовсе - персонаж ни разу не убил монстра */
  без_строки_рейтинга?: boolean;
}): { service: AchievementService; запросы: string[]; вставки: string[] } {
  const service = new AchievementService();
  const запросы: string[] = [];
  const вставки: string[] = [];
  (service as unknown as { db: unknown }).db = {
    query: jest.fn(async (sql: string) => {
      запросы.push(sql);
      // Список выданных идёт через query, а не queryOne. Если бы подмена
      // молчала на нём, checkAll считал бы, что не выдано ничего, и
      // платил бы награды за уже полученные - а это ровно тот случай,
      // ради которого проверка на повторную выдачу и нужна.
      if (/SELECT achievement_id FROM character_achievements/.test(sql)) {
        return (opts.выданы ?? []).map(achievement_id => ({ achievement_id }));
      }
      if (/INSERT INTO character_achievements/.test(sql)) {
        вставки.push(/VALUES \(\$1, \$2\)/.test(sql) ? 'achievement' : sql);
        return [];
      }
      if (/UPDATE characters SET gold/.test(sql)) { вставки.push('gold'); return []; }
      if (/UPDATE characters SET experience/.test(sql)) { вставки.push('experience'); return []; }
      return [];
    }),
    queryOne: jest.fn(async (sql: string, params: unknown[] = []) => {
      запросы.push(sql);
      if (/FROM character_achievements/.test(sql)) {
        // id достижения приходит ПАРАМЕТРОМ ($2), а не текстом запроса.
        // Первая версия подмены искала `'ach_perfect_block'` в SQL и
        // поэтому всегда отвечала «ещё не выдано»: проверка на
        // повторную выдачу проходила, ни разу не спросив базу.
        const id = opts.выданы?.find(a => params.includes(a)) ?? null;
        return id ? { '1': 1 } : null;
      }
      if (/FROM leaderboard/.test(sql)) {
        if (opts.без_строки_рейтинга) return null;
        const all: Record<string, number> = {
          monsters_killed: 0, parries: 0, pvp_wins: 0, quests_completed: 0,
        };
        return { ...all, ...opts.счётчики };
      }
      return null;
    }),
  };
  return { service, запросы, вставки };
}

describe('Условие достижения настоящее', () => {
  it('на десяти парированиях «Идеальный Блок» выдаётся', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_perfect_block')!;
    expect({
      на_девяти: isEarned(def, { parries: 9 }),
      на_десяти: isEarned(def, { parries: 10 }),
      на_двенадцати: isEarned(def, { parries: 12 }),
    }).toEqual({ на_девяти: false, на_десяти: true, на_двенадцати: true });
  });

  it('ровно на пороге достижение выдаётся, а не на пороге минус один', () => {
    // Сдвиг на единицу в сравнении не виден нигде: ни в описании, ни в
    // панели. Перебираем оба края у каждого достижения с условием.
    //
    // Ключ берётся по виду условия: счётчик и состояние живут в разных
    // пространствах значений, и isEarned принимает оба. Первая версия
    // проверки разбирала def.condition как будто у него всегда есть
    // .counter - и упала бы, как только появилось состояние.
    const с_условием = ACHIEVEMENTS.filter(a => a.condition);
    expect(с_условием.length).toBeGreaterThan(0);
    for (const def of с_условием) {
      const условие = def.condition!;
      const ключ = 'counter' in условие ? условие.counter : условие.state;
      const { need } = условие;
      expect({
        id: def.id,
        на_пороге_минус_один: isEarned(def, { [ключ]: need - 1 }),
        на_пороге: isEarned(def, { [ключ]: need }),
      }).toEqual({ id: def.id, на_пороге_минус_один: false, на_пороге: true });
    }
  });

  it('достижение без условия не выдаётся никогда', () => {
    // Ключевая честность: у двенадцати достижений счётчика в базе нет.
    // Без этого правила они выдавались бы за 100-500 золота просто так.
    const без_условия = ACHIEVEMENTS.filter(a => !a.condition);
    expect({ количество: без_условия.length }).toEqual({ количество: expect.any(Number) });
    for (const def of без_условия) {
      // Любые счётчики, даже заведомо огромные, не помогают
      const всё = { monsters_killed: 99999, parries: 99999, pvp_wins: 99999, quests_completed: 99999 };
      expect({ id: def.id, выдано: isEarned(def, всё) }).toEqual({ id: def.id, выдано: false });
    }
  });

  it('условие достижения — из закрытого списка', () => {
    // Имя колонки или имя состояния подставляется в SQL. Если бы оно
    // приходило из данных, подстановка чужого имени прошла бы мимо
    // typecheck. Проверяются оба вида условия, каждый по своему списку.
    for (const def of ACHIEVEMENTS) {
      if (!def.condition) continue;
      const условие = def.condition;
      if ('state' in условие) {
        expect({ id: def.id, состояние_из_списка: условие.state in STATE_SOURCE })
          .toEqual({ id: def.id, состояние_из_списка: true });
        continue;
      }
      const col = COUNTER_COLUMN[условие.counter];
      expect({ id: def.id, колонка_из_списка: col === условие.counter })
        .toEqual({ id: def.id, колонка_из_списка: true });
    }
    // Зафиксировано руками: новый счётчик обязан сломать эту проверку.
    expect(Object.keys(COUNTER_COLUMN).sort()).toEqual([
      'chess_wins', 'dungeons_cleared', 'items_crafted',
      'monsters_killed', 'parries', 'poetry_completed', 'pvp_wins', 'quests_completed',
    ]);
  });

  it('у счётчика парирований есть колонка в базе', () => {
    // Миграция обязана завести колонку. Без неё INSERT в leaderboard
    // падал бы на первом парировании, и счётчик не копился бы ни разу.
    const миграция = читать('database/migrations/046_parry_counter.sql');
    expect({
      колонка: /ADD COLUMN IF NOT EXISTS parries BIGINT NOT NULL DEFAULT 0/.test(миграция),
      граница: /leaderboard_parries_nonnegative/.test(миграция),
    }).toEqual({ колонка: true, граница: true });
  });

  it('миграция парирований не объявляет колонку заново в combat_logs', () => {
    // Откуда взялся фантом perfect_blocks: 016 объявляла его в
    // CREATE TABLE IF NOT EXISTS, а таблица уже была создана в 001.
    // Новая миграция не должна повторить приём.
    //
    // Ищем ОПЕРАЦИЮ, а не слово. Первая версия проверки искала просто
    // 'combat_logs' по всему файлу и находила его в комментарии, где
    // этот самый фантом описывается. Проверка, которая ищет слово,
    // проверяет комментарий, а не миграцию.
    const миграция = читать('database/migrations/046_parry_counter.sql');
    const код = миграция.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');
    expect({
      правит_не_combat_logs: !/ALTER\s+TABLE\s+combat_logs/i.test(код),
      не_создаёт_таблицу: !/CREATE\s+TABLE/i.test(код),
    }).toEqual({ правит_не_combat_logs: true, не_создаёт_таблицу: true });
  });

  it('у leaderboard есть все счётчики, на которые смотрят достижения', () => {
    // Условие смотрит на колонку, которой может не быть. Имена берутся
    // из СХЕМЫ, а не выдумываются.
    //
    // Ищем по ВСЕМ миграциям, а не по 014-й. Первая версия смотрела
    // только на 014, где таблица leaderboard создаётся, - и сломалась на
    // первом же счётчике, добавленном позже миграцией. Позже добавлять
    // колонки не запрещено, и это нормальный путь: заводить новый счётчик
    // в новой миграции правильнее, чем дописывать старую.
    const все = readdirSync(join(корень, 'database', 'migrations'))
      .filter(f => f.endsWith('.sql'))
      .map(f => читать(join('database', 'migrations', f)))
      .join('\n');
    const нужные = Object.values(COUNTER_COLUMN);
    const отсутствуют = нужные.filter(c => !new RegExp(`\\b${c}\\b`).test(все));
    expect({ отсутствуют }).toEqual({ отсутствуют: [] });
  });
});

describe('Выдача сверяется с условием, а не с просьбой', () => {
  it('при невыполненном условии награда не платится', async () => {
    const { service, вставки } = подменить({ счётчики: { parries: 9 } });
    const выдано = await service.checkAndUnlock(CHAR, 'ach_perfect_block');
    expect({ выдано, вставок: вставки.length }).toEqual({ выдано: false, вставок: 0 });
  });

  it('при выполненном условии выдаётся один раз и платится награда', async () => {
    const { service, вставки } = подменить({ счётчики: { parries: 10 } });
    const выдано = await service.checkAndUnlock(CHAR, 'ach_perfect_block');
    expect({
      выдано,
      записано_достижение: вставки.filter(v => v === 'achievement').length,
      золото: вставки.filter(v => v === 'gold').length,
      опыт: вставки.filter(v => v === 'experience').length,
    }).toEqual({ выдано: true, записано_достижение: 1, золото: 1, опыт: 1 });
  });

  it('уже выданное повторно не платится', async () => {
    const { service, вставки } = подменить({ счётчики: { parries: 50 }, выданы: ['ach_perfect_block'] });
    const выдано = await service.checkAndUnlock(CHAR, 'ach_perfect_block');
    expect({ выдано, вставок: вставки.length }).toEqual({ выдано: false, вставок: 0 });
  });

  it('достижение без условия не выдаётся даже при всех счётчиках', async () => {
    // Самый важный случай: раньше метод отдавал награду по первому же
    // вызову. Теперь - отказ.
    const { service, вставки } = подменить({
      счётчики: { monsters_killed: 99999, pvp_wins: 99999, quests_completed: 99999 },
    });
    const выдано = await service.checkAndUnlock(CHAR, 'ach_craft_master');
    expect({ выдано, вставок: вставки.length }).toEqual({ выдано: false, вставок: 0 });
  });

  it('несуществующее достижение не выдаётся', async () => {
    const { service } = подменить({ счётчики: { parries: 999 } });
    expect(await service.checkAndUnlock(CHAR, 'ach_не_существует')).toEqual(false);
  });

  it('отсутствующая строка рейтинга - это ноль, а не ошибка', () => {
    // Строка leaderboard появляется при первом событии. Персонаж, который
    // ещё ничего не делал, должен получать ноль, а не исключение.
    const { service, запросы } = подменить({ без_строки_рейтинга: true });
    return service.getCounters(CHAR).then(c => {
      expect({ счётчики: c }).toEqual({
        счётчики: {
          chess_wins: 0, dungeons_cleared: 0, items_crafted: 0,
          monsters_killed: 0, parries: 0, poetry_completed: 0, pvp_wins: 0, quests_completed: 0,
        },
      });
    }).then(() => {
      expect({ спросил_лидерборд: запросы.some(q => /FROM leaderboard/.test(q)) })
        .toEqual({ спросил_лидерборд: true });
    });
  });

  it('checkAll выдаёт выполненное и молчит о невыполненном', async () => {
    const { service, вставки } = подменить({ счётчики: { monsters_killed: 10, parries: 3 } });
    const выданы = await service.checkAll(CHAR);
    expect({
      выданы: выданы.sort(),
      // «Первая Кровь» (1 убийство) и «Охотник» (10 убийств) выполнены
      // оба: условие «меньше либо равно» на одном и том же счётчике
      // допускает оба, и это правильно - они лестницей.
      золото_за_двa: вставки.filter(v => v === 'gold').length,
      идеальный_блок_не_выдан: !выданы.includes('ach_perfect_block'),
    }).toEqual({ выданы: ['ach_first_blood', 'ach_monster_hunter_10'], золото_за_двa: 2, идеальный_блок_не_выдан: true });
  });

  it('checkAll не выдаёт то, что уже выдано', async () => {
    const { service, вставки } = подменить({
      счётчики: { monsters_killed: 10 },
      выданы: ['ach_first_blood'],
    });
    const выданы = await service.checkAll(CHAR);
    expect({
      выданы: выданы.sort(),
      золото_платится_один_раз: вставки.filter(v => v === 'gold').length,
    }).toEqual({ выданы: ['ach_monster_hunter_10'], золото_платится_один_раз: 1 });
  });
});

describe('Прогресс в панели честный', () => {
  it('у достижения со счётчиком приходит настоящий прогресс', async () => {
    const { service } = подменить({ счётчики: { parries: 7 } });
    const p = await service.getProgress(CHAR, 'ach_perfect_block');
    expect(p).toEqual({ unlocked: false, current: 7, need: 10, counted: true });
  });

  it('у достижения без счётчика приходит null, а не ноль', async () => {
    // Ноль рядом с «Скрафтить 50 предметов» выглядит как «не крафтил».
    // Настоящий ноль растёт, этот - нет. Панель по null пишет
    // «пока не считается», и это правда.
    //
    // Пример берётся ИЗ ДАННЫХ, а не зашивается. Первый вариант проверки
    // брал ach_craft_master - и когда тому завели настоящий счётчик
    // предметов, проверка стала проверять противоположное: у достижения
    // с условием current обязан быть числом, а не null. Зашитый пример
    // молча меняет смысл проверки вслед за данными.
    const безУсловия = ACHIEVEMENTS.find(a => !a.condition);
    // Если бы условия появились у всех, проверять было бы нечего - и она
    // должна сказать это прямо, а не проходить на пустом обходе.
    expect({ есть_хоть_одно_без_условия: !!безУсловия }).toEqual({ есть_хоть_одно_без_условия: true });
    const { service } = подменить({ счётчики: { parries: 7 } });
    const p = await service.getProgress(CHAR, безУсловия!.id);
    expect({ id: безУсловия!.id, ...p })
      .toEqual({ id: безУсловия!.id, unlocked: false, current: null, need: null, counted: false });
  });

  it('неизвестное достижение не ломает панель', async () => {
    const { service } = подменить({});
    expect(await service.getProgress(CHAR, 'ach_не_существует'))
      .toEqual({ unlocked: false, current: null, need: null, counted: false });
  });
});

describe('События боя действительно проверяют достижения', () => {
  const обработчик = читать('server/src/socket/GameSocketHandler.ts');

  it('парирование копит счётчик и проверяет достижения', () => {
    // Счётчик и проверка в цепочке: если бы increment был отдельным
    // void-вызовом, проверка могла бы пройти раньше, чем счётчик лёг в
    // базу, и десятое парирование не выдало бы достижение.
    expect({
      копит: /increment\(target\.id, \{ parries: 1 \}\)/.test(обработчик),
      проверяет: /\.then\(\(\) => this\.achievements\.checkAll\(target\.id\)\)/.test(обработчик),
    }).toEqual({ копит: true, проверяет: true });
  });

  it('счётчик парирований достаётся защитнику, а не атакующему', () => {
    // Парирование - заслуга того, кто стоял щитом. Если бы счётчик уходил
    // атакующему, «Идеальный Блок» получал бы тот, кого ударили.
    expect(/increment\(attacker\.id, \{ parries/.test(обработчик)).toEqual(false);
  });

  it('убийство монстра тоже проверяет достижения', () => {
    // Иначе «Первая Кровь» и «Охотник» остались бы недостижимыми.
    expect(/\.then\(\(\) => this\.achievements\.checkAll\(attacker\.id\)\)/.test(обработчик))
      .toEqual(true);
  });

  it('ошибка базы не рушит бой', () => {
    // Счётчик и достижение - награда, а не условие удара. Ошибка должна
    // уйти в лог, а не превращать парирование в ошибку.
    expect({
      ловит_ошибку: /\.then\(\(\) => this\.achievements\.checkAll\(target\.id\)\)\s*\n\s*\.catch\(/.test(обработчик),
    }).toEqual({ ловит_ошибку: true });
  });

  it('парирование учитывается в счётчике лидерборда, а не в тике', () => {
    // Тик регенерации перезаписывает строку рейтинга целиком. Если бы
    // парирования писались через updateStats, тик затирал бы их нулём
    // каждые пять секунд, и счётчик стоял бы на месте.
    const сервис = читать('server/src/services/LeaderboardService.ts');
    expect({
      в_накопительном: /parries\?: number/.test(сервис),
      в_абсолютном_нет: !/updateStats\([^)]*parries/.test(сервис),
    }).toEqual({ в_накопительном: true, в_абсолютном_нет: true });
  });
});

describe('Панель не рисует правдоподобную ложь', () => {
  const панель = читать('client/src/app/panels.ts');

  it('у несчитанного достижения пишет в словарь, а не ноль', () => {
    expect({
      // Строка живёт в словаре, а не в коде: панель показывается трём
      // языкам, и «пока не считается» хардкодом было бы по-русски у всех.
      в_словаре: /not_counted/.test(читать('shared/locales/ru.json'))
        && /not_counted/.test(читать('shared/locales/en.json'))
        && /not_counted/.test(читать('shared/locales/az.json')),
      берётся_через_перевод: /t\('achievements\.not_counted'\)/.test(панель),
      ноль_не_подставляется: !/\$\{a\.current \?\? 0\} \/ \$\{a\.need\}/.test(панель),
    }).toEqual({ в_словаре: true, берётся_через_перевод: true, ноль_не_подставляется: true });
  });

  it('прогресс рисуется рядом с названием, а не вместо него', () => {
    // Описание «Убить 10 монстров» остаётся: цифра его уточняет, а не
    // заменяет. Игрок должен видеть, что именно считается.
    // Срез от объявления прогресса до конца функции. Первая версия резала
    // по первому же 'box.append(row)', а он встречается выше - в ветке
    // пустого состояния, - и срез выходил пустым, проверка падала
    // непонятно, а любая правка панели её бы «чинила».
    const начало = панель.indexOf('const progress = a.counted');
    const блок = панель.slice(начало, панель.indexOf('export ', начало));
    expect({
      описание_есть: /friend-info/.test(блок),
      прогресс_есть: /lb-value/.test(блок),
    }).toEqual({ описание_есть: true, прогресс_есть: true });
  });
});

describe('Проверка не пустая', () => {
  it('достижений достаточно много, чтобы правило про условие что-то значило', () => {
    // Если бы достижений было три, запрет на выдачу без условия ничего бы
    // не охранял. Здесь их двадцать, и половина без счётчика.
    const с_условием = ACHIEVEMENTS.filter(a => a.condition).length;
    const без = ACHIEVEMENTS.length - с_условием;
    expect({ всего: ACHIEVEMENTS.length, с_условием, без }).toEqual({
      всего: ACHIEVEMENTS.length, с_условием: expect.any(Number), без: expect.any(Number),
    });
    // 21 достижение, из них 9 за реальными счётчиками. Раньше счётчика
    // не было ни у одного, и все 21 были недостижимы.
    //
    // Числа зафиксированы: новое достижение без условия или с условием
    // обязано сломать эту проверку, чтобы решение было осознанным.
    //
    // Было 9 и 12, стало 10 и 11, потом 12 и 9: «Шахматный Гений» получил
    // счётчик побед, а «Дружелюбный» и «Член Гильдии» - условие по
    // состоянию, которое пересчитывается из своих таблиц.
    // Стало 15 и 6: подземелья и крафт получили настоящие счётчики.
    expect({ с_условием, без }).toEqual({ с_условием: 15, без: 6 });
  });

  it('счётчик парирований — не единственный, кто ссылается на лидерборд', () => {
    // Иначе проверка «leaderboard покрыт» обслуживала бы одно поле.
    const использований = Object.values(COUNTER_COLUMN).length;
    //
    // Число зафиксировано руками. Новый счётчик обязан сломать эту
    // проверку: значит придётся подумать, есть ли на него колонка в базе
    // и достижение, которое на него смотрит. Проверка, которая
    // подстраивается сама, не напомнит ничего.
    //
    // Было 5, стало 6: добавлен chess_wins под «Шахматный Гений».
    expect({ использований }).toEqual({ использований: 8 });
  });

  it('список счётчиков не растёт в обход схемы', () => {
    // Каждая колонка COUNTER_COLUMN должна существовать в миграциях.
    // Список миграций НЕ зашит: читаются все .sql подряд, иначе новый
    // счётчик пришлось бы дописывать ещё и в эту проверку - забытый
    // пункт тихо прошёл бы мимо.
    //
    // Комментарий тут стоял «либо в 014, либо в 046» и устарел: счётчики
    // добавлялись в 049 (стихи) и 051 (шахматы).
    const все = readdirSync(join(корень, 'database', 'migrations'))
      .filter(f => f.endsWith('.sql'))
      .map(f => читать(join('database', 'migrations', f)))
      .join('\n');
    const отсутствуют = Object.values(COUNTER_COLUMN).filter(c => !new RegExp(`\\b${c}\\b`).test(все));
    expect({ отсутствуют }).toEqual({ отсутствуют: [] });
  });
});
