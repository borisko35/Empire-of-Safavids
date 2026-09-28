// Занятое имя персонажа: внятная ошибка вместо 500 и alert().
//
// ТУТ БЫЛО ДВЕ ПОЛОМКИ, И ОБЕ ВИДНЫ ТОЛЬКО ИГРОКУ.
//
//  1. characters.name уникален. При совпадении Postgres ронял вставку с
//     23505, исключение уходило в общий обработчик, и игрок получал 500
//     с текстом ошибки БД. Собран на проде при попытке создать персонажа
//     с именем, которое уже занял другой: в логах
//     23505: duplicate key value violates unique constraint
//     "characters_name_key".
//
//  2. Клиент на ошибку показывал alert(). Нативное окно останавливает всю
//     страницу: пока его не закроют, не работают ни кнопки, ни ввод. И
//     сообщение в нём было техническим, а не ответом игроку.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const route = stripComments(read('server/src/routes/character.ts'));
const service = stripComments(read('server/src/services/CharacterService.ts'));
const chars = stripComments(read('client/src/app/screens/chars.ts'));
const html = read('client/src/app/index.html');
const api = stripComments(read('client/src/app/api.ts'));

const LOCALES = ['ru', 'en', 'az'] as const;
const locale = (lang: string): Record<string, Record<string, string>> =>
  JSON.parse(read(`shared/locales/${lang}.json`));

describe('Сервер: занятое имя — это 409, а не 500', () => {
  it('имя проверяется до вставки', () => {
    // Проверка до insert даёт честный ответ без исключения вообще
    expect(route).toMatch(/await characterService\.isNameTaken\(value\.name\)/);
    expect(route).toMatch(/res\.status\(409\)\.json\(\{ error: 'name_taken' \}\)/);
  });

  it('гонка двух одинаковых имён тоже закрыта', () => {
    // Два игрока могут нажать «создать» в одну секунду. Тогда проверка
    // пройдёт у обоих, и упадёт вставка — значит нужен ещё и перехват
    expect(route).toMatch(/catch \(err\)[\s\S]{0,300}code === '23505'/);
    expect(service).toMatch(/INSERT INTO characters/);
  });

  it('настоящий сбой БД не прячется под «имя занято»', () => {
    // Всё, что не 23505, пробрасывается дальше: иначе поломка базы
    // выглядела бы для игрока как занятое имя
    expect(route).toMatch(/throw err;/);
  });

  it('регистр имени не различается', () => {
    // Игрок не должен гадать, в чём разница между «Shah» и «shah»
    expect(service).toMatch(/LOWER\(name\) = LOWER\(\$1\)/);
  });
});

describe('Клиент: ошибка в форме, а не окно поверх страницы', () => {
  it('alert() больше не вызывается на экране персонажа', () => {
    // ГЛАВНОЕ. alert() блокирует страницу целиком: пока не закроют окно,
    // не работают ни кнопки, ни ввод. Проверяем и создание, и удаление
    expect(chars).not.toMatch(/\balert\(/);
  });

  it('в форме есть строка для ошибки', () => {
    expect(html).toMatch(/id="create-error"/);
    expect(html).toMatch(/class="form-error hidden"/);
  });

  it('ошибка показывается текстом в форме', () => {
    // Раньше игрок вообще не видел, что произошло, кроме окна с текстом БД
    expect(chars).toMatch(/err\.textContent = msg/);
    expect(chars).toMatch(/err\.classList\.remove\('hidden'\)/);
  });

  it('текст берётся из перевода по коду ошибки', () => {
    // Код из ответа сервера: ошибка приходит как 'name_taken', а не
    // готовым текстом, иначе пришлось бы переводить на сервере
    expect(api).toMatch(/const code = b\.code/);
    expect(chars).toMatch(/t\(`errors\.\$\{code\}`\)/);
  });

  it('неизвестный код не показывается игроку как путь к ключу', () => {
    // Без этой проверки на экране появлялось бы «errors.что-то_непонятное»
    expect(chars).toMatch(/!== `errors\.\$\{code\}` \? t\(`errors\.\$\{code\}`\) : t\('chars\.create_failed'\)/);
  });
});

describe('Ошибка занятости переведена во всех трёх языках', () => {
  const KEYS = [
    ['errors', 'name_taken'],
    ['chars', 'create_failed'],
    ['chars', 'delete_failed'],
  ] as const;

  for (const lang of LOCALES) {
    it(`${lang} — все ключи на месте и не пустые`, () => {
      const dict = locale(lang);
      const missing = KEYS.filter(([g, k]) => !dict[g]?.[k]?.trim()).map(([g, k]) => `${g}.${k}`);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    });
  }

  it('в сообщении про занятое имя есть само слово про занятость', () => {
    // Ответ должен говорить, что именно не так, а не быть общим
    // «что-то пошло не так»: игрок сразу поймёт, что нужно другое имя
    const ru = locale('ru').errors.name_taken;
    const en = locale('en').errors.name_taken;
    expect({ ru: /занят/i.test(ru), en: /taken/i.test(en) }).toEqual({ ru: true, en: true });
  });
});
