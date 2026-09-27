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

export class WorldTimeSystem {
  private redis = RedisService.getInstance();
  private serverStartTime = Date.now();

  getCurrentWorldTime(): WorldTime {
    const elapsedMinutes = (Date.now() - this.serverStartTime) / 60000;
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
      timeOfDay:  this.getTimeOfDay(gameHour),
      season:     this.getSeason(gameMonth),
      weather:    this.getCurrentWeather(),
    };
  }

  private getTimeOfDay(hour: number): TimeOfDay {
    if (hour >= 5  && hour < 7)  return 'dawn';
    if (hour >= 7  && hour < 12) return 'morning';
    if (hour >= 12 && hour < 14) return 'noon';
    if (hour >= 14 && hour < 18) return 'afternoon';
    if (hour >= 18 && hour < 21) return 'dusk';
    if (hour >= 21 || hour < 2)  return 'night';
    return 'midnight';
  }

  private getSeason(month: number): Season {
    if (month >= 3 && month <= 5)  return 'spring';
    if (month >= 6 && month <= 8)  return 'summer';
    if (month >= 9 && month <= 11) return 'autumn';
    return 'winter';
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

  private getCurrentWeather(): Weather {
    // Ручной режим админа важнее расписания
    if (this.weatherOverride) return this.weatherOverride;
    // Слоты по 4 минуты: погода заметно меняется прямо во время игры.
    // Раньше было 30 минут — дождь/бурю можно было не дождаться за сессию.
    // Снега в таблице не было НИ ОДНОГО слота: клиент его всё равно не умел
    // рисовать, поэтому «зимней» погоды в игре просто не существовало.
    // Цикл теперь 30 слотов (2 часа) — разнообразие заметно богаче.
    const weathers: Weather[] = [
      'clear', 'clear', 'clear', 'cloudy', 'cloudy', 'wind',
      'rain', 'rain', 'cloudy', 'fog', 'storm', 'clear',
      'sandstorm', 'wind', 'clear', 'rain', 'storm', 'snow',
      'clear', 'cloudy', 'rain', 'snow', 'wind', 'clear',
      'cloudy', 'fog', 'clear', 'clear', 'rain', 'snow',
    ];
    const idx = Math.floor(Date.now() / (4 * 60 * 1000)) % weathers.length;
    return weathers[idx];
  }

  async broadcastWorldTime(): Promise<void> {
    const time = this.getCurrentWorldTime();
    await this.redis.publish('world:time_update', time);
    logger.debug(`World time: ${time.gameYear}/${time.gameMonth}/${time.gameDay} ${time.gameHour}:00 (${time.timeOfDay}, ${time.weather})`);
  }
}
