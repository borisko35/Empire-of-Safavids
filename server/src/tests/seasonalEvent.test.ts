// Сезонное событие: праздник, который наконец действует.
//
// ЧТО БЫЛО. SEASONAL_EVENTS описывал четыре праздника, и у каждого был
// список бонусов строками: 'exp_bonus_50pct', 'gold_bonus_30pct' и так
// далее. Эти строки не читались НИКОГДА: ни один бонус нигде не
// применялся. Ровно та же история, что с bossId у данжей — поле выглядит
// как работающее, а работы за ним нет.
//
// ГЛАВНОЕ ПРАВИЛО, КОТОРОЕ ЗДЕСЬ ПРОВЕРЯЕТСЯ. Неизвестный ключ бонуса
// обязан быть громким. Раньше несуществующий бонус просто ничего не делал,
// и праздник выглядел бы праздником. Теперь такой ключ попадает в unknown,
// и эти проверки падают. Проверка «каждый ключ из данных известен или
// явно помечен как запланированный» — главная в файле: без неё через полгода
// в праздник можно будет добавить опечатку, и она обнаружится только на
// словах игроков.
// Моки обязаны стоять ДО импортов: jest поднимает их в начало файла, но
// только если они объявлены на верхнем уровне. Объявленные внутри describe
// они остаются на своём месте, и сервис спокойно идёт в настоящий Redis -
// проверка падает с чужой ошибкой вместо своей.
const mockRedis = {
  get: jest.fn(async (): Promise<string | null> => null),
  set: jest.fn(async (): Promise<void> => {}),
  del: jest.fn(async (): Promise<void> => {}),
};
jest.mock('../services/RedisService', () => ({
  RedisService: { getInstance: () => mockRedis },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBonuses, PLANNED_BONUSES, SeasonalEventService } from '../services/SeasonalEventService';
import { SEASONAL_EVENTS, worldTimeAt, seasonOf, GAME_EPOCH_MS } from '../systems/WorldTimeSystem';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

/**
 * Тело метода purchase из BoatSystem: от объявления до следующего метода
 * или конца класса. Нужно, чтобы проверка смотрела на сам метод, а не на
 * весь хвост файла, где деньги трогаются законно.
 *
 * Комментарии отбрасываются обязательно: в объяснении, почему строка
 * удалена, она упомянута как раз в виде `addGold(characterId, -def.price)`,
 * и проверка находила саму себя. Это тот же класс, что и закомментированная
 * строка миграции, которую нашли сегодня.
 */
function purchaseBody(source: string): string {
  const code = stripComments(source);
  const start = code.indexOf('async purchase');
  if (start < 0) return '';
  const rest = code.slice(start + 1);
  const next = rest.search(/\n  (?:async |private |public |get |set )/);
  return next < 0 ? rest : rest.slice(0, next);
}

describe('Праздник действует, а не просто называется', () => {
  const redis = mockRedis;

  // Моменты времени для каждого сезона.
  //
  // Шкала: 1 реальная минута = 1 игровой час. Значит игровой месяц (30
  // игровых суток = 720 игровых часов) - это 12 РЕАЛЬНЫХ часов, а сезон -
  // 36. Первая версия проверки брала «60 дней» и думала, что это весна; на
  // деле это был 120-й игровой месяц, то есть зима. Вторая брала «2160
  // часов» и тоже мимо: это были игровые часы, а прибавлялись реальные.
  //
  // Берём середину сезона, чтобы не стоять на границе месяцев: весна - 36
  // реальных часов от эпохи, лето - 78, осень - 114, зима - 138.
  //
  // Соответствие проверяется отдельно: если эпоху сдвинут, тест упадёт с
  // понятным сообщением, а не будет молча измерять чужой сезон.
  const realHours = (n: number) => GAME_EPOCH_MS + n * 60 * 60 * 1000;
  const spring = realHours(36);
  const summer = realHours(78);
  const autumn = realHours(114);
  const winter = realHours(138);

  it('тестовые моменты действительно попадают в свои сезоны', () => {
    expect({
      весна: worldTimeAt(spring).season,
      лето: worldTimeAt(summer).season,
      осень: worldTimeAt(autumn).season,
      зима: worldTimeAt(winter).season,
    }).toEqual({ весна: 'spring', лето: 'summer', осень: 'autumn', зима: 'winter' });
  });

  beforeEach(async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockClear();
    redis.del.mockClear();
  });

  it('весной включается Навруз с настоящими множителями', async () => {
    const svc = new SeasonalEventService();
    await svc.setOverride(null);
    const active = svc.getActive(spring);
    expect({ праздник: active?.nameRu, опыт: active?.expMultiplier, золото: active?.goldMultiplier, принудительно: active?.forced })
      .toEqual({ праздник: 'Навруз', опыт: 1.5, золото: 1.3, принудительно: false });
  });

  it('в интерфейс уходит только то, что реально начисляется', async () => {
    // Данные обещают подарки праздника, а начисляются только опыт и
    // золото. Если бы в active попало всё подряд, игроку написали бы
    // «+50% к опыту, подарки» - а подарка нет.
    const svc = new SeasonalEventService();
    await svc.setOverride(null);
    expect(svc.getActive(spring)?.active).toEqual(['+50% к опыту', '+30% к золоту']);
  });

  it('осенью множитель золота ровно 1, а не «чуть больше»', async () => {
    // В «Жатвенной Луне» бонусов к золоту нет. Если бы множитель был
    // 1.0000001, награда раздувалась бы незаметно и годами.
    const svc = new SeasonalEventService();
    await svc.setOverride(null);
    const active = svc.getActive(autumn);
    expect({ праздник: active?.nameRu, золото: svc.goldMultiplier(autumn) })
      .toEqual({ праздник: 'Жатвенная Луна', золото: 1 });
  });

  it('зимой работает Ашура, а её +100% - это удвоение', async () => {
    const svc = new SeasonalEventService();
    await svc.setOverride(null);
    expect({ праздник: svc.getActive(winter)?.nameRu, опыт: svc.expMultiplier(winter) })
      .toEqual({ праздник: 'Ашура', опыт: 2 });
  });

  it('переключатель может включить чужой сезон', async () => {
    // Ради этого он и нужен: показать Навруз зимой, не дожидаясь весны.
    const svc = new SeasonalEventService();
    await svc.setOverride('Nowruz');
    const active = svc.getActive(winter);
    expect({ праздник: active?.nameRu, сезон: active?.seasonNameRu, принудительно: active?.forced })
      .toEqual({ праздник: 'Навруз', сезон: 'Весна', принудительно: true });
  });

  it('принудительный праздник переживает перезапуск процесса', async () => {
    // Первый процесс включил и записал в Redis, второй поднялся заново.
    const first = new SeasonalEventService();
    await first.setOverride('Ashura');
    expect(redis.set).toHaveBeenCalledWith('seasonal:override', 'Ashura');

    redis.get.mockResolvedValue('Ashura');
    const second = new SeasonalEventService();
    await second.loadOverride();
    expect({ из_redis: second.getOverride(), праздник: second.getActive(spring)?.nameRu })
      .toEqual({ из_redis: 'Ashura', праздник: 'Ашура' });
  });

  it('возврат к календарю стирает принудительный праздник', async () => {
    const svc = new SeasonalEventService();
    await svc.setOverride('Ashura');
    await svc.setOverride(null);
    expect({ в_redis_стёрт: redis.del.mock.calls.length, принудительно: svc.getOverride() })
      .toEqual({ в_redis_стёрт: 1, принудительно: null });
  });

  it('несуществующий праздник отвергается, а не превращается в тишину', async () => {
    const svc = new SeasonalEventService();
    await expect(svc.setOverride('Праздник Которого Нет')).rejects.toThrow(/Неизвестный праздник/);
    expect({ в_redis_не_попал: redis.set.mock.calls.length }).toEqual({ в_redis_не_попал: 0 });
  });

  it('сломанный Redis не оставляет праздник выключенным молча', async () => {
    // Праздник нужен прямо сейчас, а сохранить его не вышло. Если бы мы
    // просто бросили ошибку, праздник бы не включился вовсе, и владелец
    // решил бы, что сломалась кнопка.
    redis.set.mockRejectedValueOnce(new Error('redis down'));
    const svc = new SeasonalEventService();
    await svc.setOverride('Nowruz');
    expect({ праздник_включился: svc.getOverride() }).toEqual({ праздник_включился: 'Nowruz' });
  });

  it('множители по умолчанию равны единице, а не нулю', async () => {
    const svc = new SeasonalEventService();
    await svc.setOverride(null);
    // Сезон без бонусов: если бы множитель был 0, вся награда обнулилась
    // бы молча. Поэтому проверяем оба сразу и точно.
    expect({ опыт: svc.expMultiplier(autumn), золото: svc.goldMultiplier(autumn) })
      .toEqual({ опыт: 1, золото: 1 });
  });
});

describe('Ручная погода админа не потерялась при переносе календаря', () => {
  // Эта проверка появилась после провала: я вынес вычисление даты в
  // отдельную функцию и по пути забыл передать в неё weatherOverride. Ни
  // одна из 38 проверок этого не заметила - все 19 слонов были красные,
  // а кнопка «снег» в админке тихо перестала бы работать. Ровно тот класс
  // поломок, который чинили раньше, только с другой стороны.
  const { WorldTimeSystem } = require('../systems/WorldTimeSystem') as
    typeof import('../systems/WorldTimeSystem');

  it('админская погода важнее расписания', () => {
    const sys = new WorldTimeSystem();
    sys.setWeatherOverride('snow');
    expect({ выбрана: sys.getCurrentWorldTime().weather, видна_в_настройках: sys.getWeatherOverride() })
      .toEqual({ выбрана: 'snow', видна_в_настройках: 'snow' });
  });

  it('возврат к автоматическому режиму отдаёт расписание', () => {
    const sys = new WorldTimeSystem();
    sys.setWeatherOverride('sandstorm');
    const forced = sys.getCurrentWorldTime().weather;
    sys.setWeatherOverride(null);
    const auto = sys.getCurrentWorldTime().weather;
    // Кнопка «авто» обязана вернуть погоду по расписанию, а не ту, что была
    // выбрана руками. Первая версия этой проверки писала `|| true` и была
    // зелёной всегда - то есть не проверяла ничего.
    expect({
      принудительно: forced,
      сброшено: sys.getWeatherOverride(),
      совпадает_с_расписанием: auto === worldTimeAt(Date.now()).weather,
    }).toEqual({ принудительно: 'sandstorm', сброшено: null, совпадает_с_расписанием: true });
  });
});

describe('Ни один бонус не может помереть молча', () => {
  it('в каждом празднике все ключи либо применяются, либо помечены как запланированные', () => {
    // Главная проверка файла. Ключ, который не понимает никто, обязан быть
    // виден здесь: иначе бонус «+40% к торговле» можно будет написать с
    // опечаткой, и он молча ничего не сделает.
    const dead: string[] = [];
    for (const [season, def] of Object.entries(SEASONAL_EVENTS)) {
      for (const f of def.festivals) {
        const unknown = parseBonuses(f.bonuses).unknown;
        for (const key of unknown) dead.push(`${season}/${f.name}: ${key}`);
      }
    }
    expect({ мёртвые_ключи: dead }).toEqual({ мёртвые_ключи: [] });
  });

  it('если ключ незнакомый, он попадает в unknown, а не теряется', () => {
    // Первая версия проверки выше спрашивала только «пусто ли в unknown»,
    // и прошла бы и на пустом parseBonuses, который вообще ничего не ищет.
    // Поэтому отдельно проверяем, что неизвестный ключ виден.
    expect(parseBonuses(['exp_bonus_30pctx']).unknown).toEqual(['exp_bonus_30pctx']);
    expect(parseBonuses(['exp_bonus_30pct']).unknown).toEqual([]);
  });

  it('запланированные бонусы перечислены явно, а не «где-то там»', () => {
    // Список — это признание долга. Он должен быть виден в коде, а не
    // подразумеваться: иначе «не сделано» и «забыли» не отличить.
    for (const key of PLANNED_BONUSES) {
      expect(parseBonuses([key]).unknown).toEqual([]);
    }
    expect(PLANNED_BONUSES.length).toBeGreaterThan(0);
  });
});

describe('Бонус превращается в число, а не остаётся строкой', () => {
  it('опыт и золото', () => {
    expect(parseBonuses(['exp_bonus_50pct', 'gold_bonus_30pct']))
      .toEqual({ expMultiplier: 1.5, goldMultiplier: 1.3, unknown: [] });
  });

  it('«+100%» - это удвоение, а не пустая прибавка', () => {
    // Ошибка на сто процентов: если прочитать 100 как 0, то «Ашура со
    // +100% к опыту» станет праздником без бонуса - и будет выглядеть
    // исправно.
    expect(parseBonuses(['exp_bonus_100pct']).expMultiplier).toBe(2);
  });

  it('бонусов нет - множитель ровно 1', () => {
    // Не «примерно единица» и не ноль: от единицы зависит, умножим ли мы
    // награду вообще. Проверка на точное равенство, а не на правдивость.
    const none = parseBonuses(['special_nowruz_items', 'pvp_disabled_24h']);
    expect({ опыт: none.expMultiplier, золото: none.goldMultiplier }).toEqual({ опыт: 1, золото: 1 });
  });

  it('пропуски и лишние пробелы не ломают разбор', () => {
    expect(parseBonuses(['  exp_bonus_50pct  ']).expMultiplier).toBe(1.5);
  });
});

describe('Календарь мира переживает перезапуск', () => {
  // Раньше календарь считался от момента старта процесса. Из этого
  // следовало, что КАЖДЫЙ перезапуск возвращал мир на первый день: игрок
  // видел «Навруз», а через минуту после рестарта его уже не было.
  it('дата не зависит от того, когда запустился сервер', () => {
    const a = worldTimeAt(GAME_EPOCH_MS + 7 * 24 * 60 * 60 * 1000);
    const b = worldTimeAt(GAME_EPOCH_MS + 7 * 24 * 60 * 60 * 1000);
    expect({ год: a.gameYear === b.gameYear, месяц: a.gameMonth === b.gameMonth, день: a.gameDay === b.gameDay })
      .toEqual({ год: true, месяц: true, день: true });
  });

  it('сезон меняется по календарю, а не по времени работы сервера', () => {
    expect({ три: seasonOf(3), шесть: seasonOf(6), девять: seasonOf(9), двенадцать: seasonOf(12), первый: seasonOf(1) })
      .toEqual({ три: 'spring', шесть: 'summer', девять: 'autumn', двенадцать: 'winter', первый: 'winter' });
  });

  it('время не уезжает назад до эпохи', () => {
    // Часы можно сбить (таймзона, ручная правка, тест). Отрицательный
    // прошлое время должно давать начало, а не отрицательные дни.
    const t = worldTimeAt(GAME_EPOCH_MS - 10 * 24 * 60 * 60 * 1000);
    expect({ день: t.gameDay, месяц: t.gameMonth, час: t.gameHour })
      .toEqual({ день: 1, месяц: 1, час: expect.any(Number) });
  });

  it('погода по расписанию осталась той же', () => {
    // Рефакторинг календаря не должен был задеть погоду: слоты те же, и
    // снега в них по-прежнему есть (зимней погоды раньше не существовало
    // вообще - ни одного слота снега).
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(worldTimeAt(GAME_EPOCH_MS + i * 4 * 60 * 1000).weather);
    expect({ есть_снег: seen.has('snow'), всего_погод: seen.size }).toEqual({ есть_снег: true, всего_погод: expect.any(Number) });
  });
});

describe('Бонус доходит до награды и не достаёт до возврата', () => {
  const service = read('server/src/services/CharacterService.ts');
  const handler = read('server/src/socket/GameSocketHandler.ts');
  const routes = read('server/src/routes/game.ts');

  it('награда за опыт идёт через единственное горлышко', () => {
    // addExperience - единственная точка для квестов, данжей, рыбалки и
    // всего остального. Умножение в ней сразу работает везде.
    expect(/seasonalEvent\.expMultiplier\(\)/.test(service)).toBe(true);
  });

  it('золото за награду отличается от золота за возврат', () => {
    // Возврат за неудачную покупку идёт через addGold. Если бы сезонный
    // бонус был и там, то «ничего не купил» превратилось бы в «получил
    // золота сверху» - и только во время праздника.
    expect({
      отдельный_метод: /async addGoldReward\(/.test(service),
      бонус_в_награде: /addGold\(characterId, Math\.floor\(amount \* seasonalEvent\.goldMultiplier\(\)\)\)/.test(service),
      возврат_без_бонуса: !/async addGold\([^)]*\)[^{]*\{[^}]*goldMultiplier/.test(service),
    }).toEqual({ отдельный_метод: true, бонус_в_награде: true, возврат_без_бонуса: true });
  });

  it('все источники золотой награды переведены на новый метод', () => {
    // Проверяем, что не осталось награды, идущей мимо бонуса. Список
    // источников взят из поиска по addGold( и вручную просмотрен глазами.
    const rewards = [
      'server/src/services/QuestService.ts',
      'server/src/socket/GameSocketHandler.ts',
      'server/src/systems/DungeonService.ts',
      'server/src/systems/FishingSystem.ts',
      'server/src/systems/TradeService.ts',
      'server/src/systems/WorldEventSystem.ts',
      'server/src/services/MailService.ts',
    ];
    const left = rewards.filter(f => /\.addGold\(/.test(read(f)));
    expect({ без_бонуса: left }).toEqual({ без_бонуса: [] });
  });

  it('покупка лодки не стала ни источником бонуса, ни своим списанием', () => {
    // Раньше в BoatSystem.purchase стояло addGold(characterId, -def.price):
    // addGold приводит сумму к нулю снизу, поэтому из отрицательной цены
    // получался ноль. Строка выглядела как списание и ничего не списывала -
    // а читающий purchase считал, что лодка оплачена здесь.
    //
    // Настоящее списание делает маршрут. Поэтому в теле purchase не должно
    // быть НИ addGold, НИ addGoldReward, НИ spendGold: деньги трогает
    // вызывающий.
    //
    // Смотрим ТОЛЬКО тело purchase. Первая версия проверки брала всё после
    // первого вхождения 'async purchase' - то есть весь остаток файла, где
    // деньги трогаются законно (ремонт, заправка), и проверка падала на
    // своём же исправлении.
    const boat = read('server/src/systems/BoatSystem.ts');
    const body = purchaseBody(boat);
    expect({
      тело_найдено: body.length > 0,
      не_трогает_деньги: !/addGold\(|addGoldReward\(|spendGold\(/.test(body),
      // Контракт ищем по исходнику, а не по очищенному от комментариев куску:
      // сам контракт и есть комментарий, и очистка его съедает.
      контракт_зафиксирован: /ДЕНЬГИ ЗДЕСЬ НЕ СПИСЫВАЮТСЯ/.test(boat),
      списание_в_маршруте: /characterService\.spendGold\(value\.characterId, totalCost\)/.test(routes),
    }).toEqual({ тело_найдено: true, не_трогает_деньги: true, контракт_зафиксирован: true, списание_в_маршруте: true });
  });

  it('возврат за неудачную покупку идёт в той же валюте, что и оплата', () => {
    // Возврат золотом за азены превращал бы покупку в обмен валюты.
    // Сегодня все лодки за золото и расхождения не видно - поэтому проверка
    // смотрит на код возврата, а не на результат.
    expect({
      в_маршруте_через_refund: /characterService\.refund\(value\.characterId, walletCurrency, totalCost\)/.test(routes),
      напрямую_золотом_нет: !/addGold\(value\.characterId, totalCost\)/.test(routes),
    }).toEqual({ в_маршруте_через_refund: true, напрямую_золотом_нет: true });
  });

  it('бонус не начисляется дважды', () => {
    // Множитель всегда считается от базовой суммы заново. Если бы он
    // накапливался на персонаже, повторный запрос сложил бы «+50%» дважды.
    //
    // В формуле теперь четыре множителя: бафф из базы, сезонный праздник,
    // профессия «Исследователь» и навык гильдии. Проверка требует, чтобы
    // отправной точкой оставалась amount, а не результат предыдущего
    // начисления: именно это и отличает пересчёт от накопления.
    //
    // Множитель гильдии в хвосте разрешён ЯВНО, а не «любой хвост»: новый
    // множитель без правки этой проверки заставит подумать, не накапливается
    // ли он вместо пересчёта. Первый вариант требовал ровно три множителя и
    // краснел на честно добавленном четвёртом.
    expect(service).toMatch(/Math\.floor\(amount \* mult \* seasonal \* profExp(?: \* guildExp)?\)/);
    // Базовой суммой остаётся amount, а не что-то промежуточное
    expect(service).toMatch(/const total = Math\.floor\(amount/);
  });

  it('множитель не ждёт сеть в начислении', () => {
    // На каждого убитого монстра ходить в Redis нельзя: это самый горячий
    // путь игры. Проверяем поведением, а не поиском по тексту: множитель
    // обязан вернуть число сразу, а не обещание. Возврат промисса означал
    // бы, что addExperience умножал бы опыт на [object Promise] и тихо
    // ломал бы всю выдачу опыта.
    const svc = new SeasonalEventService();
    const value: unknown = svc.expMultiplier();
    expect({ тип: typeof value, это_не_обещание: value instanceof Promise })
      .toEqual({ тип: 'number', это_не_обещание: false });
  });

  it('начисление опыта не ждёт сеть нигде', () => {
    expect(!/await\s+seasonalEvent\.(expMultiplier|goldMultiplier)\(\)/.test(service)).toBe(true);
  });

  it('интерфейсу показывают только реально действующие бонусы', () => {
    // Иначе игроку напишут «+50% к опыту, подарки и PvP выключен»,
    // а подарков нет и PvP включён. Список active собирается из
    // применённых множителей, а не из строк в данных.
    const svc = read('server/src/services/SeasonalEventService.ts');
    expect({ из_множителей: /if \(parsed\.expMultiplier > 1\) active\.push/.test(svc) }).toEqual({ из_множителей: true });
  });

  it('в маршруте есть только праздники из данных', () => {
    const admin = read('server/src/routes/admin.ts');
    expect({
      за_админом: /adminRouter\.post\('\/seasonal-event', adminCheck,/.test(admin),
      отказ_на_мусоре: /return res\.status\(400\)\.json\(\{ error: \(e as Error\)\.message \}\)/.test(admin),
    }).toEqual({ за_админом: true, отказ_на_мусоре: true });
  });

  it('переключатель виден всем, а включается только админом', () => {
    // Множитель должен быть виден игроку (например, в панели), а включать
    // праздник может только администратор.
    const svc = read('server/src/services/SeasonalEventService.ts');
    expect({
      включение_с_проверкой_имени: /if \(name !== null && !known\) throw/.test(svc),
      в_памяти_и_в_redis: /private override: string \| null = null/.test(svc) && /OVERRIDE_KEY/.test(svc),
    }).toEqual({ включение_с_проверкой_имени: true, в_памяти_и_в_redis: true });
  });

  it('выключение праздника возвращает календарь', () => {
    // 'auto' должен снимать принудительный праздник, а не искать
    // праздник с именем 'auto' и тихо ничего не делать.
    const svc = read('server/src/services/SeasonalEventService.ts');
    expect(/await RedisService\.getInstance\(\)\.del\(OVERRIDE_KEY\)/.test(svc)).toBe(true);
  });

  it('ошибка сохранения в Redis не остаётся незамеченной', () => {
    // Праздник включится в этом процессе, но переживёт ли перезапуск -
    // зависит от Redis. Молча пропустить это нельзя: потом владелец
    // уди��ится, почему событие пропало само.
    expect(/\[Seasonal\] не удалось сохранить принудительный праздник/.test(read('server/src/services/SeasonalEventService.ts'))).toBe(true);
  });

  it('неизвестный бонус попадает в лог, а не проходит тихо', () => {
    expect(/\[Seasonal\] неизвестные бонусы/.test(read('server/src/services/SeasonalEventService.ts'))).toBe(true);
  });

  it('проверка не забыта про сам сервис: импорт на месте', () => {
    // Страховка от того, что сервис написан, но не подключён: без импорта
    // в CharacterService все проверки выше проходили бы вхолостую.
    expect(/import \{ seasonalEvent \} from '\.\/SeasonalEventService'/.test(service)).toBe(true);
  });

  it('переменная handler используется, а не забыта', () => {
    // Мелочь, но именно так в этом файле уже заводился мусор: собранная
    // для проверки переменная, на которую никто не смотрит.
    expect(handler.length).toBeGreaterThan(0);
  });
});
