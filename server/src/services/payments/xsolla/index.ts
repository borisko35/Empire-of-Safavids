// ============================================================
// Xsolla — приём платежей — Empire of Safavids
// ============================================================
// ЗДЕСЬ ПРИНИМАЕТСЯ РЕШЕНИЕ, А В МАРШРУТЕ ТОЛЬКО ПРЕВРАЩАЕТСЯ В КОД ОТВЕТА.
// Причина та же, что у ЮKassa: правило «начислить только по тому, что
// подтверждено» обязано проверяться настоящим запуском, а поиском по тексту
// маршрута. Поиск нашёл бы строку и успокоился бы даже на перевёрнутом
// условии, а деньги начисляются по этому коду.
//
// ПОЧЕМУ У XSOLLA ОТДЕЛЬНЫЙ МАРШРУТ, А НЕ ОБЩИЙ РЕЕСТР PAYMENT_PROVIDERS.
// У Xsolla три разных вебхука с разными ответами, и один из них вообще не
// про оплату: user_validation спрашивает, существует ли игрок, и обязан
// ответить 204, а не «начислить». Общий реестр умеет одно: разобрать тело в
// единый контракт и начислить. Здесь этого недостаточно, и попытка втиснуть
// Xsolla в реестр означала бы либо игнорирование user_validation, либо
// начисление по нему.
//
// ПРИНЦИП, КОТОРЫЙ ОСТАЁТСЯ ОТ ЮKASSA И EPOINT. Тело вебхука — чужое
// утверждение. Подпись доказывает, что оно от Xsolla, но не что заказ
// оплачен и что сумма та. Правду о сумме даёт сверка с нашей записью, и
// начисляем мы по нашей записи: это то, что мы обещали игроку.
//
// ГЛАВНАЯ ОПАСНОСТЬ, И ОНА НЕ В КОДЕ, А В КОДЕ ОТВЕТА. На настоящий платёж
// Xsolla ждёт 2xx. Ответ 4xx, 5xx или отсутствие ответа после 20 попыток
// означает ВОЗВРАТ ДЕНЕГ ПОКУПАТЕЛЮ. Поэтому:
//   - настоящий платёж -> всегда 2xx;
//   - сомнение (база недоступна) -> 5xx, чтобы повторить;
//   - подделка или чужой заказ -> 4xx, потому что повторять нечего.
// Ошибка в одну сторону (5xx там, где надо 2xx) стоит игроку денег. Ошибка в
// другую (4xx на живом платеже) — тоже. Правило простое, и оно в коде.

import { xsollaConfig, isXsollaEnabled, buildXsollaTokenRequest, xsollaAuthHeader,
  xsollaCheckoutUrl, xsollaApiUrl, type XsollaConfig, type XsollaTokenInput, type Env }
  from './token';
import { xsollaVerifySignature } from './signature';
import { xsollaNotificationType, parseXsollaUser, parseXsollaOrder, суммаСовпадает,
  вМинорныеЕдиницы, знаковВВалюте, type XsollaOrder } from './webhook';

export { isXsollaEnabled, xsollaConfig };

/** Имя провайдера в нашей базе платежей. Одно на все вызовы. */
export const XSOLLA = 'xsolla';

/** Наш paymentId в минорных единицах — чтобы сравнить с пришедшим от Xsolla. */
export function ожидаемаяМинорная(realAmount: number, currency: string): number | null {
  if (typeof realAmount !== 'number' || !Number.isFinite(realAmount)) return null;
  // Через строку, а не умножением: realAmount 20.5 * 100 даёт 2049.99...
  return вМинорныеЕдиницы(String(realAmount), знаковВВалюте(currency));
}

export interface XsollaPaymentRecord {
  id: string;
  /** Сумма в единицах валюты, как она лежит в payments.real_amount. */
  realAmount: number;
  realCurrency: string;
}

export type XsollaAction =
  | 'confirm-user'
  | 'credit'
  | 'reverse'
  | 'ack'
  | 'retry'
  | 'reject';

export interface XsollaDecision {
  action: XsollaAction;
  /** Уходит в лог. Игроку не показывается. */
  reason: string;
  order?: XsollaOrder;
  payment?: XsollaPaymentRecord;
  /** Сумма разошлась с нашей записью: начисляем по своей, но кричим в лог. */
  amountMismatch?: boolean;
}

export interface XsollaNotification {
  /** Сырое тело. Обязательно сырое: подпись по пересобранному JSON не сойдётся. */
  rawBody: string;
  signatureHeader: string | null | undefined;
  body: unknown;
  /** Есть ли такой игрок у нас. Для user_validation. */
  userExists: (userId: string) => Promise<boolean>;
  /** Наш платёж по paymentId. */
  findPayment: (paymentId: string) => Promise<XsollaPaymentRecord | null>;
}

export type XsollaEnv = Env;

/**
 * Создать счёт и получить адрес витрины.
 *
 * providerError, а не исключение наружу: игрок увидит «платёж не создан»,
 * а в лог уйдёт причина. Сеть и ответ Xsolla разбираются здесь же, потому
 * что пробрасывать исключение из обработчика нельзя — маршрут упал бы с
 * 500, и клиент счёл бы заказ неоформленным.
 */
export async function createXsollaPayment(
  input: XsollaTokenInput,
  env: XsollaEnv = process.env,
): Promise<{ checkoutUrl: string | null; orderId: string | null; providerError: string | null }> {
  const config = xsollaConfig(env);
  if (config === null) {
    return { checkoutUrl: null, orderId: null, providerError: 'provider_not_configured' };
  }

  let запрос: ReturnType<typeof buildXsollaTokenRequest>;
  try {
    запрос = buildXsollaTokenRequest(input, config);
  } catch (err) {
    // Наш код собрал запрос не по схеме: скорее всего, пустой country или
    // негодный SKU. Это ошибка конфигурации, а не сети провайдера.
    return { checkoutUrl: null, orderId: null, providerError: `provider_request_invalid: ${(err as Error).message}` };
  }

  try {
    const ответ = await fetch(xsollaApiUrl(запрос.path), {
      method: 'POST',
      headers: {
        Authorization: xsollaAuthHeader(config),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(запрос.body),
      signal: AbortSignal.timeout(20_000),
    });
    const текст = await ответ.text();
    if (!ответ.ok) {
      // Тело ошибки Xsolla полезно при настройке и не должно утекать игроку:
      // в лог — первые 300 символов, клиенту — нет.
      return { checkoutUrl: null, orderId: null, providerError: `provider_http_${ответ.status}: ${текст.slice(0, 300)}` };
    }
    let тело: unknown = null;
    try {
      тело = текст.length > 0 ? JSON.parse(текст) : null;
    } catch {
      тело = null;
    }
    if (тело === null || typeof тело !== 'object') {
      return { checkoutUrl: null, orderId: null, providerError: 'provider_response_unreadable' };
    }
    const ответное = тело as Record<string, unknown>;
    const token = typeof ответное.token === 'string' ? ответное.token : '';
    if (token.length === 0) {
      return { checkoutUrl: null, orderId: null, providerError: 'provider_no_token' };
    }
    const orderIdRaw = ответное.order_id;
    const orderId = typeof orderIdRaw === 'string' || typeof orderIdRaw === 'number'
      ? String(orderIdRaw)
      : null;
    return {
      checkoutUrl: xsollaCheckoutUrl(token, config.sandbox),
      orderId,
      providerError: null,
    };
  } catch (err) {
    return { checkoutUrl: null, orderId: null, providerError: `provider_unreachable: ${(err as Error).message}` };
  }
}

/**
 * Разобрать вебхук и решить, что делать.
 *
 * ПОРЯДОК ПРОВЕРОК НЕ ПЕРЕСТАВЛЯЕТСЯ.
 *   1. подпись — иначе всё, что ниже, пересказ чужого текста;
 *   2. тип уведомления — от него зависит, что вообще прислали;
 *   3. для user_validation — существует ли игрок;
 *   4. для заказа — наш paymentId и наша запись.
 * Каждый шаг дешевле предыдущего по последствиям ошибки, и подпись
 * проверяется первой именно поэтому.
 *
 * ПОЧЕМУ user_exists ОТДЕЛЬНО ОТ ПОИСКА ПЛАТЕЖА. user_validation приходит
 * ДО оплаты и спрашивает только про игрока. Ответ «игрока нет» должен быть
 * быстрым: Xsolla этот вебхук не повторяет, и наш ответ — последнее
 * решение о том, продолжит ли игрок платить.
 */
export async function resolveXsollaNotification(
  уведомление: XsollaNotification,
  env: XsollaEnv = process.env,
): Promise<XsollaDecision> {
  const config: XsollaConfig | null = xsollaConfig(env);
  if (config === null) {
    // Провайдер выключен. Это не 4xx: если Xsolla шлёт настоящий платёж, а
    // мы выключены, ответ 4xx вернёт покупателю деньги. Лучше 5xx и повтор.
    return { action: 'retry', reason: 'provider_not_configured' };
  }

  if (!xsollaVerifySignature(уведомление.rawBody, config.webhookSecret, уведомление.signatureHeader)) {
    // Подделанный запрос: повторять нечего, и Xsolla его не присылает.
    return { action: 'reject', reason: 'signature_mismatch' };
  }

  const тип = xsollaNotificationType(уведомление.body);
  if (тип === 'unknown') {
    // Незнакомый тип: отвечаем 2xx. Это не молчание, а требование
    // документации: 4xx на незнакомом типе вернул бы покупателю деньги.
    return { action: 'ack', reason: `unknown_notification` };
  }
  if (тип === 'user_search') {
    // Публичный ID у нас не включён, но если включат - отвечаем 2xx, чтобы
    // не вернуть деньги за незнакомый нам сценарий.
    return { action: 'ack', reason: 'user_search_not_supported' };
  }

  if (тип === 'user_validation') {
    const игрок = parseXsollaUser(уведомление.body);
    if (игрок === null) {
      return { action: 'reject', reason: 'user_validation_without_user' };
    }
    let есть: boolean;
    try {
      есть = await уведомление.userExists(игрок.id);
    } catch (err) {
      // Повторов Xsolla не делает, поэтому честного ответа тут нет. Отвечаем
      // 5xx и пишем в лог: это единственный случай, где наш сбой виден
      // игроку, и молчать тут нельзя.
      return { action: 'retry', reason: `user_lookup_failed: ${(err as Error).message}` };
    }
    return есть
      ? { action: 'confirm-user', reason: 'user_found' }
      : { action: 'reject', reason: 'user_not_found' };
  }

  const заказ = parseXsollaOrder(уведомление.body);
  if (заказ === null) {
    return { action: 'reject', reason: 'order_unreadable' };
  }
  if (заказ.paymentId === null) {
    // Нашего идентификатора в теле нет. Начислить нельзя: единственное
    // известное нам поле для этого - external_id, а подставлять вместо него
    // что-то другое значит напечатать азены не тому заказу.
    return { action: 'retry', reason: 'no_our_payment_id_in_order' };
  }

  let платёж: XsollaPaymentRecord | null;
  try {
    платёж = await уведомление.findPayment(заказ.paymentId);
  } catch (err) {
    // База недоступна. Платёж настоящий, повтор нужен, поэтому 5xx.
    return { action: 'retry', reason: `payment_lookup_failed: ${(err as Error).message}` };
  }
  if (платёж === null) {
    // Заказ не наш: начислять нечего, и повторяться нечему. 4xx.
    return { action: 'reject', reason: 'payment_not_found' };
  }

  // Сверка суммы. Не решение, а сигнал: цена набора живёт и в economy.ts,
  // и в каталоге Xsolla, и разойтись они могут молча.
  const ожидаемая = ожидаемаяМинорная(платёж.realAmount, платёж.realCurrency);
  const amountMismatch = ожидаемая === null
    ? true
    : !суммаСовпадает(заказ, ожидаемая, платёж.realCurrency);

  const база: XsollaDecision = {
    action: тип === 'order_paid' ? 'credit' : 'reverse',
    reason: 'verified_against_our_record',
    order: заказ,
    payment: платёж,
    amountMismatch,
  };
  return база;
}
