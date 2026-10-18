// Подземелья и профессии названы переводом.
//
// ЧТО ЗДЕСЬ ВСКРЫТО. Семи подземелий не было в словарях вовсе: игрок на en
// или az выбирал, куда идти, по-русски — и в списке, и в полосе статуса
// захода, и в тосте о начале. Семи профессий — тоже.
//
// ОТЛИЧИЕ ПРОФЕССИЙ. У них поле name — это КЛЮЧ перевода ('warrior'), а не
// английский текст, и английского названия в данных не существует. Русское
// берётся из nameRu, английский написан руками. Проверка сверяет с данными
// только там, где в данных есть что сверять.
//
// ID ПОДЗЕМЕЛЬЯ. Ни полоса статуса, ни тост о начале не знали, о каком
// подземелье речь: в ответе маршрута dungeonId есть, но в тип не попал. По
// одному nameRu перевод не ищется — тот же случай, что с instanceId у целей
// абордажа.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DUNGEONS_DATABASE } from '../data/dungeons';
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

const подземелья = Object.entries(DUNGEONS_DATABASE);
const исходникНавыков = stripComments(читать('server/src/services/SkillsService.ts'));

/** Профессии из SkillsService: id и русское название. */
function профессии(): { id: string; ru: string }[] {
  const начало = исходникНавыков.indexOf('const PROFESSIONS');
  const блок = исходникНавыков.slice(начало, исходникНавыков.indexOf('\n];', начало));
  const re = /\{\s*id:\s*'([a-z0-9_]+)',\s*name:\s*'([a-z0-9_]+)',\s*nameRu:\s*'([^']*)'/g;
  const результат: { id: string; ru: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(блок)) !== null) {
    if (m[1] && m[3]) результат.push({ id: m[1], ru: m[3] });
  }
  return результат;
}

describe('Подземелья и профессии переведены', () => {
  it('разбор данных работает', () => {
    must(подземелья.length >= 7, `подземелий ${подземелья.length}, ожидалось не меньше 7`);
    must(профессии().length >= 7, `профессий ${профессии().length}, ожидалось не меньше 7`);
  });

  it('у каждого подземелья есть перевод во всех трёх языках', () => {
    for (const код of ['ru', 'en', 'az'] as const) {
      const d = раздел(код, 'dungeons');
      for (const [id, def] of подземелья) {
        must(typeof d[id] === 'string' && d[id]!.trim() !== '',
          `${код}: у подземелья ${id} нет перевода — игрок увидит «${def.nameRu}»`);
      }
    }
  });

  it('русское и английское названия подземелья совпадают с данными', () => {
    const ru = раздел('ru', 'dungeons');
    const en = раздел('en', 'dungeons');
    for (const [id, def] of подземелья) {
      must(ru[id] === def.nameRu, `${id}: в данных «${def.nameRu}», в словаре «${ru[id]}»`);
      must(en[id] === def.name, `${id}: в данных «${def.name}», в словаре «${en[id]}»`);
    }
  });

  it('у каждой профессии есть перевод во всех трёх языках', () => {
    for (const код of ['ru', 'en', 'az'] as const) {
      const d = раздел(код, 'professions');
      for (const профессия of профессии()) {
        must(typeof d[профессия.id] === 'string' && d[профессия.id]!.trim() !== '',
          `${код}: у профессии ${профессия.id} нет перевода — игрок увидит «${профессия.ru}»`);
      }
    }
  });

  it('русское название профессии совпадает с данными, английское — нет в них', () => {
    // Английского в данных нет и быть не может: name это ключ. Проверка
    // фиксирует именно это, чтобы кто-то не «починил» сравнение, решив,
    // что поле name должно совпадать со словарём.
    const ru = раздел('ru', 'professions');
    for (const профессия of профессии()) {
      must(ru[профессия.id] === профессия.ru,
        `${профессия.id}: в данных «${профессия.ru}», в словаре «${ru[профессия.id]}»`);
    }
    must(/name:\s*'[a-z_]+',\s*nameRu:/.test(исходникНавыков),
      'в PROFESSIONS нет name рядом с nameRu — формат данных изменился');
  });

  it('английские названия профессий не совпадают с русскими', () => {
    // Слабая проверка, но ловит главное: скопированный перевод. Без неё
    // английский раздел мог бы оказаться русским и выглядел бы полным.
    const en = раздел('en', 'professions');
    for (const профессия of профессии()) {
      must(en[профессия.id] !== профессия.ru,
        `${профессия.id}: английский перевод совпадает с русским — перевода нет`);
    }
  });

  it('панель берёт названия из перевода, а идентификаторы подземелий известны', () => {
    const панель = stripComments(читать('client/src/app/panels.ts'));
    must(/tOr\(\s*`dungeons\.\$\{/.test(панель), 'название подземелья не переводится');
    must(/tOr\(\s*`professions\.\$\{/.test(панель), 'название профессии не переводится');
    must(/status\.dungeonId/.test(панель),
      'полоса статуса ищет перевод не по dungeonId — по одному nameRu его нет');
    must(!/label\.textContent =\s*`\$\{d\.nameRu\} ·/.test(панель),
      'список подземелий печатает d.nameRu напрямую');

    const мир = stripComments(читать('client/src/app/world.ts'));
    must(/tOr\(\s*`dungeons\.\$\{/.test(мир), 'тост о завершении подземелья не переводится');

    // dungeonId обязан быть в типах ответа: иначе подстановка собрала бы
    // undefined молча, а компилятор промолчал бы вместе с ней.
    const api = читать('client/src/app/api.ts');
    must(/dungeonId\??:\s*string/.test(api),
      'в типах ответов про подземелья нет dungeonId — перевод искать не по чему');
  });
});