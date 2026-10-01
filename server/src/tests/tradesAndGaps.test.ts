// Торговые контракты считаются, а оставшиеся достижения без условия
// описаны точно: почему измерить нечем.
//
// ЧТО БЫЛО. У «Торговца Шёлкового Пути» написано «выполнить 10 торговых
// контрактов», и условия не было. Контракты же работают: TradeService.deliver
// сдаёт груз и платит.
//
// ЧТО В ЭТОМ ФАЙЛЕ ВТОРОГО. Пять достижений остаются без условия, и каждое
// - по своей причине. Причина записана рядом с достижением, а не «где-то в
// документации»: «пока не считается» без причины неотличимо от «мы забыли».
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACHIEVEMENTS, isEarned } from '../services/AchievementService';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

const БЕЗ_УСЛОВИЯ = ACHIEVEMENTS.filter(a => !a.condition);

describe('Контракты считаются', () => {
  it('достижение торговца смотрит на счётчик контрактов', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_trader')!;
    expect({ условие: def.condition }).toEqual({ условие: { counter: 'trades_completed', need: 10 } });
  });

  it('порог считается от нуля, а не от единицы', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_trader')!;
    expect({
      девять: isEarned(def, { trades_completed: 9 }),
      десять: isEarned(def, { trades_completed: 10 }),
      сто: isEarned(def, { trades_completed: 100 }),
    }).toEqual({ девять: false, десять: true, сто: true });
  });

  it('принятый контракт не считается выполненным', () => {
    // accept - это ещё не выполнение. Счётчик обязан расти в deliver.
    const код = читать('server/src/systems/TradeService.ts');
    const уDeliver = /void grantReputation\(characterId, 'tradeDone'\);[\s\S]{0,900}increment\(characterId, \{ tradesCompleted: 1 \}\)/.test(код);
    const уAccept = /async accept\([\s\S]*?tradesCompleted/.test(
      код.slice(код.indexOf('async accept('), код.indexOf('async deliver(')));
    expect({ у_deliver: уDeliver, у_accept: уAccept }).toEqual({ у_deliver: true, у_accept: false });
  });

  it('счётчик растёт после выплат, а не до них', () => {
    // Если бы счётчик рос, а выплата упала, контракт был бы засчитан без
    // денег.
    const код = читать('server/src/systems/TradeService.ts');
    const выплата = код.indexOf('addGoldReward(characterId, def.rewardGold)');
    const счётчик = код.indexOf('increment(characterId, { tradesCompleted: 1 })');
    expect({
      выплата_есть: выплата > 0,
      счётчик_после_выплаты: счётчик > выплата,
      ошибка_не_поднимается: /\.catch\(err => logger\.error/.test(код.slice(счётчик, счётчик + 200)),
    }).toEqual({ выплата_есть: true, счётчик_после_выплаты: true, ошибка_не_поднимается: true });
  });

  it('колонка появляется миграцией с потолком шире достижимого', () => {
    const миграция = читать('database/migrations/053_trades_completed.sql');
    expect({
      колонка: /ADD COLUMN IF NOT EXISTS trades_completed INT/.test(миграция),
      потолок_есть: /trades_completed >= 0 AND trades_completed <= 10000/.test(миграция),
    }).toEqual({ колонка: true, потолок_есть: true });
  });
});

describe('Безусловных достижений не осталось', () => {
  it('ни одного: у всех 21 есть условие', () => {
    // Список зафиксирован РУКАМИ и теперь пуст. Прежний список держал
    // ach_no_death, которому добавлен счётчик заходов без единой смерти.
    // Новое достижение без условия снова сломает эту проверку.
    expect({ без_условия: БЕЗ_УСЛОВИЯ.map(a => a.id).sort() })
      .toEqual({ без_условия: [] });
  });

  it('мировой босс в игре ЕСТЬ, и счётчик его убийств заведён', () => {
    // ПРЕДЫДУЩАЯ ПРОВЕРКА ГОВОРИЛА ОБРАТНОЕ И ОШИБАЛАСЬ.
    // Она искала только в data/dungeons.ts и systems/DungeonService.ts, не
    // нашла там босса - и заключила, что его нет в игре. Проверка проходила
    // именно потому, что смотрела не туда.
    //
    // Теперь ищем по-настоящему и требуем, чтобы система была ЖИВОЙ, а не
    // просто объявленной: если WorldEventSystem есть в файлах, но не
    // создаётся и не крутится, мировой босс снова окажется несуществующим
    // - только теперь уже по-настоящему.
    const боссы = читать('server/src/data/monsters.ts');
    const мир = читать('server/src/systems/WorldEventSystem.ts');
    const цикл = читать('server/src/systems/GameLoop.ts');
    const счётчик = читать('server/src/services/LeaderboardService.ts');

    expect({
      боссы_объявлены: /world_boss_simurgh/.test(боссы) && /world_boss_rustam_reborn/.test(боссы),
      система_есть: /class WorldEventSystem/.test(мир),
      система_создаётся: /WorldEventSystem\.getInstance\(\)\.init/.test(цикл),
      система_запускается: /WorldEventSystem\.getInstance\(\)\.start/.test(цикл),
      расписание_читается: /loadSchedule\(\)/.test(цикл),
      победа_пишется: /world_boss_kills/.test(мир),
      счётчик_заведён: /worldBossKills\?: number/.test(счётчик),
    }).toEqual({
      боссы_объявлены: true, система_есть: true, система_создаётся: true,
      система_запускается: true, расписание_читается: true,
      победа_пишется: true, счётчик_заведён: true,
    });
  });

  it('достижение об убийстве мирового босса смотрит на этот счётчик', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_boss_slayer')!;
    expect({
      условие: def.condition,
      ни_одной_победы: isEarned(def, { world_boss_kills: 0 }),
      одна_победа: isEarned(def, { world_boss_kills: 1 }),
    }).toEqual({ условие: { counter: 'world_boss_kills', need: 1 }, ни_одной_победы: false, одна_победа: true });
  });

  it('счётчик побед над боссами реально начисляется при убийстве', () => {
    // ЭТОЙ ПРОВЕРКИ СНАЧАЛА НЕ БЫЛО. Поломка «убрать начисление из
    // onBossDefeated» не роняла ничего: предыдущая проверка требовала лишь
    // самого ключа в LeaderboardService, а он оставался на месте, даже
    // когда число никто не писал. Ключ в списке и начисление по факту -
    // разные вещи, и проверять надо обе.
    const мир = читать('server/src/systems/WorldEventSystem.ts');
    const вПобеде = мир.slice(мир.indexOf('async onBossDefeated'), мир.indexOf('async loadSchedule'));
    expect({
      начисляется: /increment\(killerId, \{ worldBossKills: 1 \}\)/.test(вПобеде),
      после_записи_победы: /recordKill[\s\S]*increment\(killerId/.test(вПобеде),
      ошибка_не_поднимается: /\.catch\(e => logger\.warn/.test(вПобеде),
    }).toEqual({ начисляется: true, после_записи_победы: true, ошибка_не_поднимается: true });
  });


  it('«посетить регион» нельзя проверить одним characters.region', () => {
    // ЛОВУШКА, ЗАРАБОТАВШАЯ БЫ ПРАВО. Раньше у нового персонажа регион
    // стоял в 'tabriz' по умолчанию, поэтому проверка
    // «characters.region = 'tabriz'» была бы верной с момента регистрации,
    // и достижение выдавалось бы бесплатно, никто никуда не сходив.
    //
    // ЧТО СТАЛО. Умолчание исправлено на 'isfahan' миграцией 067: старт
    // теперь действительно Исфахан, и в него нельзя попасть, не родившись
    // там. Ловушка с тривиальной проверкой закрыта.
    //
    // НО ЗАЧЕМ ВСЁ ЕЩЁ ПРОВЕРЯЕТСЯ. characters.region хранит ТЕКУЩИЙ
    // регион - одну точку маршрута, а не пройденный путь. Проверять достижение
    // по нему всё равно нельзя: персонаж, сходивший в Тебриз и вернувшийся
    // домой, выглядит так же, как никуда не ходивший. Честный источник -
    // таблица region_visits (миграция 056), где строка означает «здесь был».
    const начальная = читать('database/migrations/001_initial_schema.sql');
    const исправляющая = читать('database/migrations/067_start_region_isfahan.sql');
    const посещения = читать('database/migrations/056_region_visits.sql');
    expect({
      // 001 остаётся как был: применённые миграции не переписывают.
      старое_умолчание_в_001: /region\s+VARCHAR\(\d+\)\s+NOT NULL DEFAULT 'tabriz'/.test(начальная),
      // Новая миграция приводит умолчание к настоящему старту.
      умолчание_исправлено: /ALTER COLUMN region SET DEFAULT 'isfahan'/.test(исправляющая),
      // И таблица посещений на месте: без неё проверка достижения
      // снова станет проверкой одного столбца с текущим регионом.
      таблица_посещений_есть: /CREATE TABLE IF NOT EXISTS region_visits/.test(посещения),
    }).toEqual({
      старое_умолчание_в_001: true,
      умолчание_исправлено: true,
      таблица_посещений_есть: true,
    });
  });


  it('смерти в подземелье считаются, а «без смертей» измеримо', () => {
    // Раньше здесь стояло обратное утверждение: «смертей не считают, и
    // измерить нечем». Оно было правдой - до миграции 059 и счётчика
    // dungeons_no_death. Теперь утверждение поменялось на противоположное,
    // и ошибка в коде покрасит проверку.
    const подземелья = читать('server/src/systems/DungeonService.ts');
    const тик = читать('server/src/systems/GameLoop.ts');
    expect({
      счётчик_начисляется: /dungeonsNoDeath: 1/.test(подземелья),
      смерти_считаются: /recordDeath\(target\.id\)/.test(тик),
      только_при_нуле: /const смертей = session\.deaths\.get\(killerId\) \?\? 0;/.test(подземелья)
        && /if \(смертей === 0\)/.test(подземелья),
    }).toEqual({ счётчик_начисляется: true, смерти_считаются: true, только_при_нуле: true });
  });
});

describe('Правило «нет условия = не выдаётся» держится', () => {
  it('заведомо огромные числа не выдают достижение без условия', () => {
    for (const def of БЕЗ_УСЛОВИЯ) {
      const всё = {
        monsters_killed: 99999, parries: 99999, pvp_wins: 99999,
        quests_completed: 99999, poetry_completed: 99999, chess_wins: 99999,
        combo_best: 99999, dungeons_cleared: 99999, items_crafted: 99999,
        trades_completed: 99999, world_boss_kills: 99999, dungeons_no_death: 99999,
        has_friend: 99, in_guild: 99, regions_visited: 99, visited_tabriz: 99,
      };
      expect({ id: def.id, выдано: isEarned(def, всё) }).toEqual({ id: def.id, выдано: false });
    }
  });

  it('у каждого безусловного достижения написана причина', () => {
    // Причина без записи рядом с достижением неотличима от «забыли».
    //
    // ОКНО - ТОЛЬКО СВОЙ ТЕКСТ, А НЕ 900 СИМВОЛОВ НАЗАД.
    // Первая версия брала код.slice(i - 900, i), и это окно накрывало
    // объяснение СОСЕДНЕГО достижения. Поломка «снести причину у ach_no_death»
    // проверку не роняла: за соседним комментарием всё ещё было видно слово
    // «не считается» от другого пункта. Окно теперь ограничено предыдущим
    // упоминанием id - то есть ровно тем, что относится к этой записи.
    const код = читать('server/src/services/AchievementService.ts');
    const причины = БЕЗ_УСЛОВИЯ.map(def => {
      const i = код.indexOf(`id: '${def.id}',`);
      must(i > 0);
      const предыдущий = код.lastIndexOf("id: '", i - 1);
      const свойТекст = код.slice(предыдущий < 0 ? 0 : предыдущий, i);
      const маркер = /не (считается|существует|заводи)|нет (таблицы|условия|счётчика)|максимум|по умолчанию|ловушк|измеримо|системы нет/i;
      return { id: def.id, своя_причина: маркер.test(свойТекст) };
    });
    // Порядок в данных не алфавитный, а ожидание зашито по алфавиту.
    // Без сортировки проверка падала бы на самом порядке и говорила бы не о
    // том, что должна.
    причины.sort((a, b) => a.id.localeCompare(b.id));
    // Ожидание зашито руками, а не выведено из того, что пришло.
    // Форма «map(p => ({...p, своя_причина: true}))» сравнивает факт сам с
    // собой и всегда зелёная на своей же форме - это проверка формы, а не
    // содержания.
    expect({ причины }).toEqual({
      причины: [
        ],
    });
  });
});

/** Проверка якоря с полным отказом: индекс -1 означает потерю смысла. */
function must(cond: boolean): void {
  if (!cond) throw new Error('проверка потеряла смысл: якорь достижения не найден');
}
