// Данжи переживают перезапуск сервера.
//
// ЧТО БЫЛО. DungeonService держал заходы в Map в памяти, а пять таблиц
// dungeon_* были пустыми. Перезапуск сервера стирал все активные заходы:
// игрок возвращался в мир, данж начинал заново, а убитые боссы
// воскресали. Хуже всего — это выглядело как обычное сохранение прогресса
// в неудачный момент, а не как ошибка.
//
// Теперь сессия пишется в базу, а при старте сервера поднимается заново.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');
const src = (p: string): string => stripComments(read(p));

const service = src('server/src/systems/DungeonService.ts');
const loop = src('server/src/systems/GameLoop.ts');

describe('Данжи: сессии в базе, а не только в памяти', () => {
  it('идентификатор сессии — UUID, а не строка вида dg_177…_a1b2c3', () => {
    // Колонка dungeon_sessions.id объявлена UUID. Значение «dg_177…_a1b2c3»
    // в такую колонку не пишется: Postgres отвергает его. То есть сессия
    // не могла оказаться в базе в принципе — молча, без ошибки в логе.
    expect({ осталась_старая_схема: service.includes('`dg_${Date.now()}') })
      .toEqual({ осталась_старая_схема: false });
    expect(service).toMatch(/id: uuidv4\(\)/);
  });

  it('сессия и её участники записываются в базу', () => {
    expect(service).toMatch(/INSERT INTO dungeon_sessions/);
    expect(service).toMatch(/INSERT INTO dungeon_members/);
  });

  it('выход брошенного захода закрывает сессию в базе', () => {
    // Без этого заход остался бы active и вернулся бы при следующем
    // перезапуске как живая, хотя монстров давно нет
    expect(service).toMatch(/closeSessionInDb\(session\.id, 'abandoned'\)/);
  });

  it('завершённый заход попадает в историю', () => {
    // dungeon_history пустая с миграции 010: без неё нельзя показать игроку
    // число пройденных данжей и нельзя понять, какие из них никто не брал
    expect(service).toMatch(/INSERT INTO dungeon_history\s*\n/);
    expect(service).toMatch(/closeSessionInDb\(session\.id, 'completed'\)/);
  });

  it('при старте сервера заходы восстанавливаются', () => {
    expect(service).toMatch(/async restoreActiveSessions/);
    expect(service).toMatch(/WHERE s\.status = 'active'/);
    expect(loop).toMatch(/restoreActiveSessions\(\)/);
  });

  it('восстановление спавнит монстров тем же кодом, что и новый заход', () => {
    // Две копии списка монстров рано или поздно разошлись бы, и
    // восстановленный заход считался бы выигранным тем, что не убито
    expect(service).toMatch(/private spawnSessionMonsters\(/);
    const calls = (service.match(/this\.spawnSessionMonsters\(session, def\)/g) ?? []).length;
    // ровно два: enter и restoreActiveSessions
    expect({ мест_вызова: calls }).toEqual({ мест_вызова: 2 });
  });

  it('ошибка записи не отменяет вход игрока в данж', () => {
    // Монстры уже заспавнены, сессия уже создана. Отмена входа из-за базы
    // оставила бы игрока в подвешенном состоянии
    expect(service).toMatch(/persistSession\(session\)\.catch\(/);
    expect(service).toMatch(/не удалось записать сессию/);
  });

  it('восстановление не падает на заходах, которые уже не восстановить', () => {
    // Данж удалили из кода, персонажа удалили, участников нет — такое
    // случается, и оно не должно ронять старт сервера
    expect(service).toMatch(/if \(!def\)/);
    expect(service).toMatch(/if \(!leader\)/);
    expect(service).toMatch(/не удалось прочитать активные сессии/);
  });
});
