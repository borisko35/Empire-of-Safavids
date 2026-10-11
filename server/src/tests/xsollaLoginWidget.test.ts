// Виджет Xsolla: на лендинге и с настоящим CSRF-state.
//
// ДВЕ ОПАСНОСТИ, ОБЕ ЗДЕСЬ ОХРАНЯЮТСЯ.
//
// 1) ГДЕ ВИДЖЕТ. Скрипт с чужого домена получает права страницы. В игре на
//    этом origin лежит токен авторизации (localStorage eos_token) и идут
//    платежи. Xsolla здесь — платёжный провайдер проекта, а не реклама, но
//    файл всё равно чужой. Проверка сторожит: виджета нет в /game/.
//
// 2) STATE. В документации Xsolla в примере стоит строка-заглушка
//    "yourStateHere". Постоянное значение обнуляет CSRF-защиту: state именно
//    тем и защищает, что случаен и сверяется при возврате. Проверка требует,
//    чтобы "yourStateHere" в коде не осталось и чтобы значение генерировалось.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

/**
 * Прочитать файл С БЕЗ КОММЕНТАРИЕВ.
 *
 * ЗАЧЕМ. Источник-читающие проверки ищут в файле строки вроде
 * `xsolla.invalid`. Если объяснение комментируемого запрета само упоминает
 * это слово — проверка падает на собственном пояснении. Это ровно та
 * ловушка, которую лечили в apiSurface.test.ts. Здесь я попался на ней же:
 * в шапке AuthService написано «ПОЧЕМУ @oauth.invalid, А НЕ @xsolla.invalid»,
 * и проверка на отсутствие своего домена падала на этом комментарии.
 */
const код = (p: string): string =>
  читать(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((с) => с.replace(/(^|[^:\\"'`])\/\/.*$/, '$1'))
    .join('\n');

const МОДУЛЬ = 'client/web/js/xsolla-login.js';
const ЛЕНДИНГ = 'client/web/index.html';

/** Все .js и .ts клиента, кроме собранных бандлов. */
function файлыКлиента(): { путь: string; текст: string }[] {
  const { readdirSync } = require('node:fs');
  const результат: { путь: string; текст: string }[] = [];
  const обход = (каталог: string): void => {
    for (const запись of readdirSync(join(корень, каталог), { withFileTypes: true })) {
      if (запись.name === 'node_modules') continue;
      const путь = join(каталог, запись.name);
      if (запись.isDirectory()) {
        if (путь.replace(/\\/g, '/').endsWith('web/game')) continue;
        обход(путь);
        continue;
      }
      if (!/\.(ts|js|html)$/.test(запись.name)) continue;
      if (путь.replace(/\\/g, '/').includes('web/game/assets')) continue;
      результат.push({ путь: путь.replace(/\\/g, '/'), текст: readFileSync(join(корень, путь), 'utf-8') });
    }
  };
  обход('client/src');
  обход('client/web');
  return результат;
}

describe('Xsolla-вход: не в игре', () => {
  it('модуль есть на лендинге', () => {
    const текст = читать(МОДУЛЬ);
    expect({
      projectId: текст.includes('6a10f634-6de2-4cd2-b8ca-aa48f488d17a'),
      sdk: текст.includes('login-sdk.xsolla.com'),
    }).toEqual({ projectId: true, sdk: true });
  });

  it('разметка виджета на лендинге', () => {
    const текст = читать(ЛЕНДИНГ);
    expect({
      контейнер: /id="xl_auth"/.test(текст),
      скрипт: /src="\/js\/xsolla-login\.js"/.test(текст),
    }).toEqual({ контейнер: true, скрипт: true });
  });

  it('в /game/ виджета и SDK нет', () => {
    // Главное свойство. Ищем по ВСЕМ исходникам игры: «подключили в один
    // файл, а загрузилось из другого» — тихой поломки не получится.
    const нарушители = файлыКлиента()
      .filter((ф) => ф.путь !== ЛЕНДИНГ && ф.путь !== МОДУЛЬ)
      .filter((ф) => /xl_auth|login-sdk\.xsolla\.com/.test(ф.текст))
      .map((ф) => ф.путь);
    expect({ нарушители }).toEqual({ нарушители: [] });
  });
});

describe('Xsolla-вход: state — не заглушка', () => {
  it('строки-заглушки из документации нет', () => {
    // Ровно та строчка из примера Xsolla. Постоянный state = нет CSRF.
    //
    // КОММЕНТАРИИ УБИРАЮТСЯ. Иначе проверка находит заглушку в САМОМ
    // объяснении, зачем она вредна (так и было при первой сборке) — и
    // рапортует о поломке рабочего кода. Та же болезнь, для которой в
    // проекте сделан stripCode для .ts.
    for (const файл of файлыКлиента()) {
      const безКомментариев = файл.текст
        .replace(/<!--[\s\S]*?-->/g, '')      // HTML
        .replace(/\/\*[\s\S]*?\*\//g, '')      // блочные .js/.ts
        .replace(/(^|[\s;])\/\/.*$/gm, '$1');  // строчные .js/.ts
      expect({
        файл: файл.путь,
        заглушка: /yourStateHere/.test(безКомментариев),
      }).toEqual({ файл: файл.путь, заглушка: false });
    }
  });

  it('state генерируется случайно', () => {
    const текст = читать(МОДУЛЬ);
    expect({
      крипта: /getRandomValues/.test(текст),
      запас: /Math\.random\(\)/.test(текст),
    }).toEqual({ крипта: true, запас: true });
  });

  it('state сохраняется для сверки на возврате', () => {
    // Сгенерировать и забыть — то же самое, что не генерировать.
    const текст = читать(МОДУЛЬ);
    must(/localStorage\.setItem\(STATE_KEY/.test(текст), 'state не сохраняется');
    must(/rememberState\(state\)/.test(текст), 'state не запоминается перед входом');
  });

  it('виджет получает state параметром', () => {
    must(
      /state:\s*state,/.test(читать(МОДУЛЬ)),
      'виджет не получает state: генерируется, но не используется',
    );
  });

  it('вернувшийся state СВЕРЯЕТСЯ', () => {
    // Без этой проверки генерация была бы бессмысленной: Xsolla редиректит
    // с ?code=...&state=..., и совпадение доказывает, что код с нашего клика.
    const текст = читать(МОДУЛЬ);
    must(/verifyReturnedState\(/.test(текст), 'сверки state нет');
    must(/saved\.value === state \? 'ok' : 'mismatch'/.test(текст),
      'сравнение не точное: подстроку подставить проще всего');
    must(/readCallback\(/.test(текст), 'адрес возврата не разбирается');
    must(/URLSearchParams/.test(текст), 'разбор не через URLSearchParams');
    // state одноразовый
    must(/removeItem\(STATE_KEY\)/.test(текст), 'state не удаляется после возврата');
  });

  it('handleReturn действительно вызван', () => {
    // Объявить и не позвать — та же смерть, что у createRaid.
    // Именно так уже было со startHeartbeat в этом проекте.
    const текст = читать(МОДУЛЬ);
    const вызовов = (текст.match(/^  handleReturn\(\);/gm) ?? []).length;
    must(вызовов === 1, `вызовов handleReturn ${вызовов}: функция есть, но её не зовут`);
  });

  it('предпочтительный язык — не захардкожен в русский', () => {
    // ru_ru был в присланном коде. На сезонной основе лендинг сам бы выбрал
    // язык; проверка требует, чтобы это была константа, а не вшитая строка.
    const текст = читать(МОДУЛЬ);
    must(
      !/preferredLocale: 'ru_ru'/.test(текст),
      'язык виджета зашит в русский: остальные два языка получит английский',
    );
  });
});

function must(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

describe('Xsolla-вход: обмен кода на сервере', () => {
  it('маршрут обмена есть и смонтирован', () => {
    const текст = читать('server/src/routes/xsolla.ts');
    const индекс = читать('server/src/index/index.ts');
    must(/xsollaExchangeRouter\.post\(\s*'\/exchange'/.test(текст), 'маршрута обмена нет');
    must(
      /app\.use\('\/api\/auth\/xsolla', xsollaExchangeRouter\)/.test(индекс),
      'роутер не смонтирован: маршрут есть, а запрос получит 404',
    );
    // Тело с кодом проверяется, а не принимается как есть.
    must(/typeof req\.body\?\.code === 'string'/.test(текст), 'код не проверяется');
  });

  it('секрет берётся из окружения, а не из браузера', () => {
    const текст = читать('server/src/routes/xsolla.ts');
    must(/process\.env\.XSOLLA_LOGIN_SECRET/.test(текст),
      'секрет не из окружения: он бы оказался в коде');
    // Без секрета — отказ, а не «ок» на невыполненный вход.
    must(/503[\s\S]{0,80}not_configured/.test(текст),
      'без секрета маршрут отвечает как будто всё хорошо');
  });

  it('клиент не держит секрет и не обменивает код сам', () => {
    const текст = читать(МОДУЛЬ);
    must(!/client_secret|secret/i.test(текст),
      'в клиентском коде появился секрет: он доступен кому угодно');
  });

  // ── Доведение до сессии (§126) ────────────────────────────
  //
  // До §126 маршрут отвечал { ok: true } и на этом всё. Токен Xsolla
  // получен, а игры он не касался: localStorage пуст, и вошедший человек
  // видел форму почты как будто ничего не случилось. Это и была «наполовину
  // защита» — только теперь не state, а сам вход.
  it('обмен доведён до нашей сессии, а не до "ok"', () => {
    const текст = читать('server/src/routes/xsolla.ts');
    must(/authService\.loginWithXsolla\(/.test(текст),
      'маршрут не зовёт loginWithXsolla: обмен заканчивается ничем');
    // Ответ обязан нести токен игры. Без него клиенту нечего сохранить.
    must(/token:\s*сессия\.token/.test(текст),
      'в ответе нет токена игры — клиент сохранит пустоту');
    must(/userId:\s*сессия\.userId/.test(текст), 'в ответе нет userId');
    // Провал выдачи сессии — отказ, а не «ок» наполовину.
    must(/502[\s\S]{0,120}session_failed/.test(текст),
      'неудачная выдача сессии отвечает как будто всё хорошо');
  });

  it('AuthService умеет вход по токену Xsolla', () => {
    const сервис = читать('server/src/services/AuthService.ts');
    must(/async loginWithXsolla\(/.test(сервис), 'метода loginWithXsolla нет');
    // Порядок привязки — решение владельца: сначала по провайдеру, потом по
    // подтверждённой почте.
    must(/FROM user_identities WHERE provider = \$1 AND provider_id = \$2/.test(сервис),
      'поиска в user_identities нет');
    must(/INSERT INTO user_identities/.test(сервис),
      'привязки в user_identities нет: новый Xsolla был бы каждый раз новым игроком');
    must(/email_verified/.test(сервис),
      'непроверённая почта считалась бы настоящей: ею можно занять чужой аккаунт');
  });

  it('связь живёт в user_identities, а НЕ колонкой в users', () => {
    // В 032_oauth_identities.sql это решено осознанно, и шапка миграции
    // объясняет почему: у одного человека несколько входов при одном
    // user_id, и колонка позволила бы только один Xsolla на аккаунт.
    const сервис = код('server/src/services/AuthService.ts');
    const миг = код('database/migrations/077_xsolla_login_link.sql');
    must(!/WHERE xsolla_id = \$1/.test(сервис),
      'в AuthService остался поиск по колонке xsolla_id — способ, который проект отверг');
    must(!/ADD COLUMN IF NOT EXISTS xsolla_id/.test(миг),
      'миграция всё ещё заводит колонку в users вместо user_identities');
    must(!/xsolla\.invalid/.test(сервис),
      'свой домен вместо oauth.invalid: служебная почта провайдера сойдёт за настоящую');
    must(/xsolla_\$\{профиль\.id\}@oauth\.invalid/.test(сервис),
      'почта провайдера не по домену проекта');
  });

  it('профиль спрашивается у Xsolla, а не выдумывается', () => {
    const сервис = читать('server/src/services/AuthService.ts');
    must(/login\.xsolla\.com\/api\/users\/me/.test(сервис),
      'профиль не откуда взять: сервер не спрашивает Xsolla');
    must(/Authorization: `Bearer /.test(сервис),
      'токен не передаётся: ответ был бы 401');
  });

  it('клиент сохраняет сессию в ключи обычного входа', () => {
    // Свой ключ для Xsolla означал бы вторую ветку входа в игре, и
    // вошедший по кнопке увидел бы форму почты.
    const текст = читать(МОДУЛЬ);
    must(/localStorage\.setItem\('eos_token'/.test(текст),
      'клиент не пишет eos_token — игра не узнает о входе');
    must(/localStorage\.removeItem\('eos_guest'/.test(текст),
      'гостевой признак не снят: выдал бы гостя за вошедшего по Xsolla');
  });

  it('миграция переиспользует user_identities, ничего не заводит в users', () => {
    const миг = читать('database/migrations/077_xsolla_login_link.sql');
    must(!/ADD COLUMN/.test(миг),
      'миграция снова заводит колонку в users — это и есть решение, от которого 032 отказался');
    must(/user_identities/.test(миг), 'миграция не упоминает user_identities');
    // Контроль на будущее: без таблицы вход молча упал бы в рантайме.
    must(/RAISE EXCEPTION/.test(миг),
      'миграция не проверяет наличие таблицы: поломка обнаружится в игре, а не здесь');
  });
});

describe('Xsolla-вход: заголовок переведён', () => {
  it('site.xsolla_title есть во всех трёх языках', () => {
    for (const язык of ['ru', 'en', 'az']) {
      const словарь = JSON.parse(читать(`shared/locales/${язык}.json`)) as {
        site: Record<string, string>;
      };
      must(
        typeof словарь.site?.xsolla_title === 'string' && словарь.site.xsolla_title.length > 0,
        `в ${язык}.json нет site.xsolla_title — заголовок блока будет пустым`,
      );
    }
  });
});