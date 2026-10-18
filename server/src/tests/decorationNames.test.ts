// Предметы декора дома названы переводом.
//
// ЧТО ЗДЕСЬ ВСКРЫТО. Восемь предметов декора — «Трофей Босса», «Золотая
// Люстра», «Садовый Фонтан» — не были переведены ни на одном языке: в
// словарях не было ни одного ключа. Селект в панели дома печатал
// d.name_ru напрямую, с откатом на d.name и на голый идентификатор, то
// есть игрок на en или az выбирал, что поставить в дом, по-русски.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DECORATIONS } from '../services/HousingService';
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

const декор = Object.entries(DECORATIONS);

describe('Предметы декора переведены', () => {
  it('декор разбирается из данных', () => {
    // Якорь на 8: разбор, молча вернувший пустой список, прошёл бы все
    // проверки ниже как «переведено всё».
    must(декор.length >= 8, `предметов декора ${декор.length}, ожидалось не меньше 8`);
  });

  it('у каждого предмета декора есть перевод во всех трёх языках', () => {
    for (const код of ['ru', 'en', 'az'] as const) {
      const d = раздел(код, 'decorations');
      for (const [id, def] of декор) {
        const значение = d[id];
        must(typeof значение === 'string' && значение.trim() !== '',
          `${код}: у декора ${id} нет перевода — игрок увидит «${def.nameRu}»`);
      }
    }
  });

  it('русское и английское названия совпадают с данными', () => {
    const ru = раздел('ru', 'decorations');
    const en = раздел('en', 'decorations');
    for (const [id, def] of декор) {
      must(ru[id] === def.nameRu,
        `${id}: в данных «${def.nameRu}», в словаре «${ru[id]}» — игрок увидит разные названия`);
      must(en[id] === def.name,
        `${id}: в данных «${def.name}», в словаре «${en[id]}» — игрок увидит разные названия`);
    }
  });

  it('в разделе decorations нет чужих ключей', () => {
    // Имена декора не должны смешиваться с подписями интерфейса: в house
    // лежат decor_title, decor_none и прочие, и запись в этот раздел
    // затёрла бы их так же, как имена питомцев затёрли подписи в pets.
    const id = new Set(декор.map(([k]) => k));
    for (const код of ['ru', 'en', 'az'] as const) {
      for (const ключ of Object.keys(раздел(код, 'decorations'))) {
        must(id.has(ключ), `${код}: в decorations попал ключ ${ключ}, которого нет среди предметов декора`);
      }
    }
  });

  it('подписи декора в разделе house не затёрты', () => {
    for (const код of ['ru', 'en', 'az'] as const) {
      const house = раздел(код, 'house');
      for (const ключ of ['decor_title', 'decor_none', 'decor_place', 'decor_placed']) {
        must(typeof house[ключ] === 'string' && house[ключ]!.trim() !== '',
          `${код}: подпись house.${ключ} пропала`);
      }
    }
  });

  it('панель дома берёт название декора из перевода', () => {
    const панель = stripComments(читать('client/src/app/panels.ts'));
    must(/tOr\(\s*`decorations\.\$\{/.test(панель),
      'перевод названия декора не ищется — tOr(`decorations.…`) не найден');
    must(!/\$\{\s*d\.name_ru \?\? d\.name \?\? d\.id\s*\}/.test(панель),
      'название декора печатается по-русски: откат на name_ru вернулся');
  });
});