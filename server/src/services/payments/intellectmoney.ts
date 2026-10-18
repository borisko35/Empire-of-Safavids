// ============================================================
// Intellect Money — приём платежей через виджет — Empire of Safavids
// ============================================================
//
// ПОЧЕМУ ВИДЖЕТ, А НЕ ПЕРЕНАПРАВЛЕНИЕ. Intellect Money предоставляет
// готовый JS-виджет (merchant.intellectmoney.ru/v2/js/...), который
// отрисовывает форму оплаты прямо на нашей странице. Игрок не уходит
// на чужой домен — карта вводится в iframe виджета, SberPay/ApplePay
// работают нативно. Это повышает конверсию и удобство.
//
// ПОТОК:
// 1. POST /payments/topup создаёт pending-платёж, возвращает параметры
//    для виджета (eshopId, orderId=paymentId, amount, email, ServiceName).
// 2. Клиент загружает виджет, инициализирует его этими параметрами.
// 3. Intellect Money шлёт уведомление на ResultUrl (ResultUrl = наш вебхук)
//    с полями: eshopId, orderId, paymentId, serviceName, eshopAccount,
//    recipientAmount, recipientCurrency, paymentStatus, userName, userEmail,
//    paymentData, hash (MD5).
// 4. Наш вебхук проверяет hash (MD5 от конкатенации полей + secretKey),
//    мапит paymentStatus → kind, начисляет через paymentService.
//
// СТАТУСЫ paymentStatus (документация Intellect Money):
//   3 — платёж оплачен (paid)
//   5 — платёж отменён / не прошёл
// Остальные — промежуточные, игнорируем.

import crypto from 'crypto';
import type { ParsedPaymentEvent } from '../paymentProviders';

export const INTELLECTMONEY = 'intellectmoney';

export interface IntellectMoneyConfig {
  eshopId: string;
  secretKey: string;
}

/**
 * Ключи из окружения.
 *
 * Возвращает null, если провайдер выключен или ключей нет. Это не ошибка,
 * а штатное состояние: без ключей маршрут отвечает «провайдер не настроен».
 */
export function intellectMoneyConfig(env: NodeJS.ProcessEnv = process.env): IntellectMoneyConfig | null {
  if (env.PAYMENT_INTELLECTMONEY_ENABLED !== 'true') return null;
  const eshopId = env.PAYMENT_INTELLECTMONEY_ESHOP_ID;
  const secretKey = env.PAYMENT_INTELLECTMONEY_SECRET_KEY;
  if (!eshopId || !secretKey) return null;
  return { eshopId, secretKey };
}

export function isIntellectMoneyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return intellectMoneyConfig(env) !== null;
}

/**
 * Поля уведомления от Intellect Money (ResultUrl).
 *
 * ПОРЯДОК ПОЛЕЙ В ХЭШЕ — КРИТИЧЕСКИ ВАЖЕН. Intellect Money формирует
 * контрольную подпись MD5 путем конкатенации значений через :: в строгой
 * последовательности (документация: Протокол приема платежей IntellectMoney):
 *   eshopId::orderId::serviceName::eshopAccount::recipientAmount::
 *   recipientCurrency::paymentStatus::userName::userEmail::paymentData::SecretKey
 *
 * Нам хэш приходит в теле уведомления в поле hash. Мы считаем свой MD5
 * от тех же полей + наш secretKey и сравниваем.
 */
export interface IntellectMoneyNotification {
  eshopId: string;
  orderId: string;
  paymentId: string;           // номер СКО в системе Intellect Money
  serviceName: string;
  eshopAccount: string;
  recipientAmount: string;     // «100.00»
  recipientCurrency: string;   // RUB / TST / USD / EUR
  paymentStatus: string;       // «3» = оплачен, «5» = отменён
  userName: string;
  userEmail: string;
  paymentData: string;         // «2025-01-01 12:00:00»
  hash: string;                // MD5 hex
  // Дополнительные поля (UserField_*) игнорируем для подписи
}

/**
 * Проверить MD5-хэш уведомления Intellect Money.
 *
 * @param body — тело уведомления (req.body)
 * @param secretKey — секретный ключ магазина из настроек Intellect Money
 * @returns true если хэш совпадает
 */
export function verifyIntellectMoneyHash(body: IntellectMoneyNotification, secretKey: string): boolean {
  const {
    eshopId,
    orderId,
    serviceName,
    eshopAccount,
    recipientAmount,
    recipientCurrency,
    paymentStatus,
    userName,
    userEmail,
    paymentData,
    hash,
  } = body;

  if (!hash) return false;

  // Конкатенация строго в порядке документации. Пустые значения оставляем пустыми
  // (два :: подряд), не удаляем поле.
  const signatureString = [
    eshopId ?? '',
    orderId ?? '',
    serviceName ?? '',
    eshopAccount ?? '',
    recipientAmount ?? '',
    recipientCurrency ?? '',
    paymentStatus ?? '',
    userName ?? '',
    userEmail ?? '',
    paymentData ?? '',
    secretKey,
  ].join('::');

  const expectedHash = crypto.createHash('md5').update(signatureString, 'utf8').digest('hex');
  return expectedHash.toLowerCase() === hash.toLowerCase();
}

/**
 * Маппинг статуса Intellect Money в наш контракт ParsedPaymentEvent.
 *
 * paymentStatus:
 *   «3» → completed (оплачен)
 *   «5» → failed (отменён / не прошёл)
 * Остальные → null (промежуточные, ждём финальный статус)
 */
export function intellectMoneyStatusToEvent(
  body: IntellectMoneyNotification,
  paymentId: string
): ParsedPaymentEvent | null {
  const providerPaymentId = body.paymentId; // СКО в системе Intellect Money
  if (!providerPaymentId) return null;

  const base = { paymentId, providerPaymentId };

  if (body.paymentStatus === '3') {
    return { ...base, kind: 'completed' };
  }
  if (body.paymentStatus === '5') {
    return { ...base, kind: 'failed', failReason: 'canceled' };
  }
  // 1, 2, 4 и прочие — промежуточные, не решаем
  return null;
}

/**
 * Параметры для инициализации виджета на клиенте.
 *
 * Возвращаются из POST /payments/topup вместо checkoutUrl.
 * Клиент загружает https://merchant.intellectmoney.ru/v2/js/IntellectMoneyMerchantWidget.js
 * и вызывает IntellectMoneyMerchantWidget.Configuration.init(params).
 */
export interface IntellectMoneyWidgetParams {
  EshopId: string;
  OrderId: string;           // наш paymentId
  ServiceName: string;
  RecipientAmount: string;   // с двумя знаками после точки: «100.00»
  RecipientCurrency: string; // RUB
  Email: string;
  // Опциональные поля виджета:
  SuccessUrl?: string;       // пусто = остаться на странице, виджет вызовет onSuccess
  BackUrl?: string;
  ResultUrl?: string;        // наш вебхук — задаётся в настройках магазина, тут не обязателен
  Preference?: string;
  UserField_1?: string;
  UserField_2?: string;
  // Колбэки (функции) не сериализуются в JSON — клиент добавит их сам
}

export function buildWidgetParams(
  cfg: IntellectMoneyConfig,
  payment: { id: string; realAmount: number; realCurrency: string; packId: string | null },
  email: string
): IntellectMoneyWidgetParams {
  const serviceName = `Empire of Safavids — ${payment.packId ?? 'AZENS'}`.slice(0, 100);
  return {
    EshopId: cfg.eshopId,
    OrderId: payment.id,
    ServiceName: serviceName,
    RecipientAmount: payment.realAmount.toFixed(2),
    RecipientCurrency: payment.realCurrency.toUpperCase(),
    Email: email,
    // SuccessUrl не задаём — виджет вызовет onSuccess, мы сами рефрешим баланс
  };
}