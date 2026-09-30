// Подпись Epoint по документации от 10.10.2026.
//
// ЗАЧЕМ ЗДЕСЬ ВСЁ РАЗВЕДЕНО ПО ПЯТИ СТРОКАМ. Подпись считается по строке,
// которую формирует наш код, и любая из пяти строк ниже может быть сделана
// не так, как задумано, а снаружи это выглядит одинаково: «подпись неверна».
// Половина ошибок при интеграции - это здесь.
//
// ЧТО ПОДТВЕРЖДЕНО, А ЧТО НЕТ.
//  Подтверждено расшифровкой sgn_string из документа: приватный ключ стоит
//  С ОБЕИХ СТОРОН от data, то есть порядок именно private + data + private.
//  Подтверждено, что подпись - это base64 от 20 СЫРЫХ байт хеша: примеры
//  дают 28 символов, а base64 от 20 байт ровно 28 символов. В PHP в
//  документе стоит sha1($str, 1) - единица это как раз «сырые байты».
//  НЕ подтверждено: совпадение подписи с примером из документа. Примеры в
//  документе противоречат друг другу (см. docs/epoint-support-questions.md),
//  поэтому сверить их не на чем. Это ждёт ответа поддержки.
'use strict';
import { createHash, timingSafeEqual } from 'node:crypto';

const КОДИРОВКА_UTF8 = 'utf-8';

function must(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

/**
 * Строка, которую Epoint просит подписать.
 *
 * Порядок: приватный_ключ + data + приватный_ключ.
 */
export function epointSignatureString(privateKey: string, data: string): string {
  must(typeof privateKey === 'string' && privateKey.length > 0, 'приватный ключ пуст');
  must(typeof data === 'string' && data.length > 0, 'data пуста');
  return privateKey + data + privateKey;
}

/**
 * Подпись запроса: base64 от 20 сырых байт SHA-1.
 *
 * ЛОВУШКА, КОТОРАЯ ЗДЕСЬ ЖИВЁТ. SHA-1 возвращает 20 байт. Из них можно
 * сделать две разные строки: 20 сырых байт и 40 символов hex. Base64 от них
 * различается, и обе выглядят как «подпись». В документе в примере на
 * странице 41 стоит btoa(hash.toString(CryptoJS.enc.Latin1)) - enc.Latin1 в
 * CryptoJS это байтовая строка, то есть СЫРЫЕ байты. Верно то, что здесь.
 * Ошибка в одну сторону - взять hex и закодировать его - даёт подпись
 * другой длины и другой формы, и Epoint отвергает правильный по сути запрос.
 */
export function epointSignature(privateKey: string, data: string): string {
  const sgn = epointSignatureString(privateKey, data);
  return createHash('sha1').update(sgn, КОДИРОВКА_UTF8).digest('base64');
}

/**
 * data - это base64 от JSON-строки.
 *
 * ЛОВУШКА, КОТОРАЯ ЗДЕСЬ ЖИВЁТ, И ОНА БЬЁТ ПО НАШЕМУ ЯЗЫКУ. Кодек
 * обязан быть UTF-8. Описание платежа у нас русское («Empire of Safavids —
 * набор странника»), а в примере документа на странице 41 стоит
 * btoa(JSON.stringify(data)) - без указания кодировки. Такой вызов в браузере
 * на не-ASCII просто выбрасывает исключение, а подпись считается по этой же
 * строке, то есть запрос уходит «неверной подписью» и виноватым кажется
 * ключ. В Node latin1 молча портит символ - ещё хуже, потому что ошибка
 * незаметна.
 */
export function epointEncodeData(jsonString: string): string {
  must(typeof jsonString === 'string' && jsonString.length > 0, 'json_string пуст');
  return Buffer.from(jsonString, КОДИРОВКА_UTF8).toString('base64');
}

/**
 * Обратное действие: data -> json_string.
 *
 * Нужно для чтения ответа сервера: ответ приходит полем data, и прежде чем
 * искать в нём поля, его надо разобрать. Сверять надо именно с тем, что
 * пришло, а не с тем, что мы отправляли.
 */
export function epointDecodeData(data: string): unknown {
  must(typeof data === 'string' && data.length > 0, 'data пуст');
  const json = Buffer.from(data, 'base64').toString(КОДИРОВКА_UTF8);
  return JSON.parse(json);
}

/**
 * Подпись должна совпадать с полученной от Epoint.
 *
 * Сравнение постоянного времени: подпись - это проверка секрета, и обычное
 * сравнение строк позволяет подбирать её по времени ответа. Здесь строки
 * всегда одной длины (base64 от 20 байт), но проверка на длину остаётся:
 * timingSafeEqual бросает исключение на разной длине, и исключение вместо
 * тихого «не совпало» - это уже не отказ, а ошибка.
 */
export function epointVerifySignature(
  privateKey: string,
  data: string,
  received: string,
): boolean {
  if (typeof received !== 'string' || received.length === 0) return false;
  const expected = epointSignature(privateKey, data);
  const a = Buffer.from(expected, КОДИРОВКА_UTF8);
  const b = Buffer.from(received, КОДИРОВКА_UTF8);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
