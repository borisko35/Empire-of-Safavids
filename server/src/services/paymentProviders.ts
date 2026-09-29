// ============================================================
// Payment providers — Empire of Safavids
// ============================================================
// Новыи провайдер (ЮKassa, CloudPayments, Stripe, ...) подключается
// так: реализовать PaymentProvider (проверка подписи + разбор
// события) и зарегистрировать в PROVIDERS ниже. Код вебхука и
// начисления при этом не меняется.
//
// Контракт события после разбора — единый для всех провайдеров:
// { paymentId, providerPaymentId, succeed, failReason? }
// paymentId — наш ID из POST /payments/topup (передаётся провайдеру
// в metadata/return-url при создании счёта).

import crypto from 'crypto';

export interface ParsedPaymentEvent {
  /** Наш paymentId (pending-запись из POST /payments/topup). */
  paymentId: string;
  /** Референс на стороне провайдера (для дедупликации ретраев). */
  providerPaymentId: string;
  /** Итог события. refunded = чарджбэк/возврат после успеха. */
  kind: 'completed' | 'failed' | 'refunded';
  failReason?: string;
}

export interface PaymentProvider {
  /** Ключ в URL: POST /payments/webhook/:name. */
  name: string;
  /** Проверка подлинности вызова (подпись/secret). */
  verifySignature(rawBody: string, signature: string | undefined): boolean;
  /** Разбор тела в единый контракт. null = событие не про оплату. */
  parseEvent(body: unknown): ParsedPaymentEvent | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Дженерик-HMAC провайдер: подпись = HMAC-SHA256 hex сырого тела. */
export function hmacProvider(name: string, secretEnvVar: string): PaymentProvider {
  return {
    name,
    verifySignature(rawBody: string, signature: string | undefined): boolean {
      const secret = process.env[secretEnvVar];
      if (!secret || !signature) return false;
      const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(signature, 'utf8');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
    parseEvent(body: unknown): ParsedPaymentEvent | null {
      if (!isRecord(body)) return null;
      const { paymentId, providerPaymentId, status, failReason } = body;
      if (typeof paymentId !== 'string' || typeof providerPaymentId !== 'string') return null;
      if (status !== 'completed' && status !== 'failed' && status !== 'refunded') return null;
      return {
        paymentId,
        providerPaymentId,
        kind: status,
        failReason: typeof failReason === 'string' ? failReason : undefined,
      };
    },
  };
}

// Провайдеры, чей вебхук НЕЛЬЗЯ принять по подписи. У ЮKassa уведомление
// приходит без подписи, и довериться присланному нельзя: подделка одного
// POST на публичном маршруте напечатала бы AZENS без оплаты. Такие провайдеры
// обрабатываются отдельным маршрутом, который переспрашивает API по
// идентификатору платежа. Их отсутствие здесь не ошибка, а защита.
export const UNSIGNED_PROVIDERS: readonly string[] = ['yookassa'];

// Реестр: имя из URL -> провайдер. Неизвестное имя = 404, деньги не двигаются.
export const PAYMENT_PROVIDERS: Record<string, PaymentProvider> = {
  default: hmacProvider('default', 'PAYMENT_WEBHOOK_SECRET'),
};
