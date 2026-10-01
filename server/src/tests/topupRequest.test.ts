// Покупка AZENS: запрос клиента не должен отвергаться самой же проверкой.
//
// ЧТО БЫЛО. Клиент шлёт поле provider при каждой покупке (api.ts, тело
// `{ characterId, provider, ...input }`). Схема в маршруте его не перечисляла,
// а Joi по умолчанию не пропускает неизвестные ключи. Проверено запуском:
// тело с provider давало «"provider" is not allowed», без него проходило.
// То есть каждый клик «Купить» отвечал 400 и до создания счёта дело не
// доходило. Не заметили потому, что ключи ЮKassa не заданы: код отвечал
// «провайдер не настроен», и поломка была не видна.
//
// ПОЧЕМУ СХЕМА ВЫНЕСЕНА В ЭКСПОРТ. Проверка бьёт по настоящей схеме
// (topupSchema), а не по её копии. Копия доказывала бы саму себя: её можно
// исправить, оставив настоящую схему поломанной, и проверка осталась бы
// зелёной ровно на то время, на которое поломка была не видна.
import { topupSchema, выборПровайдера } from '../routes/game';

const UUID = '11111111-1111-4111-8111-111111111111';

function must(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

describe('Покупка AZENS: запрос клиента доходит до провайдера', () => {
  it('принимает тело ровно в том виде, как его шлёт клиент', () => {
    // Состав тела скопирован из client/src/app/api.ts: characterId, provider
    // и либо packId, либо realCurrency с amount.
    const СЛУЧАИ: Array<[string, Record<string, unknown>]> = [
      ['пакет, провайдер по умолчанию', { characterId: UUID, packId: 'rub_s', provider: 'yookassa' }],
      ['свободная сумма', { characterId: UUID, realCurrency: 'rub', amount: 500, provider: 'yookassa' }],
      ['без поля provider вовсе', { characterId: UUID, packId: 'rub_s' }],
      ['провайдер в верхнем регистре', { characterId: UUID, packId: 'rub_s', provider: 'YOOKASSA' }],
      ['провайдер с пробелами', { characterId: UUID, packId: 'rub_s', provider: '  yookassa  ' }],
    ];
    for (const [имя, тело] of СЛУЧАИ) {
      const r = topupSchema.validate(тело);
      must(
        !r.error,
        `клиентский запрос отвергнут на проверке: «${имя}» -> ${r.error?.details[0].message}`,
      );
    }
  });

  it('provider переживает проверку и доступен маршруту', () => {
    const r = topupSchema.validate({ characterId: UUID, packId: 'rub_s', provider: 'yookassa' });
    must(!r.error, 'тело отвергнуто');
    // Именно это значение читает маршрут. Если бы он читал сырое req.body,
    // обрезка пробелов и приведение регистра из схеры бы не действовали.
    must(r.value.provider === 'yookassa', `provider не дожил: ${JSON.stringify(r.value)}`);
    must(
      topupSchema.validate({ characterId: UUID, packId: 'rub_s', provider: '  YOOKASSA  ' }).value.provider
        === 'yookassa',
      'provider не нормализован: пробелы и регистр должны приводиться к виду,'
      + ' по которому маршрут сравнивает его со строкой yookassa',
    );
  });

  it('подставляет того провайдера, который настроен на сервере', () => {
    // КЛИЕНТ БОЛЬШЕ НЕ ПРИСЫЛАЕТ ИМЯ ПРОВАЙДЕРА. Раньше он слал 'yookassa'
    // жёстко, а на сервере настроен Xsolla, и каждый клик «Купить» упирался
    // в «провайдер не настроен». Теперь решение принимает сервер по своим
    // ключам, и проверка ниже фиксирует именно это.
    const сXsolla = выборПровайдера({
      XSOLLA_ENABLED: 'true',
      XSOLLA_PUBLISHER_ID: '940854',
      XSOLLA_PROJECT_ID: '316884',
      XSOLLA_API_KEY: 'ключ',
      XSOLLA_WEBHOOK_SECRET: 'секрет',
    } as NodeJS.ProcessEnv);
    must(сXsolla === 'xsolla', `при настроенном Xsolla выбрано «${сXsolla}»`);

    // Настроен только ЮKassa - выбирается он, а не запасное имя.
    const сЮKassa = выборПровайдера({
      PAYMENT_JOBIK_ENABLED: 'true',
      PAYMENT_JOBIK_SHOP_ID: '123',
      PAYMENT_JOBIK_SECRET: 'секрет',
    } as NodeJS.ProcessEnv);
    must(сЮKassa === 'yookassa', `при настроенной ЮKassa выбрано «${сЮKassa}»`);

    // Не настроен никто - возвращается запасное имя, и маршрут честно
    // ответит «провайдер не настроен», а не сделает вид, что всё в порядке.
    must(выборПровайдера({} as NodeJS.ProcessEnv) === 'yookassa', 'без ключей выбрано не запасное имя');

    // Провайдер, выключенный флагом, настроенным не считается: флаг
    // выключает всё разом, иначе старые ключи в .env тихо ожили бы.
    const выключенный = выборПровайдера({
      XSOLLA_ENABLED: 'false',
      XSOLLA_PUBLISHER_ID: '940854',
      XSOLLA_PROJECT_ID: '316884',
      XSOLLA_API_KEY: 'ключ',
      XSOLLA_WEBHOOK_SECRET: 'секрет',
    } as NodeJS.ProcessEnv);
    must(выключенный === 'yookassa', `выключенный Xsolla всё равно выбран: «${выключенный}»`);
  });

  it('проверка по-прежнему не пускает мусор', () => {
    // Правка не должна ослабить проверку: неверный uuid, чужая валюта,
    // обе формы покупки разом, отрицательная сумма - всё обязано отпадать.
    const ПЛОХИЕ: Array<[string, Record<string, unknown>]> = [
      ['characterId не uuid', { characterId: 'не-uuid', packId: 'rub_s' }],
      ['чужая валюта', { characterId: UUID, realCurrency: 'eur999', amount: 10 }],
      ['обе формы сразу', { characterId: UUID, packId: 'rub_s', realCurrency: 'rub', amount: 10 }],
      ['ни формы', { characterId: UUID }],
      ['отрицательная сумма', { characterId: UUID, realCurrency: 'rub', amount: -5 }],
      ['нулевая сумма', { characterId: UUID, realCurrency: 'rub', amount: 0 }],
      ['amount без realCurrency', { characterId: UUID, amount: 500 }],
      ['provider не строка', { characterId: UUID, packId: 'rub_s', provider: { inject: 1 } }],
    ];
    for (const [имя, тело] of ПЛОХИЕ) {
      const r = topupSchema.validate(тело);
      must(r.error, `проверка ослаблена: «${имя}» прошло`);
    }
  });

  it('provider ограничен по длине', () => {
    // Схема ограничивает и packId, и provider. Без ограничения на provider
    // в журнал и в лог уходила бы строка произвольной длины.
    const r = topupSchema.validate({ characterId: UUID, packId: 'rub_s', provider: 'x'.repeat(500) });
    must(r.error, 'provider не ограничен по длине');
  });
});
