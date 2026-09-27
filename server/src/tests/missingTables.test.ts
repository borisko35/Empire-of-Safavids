// Два бага из охоты на мёртвый код: код писал в таблицы и колонки,
// которых в базе нет. Оба молча ломали награды игрока.
//
// 1. character_inventory. Таблицы с таким именем НЕТ. Миграция называется
//    006_character_inventory.sql, но создаёт character_items — и это
//    единственное отличие: имя файла совпадает с тем, что искал автор.
//    Ошибка не бросалась наружу (вызывающий код глотал её через
//    .catch(() => {})), но обрывала метод ПОСЛЕ начисления золота и опыта.
//    Итог: задача засчитывалась, предмет не выдавался, а игрок не получал
//    событие daily:task — то есть вообще не узнавал о выполнении. Хуже всего
//    то, что в dailyTasks.test.ts стояла проверка на строке
//    expect(service).toMatch(/character_inventory/) — тест закреплял баг.
//
// 2. guild_members.贡献_points. Колонка вклада была названа по-китайски:
//    U+8D21 U+733B плюс _points. Код при этом написан верно —
//    contribution_points, — поэтому и в списке участников, и при начислении
//    вклада он обращался к несуществующей колонке. Падало всё, что касается
//    участников: список участников, сдача золота в казну, вступление
//    (addMember вызывает getMembers для проверки лимита).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

/**
 * Проверяем код без комментариев.
 *
 * Рядом с починкой написано, как таблица называется на самом деле, —
 * и проверка «в коде больше нет character_inventory» падала сама на
 * собственном пояснении. Комментарии объясняют решения, выкидывать их
 * незачем, значит тесту надо смотреть на код.
 */
const daily = stripComments(read('server/src/services/DailyTaskService.ts'));
const endGame = stripComments(read('server/src/services/EndGameService.ts'));
const guild = stripComments(read('server/src/services/GuildService.ts'));
const fix = read('database/migrations/039_guild_contribution_column.sql');
const dailyTest = stripComments(read('server/src/tests/dailyTasks.test.ts'));

/** Все таблицы, реально созданные миграциями */
function tablesInMigrations(): Set<string> {
  const dir = join(repoRoot, 'database', 'migrations');
  const out = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.sql')) continue;
    const sql = readFileSync(join(dir, f), 'utf-8');
    for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)/gi)) {
      out.add(m[1].toLowerCase());
    }
  }
  return out;
}

const tables = tablesInMigrations();

describe('Награды кладутся в таблицы, которые реально существуют', () => {
  it('таблицы character_inventory в базе нет', () => {
    // Утверждение, на котором держался баг: именем миграции легко обмануться
    expect(tables.has('character_inventory')).toBe(false);
    expect(tables.has('character_items')).toBe(true);
  });

  it('задачи дня пишут в character_items', () => {
    expect(daily).not.toMatch(/character_inventory/);
    expect(daily).toMatch(/INSERT INTO character_items/);
  });

  it('башня пишет в character_items', () => {
    expect(endGame).not.toMatch(/character_inventory/);
    expect(endGame).toMatch(/INSERT INTO character_items/);
  });

  it('цель ON CONFLICT совпадает с настоящим уникальным индексом', () => {
    // Настоящий индекс трёхколоночный: (character_id, item_id, enhancement).
    // С двумя колонками Postgres не нашёл бы индекс и упал бы с новой
    // ошибкой — починка одной поломки породила бы другую
    for (const code of [daily, endGame]) {
      expect(code).toMatch(/ON CONFLICT \(character_id, item_id, enhancement\)/);
    }
  });

  it('тест не закрепляет старую ошибку', () => {
    // Проверка на character_inventory БЫЛА причиной, по которой баг
    // не ловили: тест требовал неправильную таблицу и проходил.
    //
    // Ищем именно УТВЕРЖДЕНИЕ, а не любое упоминание: запрещать само слово
    // нельзя — иначе этот тест запрещал бы сам себя, ведь проверка
    // not.toMatch с тем же текстом тоже заканчивается на toMatch.
    // Взгляд назад отсекает префикс not., а вот требовать наличие такой
    // строки — нельзя.
    expect(dailyTest).not.toMatch(/(?<!not\.)toMatch\(\s*\/[^/]*character_inventory/);
    expect(dailyTest).toMatch(/character_items/);
  });
});

describe('Колонка вклада в гильдии названа так, как её зовёт код', () => {
  it('миграция 015 действительно создаёт колонку с иероглифами', () => {
    // Фиксируем найденное, чтобы при следующем разборе миграций знали про
    // расхождение: иероглифы не видны в глазаз, их легко не заметить
    const m015 = stripComments(read('database/migrations/015_guilds_achievements_daily.sql'));
    expect(/[\u4e00-\u9fff]/.test(m015)).toBe(true);
  });

  it('код нигде не использует иероглифы', () => {
    expect(/[\u4e00-\u9fff]/.test(guild)).toBe(false);
  });

  it('есть миграция, которая это чинит', () => {
    // Правкой 015 не помочь: применённые миграции записываются в
    // schema_migrations по имени файла и второй раз не выполняются
    expect(fix).toMatch(/RENAME COLUMN/);
    expect(fix).toMatch(/contribution_points/);
  });

  it('переименование идемпотентно', () => {
    // Повторный запуск не должен падать. Проверяем наличие обеих колонок
    // ДО переименования, а не только сам RENAME
    expect(fix).toMatch(/has_old/);
    expect(fix).toMatch(/has_new/);
    expect(fix).toMatch(/IF has_old AND NOT has_new/);
  });

  it('NULL приводится к нулю', () => {
    // В коде это число складывают и показывают игроку. NULL там — арифметика
    expect(fix).toMatch(/SET contribution_points = 0 WHERE contribution_points IS NULL/);
  });

  it('список участников перестаёт падать', () => {
    // Не только сдача золота: getMembers читает ту же колонку, а через неё
    // addMember проверяет лимит — то есть вступление в гильдию
    expect(guild).toMatch(/gm\.contribution_points/);
    expect(guild).toMatch(/SET contribution_points = contribution_points \+ \$1/);
  });
});

describe('Схема против кода: ловим такие расхождения заранее', () => {
  it('в тестах есть сверка таблиц с миграциями', () => {
    // Именно она должна была поймать character_inventory. Смотрим, что
    // она вообще есть и что ей не мешает
    const schema = read('server/src/tests/schemaColumns.test.ts');
    expect(schema.length).toBeGreaterThan(0);
  });
});
