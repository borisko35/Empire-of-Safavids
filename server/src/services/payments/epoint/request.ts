// Сборка запросов к Epoint: data, подпись и тело для отправки.
//
// ЧТО ЗДЕСЬ ВАЖНО. Три поля (data, signature и подобные) - это base64, а в
// base64 есть символы '+', '/' и '='. При отправке как application/json они
// безопасны. При отправке как application/x-www-form-urlencoded символ '+'
// без кодирования читается получателем как ПРОБЕЛ, и подпись не сойдётся.
// В документе пример на странице 12 собирает тело через http_build_query -
// он кодирует значения правильно, а вот собранная руками строка
// 'data=...&signature=...' кодирует неправильно. Здесь тело всегда
// отдаётся объектом, а кодирование - дело вызывающего.
'use strict';
import { epointEncodeData, epointSignature } from './signature';

export const EPOINT_API = 'https://epoint.az/api/1';

export interface EpointConfig {
  publicKey: string;
  privateKey: string;
}

export interface EpointRequest {
  /** Подписанное тело запроса. */
  body: { data: string; signature: string };
  /** То же самое для form-POST, если провайдер потребует. */
  formFields: Record<string, string>;
}

export interface EpointPaymentRequest {
  amount: number;
  currency: 'AZN';
  orderId: string;
  description: string;
  language: 'ru' | 'en' | 'az';
  successRedirectUrl?: string;
  errorRedirectUrl?: string;
}

function must(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

/**
 * Провайдер настроен?
 *
 * Пустой public_key или private_key - это не «пока работает», а поломка:
 * подпись от пустого ключа считается, запрос уходит и отвергается, и по
 * сообщению непонятно, что не так. Отказ должен быть здесь.
 */
export function epointConfig(env: Record<string, string | undefined>): EpointConfig | null {
  const publicKey = (env.EPOINT_PUBLIC_KEY ?? '').trim();
  const privateKey = (env.EPOINT_PRIVATE_KEY ?? '').trim();
  const enabled = (env.EPOINT_ENABLED ?? '').toLowerCase() === 'true';
  if (!enabled) return null;
  must(publicKey.length > 0, 'EPOINT_ENABLED=true, но EPOINT_PUBLIC_KEY пуст');
  must(privateKey.length > 0, 'EPOINT_ENABLED=true, но EPOINT_PRIVATE_KEY пуст');
  return { publicKey, privateKey };
}

/**
 * Подписать набор полей.
 *
 * Порядок полей в JSON ЗНАЧИМ: подпись считается по строке, которую видит
 * Epoint, и любая перестановка ключей даёт другую подпись. Здесь порядок
 * задаётся явным списком, а не через JSON.stringify объекта: свойства,
 * добавленные позже, вставились бы в конец молча и сломали бы подпись.
 */
export function epointSignFields(
  config: EpointConfig,
  fields: Array<[string, unknown]>,
): EpointRequest {
  must(Array.isArray(fields) && fields.length > 0, 'полей для подписи нет');
  // undefined и null в подписываемом теле означали бы разные строки у нас и
  // у Epoint. Нет значения - нет и поля.
  const чистое: Record<string, unknown> = {};
  for (const [ключ, значение] of fields) {
    if (значение === undefined || значение === null) continue;
    must(typeof ключ === 'string' && ключ.length > 0, 'пустое имя поля');
    чистое[ключ] = значение;
  }
  const json = JSON.stringify(чистое);
  const data = epointEncodeData(json);
  const signature = epointSignature(config.privateKey, data);
  return {
    body: { data, signature },
    formFields: { data, signature },
  };
}

/** Сумма в том виде, в каком её ждёт Epoint: число с двумя знаками. */
export function epointAmount(amount: number): string {
  must(typeof amount === 'number' && Number.isFinite(amount), 'сумма не число');
  must(amount > 0, `сумма должна быть положительной, а не ${amount}`);
  // ПРОВЕРКА КОПЕЕК ЧЕРЕЗ СТРОКУ, А НЕ УМНОЖЕНИЕМ. Двоичное представление
  // не даёт 20.5 * 100 ровно 2050, а получается 2049.9999999999998, и
  // сравнение с округлённым значением отвергало корректную сумму. Сумма
  // 20.50 - совершенно обычная, и ошибка вылезла бы на первом же платеже
  // с копейками. Поэтому округляем до сотых и сравниваем строки: если
  // третий знак не нулевой - сумма не помещается, и это отказ, а не
  // молчаливое округление, при котором мы и провайдер посчитаем разное.
  const дваЗнака = amount.toFixed(2);
  const вКопейках = Math.round(Number(дваЗнака) * 100);
  must(
    Math.abs(Number(дваЗнака) * 100 - вКопейках) < 1e-6 && дваЗнака.length >= 3,
    `сумма ${amount} не помещается в копейки - у Epoint точность до сотых`,
  );
  // toFixed округляет, поэтому лишний знак виден только здесь: если в
  // исходном числе было больше двух знаков, оно не равно своему округлению.
  must(
    Math.abs(amount - Number(дваЗнака)) < 1e-9,
    `сумма ${amount} не помещается в копейки - у Epoint точность до сотых`,
  );
  return дваЗнака;
}

/** Тело для /request и /checkout. */
export function epointBuildPayment(
  config: EpointConfig,
  p: EpointPaymentRequest,
): EpointRequest {
  must(p.currency === 'AZN', `валюта ${p.currency} не поддерживается: у Epoint только AZN`);
  must(typeof p.orderId === 'string' && p.orderId.length > 0, 'order_id пуст');
  must(p.orderId.length <= 255, `order_id длиннее 255 символов: ${p.orderId.length}`);
  // Описание показывается плательщику. В нём не должно быть ничего, что
  // выглядело бы как наш служебный текст: игрок это видит.
  must(typeof p.description === 'string' && p.description.length > 0, 'описание пустое');
  must(p.description.length <= 1000, `описание длиннее 1000 символов: ${p.description.length}`);
  return epointSignFields(config, [
    ['public_key', config.publicKey],
    ['amount', epointAmount(p.amount)],
    ['currency', p.currency],
    ['order_id', p.orderId],
    ['description', p.description],
    ['language', p.language],
    ['success_redirect_url', p.successRedirectUrl],
    ['error_redirect_url', p.errorRedirectUrl],
  ]);
}

/** Тело для /get-status: там нужен номер операции, а не наш order_id. */
export function epointBuildStatusCheck(
  config: EpointConfig,
  transaction: string,
): EpointRequest {
  must(typeof transaction === 'string' && transaction.length > 0, 'transaction пуст');
  return epointSignFields(config, [
    ['public_key', config.publicKey],
    ['transaction', transaction],
  ]);
}

/**
 * Тело для /reverse - отмена операции, то есть возврат покупателю.
 *
 * ВАЖНО, ЧТОБЫ НЕ ПЕРЕПУТАТЬ. В Epoint есть /refund-request, и он НЕ
 * возврат: это выплата средств, перевод денег С нашего счёта НА карту.
 * Возврат покупателю делает /reverse. Перепутать их - значит вместо возврата
 * выплатить, то есть отдать деньги и не вернуть.
 */
export function epointBuildReverse(
  config: EpointConfig,
  transaction: string,
  amount?: number,
): EpointRequest {
  must(typeof transaction === 'string' && transaction.length > 0, 'transaction пуст');
  return epointSignFields(config, [
    ['public_key', config.publicKey],
    ['transaction', transaction],
    // amount необязателен: без него отменяется вся операция, с ним -
    // только указанная сумма (частичный возврат).
    ['amount', amount === undefined ? undefined : epointAmount(amount)],
    ['currency', 'AZN'],
  ]);
}
