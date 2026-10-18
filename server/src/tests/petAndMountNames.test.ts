// Питомцы и маунты названы переводом, и имена зверей не затирают подписи
// интерфейса.
//
// ЧТО ЗДЕСЬ ВСКРЫТО. Все шесть питомцев были по-русски на всех трёх
// языках: в словарях не было ни одного ключа pet_*. Маунты частично
// переведены были — три ключа лежали в разделе items, — но панель печатала
// name_ru напрямую и до ключей не доходила.
//
// ОТДЕЛЬНО О СМЕШЕНИИ РАЗДЕЛОВ. Разделы pets и mounts в словарях заняты
// подписями интерфейса: «Отпустить питомца? Это необратимо» и «Ваши
// скакуны ({n})». Имена зверей положены в pet_names, pet_abilities и
// mount_names — намеренно не в pets и mounts. При заполнении по этим
// разделам семь подписей питомцев и двенадцать подписей конюшни были бы
// затёрты именами, и выглядело бы это как успешная работа: разделы
// заполнены, ключей столько же.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

const исходникПитомцев = stripComments(читать('server/src/services/PetService.ts'));
const исходникМаунтов = stripComments(читать('server/src/systems/MountSystem.ts'));

/** Питомцы: id, имя ru, имя en, умение ru, умение en. */
function питомцы(): { id: string; ru: string; en: string; умениеRu: string; умениеEn: string }[] {
  const результат: { id: string; ru: string; en: string; умениеRu: string; умениеEn: string }[] = [];
  const re = /\{\s*id:\s*'(pet_[a-z0-9_]+)',\s*name:\s*'([^']*)',\s*name_ru:\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(исходникПитомцев)) !== null) {
    const [, id, en, ru] = m;
    if (id === undefined || en === undefined || ru === undefined) continue;
    const блок = исходникПитомцев.slice(m.index, m.index + 600);
    const умение = /ability_name:\s*'([^']*)',\s*ability_name_ru:\s*'([^']*)'/.exec(блок);
    результат.push({
      id,
      ru,
      en,
      умениеEn: умение?.[1] ?? '',
      умениеRu: умение?.[2] ?? '',
    });
  }
  return результат;
}

/** Маунты: id, имя ru, имя en. */
function маунты(): { id: string; ru: string; en: string }[] {
  const результат: { id: string; ru: string; en: string }[] = [];
  const re = /id:\s*'(mount_[a-z0-9_]+)',\s*name:\s*'([^']*)',\s*nameRu:\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(исходникМаунтов)) !== null) {
    const [, id, en, ru] = m;
    if (id === undefined || en === undefined || ru === undefined) continue;
    результат.push({ id, ru, en });
  }
  return результат;
}

describe('Питомцы и маунты переведены', () => {
  it('питомцы и маунты разбираются из данных', () => {
    // Якоря на 6: без них разбор, молча вернувший пустой список, прошёл бы
    // все проверки ниже как «переведено всё».
    must(питомцы().length >= 6, `питомцев ${питомцы().length}, ожидалось 6`);
    must(маунты().length >= 6, `маунтов ${маунты().length}, ожидалось 6`);
  });

  it('у каждого питомца есть имя и умение во всех трёх языках', () => {
    for (const код of ['ru', 'en', 'az'] as const) {
      const имена = раздел(код, 'pet_names');
      const умения = раздел(код, 'pet_abilities');
      for (const питомец of питомцы()) {
        must(typeof имена[питомец.id] === 'string' && имена[питомец.id]!.trim() !== '',
          `${код}: у питомца ${питомец.id} нет имени — игрок увидит «${питомец.ru}»`);
        must(typeof умения[питомец.id] === 'string' && умения[питомец.id]!.trim() !== '',
          `${код}: у питомца ${питомец.id} нет названия умения — «${питомец.умениеRu}»`);
      }
    }
  });

  it('у каждого маунта есть имя во всех трёх языках', () => {
    for (const код of ['ru', 'en', 'az'] as const) {
      const имена = раздел(код, 'mount_names');
      for (const маунт of маунты()) {
        must(typeof имена[маунт.id] === 'string' && имена[маунт.id]!.trim() !== '',
          `${код}: у маунта ${маунт.id} нет имени — игрок увидит «${маунт.ru}»`);
      }
    }
  });

  it('русские и английские названия совпадают с данными', () => {
    // Русский ключ сверяется с nameRu, английский — с name. Оба в одном ключе
    // не совпадут никогда: первая версия проверки сравнивала ru-перевод с
    // обоими полями сразу и падала на верном коде.
    const сверка: Record<'ru' | 'en', 'ru' | 'en'> = { ru: 'ru', en: 'en' };
    for (const код of ['ru', 'en'] as const) {
      const имена = раздел(код, 'pet_names');
      const умения = раздел(код, 'pet_abilities');
      for (const питомец of питомцы()) {
        must(имена[питомец.id] === питомец[сверка[код]],
          `${код}: имя ${питомец.id} в данных «${питомец[сверка[код]]}», в словаре «${имена[питомец.id]}»`);
        must(умения[питомец.id] === (код === 'ru' ? питомец.умениеRu : питомец.умениеEn),
          `${код}: умение ${питомец.id} расходится с данными`);
      }
    }
    for (const код of ['ru', 'en'] as const) {
      const имена = раздел(код, 'mount_names');
      for (const маунт of маунты()) {
        must(имена[маунт.id] === маунт[сверка[код]],
          `${код}: имя ${маунт.id} в данных «${маунт[сверка[код]]}», в словаре «${имена[маунт.id]}»`);
      }
    }
  });

  it('подписи интерфейса питомцев и конюшни не затёрты именами зверей', () => {
    // Прямая проверка последствий: в pets и mounts лежат подписи, а не
    // имена. Если имена положить в эти разделы, подписи исчезнут, и
    // интерфейс покажет вместо «Отпустить питомца?» вид зверя.
    for (const код of ['ru', 'en', 'az'] as const) {
      const pets = раздел(код, 'pets');
      const mounts = раздел(код, 'mounts');
      for (const ключ of ['renamed', 'released', 'release_confirm', 'received', 'release']) {
        must(typeof pets[ключ] === 'string' && pets[ключ]!.trim() !== '',
          `${код}: подпись pets.${ключ} пропала — её затёрли имена питомцев`);
      }
      for (const ключ of ['yours', 'none', 'riding', 'summoning', 'available']) {
        must(typeof mounts[ключ] === 'string' && mounts[ключ]!.trim() !== '',
          `${код}: подпись mounts.${ключ} пропала — её затёрли имена маунтов`);
      }
      // И наоборот: в разделах имён не должно быть чужих подписей.
      const именаПитомцев = раздел(код, 'pet_names');
      must(!('release' in именаПитомцев),
        `${код}: в pet_names попала подпись интерфейса — разделы перепутаны`);
    }
  });

  it('панели питомцев и маунтов не печатают названия по-русски', () => {
    const панель = stripComments(читать('client/src/app/panels.ts'));
    must(!/nameEl\.textContent = p\.nickname \?\? def\?\.name_ru/.test(панель),
      'список питомцев печатает def.name_ru напрямую');
    must(!/name\.textContent = m\.name_ru/.test(панель),
      'конюшня печатает m.name_ru напрямую');
    must(/tOr\(\s*`pet_names\.\$\{/.test(панель),
      'перевод имени питомца больше не ищется — tOr(`pet_names.…`) не найден');
    must(/tOr\(\s*`mount_names\.\$\{/.test(панель),
      'перевод имени маунта больше не ищется — tOr(`mount_names.…`) не найден');
  });
});