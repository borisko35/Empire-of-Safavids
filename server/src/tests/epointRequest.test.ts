// Сборка запросов к Epoint. Здесь закрыты три ловушки, которые нашлись при
// чтении документа: кодировка описания, разница между выплатой и возвратом,
// и молчаливая подмена порядка полей.
import { createHash } from 'node:crypto';
import {
  epointConfig,
  epointSignFields,
  epointAmount,
  epointBuildPayment,
  epointBuildStatusCheck,
  epointBuildReverse,
  EPOINT_API,
} from '../services/payments/epoint/request';
import { epointDecodeData } from '../services/payments/epoint/signature';

const КЛЮЧ = { publicKey: 'i000000001', privateKey: 'd3hjs138sd8kdfhbcea0be04eafde9e8e2bad2fb092d' };

function must(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

describe('Запросы к Epoint собираются правильно', () => {
  it('тело подписано тем же ключом, которым закодировано', () => {
    const r = epointBuildPayment(КЛЮЧ, {
      amount: 20.5,
      currency: 'AZN',
      orderId: 'наш-1',
      description: 'Empire of Safavids',
      language: 'ru',
    });
    // Подпись обязана совпадать с data, а не с исходным JSON: подписывается
    // именно закодированная строка.
    const ожидание = createHash('sha1')
      .update(КЛЮЧ.privateKey + r.body.data + КЛЮЧ.privateKey, 'utf-8')
      .digest('base64');
    must(r.body.signature === ожидание, 'подпись не соответствует отправленным данным');
    must(r.formFields.data === r.body.data, 'form-поля расходятся с телом');
  });

  it('описание с русским текстом кодируется в UTF-8 и переживает подпись', () => {
    // Пример в документе кодирует через btoa без указания кодировки - на
    // русском описании это либо исключение, либо порча символа. И то и
    // другое ломает подпись, а снаружи выглядит как «неверный ключ».
    const r = epointBuildPayment(КЛЮЧ, {
      amount: 20.5,
      currency: 'AZN',
      orderId: 'наш-1',
      description: 'Набор странника — 250 AZENS',
      language: 'ru',
    });
    const разобранное = epointDecodeData(r.body.data) as { description: string };
    must(
      разобранное.description === 'Набор странника — 250 AZENS',
      `описание исказилось: ${разобранное.description}`,
    );
  });

  it('сумма уходит двумя знаками, лишние отбрасываются', () => {
    must(epointAmount(20.5) === '20.50', '20.5 не стал 20.50');
    must(epointAmount(20) === '20.00', 'целое не стало 20.00');
    must(epointAmount(12.99) === '12.99', 'копейки потерялись');
    // Третий знак после запятой - отказ, а не тихое округление: игрок
    // заплатит 20.501, а провайдер возьмёт 20.50, и суммы разойдутся.
    let отказ = false;
    try { epointAmount(20.501); } catch { отказ = true; }
    must(отказ, 'третий знак принят молча - сумма округлится по-разному у нас и у Epoint');
    let нуль = false;
    try { epointAmount(0); } catch { нуль = true; }
    must(нуль, 'нулевая сумма принята');
  });

  it('только AZN: чужая валюта приводит к отказу', () => {
    for (const валюта of ['RUB', 'USD', 'AZn', 'man']) {
      let отказ = false;
      try {
        epointBuildPayment(КЛЮЧ, {
          amount: 100, currency: валюта as 'AZN', orderId: '1', description: 'd', language: 'ru',
        });
      } catch { отказ = true; }
      must(отказ, `валюта ${валюта} прошла: у Epoint только AZN, и ошибка всплыла бы на боевом платеже`);
    }
  });

  it('отсутствующие поля не попадают в подписываемое тело', () => {
    // null в JSON.stringify даёт «null», а у Epoint поле будет отсутствовать.
    // Подписи разойдутся, и запрос отвергнут как «неверная подпись».
    const r = epointSignFields(КЛЮЧ, [
      ['public_key', 'i1'],
      ['amount', '20.50'],
      ['success_redirect_url', undefined],
      ['error_redirect_url', null],
    ]);
    const разобранное = epointDecodeData(r.body.data) as Record<string, unknown>;
    must(!('success_redirect_url' in разобранное), 'undefined попал в тело');
    must(!('error_redirect_url' in разобранное), 'null попал в тело');
    must(Object.keys(разобранное).length === 2, `в теле лишние поля: ${Object.keys(разобранное).join(', ')}`);
  });

  it('порядок полей в подписи задан явно, а не получился случайно', () => {
    // Перестановка полей даёт другую подпись при той же по смыслу сути.
    // Здесь порядок задан списком, поэтому добавление поля в объект
    // не сдвинет подпись молча.
    const a = epointSignFields(КЛЮЧ, [['public_key', 'i1'], ['amount', '20.50']]);
    const b = epointSignFields(КЛЮЧ, [['amount', '20.50'], ['public_key', 'i1']]);
    must(a.body.signature !== b.body.signature, 'порядок полей ни на что не влияет - это ошибка');
    must(
      epointDecodeData(a.body.data) !== undefined && epointDecodeData(b.body.data) !== undefined,
      'оба тела должны разбираться',
    );
  });

  it('возврат покупателю строится через transaction, а не через выплату', () => {
    // В Epoint есть /refund-request, и это НЕ возврат: выплата средств с
    // нашего счёта на карту. Наш маршрут возврата должен звать /reverse,
    // иначе игра начнёт выплачивать деньги вместо возврата.
    const r = epointBuildReverse(КЛЮЧ, 'te0011111111');
    const тело = epointDecodeData(r.body.data) as Record<string, unknown>;
    must(тело.transaction === 'te0011111111', 'номер операции не ушёл в запрос отмены');
    must(тело.currency === 'AZN', 'валюта не указана');
    // Полной отмены сумма не нужна: без неё отменяется вся операция.
    must(!('amount' in тело), 'полная отмена отправляет сумму - это уже частичный возврат');
    must(EPOINT_API.includes('/api/1'), 'адрес API указывает не на epoint.az');
    must(
      !/refund/.test(epointBuildReverse(КЛЮЧ, 'te1').body.data + 'reverse'),
      'в теле отмены не должно быть refund',
    );
  });

  it('частичный возврат отправляет сумму', () => {
    const r = epointBuildReverse(КЛЮЧ, 'te1', 5.25);
    const тело = epointDecodeData(r.body.data) as Record<string, unknown>;
    must(тело.amount === '5.25', `частичный возврат ушёл с суммой ${тело.amount}`);
  });

  it('проверка статуса несёт transaction, а не наш order_id', () => {
    // get-status спрашивает по номеру операции в системе Epoint. Наш
    // order_id туда не годится, и провайдер ответит «не найдено».
    const r = epointBuildStatusCheck(КЛЮЧ, 'te0011111111');
    const тело = epointDecodeData(r.body.data) as Record<string, unknown>;
    must(тело.transaction === 'te0011111111', 'в проверке статуса нет номера операции');
    must(!('order_id' in тело), 'в проверку статуса попал наш order_id');
  });

  it('провайдер выключен по умолчанию и не включается частично', () => {
    must(epointConfig({}) === null, 'провайдер включился без переменных');
    must(epointConfig({ EPOINT_PUBLIC_KEY: 'i1', EPOINT_PRIVATE_KEY: 'k' }) === null,
      'провайдер включился без явного флага');
    // Включили, а ключа нет - это поломка, и молча пропускать нельзя.
    let отказ = false;
    try { epointConfig({ EPOINT_ENABLED: 'true', EPOINT_PUBLIC_KEY: 'i1' }); } catch { отказ = true; }
    must(отказ, 'включённый провайдер без приватного ключа не привёл к отказу');
    const вкл = epointConfig({ EPOINT_ENABLED: 'true', EPOINT_PUBLIC_KEY: 'i1', EPOINT_PRIVATE_KEY: 'k' });
    must(вкл !== null && вкл.publicKey === 'i1', 'провайдер не включился с полными ключами');
  });

  it('пустые обязательные поля приводят к отказу', () => {
    let отказ = false;
    try {
      epointBuildPayment(КЛЮЧ, {
        amount: 10, currency: 'AZN', orderId: '', description: 'd', language: 'ru',
      });
    } catch { отказ = true; }
    must(отказ, 'пустой order_id прошёл - провайдер всё равно его не примет');

    отказ = false;
    try {
      epointBuildPayment(КЛЮЧ, {
        amount: 10, currency: 'AZN', orderId: 'x'.repeat(300), description: 'd', language: 'ru',
      });
    } catch { отказ = true; }
    must(отказ, 'слишком длинный order_id прошёл - предел в документе 255 символов');
  });
});
