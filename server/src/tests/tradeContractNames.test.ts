// Торговые контракты переведены, груз и банк гильдии показывают предметы
// переводом.
//
// ЧТО ЗДЕСЬ ВСКРЫТО. Панель каравана печатала c.nameRu и c.cargoNameRu
// прямо из ответа сервера. У контрактов не было английского name в данных —
// только nameRu, — поэтому перевести их было нечем, и пять контрактов были
// по-русски на всех языках. Груз при этом обычный предмет и переводится по
// cargoItemId, который сервер шлёт, но в типе ответа его не было.
//
// Банк гильдии вёл себя так же: селект пополнения печатал i.nameRu при
// наличии i.itemId в том же объекте.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRADE_CONTRACTS } from '../systems/TradeService';
import { stripComments } from './helpers/stripCode';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const раздел = (код: string, имя: string): Record<string, string> => {
  const d = JSON.parse(читать(`shared/locales/${код}.json`))[имя];
  if (d === undefined || typeof d !== 'object') throw new Error(`${код}: раздела ${имя} нет`);
  return d as Record<string, string>;
};

describe('Торговые контракты переведены', () => {
  it('контракты разбираются из данных', () => {
    must(TRADE_CONTRACTS.length >= 5,
      `разобрано ${TRADE_CONTRACTS.length} контрактов, ожидалось не меньше 5`);
  });

  it('у каждого контракта есть английское название в данных', () => {
    // Без name в данных перевод невозможно: словарь заполняется из
    // серверных названий, а не наоборот. Именно поэтому у контрактов поле
    // name пришлось завести в данных.
    for (const c of TRADE_CONTRACTS) {
      must(typeof c.name === 'string' && c.name.trim() !== '',
        `${c.id}: нет английского названия в данных — переводить нечем`);
    }
  });

  it('у каждого контракта есть перевод во всех трёх языках', () => {
    for (const код of ['ru', 'en', 'az'] as const) {
      const d = раздел(код, 'trade_contracts');
      for (const c of TRADE_CONTRACTS) {
        const значение = d[c.id];
        must(typeof значение === 'string' && значение.trim() !== '',
          `${код}: у контракта ${c.id} нет перевода — игрок увидит «${c.nameRu}»`);
      }
    }
  });

  it('русское и английское названия контракта совпадают с данными', () => {
    const ru = раздел('ru', 'trade_contracts');
    const en = раздел('en', 'trade_contracts');
    for (const c of TRADE_CONTRACTS) {
      must(ru[c.id] === c.nameRu, `${c.id}: расходится с nameRu из данных`);
      must(en[c.id] === c.name, `${c.id}: расходится с name из данных`);
    }
  });

  it('груз каждого контракта — переведённый предмет', () => {
    // Груз едет предметом из ITEMS_DATABASE, и его имя обязано быть в
    // словаре items, иначе караван покажет русский товар игроку на az.
    for (const код of ['ru', 'en', 'az'] as const) {
      const items = раздел(код, 'items');
      for (const c of TRADE_CONTRACTS) {
        must(typeof items[c.cargoItemId] === 'string' && items[c.cargoItemId]!.trim() !== '',
          `${код}: груз ${c.cargoItemId} контракта ${c.id} не переведён`);
      }
    }
  });

  it('панель каравана и банк гильдии не печатают названия по-русски', () => {
    const панель = stripComments(читать('client/src/app/panels.ts'));
    must(!/label\.textContent = `\$\{c\.nameRu\}/.test(панель),
      'название контракта печатается по-русски: подстановка c.nameRu вернулась');
    must(/tOr\(\s*`trade_contracts\.\$\{/.test(панель),
      'перевод названия контракта больше не ищется — tOr(`trade_contracts.…`) не найден');
    must(/имяПредмета\(\s*c\.cargoItemId/.test(панель),
      'груз контракта не переводится — имяПредмета(c.cargoItemId) не найден');

    const гильдия = stripComments(читать('client/src/app/guild.ts'));
    must(/имяПредмета\(\s*i\.itemId/.test(гильдия),
      'банк гильдии печатает предмет по-русски — имяПредмета(i.itemId) не найден');
  });
});