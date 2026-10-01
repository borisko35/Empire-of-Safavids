// Посещения регионов: два достижения были невыполнимы.
//
// ЧТО БЫЛО. «Посетить Тебриз» и «Посетить все 7 регионов» не имели условия.
// Проверить их по characters.region нельзя было: в этой колонке лежит
// ТЕКУЩИЙ регион, и у нового персонажа он по умолчанию ровно 'tabriz'
// (миграция 001). Проверка region = 'tabriz' была бы верной с момента
// регистрации, и достижение выдавалось бы бесплатно, никто никуда не
// сходив. Это ловушка, которая заработала бы права.
//
// ПОЧЕМУ ТАБЛИЦА, А НЕ СЧЁТЧИК. Посещённые регионы - множество, а
// множество нельзя хранить числом: «посетить все 7» превратилось бы в
// «совершить семь переходов», и семь прыжков между двумя городами закрыли бы
// достижение.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ACHIEVEMENTS, isEarned, STATE_SOURCE } from '../services/AchievementService';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

/** Падение с внятной причиной вместо невнятного false в deep equality. */
function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

/** Все регионы из enum Region - единственный их перечень в проекте. */
function регионыИзКода(): string[] {
  const src = читать('server/src/types/game.types.ts');
  const блок = /enum Region \{([\s\S]*?)\}/.exec(src)?.[1] ?? '';
  return [...блок.matchAll(/=\s*'([a-z_]+)'/g)].map(m => m[1]);
}

describe('Порог «все регионы» совпадает с настоящим списком', () => {
  it('в enum Region ровно семь регионов', () => {
    // Число зафиксировано руками как ловушка: появление восьмого региона
    // обязано сломать проверку, иначе «все 7» навсегда останется
    // достижимым, не покрывая новую землю.
    expect({ регионов: регионыИзКода().length, имена: регионыИзКода().sort() }).toEqual({
      регионов: 7,
      имена: ['caucasus', 'isfahan', 'khorasan', 'mesopotamia', 'persian_gulf', 'shiraz', 'tabriz'],
    });
  });

  it('условие достижения требует все семь', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_explorer_all')!;
    const всего = регионыИзКода().length;
    expect({
      условие: def.condition,
      ровно_столько_же: (def.condition as { need: number })?.need === всего,
    }).toEqual({ условие: { state: 'regions_visited', need: 7 }, ровно_столько_же: true });
  });

  it('шести регионов не хватает, семи хватает', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_explorer_all')!;
    expect({
      шесть: isEarned(def, { regions_visited: 6 }),
      семь: isEarned(def, { regions_visited: 7 }),
    }).toEqual({ шесть: false, семь: true });
  });
});

describe('Тебриж считается по посещениям, а не по текущему региону', () => {
  it('состояние читает таблицу посещений, а не characters.region', () => {
    // Ключевая проверка всей правки. Читать region из characters означало бы
    // вернуть правдивый ноль всем и сразу, потому что регион есть у каждого.
    expect({
      из_таблицы_посещений: /FROM region_visits/.test(STATE_SOURCE.visited_tabriz),
      из_characters_нет: !/FROM characters/.test(STATE_SOURCE.visited_tabriz),
      имя_региона_в_sql_есть: /region = 'tabriz'/.test(STATE_SOURCE.visited_tabriz),
    }).toEqual({ из_таблицы_посещений: true, из_characters_нет: true, имя_региона_в_sql_есть: true });
  });

  it('достижение выдаётся ровно с первого посещения', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_explorer_tabriz')!;
    expect({
      условие: def.condition,
      ни_одного: isEarned(def, { visited_tabriz: 0 }),
      одно: isEarned(def, { visited_tabriz: 1 }),
    }).toEqual({ условие: { state: 'visited_tabriz', need: 1 }, ни_одного: false, одно: true });
  });

  it('много посещений Тебрица не заменяют посещение Исфахана', () => {
    // Разные состояния - разные пространства: сто раз побывать в Тебрице
    // не то же самое, что побывать в Исфахане.
    const def = ACHIEVEMENTS.find(a => a.id === 'ach_explorer_tabriz')!;
    expect({ от_исфахана: isEarned(def, { regions_visited: 99 }) })
      .toEqual({ от_исфахана: false });
  });
});

describe('Посещение записывается, а не выдумывается', () => {
  it('отметка есть и при создании персонажа, и при путешествии', () => {
    // Отметка при создании нужна, потому что стартовый регион - Исфахан, и
    // без неё «посетить Исфахан» не засчитывалось бы новичку, который никуда
    // не ходил. Это общий случай, а не частность Тебрица.
    //
    // ЧТО БЫЛО. Окно бралось фиксированной длиной в 1400 символов от
    // INSERT. Стоило вставить в createCharacter ещё одну колонку с
    // комментарием - и вызов recordRegionVisit выпал из окна, проверка
    // упала, хотя вызов никуда не делся. Окно было произвольным числом,
    // а не границей: так ломается сама идея проверки.
    //
    // Теперь окно - от INSERT до следующего метода. Это настоящая граница
    // функции createCharacter, и добавление строк внутри неё её не сдвинет.
    const код = читать('server/src/services/CharacterService.ts');
    const начало = код.indexOf('INSERT INTO characters');
    const конец = код.indexOf('async updateRegion');
    must(начало > 0, 'в CharacterService не найден INSERT INTO characters');
    must(конец > начало, 'в CharacterService не найден async updateRegion после INSERT');
    const создание = код.slice(начало, конец);
    const регион = код.slice(код.indexOf('async updateRegion'), код.indexOf('async updateZone'));
    expect({
      при_создании: /recordRegionVisit\(character\.id, character\.region\)/.test(создание),
      при_путешествии: /await this\.recordRegionVisit\(characterId, region\)/.test(регион),
    }).toEqual({ при_создании: true, при_путешествии: true });
  });

  it('повторный приход в тот же город не плодит строки', () => {
    // Одна строка на регион, а не на каждый переход: иначе «все 7» закрыли бы
    // семь прыжков между двумя городами.
    const код = читать('server/src/services/CharacterService.ts');
    expect({
      on_conflict: /ON CONFLICT \(character_id, region\) DO NOTHING/.test(код),
      счётчика_приходов_нет: !/visits_count = region_visits\.visits_count/.test(код),
    }).toEqual({ on_conflict: true, счётчика_приходов_нет: true });
  });

  it('сбой записи не роняет путешествие', () => {
    // Персонаж всё равно оказался в регионе. Ронять переход из-за отметки
    // значило бы наказать игрока за то, что он куда-то дошёл.
    const код = читать('server/src/services/CharacterService.ts');
    const метод = код.slice(
      код.indexOf('private async recordRegionVisit'),
      код.indexOf('async updateRegion'));
    expect({
      ошибка_перехвачена: /catch \(err\)/.test(метод),
      в_журнал: /logger\.warn/.test(метод),
      проброса_нет: !/throw /.test(метод),
    }).toEqual({ ошибка_перехвачена: true, в_журнал: true, проброса_нет: true });
  });
});

describe('Таблица и добавление существующих', () => {
  it('миграция создаёт таблицу с ключом по паре', () => {
    const миграция = читать('database/migrations/056_region_visits.sql');
    expect({
      таблица: /CREATE TABLE IF NOT EXISTS region_visits/.test(миграция),
      составной_ключ: /PRIMARY KEY \(character_id, region\)/.test(миграция),
      счётчик_неотрицателен: /CHECK \(visits_count >= 1\)/.test(миграция),
    }).toEqual({ таблица: true, составной_ключ: true, счётчик_неотрицателен: true });
  });

  it('ограничение сверяет регион с настоящим перечнем', () => {
    // Список в CHECK и список в enum Region - две правды, если их писали
    // отдельно. Проверка сверяет их друг с другом.
    const миграция = читать('database/migrations/056_region_visits.sql');
    const вSql = /region IN \(([^)]*)\)/.exec(миграция)?.[1] ?? '';
    const вSqlИмена = [...вSql.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
    expect({ совпадает: вSqlИмена.join(',') === регионыИзКода().sort().join(','),
      в_sql: вSqlИмена.length }).toEqual({ совпадает: true, в_sql: 7 });
  });

  it('существующим персонажам добавлен их текущий регион', () => {
    // Персонаж стоит в своём регионе, значит он там и был. Без этого
    // достижение оказалось бы недостижимым для всех, кто не путешествовал.
    const миграция = читать('database/migrations/056_region_visits.sql');
    expect({
      добавление_есть: /INSERT INTO region_visits[\s\S]*SELECT id, region FROM characters/.test(миграция),
      без_дублей: /ON CONFLICT \(character_id, region\) DO NOTHING/.test(миграция),
    }).toEqual({ добавление_есть: true, без_дублей: true });
  });

  it('миграций на добавление посещений ровно одна', () => {
    // ЧТО БЫЛО. Фильтр искал слово region_visits по всему тексту миграции,
    // включая комментарии. Стоило новой миграции упомянуть таблицу в
    // комментарии - и проверка объявляла, что посещений добавляли дважды.
    // Это ложное срабатывание: комментарий не создаёт таблицу.
    //
    // Теперь комментарии вырезаются, и считаются только настоящие
    // обращения к таблице. Ловушка при этом остаётся: вторая миграция,
    // которая её правда меняет, всё равно попадёт в список.
    const безКомментариев = (текст: string): string => текст.replace(/--[^\n]*/g, ' ');
    const файлы = readdirSync(join(корень, 'database', 'migrations'))
      .filter(f => f.endsWith('.sql') && /region_visits/i.test(безКомментариев(читать(`database/migrations/${f}`))));
    must(файлы.length > 0, 'не нашлось ни одной миграции, создающей таблицу посещений');
    expect({ файлы }).toEqual({ файлы: ['056_region_visits.sql'] });
  });
});
