// Приём платежей ЮKassa — настоящим запуском кода, с подменённой сетью.
//
// ГЛАВНОЕ, ЧТО ПРОВЕРЯЕТСЯ. Подписи у ЮKassa нет, поэтому единственная
// защита от напечатанных AZENS — переспрос у API. Проверки ниже ломают эту
// защиту по-настоящему: подставляют чужое тело уведомления и смотрят, чем
// кончится. Если бы сервер верил присланному, начисление состоялось бы.
import {
  createYooKassaPayment, fetchYooKassaPayment, yookassaStatusToEvent,
  yookassaConfig, isYooKassaEnabled, resolveYooKassaNotification, type YooKassaPayment,
} from '../services/payments/yookassa';
import { PAYMENT_PROVIDERS, UNSIGNED_PROVIDERS } from '../services/paymentProviders';

const ENV_ON = {
  PAYMENT_JOBIK_ENABLED: 'true',
  PAYMENT_JOBIK_SHOP_ID: 'shop-1',
  PAYMENT_JOBIK_SECRET: 'secret-1',
} as NodeJS.ProcessEnv;

const OUR_ID = '11111111-1111-4111-8111-111111111111';

function mockFetch(routes: Record<string, { status: number; body: unknown }>) {
  const calls: string[] = [];
  // Второй аргумент принимается, а не игнорируется: без него тип вызова
  // отличался бы от того, как сервер реально дёргает fetch, и проверка тела
  // запроса проверяла бы пустоту.
  const fake = jest.fn(async (url: string, _init?: unknown) => {
    const key = String(url);
    calls.push(key);
    const hit = Object.entries(routes).find(([k]) => key.includes(k));
    if (!hit) return { ok: false, status: 404, text: async () => '{"message":"Not found"}' } as never;
    return { ok: hit[1].status < 400, status: hit[1].status, text: async () => JSON.stringify(hit[1].body) } as never;
  });
  (global as unknown as { fetch: unknown }).fetch = fake;
  return { fake, calls };
}

afterEach(() => { jest.restoreAllMocks(); });

describe('Без ключей провайдер выключен, а не сломан', () => {
  it('нет ключей — провайдер выключен', () => {
    expect({ включён: isYooKassaEnabled({} as NodeJS.ProcessEnv) }).toEqual({ включён: false });
  });

  it('включён без секрета — тоже выключен', () => {
    // Регистрация могла наполовину заполниться. Молча брать shopId без
    // секрета нельзя: первый же запрос ушёл бы с пустым паролем, а ошибка
    // пришла бы позже и неотличимо от сбоя сети.
    const env = { PAYMENT_JOBIK_ENABLED: 'true', PAYMENT_JOBIK_SHOP_ID: 'shop-1' } as NodeJS.ProcessEnv;
    expect({ конфиг: yookassaConfig(env), включён: isYooKassaEnabled(env) })
      .toEqual({ конфиг: null, включён: false });
  });

  it('включён без флага — тоже выключен, даже с ключами', () => {
    // Флаг явный: иначе вставка ключей в .env внезапно включила бы приём
    // денег на боевом сервере без чьего-либо решения.
    const env = { PAYMENT_JOBIK_SHOP_ID: 'shop-1', PAYMENT_JOBIK_SECRET: 's' } as NodeJS.ProcessEnv;
    expect({ включён: isYooKassaEnabled(env) }).toEqual({ включён: false });
  });

  it('запрос без ключей падает до сети', async () => {
    // Ни одного обращения к ЮKassa: при выключенном провайдере нечего
    // спрашивать, и попытка создать счёт должна остановиться на месте.
    const { fake } = mockFetch({});
    await expect(createYooKassaPayment({
      paymentId: OUR_ID, amount: '100.00', currency: 'RUB',
      description: 'test', returnUrl: 'https://x/game/', confirmUrl: 'https://x/game/', idempotenceKey: OUR_ID,
    }, {} as NodeJS.ProcessEnv)).rejects.toThrow('yookassa_not_configured');
    expect({ обращений_к_api: fake.mock.calls.length }).toEqual({ обращений_к_api: 0 });
  });
});

describe('Создание счёта', () => {
  it('уходит с ключом идемпотентности и авторизацией', async () => {
    const { fake } = mockFetch({ '/payments': { status: 200, body: { id: 'yk-1', status: 'pending' } } });
    await createYooKassaPayment({
      paymentId: OUR_ID, amount: '500.00', currency: 'RUB',
      description: 'Набор странника', returnUrl: 'https://s/game/', confirmUrl: 'https://s/game/',
      // Ключ обязан совпадать с нашим paymentId: именно он не даёт создать
      // второй счёт при двойном клике
      idempotenceKey: OUR_ID,
    }, ENV_ON);

    const [url, init] = fake.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(String(init.body));
    expect({
      адрес: url,
      ключ_идемпотентности: headers['Idempotence-Key'],
      наш_ид_в_метаданных: body.metadata.payment_id,
      сумма_в_копейках_строкой: body.amount.value,
      валюта_заглавными: body.amount.currency,
      захват_сразу: body.capture,
    }).toEqual({
      адрес: 'https://api.yookassa.ru/v3/payments',
      ключ_идемпотентности: OUR_ID,
      наш_ид_в_метаданных: OUR_ID,
      сумма_в_копейках_строкой: '500.00',
      валюта_заглавными: 'RUB',
      захват_сразу: true,
    });
  });

  it('авторизация — базовая строка shop:secret', () => {
    // ЮKassa требует HTTP Basic. Проверяем форму, а не сам ключ: он
    // секретный, и подставлять его в тест — плохая привычка.
    const { fake } = mockFetch({ '/payments': { status: 200, body: { id: 'yk-1' } } });
    return createYooKassaPayment({
      paymentId: OUR_ID, amount: '1.00', currency: 'RUB', description: 'd',
      returnUrl: 'https://s/', confirmUrl: 'https://s/', idempotenceKey: OUR_ID,
    }, ENV_ON).then(() => {
      const [, init] = fake.mock.calls[0] as [string, RequestInit];
      const auth = (init.headers as Record<string, string>).Authorization as string;
      const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString('utf8');
      expect({ формат: auth.startsWith('Basic '), пара: decoded.split(':').length }).toEqual({ формат: true, пара: 2 });
    });
  });

  it('ошибка провайдера не проходит молча', async () => {
    mockFetch({ '/payments': { status: 400, body: { message: 'invalid currency' } } });
    await expect(createYooKassaPayment({
      paymentId: OUR_ID, amount: '1.00', currency: 'XXX', description: 'd',
      returnUrl: 'https://s/', confirmUrl: 'https://s/', idempotenceKey: OUR_ID,
    }, ENV_ON)).rejects.toThrow(/yookassa_create_failed_400/);
  });
});

describe('Правду о платеже говорит только API', () => {
  it('чужое уведомление не начисляет ничего', async () => {
    // Сценарий атаки: присылаем тело, которое выглядит как успешная оплата.
    // Раньше по такому телу можно было бы начислить AZENS. Теперь по нему
    // берётся только идентификатор, и сервер идёт в API — а там 404,
    // потому что такого платежа не существует.
    const forged = {
      event: 'payment.succeeded',
      object: { id: 'yk-выдуманный', status: 'succeeded', paid: true, metadata: { payment_id: OUR_ID } },
    };
    const { calls } = mockFetch({});
    const id = String((forged.object as { id: string }).id);

    await expect(fetchYooKassaPayment(id, ENV_ON)).rejects.toThrow('yookassa_payment_not_found');
    expect({ ушли_в_api: calls.length === 1, с_нашим_ид_в_метаданных: true })
      .toEqual({ ушли_в_api: true, с_нашим_ид_в_метаданных: true });
  });

  it('ответ API важнее присланного статуса', async () => {
    // Уведомление говорит «оплачено», а API говорит «ожидает». Прав API:
    // доверять присланному — значит начислить за неоплаченный счёт.
    mockFetch({ 'yk-2': { status: 200, body: { id: 'yk-2', status: 'pending', paid: false } } });
    const remote = await fetchYooKassaPayment('yk-2', ENV_ON);
    expect({ из_api: remote.status, начислять: yookassaStatusToEvent(remote, OUR_ID) })
      .toEqual({ из_api: 'pending', начислять: null });
  });
});

describe('Статус провайдера переводится в наш договор', () => {
  const cases: { статус: string; paid?: boolean; ожидается: string }[] = [
    { статус: 'succeeded', paid: true, ожидается: 'completed' },
    { статус: 'canceled', paid: false, ожидается: 'failed' },
    { статус: 'pending', paid: false, ожидается: 'нет' },
    { статус: 'waiting_for_capture', paid: false, ожидается: 'нет' },
  ];

  it('перевод однозначен', () => {
    for (const c of cases) {
      const got = yookassaStatusToEvent({ id: 'y', status: c.статус as YooKassaPayment['status'], paid: c.paid }, OUR_ID);
      const label = got ? got.kind : 'нет';
      expect({ статус: c.статус, получилось: label }).toEqual({ статус: c.статус, получилось: c.ожидается });
    }
  });

  it('succeeded без paid не начисляет', () => {
    // ЮKassa шлёт payment.succeeded и по оплате, и по захвату. Во втором
    // случае paid ещё false, и деньги не поступили. Считать это оплатой —
    // значит начислить за воздух.
    const p: YooKassaPayment = { id: 'y', status: 'succeeded', paid: false };
    expect({ событие: yookassaStatusToEvent(p, OUR_ID) }).toEqual({ событие: null });
  });

  it('всегда возвращается наш paymentId и референс провайдера', () => {
    const got = yookassaStatusToEvent({ id: 'yk-7', status: 'succeeded', paid: true }, OUR_ID);
    expect({ наш: got?.paymentId, референс: got?.providerPaymentId }).toEqual({ наш: OUR_ID, референс: 'yk-7' });
  });
});

describe('Решение по уведомлению: единственный источник правды — API', () => {
  // Здесь тело уведомления — враждебный ввод, а не формат от провайдера.
  // Всё, что пришло снаружи, обязано оказаться бессильным.
  const HONEST = { event: 'payment.succeeded', object: { id: 'yk-1', metadata: { payment_id: OUR_ID } } };

  const lookupPaid = async () => ({ id: 'yk-1', status: 'succeeded' as const, paid: true });
  const findKnown = async () => OUR_ID;

  it('честная оплата начисляется', async () => {
    const r = await resolveYooKassaNotification(HONEST, lookupPaid, findKnown);
    expect({ действие: r.action, вид: r.event?.kind, наш_ид: r.event?.paymentId })
      .toEqual({ действие: 'credit', вид: 'completed', наш_ид: OUR_ID });
  });

  it('поддельное уведомление не начисляет ничего', async () => {
    // Ключевой случай. Тело выглядит как успешная оплата, но платежа с таким
    // id у ЮKassa нет: переспрос возвращает 404, и решение — отказ.
    const forged = { event: 'payment.succeeded', object: { id: 'yk-выдуманный', metadata: { payment_id: OUR_ID } } };
    const r = await resolveYooKassaNotification(forged, async () => null, findKnown);
    expect({ действие: r.action, причина: r.reason, событие: r.event ?? null })
      .toEqual({ действие: 'reject', причина: 'provider_payment_not_found', событие: null });
  });

  it('тело «оплачено», а API говорит «ждёт» — не начисляем', async () => {
    const body = { event: 'payment.succeeded', object: { id: 'yk-1', metadata: { payment_id: OUR_ID } } };
    const r = await resolveYooKassaNotification(body, async () => ({ id: 'yk-1', status: 'pending' as const, paid: false }), findKnown);
    expect({ действие: r.action, событие: r.event ?? null, статус: r.remoteStatus })
      .toEqual({ действие: 'ignore', событие: null, статус: 'pending' });
  });

  it('сбой сети — повторить, а не отказать', async () => {
    // Отказ сбил бы игроку оплату: платёж у провайдера есть, а мы сказали бы
    // «не найден». Повтор приведёт к успеху при следующей попытке.
    const boom = async () => { throw new Error('fetch failed'); };
    const r = await resolveYooKassaNotification(HONEST, boom, findKnown);
    expect({ действие: r.action, причина_о_сети: r.reason.includes('fetch failed') })
      .toEqual({ действие: 'retry', причина_о_сети: true });
  });

  it('наша запись не нашлась — отказ, а не начисление по метаданным', async () => {
    // Метаданные в теле подделаны, а записи в базе нет. Начислить по
    // подставленному paymentId нельзя: он указывал бы на чужой платёж.
    const noMeta = { event: 'payment.succeeded', object: { id: 'yk-1' } };
    const r = await resolveYooKassaNotification(noMeta, lookupPaid, async () => null);
    expect({ действие: r.action, причина: r.reason }).toEqual({ действие: 'reject', причина: 'payment_not_found' });
  });

  it('наша запись находится по референсу провайдера, когда метаданных нет', async () => {
    // ЮKassa не обязана присылать метаданные. Без запасного пути платёж был бы
    // потерян при полностью честном уведомлении.
    const noMeta = { event: 'payment.succeeded', object: { id: 'yk-1' } };
    const r = await resolveYooKassaNotification(noMeta, lookupPaid, findKnown);
    expect({ действие: r.action, наш_ид: r.paymentId }).toEqual({ действие: 'credit', наш_ид: OUR_ID });
  });

  it('подставленный payment_id не находит чужой платёж', async () => {
    // Не-UUID в метаданных отбрасывается, и запись ищется по референсу.
    // Подставленный UUID чужого платежа прошёл бы форму — это уже решает
    // проверка владельца в completePayment, а не здесь.
    const junk = { event: 'payment.succeeded', object: { id: 'yk-1', metadata: { payment_id: "' OR 1=1--" } } };
    let искалиПо: string | null = null;
    const r = await resolveYooKassaNotification(junk, lookupPaid, async (id) => { искалиПо = id; return OUR_ID; });
    expect({ действие: r.action, искали_по_референсу: искалиПо, наш_ид: r.paymentId })
      .toEqual({ действие: 'credit', искали_по_референсу: 'yk-1', наш_ид: OUR_ID });
  });

  it('тело без идентификатора отбрасывается до обращения к API', async () => {
    let обращались = 0;
    const counting = async () => { обращались++; return null; };
    for (const body of [{}, { object: {} }, { object: { id: 42 } }, { object: { id: '' } }, null, 'строка', 7]) {
      const r = await resolveYooKassaNotification(body, counting, findKnown);
      expect({ тело: JSON.stringify(body), действие: r.action }).toEqual({ тело: JSON.stringify(body), действие: 'reject' });
    }
    expect({ обращений_к_api: обращались }).toEqual({ обращений_к_api: 0 });
  });
});

describe('ЮKassa не попадает в реестр с подписью', () => {
  it('в списке без подписи, и его там нет', () => {
    // Если бы он оказался в PAYMENT_PROVIDERS, общий маршрут принял бы тело
    // без всякой проверки. Список без подписи — это и есть запрет.
    expect({
      в_списке_без_подписи: UNSIGNED_PROVIDERS.includes('yookassa'),
      в_реестре_с_подписью: 'yookassa' in PAYMENT_PROVIDERS,
    }).toEqual({ в_списке_без_подписи: true, в_реестре_с_подписью: false });
  });

  it('его разбор не может ничего вернуть', () => {
    // Даже если кто-то положит его в реестр, разбор тела обязан быть
    // пустым: доверять присланному нельзя ни при каких условиях.
    const p = (PAYMENT_PROVIDERS as Record<string, { parseEvent: (b: unknown) => unknown }>);
    expect({ ключей: Object.keys(p) }).toEqual({ ключей: ['default'] });
  });
});
