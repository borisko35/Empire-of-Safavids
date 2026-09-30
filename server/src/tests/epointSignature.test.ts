// Подпись Epoint: три ловушки из документа проверяются здесь намеренно.
//
// ПОЧЕМУ ИМЕННО ЭТИ ТРИ. Каждая найдена в примерах документа и каждая
// выглядит снаружи одинаково: «подпись неверна, ключ плохой». На самом деле
// виноват код. Их и надо закрыть проверками заранее, пока нет живого стенда.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  epointSignature,
  epointSignatureString,
  epointEncodeData,
  epointDecodeData,
  epointVerifySignature,
} from '../services/payments/epoint/signature';

const КЛЮЧ = 'd3hjs138sd8kdfhbcea0be04eafde9e8e2bad2fb092d';
const JSON = '{"public_key":"i000000001","amount":"20.50","currency":"AZN","order_id":"1"}';

function must(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

describe('Подпись Epoint', () => {
  it('подписывает private + data + private: ключ с обеих сторон', () => {
    // Порядок подтверждён расшифровкой sgn_string из документа: одна и та же
    // строка ключа стоит слева и справа от data.
    const data = epointEncodeData(JSON);
    const sgn = epointSignatureString(КЛЮЧ, data);
    must(sgn.startsWith(КЛЮЧ), 'подписываемая строка начинается не с ключа');
    must(sgn.endsWith(КЛЮЧ), 'подписываемая строка не кончается ключом');
    must(sgn === КЛЮЧ + data + КЛЮЧ, 'порядок ключа и data нарушен');
    // Ключ должен встретиться РОВНО дважды. Если в коде появится склейка
    // ключа с самим собой или data уедет внутрь - здесь счёт разойдётся.
    const вхождений = sgn.split(КЛЮЧ).length - 1;
    must(вхождений === 2, `ключ встретился ${вхождений} раз, а не 2`);
  });

  it('подпись - это base64 от 20 сырых байт, а не от 40 символов hex', () => {
    const data = epointEncodeData(JSON);
    const наша = epointSignature(КЛЮЧ, data);

    // Правильный вариант: 20 байт.
    const отБайтов = createHash('sha1')
      .update(КЛЮЧ + data + КЛЮЧ, 'utf-8')
      .digest('base64');
    must(наша === отБайтов, 'подпись не равна base64 от сырых байт хеша');

    // Неправильный вариант, который выглядит как подпись: base64 от hex.
    const отHex = createHash('sha1')
      .update(КЛЮЧ + data + КЛЮЧ, 'utf-8')
      .digest('hex');
    const подписьОтHex = Buffer.from(отHex, 'latin1').toString('base64');
    must(
      наша !== подписьОтHex,
      'подпись не отличилась от base64 от hex-строки - значит сделан именно он',
    );
    must(наша.length === 28, `подпись длиной ${наша.length}, а base64 от 20 байт - 28 символов`);
  });

  it('data кодируется как UTF-8: русское описание не теряется', () => {
    // Описание платежа у нас русское. Пример документа на странице 41 делает
    // btoa(JSON.stringify(data)) без указания кодировки - на таком тексте
    // браузер выбрасывает исключение, а подпись считается по испорченной
    // строке, и Epoint отвечает «подпись неверна».
    const json = '{"public_key":"i000000001","amount":"20.50","currency":"AZN",'
      + '"description":"Empire of Safavids — набор странника","order_id":"1"}';
    const data = epointEncodeData(json);

    must(data === Buffer.from(json, 'utf-8').toString('base64'), 'data посчитана не в UTF-8');
    // Обратное действие обязано вернуть ровно то, что было.
    const обратно = epointDecodeData(data) as { description: string };
    must(обратно.description === 'Empire of Safavids — набор странника',
      `описание исказилось при кодировании: ${обратно.description}`);

    // А вот чем оборачивается latin1: длина строки уезжает, символ теряется.
    const какЛатин1 = Buffer.from(json, 'latin1').toString('base64');
    must(какЛатин1 !== data, 'latin1 и UTF-8 дали одно и то же - тест бессмыслен');
  });

  it('подпись не зависит от ключа, взятого из другого порядка склейки', () => {
    // Случайная ошибка: data + key + key вместо key + data + key. Подпись
    // получится другой длины и другой формы, то есть внешне неотличима от
    // «неверного ключа».
    const data = epointEncodeData(JSON);
    const правильно = epointSignature(КЛЮЧ, data);
    const перепутано = createHash('sha1')
      .update(data + КЛЮЧ + КЛЮЧ, 'utf-8')
      .digest('base64');
    must(правильно !== перепутано, 'порядок склейки ни на что не влияет - это ошибка');
  });

  it('проверка подписи принимает верную и отвергает чужую', () => {
    const data = epointEncodeData(JSON);
    const подпись = epointSignature(КЛЮЧ, data);
    must(epointVerifySignature(КЛЮЧ, data, подпись), 'своя подпись не принята');
    must(!epointVerifySignature(КЛЮЧ, data, подпись.slice(0, -1) + 'X'), 'чужая подпись принята');
    must(!epointVerifySignature(КЛЮЧ, data, ''), 'пустая подпись принята');
    must(!epointVerifySignature(КЛЮЧ, data, undefined as unknown as string), 'отсутствующая подпись принята');
    // Ключ другой, подпись от нашего ключа - должна отвергаться.
    must(
      !epointVerifySignature(КЛЮЧ + '0', data, подпись),
      'подпись принята по чужому ключу',
    );
  });

  it('подпись сверяется за постоянное время, а не обычным сравнением', () => {
    // ПОЧЕМУ ПРОВЕРКА СМОТРИТ В КОД, А НЕ В ПОВЕДЕНИЕ. Для верной подписи
    // `===` и timingSafeEqual дают одно и то же - проверить разницу поведением
    // нельзя в принципе. А разница есть: подпись это проверка секрета, и
    // обычное сравнение строк позволяет подбирать её по времени ответа.
    // Раньше поломка этого места роняла компиляцию (неиспользуемый импорт
    // даёт ошибку типа), а не тест: падение выглядело «проверка сработала»,
    // но падало не то. Поэтому здесь честная проверка исходника.
    const исходник = readFileSync(join(__dirname, '..', 'services', 'payments', 'epoint', 'signature.ts'), 'utf-8');
    const тело = исходник.slice(исходник.indexOf('export function epointVerifySignature'));
    // ВСЕ return'ы, а не первый. Первый в этой функции - ранний отказ
    // `return false`, и проверка на него смотрела бы мимо сравнения целиком.
    const возвраты = [...тело.matchAll(/return\s+([^;]+);/g)].map(m => m[1].trim());
    must(возвраты.length > 0, 'в epointVerifySignature нет ни одного return - функция ничего не возвращает');
    const итоговый = возвраты[возвраты.length - 1];
    must(
      /timingSafeEqual/.test(итоговый),
      `подпись сравнивается не через timingSafeEqual, а так: ${итоговый}`,
    );
    // Длина строк проверяется ДО сравнения: timingSafeEqual бросает исключение
    // на разной длине, и исключение вместо тихого отказа - это уже сбой.
    must(
      /a\.length\s*!==\s*b\.length[\s\S]*?return false/.test(исходник),
      'нет проверки длин перед сравнением - подпись другой длины уронит функцию',
    );
  });

  it('пустые аргументы приводят к отказу, а не к подписи из undefined', () => {
    // Если бы ключ был пуст, молча подписалось бы строка "undefined"+"data"+
    // "undefined" - выглядело бы как настоящая подпись, а отвергалось бы
    // всегда, с непонятной ошибкой.
    let отказ = false;
    try { epointSignature('', epointEncodeData(JSON)); } catch { отказ = true; }
    must(отказ, 'пустой ключ не привёл к отказу');

    отказ = false;
    try { epointSignature(КЛЮЧ, ''); } catch { отказ = true; }
    must(отказ, 'пустая data не привела к отказу');
  });
});
