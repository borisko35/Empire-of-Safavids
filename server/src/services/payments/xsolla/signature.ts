// ============================================================
// Подпись вебхука Xsolla — Empire of Safavids
// ============================================================
// Формат по документации Xsolla (Webhooks → Generation of signature):
//
//   Authorization: Signature <нижний регистр hex от SHA-1(сырое тело + секрет)>
//
// ТРИ ЛОВУШКИ, И ВСЕ ТРИ ВЫГЛЯДЯТ СНАРУЖИ ОДИНАКОВО — «секрет неверный».
// Половина сбоев интеграции приходится именно сюда, поэтому каждая
// проверяется отдельно, а не «в целом».
//
//  1. СЕКРЕТ ПРИКЛЕИВАЕТСЯ СПРАВА. Не слева и не вместо тела. Порядок
//     private+data+private из Epoint здесь не повторяется: здесь
//     data + secretKey, ровно один раз.
//  2. ЭТО SHA-1, А НЕ SHA-256, И ЭТО HEX, А НЕ BASE64. В проекте уже есть
//     HMAC-SHA256-hex (paymentProviders.ts) и base64 от SHA-1 (Epoint), так
//     что соблазн скопировать соседний код велик, и оба варианта выглядят
//     как настоящая подпись.
//  3. ПОДПИСЫВАЕТСЯ СЫРОЕ ТЕЛО. Если разобрать JSON и собрать заново, то
//     даже при тех же самых значениях тело получается другим: изменились
//     пробелы или порядок ключей. Подпись не сойдётся НАВСЕГДА, и перебором
//     вариантов это не лечится. Сырое тело у нас уже захвачено на входе:
//     express.json({ verify }) в server/src/index/index.ts пишет его в
//     req.rawBody. Пересериализовывать его нельзя нигде по дороге.
//
// Отдельно про сравнение: подпись — это проверка секрета, и обычное
// сравнение строк позволяет подбирать её по времени ответа. Сравниваем
// постоянного времени, длины обязаны совпасть заранее (timingSafeEqual
// бросает исключение на разной длине, а исключение вместо тихого «не
// совпало» — это уже отказ, а не проверка).

import { createHash, timingSafeEqual } from 'node:crypto';

const КОДИРОВКА = 'utf-8';

/** Слово-префикс в заголовке. Xsolla шлёт «Signature», регистр не гарантирован. */
const СЛОВО_ПРЕФИКСА = 'signature';

/** SHA-1 даёт 20 байт, то есть ровно 40 символов hex. */
const ДЛИНА_HEX = 40;

const ТОЛЬКО_HEX = /^[0-9a-f]+$/;

function must(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

/**
 * Строка, которую Xsolla просит подписать.
 *
 * Именно она, а не «тело плюс что-то ещё»: любая лишняя склейка даёт
 * подпись другой длины, и ошибка снаружи неотличима от неверного ключа.
 */
export function xsollaSignedPayload(rawBody: string, secretKey: string): string {
  must(typeof secretKey === 'string' && secretKey.length > 0, 'секретный ключ Xsolla пуст');
  must(typeof rawBody === 'string', 'сырое тело вебхука не строка');
  return rawBody + secretKey;
}

/**
 * Подпись: 40 символов hex в нижнем регистре.
 *
 * Именно hex, а не base64: пример в документации даёт
 * «52eac2713985e212351610d008e7e14fae46f902» — это 40 символов, и ни один
 * base64 от 20 байт на 40 символов не растягивается.
 */
export function xsollaSignature(rawBody: string, secretKey: string): string {
  const подписываемое = xsollaSignedPayload(rawBody, secretKey);
  return createHash('sha1').update(подписываемое, КОДИРОВКА).digest('hex');
}

/**
 * Достать подпись из заголовка Authorization.
 *
 * Возвращает null, а не частичную строку: подпись должна быть ровно
 * 40 hex-символов, и всё остальное — это не подпись. Отдельная проверка
 * длины нужна ещё и потому, что без неё сравнение постоянного времени
 * упало бы с исключением.
 */
export function parseXsollaSignatureHeader(header: string | null | undefined): string | null {
  if (typeof header !== 'string') return null;
  const обрезанный = header.trim();
  const пробел = обрезанный.indexOf(' ');
  if (пробел < 0) return null;
  if (обрезанный.slice(0, пробел).toLowerCase() !== СЛОВО_ПРЕФИКСА) return null;
  const hex = обрезанный.slice(пробел + 1).trim().toLowerCase();
  if (hex.length !== ДЛИНА_HEX) return null;
  if (!ТОЛЬКО_HEX.test(hex)) return null;
  return hex;
}

/**
 * Проверить подпись вебхука.
 *
 * Ничего не бросает: обработчик вебхука обязан ответить кодом, а не
 * исключением. Ответ 401 на поддельный запрос — правильный, и Xsolla его
 * не присылает, поэтому возврата игроку здесь не происходит.
 */
export function xsollaVerifySignature(
  rawBody: string,
  secretKey: string,
  header: string | null | undefined,
): boolean {
  const полученная = parseXsollaSignatureHeader(header);
  if (полученная === null) return false;
  if (typeof secretKey !== 'string' || secretKey.length === 0) return false;
  if (typeof rawBody !== 'string') return false;

  const ожидаемая = xsollaSignature(rawBody, secretKey);
  const a = Buffer.from(ожидаемая, КОДИРОВКА);
  const b = Buffer.from(полученная, КОДИРОВКА);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
