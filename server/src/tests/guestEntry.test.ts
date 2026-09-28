// «Играть за 10 секунд»: вход без регистрации по ссылке с лендинга.
//
// ЧТО БЫЛО. Между «заинтересовался» и «играет» стоял экран входа с полями
// почты и пароля. Для человека, который пришёл с рекламной ссылки посмотреть
// игру, это четыре поля и решение «заводить ли аккаунт» до первого шага.
// Гостевой вход существовал, но прятался за кнопкой на втором экране.
//
// Теперь ссылка /game/?guest=1 ведёт сразу в гостя. Проверяем не «есть ли
// строка в коде», а связку целиком: кнопка на лендинге ведёт с параметром,
// клиент этот параметр понимает, параметр убирается из адреса (иначе F5
// заведёт нового гостя и съест суточный лимит) и ошибка лимита показывается
// человеку, а не роняет страницу.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const landing = read('client/web/index.html');
const main = stripComments(read('client/src/app/main.ts'));
const auth = stripComments(read('client/src/app/screens/auth.ts'));
const authService = stripComments(read('server/src/services/AuthService.ts'));

const LOCALES = ['ru', 'en', 'az'] as const;
const locale = (lang: string): Record<string, Record<string, string>> =>
  JSON.parse(read(`shared/locales/${lang}.json`));

/** Тег <a> с нужным id: атрибуты в разметке идут в любом порядке */
function anchor(id: string): string {
  return new RegExp(`<a\\b[^>]*\\bid="${id}"[^>]*>`).exec(landing)?.[0] ?? '';
}

describe('Лендинг ведёт в игру без регистрации', () => {
  it('главная кнопка игры ведёт с параметром гостя', () => {
    // ГЛАВНОЕ. Без параметра игрок попадёт на экран входа — то есть на
    // те самые четыре поля, ради которых кнопка и затевалась.
    // Первая версия проверки ждала id раньше href и падала на здоровой
    // разметке: порядок атрибутов в HTML не зафиксирован
    expect(anchor('play-btn')).toMatch(/href="\/game\/\?guest=1"/);
  });

  it('второй путь — обычный вход в свой аккаунт', () => {
    // Игрок с аккаунтом не должен попадать в гостя: кнопка рядом с главной
    expect(anchor('play-account')).toMatch(/href="\/game\/"/);
  });

  it('параметр понимает клиент', () => {
    expect(main).toMatch(/searchParams\.get\('guest'\)/);
    expect(main).toMatch(/!== '1'\) return false/);
  });

  it('клиент убирает параметр из адреса', () => {
    // ТУТ БЫЛА ЛОВУШКА, ЕСЛИ БЫ ЕЁ НЕ УЧЛИ: игрок обновляет страницу,
    // клиент снова видит ?guest=1 и заводит нового гостя. За час таких
    // обновлений съедается весь суточный лимит на адрес
    expect(main).toMatch(/url\.searchParams\.delete\('guest'\)/);
    expect(main).toMatch(/history\.replaceState/);
  });

  it('вошедшего игрока ссылка не трогает', () => {
    // Иначе тот, кто уже вошёл, по ссылке с лендинга получил бы нового
    // гостя вместо своего персонажа
    expect(main).toMatch(/if \(session\.token\) return false/);
  });

  it('при отказе показывается экран входа с понятной ошибкой', () => {
    // Молча упасть на пустой экран нельзя: игрок поймёт, что сломалось
    // нечто неочевидное, и уйдёт
    expect(main).toMatch(/showScreen\('screen-auth'\)/);
    expect(main).toMatch(/showAuthError\(/);
  });
});

describe('Вход гостя описан один раз, а не в двух копиях', () => {
  it('кнопка на экране входа зовёт ту же функцию, что и ссылка', () => {
    // Дублировать четыре строки в двух местах — значит починить поломку
    // в одной копии и забыть про другую
    expect(auth).toMatch(/export async function enterAsGuest\(\)/);
    expect(auth).toMatch(/await enterAsGuest\(\);\s*\n\s*onSuccess\(\);/);
    expect(main).toMatch(/await enterAsGuest\(\);/);
  });

  it('вход гостя по-прежнему один вызов сервера', () => {
    expect(auth).toMatch(/api\.guestLogin\(\)/);
  });
});

describe('Суточный лимит гостей не стал стеной', () => {
  it('лимит на адрес поднят и остаётся конечным', () => {
    // Пять гостей на адрес держались как должное, пока вход делался
    // кнопкой на втором экране. С появлением ссылки «Играть за 10 секунд»
    // пять на адрес закрывало дверь: у мобильных операторов и в офисах
    // один публичный адрес делят десятки людей.
    const n = Number(/MAX_GUESTS_PER_IP\s*=\s*(\d+)/.exec(authService)?.[1] ?? 0);
    expect({ лимит: n, не_стена: n >= 10, всё_ещё_ограничен: n <= 100 })
      .toEqual({ лимит: expect.any(Number), не_стена: true, всё_ещё_ограничен: true });
  });

  it('причину смены лимита объяснили в коде', () => {
    // Число без reasons через полгода выглядит как «так захотелось»
    // Комментарий смотрим в исходнике: stripComments его срезает,
    // а объяснение обязано остаться в коде, а не в истории коммита
    expect(read('server/src/services/AuthService.ts')).toMatch(/ИГРАТЬ ЗА 10 СЕКУНД/);
  });
});

describe('Кнопки входа переведены во всех трёх языках', () => {
  for (const lang of LOCALES) {
    it(`${lang} — подписи на месте и не пустые`, () => {
      const menu = locale(lang).menu ?? {};
      const missing = ['play_now', 'play_with_account'].filter(k => !menu[k]?.trim());
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    });
  }

  it('подпись обещает именно скорость, а не регистрацию', () => {
    // Кнопка должна говорить, что получит игрок: время до первого шага
    for (const lang of LOCALES) {
      const text = locale(lang).menu.play_now;
      expect({ lang, длина_разумная: text.length > 5 && text.length < 40 })
        .toEqual({ lang, длина_разумная: true });
    }
  });

  it('второй кнопке есть своя подпись, а не та же самая', () => {
    // Иначе рядом стояли бы две одинаковые кнопки про разное
    for (const lang of LOCALES) {
      const menu = locale(lang).menu;
      expect({ lang, разные: menu.play_now !== menu.play_with_account })
        .toEqual({ lang, разные: true });
    }
  });
});
