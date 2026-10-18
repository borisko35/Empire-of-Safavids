// Лодки и рыбы называются переводом.
//
// ЧТО ЗДЕСЬ ВСКРЫТО. Панель рыбалки печатала f.nameRu и boat.nameRu
// напрямую. Рыбы переводились уже давно — все одиннадцать есть в словаре с
// ключами fish_*, — но панель к этим ключам не обращалась. Лодок в
// словарях не было вовсе: пять лодок не были переведены ни на одном языке,
// и в подсказке тоже висел русский descriptionRu.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FISH_TABLE } from '../systems/FishingSystem';
import { BOATS } from '../systems/BoatSystem';
import { stripComments } from './helpers/stripCode';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

/**
 * Словарь языка. Разделы разной природы — строки (boats, items) и плоские
 * словари описаний, — поэтому тип здесь общий: доступ по ключу проверяется
 * на месте, а не типом. Тип Record<string, string> стоял тут раньше и врал:
 * на d.boats[лодка.id] компилятор проходил, пока не выяснилось, что раздел
 * boats — вложенный объект.
 */
const словарь = (код: string): Record<string, unknown> =>
  JSON.parse(читать(`shared/locales/${код}.json`));

/** Раздел словаря как плоский словарь строк. Бросает, если раздела нет. */
function раздел(код: string, имя: string): Record<string, string> {
  const d = словарь(код)[имя];
  if (d === undefined || typeof d !== 'object') {
    throw new Error(`${код}: раздела ${имя} нет`);
  }
  return d as Record<string, string>;
}

const лодки = Object.values(BOATS);

describe('Лодки и рыбы переведены', () => {
  it('лодки разбираются из данных', () => {
    // Якорь на 5. Прошлый раз лодок насчиталось четыре, потому что поиск шёл
    // по шаблону без подчёркивания и молча пропустил boat_fishing_skid:
    // раздел словаря собирался бы из четырёх записей и выглядел полным.
    must(лодки.length >= 5, `разобрано ${лодки.length} лодок, ожидалось не меньше 5`);
  });

  it('у каждой лодки есть название и описание во всех трёх языках', () => {
    for (const код of ['ru', 'en', 'az'] as const) {
      const names = раздел(код, 'boats');
      const описания = раздел(код, 'boat_desc');
      for (const лодка of лодки) {
        const имя = names[лодка.id];
        must(typeof имя === 'string' && имя.trim() !== '',
          `${код}: у ${лодка.id} нет названия — игрок увидит «${лодка.nameRu}»`);
        const описание = описания[лодка.id];
        must(typeof описание === 'string' && описание.trim() !== '',
          `${код}: у ${лодка.id} нет описания — подсказка останется по-русски`);
      }
    }
  });

  it('названия и описания лодок совпадают с данными', () => {
    // Порядок источников тот же, что у предметов и рецептов: данные
    // каноничны, словарь заполняется из них.
    const ruNames = раздел('ru', 'boats');
    const enNames = раздел('en', 'boats');
    const ruDesc = раздел('ru', 'boat_desc');
    const enDesc = раздел('en', 'boat_desc');
    for (const лодка of лодки) {
      must(ruNames[лодка.id] === лодка.nameRu,
        `${лодка.id}: в данных «${лодка.nameRu}», в словаре «${ruNames[лодка.id]}»`);
      must(enNames[лодка.id] === лодка.name,
        `${лодка.id}: в данных «${лодка.name}», в словаре «${enNames[лодка.id]}»`);
      must(ruDesc[лодка.id] === лодка.descriptionRu,
        `${лодка.id}: описание расходится с descriptionRu из данных`);
      must(enDesc[лодка.id] === лодка.description,
        `${лодка.id}: описание расходится с description из данных`);
    }
  });

  it('каждая рыба из FISH_TABLE переведена в словаре items', () => {
    // Рыбы — предметы, поэтому ключи лежат в items, а не в отдельном
    // разделе. Их наличие проверяется здесь, а не в itemNames.test.ts:
    // там сверка идёт по данным предметов, а FISH_TABLE — другой список,
    // из которого сервер берёт улов.
    for (const код of ['ru', 'en', 'az'] as const) {
      const items = раздел(код, 'items');
      for (const рыба of FISH_TABLE) {
        const значение = items[рыба.id];
        must(typeof значение === 'string' && значение.trim() !== '',
          `${код}: рыба ${рыба.id} не переведена — панель покажет «${рыба.nameRu}»`);
      }
    }
  });

  it('панель рыбалки не печатает названия рыб и лодок по-русски', () => {
    const панель = stripComments(читать('client/src/app/panels.ts'));
    must(!/\$\{\s*f\.nameRu\s*\}/.test(панель),
      'название рыбы печатается по-русски: подстановка f.nameRu вернулась');
    must(!/label\.textContent = def\.nameRu/.test(панель),
      'название лодки печатается по-русски: def.nameRu вернулось');
    must(!/label\.title = def\.descriptionRu/.test(панель),
      'описание лодки осталось по-русски: def.descriptionRu вернулось');
    must(/tOr\(\s*`boats\.\$\{/.test(панель),
      'перевод названия лодки больше не ищется — tOr(`boats.…`) не найден');
  });
});