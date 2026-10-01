// ============================================================
// Система погоды, времени суток и сезонных событий — Empire of Safavids
// ============================================================

import { RedisService } from '../services/RedisService';
import { logger } from '../utils/logger';

export type TimeOfDay = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'dusk' | 'night' | 'midnight';
export type Season    = 'spring' | 'summer' | 'autumn' | 'winter';
export type Weather   = 'clear' | 'cloudy' | 'rain' | 'storm' | 'sandstorm' | 'fog' | 'snow' | 'wind';

export interface WorldTime {
  gameHour:   number;   // 0–23
  gameDay:    number;   // 1–30
  gameMonth:  number;   // 1–12
  gameYear:   number;
  timeOfDay:  TimeOfDay;
  season:     Season;
  weather:    Weather;
}

// 1 реальная минута = 1 игровой час
const REAL_MINUTES_PER_GAME_HOUR = 1;
const GAME_START_YEAR = 1501; // Начало Сефевидской империи

/**
 * Отсчёт мирового календаря — фиксированная эпоха, а не момент старта
 * процесса.
 *
 * Раньше календарь считался от `serverStartTime`, то есть от `Date.now()`
 * в конструкторе. Из этого следовало, что КАЖДЫЙ перезапуск сервера
 * возвращал мир на первый день первого месяца первого года. Для погоды это
 * было незаметно, а для сезонных событий — неприменимо: игрок видел бы
 * «Навруз», а через минуту после рестарта его бы уже не было, и владелец
 * не смог бы сказать «праздник с 1 по 15 число».
 *
 * Теперь год и месяц зависят только от календаря на стене. Смена сезона
 * приходится примерно раз в 36 реальных часов (сутки игры = 24 минуты,
 * месяц игры = 12 часов, сезон = 36 часов).
 *
 * Эпоха выбрана так, чтобы дата 1 января 2026 давала начало года 1501:
 * отсчёт в игре идёт с настоящего времени, а не с нуля.
 */
export const GAME_EPOCH_MS = Date.parse('2026-01-01T09:00:00Z');

export const WEATHER_EFFECTS: Record<Weather, {
  nameRu: string;
  visibilityMod: number;  // модификатор видимости
  speedMod: number;       // модификатор скорости
  expMod: number;         // модификатор опыта
  spawnMod: number;       // модификатор спавна монстров
  specialMobs: string[];  // уникальные монстры в эту погоду
}> = {
  clear:     { nameRu: 'Ясно',        visibilityMod: 1.0,  speedMod: 1.0,  expMod: 1.0,  spawnMod: 1.0,  specialMobs: [] },
  cloudy:    { nameRu: 'Облачно',     visibilityMod: 0.9,  speedMod: 1.0,  expMod: 1.0,  spawnMod: 1.1,  specialMobs: [] },
  rain:      { nameRu: 'Дождь',       visibilityMod: 0.7,  speedMod: 0.9,  expMod: 1.1,  spawnMod: 1.2,  specialMobs: ['mob_rain_spirit'] },
  storm:     { nameRu: 'Буря',       visibilityMod: 0.4,  speedMod: 0.7,  expMod: 1.3,  spawnMod: 1.5,  specialMobs: ['mob_storm_djinn'] },
  sandstorm: { nameRu: 'Песчаная Буря', visibilityMod: 0.3,  speedMod: 0.6,  expMod: 1.4,  spawnMod: 1.6,  specialMobs: ['mob_sand_div'] },
  fog:       { nameRu: 'Туман',       visibilityMod: 0.5,  speedMod: 0.95, expMod: 1.2,  spawnMod: 1.3,  specialMobs: ['mob_fog_assassin'] },
  snow:      { nameRu: 'Снег',        visibilityMod: 0.6,  speedMod: 0.8,  expMod: 1.15, spawnMod: 0.8,  specialMobs: [] },
  wind:      { nameRu: 'Ветер',       visibilityMod: 0.85, speedMod: 1.0,  expMod: 1.05, spawnMod: 1.1,  specialMobs: [] },
};

export const SEASONAL_EVENTS: Record<Season, {
  nameRu: string;
  festivals: { name: string; nameRu: string; bonuses: string[] }[];
}> = {
  spring: {
    nameRu: 'Весна',
    festivals: [
      { name: 'Nowruz', nameRu: 'Навруз', bonuses: ['exp_bonus_50pct', 'gold_bonus_30pct', 'special_nowruz_items'] },
    ],
  },
  summer: {
    nameRu: 'Лето',
    festivals: [
      { name: 'Silk Road Festival', nameRu: 'Праздник Шёлкового Пути', bonuses: ['trade_bonus_40pct', 'merchant_exp_2x'] },
    ],
  },
  autumn: {
    nameRu: 'Осень',
    festivals: [
      { name: 'Harvest Moon', nameRu: 'Жатвенная Луна', bonuses: ['crafting_speed_2x', 'material_drop_2x'] },
    ],
  },
  winter: {
    nameRu: 'Зима',
    festivals: [
      { name: 'Ashura', nameRu: 'Ашура', bonuses: ['pvp_disabled_24h', 'exp_bonus_100pct', 'special_ashura_items'] },
    ],
  },
};

/**
 * Календарь мира на момент `nowMs`.
 *
 * Вынесено отдельной функцией, а не осталось методом, по двум причинам.
 * Первая: сезон нужен в местах, где WorldTimeSystem недоступен, - в
 * начислении опыта и золота, откуда до GameLoop не дотянуться. Вторая:
 * считать дату должна быть возможность без Redis, иначе проверка даты
 * требовала бы живого соединения.
 */
export function worldTimeAt(nowMs: number, weatherOverride?: Weather | null): WorldTime {
  const elapsedMinutes = Math.max(0, (nowMs - GAME_EPOCH_MS) / 60000);
  const totalGameHours = Math.floor(elapsedMinutes / REAL_MINUTES_PER_GAME_HOUR);

  const gameHour  = totalGameHours % 24;
  const totalDays = Math.floor(totalGameHours / 24);
  const gameDay   = (totalDays % 30) + 1;
  const totalMonths = Math.floor(totalDays / 30);
  const gameMonth = (totalMonths % 12) + 1;
  const gameYear  = GAME_START_YEAR + Math.floor(totalMonths / 12);

  return {
    gameHour,
    gameDay,
    gameMonth,
    gameYear,
    timeOfDay:  timeOfDayOf(gameHour),
    season:     seasonOf(gameMonth),
    weather:    weatherOverride ?? currentWeather(nowMs),
  };
}

/** Сезон по номеру игрового месяца: 3–5 весна, 6–8 лето, 9–11 осень, остальное зима. */
export function seasonOf(gameMonth: number): Season {
  if (gameMonth >= 3 && gameMonth <= 5)  return 'spring';
  if (gameMonth >= 6 && gameMonth <= 8)  return 'summer';
  if (gameMonth >= 9 && gameMonth <= 11) return 'autumn';
  return 'winter';
}

/** Сезон прямо сейчас. Считается, а не хранится, поэтому перезапуск его не сбрасывает. */
export function currentSeason(nowMs: number = Date.now()): Season {
  return worldTimeAt(nowMs).season;
}

function timeOfDayOf(hour: number): TimeOfDay {
  if (hour >= 5  && hour < 7)  return 'dawn';
  if (hour >= 7  && hour < 12) return 'morning';
  if (hour >= 12 && hour < 14) return 'noon';
  if (hour >= 14 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 21) return 'dusk';
  if (hour >= 21 || hour < 2)  return 'night';
  return 'midnight';
}

export class WorldTimeSystem {
  private redis = RedisService.getInstance();

  getCurrentWorldTime(): WorldTime {
    // Ручная погода админа важнее расписания, поэтому передаём её дальше.
    // Забыть здесь про weatherOverride - значит тихо вернуть поломку, которую
    // чинили в прошлый раз: кнопка «снег» в админке нажимается, а в игре
    // продолжает идти дождь.
    return worldTimeAt(Date.now(), this.weatherOverride);
  }

  /**
   * Ручная установка погоды из админ-панели: держим её, пока не вернут
   * автоматический режим (null). Нужно, чтобы можно было сразу посмотреть
   * все погодные эффекты, не дожидаясь 4-минутного слота расписания.
   */
  private weatherOverride: Weather | null = null;

  setWeatherOverride(kind: Weather | null): void {
    this.weatherOverride = kind;
    logger.info(`[WorldTime] Погода: ${kind ?? 'авто (по расписанию)'}`);
  }

  getWeatherOverride(): Weather | null {
    return this.weatherOverride;
  }

  async broadcastWorldTime(): Promise<void> {
    const time = this.getCurrentWorldTime();
    await this.redis.publish('world:time_update', time);
    logger.debug(`World time: ${time.gameYear}/${time.gameMonth}/${time.gameDay} ${time.gameHour}:00 (${time.timeOfDay}, ${time.weather})`);
  }
}

/**
 * Погода по расписанию: слоты по 4 минуты, погода заметно меняется прямо
 * во время игры. Раньше слот был 30 минут — дождь или бурю можно было не
 * дождаться за сессию.
 *
 * Вынесено отдельной функцией, чтобы worldTimeAt считался без Redis и без
 * экземпляра системы: сезон нужен в начислении опыта, где до GameLoop не
 * дотянуться.
 */
/**
 * Погода по сезонам.
 *
 * ЧТО БЫЛО, и почему это было неправильно. Погода бралась из ОДНОГО списка
 * на 30 слотов, и сезон в формулу не входил вообще:
 *   const idx = Math.floor(nowMs / (4 * 60 * 1000)) % weathers.length;
 * Список был один и тот же круглый год, поэтому снег шёл летом, а дождь
 * зимой. Это не ошибка отрисовки: клиент рисовал ровно ту погоду, которую
 * прислал сервер. Несоответствие было в самом расписании, и заметить его
 * можно было только играя.
 *
 * Теперь на каждый сезон своя таблица. Правила, видные игроку:
 *   - снег бывает ТОЛЬКО зимой;
 *   - песчаная буря бывает ТОЛЬКО летом;
 *   - в разгар зимы дождя нет - вместо него снег;
 *   - летом дождя мало: засуха, ветер, пыль и грозы.
 *
 * Длина всех таблиц одинакова (30 слотов по 4 минуты = 2 часа на круг
 * погоды сезона). Одинаковая длина нужна, чтобы смена сезона не сдвигала
 * ритм: игрок, ждавший бурю, получит её и в новое время года.
 *
 * Экспорт таблицы нужен проверкам: она и есть замысел, который обязан
 * стоять в данных, а не собираться на лету.
 */
export const SEASON_WEATHER: Record<Season, Weather[]> = {
  // Весна (месяцы 3–5): мягко, дожди, туманы по утрам. Без снега и пыли.
  spring: [
    'clear', 'clear', 'cloudy', 'rain', 'clear', 'wind',
    'cloudy', 'rain', 'clear', 'clear', 'fog', 'rain',
    'clear', 'cloudy', 'wind', 'rain', 'clear', 'clear',
    'cloudy', 'rain', 'fog', 'clear', 'wind', 'clear',
    'clear', 'rain', 'cloudy', 'clear', 'clear', 'rain',
  ],
  // Лето (6–8): зной, ясно, ветер и песчаные бури. Грозы, и почти нет дождя.
  summer: [
    'clear', 'clear', 'clear', 'wind', 'sandstorm', 'clear',
    'clear', 'cloudy', 'sandstorm', 'clear', 'clear', 'wind',
    'clear', 'storm', 'clear', 'sandstorm', 'clear', 'clear',
    'wind', 'clear', 'sandstorm', 'clear', 'cloudy', 'clear',
    'clear', 'clear', 'storm', 'clear', 'sandstorm', 'clear',
  ],
  // Осень (9–11): подсыхает, дожди, туман. Пыли и снега нет.
  autumn: [
    'clear', 'cloudy', 'rain', 'clear', 'fog', 'clear',
    'cloudy', 'rain', 'wind', 'clear', 'clear', 'cloudy',
    'rain', 'clear', 'fog', 'clear', 'cloudy', 'rain',
    'clear', 'wind', 'clear', 'rain', 'cloudy', 'clear',
    'clear', 'clear', 'fog', 'rain', 'clear', 'clear',
  ],
  // Зима (12–2): холодно, снег, облака, туман. Ни дождя, ни пыли.
  winter: [
    'snow', 'cloudy', 'snow', 'clear', 'fog', 'snow',
    'cloudy', 'snow', 'clear', 'snow', 'cloudy', 'clear',
    'snow', 'cloudy', 'clear', 'fog', 'snow', 'clear',
    'snow', 'cloudy', 'snow', 'clear', 'cloudy', 'clear',
    'snow', 'clear', 'fog', 'snow', 'cloudy', 'clear',
  ],
};

/**
 * Номер игрового месяца без вызова worldTimeAt.
 *
 * Выделено отдельно не из красоты: worldTimeAt сам вызывает currentWeather,
 * и если бы тот стал считать дату через worldTimeAt, получилась бы
 * бесконечная рекурсия. Здесь нужен только месяц - ровно то, что требуется
 * сезону.
 */
function gameMonthAt(nowMs: number): number {
  const elapsedMinutes = Math.max(0, (nowMs - GAME_EPOCH_MS) / 60000);
  const totalGameHours = Math.floor(elapsedMinutes / REAL_MINUTES_PER_GAME_HOUR);
  const totalMonths = Math.floor(totalGameHours / 24 / 30);
  return (totalMonths % 12) + 1;
}

/** Погода по расписанию сезона. Слот - 4 минуты. */
export function currentWeather(nowMs: number = Date.now()): Weather {
  const таблица = SEASON_WEATHER[seasonOf(gameMonthAt(nowMs))];
  const idx = Math.floor(nowMs / (4 * 60 * 1000)) % таблица.length;
  return таблица[idx];
}

/**
 * Множитель опыта по погоде.
 *
 * ЧТО БЫЛО. WEATHER_EFFECTS объявлял expMod у каждой погоды («в дождь
 * опыта на 10% больше»), и поле не читалось нигде: дождь менял небо в
 * клиенте и скорость респавна у точек с weatherBonus, но опыт шёл
 * ровно по базовой ставке. Объявленный бонус был пустым.
 *
 * ПОЧЕМУ currentWeather, А НЕ ЭКЗЕМПЛЯР WorldTimeSystem. Начисление
 * опыта идёт из CharacterService, до GameLoop не дотянуться, поэтому
 * берётся функция без Redis - так же, как seasonOf рядом.
 *
 * ЧЕСТНОЕ ОГРАНИЧЕНИЕ. Ручная погода админа живёт в экземпляре
 * WorldTimeSystem, и эта функция её не видит: она всегда считает по
 * расписанию. То есть нажал админ «бурю» - небо и монстры станут
 * бурными, а опыт пойдёт по расписанию. Обратная связь проверяется на
 * живом игроке, а не на админском предпросмотре, и это осознанно:
 * общий доступ к погоде потребовал бы глобального состояния там, где
 * раньше его не было.
 */
export function weatherExpMultiplier(nowMs: number = Date.now()): number {
  return WEATHER_EFFECTS[currentWeather(nowMs)].expMod;
}
