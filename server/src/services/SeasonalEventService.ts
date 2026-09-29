// Сезонные события: праздник, который наконец действует.
//
// ЧТО БЫЛО. SEASONAL_EVENTS в данных WorldTimeSystem описывал четыре
// праздника, и у каждого был список бонусов строками:
//
//   { name: 'Nowruz', bonuses: ['exp_bonus_50pct', 'gold_bonus_30pct', ...] }
//
// Эти строки не читались НИКОГДА. Ни один бонус нигде не применялся, и
// «Навруз» был строчкой в таблице. Ровно та же история, что с bossId у
// данжей: поле выглядит как работающая, а работы за ним нет.
//
// ПОЧЕМУ ГЛАВНОЕ ПРАВИЛО - «НЕИЗВЕСТНЫЙ КЛЮЧ ГРОМКИЙ».
//
// Три состояния у бонуса, и тремённое не должно выглядеть как сработавшее:
//
//   применён   - бонус честно прибавляется к наградам
//   запланирован - ключ узнаваем, но ещё не сделан (список ниже)
//   НЕИЗВЕСТНЫЙ - опечатка или новый бонус, который никто не умеет
//                  применять. Такой попадает в unknown, а проверка падает.
//                  Иначе через полгода в празднике появился бы бонус
//                  «exp_bonus_30pctx», он бы молча не сработал, и никто бы
//                  не заметил: праздник выглядел бы как праздник.
//
// ПОЧЕМУ МНОЖИТЕЛЬ НЕ НАКАПЛИВАЕТСЯ. Как и в addExperience, сумма всегда
// считается от базового числа заново. Иначе повторный запрос сложил бы
// «+50%» дважды и дал «+100%».
import { SEASONAL_EVENTS, currentSeason, type Season } from '../systems/WorldTimeSystem';
import { RedisService } from './RedisService';
import { logger } from '../utils/logger';

/**
 * Бонусы, которые узнаваемы, но ещё не применяются. Список закрытый и
 * проверяется на актуальность: новый ключ обязан попасть сюда явно, а не
 * молча уйти в неизвестные.
 *
 * Что и почему ещё не сделано:
 *   special_nowruz_items, special_ashura_items — нужна выдача предмета
 *                          праздника, а это разовая награда за сезон: ей
 *                          нужно место, где хранить «выдано ли уже этому
 *                          персонажу», иначе её можно будет собрать сотни
 *                          раз за день.
 *   trade_bonus_40pct, merchant_exp_2x — бонусы торговли: у торговли своя
 *                          экономика, её надо трогать отдельно, а не
 *                          множителем в общей начислялке.
 *   crafting_speed_2x, material_drop_2x — то же про крафт.
 *   pvp_disabled_24h — выключение PvP на сутки: затрагивает проверки зон и
 *                          арены, это отдельная работа.
 */
export const PLANNED_BONUSES = [
  'special_nowruz_items',
  'special_ashura_items',
  'trade_bonus_40pct',
  'merchant_exp_2x',
  'crafting_speed_2x',
  'material_drop_2x',
  'pvp_disabled_24h',
] as const;

export interface ParsedBonuses {
  /** Множитель опыта. 1 - бонуса нет. */
  expMultiplier: number;
  /** Множитель золота. 1 - бонуса нет. */
  goldMultiplier: number;
  /** Ключи, которые не умеет никто. Проверка должна быть зелёной. */
  unknown: string[];
}

const PCT = /^exp_bonus_(\d+)pct$/;
const GOLD_PCT = /^gold_bonus_(\d+)pct$/;

/**
 * Разобрать список бонусов в множители.
 *
 * Чистая функция: считается без базы и без Redis, поэтому её можно проверить
 * целиком - включая случай, когда бонус написан с ошибкой.
 */
export function parseBonuses(bonuses: string[]): ParsedBonuses {
  let exp = 1;
  let gold = 1;
  const unknown: string[] = [];

  for (const raw of bonuses) {
    const key = String(raw).trim();
    const expPct = PCT.exec(key);
    if (expPct) { exp = 1 + Number(expPct[1]) / 100; continue; }
    const goldPct = GOLD_PCT.exec(key);
    if (goldPct) { gold = 1 + Number(goldPct[1]) / 100; continue; }
    if ((PLANNED_BONUSES as readonly string[]).includes(key)) continue;
    unknown.push(key);
  }

  return { expMultiplier: exp, goldMultiplier: gold, unknown };
}

export interface ActiveFestival {
  /** Код праздника: nowruz и так далее, как в данных. */
  name: string;
  nameRu: string;
  season: Season;
  seasonNameRu: string;
  expMultiplier: number;
  goldMultiplier: number;
  /** Бонусы, которые праздник реально даёт: строки для интерфейса. */
  active: string[];
  /** Принудительно включено админом, а не по календарю. */
  forced: boolean;
}

/** Ключ Redis с принудительным праздником. */
const OVERRIDE_KEY = 'seasonal:override';

export class SeasonalEventService {
  /**
   * Принудительный праздник в памяти.
   *
   * В памяти, а не только в Redis, потому что множитель читается на каждом
   * начислении опыта: ходить в Redis ради каждого убитого монстра значило
   * бы добавить сетевой запрос в самый горячий путь игры. Redis нужен для
   * переживания перезапуска, и только для этого.
   */
  private override: string | null = null;
  private loaded = false;

  /** Подставить принудительный праздник. null - вернуться к календарю. */
  async setOverride(name: string | null): Promise<void> {
    const known = name !== null && Object.values(SEASONAL_EVENTS).some(s => s.festivals.some(f => f.name === name));
    if (name !== null && !known) throw new Error(`Неизвестный праздник: ${name}`);
    this.override = name;
    this.loaded = true;
    try {
      if (name) await RedisService.getInstance().set(OVERRIDE_KEY, name);
      else await RedisService.getInstance().del(OVERRIDE_KEY);
    } catch (e) {
      // Праздник включится в этом процессе, но переживёт ли перезапуск -
      // зависит от Redis. Логируем, чтобы это не выглядело тихой поломкой.
      logger.warn('[Seasonal] не удалось сохранить принудительный праздник:', (e as Error).message);
    }
    logger.info(`[Seasonal] праздник: ${name ?? 'по календарю'}`);
  }

  /** Прочитать принудительный праздник из Redis при старте. */
  async loadOverride(): Promise<void> {
    if (this.loaded) return;
    try {
      const value = await RedisService.getInstance().get(OVERRIDE_KEY);
      this.override = value ?? null;
    } catch {
      this.override = null;
    }
    this.loaded = true;
    if (this.override) logger.info(`[Seasonal] вернулся принудительный праздник: ${this.override}`);
  }

  getOverride(): string | null {
    return this.override;
  }

  /**
   * Праздник в указанный момент.
   *
   * Время передаётся параметром, а не берётся внутри: иначе проверить
   * поведение невозможно -Season всегда был бы тем, что сегодня, и
   * «Навруз» нельзя было бы увидеть зимой. Тот же довод, по которому календарь
   * вынесен в чистую функцию.
   */
  getActive(nowMs: number = Date.now()): ActiveFestival | null {
    const forced = this.override;

    // Принудительный праздник ищем по имени среди ВСЕХ сезонов: он может
    // быть не тем, который сейчас по календарю. Иначе «включить Навруз»
    // зимой было бы невозможно, а это ровно то, ради чего переключатель нужен.
    let seasonKey: Season | null = null;
    let festivalName: string | null = null;
    if (forced) {
      for (const key of Object.keys(SEASONAL_EVENTS) as Season[]) {
        if (SEASONAL_EVENTS[key].festivals.some(f => f.name === forced)) {
          seasonKey = key;
          festivalName = forced;
          break;
        }
      }
      if (seasonKey === null) return null;
    } else {
      seasonKey = currentSeason(nowMs);
      festivalName = SEASONAL_EVENTS[seasonKey].festivals[0]?.name ?? null;
      if (festivalName === null) return null;
    }

    const season = SEASONAL_EVENTS[seasonKey];
    const festival = season.festivals.find(f => f.name === festivalName);
    if (!festival) return null;

    const parsed = parseBonuses(festival.bonuses);
    if (parsed.unknown.length > 0) {
      // Не молчим: неизвестный ключ - это либо опечатка, либо новый бонус,
      // который кто-то заявил и не сделал.
      logger.warn(`[Seasonal] неизвестные бонусы у «${festival.nameRu}»: ${parsed.unknown.join(', ')}`);
    }

    const active: string[] = [];
    if (parsed.expMultiplier > 1) active.push(`+${Math.round((parsed.expMultiplier - 1) * 100)}% к опыту`);
    if (parsed.goldMultiplier > 1) active.push(`+${Math.round((parsed.goldMultiplier - 1) * 100)}% к золоту`);

    return {
      name: festival.name,
      nameRu: festival.nameRu,
      season: seasonKey,
      seasonNameRu: season.nameRu,
      expMultiplier: parsed.expMultiplier,
      goldMultiplier: parsed.goldMultiplier,
      active,
      forced: Boolean(forced),
    };
  }

  /** Множитель опыта. 1, когда праздника нет. */
  expMultiplier(nowMs?: number): number {
    return this.getActive(nowMs)?.expMultiplier ?? 1;
  }

  /**
   * Множитель золота. 1, когда праздника нет.
   *
   * ВАЖНО: применяется только к наградам. Через addGold идут и возврат за
   * неудачную покупку, и обычное начисление. Если умножать всё подряд, то
   * возврат во время праздника заплатит больше, чем отдано. Покупки идут
   * через spendGold и этого множителя не касаются.
   */
  goldMultiplier(nowMs?: number): number {
    return this.getActive(nowMs)?.goldMultiplier ?? 1;
  }
}

export const seasonalEvent = new SeasonalEventService();
