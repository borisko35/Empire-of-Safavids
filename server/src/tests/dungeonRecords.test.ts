// Таблица рекордов: данные копились годами, а показать их было некому.
//
// ЧТО ЗАМЕР ПОКАЗАЛ. Таблица dungeon_history создана миграцией 010, в неё пишется
// каждый проход, и во всём сервере было ОДНО обращение — вставка. Ни одного
// чтения. Индекс (dungeon_id, result) задуман ровно под выборку рекордов.
//
// ПРОВЕРКА ЛОВИТ ИМЕННО ЭТО. Если чтения из dungeon_history снова не появится,
// тест упадёт: рекорды без выборки — это снова таблица, которая только растёт.
//
// ОТДЕЛЬНО ПРО ИМЯ. У characters нет колонки name_ru: такая колонка есть только
// у питомцев. Запрос со строкой c.name_ru скомпилировался бы молча и упал бы в
// рантайме. Проверка требует именно characters.name.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');
const код = (p: string): string => stripComments(читать(p));

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const сервис = код('server/src/systems/DungeonService.ts');
const маршруты = код('server/src/routes/game.ts');
const апи = код('client/src/app/api.ts');
const панель = код('client/src/app/panels.ts');

describe('Рекорды: данные наконец читаются', () => {
  it('есть чтение из dungeon_history, а не только вставка', () => {
    must(/FROM dungeon_history/.test(сервис), 'dungeon_history только растёт: её никто не читает');
    must(
      /JOIN characters c ON c\.id = h\.character_id/.test(сервис),
      'рекорд без имени рекордсмена: показывать нечего'
    );
  });

  it('берутся только завершённые проходы с реальным временем', () => {
    must(/h\.result = 'completed'/.test(сервис), 'в рекорды попадают брошенные заходы');
    must(/h\.duration_sec IS NOT NULL/.test(сервис), 'проход без времени попадёт в рекорды');
    must(/h\.duration_sec > 0/.test(сервис), 'нулевое время обошло бы любой результат');
  });

  it('имя берётся из characters.name, а не из несуществующей name_ru', () => {
    must(/SELECT c\.name,/.test(сервис), 'имя рекордсмена не берётся');
    must(!/c\.name_ru/.test(сервис), 'запрос идёт к c.name_ru — такой колонки у персонажа нет');
    // Такая колонка есть у питомцев — на этом уже обжигались.
    const питомцы = читать('database/migrations/016_pets_housing_pvp_endgame.sql');
    must(/name_ru/.test(питомцы), 'name_ru в миграции питомцев исчез: проверка по подсказке ослабла');
  });

  it('порядок однозначен: время, дата, имя', () => {
    must(
      /ORDER BY h\.duration_sec ASC, h\.completed_at ASC, c\.name ASC/.test(сервис),
      'порядок рекордов не задан или задан частично: одинаковые результаты будут прыгать'
    );
  });

  it('список ограничен, и граница задаётся с сервера', () => {
    must(/LIMIT \$2/.test(сервис), 'нет ограничения выборки: можно выкачать всю историю');
    must(маршруты.includes("Number(req.query.limit)"), 'число рекордов не берётся от маршрута');
    must(/Math\.min\(20/.test(маршруты), 'клиент может попросить сколько угодно записей');
  });

  it('ошибка чтения не роняет панель', () => {
    must(/catch\(\(e: unknown\)/.test(сервис), 'падение выборки не гасится: панель рекордов упадёт');
  });
});

describe('Рекорды: маршрут и клиент', () => {
  it('маршрут есть и защищён', () => {
    must(маршруты.includes("'/dungeons/:dungeonId/records'"), 'маршрута рекордов нет');
    const начало = маршруты.indexOf("'/dungeons/:dungeonId/records'");
    const конец = маршруты.indexOf('gameRouter.', начало + 10);
    const блок = маршруты.slice(начало, конец > начало ? конец : начало + 400);
    must(блок.includes('secureMiddleware'), 'рекорды открыты без проверки владения');
    must(/dungeonRecords\(req\.params\.dungeonId/.test(маршруты), 'маршрут не вызывает выборку');
  });

  it('клиент умеет брать рекорды и показывать их', () => {
    must(/dungeonRecords: \(dungeonId: string\)/.test(апи), 'вызова рекордов нет на клиенте');
    must(/api\.dungeonRecords\(d\.id\)/.test(панель), 'панель не берёт рекорды');
    must(/t\('panels\.dungeon_records'\)/.test(панель), 'подпись рекорда не рисуется');
  });

  it('время показывается как минуты и секунды, а не сырыми цифрами', () => {
    must(/Math\.floor\(рекорд\.durationSec \/ 60\)/.test(панель), 'время не переводится в минуты');
    must(/padStart\(2, '0'\)/.test(панель), 'секунды без ведущего нуля: «1:5» вместо «01:05»');
  });

  it('пустой список не рисует мусор и не роняет панель', () => {
    must(
      /api\.dungeonRecords\(d\.id\)\.catch\(/.test(панель),
      'падение выборки рекордов уронит панель данжей'
    );
    must(/if \(рекорды\.records\.length > 0\)/.test(панель), 'пустой список рисует пустые строки');
  });

  it('слово рекорда переведено во всех трёх языках', () => {
    for (const язык of ['ru', 'en', 'az']) {
      const словарь = JSON.parse(читать(`shared/locales/${язык}.json`));
      must(
        typeof словарь.panels?.dungeon_records === 'string' &&
          словарь.panels.dungeon_records.length > 0,
        `в ${язык}.json нет текста panels.dungeon_records`
      );
    }
  });

  it('есть что показывать: в таблице есть что читать', () => {
    const миграция = читать('database/migrations/010_dungeons.sql');
    must(
      /CREATE TABLE dungeon_history/.test(миграция),
      'таблицы истории прохождений нет: рекорды читать не из чего'
    );
    must(
      /duration_sec/.test(миграция),
      'в истории прохождений нет времени: сравнивать нечего'
    );
    must(/completed_at/.test(миграция), 'в истории нет даты: порядок при равном времени не задан');
  });
});
