// ============================================================
// Epoint — приём платежей в манатах — Empire of Safavids
// ============================================================
//
// ПОЧЕМУ ЗДЕСЬ ДРУГАЯ СХЕМА, ЧЕМ У ЮKassa. У ЮKassa вебхук приходит без
// подписи, и проверить его нечем: пришлось брать из уведомления только
// номер и самому переспрашивать API. У Epoint подпись ЕСТЬ, и она
// проверяется - base64 от SHA-1 по правилу private + data + private. Значит
// можно принимать решение по телу, но только после сверки подписи, и даже
// после этого правду о платеже даёт не тело, а get-status.
//
// ПРИНЦИП, КОТОРЫЙ ОСТАЁТСЯ ОТ ЮKASSA. Тело вебхука - это чужое
// утверждение. Подпись доказывает, что оно от Epoint, но не что платёж
// прошёл. Поэтому решение о зачислении принимает get-status, а вебхук
// лишь приводит нас к нему. Если get-status недоступен - отвечаем провайдеру
// так, чтобы он повторил, а не так, чтобы потерять деньги.
//
// ЧТО НУЖНО ОТ ВЛАДЕЛЬЦА (три значения, всё остальное написано):
//   EPOINT_PUBLIC_KEY     — идентификатор торговца, например i000000001
//   EPOINT_PRIVATE_KEY    — секретный ключ подписи
//   EPOINT_ENABLED        — 'true', когда аккаунт открыт и ключи вписаны
// Значения появляются только после регистрации у Epoint и после того, как
// поддержка ответит на вопрос о тестовом режиме (docs/epoint-support-
// questions.md). Включать на боевом сервере без их ответа нельзя: первая же
// проверка приём денег идёт на настоящих средствах.

import {
  EPOINT_API,
  epointConfig,
  epointBuildPayment,
  epointBuildStatusCheck,
  epointBuildReverse,
  type EpointConfig,
  type EpointPaymentRequest,
  type EpointRequest,
} from './request';
import { epointDecodeData, epointVerifySignature } from './signature';
import { epointResultToEvent, type EpointPaymentResult } from './result';

export type EpointResolution =
  | { action: 'credit'; result: EpointPaymentResult }
  | { action: 'fail'; result: EpointPaymentResult }
  | { action: 'retry'; reason: string }
  | { action: 'ignore'; reason: string }
  | { action: 'reject'; reason: string };

/** Провайдер настроен и ключи на месте. */
export function isEpointEnabled(env: Record<string, string | undefined>): boolean {
  return epointConfig(env) !== null;
}

async function post(
  path: string,
  req: EpointRequest,
): Promise<{ ok: boolean; body: unknown; код: number }> {
  // Отправляем JSON, а не форму: в base64 есть '+', и при отправке как
  // form-urlencoded '+' без кодирования читается как пробел, подпись не
  // сойдётся. JSON кодирования не требует.
  //
  // СБОЙ СЕТИ НЕ ПРОПУСКАЕМ НАРУЖУ. fetch бросает исключение при обрыве и
  // по таймауту, а пробрасывать его из обработчика вебхука нельзя: маршрут
  // упал бы с 500, Epoint счёл бы уведомление необработанным и повторил
  // бы его - то есть в итоге всё верно, но игрок увидел бы ошибку, и
  // повтор может кончиться. Правильный ответ: «спросить не вышло», и это
  // ведёт к повтору, а не к отказу платежа.
  try {
    const ответ = await fetch(`${EPOINT_API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(20_000),
    });
    const текст = await ответ.text();
    let тело: unknown = null;
    try {
      тело = текст ? JSON.parse(текст) : null;
    } catch {
      // HTML или пусто вместо JSON: тело останется null, и разбор ниже
      // даст «неизвестно», а не выдуманный отказ.
      тело = null;
    }
    return { ok: ответ.ok, body: тело, код: ответ.status };
  } catch {
    return { ok: false, body: null, код: 0 };
  }
}

/**
 * Создать счёт на оплату.
 *
 * Возвращает адрес страницы оплаты Epoint и, если он пришёл, номер операции
 * для get-status. Номер обязателен: без него позже нечем спросить провайдера
 * о судьбе платежа, и вебхук придётся принимать на веру.
 */
export async function createEpointPayment(
  input: EpointPaymentRequest,
  env: Record<string, string | undefined>,
): Promise<{ checkoutUrl: string | null; transaction: string | null; providerError: string | null }> {
  const config = epointConfig(env);
  if (!config) return { checkoutUrl: null, transaction: null, providerError: 'provider_not_configured' };

  const req = epointBuildPayment(config, input);
  const ответ = await post('/checkout', req);
  if (!ответ.ok) {
    return { checkoutUrl: null, transaction: null, providerError: 'provider_request_failed' };
  }
  const тело = (ответ.body ?? {}) as Record<string, unknown>;
  const transaction = typeof тело.transaction === 'string' ? тело.transaction : null;
  const checkoutUrl = typeof тело.redirect_url === 'string'
    ? тело.redirect_url
    : typeof тело.checkout_url === 'string' ? тело.checkout_url : null;
  return {
    checkoutUrl,
    transaction,
    // Счёт создан, а адреса нет: игрок не сможет заплатить. Это не
    // «оплачено» и не «отказано», и молчать здесь нельзя.
    providerError: checkoutUrl ? null : 'provider_no_checkout_url',
  };
}

/**
 * Спросить у провайдера, чем стал платёж.
 *
 * Единственный источник правды. Ни вебхук, ни наша запись в базе этого не
 * заменяют: наш статус мы же и писали.
 */
export async function fetchEpointPayment(
  transaction: string,
  env: Record<string, string | undefined>,
): Promise<EpointPaymentResult | null> {
  const config = epointConfig(env);
  if (!config) return null;
  const req = epointBuildStatusCheck(config, transaction);
  const ответ = await post('/get-status', req);
  if (!ответ.ok) return null;
  return epointResultToEvent(ответ.body);
}

/**
 * Разобрать вебхук и решить, что делать.
 *
 * ПОРЯДОК ПРОВЕРОК. Сначала подпись, потом поиск нашей записи по order_id,
 * потом спрос провайдеру. Подпись проверяется ПЕРВОЙ и по constant-time
 * сравнению: иначе подделка отсекается слишком поздно, когда часть работы
 * уже сделана. Порядок не переставляется - каждый шаг дешевле предыдущего
 * по последствиям ошибки.
 *
 * Ошибка сети - это retry, а не reject: провайдер повторит, и деньги не
 * потеряются. Отказ - это reject: повторяться нечему.
 */
export async function resolveEpointNotification(
  form: { data?: unknown; signature?: unknown },
  findByOrderId: (orderId: string) => Promise<{ paymentId: string } | null>,
  env: Record<string, string | undefined>,
): Promise<EpointResolution> {
  const data = typeof form.data === 'string' ? form.data : '';
  const signature = typeof form.signature === 'string' ? form.signature : '';
  if (!data || !signature) return { action: 'reject', reason: 'missing_data_or_signature' };

  const config = epointConfig(env);
  if (!config) return { action: 'reject', reason: 'provider_not_configured' };

  // Подпись. Без неё всё, что ниже, - пересказ чужого текста.
  if (!epointVerifySignature(config.privateKey, data, signature)) {
    return { action: 'reject', reason: 'signature_mismatch' };
  }

  let payload: Record<string, unknown>;
  try {
    const разобранное = epointDecodeData(data);
    if (разобранное === null || typeof разобранное !== 'object') {
      return { action: 'reject', reason: 'data_not_object' };
    }
    payload = разобранное as Record<string, unknown>;
  } catch {
    // Подпись сошлась, а data не разбирается: так бывает, если провайдер
    // прислал не то поле. Отказ, но не «подделка» - разные причины.
    return { action: 'reject', reason: 'data_not_decodable' };
  }

  // Наш order_id. Он возвращается в ответе, и матчить платёж надёжнее, чем
  // по одному лишь номеру операции.
  const orderId = typeof payload.order_id === 'string' ? payload.order_id : null;
  const transaction = typeof payload.transaction === 'string' ? payload.transaction : null;
  if (!orderId && !transaction) return { action: 'reject', reason: 'no_order_id_no_transaction' };

  const запись = orderId ? await findByOrderId(orderId) : null;
  if (!запись) {
    // Нашей записи нет - платёж не наш или номер подделан. Отказ, чтобы
    // уведомление не копилось у провайдера.
    return { action: 'reject', reason: 'payment_not_found' };
  }

  // Спрос провайдера. Тело выше - чужое утверждение, здесь - факт.
  const спрос = transaction ? await fetchEpointPayment(transaction, env) : null;
  if (спрос === null) {
    return { action: 'retry', reason: 'status_unavailable' };
  }
  if (спрос.kind === 'completed') return { action: 'credit', result: спрос };
  if (спрос.kind === 'pending') return { action: 'ignore', reason: 'still_processing' };
  if (спрос.kind === 'unknown') return { action: 'retry', reason: 'status_unreadable' };
  return { action: 'fail', result: спрос };
}

/**
 * Отменить операцию, то есть вернуть покупателю.
 *
 * ВНИМАНИЕ, ЧТОБЫ НЕ ПЕРЕПУТАТЬ. В Epoint есть /refund-request, и он не
 * возврат: это выплата средств с нашего счёта на карту получателя. Наш
 * маршрут возврата обязан звать /reverse. Перепутать - значит вместо
 * возврата выплатить.
 *
 * amount не передаём для полного возврата: без него отменяется вся
 * операция, а с ним - только указанная сумма.
 */
export async function reverseEpointPayment(
  transaction: string,
  env: Record<string, string | undefined>,
  amount?: number,
): Promise<{ ok: boolean; providerError: string | null }> {
  const config: EpointConfig | null = epointConfig(env);
  if (!config) return { ok: false, providerError: 'provider_not_configured' };
  const req = epointBuildReverse(config, transaction, amount);
  const ответ = await post('/reverse', req);
  if (!ответ.ok) return { ok: false, providerError: 'provider_request_failed' };
  return { ok: true, providerError: null };
}
