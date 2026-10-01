// Разбор вебхуков Xsolla. Здесь проверяется не «правильность разбора», а
// четыре ловушки тела плюс главное правило ответов: на настоящий платёж
// 4xx и 5xx означают ВОЗВРАТ ДЕНЕГ ПОКУПАТЕЛЮ.
//
// Тела взяты из примера документа для order_paid и урезаны до нужного.
import {
  xsollaNotificationType,
  parseXsollaUser,
  parseXsollaOrder,
  суммаСтрокой,
  знаковВВалюте,
  вМинорныеЕдиницы,
  суммаСовпадает,
  isoКод,
  type XsollaOrder,
} from '../services/payments/xsolla/webhook';
import { resolveXsollaNotification, ожидаемаяМинорная } from '../services/payments/xsolla/index';
import { PAYMENT_PROVIDERS, UNSIGNED_PROVIDERS } from '../services/paymentProviders';

const PAYMENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const СЕКРЕТ = 'секрет-вебхуков';

const ОКРУЖЕНИЕ = {
  XSOLLA_ENABLED: 'true',
  XSOLLA_PUBLISHER_ID: '940854',
  XSOLLA_PROJECT_ID: '316884',
  XSOLLA_API_KEY: 'api-key',
  XSOLLA_WEBHOOK_SECRET: СЕКРЕТ,
};

/** Подпись считается здесь так же, как в продакшене. */
const подпись = (тело: string) =>
  `Signature ${require('node:crypto').createHash('sha1').update(тело + СЕКРЕТ, 'utf-8').digest('hex')}`;

/**
 * Настоящий order_paid по форме документа: items на верхнем уровне,
 * order.amount в ВИРТУАЛЬНОЙ валюте, деньги в billing.purchase.total,
 * игрок в user.external_id.
 */
const ТЕЛО_ORDER_PAID = JSON.stringify({
  notification_type: 'order_paid',
  items: [
    { sku: 'eos.azens.rub_m', type: 'virtual_good', is_pre_order: false, quantity: 140, amount: '500', promotions: [] },
  ],
  order: {
    id: 1,
    mode: 'default',
    currency_type: 'virtual',
    currency: 'sku_currency',
    amount: '2000',
    status: 'paid',
    invoice_id: PAYMENT_ID,
  },
  user: { external_id: USER_ID, email: 'igrok@example.com', country: 'RU' },
  billing: {
    notification_type: 'payment',
    settings: { project_id: 316884, merchant_id: 940854 },
    purchase: { total: { currency: 'RUB', amount: 500 } },
    transaction: { id: 999, external_id: 1, payment_method_name: 'WebMoney' },
  },
});

const ТЕЛО_USER_VALIDATION = JSON.stringify({
  notification_type: 'user_validation',
  user: { ip: '127.0.0.1', phone: '18777976552', email: 'igrok@example.com', id: USER_ID, name: 'Safavid', country: 'RU' },
});

const ПЛАТЁЖ = { id: PAYMENT_ID, realAmount: 500, realCurrency: 'rub' };

/**
 * Проверка с сужением типа.
 *
 * asserts, а не void: после must(заказ) редактор знает, что заказ не null,
 * и не требует проверки в каждой строке. Сама проверка падает по имени
 * теста - это и было целью, TypeError изнутри был бы хуже.
 */
function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

/**
 * Разбор заказа с проверкой, что он не null.
 *
 * Сужение нужно, чтобы не сыпались проверки «возможно null» в каждой строке
 * теста. Сама проверка - обычный must: тест обязан упасть по имени, а не
 * TypeError изнутри.
 */
function разобратьЗаказ(тело: unknown): XsollaOrder {
  // Тип сужается ПОСЛЕ проверки. Объявление с union нужно редактору, чтобы
  // он не требовал проверки в каждом месте использования; сама проверка -
  // обычный must, и тест падает по имени, а не TypeError.
  const заказ: XsollaOrder | null = parseXsollaOrder(тело);
  must(заказ !== null, 'заказ не разобран');
  return заказ;
}

describe('Xsolla: тип уведомления', () => {
  it('тип определяется, а незнакомый не путается с оплатой', () => {
    must(xsollaNotificationType(JSON.parse(ТЕЛО_ORDER_PAID)) === 'order_paid', 'order_paid не определён');
    must(xsollaNotificationType(JSON.parse(ТЕЛО_USER_VALIDATION)) === 'user_validation', 'user_validation не определён');
    must(xsollaNotificationType({ notification_type: 'order_canceled' }) === 'order_canceled', 'order_canceled не определён');
    // Незнакомый тип - это 'unknown', а НЕ order_paid. На 'unknown'
    // отвечаем 2xx, на order_paid начисляем: ошибка здесь стоит денег.
    must(xsollaNotificationType({ notification_type: 'payment' }) === 'unknown', 'payment принят за известный тип');
    must(xsollaNotificationType({}) === 'unknown', 'пустое тело дало не unknown');
    must(xsollaNotificationType(null) === 'unknown', 'null дал не unknown');
    must(xsollaNotificationType('строка') === 'unknown', 'строка дала не unknown');
  });
});

describe('Xsolla: user_validation', () => {
  it('игрок читается как user.id, и ЧИСЛО принимается наравне со строкой', () => {
    // В примере документа user.id - это число 1234567, а наш идентификатор -
    // UUID, то есть строка. Строгая проверка typeof === 'string' отбросила бы
    // нормальный вебхук и заблокировала бы игроку оплату.
    const соСтрокой = parseXsollaUser({ user: { id: USER_ID } });
    must(соСтрокой !== null && соСтрокой.id === USER_ID, 'игрок по строке не прочитан');

    const сЧислом = parseXsollaUser({ user: { id: 1234567 } });
    must(сЧислом !== null && сЧислом.id === '1234567', 'числовой user.id отброшен');

    // В order_paid игрок приходит как external_id - это другой вебхук, и
    // путать их нельзя.
    must(parseXsollaUser({ user: { external_id: USER_ID } }) === null,
      'order_paid-шный user.external_id принят за user_validation');
    must(parseXsollaUser({}) === null, 'вебхук без игрока разобран как валидный');
  });
});

describe('Xsolla: тело заказа', () => {
  it('items читаются с верхнего уровня, а не из order', () => {
    const заказ = разобратьЗаказ(JSON.parse(ТЕЛО_ORDER_PAID));
    must(заказ.items.length === 1, `товаров ${заказ.items.length}, а должен быть один набор`);
    must(заказ.items[0].sku === 'eos.azens.rub_m', 'SKU товара не тот');
    // Количество здесь - это азены в наборе, а не число наборов.
    must(заказ.items[0].quantity === 140, `quantity = ${заказ.items[0].quantity}, а ждали 140 азенов`);

    // Ловушка: order.items не существует, и искать товары там - значит
    // объявить оплаченный заказ пустым.
    const безВерхнего = разобратьЗаказ({ notification_type: 'order_paid', order: { items: [{ sku: 'x', quantity: 1 }] } });
    must(безВерхнего.items.length === 0, 'товары взяты из order.items, которых там нет');
  });

  it('сумма берётся из billing.purchase.total, а не из виртуального order.amount', () => {
    const заказ = разобратьЗаказ(JSON.parse(ТЕЛО_ORDER_PAID));
    // order.amount в примере - 2000 валюты sku_currency. Если бы мы взяли
    // его, сверка с нашими 500 рублями провалилась бы на КАЖДОМ платеже,
    // и верные платежи отвергались бы, а деньги уходили бы игрокам.
    must(заказ.amount === '500', `сумма = ${заказ.amount}, а ждали 500 из billing.purchase.total`);
    must(заказ.currency === 'RUB', `валюта = ${заказ.currency}`);
  });

  it('игрок в order_paid читается как user.external_id, а не user.id', () => {
    must(разобратьЗаказ(JSON.parse(ТЕЛО_ORDER_PAID)).userId === USER_ID, 'user.external_id не прочитан');
  });

  it('transaction.id годен для дедупликации', () => {
    const заказ = разобратьЗаказ(JSON.parse(ТЕЛО_ORDER_PAID));
    must(заказ.transactionId === '999', `transactionId = ${заказ.transactionId}`);
    // Без него повторный вебхук начислил бы азены дважды. В теле примера
    // рядом стоит transaction.external_id = 1, то есть наш выбор должен от
    // него отличаться. Через переменную: литералы TypeScript сужает до своих
    // типов и считает такое сравнение заведомо ложным.
    const подмена: string = '1';
    must(заказ.transactionId !== подмена, 'взят transaction.external_id вместо transaction.id');
  });

  it('наш paymentId ищется только среди полей вида нашего UUID', () => {
    must(разобратьЗаказ(JSON.parse(ТЕЛО_ORDER_PAID)).paymentId === PAYMENT_ID,
      'invoice_id с нашим UUID не прочитан');

    // Чужие значения не наш UUID - значит, наш paymentId неизвестен.
    // Начислять в этом случае нельзя, и это осознанный отказ.
    const безНашего = разобратьЗаказ({
      notification_type: 'order_paid',
      order: { id: 1, invoice_id: '1', external_id: 42 },
      billing: { transaction: { id: 999, external_id: 1 } },
    });
    must(безНашего.paymentId === null, 'чужое значение принято за наш paymentId - азены уйдут не тому заказу');

    must(разобратьЗаказ({ notification_type: 'order_paid', order: { id: 1 } }).paymentId === null,
      'заказ без идентификаторов разобран как наш');
    must(parseXsollaOrder({ notification_type: 'order_paid' }) === null, 'тело без order разобрано как заказ');
  });
});

describe('Xsolla: суммы', () => {
  it('копейки считаются по цифрам, а не умножением float', () => {
    // ЛОВУШКА float РЕАЛЬНА, НО НЕ ДЛЯ ЛЮБОЙ СУММЫ. 20.5 * 100 даёт
    // ровно 2050, и утверждение «всегда ломается» неверно. Ломаются
    // конкретные значения: 1.005 * 100 = 100.49999999999999, и округление
    // даёт 100 вместо 100.5 - на полкопейки меньше. Проверка «сколько
    // заплатили» отвергла бы на этом верный платёж, и деньги ушли бы
    // игроку насовсем.
    const наивное = Math.round(1.005 * 100);
    must(наивное === 100, `наивный float дал ${наивное}, а ловушка обязана дать 100`);

    // Наша сторона суммы, где ловушка и есть. Наивный путь молча взял бы
    // 100 копеек, то есть на полкопейки меньше настоящего. Наш путь -
    // ОТКАЗ (null): в строке "1.005" три знака после запятой, а валюта
    // имеет два. Отказ здесь правильнее и числа: лучше сумма уйдёт на
    // сверку, чем начисление разойдётся с фактом на полкопейки молча.
    const наше = ожидаемаяМинорная(1.005, 'rub');
    must(наше === null, `на дробных копейках наш путь дал ${наше} вместо отказа`);
    must(наше !== наивное, 'отказ и наивное число совпали - отказа нет');

    // Значение БЕЗ ловушки обязано считаться обоими способами одинаково,
    // иначе проверка выше проверяла бы несуществующую проблему.
    must(вМинорныеЕдиницы('20.5') === 2050, '20.5 посчитаны неверно');
    must(вМинорныеЕдиницы('20.5') === Math.round(20.5 * 100), 'на 20.5 пути обязаны совпасть');
    must(вМинорныеЕдиницы('100') === 10000, '100 рублей посчитаны неверно');
    must(вМинорныеЕдиницы('0.01') === 1, 'одна копейка посчитана неверно');
    must(вМинорныеЕдиницы('500.00') === 50000, 'хвост из нулей потерян');
    must(вМинорныеЕдиницы('0') === 0, 'ноль не распознан');
    // Молча округлять нельзя: округление на копейку - это недоплата или
    // лишний расход. Лучше отказ.
    must(вМинорныеЕдиницы('1.005') === null, 'лишний знак после запятой молча округлён');
    must(вМинорныеЕдиницы('abc') === null, 'мусор принят за сумму');
    must(вМинорныеЕдиницы('') === null, 'пустая строка принята за сумму');
  });

  it('число из JSON приводится строкой, а не складывается само', () => {
    must(суммаСтрокой(20.5) === '20.5', 'число 20.5 превратилось не в "20.5"');
    must(суммаСтрокой('20.50') === '20.50', 'строка суммы искажена');
    must(суммаСтрокой(9.99) === '9.99', 'число 9.99 искажено');
    must(суммаСтрокой(null) === null, 'null принят за сумму');
    must(суммаСтрокой(Number.NaN) === null, 'NaN принят за сумму');
    must(суммаСтрокой('20,50') === null, 'запятая вместо точки принята');
  });

  it('у иен и вон нет копеек, у рублей - есть', () => {
    must(знаковВВалюте('JPY') === 0, 'у иен ноль знаков?');
    must(знаковВВалюте('KRW') === 0, 'у вон ноль знаков?');
    must(знаковВВалюте('RUB') === 2, 'у рубля не два знака');
    must(знаковВВалюте(null) === 2, 'для неизвестной валюты взяты не два знака');
    must(вМинорныеЕдиницы('500', 0) === 500, '500 иен посчитаны неверно');
  });

  it('наш код валюты переводится в ISO, иначе платёж в манатах отвергается', () => {
    // ОШИБКА, КОТОРАЯ СТОИЛА БЫ ДЕНЕГ. Внутренний код валюты в игре - `man`
    // (азербайджанский манат), а Xsolla присылает в вебхуке `AZN`. Простое
    // приведение к верхнему регистру дало бы `MAN`, сверка не сошлась бы, и
    // верный платёж был бы отвергнут - а Xsolla на 4xx возвращает покупателю
    // деньги. Каждый азербайджанский игрок потерял бы платёж молча.
    must(isoКод('man') === 'AZN', 'man не переводится в AZN');
    must(isoКод('MAN') === 'AZN', 'man не переводится в AZN в верхнем регистре');
    must(isoКод('rub') === 'RUB', 'rub не переводится');
    must(isoКод('usd') === 'USD', 'usd не переводится');
    must(isoКод('eur') === 'EUR', 'eur не переводится');
    must(isoКод('uah') === 'UAH', 'uah не переводится');
    // Неизвестная валюта - отказ, а не догадка.
    must(isoКод('kzt') === null, 'незнакомая валюта не отвергнута');
    must(isoКод(null) === null, 'null-валюта не отвергнута');
    // MNT - это монгольский тёгрёг, другой код. Перепутать легко, поэтому
    // и проверяем, что он НЕ равен AZN.
    must(isoКод('man') !== 'MNT', 'манат спутан с монгольским тёгрёгом');
  });

  it('платёж в манатах проходит сверку, а не отвергается', () => {
    // Тот же случай, собранный как настоящий вебхук: order_paid с AZN и
    // наша запись в манатах. До починки сверка возвращала бы false, и
    // деньги ушли бы обратно покупателю.
    const тело = JSON.stringify({
      notification_type: 'order_paid',
      items: [{ sku: 'eos.azens.man_l', type: 'virtual_good', quantity: 1200, amount: '2000' }],
      order: { id: 1, currency_type: 'virtual', invoice_id: PAYMENT_ID, status: 'paid' },
      user: { external_id: USER_ID, country: 'AZ' },
      billing: {
        purchase: { total: { currency: 'AZN', amount: 2000 } },
        transaction: { id: 777 },
      },
    });
    const заказ = разобратьЗаказ(JSON.parse(тело));
    // 2000 манатов = 200000 копеек, наш счёт тоже 2000 манатов.
    must(суммаСовпадает(заказ, 200000, 'man'), 'платёж в манатах отвергнут');
    // Тот же платёж, но наша запись в рублях: разные деньги, отказ обязателен.
    must(!суммаСовпадает(заказ, 200000, 'rub'), 'манат принят за рубль');
    // И наоборот: сумма 2000, а в записи 500 - расхождение величины.
    must(!суммаСовпадает(заказ, 50000, 'man'), 'расхождение суммы не замечено');
  });

  it('сумма сверяется и по величине, и по валюте', () => {
    const заказ = разобратьЗаказ(JSON.parse(ТЕЛО_ORDER_PAID));

    must(суммаСовпадает(заказ, 50000, 'rub'), 'верная сумма не сошлась');
    // 100 KZT и 100 RUB - разные деньги. Начислить азены за одну вместо
    // другой нельзя, даже если цифры совпали.
    must(!суммаСовпадает(заказ, 50000, 'kzt'), 'платёж в рублях принят за тенге');
    must(!суммаСовпадает(заказ, 50100, 'rub'), 'расхождение суммы не замечено');
    // order.amount в виртуальной валюте не должен проходить как наши рубли.
    must(!суммаСовпадает(заказ, 200000, 'rub'), 'виртуальная сумма order.amount принята за рубли');

    const ожидаемая = ожидаемаяМинорная(500, 'rub');
    must(ожидаемая === 50000, `наша сумма 500 рублей стала ${ожидаемая} копеек`);
    // Тот же float-ловушка с нашей стороны: 20.5 * 100 даёт 2049.
    must(ожидаемаяМинорная(20.5, 'rub') === 2050, 'наша дробная сумма посчитана float-способом');
    must(ожидаемаяМинорная(Number.NaN, 'rub') === null, 'NaN прошёл в ожидаемую сумму');
  });
});

describe('Xsolla: решение по вебхуку', () => {
  const собрать = (тело: string, заголовок?: string) => ({
    rawBody: тело,
    signatureHeader: заголовок ?? подпись(тело),
    body: JSON.parse(тело),
    userExists: async (): Promise<boolean> => true,
    findPayment: async (): Promise<typeof ПЛАТЁЖ | null> => ПЛАТЁЖ,
  });

  it('подпись проверяется ДО всего, и подделка отвергается молча', () => {
    const уведомление = собрать(ТЕЛО_ORDER_PAID, 'Signature 0000000000000000000000000000000000000000');
    return expect(resolveXsollaNotification(уведомление, ОКРУЖЕНИЕ)).resolves.toMatchObject({
      action: 'reject',
      reason: 'signature_mismatch',
    });
  });

  it('подпись считается по сырому телу, а не по разобранному', () => {
    // Пересериализовали тело перед передачей - подпись перестала сходиться
    // ровно так, как в проде, если где-то по дороге распарсили и собрали заново.
    const уведомление = {
      ...собрать(ТЕЛО_ORDER_PAID),
      rawBody: JSON.stringify(JSON.parse(ТЕЛО_ORDER_PAID), null, 2),
    };
    return expect(resolveXsollaNotification(уведомление, ОКРУЖЕНИЕ)).resolves.toMatchObject({
      action: 'reject',
      reason: 'signature_mismatch',
    });
  });

  it('user_validation: игрок найден - 204, не найден - 400', () => {
    const есть = собрать(ТЕЛО_USER_VALIDATION);
    return expect(resolveXsollaNotification(есть, ОКРУЖЕНИЕ)).resolves.toMatchObject({
      action: 'confirm-user',
    }).then(() => {
      const нет = { ...собрать(ТЕЛО_USER_VALIDATION), userExists: async (): Promise<boolean> => false };
      return expect(resolveXsollaNotification(нет, ОКРУЖЕНИЕ)).resolves.toMatchObject({
        action: 'reject',
        reason: 'user_not_found',
      });
    });
  });

  it('order_paid ведёт к начислению, order_canceled - к снятию', async () => {
    const оплачен = await resolveXsollaNotification(собрать(ТЕЛО_ORDER_PAID), ОКРУЖЕНИЕ);
    must(оплачен.action === 'credit', `order_paid дал «${оплачен.action}» вместо credit`);
    must(оплачен.payment?.id === PAYMENT_ID, 'к начислению не приложена наша запись');
    must(оплачен.amountMismatch === false, `расхождение суммы не замечено на верном платеже: ${оплачен.reason}`);

    const отменён = JSON.stringify({ ...JSON.parse(ТЕЛО_ORDER_PAID), notification_type: 'order_canceled' });
    const решение = await resolveXsollaNotification(собрать(отменён), ОКРУЖЕНИЕ);
    must(решение.action === 'reverse', `order_canceled дал «${решение.action}» вместо reverse`);
  });

  it('расхождение суммы с нашей записью помечается, но начисление не отменяется', async () => {
    // Цена набора живёт и в economy.ts, и в каталоге Xsolla. Разошлись -
    // игрок заплатил не столько, сколько обещали. Отменять начисление
    // нельзя: мы обещали азены за свою цену, а не за каталожную.
    const верно = await resolveXsollaNotification(собрать(ТЕЛО_ORDER_PAID), ОКРУЖЕНИЕ);
    must(верно.action === 'credit', 'верный платёж не дошёл до начисления');
    must(верно.amountMismatch === false, 'на верном платеже помечено расхождение');

    // Тот же платёж, но каталожная цена вдвое ниже нашей.
    const заниженный = JSON.parse(ТЕЛО_ORDER_PAID) as {
      billing: { purchase: { total: { currency: string; amount: number } } };
    };
    заниженный.billing.purchase.total.amount = 100;
    const тело = JSON.stringify(заниженный);
    const итог = await resolveXsollaNotification(собрать(тело), ОКРУЖЕНИЕ);
    must(итог.action === 'credit', 'расхождение суммы отменило начисление - это потеря денег игроку');
    must(итог.amountMismatch === true, 'расхождение суммы не помечено');
  });

  it('не наш заказ - 4xx, недоступная база - 5xx, и это разные ответы', async () => {
    const нетЗаписи = { ...собрать(ТЕЛО_ORDER_PAID), findPayment: async (): Promise<typeof ПЛАТЁЖ | null> => null };
    must((await resolveXsollaNotification(нетЗаписи, ОКРУЖЕНИЕ)).action === 'reject',
      'чужой заказ не отвергнут');

    // Разница принципиальна: «заказа нет» повторять нечего, а «база лежит»
    // повторить надо, иначе настоящий платёж потеряется.
    const базаЛежит = {
      ...собрать(ТЕЛО_ORDER_PAID),
      findPayment: async (): Promise<typeof ПЛАТЁЖ | null> => { throw new Error('timeout'); },
    };
    must((await resolveXsollaNotification(базаЛежит, ОКРУЖЕНИЕ)).action === 'retry',
      'недоступная база не дала повтор');

    const игрокиЛежат = {
      ...собрать(ТЕЛО_USER_VALIDATION),
      userExists: async (): Promise<boolean> => { throw new Error('timeout'); },
    };
    must((await resolveXsollaNotification(игрокиЛежат, ОКРУЖЕНИЕ)).action === 'retry',
      'недоступная база в user_validation не дала повтор');
  });

  it('выключенный провайдер просит повтор, а не отказ: иначе вернём деньги', async () => {
    // Здесь легко ошибиться и ответить 4xx «провайдер не настроен». На
    // настоящем платеже это ВОЗВРАТ ДЕНЕГ покупателю, а не «ничего страшного».
    const выключен = { ...ОКРУЖЕНИЕ, XSOLLA_ENABLED: 'false' };
    const решение = await resolveXsollaNotification(собрать(ТЕЛО_ORDER_PAID), выключен);
    must(решение.action === 'retry', `на выключенном провайдере получили «${решение.action}»`);
    must(решение.reason === 'provider_not_configured', 'причина не названа');
  });

  it('незнакомый тип отвечается как «понял», а не как отказ', async () => {
    // 4xx на незнакомом типе = возврат денег. Незнакомый тип бывает
    // законно, и отказать ему нельзя.
    const решение = await resolveXsollaNotification(собрать('{"notification_type":"afs_black_list"}'), ОКРУЖЕНИЕ);
    must(решение.action === 'ack', `незнакомый тип дал «${решение.action}» вместо ack`);
  });

  it('заказ без нашего paymentId ждёт повтора, а не «понял»', async () => {
    // ПЕРВАЯ ВЕРСИЯ ЭТОЙ ПРОВЕРКИ БЫЛА ДЫРЯВОЙ. Она требовала только
    // «не начислить» и совпадения строки причины. При поломке, где вместо
    // повтора отдавался 204 (ack), тест проходил: действие не было credit,
    // а строка причины оставалась прежней. А это тихая потеря денег - Xsolla
    // считает вебхук обработанным, повторов не будет, и игрок заплатит впустую.
    // Поэтому здесь проверяется КОНКРЕТНОЕ действие, а не его отсутствие.
    const тело = JSON.stringify({ notification_type: 'order_paid', order: { id: 1, invoice_id: '1' } });
    const решение = await resolveXsollaNotification(собрать(тело), ОКРУЖЕНИЕ);
    // Обход сужения типов: решение.action после must выше уже сужен до
    // литерального "retry", и TypeScript считает сравнение с "ack"
    // заведомо ложным (TS2367) - проверка уронила бы КОМПИЛЯЦИЮ, а не
    // тест. Именно такой падёж доказательством не считается.
    // Приведение к string через промежуточную переменную возвращает
    // проверку в тест, где она и должна падать.
    const действие: string = String(решение.action);
    // Запрещённые действия проверяются ПО СПИСКУ, а не сравнением с
    // литералом: так проверка не зависит от того, сузил ли редактор тип.
    const запрещены: string[] = ['ack', 'credit', 'reverse', 'confirm-user', 'reject'];
    must(!запрещены.includes(действие),
      `действие «${действие}» из запрещённых: 204 или отказ на заказе без нашего paymentId - деньги уйдут игроку насовсем`);
    must(действие === 'retry', `действие «${действие}» вместо retry`);
    must(решение.reason === 'no_our_payment_id_in_order', 'причина не названа');
  });
});

describe('Xsolla: изоляция от общего реестра', () => {
  it('Xsolla не попадает в общий реестр: user_validation там начислил бы', () => {
    // Общий реестр умеет одно: разобрать тело и начислить. У Xsolla три
    // вебхука, и один из них - про существование игрока, а не про оплату.
    // Попав в реестр, он начислял бы азены на каждый чих.
    must(PAYMENT_PROVIDERS.xsolla === undefined, 'Xsolla оказался в общем реестре провайдеров');
    must(!UNSIGNED_PROVIDERS.includes('xsolla'), 'Xsolla помечен как непроверяемый подписью');
  });
});
