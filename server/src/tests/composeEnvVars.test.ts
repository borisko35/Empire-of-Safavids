// Переменные из deploy/.env доходят до контейнера только если они
// перечислены в docker-compose.prod.yml. Забытая переменная выглядит
// снаружи как «провайдер не настроен», хотя файл заполнен правильно -
// и это молча.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

const compose = читать('deploy/docker-compose.prod.yml');
const пример = читать('deploy/.env.example');

/**
 * Проверка с сужением типа.
 *
 * asserts, а не void: после must(значение) редактор знает, что значение
 * точно есть, и не требует проверки в каждом месте. Без этого каждая
 * строка обрастает проверкой, и проверку перестаёшь читать. Сама проверка
 * падает по имени теста, а не TypeError изнутри.
 */
function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

/** Имена переменных, перечисленных в блоке environment сервиса server. */
function переменныеСервера(): Set<string> {
  // Блок начинается с 6-кратного отступа "KEY: ${KEY" внутри environment.
  // Отсекаем caddy и postgres: там другой набор и другая логика.
  const блок = compose.slice(compose.indexOf('\n  server:'), compose.indexOf('\n  postgres:'));
  const найдено = new Set<string>();
  const образец = /^\s{6}([A-Z][A-Z0-9_]*):\s/gm;
  let m: RegExpExecArray | null;
  while ((m = образец.exec(блок)) !== null) {
    if (m[1] !== undefined) найдено.add(m[1]);
  }
  return найдено;
}

const вCompose = переменныеСервера();

describe('Переменные доходят до контейнера', () => {
  it('блок environment сервиса server вообще разобран', () => {
    // Якорь: если разбор сломается, все проверки ниже молча превратятся в
    // «переменной нет», и падать начнёт не причина, а следствие.
    //
    // Якорь выбран на переменных, которые точно принадлежат серверу.
    // Первая версия проверяла ещё POSTGRES_PASSWORD и падала: пароль базы
    // перечислен в сервисе postgres, а не в server, то есть якорь был
    // неверен и проверял не то, о чём думал. Якорь должен ломаться от
    // поломки разбора, а не от того, что автор ошибся именем.
    must(вCompose.size > 20, `разобрано только ${вCompose.size} переменных - разбор сломан`);
    must(вCompose.has('JWT_SECRET'), 'JWT_SECRET не найден - разбор блока неверен');
    must(вCompose.has('CLIENT_ORIGIN'), 'CLIENT_ORIGIN не найден - разбор блока неверен');
    must(вCompose.has('MEDIA_DIR'), 'MEDIA_DIR не найден - разбор блока неверен');
  });

  it('все шесть переменных Xsolla перечислены в compose', () => {
    // ПОЧЕМУ ИМЕННО ЭТА ПРОВЕРКА. Значения из deploy/.env не попадают в
    // контейнер автоматически: docker compose передаёт только то, что
    // перечислено в environment. Переменная, добавленная в .env и
    // забытая в compose, выглядит снаружи как «ключи не подхватились»,
    // хотя файл заполнен верно. Именно так и случилось с Xsolla.
    const нужные = [
      'XSOLLA_ENABLED', 'XSOLLA_PUBLISHER_ID', 'XSOLLA_PROJECT_ID',
      'XSOLLA_API_KEY', 'XSOLLA_WEBHOOK_SECRET', 'XSOLLA_SANDBOX',
    ];
    for (const имя of нужные) {
      must(вCompose.has(имя), `${имя} не перечислена в compose - значение из .env не дойдёт до сервера`);
    }
  });

  it('каждая переменная Xsolla в compose подставляетcя из .env', () => {
    // Само перечисление мало: нужно ещё ${ИМЯ:-}, иначе compose возьмёт
    // пустое значение и ошибка будет выглядеть как «переменной нет».
    for (const имя of ['XSOLLA_ENABLED', 'XSOLLA_API_KEY', 'XSOLLA_WEBHOOK_SECRET', 'XSOLLA_SANDBOX']) {
      must(
        compose.includes(`${имя}: \${${имя}:-}`),
        `${имя} перечислена, но не подставляется из .env`,
      );
    }
  });

  it('переменные ЮKassa и PUBLIC_URL тоже доходят', () => {
    // Найдено при разбирательстве с Xsolla: эти переменные тоже были
    // забыты, то есть ЮKassa не работала никогда, а PUBLIC_URL молча
    // уступал место заголовку запроса.
    const нужные = [
      'PAYMENT_JOBIK_ENABLED', 'PAYMENT_JOBIK_SHOP_ID', 'PAYMENT_JOBIK_SECRET',
      'PUBLIC_URL', 'PAYMENTS_SIMULATOR',
    ];
    for (const имя of нужные) {
      must(вCompose.has(имя), `${имя} не перечислена в compose - значение из .env не дойдёт до сервера`);
    }
  });

  it('секреты не попадают в compose буквально', () => {
    // В compose разрешено только ${ИМЯ:-}. Значение секрета здесь означало
    // бы, что он в репозитории.
    for (const имя of ['XSOLLA_API_KEY', 'XSOLLA_WEBHOOK_SECRET', 'JWT_SECRET']) {
      const строки = compose.split('\n').filter((l) => l.trim().startsWith(`${имя}:`));
      for (const строка of строки) {
        must(
          строка.includes('\${'),
          `${имя} записан в compose значением, а не подстановкой из .env: ${строка.trim()}`,
        );
      }
    }
  });

  it('пример .env перечисляет те же переменные Xsolla, что и compose', () => {
    // Пример .env - это то, что человек копирует при настройке. Если в
    // примере нет переменной, её не впишут, и провайдер останется
    // выключенным без объяснений.
    for (const имя of [
      'XSOLLA_ENABLED', 'XSOLLA_PUBLISHER_ID', 'XSOLLA_PROJECT_ID',
      'XSOLLA_API_KEY', 'XSOLLA_WEBHOOK_SECRET', 'XSOLLA_SANDBOX',
    ]) {
      must(пример.includes(имя), `${имя} не упомянута в deploy/.env.example`);
    }
  });

  it('симулятор платежей на боевом сервере выключен', () => {
    // При true любой вошедший игрок напечатал бы себе AZENS без оплаты:
    // симулятор идёт тем же путём, что и настоящий вебхук.
    const строка = пример.split('\n')
      .find((l) => l.trim().startsWith('PAYMENTS_SIMULATOR'));
    must(строка !== undefined, 'PAYMENTS_SIMULATOR не упомянут в примере .env');
    // Тип сужается после must, и следующая строка уже не требует проверки.
    must(строка.includes('false'), `в примере .env симулятор не выключен: ${строка.trim()}`);
  });
});
