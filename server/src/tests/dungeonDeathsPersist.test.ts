// Смерти в подземелье переживают перезапуск сервера.
//
// ЗАЧЕМ. Счётчик «без единой смерти» жил в памяти сессии. Память умирает
// вместе с сервером, и сессия, восстановленная после рестарта, начинала
// считать с нуля: заход, в котором игрок умер ДО перезапуска,
// засчитывался как безсмертный. То есть достижение выдавалось за то,
// чего не было. Это не «неудобно» - это выдача награды обманом.
//
// ГЛАВНАЯ ПРОВЕРКА. Смерть записывается в базу СРАЗУ, а не при закрытии
// сессии. При закрытии запись не случилась бы при падении сервера - а это
// ровно тот случай, ради которого таблица заведена.
//
// ВТОРАЯ, НЕ МЕНЕЕ ВАЖНАЯ. Запись из recordDeath НЕ ПОДНИМАЕТ исключение.
// recordDeath зовётся из боевого тика, и исключение означало бы, что тик
// встал из-за счётчика достижения: игрок умер - и весь бой у всех встал.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');
const подземелья = читать('server/src/systems/DungeonService.ts');
const миграция = читать('database/migrations/060_dungeon_deaths.sql');

describe('Таблица смертей заведена', () => {
  it('dungeon_deaths с ключом по сессии и персонажу', () => {
    expect({
      таблица: /CREATE TABLE IF NOT EXISTS dungeon_deaths/.test(миграция),
      составной_ключ: /PRIMARY KEY \(session_id, character_id\)/.test(миграция),
      счётчик_не_флаг: /deaths\s+INTEGER NOT NULL DEFAULT 0/.test(миграция),
      не_отрицательный: /CHECK \(deaths >= 0\)/.test(миграция),
      каскад_от_сессии: /REFERENCES dungeon_sessions\(id\) ON DELETE CASCADE/.test(миграция),
    }).toEqual({ таблица: true, составной_ключ: true, счётчик_не_флаг: true,
      не_отрицательный: true, каскад_от_сессии: true });
  });
});

describe('Смерть пишется в базу сразу', () => {
  const метод = подземелья.slice(
    подземелья.indexOf('recordDeath(characterId: string): void'),
    подземелья.indexOf('recordDeath(characterId: string): void') + 1600);

  it('запись идёт в dungeon_deaths', () => {
    // ГЛАВНАЯ ПРОВЕРКА ФАЙЛА. Пока записи не было, счётчик жил только в
    // памяти и обнулялся вместе с сервером.
    expect({
      вставляет: /INSERT INTO dungeon_deaths/.test(метод),
      инкремент: /deaths = dungeon_deaths\.deaths \+ 1/.test(метод),
      ключи: /\[sessionId, characterId\]/.test(метод),
    }).toEqual({ вставляет: true, инкремент: true, ключи: true });
  });

  it('запись не бросает в боевой тик', () => {
    // Игрок умер - и весь бой у всех встал бы из-за счётчика достижения.
    expect({
      без_await: /void this\.db\.query\(/.test(метод),
      ошибка_в_журнал: /\.catch\(\(e: unknown\) =>/.test(метод)
        && /смерть не записана в базу/.test(метод),
      нет_throw: !/throw /.test(метод),
    }).toEqual({ без_await: true, ошибка_в_журнал: true, нет_throw: true });
  });

  it('в памяти счётчик тоже растёт', () => {
    // Запись в базу - не замена счётчику в памяти: он решает, прошёл ли
    // ТЕКУЩИЙ заход без смертей, и к нему обращается выдача достижения.
    expect({
      растёт_в_памяти: /session\.deaths\.set\(characterId, \(session\.deaths\.get\(characterId\) \?\? 0\) \+ 1\)/.test(метод),
    }).toEqual({ растёт_в_памяти: true });
  });
});

describe('Восстановление читает смерти, а не начинает с нуля', () => {
  it('deaths заполняется из базы, а не пустой картой', () => {
    // Прежде здесь стояло `deaths: new Map()` с комментарием «смерти ДО
    // перезапуска восстановить нельзя - это дыра». Дыра закрыта.
    const блок = подземелья.slice(
      подземелья.indexOf('async restoreActiveSessions'),
      подземелья.indexOf('async restoreActiveSessions') + 3000);
    expect({
      читает_из_базы: /deaths: await this\.loadDeaths\(row\.id\)/.test(блок),
      пустой_карты_нет: !/deaths: new Map\(\),/.test(блок),
      дыры_больше_нет: !/это известная дыра/.test(блок),
    }).toEqual({ читает_из_базы: true, пустой_карты_нет: true, дыры_больше_нет: true });
  });

  it('загрузчик читает таблицу по сессии', () => {
    const метод = подземелья.slice(
      подземелья.indexOf('private async loadDeaths'),
      подземелья.indexOf('private async loadDeaths') + 1200);
    expect({
      запрос: /SELECT character_id, deaths FROM dungeon_deaths WHERE session_id = \$1/.test(метод),
      собирает_карту: /карта\.set\(строка\.character_id, Number\(строка\.deaths\) \|\| 0\)/.test(метод),
    }).toEqual({ запрос: true, собирает_карту: true });
  });

  it('ошибка чтения возвращает пустую карту, а не выдуманные нули', () => {
    // Пустая карта значит «смертей не нашли» - честно для сессии без
    // смертей. Если бы база была недоступна и это сошло бы за ноль,
    // игрок получил бы достижение за выдуманную безdeath-смерть.
    const метод = подземелья.slice(
      подземелья.indexOf('private async loadDeaths'),
      подземелья.indexOf('private async loadDeaths') + 1200);
    expect({
      ловит_ошибку: /\.catch\(\(e: unknown\) =>/.test(метод),
      причина_в_журнале: /смерти сессии не прочитаны/.test(метод),
    }).toEqual({ ловит_ошибку: true, причина_в_журнале: true });
  });
});
