// ============================================================
// Xsolla: разбор вебхуков — Empire of Safavids
// ============================================================
// ВИТРИНА И КАРТЫ ПЛАТЕЖЕЙ ЭТО НЕ ОДНО И ТО ЖЕ, И ПУТАТЬ НЕЛЬЗЯ.
//   user_validation — Xsolla спрашивает, существует ли игрок. Обязателен.
//   order_paid      — заказ оплачен, приходят данные о товаре и деньгах.
//   order_canceled  — заказ отменён, товар надо снять.
//
// АККАУНТ ЗАРЕГИСТРИРОВАН ПОСЛЕ 22 ЯНВАРЯ 2025, поэтому вебхуки объединённые:
// отдельного notification_type «payment» приходить не будет.
//
// ─────────────────────────────────────────────────────────────
// ЦЕНТРАЛЬНОЕ ПРАВИЛО XSOLLA, РАДИ КОТОРОГО ЗДЕСЬ ВСЁ. Если на вебхук
// ответить 4xx, либо не ответить вовсе за все попытки, либо ответить 5xx —
// ПЛАТЁЖ ВОЗВРАЩАЮТСЯ ПОКУПАТЕЛЮ. Не «отклоняется», а именно возвращается:
// деньги уходят обратно, начисления не происходит. Отсюда правило, которое
// легко нарушить по незнанию: на настоящий платёж отвечаем только 2xx, а
// сомнение выражаем через очередь и повтор, а не через код ответа.
//
// Повторы: 2 попытки через 5 минут, 7 через 15 минут, 10 через 60 минут —
// всего 20 попыток за 12 часов. Много, но не бесконечно: «потом разберёмся»
// здесь означает «игрок получит возврат».
//
// ОТДЕЛЬНО ПРО user_validation. Этот вебхук Xsolla НЕ повторяет: ни на 400,
// ни на 5xx. Игрок увидит ошибку оплаты, а следующие вебхуки не придут.
// Значит отвечать надо быстро (1–3 секунды) и окончательно.
//
// ─────────────────────────────────────────────────────────────
// ЧЕТЫРЕ ЛОВУШКИ В САМОМ ТЕЛЕ. Все четыре выглядят снаружи одинаково —
// «заказ не найден», а на деле виновата структура, а не провайдер:
//
//  1. items лежит НА ВЕРХНЕМ УРОВНЕ тела, а не внутри order. Искать
//     order.items — обычная ошибка, и товар «теряется» при оплаченном заказе.
//  2. order.amount — это ВИРТУАЛЬНАЯ валюта, в примере документа
//     currency_type = "virtual", currency = "sku_currency". Настоящие
//     деньги лежат в billing.purchase.total. Сверять наш счёт в рублях с
//     order.amount нельзя: расхождение всегда, и проверка отвергнет верный
//     платёж.
//  3. В order_paid игрок приходит как user.external_id, а НЕ user.id.
//     В user_validation — наоборот, как user.id. Перепутать нельзя, и это
//     ровно тот случай, который ловят словами «не тот вебхук».
//  4. user.id в user_validation в примере документа — ЧИСЛО (1234567), а не
//     строка. Наш идентификатор — UUID, то есть строка. Строгая проверка
//     «typeof === 'string'» отбросила бы нормальный вебхук.
//
// ─────────────────────────────────────────────────────────────
// ЧЕСТНО О НЕЯСНОСТИ, КОТОРУЮ НЕЛЬЗЯ ЗАБЫТЬ. Где именно в order_paid
// возвращается наш paymentId, подписанный как settings.external_id, из
// документа однозначно не следует: transaction.external_id в примере
// числовой, а наш paymentId — UUID. Поэтому paymentId ищется в нескольких
// местах по очереди, и берётся ТОЛЬКО то, что похоже на наш UUID. Если не
// нашлось ни одного — начислять нельзя, и это осознанный отказ: лучше
// повтор и в итоге возврат покупателю, чем напечатать азены не тому заказу.
// Проверяется в песочнице до подписания договора.

export type XsollaNotificationType =
  | 'user_validation'
  | 'order_paid'
  | 'order_canceled'
  | 'user_search'
  | 'unknown';

export interface XsollaUser {
  /** Наш users.id как строка — независимо от того, прислали его числом или строкой. */
  id: string;
}

export interface XsollaItem {
  sku: string;
  /** Сколько единиц куплено: у набора азенов это количество самих азенов. */
  quantity: number;
}

export interface XsollaOrder {
  /** Наш paymentId. null — в теле его нет, начислять нельзя. */
  paymentId: string | null;
  /** Идентификатор транзакции Xsolla: ключ дедупликации. */
  transactionId: string | null;
  /** Идентификатор игрока, как его вернула Xsolla. */
  userId: string | null;
  /** Сумма НАСТОЯЩИХ денег строкой, из billing.purchase.total. */
  amount: string | null;
  /** Валюта настоящих денег. */
  currency: string | null;
  items: XsollaItem[];
}

/** Наш paymentId — UUID. Всё, что не UUID, нашим идентификатором не является. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function запись(значение: unknown): Record<string, unknown> | null {
  return typeof значение === 'object' && значение !== null && !Array.isArray(значение)
    ? (значение as Record<string, unknown>)
    : null;
}

/**
 * Идентификатор приходит то числом, то строкой.
 *
 * В примере user_validation user.id — число 1234567, а в order_paid
 * user.external_id — строка. Наш UUID всегда строка, поэтому приводим явно
 * и не теряем ни один из двух случаев.
 */
function идентификатор(значение: unknown): string | null {
  if (typeof значение === 'string') {
    const обрезанный = значение.trim();
    return обрезанный.length > 0 ? обрезанный : null;
  }
  if (typeof значение === 'number' && Number.isFinite(значение)) return String(значение);
  return null;
}

/**
 * Тип уведомления.
 *
 * 'unknown', а не null: незнакомый тип Xsolla присылает законно, и на него
 * надо ответить 2xx. Отвечать 4xx на незнакомое нельзя — по правилу выше
 * это возврат денег покупателю.
 */
export function xsollaNotificationType(body: unknown): XsollaNotificationType {
  const корень = запись(body);
  if (корень === null) return 'unknown';
  const тип = идентификатор(корень.notification_type);
  if (тип === 'user_validation') return 'user_validation';
  if (тип === 'order_paid') return 'order_paid';
  if (тип === 'order_canceled') return 'order_canceled';
  if (тип === 'user_search') return 'user_search';
  return 'unknown';
}

/**
 * Игрок из user_validation.
 *
 * Именно user.id — в отличие от order_paid, где это user.external_id.
 * null означает, что отвечать нечем: подтвердить игрока нельзя, и Xsolla
 * ждёт 400 с кодом INVALID_USER.
 */
export function parseXsollaUser(body: unknown): XsollaUser | null {
  const корень = запись(body);
  if (корень === null) return null;
  const пользователь = запись(корень.user);
  if (пользователь === null) return null;
  const id = идентификатор(пользователь.id);
  if (id === null) return null;
  return { id };
}

/** Товары заказа: массив items на верхнем уровне тела. */
function разобратьТовары(корень: Record<string, unknown>): XsollaItem[] {
  const сырой = корень.items;
  if (!Array.isArray(сырой)) return [];
  const товары: XsollaItem[] = [];
  for (const элемент of сырой) {
    const позиция = запись(элемент);
    if (позиция === null) continue;
    const sku = идентификатор(позиция.sku);
    const количество = позиция.quantity;
    if (sku === null) continue;
    if (typeof количество !== 'number' || !Number.isFinite(количество) || количество <= 0) continue;
    товары.push({ sku, quantity: количество });
  }
  return товары;
}

/**
 * Наш paymentId в теле order_paid.
 *
 * Перебираются места, которые документация называет ссылкой на сторону
 * игры, и берётся ТОЛЬКО значение вида нашего UUID. Проверка по форме здесь
 * не перестраховка, а главная защита: любое другое поле может содержать
 * число, и подставить его вместо нашего идентификатора значило бы начислить
 * азены чужому заказу.
 */
function найтиPaymentId(заказ: Record<string, unknown>, billing: Record<string, unknown> | null): string | null {
  const транзакция = billing === null ? null : запись(billing.transaction);
  const кандидаты: unknown[] = [
    заказ.invoice_id,
    заказ.external_id,
    транзакция === null ? undefined : транзакция.external_id,
  ];
  for (const кандидат of кандидаты) {
    const значение = идентификатор(кандидат);
    if (значение !== null && UUID.test(значение)) return значение.toLowerCase();
  }
  return null;
}

/** Настоящие деньги: billing.purchase.total. Не order.amount — это виртуальная валюта. */
function настоящиеДеньги(billing: Record<string, unknown> | null): { amount: string | null; currency: string | null } {
  if (billing === null) return { amount: null, currency: null };
  const покупка = запись(billing.purchase);
  if (покупка === null) return { amount: null, currency: null };
  const итог = запись(покупка.total);
  if (итог === null) return { amount: null, currency: null };
  const сумма = суммаСтрокой(итог.amount);
  const валюта = идентификатор(итог.currency);
  return {
    amount: сумма,
    currency: валюта === null ? null : валюта.toUpperCase(),
  };
}

/**
 * Заказ из order_paid / order_canceled.
 *
 * Идентификатор транзакции нужен для дедупликации: Xsolla присылает
 * вебхук до двадцати раз, и начислять надо один.
 */
export function parseXsollaOrder(body: unknown): XsollaOrder | null {
  const корень = запись(body);
  if (корень === null) return null;
  const заказ = запись(корень.order);
  if (заказ === null) return null;

  const billing = запись(корень.billing);
  const транзакция = billing === null ? null : запись(billing.transaction);
  const пользователь = запись(корень.user);

  const transactionId = идентификатор(транзакция?.id) ?? идентификатор(заказ.id);
  // В order_paid игрок приходит как user.external_id, а не user.id.
  const userId = идентификатор(пользователь?.external_id);
  const деньги = настоящиеДеньги(billing);

  return {
    paymentId: найтиPaymentId(заказ, billing),
    transactionId,
    userId,
    amount: деньги.amount,
    currency: деньги.currency,
    items: разобратьТовары(корень),
  };
}

/**
 * Сумма строкой, без промежуточного float.
 *
 * Приводить сумму числом нельзя. JSON отдаёт 20.5, и 20.5 * 100 в IEEE 754
 * даёт 2049.9999999999998 — на единицу меньше верного. На такой сумме
 * проверка «сколько заплатили» отвергает корректный платёж, и деньги
 * уходят игроку насовсем. Строка разбирается по цифрам, без вещественной
 * арифметики.
 */
export function суммаСтрокой(значение: unknown): string | null {
  if (typeof значение === 'number') {
    if (!Number.isFinite(значение)) return null;
    return String(значение);
  }
  if (typeof значение !== 'string') return null;
  const обрезанное = значение.trim();
  if (!/^-?\d+(\.\d+)?$/.test(обрезанное)) return null;
  return обрезанное;
}

/** Сколько знаков после запятой у валюты. У иен и вон — ноль. */
export function знаковВВалюте(валюта: string | null): number {
  if (валюта === null) return 2;
  const код = валюта.trim().toUpperCase();
  if (код === 'JPY' || код === 'KRW') return 0;
  return 2;
}

/**
 * Сумма в минорных единицах (копейках).
 *
 * null, если знаков после запятой больше, чем валюта содержит. Молча
 * округлять нельзя: округление на копейку — это либо недоплата игроку, либо
 * лишний расход. Пусть платёж уйдёт на сверку, чем начисление разойдётся
 * с фактом тихо.
 */
export function вМинорныеЕдиницы(сумма: string, знаков: number = 2): number | null {
  if (typeof сумма !== 'string') return null;
  const совпадение = /^(-?)(\d+)(?:\.(\d+))?$/.exec(сумма.trim());
  if (совпадение === null) return null;
  const знак = совпадение[1] === '-' ? -1 : 1;
  const целая = совпадение[2];
  const дробная = совпадение[3] ?? '';
  if (дробная.length > знаков) return null;
  const дополненная = дробная.padEnd(знаков, '0');
  const итог = Number(целая) * Math.pow(10, знаков) + (дополненная === '' ? 0 : Number(дополненная));
  if (!Number.isSafeInteger(итог)) return null;
  return знак * итог;
}

/**
 * Коды валют по ISO 4217, которые Xsolla присылает в вебхуке.
 *
 * ПОЧЕМУ ТАБЛИЦА, А НЕ ПРИВЕДЕНИЕ К ВЕРХНЕМУ РЕГИСТРУ. Внутренние коды
 * игры и коды Xsolla совпадают не у всех валют. Наш `man` - это
 * азербайджанский манат, а Xsolla присылает `AZN`. Простое
 * 'man'.toUpperCase() дало бы 'MAN', сверка не сошлась бы, и верный платёж
 * был бы отвергнут: Xsolla на 4xx возвращает покупателю деньги. То есть
 * ошибка в этой строке стоила бы реальных денег, а не неудобства.
 *
 * Тот же случай с другой стороны: MNT - это монгольский тёгрёг, другой
 * код, и перепутать их легко. Таблица сделана явной именно поэтому.
 */
const ISO_КОД: Record<string, string> = {
  rub: 'RUB',
  man: 'AZN',
  uah: 'UAH',
  usd: 'USD',
  eur: 'EUR',
};

/**
 * Код валюты по ISO для сверки с Xsolla.
 *
 * null, если валюта незнакома: сравнивать с чем-то наугад нельзя, иначе
 * незнакомая валюта молча совпадёт с первой подходящей.
 */
export function isoКод(realCurrency: string | null | undefined): string | null {
  if (typeof realCurrency !== 'string') return null;
  const ключ = realCurrency.trim().toLowerCase();
  const код = ISO_КОД[ключ];
  return код === undefined ? null : код;
}

/**
 * Совпала ли сумма платежа с нашей записью.
 *
 * Смысл проверки — не перестраховка, а конкретная беда, названная в
 * token.ts: цена набора живёт и в economy.ts, и в каталоге Xsolla.
 * Разошлись — игрок заплатил не столько, сколько обещали.
 *
 * Решение по итогу принимает маршрут: начислять надо по НАШЕЙ записи, ведь
 * это то, что мы обещали, а расхождение — громко записать в лог.
 */
export function суммаСовпадает(
  заказ: XsollaOrder,
  ожидаемаяМинорная: number,
  ожидаемаяВалюта: string,
): boolean {
  if (заказ.amount === null) return false;
  // Валюта приводится к ISO, а не к верхнему регистру: у нас `man`, а
  // Xsolla присылает `AZN`. Неизвестная валюта - отказ, а не догадка.
  const нашаВалюта = isoКод(ожидаемаяВалюта);
  if (нашаВалюта === null) return false;
  if (заказ.currency === null) return false;
  // Валюты обязаны совпадать: 100 KZT и 100 RUB — разные деньги, и начислить
  // азены за одну вместо другой нельзя.
  if (заказ.currency !== нашаВалюта) return false;
  const знаков = знаковВВалюте(заказ.currency);
  const минорная = вМинорныеЕдиницы(заказ.amount, знаков);
  if (минорная === null) return false;
  return минорная === ожидаемаяМинорная;
}
