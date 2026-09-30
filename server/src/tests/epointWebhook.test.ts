// Вебхук Epoint: подпись, порядок проверок и отказоустойчивость.
//
// ПОРЯДОК ПРОВЕРОК В ЭТОМ ФАЙЛЕ НЕ СЛУЧАЙНЫЙ И НЕ ПЕРЕСТАВЛЯЕТСЯ. Подпись
// проверяется первой и по постоянному времени: иначе подделка отсекается
// поздно, когда часть работы уже сделана. Наша запись ищется по order_id -
// он возвращается в ответе и надёжнее номера операции. Правду о платеже
// говорит только get-status: подпись доказывает, что тело от Epoint, но не
// что платёж прошёл.
import {
  isEpointEnabled,
  createEpointPayment,
  resolveEpointNotification,
  reverseEpointPayment,
} from '../services/payments/epoint';
import {
  epointEncodeData,
  epointDecodeData,
  epointSignature,
} from '../services/payments/epoint/signature';

const КЛЮЧ = {
  EPOINT_ENABLED: 'true',
  EPOINT_PUBLIC_KEY: 'i000000001',
  EPOINT_PRIVATE_KEY: 'd3hjs138sd8kdfhbcea0be04eafde9e8e2bad2fb092d',
};
const ЧУЖОЙ = { ...КЛЮЧ, EPOINT_PRIVATE_KEY: 'ffffffffffffffffffffffffffffffffffffffff' };

const запись = { paymentId: '11111111-1111-4111-8111-111111111111' };
const находит = async () => запись;
const неНаходит = async () => null;

/** Подписанное тело вебхука - ровно то, что прислал бы Epoint. */
function вебхук(поля: Record<string, unknown>, ключ = КЛЮЧ.EPOINT_PRIVATE_KEY) {
  const data = epointEncodeData(JSON.stringify(поля));
  return { data, signature: epointSignature(ключ, data) };
}

/** Ответ get-status. */
function ответСтатуса(поля: Record<string, unknown>) {
  return { ok: true, status: 200, body: поля };
}

/** Подмена fetch. Возвращает функцию восстановления и список ушедших тел. */
function подменить(ответы: Array<ReturnType<typeof ответСтатуса> | Error>) {
  const исходный = global.fetch;
  const ушедшие: Array<{ url: string; тело: Record<string, unknown> }> = [];
  let i = 0;
  global.fetch = (async (вход: string | URL, инициализация?: { body?: string }) => {
    ушедшие.push({
      url: String(вход),
      тело: инициализация?.body ? JSON.parse(инициализация.body) : {},
    });
    const следующий = ответы[Math.min(i, ответы.length - 1)];
    i += 1;
    if (следующий instanceof Error) throw следующий;
    return {
      ok: следующий.ok,
      status: следующий.status,
      text: async () => JSON.stringify(следующий.body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { ушедшие, восст: () => { global.fetch = исходный; } };
}

describe('Вебхук Epoint', () => {
  it('провайдер выключен без ключей и не считается настроенным', () => {
    expect(isEpointEnabled({})).toBe(false);
    expect(isEpointEnabled({ EPOINT_PUBLIC_KEY: 'i1', EPOINT_PRIVATE_KEY: 'k' })).toBe(false);
    expect(isEpointEnabled(КЛЮЧ)).toBe(true);
  });

  it('подпись проверяется до всего остального: подделка отсекается сразу', async () => {
    // Подделка, у которой даже нашей записи нет. Если бы порядок был иным,
    // мы бы сначала полезли в базу и только потом узнали, что подпись
    // чужая. Настоящая подпись от другого ключа - отказ.
    const чужая = вебхук({ order_id: 'наш-1', transaction: 'te1', status: 'success' }, ЧУЖОЙ.EPOINT_PRIVATE_KEY!);
    const р = await resolveEpointNotification(чужая, находит, КЛЮЧ);
    expect(р.action).toBe('reject');
    expect(р.action === 'reject' && р.reason).toBe('signature_mismatch');
  });

  it('подпись верна, но нашей записи нет - отказ, чтобы не копить у провайдера', async () => {
    const р = await resolveEpointNotification(вебхук({ order_id: 'чужой' }), неНаходит, КЛЮЧ);
    expect(р.action).toBe('reject');
    expect(р.action === 'reject' && р.reason).toBe('payment_not_found');
  });

  it('подпись верна, запись есть, провайдер подтвердил - начисляем', async () => {
    const { восст, ушедшие } = подменить([ответСтатуса({
      status: 'success', code: '000', amount: '20.50', transaction: 'te1', order_id: 'наш-1',
    })]);
    try {
      const р = await resolveEpointNotification(вебхук({ order_id: 'наш-1', transaction: 'te1' }), находит, КЛЮЧ);
      expect(р.action).toBe('credit');
      expect(р.action === 'credit' && р.result.amount).toBe(20.5);
      // Правду мы спрашиваем у провайдера по get-status: адрес здесь тот же
      // самый, а не '/checkout' и не '/reverse'. Ошибка в адресе выглядела бы
      // как «провайдер не отвечает» и стоила бы денег.
      expect(ушедшие).toHaveLength(1);
      expect(ушедшие[0].url).toContain('/get-status');
    } finally { восст(); }
  });

  it('тело говорит success, но провайдер не подтвердил - начисления нет', async () => {
    // ТЕЛО ВЕБХУКА ГОВОРИТ, ЧТО ВСЁ ПРОШЛО. Это утверждение ничем не
    // подтверждено, и верить ему нельзя: так подделка начисляла бы валюту.
    const { восст } = подменить([ответСтатуса({
      status: 'failed', code: '116', amount: '20.50', transaction: 'te1', order_id: 'наш-1',
    })]);
    try {
      const р = await resolveEpointNotification(
        вебхук({ order_id: 'наш-1', transaction: 'te1', status: 'success' }), находит, КЛЮЧ);
      expect(р.action).toBe('fail');
    } finally { восст(); }
  });

  it('недоступность провайдера - это повтор, а не потерянные деньги', async () => {
    // Ответ «отказ» здесь стоил бы игроку денег: провайдер больше не
    // повторит, а платёж был настоящим.
    const { восст } = подменить([new Error('сеть упала')]);
    try {
      const р = await resolveEpointNotification(вебхук({ order_id: 'наш-1', transaction: 'te1' }), находит, КЛЮЧ);
      expect(р.action).toBe('retry');
    } finally { восст(); }
  });

  it('платёж ещё в работе - игнорируем, а не отказываем', async () => {
    // Код 923 «запрос в процессе». Если отказать, игрок заплатит второй раз.
    const { восст } = подменить([ответСтатуса({ status: 'error', code: '923', transaction: 'te1' })]);
    try {
      const р = await resolveEpointNotification(вебхук({ order_id: 'наш-1', transaction: 'te1' }), находит, КЛЮЧ);
      expect(р.action).toBe('ignore');
    } finally { восст(); }
  });

  it('нечитаемый ответ провайдера - повтор, а не выдуманный отказ', async () => {
    const { восст } = подменить([ответСтатуса({})]);
    try {
      const р = await resolveEpointNotification(вебхук({ order_id: 'наш-1', transaction: 'te1' }), находит, КЛЮЧ);
      expect(р.action).toBe('retry');
    } finally { восст(); }
  });

  it('тело без номера операции и без order_id не принимается', async () => {
    const р = await resolveEpointNotification(вебхук({ status: 'success' }), находит, КЛЮЧ);
    expect(р.action).toBe('reject');
  });

  it('подпись сошлась, а data не разбирается - отказ с честной причиной', async () => {
    // Подпись сошлась, значит тело от Epoint, но мусор. Причина должна
    // быть про мусор, а не про подделку: в журнале это разные вещи.
    const data = 'это-не-base64-json';
    const р = await resolveEpointNotification(
      { data, signature: epointSignature(КЛЮЧ.EPOINT_PRIVATE_KEY, data) }, находит, КЛЮЧ);
    expect(р.action).toBe('reject');
    expect(р.action === 'reject' && р.reason).toBe('data_not_decodable');
  });

  it('пустое тело вебхука не приводит к разбору подписи', async () => {
    const р = await resolveEpointNotification({}, находит, КЛЮЧ);
    expect(р.action).toBe('reject');
    expect(р.action === 'reject' && р.reason).toBe('missing_data_or_signature');
  });
});

describe('Создание счёта у Epoint', () => {
  it('возвращает адрес оплаты и номер операции', async () => {
    const { восст } = подменить([ответСтатуса({
      status: 'success', transaction: 'te0011111111', redirect_url: 'https://epoint.az/pay/000001',
    })]);
    try {
      const r = await createEpointPayment({
        amount: 20.5, currency: 'AZN', orderId: 'наш-1',
        description: 'Empire of Safavids', language: 'ru',
      }, КЛЮЧ);
      expect(r.checkoutUrl).toBe('https://epoint.az/pay/000001');
      expect(r.transaction).toBe('te0011111111');
      expect(r.providerError).toBeNull();
    } finally { восст(); }
  });

  it('счёт создан, а адреса оплаты нет - это ошибка, а не успех', async () => {
    // Игрок без адреса заплатить не может. Молчание здесь выглядело бы как
    // «всё в порядке», а на деле покупка невозможна.
    const { восст } = подменить([ответСтатуса({ status: 'success', transaction: 'te1' })]);
    try {
      const r = await createEpointPayment({
        amount: 20.5, currency: 'AZN', orderId: '1', description: 'd', language: 'ru',
      }, КЛЮЧ);
      expect(r.checkoutUrl).toBeNull();
      expect(r.providerError).toBe('provider_no_checkout_url');
    } finally { восст(); }
  });

  it('отказ провайдера не выдаётся за успех', async () => {
    const { восст } = подменить([{ ok: false, status: 500, body: { message: 'ошибка' } }]);
    try {
      const r = await createEpointPayment({
        amount: 20.5, currency: 'AZN', orderId: '1', description: 'd', language: 'ru',
      }, КЛЮЧ);
      expect(r.checkoutUrl).toBeNull();
      expect(r.providerError).toBe('provider_request_failed');
    } finally { восст(); }
  });

  it('провайдер не настроен - понятная причина, а не сеть', async () => {
    const r = await createEpointPayment({
      amount: 20.5, currency: 'AZN', orderId: '1', description: 'd', language: 'ru',
    }, {});
    expect(r.providerError).toBe('provider_not_configured');
  });
});

describe('Возврат у Epoint идёт через отмену операции', () => {
  it('полный возврат идёт на /reverse без суммы', async () => {
    // Две вещи сразу, и обе про деньги. Первая: адрес - /reverse, а не
    // /refund-request, который выплачивает, а не возвращает. Вторая: без
    // суммы отменяется ВСЯ операция, а с суммой - только часть, и игрок
    // получил бы неполный возврат и решил бы, что его обманули.
    const { восст, ушедшие } = подменить([ответСтатуса({ status: 'success' })]);
    try {
      const r = await reverseEpointPayment('te0011111111', КЛЮЧ);
      expect(r.ok).toBe(true);
      expect(ушедшие).toHaveLength(1);
      expect(ушедшие[0].url).toContain('/reverse');
      expect(ушедшие[0].url).not.toContain('refund');
      const data = epointDecodeData(String(ушедшие[0].тело.data)) as Record<string, unknown>;
      expect(data.transaction).toBe('te0011111111');
      expect(data).not.toHaveProperty('amount');
      expect(data.currency).toBe('AZN');
    } finally { восст(); }
  });

  it('частичный возврат передаёт сумму', async () => {
    const { восст, ушедшие } = подменить([ответСтатуса({ status: 'success' })]);
    try {
      const r = await reverseEpointPayment('te0011111111', КЛЮЧ, 5.25);
      expect(r.ok).toBe(true);
      const data = epointDecodeData(String(ушедшие[0].тело.data)) as Record<string, unknown>;
      expect(data.amount).toBe('5.25');
    } finally { восст(); }
  });

  it('провайдер не настроен - отказ, а не «возврат выполнен»', async () => {
    const r = await reverseEpointPayment('te1', {});
    expect(r.ok).toBe(false);
    expect(r.providerError).toBe('provider_not_configured');
  });
});
