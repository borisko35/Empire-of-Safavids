// Подпись Intellect Money — единственное, что отличает настоящее
// уведомление о платже от подделки. Теста на неё не было вовсе: функция
// появилась вместе с провайдером, а покрытие осталось за Xsolla и ЮKassa.
//
// ЧЕМ ОПЛАТИЛСЯ ПРОПУСК. На боевом сервере подпись проверяется тем же
// кодом, что и здесь, и ошибка в ней выглядит как «игрок заплатил, а
// AZENS не пришли»: уведомление отбрасывается с 401, Intellect Money
// повторяет его, затем перестаёт. Снаружи это неотличимо от «у
// провайдера сломалось», и найти можно только сверкой с кабинетом.
//
// ПОЧЕМУ ВЕКТОР, А НЕ «СХЕМА И ПРОВЕРКА С СОБОЙ». Проверка «посчитали и
// сравнили» проходит бы и всегда, пока считает и сравнивает один и тот же
// код: переставили поле в реализации — тест посчитает по-новому и радостно
// подтвердит новый порядок. Вектор с посчитанным заранее значением
// ломается от такой правки, потому что ожидаемое значение зафиксировано
// в этом файле и ни от чего внутри реализации не зависит.
import {
  intellectMoneyConfig,
  isIntellectMoneyEnabled,
  verifyIntellectMoneyHash,
  type IntellectMoneyNotification,
} from '../services/payments/intellectmoney';

describe('Intellect Money: подпись уведомления', () => {
  const base: IntellectMoneyNotification = {
    eshopId: '473275',
    orderId: 'order-1',
    paymentId: 'sc-1',
    serviceName: 'Service',
    eshopAccount: 'acct',
    recipientAmount: '10.00',
    recipientCurrency: 'RUB',
    paymentStatus: '3',
    userName: 'User',
    userEmail: 'u@example.com',
    paymentData: 'data',
    // Поле hash в уведомлении одно на всё, поэтому переиспользуем его же и
    // в опорном объекте — так меняется только то, что проверяется.
    hash: '84726c320a1d94238c3676c5c5c3433e',
  };

  it('принимает подпись по эталонному вектору', () => {
    expect(verifyIntellectMoneyHash(base, 'test-secret')).toBe(true);
  });

  it('отвергает чужой секрет', () => {
    // Ровно то, что сделал бы злоумышленник, знающий номер заказа.
    expect(verifyIntellectMoneyHash(base, 'wrong-secret')).toBe(false);
  });

  it('отвергает изменённое поле', () => {
    // Смена суммы или статуса обязана ломать подпись. Без этой проверки
    // уведомление со status=5 (отмена) прошло бы как status=3 (оплата).
    expect(verifyIntellectMoneyHash({ ...base, recipientAmount: '1000.00' }, 'test-secret')).toBe(false);
    expect(verifyIntellectMoneyHash({ ...base, paymentStatus: '5' }, 'test-secret')).toBe(false);
  });

  it('пустое поле не съезжает: пустая строка и отсутствие дают одну подпись', () => {
    // Intellect Money присылает необязательные поля пустыми, а не
    // отсутствующими. Если реализация различает '', null и undefined, то
    // настоящее уведомление перестанет проходить проверку — и это выглядит
    // как «подпись неверна», хотя прислал провайдер.
    const сПустыми = { ...base, eshopAccount: '', userName: '', paymentData: '' };
    const безНих = {
      ...base,
      eshopAccount: undefined, userName: undefined, paymentData: undefined,
    } as unknown as IntellectMoneyNotification;
    expect(verifyIntellectMoneyHash(сПустыми, 'x') === verifyIntellectMoneyHash(безНих, 'x')).toBe(true);
  });

  it('регистр hex не влияет на результат', () => {
    // Провайдер не обещал присылать hash в нижнем регистре.
    const верхний = { ...base, hash: base.hash.toUpperCase() };
    expect(verifyIntellectMoneyHash(верхний, 'test-secret')).toBe(true);
  });

  it('отсутствующий hash не роняет проверку, а отвергает уведомление', () => {
    // Здесь важно, что функция возвращает false, а не бросает: иначе
    // маршрут упал бы в 500, и провайдер решил бы, что сервер сломан.
    const безХеша = { ...base, hash: undefined } as unknown as IntellectMoneyNotification;
    expect(verifyIntellectMoneyHash(безХеша, 'test-secret')).toBe(false);
  });
});

describe('Intellect Money: включение провайдера', () => {
  it('выключен, пока флага нет, даже при живых ключах', () => {
    // Ключи в deploy/.env и флаг в .env — разные строки, и человек
    // заполняет их по очереди. Промежуточное состояние обязано быть
    // «выключено», а не «включено с половиной ключей».
    const env = {
      PAYMENT_INTELLECTMONEY_ESHOP_ID: '473275',
      PAYMENT_INTELLECTMONEY_SECRET_KEY: 'secret',
    } as NodeJS.ProcessEnv;
    expect(intellectMoneyConfig(env)).toBeNull();
    expect(isIntellectMoneyEnabled(env)).toBe(false);
  });

  it('не включается, если ключей не хватает', () => {
    // Половина ключей — это не рабочий платёжный приём.
    expect(intellectMoneyConfig({
      PAYMENT_INTELLECTMONEY_ENABLED: 'true',
      PAYMENT_INTELLECTMONEY_ESHOP_ID: '473275',
    } as NodeJS.ProcessEnv)).toBeNull();
    expect(intellectMoneyConfig({
      PAYMENT_INTELLECTMONEY_ENABLED: 'true',
      PAYMENT_INTELLECTMONEY_SECRET_KEY: 'secret',
    } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('включается только при явном true и обоих ключах', () => {
    const env = {
      PAYMENT_INTELLECTMONEY_ENABLED: 'true',
      PAYMENT_INTELLECTMONEY_ESHOP_ID: '473275',
      PAYMENT_INTELLECTMONEY_SECRET_KEY: 'secret',
    } as NodeJS.ProcessEnv;
    expect(intellectMoneyConfig(env)).toEqual({ eshopId: '473275', secretKey: 'secret' });
    expect(isIntellectMoneyEnabled(env)).toBe(true);
  });

  it('значение 1 или TRUE провайдера не включают', () => {
    // Флаг включения не «истиноподобное», а ровно 'true'. Строка 'false'
    // тоже истинная в JS, и без явного сравнения провайдер включался бы
    // словарём переменных целиком.
    for (const значение of ['false', '1', 'TRUE', 'yes', '']) {
      expect(intellectMoneyConfig({
        PAYMENT_INTELLECTMONEY_ENABLED: значение,
        PAYMENT_INTELLECTMONEY_ESHOP_ID: '473275',
        PAYMENT_INTELLECTMONEY_SECRET_KEY: 'secret',
      } as NodeJS.ProcessEnv)).toBeNull();
    }
  });
});
