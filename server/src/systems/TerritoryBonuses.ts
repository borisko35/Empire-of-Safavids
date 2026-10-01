// Бонусы владельцу территории — Empire of Safavids
// ============================================================
// ЧТО БЫЛО. TerritoryDefinition.bonuses объявлены в data/guilds.ts у всех
// четырёх территорий: trade_tax, gold_income, exp_bonus, craft_speed,
// pvp_damage, defense_bonus, sea_speed. Ни один не читался никем во всём
// проекте. Поиск trade_tax давал два совпадения - оба в самом файле данных.
//
// Это та же болезнь, что была с боссами данжей (bossId, которого не было в
// списке), бонусами сезонных праздников и счётчиком убийств в рейтинге:
// поле выглядит как работающая функция и молчит. Территория при этом была
// объявлена, осады теперь есть и захват меняет владельца - то есть владение
// стало настоящим, и бонус за него стал бы применим.
//
// ПОЧЕМУ ПОДКЛЮЧЁН РОВНО ОДИН ВИД: exp_bonus.
//
// У остальных шести в проекте нет точки применения, которую можно было бы
// подключить, не сломав и не выдумав:
//
//   trade_tax    - где брать налог. Есть аукцион, торговые контракты и
//                  караваны, но все три считают свою цену по своим
//                  правилам. Единой точки «сделка состоялась» нет, а
//                  придумывать её значит облагать только одну сторону.
//   gold_income  - сколько золота в час и откуда. Это фоновая экономика:
//                  нужен таймер и правило начисления, которых нет.
//   craft_speed  - скорость крафта уже считается навыком гильдии
//                  (guild_craft_speed). Второе применение того же множителя
//                  завело бы две правды об одном числе.
//   pvp_damage   - урон в PvP считается в KappaSystem, у него своя шкала.
//   defense_bonus- нет боя за крепость, к которому это относилось бы.
//   sea_speed    - скорость в лодках считается в BoatService.
//
// НЕПОДКЛЮЧЁННЫЕ ВИДЫ НЕ ВЫБРАСЫВАЮТСЯ МОЛЧА: бонусВида обязан отказать
// на неизвестном виде, а проверитьСправочник обязан назвать неподключённые
// один раз при старте. Иначе правка в данных дала бы бонус, которого никто
// не применяет, и это обнаружилось бы через полгода по жалобе игрока.

import { TERRITORIES, type TerritoryDefinition } from '../data/guilds';
import { DatabaseService } from '../services/DatabaseService';
import { logger } from '../utils/logger';

/** Виды бонусов, объявленные в TerritoryDefinition.bonuses. */
export type TerritoryBonusType =
  | 'trade_tax' | 'gold_income' | 'exp_bonus' | 'craft_speed'
  | 'pvp_damage' | 'defense_bonus' | 'sea_speed';

/**
 * Подключённые виды бонусов.
 *
 * Закрытый список, как WIRED_EFFECTS у навыков гильдий, и по той же
 * причине: за вид без точки применения платить нельзя.
 */
export const WIRED_TERRITORY_BONUSES: readonly TerritoryBonusType[] = ['exp_bonus'];

/** Все виды, которые встречаются в справочнике. */
const ИЗВЕСТНЫЕ: readonly string[] = [
  'trade_tax', 'gold_income', 'exp_bonus', 'craft_speed',
  'pvp_damage', 'defense_bonus', 'sea_speed',
];

/** Бонуса нет: множитель равен единице. */
export const НЕЙТРАЛЬНО: TerritoryBonus = { exp: 1 };

export interface TerritoryBonus {
  /** Множитель опыта. 1 - без бонуса, больше 1 - выгоднее. */
  exp: number;
}

export class TerritoryBonusError extends Error {
  constructor(public readonly вид: string) {
    super(`TERRITORY_BONUS_UNWIRED: ${вид}`);
    this.name = 'TerritoryBonusError';
  }
}

/**
 * Доля по виду из данных.
 *
 * Отказ, а не возврат нуля на неизвестном виде: молчаливый нойль - это ошибка,
 * которая выглядит как «бонуса нет», а на деле это опечатка в данных или
 * забытая точка применения. Такой случай обязан быть виден.
 */
export function бонусВида(вид: string, значение: number): number {
  if (!WIRED_TERRITORY_BONUSES.includes(вид as TerritoryBonusType)) {
    throw new TerritoryBonusError(вид);
  }
  if (!Number.isFinite(значение)) return 0;
  return значение;
}

/**
 * Сумма долей по виду у одной территории.
 *
 * Несколько строк одного вида складываются: в данных такого нет, но сложение
 * - единственное поведение, при котором добавление строки в справочник не
 * потребует правки кода.
 */
export function долиТерритории(территория: TerritoryDefinition, вид: TerritoryBonusType): number {
  return территория.bonuses
    .filter((б) => б.type === вид)
    .reduce((сумма, б) => сумма + (Number.isFinite(б.value) ? б.value : 0), 0);
}

/**
 * Бонус по виду для списка территорий.
 *
 * Доли складываются, а потом из них собирается множитель. Сложение
 * множителей дало бы (1+a)·(1+b) вместо 1+a+b, и две территории по +10%
 * дали бы +21% вместо +20%: ошибка тихо росла бы с каждой новой
 * территорией в регионе.
 *
 * Пустой список - это «владельца нет»: результат единица, а не ноль.
 * Нулевой множитель был бы наказанием за то, что территория никем не
 * занята, и убил бы опыт игроку, который просто не в гильдии.
 */
export function territoryBonuses(
  территории: TerritoryDefinition[],
  вид: TerritoryBonusType,
): number {
  const доли = территории.reduce((сумма, т) => сумма + долиТерритории(т, вид), 0);
  return 1 + бонусВида(вид, доли);
}

/**
 * Срок кэша владельцев.
 *
 * Почему кэш: бонус нужен на каждом добивании каждого игрока в каждом
 * регионе. Запрос в базу на каждый удар поставил бы бой на паузу - тот же
 * грех, что с гильдейскими заданиями, и там поэтому стоит void без await.
 *
 * 30 секунд означает, что смена владельца видна почти сразу, но не
 * мгновенно. Честная граница в коде лучше обещания мгновенности, которого
 * не будет.
 */
const СРОК_КЭША_МС = 30_000;

interface ЗаписьКэша {
  владельцы: Map<string, string | null>;
  истекло: number;
}

export class TerritoryBonuses {
  private static instance: TerritoryBonuses;

  private db = DatabaseService.getInstance();
  private кэш: ЗаписьКэша | null = null;
  private видыВДанных: string[] = [];

  static getInstance(): TerritoryBonuses {
    if (!TerritoryBonuses.instance) {
      TerritoryBonuses.instance = new TerritoryBonuses();
    }
    return TerritoryBonuses.instance;
  }

  /**
   * Назвать виды, для которых нет точки применения.
   *
   * Вызывается при старте, чтобы новый вид в справочнике не ждал полгода
   * жалобы игрока.
   */
  проверитьСправочник(): void {
    this.видыВДанных = видыИзДанных();
    const неподключённые = неподключённыеВиды();
    if (неподключённые.length > 0) {
      logger.warn(
        `[TerritoryBonuses] виды бонусов без точки применения: ${неподключённые.join(', ')}.`
        + ' Они объявлены в данных, но не применяются.',
      );
    }
  }

  /** Виды, встречающиеся в справочнике прямо сейчас. */
  get виды(): readonly string[] {
    return this.видыВДанных;
  }

  /** Сбросить кэш. После смены владельца и в проверках. */
  сбросить(): void {
    this.кэш = null;
  }

  /**
   * Бонусы гильдии игрока в его регионе.
   *
   * Без гильдии или без владения территорией - нейтрально: у одиночки нет
   * нации, которую можно обогащать, но и опыт у него должен быть обычный.
   */
  async бонусыИгрока(characterId: string, region: string): Promise<TerritoryBonus> {
    const герой = await this.db.queryOne<{ guild_id: string | null }>(
      `SELECT guild_id FROM characters WHERE id = $1`,
      [characterId],
    );
    if (герой?.guild_id == null) return НЕЙТРАЛЬНО;

    const владельцы = await this.владельцы();
    // Именно с проверкой региона: без неё базар в Тебризе дал бы +10% опыта
    // в Исфахане, то есть территория действовала бы там, где её нет.
    const мои = TERRITORIES.filter(
      (т) => т.region === region && владельцы.get(т.id) === герой.guild_id,
    );
    if (мои.length === 0) return НЕЙТРАЛЬНО;
    return { exp: territoryBonuses(мои, 'exp_bonus') };
  }

  /** Бонус по региону для начисления опыта. */
  async бонусыРегиона(region: string): Promise<TerritoryBonus> {
    const владельцы = await this.владельцы();
    const вРегионе = TERRITORIES.filter((т) => т.region === region && владельцы.get(т.id));
    if (вРегионе.length === 0) return НЕЙТРАЛЬНО;
    return { exp: territoryBonuses(вРегионе, 'exp_bonus') };
  }

  /** id -> guild_id, с кэшем на СРОК_КЭША_МС. */
  private async владельцы(): Promise<Map<string, string | null>> {
    const сейчас = Date.now();
    if (this.кэш !== null && сейчас < this.кэш.истекло) return this.кэш.владельцы;
    const строки = await this.db.query<{ territory_id: string; guild_id: string | null }>(
      `SELECT territory_id, guild_id FROM guild_territories`,
    );
    const владельцы = new Map(строки.map((с) => [с.territory_id, с.guild_id]));
    this.кэш = { владельцы, истекло: сейчас + СРОК_КЭША_МС };
    return владельцы;
  }
}

/** Виды, встречающиеся в справочнике. */
export function видыИзДанных(): string[] {
  const все = new Set<string>();
  for (const территория of TERRITORIES) {
    for (const бонус of территория.bonuses) все.add(бонус.type);
  }
  return [...все].sort();
}

/** Виды без точки применения. */
export function неподключённыеВиды(): string[] {
  return видыИзДанных().filter((в) => !WIRED_TERRITORY_BONUSES.includes(в as TerritoryBonusType));
}

/** Настоящий ли вид: не выдуман ли справочником. */
export function видИзвестен(вид: string): boolean {
  return ИЗВЕСТНЫЕ.includes(вид);
}
