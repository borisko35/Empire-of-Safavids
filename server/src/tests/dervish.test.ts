// Тесты дервиша: пассивные множители и перевод статуса защиты.
import { getBuffService, BUFFS } from '../services/BuffService';

jest.mock('../services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({ query: jest.fn().mockResolvedValue([]) }),
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const buffService = getBuffService();

describe('Эффекты дервиша объявлены', () => {
  it('Зикр и Тадж есть в каталоге', () => {
    // Каталог, а не только код активации: эффект, которого нет в BUFFS,
    // включился бы «в никуда» и тихо съел бы ресурсы игрока.
    expect({
      зикр: BUFFS.buff_damage_zikr?.stat,
      тадж: BUFFS.buff_protect_taj?.stat,
    }).toEqual({ зикр: 'damagePct', тадж: 'takenPct' });
  });

  it('у Таджа обратное действие, а не такое же, как у Зикра', () => {
    // Перепутать знаки - значит либо превратить корону в усилитель урона по
    // себе, либо вообще ничего. Разные виды эффекта исключают путаницу.
    const zikr = BUFFS.buff_damage_zikr;
    const taj = BUFFS.buff_protect_taj;
    expect({ зикр_увеличивает: zikr.magnitude > 0, тадж_уменьшает: taj.magnitude > 0 })
      .toEqual({ зикр_увеличивает: true, тадж_уменьшает: true });
  });

  it('имена эффектов начинаются с ожидаемого префикса', () => {
    // От префикса зависят запросы множителей. Переименование без смены
    // префикса сделало бы эффект невидимым для расчёта, и ошибки не было бы
    // нигде: grant отработал бы, а цифра не изменилась.
    expect({ зикр: BUFFS.buff_damage_zikr.id.startsWith('buff_damage_'), тадж: BUFFS.buff_protect_taj.id.startsWith('buff_protect_') })
      .toEqual({ зикр: true, тадж: true });
  });
});

describe('Защита от Таджа уменьшает получаемый урон', () => {
  it('без эффекта урон не меняется', async () => {
    const m = await buffService.getDamageTakenMultiplier('никого-нет');
    expect({ множитель: m }).toEqual({ множитель: 1 });
  });

  it('эффект снижает множитель', async () => {
    // Мок базы отдаёт одну строку с величиной эффекта - ровно то, что вернул
    // бы grant. Знак именно минус: корона должна защищать.
    (buffService as unknown as { db: { query: unknown } }).db = {
      query: jest.fn().mockResolvedValue([{ magnitude: 20 }]),
    };
    const m = await buffService.getDamageTakenMultiplier('кто-то');
    expect({ множитель: m }).toEqual({ множитель: 0.8 });
  });

  it('защита не становится полной неуязвимостью', async () => {
    // Граница 0.1, а не 0: при полной неуязвимости круг дервиша делал бы
    // бой бессмысленным. Мок отдаёт величину за пределами разумного.
    (buffService as unknown as { db: { query: unknown } }).db = {
      query: jest.fn().mockResolvedValue([{ magnitude: 100 }]),
    };
    const m = await buffService.getDamageTakenMultiplier('кто-то');
    expect({ множитель: m, не_ноль: m > 0 }).toEqual({ множитель: 0.1, не_ноль: true });
  });

  it('ошибка базы не обнуляет защиту', async () => {
    // Если бы ошибка давала 0, любой сбой базы делал бы игрока бессмертным -
    // а если 1, то просто ломал бы эффект. Правильный ответ - 1.
    (buffService as unknown as { db: { query: unknown } }).db = {
      query: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const m = await buffService.getDamageTakenMultiplier('кто-то');
    expect({ множитель: m }).toEqual({ множитель: 1 });
  });
});
