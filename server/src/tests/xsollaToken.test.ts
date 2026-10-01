// Xsolla: конфигурация и запрос токена. Проверяем то, из-за чего пришлось
// писать адаптер, а не подключить готовый SDK: наборы азенов не передаются
// суммой, они передаются SKU из каталога Xsolla.
import {
  xsollaConfig,
  isXsollaEnabled,
  xsollaSku,
  xsollaEmail,
  xsollaCountry,
  buildXsollaTokenRequest,
  xsollaAuthHeader,
  xsollaCheckoutUrl,
  xsollaApiUrl,
  ВИТРИНА_БОЕВАЯ,
  ВИТРИНА_ПЕСОЧНИЦЫ,
  type XsollaConfig,
} from '../services/payments/xsolla/token';

const PAYMENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const БАЗОВОЕ_ОКРУЖЕНИЕ = {
  XSOLLA_ENABLED: 'true',
  XSOLLA_PUBLISHER_ID: '940854',
  XSOLLA_PROJECT_ID: '316884',
  XSOLLA_API_KEY: 'api-key-значение',
  XSOLLA_WEBHOOK_SECRET: 'секрет-вебхуков',
};

const КОНФИГ: XsollaConfig = {
  publisherId: 940854,
  projectId: 316884,
  apiKey: 'api-key-значение',
  webhookSecret: 'секрет-вебхуков',
  sandbox: false,
};

const ВХОД = {
  paymentId: PAYMENT_ID,
  userId: USER_ID,
  sku: 'eos.azens.rub_m',
  quantity: 1,
  returnUrl: 'https://www.game.eos-gameonline.com/game/?payment=' + PAYMENT_ID,
  country: 'ru',
  email: 'igrok@example.com',
  language: 'ru',
};

/**
 * Проверка с сужением типа.
 *
 * asserts, а не void: после must(значение) редактор знает, что значение
 * точно есть, и не требует проверки в каждом месте использования. Без
 * этого каждая строка теста обрастает проверкой на null, и читать его
 * перестаёшь.
 */
function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

function запись(значение: unknown): Record<string, unknown> {
  if (typeof значение !== 'object' || значение === null) throw new Error('не объект');
  return значение as Record<string, unknown>;
}

describe('Xsolla: конфигурация', () => {
  it('провайдер выключен по умолчанию: без XSOLLA_ENABLED ключи игнорируются', () => {
    // Ключи в .env могут лежать заранее, а провайдер включается последним
    // шагом. Если бы отсутствие флага не выключало провайдер, недописанная
    // конфигурация начала бы принимать настоящие платежи.
    const безФлага = { ...БАЗОВОЕ_ОКРУЖЕНИЕ };
    delete (безФлага as Record<string, string | undefined>).XSOLLA_ENABLED;
    must(xsollaConfig(безФлага) === null, 'провайдер включился без XSOLLA_ENABLED');
    must(isXsollaEnabled(безФлага) === false, 'isXsollaEnabled врёт при выключенном провайдере');
    must(xsollaConfig(БАЗОВОЕ_ОКРУЖЕНИЕ) !== null, 'при полном окружении провайдер выключен');
  });

  it('любой недостающий ключ выключает провайдер молча, а не частично', () => {
    // Половина ключей - хуже, чем ни одного: запрос ушёл бы с одним секретом
    // и подпись проверялась бы не тем ключом.
    const обязательные = ['XSOLLA_PUBLISHER_ID', 'XSOLLA_PROJECT_ID', 'XSOLLA_API_KEY', 'XSOLLA_WEBHOOK_SECRET'];
    for (const ключ of обязательные) {
      const окружение: Record<string, string | undefined> = { ...БАЗОВОЕ_ОКРУЖЕНИЕ };
      окружение[ключ] = undefined;
      must(xsollaConfig(окружение) === null, `провайдер включился без ${ключ}`);
      окружение[ключ] = '   ';
      must(xsollaConfig(окружение) === null, `провайдер включился с пустым ${ключ}`);
    }
  });

  it('идентификаторы приводятся числами, мусор отвергается', () => {
    // must, а не expect: проверка обязана и сама падать по имени теста.
    // Тип тут сужается через non-null только потому, что must выше уже
    // доказал, что конфиг собран.
    const конфиг: XsollaConfig | null = xsollaConfig(БАЗОВОЕ_ОКРУЖЕНИЕ);
    must(конфиг !== null, 'конфиг не собрался на заведомо полном окружении');
    const собранный: XsollaConfig = конфиг;
    must(собранный.publisherId === 940854, `publisherId = ${собранный.publisherId}, а ждали число 940854`);
    must(typeof собранный.projectId === 'number', 'projectId не число');
    must(собранный.projectId === 316884, `projectId = ${собранный.projectId}`);

    // project_id должен уйти ЧИСЛОМ. Строка даёт 422 с невнятным описанием,
    // и виноватым выглядит каталог, а не код.
    for (const плохое of ['не число', '316884.5', '-1', '0x10']) {
      const окружение = { ...БАЗОВОЕ_ОКРУЖЕНИЕ, XSOLLA_PROJECT_ID: плохое };
      must(xsollaConfig(окружение) === null, `projectId "${плохое}" принят как число`);
    }
  });

  it('песочница включается только явным флагом', () => {
    must(xsollaConfig(БАЗОВОЕ_ОКРУЖЕНИЕ)?.sandbox === false, 'песочница включилась сама');
    const вПесочнице = xsollaConfig({ ...БАЗОВОЕ_ОКРУЖЕНИЕ, XSOLLA_SANDBOX: 'true' });
    must(вПесочнице?.sandbox === true, 'XSOLLA_SANDBOX=true не включил песочницу');
    must(xsollaConfig({ ...БАЗОВОЕ_ОКРУЖЕНИЕ, XSOLLA_SANDBOX: 'да' })?.sandbox === false,
      'значение не "true" включило песочницу');
  });
});

describe('Xsolla: каталог и почта', () => {
  it('SKU собирается по нашим наборам и не пропускает чужой текст', () => {
    must(xsollaSku('rub_s') === 'eos.azens.rub_s', 'SKU собран неверно');
    must(xsollaSku('man_l') === 'eos.azens.man_l', 'SKU для маната собран неверно');

    // packId приходит от клиента. Пропуск проверки утащил бы чужой текст в
    // SKU, Xsolla ответил бы 422, и игрок увидел бы «платёж не создан».
    for (const плохое of ['a b', 'a/b', 'sku;drop', 'вот так', '', '../../etc']) {
      let упало = false;
      try {
        xsollaSku(плохое);
      } catch {
        упало = true;
      }
      must(упало, `недопустимый packId "${плохое}" прошёл в SKU`);
    }
  });

  it('почта гостей и OAuth-аккаунтов в Xsolla не уходит', () => {
    // В нашей базе у гостей guest_<id>@guest.invalid, у OAuth — @oauth.invalid
    // (AuthService, миграция 031). Передать это нельзя: адрес должен
    // соответствовать RFC 822, и письмо о покупке уйдёт в никуда.
    must(xsollaEmail('guest_550e8400@guest.invalid') === null, 'почта гостя ушла в Xsolla');
    must(xsollaEmail('abc123@oauth.invalid') === null, 'почта OAuth-аккаунта ушла в Xsolla');
    must(xsollaEmail('GUEST@GUEST.INVALID') === null, 'подделка почты прошла в верхнем регистре');
    must(xsollaEmail(null) === null, 'null-почта не отброшена');
    must(xsollaEmail('   ') === null, 'пустая почта не отброшена');
    must(xsollaEmail('igrok@example.com') === 'igrok@example.com', 'настоящая почта потерялась');
  });

  it('страна обязательна и приводится к верхнему регистру', () => {
    // Без страны Xsolla не определяет валюту: игрок из Казахстана увидит
    // цену не в тенге. А поле формально обязательное.
    must(xsollaCountry('ru') === 'RU', 'страна не приведена к верхнему регистру');
    must(xsollaCountry('kz') === 'KZ', 'страна kz не приведена');
    must(xsollaCountry('RUS') === null, 'трёхбуквенный код принят');
    must(xsollaCountry('r') === null, 'однобуквенный код принят');
    must(xsollaCountry(null) === null, 'null-страна не отброшена');

    let упало = false;
    try {
      buildXsollaTokenRequest({ ...ВХОД, country: null }, КОНФИГ);
    } catch {
      упало = true;
    }
    must(упало, 'запрос собрался без страны');
  });
});

describe('Xsolla: запрос токена', () => {
  it('project_id и quantity уходят ЧИСЛАМИ, а не строками', () => {
    const { body } = buildXsollaTokenRequest(ВХОД, КОНФИГ);
    const настройки = запись(body.settings);
    const пользователь = запись(body.user);
    const покупка = запись(body.purchase);
    const позиции: unknown = покупка.items;
    must(Array.isArray(позиции), 'purchase.items не массив');
    const список = позиции as unknown[];
    must(список.length === 1, `в заказе ${список.length} позиций, а должен быть один набор`);
    const позиция = запись(список[0]);

    // Три поля, где строка вместо числа даёт 422.
    must(typeof настройки.project_id === 'number', 'project_id ушёл не числом');
    must(настройки.project_id === 316884, 'project_id не тот');
    must(typeof позиция.quantity === 'number', 'quantity ушёл не числом');
    must(позиция.quantity === 1, 'quantity не тот');
    must(позиция.sku === 'eos.azens.rub_m', 'SKU в заказе не тот');

    // Идентификаторы: наш paymentId в external_id, наш users.id в user.id.
    must(настройки.external_id === PAYMENT_ID, 'external_id не равен нашему paymentId');
    const узелId = запись(пользователь.id);
    must(узелId.value === USER_ID, 'user.id.value не равен нашему users.id');
  });

  it('редиректы совпадают с настройками в кабинете, и это не случайность', () => {
    const { body } = buildXsollaTokenRequest(ВХОД, КОНФИГ);
    const редирект = запись(запись(body.settings).redirect_policy);

    // Автоматического редиректа нет: витрина открывается ПОВЕРХ 3D-мира, и
    // автоматический уход с неё выкинул бы игрока из состояния, сбросив
    // несохранённый прогресс. Кнопка появляется после оплаты.
    must(редирект.redirect_conditions === 'none', 'автоматический редирект включён');
    must(редирект.status_for_manual_redirection === 'successful', 'кнопка возврата не по оплате');
    must(редирект.delay === 0, 'задержка редиректа не 0');
    must(typeof редирект.redirect_button_caption === 'string', 'нет надписи на кнопке возврата');
    must(String(редирект.redirect_button_caption).length > 0, 'надпись на кнопке пустая');

    // settings.mode=user_account показывает витрину без покупки, а
    // ui.mode=user_account — меню сохранённых карт. Ни то, ни другое
    // в оплате не участвует, и молча включить их нельзя.
    const настройки = запись(body.settings);
    must(настройки.mode === undefined, 'settings.mode задан - витрина не сможет продать');
    const ui = запись(настройки.ui);
    must(ui.mode === undefined, 'ui.mode задан - витрина покажет не то');
    must(ui.is_payment_methods_list_mode === true, 'список способов оплаты страны не включён');
  });

  it('почта гостя не попадает в запрос, а настоящая попадает', () => {
    const сГостем = buildXsollaTokenRequest(
      { ...ВХОД, email: 'guest_550e8400@guest.invalid' }, КОНФИГ,
    );
    must(запись(сГостем.body.user).email === undefined, 'почта гостя попала в запрос');

    const сНастоящей = buildXsollaTokenRequest(ВХОД, КОНФИГ);
    const узел = запись(запись(сНастоящей.body.user).email);
    must(узел.value === 'igrok@example.com', 'настоящая почта не попала в запрос');
  });

  it('плохие величины отвергаются до отправки, а не после ответа 422', () => {
    const случаи: Array<[string, () => unknown]> = [
      ['пустой paymentId', () => buildXsollaTokenRequest({ ...ВХОД, paymentId: '' }, КОНФИГ)],
      ['пустой userId', () => buildXsollaTokenRequest({ ...ВХОД, userId: '' }, КОНФИГ)],
      ['дробное quantity', () => buildXsollaTokenRequest({ ...ВХОД, quantity: 1.5 }, КОНФИГ)],
      ['нулевое quantity', () => buildXsollaTokenRequest({ ...ВХОД, quantity: 0 }, КОНФИГ)],
      ['нецелое NaN', () => buildXsollaTokenRequest({ ...ВХОД, quantity: Number.NaN }, КОНФИГ)],
      ['SKU с пробелом', () => buildXsollaTokenRequest({ ...ВХОД, sku: 'a b' }, КОНФИГ)],
      ['return_url без схемы', () => buildXsollaTokenRequest({ ...ВХОД, returnUrl: '/game/' }, КОНФИГ)],
    ];
    for (const [название, действие] of случаи) {
      let упало = false;
      try {
        действие();
      } catch {
        упало = true;
      }
      must(упало, `случай «${название}» не отвергнут до отправки`);
    }
  });

  it('песочница меняет и флаг в теле, и адрес витрины', () => {
    // Ошибка в одну сторону (флаг есть, адрес боевой) уводит тестовую оплату
    // на настоящие деньги. Поэтому проверяются оба.
    const боевой = buildXsollaTokenRequest(ВХОД, КОНФИГ);
    must(боевой.body.sandbox === undefined, 'боевой запрос помечен как sandbox');

    const вПесочнице = buildXsollaTokenRequest(ВХОД, { ...КОНФИГ, sandbox: true });
    must(вПесочнице.body.sandbox === true, 'флаг sandbox не отправлен');

    // Строковое сравнение: литералы в TypeScript сужаются до своих типов,
    // и «одинаковые на вид» адреса компилятор считает заведомо разными.
    const боевойАдрес: string = ВИТРИНА_БОЕВАЯ;
    const адресПесочницы: string = ВИТРИНА_ПЕСОЧНИЦЫ;
    must(xsollaCheckoutUrl('токен', false).startsWith(боевойАдрес), 'боевой адрес витрины не тот');
    must(xsollaCheckoutUrl('токен', true).startsWith(адресПесочницы), 'адрес песочницы не тот');
    must(боевойАдрес !== адресПесочницы, 'адреса витрин совпали - это не два хоста');

    let упало = false;
    try {
      xsollaCheckoutUrl('', false);
    } catch {
      упало = true;
    }
    must(упало, 'пустой токен дал адрес витрины');
  });
});

describe('Xsolla: авторизация и адрес API', () => {
  it('Authorization - это base64 от publisherId:apiKey', () => {
    const заголовок = xsollaAuthHeader(КОНФИГ);
    must(заголовок.startsWith('Basic '), 'схема авторизации не basic');

    const декодировано = Buffer.from(заголовок.slice('Basic '.length), 'base64').toString('utf-8');
    // Для этого вызова нужен ключ компании, а не проекта: в пути merchant_id.
    // С ключом проекта приходит 401, и это выглядит как «ключ неверный».
    must(декодировано === `940854:${КОНФИГ.apiKey}`, `в авторизации «${декодировано}»`);

    const другой = xsollaAuthHeader({ ...КОНФИГ, publisherId: 1 });
    must(другой !== заголовок, 'merchant_id не влияет на авторизацию - подозрительно');
  });

  it('адрес API и путь ведут к вызову с project_id', () => {
    const { path } = buildXsollaTokenRequest(ВХОД, КОНФИГ);
    must(path === '/v3/project/316884/admin/payment/token', `путь вызова «${path}»`);
    must(xsollaApiUrl(path).startsWith('https://'), 'адрес API не https');
    must(xsollaApiUrl('/x').endsWith('/x'), 'путь не приклеился к основе');
  });
});
