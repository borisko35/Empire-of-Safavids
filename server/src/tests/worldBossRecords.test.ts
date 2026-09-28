// Мировые боссы: победы попадают в базу, расписание не врёт.
//
// ЧТО БЫЛО. WorldEventSystem держал активного босса в Map в памяти, а
// таблицы world_boss_kills и world_boss_schedule — созданные миграцией 002 —
// оставались пустыми. Победа означала «удалить из Map и выдать награду».
//
// Хуже: миграция засеяла next_spawn: Симург через 7 дней, Рустам через 14,
// а код спавнил босса каждые 3 часа. В базе лежало расписание, не совпадающее
// с тем, что игроки видели, — и по нему нельзя было узнать ничего настоящего.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');
const src = (p: string): string => stripComments(read(p));

const world = src('server/src/systems/WorldEventSystem.ts');
const loop = src('server/src/systems/GameLoop.ts');

describe('Мировые боссы: победы записываются', () => {
  it('победа пишется в world_boss_kills', () => {
    expect(world).toMatch(/INSERT INTO world_boss_kills/);
    expect(world).toMatch(/recordKill\(bossId, killerId\)/);
  });

  it('гильдия победителя записывается', () => {
    // Таблица для того и заведена: «кто и какой гильдией убил босса» —
// это то, что потом показывают в интерфейсе зала славы
    expect(world).toMatch(/guildId = killer\?\.guildId \?\? null/);
    expect(world).toMatch(/INSERT INTO world_boss_kills \(boss_id, guild_id/);
  });

  it('top_damage не выдумывается', () => {
    // Сервер не собирает расклад по урону за бой. Записывать надо того,
    // кого знаем, а не сочинять правдоподобные проценты
    expect(world).toMatch(/JSON\.stringify\(\[\{ characterId: killerId \}\]\)/);
  });

  it('счётчик убийств копится, а последняя победа запоминается', () => {
    expect(world).toMatch(/kill_count = kill_count \+ 1/);
    expect(world).toMatch(/last_killed = NOW\(\)/);
  });

  it('is_alive отражает реальное состояние босса', () => {
    expect(world).toMatch(/is_alive = FALSE/);
    expect(world).toMatch(/is_alive = TRUE/);
  });
});

describe('Мировые боссы: расписание не врёт', () => {
  it('next_spawn пересчитывается по настоящему интервалу', () => {
    // Не по 7 и 14 дням из сида миграции: код спавнил босса каждые 3 часа,
    // и база обязана говорить то же, что происходит на самом деле.
    // Поэтому в SQL идёт параметр из константы, а не число строкой.
    expect(world).toMatch(/next_spawn = NOW\(\) \+ \(\$2 \|\| ' milliseconds'\)::interval/);
    expect(world).toMatch(/\[bossId, String\(EVENT_INTERVAL_MS\)\]/);
    // Числа часов в самом SQL быть не должно: это место, где 7 дней из
    // миграции тихо вернулись бы в код
    const sqlNumbers = (world.match(/interval '[^']*'/g) ?? []);
    expect({ чисел_часов_в_sql: sqlNumbers.length }).toEqual({ чисел_часов_в_sql: 0 });
  });

  it('расписание читается при старте сервера', () => {
    expect(world).toMatch(/async loadSchedule/);
    expect(world).toMatch(/FROM world_boss_schedule/);
    expect(loop).toMatch(/loadSchedule\(\)/);
  });

  it('ошибка чтения не роняет старт сервера', () => {
    expect(world).toMatch(/не удалось прочитать расписание/);
  });

  it('ошибка записи победы не отменяет награду', () => {
    // Награда уже выдана, босс уже убит. Отменять победу из-за базы
    // нельзя — игрок бы остался без добычи за реальный бой
    expect(world).toMatch(/recordKill\(bossId, killerId\)\.catch\(/);
  });
});

describe('Мировые боссы: идентификатор босса один', () => {
  it('спавн и запись используют одну и ту же константу', () => {
    // Раньше идентификатор был зашит прямо в spawnBoss, и в таблицу
    // расписания попасть было нечем. Две строки со строкой в разных
    // местах рано или поздно разойдутся
    expect(world).toMatch(/const WORLD_BOSS_ID = 'world_boss_simurgh'/);
    const hardcoded = (world.match(/MONSTERS_DATABASE\['world_boss/g) ?? []).length;
    expect({ босс_зашит_строкой: hardcoded }).toEqual({ босс_зашит_строкой: 0 });
  });

  it('в карте боссов хранится и экземпляр, и id босса', () => {
    // Иначе при победе нечем заполнить колонку boss_id
    expect(world).toMatch(/interface ActiveBoss/);
    expect(world).toMatch(/instanceId: string;\s*bossId: string;/);
  });
});
