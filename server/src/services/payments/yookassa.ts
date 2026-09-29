// ============================================================
// ЮKassa — приём платежей — Empire of Safavids
// ============================================================
//
// ПОЧЕМУ ЗДЕСЬ НЕ ПРОВЕРЯЕТСЯ ПОДПИСЬ. Остальные провайдеры в проекте
// подписывают вебхук (HMAC), и его можно проверить локально. У ЮKassa так
// нет: уведомление приходит без подписи, и проверить его «по-хорошему» нечем.
// Если принять как есть, любой желающий сможет отправить POST на наш вебхук с
// телом { event: 'payment.succeeded' } и напечатать себе AZENS без оплаты.
// Это не теоретическая дыра: адрес вебхука проваидер показывает в личном
// кабинете, а наш маршрут публичен.
//
// ПОЭТОМУ СХЕМА ДРУГАЯ. Из уведомления берётся ТОЛЬКО идентификатор платежа
// на стороне ЮKassa. Дальше сервер сам спрашивает у API, каким платёж
// на самом деле стал: pending, succeeded или canceled. Деньги начисляются по
// ответу API, а не по тому, что прислали снаружи. Отправить поддельное
// уведомление бесполезно — платежа с таким id у ЮKassa просто нет.
//
// ЧТО НУЖНО ОТ ВЛАДЕЛЬЦА (три значения, всё остальное уже написано):
//   PAYMENT_JOBIK_SHOP_ID  — идентификатор магазина в личном кабинете
//   PAYMENT_JOBIK_SECRET  — секретный ключ API
//   PAYMENT_JOBIK_ENABLED — 'true', когда аккаунт открыт и ключи вписаны
// Без ИП или ООО в России личный кабинет ЮKassa не откроют, поэтому
// значения появляются только после регистрации.

import type { ParsedPaymentEvent, PaymentProvider } from '../paymentProviders';

const API_BASE = 'https://api.yookassa.ru/v3';

/** Статус платежа по данным ЮKassa. Не совпадает с нашими completed/failed. */
export type YooKassaStatus = 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';

export interface YooKassaPayment {
  id: string;
  status: YooKassaStatus;
  paid?: boolean;
  amount?: { value: string; currency: string };
  confirmation?: { type: string; confirmation_url?: string; return_url?: string };
}

/**
 * Ключи из окружения.
 *
 * Возвращает null, если провайдер выключен или ключей нет. Это не ошибка, а
 * штатное состояние: без ключей маршрут отвечает «провайдер не настроен», а не
 * «500», и сайт продолжает работать.
 */
export function yookassaConfig(env: NodeJS.ProcessEnv = process.env): { shopId: string; secret: string } | null {
  if (env.PAYMENT_JOBIK_ENABLED !== 'true') return null;
  const shopId = env.PAYMENT_JOBIK_SHOP_ID;
  const secret = env.PAYMENT_JOBIK_SECRET;
  if (!shopId || !secret) return null;
  return { shopId, secret };
}

export function isYooKassaEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return yookassaConfig(env) !== null;
}

function authHeader(shopId: string, secret: string): string {
  return 'Basic ' + Buffer.from(`${shopId}:${secret}`, 'utf8').toString('base64');
}

interface YooKassaCreateInput {
  /** Наш paymentId: возвращается в metadata и в return_url. */
  paymentId: string;
  amount: string;
  currency: string;
  description: string;
  returnUrl: string;
  confirmUrl: string;
  idempotenceKey: string;
}

/**
 * Создать платёж у ЮKassa.
 *
 * Idempotence-Key обязателен: без него повторный клик по «купить» создал бы
 * второй счёт, и игрок увидел бы два. С тем же ключом ЮKassa вернёт тот же
 * счёт, поэтому двойного списания не будет даже при плохой сети.
 */
export async function createYooKassaPayment(
  input: YooKassaCreateInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<YooKassaPayment> {
  const cfg = yookassaConfig(env);
  if (!cfg) throw new Error('yookassa_not_configured');

  const res = await fetch(`${API_BASE}/payments`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(cfg.shopId, cfg.secret),
      'Content-Type': 'application/json',
      'Idempotence-Key': input.idempotenceKey,
    },
    body: JSON.stringify({
      amount: { value: input.amount, currency: input.currency },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: input.returnUrl,
        confirmation_url: input.confirmUrl,
      },
      description: input.description.slice(0, 128),
      metadata: { payment_id: input.paymentId },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    // Тело ошибки ЮKassa полезно при настройке и не должно утекать игроку.
    // В лог — первые 300 символов, в ответ клиенту — ничего.
    throw new Error(`yookassa_create_failed_${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as YooKassaPayment;
}

/**
 * Спросить у ЮKassa, каким стал платёж.
 *
 * Единственный источник правды. Ответ вебхука сюда не попадает: он может
 * прийти от кого угодно.
 */
export async function fetchYooKassaPayment(
  paymentId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<YooKassaPayment> {
  const cfg = yookassaConfig(env);
  if (!cfg) throw new Error('yookassa_not_configured');

  const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
    headers: { Authorization: authHeader(cfg.shopId, cfg.secret) },
  });
  if (res.status === 404) throw new Error('yookassa_payment_not_found');
  const text = await res.text();
  if (!res.ok) throw new Error(`yookassa_fetch_failed_${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as YooKassaPayment;
}

/** Перевод статуса ЮKassa в наш контракт. null — платёж ещё не решён. */
export function yookassaStatusToEvent(payment: YooKassaPayment, paymentId: string): ParsedPaymentEvent | null {
  if (!payment?.id) return null;
  const base = { paymentId, providerPaymentId: payment.id };
  if (payment.status === 'succeeded' && payment.paid === true) {
    return { ...base, kind: 'completed' };
  }
  if (payment.status === 'canceled') {
    return { ...base, kind: 'failed', failReason: 'canceled' };
  }
  return null;
}

/**
 * Провайдер для реестра.
 *
 * verifySignature у ЮKassa всегда истинна, и это НЕ дыра: подписи у неё
 * нет, а настоящая проверка происходит в fetchYooKassaPayment по
 * идентификатору. Ставим true, чтобы существующий контракт
 * PaymentProvider не пришлось переписывать, и подписываем это решение
 * отдельно — иначе «подпись не проверяется» выглядело бы как забытый код.
 */
export const yookassaProvider: PaymentProvider = {
  name: 'yookassa',
  verifySignature(): boolean {
    return true;
  },
  parseEvent(): ParsedPaymentEvent | null {
    // Разбор тела здесь невозможен в принципе: доверять присланному нельзя.
    // Маршрут вебхука для ЮKassa вынесен в отдельный обработчик, который
    // переспрашивает API.
    return null;
  },
};

// ============================================================
// Решение по уведомлению — вынесено отдельно и проверяется само
// ============================================================
// Всё безопасное живёт здесь, а не в маршруте: маршрут превращает результат в
// HTTP-ответ и ничего не решает сам. Причина практическая — правило «начислить
// только по ответу API» обязано проверяться настоящим запуском, а поиском по
// тексту маршрута. Поиск нашёл бы строку и успокоился бы даже на перевёрнутом
// условии.

export type YooKassaAction = 'credit' | 'reject' | 'retry' | 'ignore';

export interface YooKassaNotificationResult {
  action: YooKassaAction;
  /** Причина — уходит в лог и в тело ответа. Игроку не показывается. */
  reason: string;
  event?: ParsedPaymentEvent;
  /** Статус по данным API: нужен, чтобы отличить «ждём» от «отказа». */
  remoteStatus?: string;
  paymentId?: string;
  providerPaymentId?: string;
}

/**
 * Что делать с уведомлением.
 *
 * body — присланное тело, источнику доверия не подлежит. lookup спрашивает
 * API провайдера. findPaymentId ищет нашу запись, если в метаданных её нет.
 *
 * Порядок проверок не переставляется: сначала идентификатор из тела, потом
 * ответ API, и только потом решение. Перестановка означала бы, что тело
 * уведомления снова стало бы источником правды.
 */
export async function resolveYooKassaNotification(
  body: unknown,
  lookup: (providerPaymentId: string) => Promise<YooKassaPayment | null>,
  findPaymentId: (providerPaymentId: string) => Promise<string | null>
): Promise<YooKassaNotificationResult> {
  const providerPaymentId = extractProviderPaymentId(body);
  if (!providerPaymentId) return { action: 'reject', reason: 'no_payment_id_in_body' };

  // Наш paymentId из метаданных — только для поиска записи, не для решения.
  let paymentId = extractMetadataPaymentId(body);
  if (!paymentId) {
    try {
      paymentId = await findPaymentId(providerPaymentId);
    } catch (err) {
      return { action: 'retry', reason: `payment_lookup_failed: ${(err as Error).message}` };
    }
    if (!paymentId) return { action: 'reject', reason: 'payment_not_found' };
  }

  let remote: YooKassaPayment | null;
  try {
    remote = await lookup(providerPaymentId);
  } catch (err) {
    // Сеть или сбой API. Ответ «повтори» заставит ЮKassa прислать уведомление
    // снова, и деньги доедут при следующей попытке. Молчать здесь нельзя:
    // платёж есть, а начислить его не вышло — тишина станет потерей денег.
    return { action: 'retry', reason: `provider_unreachable: ${(err as Error).message}` };
  }
  if (!remote) return { action: 'reject', reason: 'provider_payment_not_found' };

  const event = yookassaStatusToEvent(remote, paymentId);
  if (!event) {
    // Платёж ещё не решён. Это не отказ: начислять нечего, и начисление
    // придёт со следующим уведомлением.
    return { action: 'ignore', reason: 'not_paid_yet', remoteStatus: remote.status, paymentId, providerPaymentId };
  }
  return { action: 'credit', reason: 'verified_by_api', event, remoteStatus: remote.status, paymentId, providerPaymentId };
}

/**
 * Идентификатор платежа из тела уведомления.
 *
 * Терпимо к форме, строго к содержимому: берётся только строка разумной
 * длины. Дальше она идёт в запрос к API, а не в начисление, поэтому даже
 * выдуманное значение безопасно — оно просто не найдётся.
 */
export function extractProviderPaymentId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as { id?: unknown; object?: { id?: unknown } };
  const raw = b.object?.id ?? b.id;
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  if (!id || id.length > 64) return null;
  return id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Наш paymentId из метаданных платежа.
 *
 * Поле добавлено нами при создании счёта. Отсутствие не считается ошибкой:
 * ЮKassa не гарантирует доставку метаданных в уведомление, и тогда запись
 * ищется по референсу провайдера.
 *
 * Проверка формы обязательна: в это поле идёт наш сгенерированный
 * идентификатор, и подставленная строка должна отсеяться здесь, а не уйти в
 * запрос к таблице по произвольному значению.
 */
export function extractMetadataPaymentId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as { object?: { metadata?: { payment_id?: unknown } } };
  const raw = b.object?.metadata?.payment_id;
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return UUID_RE.test(id) ? id : null;
}
