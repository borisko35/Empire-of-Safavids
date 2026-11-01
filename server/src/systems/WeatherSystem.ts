// ============================================================
// Система погоды — Empire of Safavids
// ============================================================
// Управление типом погоды и её эффектами на передвижение,
// видимость и бой.

export type WeatherType = 'clear' | 'rain' | 'snow' | 'fog';

export interface WeatherState {
  type: WeatherType;
  /** Время до смены погоды в секундах (с сервера) */
  timeLeftSec: number;
  /** Общий счетчик секунд текущей погоды */
  totalSec: number;
  /** Кто устанавливал погоду: 'admin' или 'auto' */
  setBy: 'admin' | 'auto';
}

export const WEATHER_TYPES: WeatherType[] = ['clear', 'rain', 'snow', 'fog'];

export const WEATHER_CYCLE_SEC = 900; // 15 минут real-time на одну погоду

// Состояния погоды с эффектами
export const WEATHER: Record<WeatherType, WeatherState> = {
  clear: {
    type: 'clear',
    timeLeftSec: WEATHER_CYCLE_SEC,
    totalSec: 0,
    setBy: 'auto',
  },
  rain: {
    type: 'rain',
    timeLeftSec: WEATHER_CYCLE_SEC,
    totalSec: 0,
    setBy: 'auto',
  },
  snow: {
    type: 'snow',
    timeLeftSec: WEATHER_CYCLE_SEC,
    totalSec: 0,
    setBy: 'auto',
  },
  fog: {
    type: 'fog',
    timeLeftSec: WEATHER_CYCLE_SEC,
    totalSec: 0,
    setBy: 'admin',
  },
};

// Эффекты погоды на передвижение (доля от максимальной скорости)
export const MOVEMENT_PENALTIES: Record<WeatherType, number> = {
  clear: 1.0,      // Без штрафа
  rain: 0.85,      // -15% скорости
  snow: 0.70,      // -30% скорости
  fog: 1.0,        // Туман не влияет на скорость
};

// Эффекты погоды на радиус обзора (умножитель обычного радиуса)
export const VISION_PENALTIES: Record<WeatherType, number> = {
  clear: 1.0,
  rain: 0.90,   // -10% видимости
  snow: 0.60,   // -40% видимости
  fog: 0.60,    // -40% видимости
};

// Эффекты погоды на шанс критического удара
export const CRIT_CHANCE_PENALTIES: Record<WeatherType, number> = {
  clear: 1.0,
  rain: 0.95,   // -5% крит в дождь
  snow: 0.90,   // -10% крит в снег
  fog: 1.0,     // Туман не влияет на крит
};

// Эффекты погоды на шанс промаха (для стрелков)
export const MISS_CHANCE_PENALTIES: Record<WeatherType, number> = {
  clear: 0.0,
  rain: 0.10,   // +10% шанс промаха в дождь
  snow: 0.15,   // +15% шанс промаха в снег
  fog: 0.12,    // +12% шанс промаха в тумане
};

// Эффекты погоды на модификаторы анти-чита
export const ANTICHEAT_MODIFIERS: Record<WeatherType, number> = {
  clear: 1.0,
  rain: 0.98,
  snow: 0.97,
  fog: 0.99,
};

// Текущая погода в мире (по умолчанию ясно)
export let currentWeather: WeatherState = { ...WEATHER.clear };

/** Получить текущий множитель скорости с учетом погоды */
export function getMovementMultiplier(): number {
  return MOVEMENT_PENALTIES[currentWeather.type];
}

/** Получить множитель радиуса обзора */
export function getVisionMultiplier(): number {
  return VISION_PENALTIES[currentWeather.type];
}

/** Получить штраф к шансу критического удара */
export function getCritPenalty(): number {
  return CRIT_CHANCE_PENALTIES[currentWeather.type];
}

/** Получить штраф к шансу промаха (для стрелков) */
export function getMissChanceMultiplier(): number {
  return MISS_CHANCE_PENALTIES[currentWeather.type];
}

/** Получить модификатор для анти-чета */
export function getAnticheatModifier(): number {
  return ANTICHEAT_MODIFIERS[currentWeather.type];
}

/** Сменить погоду на новую (вызывается таймером или админской командой) */
export function setWeather(type: WeatherType, setBy: 'admin' | 'auto' = 'admin'): WeatherState {
  currentWeather = { ...WEATHER[type], timeLeftSec: WEATHER_CYCLE_SEC, totalSec: 0, setBy };
  return currentWeather;
}

/** Сбросить погоду до ясного состояния */
export function clearWeather(): void {
  currentWeather = { ...WEATHER.clear };
}

/** Получить текущую погоду */
export function getCurrentWeather(): WeatherState {
  return { ...currentWeather };
}