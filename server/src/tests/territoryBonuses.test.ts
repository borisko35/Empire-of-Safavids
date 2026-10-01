// Бонусы владельца территории: что из объявленного действительно применяется.
//
// ЧТО БЫЛО. TerritoryDefinition.bonuses объявлены у всех четырёх территорий:
// trade_tax, gold_income, exp_bonus, craft_speed, pvp_damage, defense_bonus,
// sea_speed. Ни один не читался никем во всём проекте. Поиск trade_tax давал
// два совпадения - оба в самом файле данных.
//
// Теперь подключён ровно один вид (exp_bonus), и главное в этих проверках -
// что остальные шесть НАЗВАНЫ как неподключённые, а не выброшены молча.
// Молчаливый выброс хуже отсутствия: в данных он выглядит работающим, и
// карта продолжала бы обещать то, чего нет.
import {
  бонусВида,
  долиТерритории,
  territoryBonuses,
  видыИзДанных,
  неподключённыеВиды,
  видИзвестен,
  WIRED_TERRITORY_BONUSES,
  TerritoryBonusError,
  НЕЙТРАЛЬНО,
} from '../systems/TerritoryBonuses';
import { TERRITORIES, type TerritoryDefinition } from '../data/guilds';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

const территория = (over: Partial<TerritoryDefinition> = {}): TerritoryDefinition => ({
  id: 't', name: 'T', nameRu: 'Т', region: 'tabriz' as TerritoryDefinition['region'],
  bonuses: [], capturePoints: 1, defensePoints: 1, siegeSchedule: 'Saturday 20:00 UTC',
  ...over,
});

describe('Бонусы территории: что подключено', () => {
  it('exp_bonus подключён и складывается долями, а не множителями', () => {
    must(WIRED_TERRITORY_BONUSES.includes('exp_bonus'), 'exp_bonus не подключён, а опыт с территорий не начисляется');

    // Одна территория +10%.
    must(territoryBonuses([территория({ bonuses: [{ type: 'exp_bonus', value: 0.1 }] })], 'exp_bonus') === 1.1,
      'одна территория +10% дала не 1.1');

    // Две по +10% должны дать +20%, а НЕ +21%.
    // Ловушка: сложение множителей (1+a)*(1+b) даёт 1.21, и ошибка росла бы
    // с каждой новой территорией в регионе, оставаясь незаметной.
    const две = [0.1, 0.1];
    const множитель = territoryBonuses(
      две.map((v) => территория({ bonuses: [{ type: 'exp_bonus', value: v }] })), 'exp_bonus',
    );
    must(множитель === 1.2, `две территории по +10% дали ${множитель}, а ждали 1.2 (не 1.21 - это сложение множителей)`);

    // Три: 1.3, а не 1.331.
    const три = [0.1, 0.1, 0.1];
    must(territoryBonuses(три.map((v) => территория({ bonuses: [{ type: 'exp_bonus', value: v }] })), 'exp_bonus') === 1.3,
      'три территории сложились как множители');
  });

  it('неизвестный вид бросает исключение, а не возвращает единицу', () => {
    // Молчаливый возврат 1 - это ошибка, которая выглядит как «бонуса нет».
    // Опечатка в данных должна быть видна, а не съедать бонус тихо.
    let упало = false;
    try {
      бонусВида('exp_bonus_typo', 0.1);
    } catch (e) {
      упало = e instanceof TerritoryBonusError;
    }
    must(упало, 'на опечатке в виде бонуса не упало - опечатка будет съедена молча');

    // Подключённый вид с нечисловым значением - ноль, а не отказ: это
    // испорченные данные, а не неизвестный вид.
    must(бонусВида('exp_bonus', Number.NaN) === 0, 'NaN в подключённом виде дал не ноль');
    must(бонусВида('exp_bonus', Number.POSITIVE_INFINITY) === 0, 'бесконечность дала не ноль');
  });

  it('все семь видов объявлены в справочнике, шесть названы неподключёнными', () => {
    const вДанных = видыИзДанных();
    must(вДанных.length === 7, `в данных ${вДанных.length} видов бонусов, а ожидалось 7: ${вДанных.join(', ')}`);

    // Каждый вид из данных настоящий, а не выдуманный справочником.
    for (const вид of вДанных) {
      must(видИзвестен(вид), `в данных вид «${вид}», которого нет в списке известных`);
    }

    // Шесть без точки применения обязаны быть НАЗВАНЫ. Не «нет ошибки», а
    // конкретный список: иначе добавление седьмого вида в данные останется
    // незамеченным, пока игрок не пожалуется.
    const неподключённые = неподключённыеВиды();
    must(неподключённые.length === 6,
      `неподключённых видов ${неподключённые.length}, а ожидалось 6: ${неподключённые.join(', ')}`);
    must(!неподключённые.includes('exp_bonus'), 'exp_bonus попал в неподключённые, хотя он работает');
    for (const вид of ['trade_tax', 'gold_income', 'craft_speed', 'pvp_damage', 'defense_bonus', 'sea_speed']) {
      must(неподключённые.includes(вид), `вид ${вид} не назван неподключённым, хотя точки применения у него нет`);
    }
  });

  it('каждая территория в данных несёт бонусы, а не пустой список', () => {
    // Территория без бонусов выглядела бы как «её не придумали», а на деле
    // означала бы, что держать её незачем.
    //
    // ВАЖНО: бонусы в данных ДВУХ РАЗНЫХ ПРИРОД. exp_bonus, trade_tax,
    // pvp_damage, defense_bonus, sea_speed и craft_speed - доли (0.05…0.20),
    // а gold_income - абсолютная сумма в золоте (1000…5000). Проверка «не
    // больше 100%» на всех видах сразу ломается на gold_income, и это
    // не ошибка данных, а ошибка проверки: я на неё наступил.
    const ДОЛИ = new Set(['exp_bonus', 'trade_tax', 'pvp_damage', 'defense_bonus', 'sea_speed', 'craft_speed']);
    const СУММЫ = new Set(['gold_income']);

    for (const т of TERRITORIES) {
      must(т.bonuses.length > 0, `у территории ${т.id} нет ни одного бонуса - держать её незачем`);
      for (const бонус of т.bonuses) {
        must(Number.isFinite(бонус.value),
          `у ${т.id} бонус ${бонус.type} имеет нечисловое значение ${String(бонус.value)}`);
        must(бонус.value > 0, `у ${т.id} бонус ${бонус.type} неположителен: ${бонус.value}`);
        if (ДОЛИ.has(бонус.type)) {
          // +5000% опыта - не подарок, а ошибка, которая ломает уровни.
          must(бонус.value <= 1, `у ${т.id} доля ${бонус.type} больше 100%: ${бонус.value}`);
        } else if (СУММЫ.has(бонус.type)) {
          // Сумма в золоте: хоть и не доля, но и не миллиард.
          must(бонус.value <= 100_000, `у ${т.id} сумма ${бонус.type} неправдоподобна: ${бонус.value}`);
        } else {
          throw new Error(`вид бонуса ${бонус.type} у ${т.id} не отнесён ни к доле, ни к сумме`);
        }
      }
    }

    // Раз природы две, то и в подключённых должен быть только вид-доля:
    // подключить gold_income значило бы завести фоновую экономику.
    for (const вид of WIRED_TERRITORY_BONUSES) {
      must(ДОЛИ.has(вид), `подключён вид ${вид}, который не является долей`);
    }
  });

  it('доли одной территории складываются', () => {
    // В данных такого нет, но сложение - единственное поведение, при
    // котором добавление строки в справочник не потребует правки кода.
    must(долиТерритории(территория({ bonuses: [
      { type: 'exp_bonus', value: 0.05 },
      { type: 'exp_bonus', value: 0.05 },
    ] }), 'exp_bonus') === 0.1, 'две строки одного вида не сложились');

    // Строка другого вида в сумму того не попадает.
    must(долиТерритории(территория({ bonuses: [
      { type: 'exp_bonus', value: 0.05 },
      { type: 'trade_tax', value: 0.5 },
    ] }), 'exp_bonus') === 0.05, 'чужой вид попал в сумму exp_bonus');
  });

  it('нейтральный множитель равен единице, а не нулю', () => {
    // Пустой список территорий - это «владельца нет». Нулевой множитель был
    // бы наказанием за то, что территория никем не занята, и убивал бы опыт
    // игроку, который просто не в гильдии.
    must(territoryBonuses([], 'exp_bonus') === 1, 'без территорий множитель не 1');
    must(НЕЙТРАЛЬНО.exp === 1, 'нейтральный множитель не равен 1');
  });
});

describe('Бонусы территории: подключение к игре', () => {
  it('бонус применяется к опыту ДО округления, и в базу идёт бонусный', () => {
    // Тот же порядок, что у навыка «Удача Торговца» по золоту. Округлив
    // базовое число, а потом умножив, потеряли бы весь бонус на мелком опыте:
    // при опыте 10 и бонусе 10% округление дало бы 10, то есть ровно
    // ничего.
    //
    // Срез делается по присутствию ОБЕИХ строк, а не фиксированным
    // смещением: смещение в 300 символов обрезало try/catch и logger.error
    // раньше addExperience, и проверка падала на вполне верном коде.
    const бой = читать('server/src/socket/GameSocketHandler.ts');
    const начало = бой.indexOf('TerritoryBonuses.getInstance().бонусыИгрока');
    must(начало > 0, 'бонус территории не читается в обработчике боя вовсе');
    const конец = бой.indexOf('addExperience', начало);
    must(конец > начало, 'после чтения бонуса нет начисления опыта');
    const блок = бой.slice(начало, конец + 80);

    must(/Math\.floor\(опытБазовый \* бонусы\.exp\)/.test(блок),
      'множитель применяется не так или не до округления');
    must(/addExperience\(attacker\.id, опытБазовый\)/.test(блок),
      'в базу уходит не бонусный опыт, а базовый');
    must(!/addExperience\(attacker\.id, def\.expReward\)/.test(бой),
      'опыт начисляется мимо бонуса территории');
  });

  it('отказ при применении пишется в журнал, а не глотается', () => {
    // Молчаливый ноль - это опечатка в данных, которая выглядит как «бонуса
    // нет». Видно её должно быть в журнале, а не через полгода по жалобе.
    const бой = читать('server/src/socket/GameSocketHandler.ts');
    const начало = бой.indexOf('TerritoryBonuses.getInstance().бонусыИгрока');
    const блок = бой.slice(начало - 200, начало + 700);
    must(/catch/.test(блок), 'применение бонуса не ловит исключение вовсе');
    must(/logger\.error/.test(блок), 'отказ применения бонуса не пишется в журнал');
  });

  it('бонус читается для РЕГИОНА игрока, а не для всего мира', () => {
    // Территория даёт бонус в своём регионе. Если бы читалось по одному
    // владельцу без региона, базар в Тебризе дал бы +10% опыта в Исфахане -
    // то есть территория действовала бы там, где её нет.
    const бой = читать('server/src/socket/GameSocketHandler.ts');
    must(/бонусыИгрока\(attacker\.id, attacker\.region\)/.test(бой),
      'бонус читается без региона игрока');

    const система = читать('server/src/systems/TerritoryBonuses.ts');
    must(/т\.region === region/.test(система),
      'владелец ищется без учёта региона - территория действует не там, где находится');
  });

  it('кэш владельцев есть и он короткий', () => {
    // Бонус нужен на каждом добивании каждого игрока. Запрос в базу на
    // каждый удар поставил бы бой на паузу - так уже сделано с гильдейскими
    // заданиями, и там поэтому стоит void без await.
    const система = читать('server/src/systems/TerritoryBonuses.ts');
    must(/СРОК_КЭША_МС = \d+/.test(система), 'у кэша владельцев нет срока');
    // Честная граница: срок короткий, значит смена владельца видна не
    // мгновенно, но почти сразу. Обещать мгновенность было бы враньём.
    const срок = Number(/СРОК_КЭША_МС = (\d+)/.exec(система)?.[1] ?? '0');
    must(срок > 0 && срок <= 60_000, `срок кэша ${срок} мс - либо вечный, либо слишком долгий`);
  });

  it('без гильдии бонуса нет, и это не наказание', () => {
    // Одиночка не владеет нацией, которую можно обогащать. Но и опыт у него
    // должен быть обычный: нулевой множитель убил бы прогресс.
    const система = читать('server/src/systems/TerritoryBonuses.ts');
    must(/if \(герой\?\.guild_id == null\) return НЕЙТРАЛЬНО/.test(система),
      'без гильдии множитель не нейтральный - опыт игроку обнулялся бы');
  });
});

describe('Бонусы территории: исполняемый код', () => {
  const queryOne = jest.fn();
  const query = jest.fn();
  let предупреждение: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    queryOne.mockReset();
    query.mockReset();
    предупреждение = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => предупреждение.mockRestore());

  it('владелец в кэше, а при смене - новый бонус после истечения кэша', async () => {
    jest.doMock('../services/DatabaseService', () => ({
      DatabaseService: { getInstance: () => ({ query, queryOne, transaction: jest.fn() }) },
    }));
    jest.doMock('../utils/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    const { TerritoryBonuses: Система } = await import('../systems/TerritoryBonuses');

    queryOne.mockImplementation(async (sql: string) =>
      (sql.includes('FROM characters') ? { guild_id: 'g-1' } : null));
    // Исфахан, а не Тебриз: только у Дворцового квартала в данных есть
    // exp_bonus. У базара в Тебризе бонусы - trade_tax и gold_income, то
    // есть опыта они не дают, и проверка на Тебризе искала бы то, чего там
    // нет по уму автора данных.
    query.mockResolvedValue([{ territory_id: 'territory_isfahan_palace', guild_id: 'g-1' }]);

    const s = Система.getInstance();
    s.сбросить();

    const бонус = await s.бонусыИгрока('c-1', 'isfahan');
    must(бонус.exp > 1, `владелец Дворцового квартала получил множитель ${бонус.exp}, а ждали больше 1`);

    // Второй запрос отдаётся из кэша - в базу не идём.
    const было = query.mock.calls.length;
    await s.бонусыИгрока('c-1', 'isfahan');
    must(query.mock.calls.length === было, 'кэша владельцев нет: запрос в базу на каждый вызов');
  });

  it('в чужом регионе бонуса нет даже при владении', async () => {
    jest.doMock('../services/DatabaseService', () => ({
      DatabaseService: { getInstance: () => ({ query, queryOne, transaction: jest.fn() }) },
    }));
    jest.doMock('../utils/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    const { TerritoryBonuses: Система } = await import('../systems/TerritoryBonuses');

    queryOne.mockResolvedValue({ guild_id: 'g-1' });
    // Владелец Дворцового квартала в Исфахане.
    query.mockResolvedValue([{ territory_id: 'territory_isfahan_palace', guild_id: 'g-1' }]);

    const s = Система.getInstance();
    s.сбросить();
    // Спрашиваем ТЕБРИЗ, владея Исфаханом: территория даёт бонус только в
    // своём регионе, и без проверки региона базар в Тебризе дал бы +10%
    // опыта в Исфахане - то есть действовал бы там, где его нет.
    const вТебризе = await s.бонусыИгрока('c-1', 'tabriz');
    must(вТебризе.exp === 1,
      `в Тебризе множитель ${вТебризе.exp}, хотя Дворцовый квартал в Исфахане - бонус должен быть только в Исфахане`);
  });

  it('проверка справочника называет неподключённые виды', async () => {
    // logger мокается как jest.fn, и мы подменяем именно warn - иначе пришлось
    // бы городить собственный модуль логгера целиком.
    const warn = jest.fn();
    jest.doMock('../services/DatabaseService', () => ({
      DatabaseService: { getInstance: () => ({ query, queryOne, transaction: jest.fn() }) },
    }));
    jest.doMock('../utils/logger', () => ({
      logger: { info: jest.fn(), warn, error: jest.fn(), debug: jest.fn() },
    }));
    const { TerritoryBonuses: Система } = await import('../systems/TerritoryBonuses');

    const s = Система.getInstance();
    s.проверитьСправочник();
    must(warn.mock.calls.length === 1, `предупреждение прозвучало ${warn.mock.calls.length} раз, ждали 1`);
    const текст = String(warn.mock.calls[0][0]);
    for (const вид of ['trade_tax', 'gold_income', 'sea_speed']) {
      must(текст.includes(вид), `в предупреждении нет вида ${вид}`);
    }
    must(!текст.includes('exp_bonus'), 'exp_bonus назван неподключённым, хотя он работает');
    must(s.виды.length === 7, `в виды попало ${s.виды.length} значений, а в данных 7`);
  });
});

/** Проверка с сужением типа: иначе после неё переменная остаётся unknown. */
function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}
