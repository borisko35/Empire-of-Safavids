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
//   craft_speed  - скорость крафта уже считается навыком гильдии
//                  (guild_craft_speed). Второе применение того же множителя
//                  завело бы две правды об одном числе.
//   pvp_damage   - урон в PvP считается в KappaSystem, у него своя шкала.
//   defense_bonus- нет боя за крепость, к которому это относилось бы.
//   sea_speed    - скорость в лодках считается в BoatService.
//
// И ДВА ИЗМЕНЕНИЯ, оба по решению владельца.
//   trade_tax    - точка применения появилась, когда достройка Шелкова пути
//                  (§179) дала каравану доставку и засаду. Налог с чужих
//                  караванов платит гильдия, держущая территорию: см.
//                  налогКаравана ниже.
//   gold_income  - таймер появился в §184: начислитьДоход раз в час, владельцу
//                  захваченной территории, с отметкой в базе, чтобы перезапуск
//                  не съедал накопленный срок.
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
 *
 * `trade_tax` добавлен в §181: точка применения появилась вместе с
 * достройкой Шёлкого пути — караван, прибывший в регион с такой территорией,
 * платит налог её владельцу.
 */
export const WIRED_TERRITORY_BONUSES: readonly TerritoryBonusType[] = ['exp_bonus', 'trade_tax', 'gold_income'];

/**
 * Раз в сколько минут гильдия получает доход с территории.
 *
 * ЧАС, а не сутки. В данных стоит 1000–5000 за период, а контракт даёт
 * 450–1200 за выполненную работу с риском. При часовом периоде владение
 * землёй становится серьёзным активом — а осады идут раз в неделю, и
 * победитель получает между ними около сотни выплат. Это много; если
 * владельцу покажется слишком, меняется ОДНО число здесь и больше нигде.
 */
export const ДОХОД_ПЕРИОД_МИНУТ = 60;

export interface НачислениеДохода {
  territoryId: string;
  guildId: string;
  territoryNameRu: string;
  gold: number;
}

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

  /**
   * Налог с каравана, прибывшего в регион.
   *
   * ПОЧЕМУ ПОЯВИЛСЯ ТОЛЬКО СЕЙЧАС. Вид был объявлен в данных с самого начала
   * и отключён с записанным объяснением: «единой точки "сделка состоялась"
   * нет». Точка появилась, когда достройка Шёлкого пути (§179) дала каравану
   * два места, где сделка заведомо состоялась: доставка и удавшаяся засада.
   * Берётся первое — доставка. Ограбление не облагается: там налог брал бы
   * не с торговца, а уже с ограбленного, и победитель засады уходил бы
   * минус процент из чужой добычи. Это выглядело бы как произвол.
   *
   * СВОЙ КАРАВАН СВОЕЙ ГИЛЬДИИ НЕ ОБЛАГАЕТСЯ. Гильдия не берёт пошлину с
   * самой себя — иначе владение территорией было бы не выгодой, а
   * обложением.
   *
   * Возвращает null, если налог не берёт никто: территория свободна,
   * ставки нет или доставляющий состоит в той же гильдии.
   */
  async налогКаравана(
    characterId: string,
    region: string,
  ): Promise<{ guildId: string; rate: number; territoryNameRu: string } | null> {
    const владельцы = await this.владельцы();
    const мояГильдия = await this.db.queryOne<{ guild_id: string | null }>(
      `SELECT guild_id FROM characters WHERE id = $1`,
      [characterId],
    );
    const своейГильдииId = мояГильдия?.guild_id ?? null;

    const облагаемые = TERRITORIES.filter(
      (т) => т.region === region && владельцы.get(т.id) != null,
    );
    let ставка = 0;
    let территория: TerritoryDefinition | null = null;
    for (const т of облагаемые) {
      const бонус = т.bonuses.find((б) => б.type === 'trade_tax');
      if (!бонус) continue;
      // Ставки складываются, если регион достанется нескольким территориям:
      // сейчас такая одна, но сложение не молчит при добавлении второй.
      ставка += бонус.value;
      территория = т;
    }
    if (!ставка || !территория) return null;

    const guildId = владельцы.get(территория.id)!;
    if (guildId === своейГильдииId) return null;
    return { guildId, rate: ставка, territoryNameRu: территория.nameRu };
  }

  /**
   * Выдать доход за прошедшие периоды.
   *
   * ПРОХОДИТ ПО ВСЕМ ЗАХВАЧЕННЫМ ТЕРРИТОРИЯМ, а не по одной: иначе четыре
   * территории с разными суммами платили бы по очереди, и три из четырёх
   * молчали бы.
   *
   * ПЛАТИТ ТОЛЬКО ВЛАДЕЛЕЦ И ТОЛЬКО ЗА ЦЕЛЫЕ ПЕРИОДЫ. Территория без
   * владельца не платит никому; задержка в два периода выдаёт две выплаты,
   * а не одну — иначе сервер, простоявший сутки, тихо съедал бы доход.
   *
   * ПРОВЕРКА ЖИВЫХ: `defense_hp > 0`. Павшая территория стоимости не имеет,
   * и платить за неё — платить за пустоту.
   *
   * ОТМЕТКА ВРЕМЕНИ ДВИГАЕТСЯ В ТОЙ ЖЕ ТРАНЗАКЦИИ, ЧТО И ВЫПЛАТА, И С
   * ПРОВЕРКОЙ СТАРОГО ЗНАЧЕНИЯ. Иначе выплата прошла, а отметка не
   * сдвинулась — и следующий тик заплатил бы снова. Сдвиг на выданные
   * периоды, а не в NOW(): «в NOW()» съело бы дробный остаток при каждом
   * тике, и со временем доход таял бы.
   */
  async начислитьДоход(): Promise<НачислениеДохода[]> {
    const строки = await this.db.query<{
      territory_id: string;
      guild_id: string | null;
      defense_hp: number;
      last_income_at: Date;
    }>(
      `SELECT territory_id, guild_id, defense_hp, last_income_at
         FROM guild_territories
        WHERE guild_id IS NOT NULL AND defense_hp > 0`,
    );

    const выдано: НачислениеДохода[] = [];
    for (const строка of строки) {
      const территория = TERRITORIES.find((т) => т.id === строка.territory_id);
      if (!территория) continue;
      const бонус = территория.bonuses.find((б) => б.type === 'gold_income');
      if (!бонус) continue;

      const было = new Date(строка.last_income_at).getTime();
      const периодов = Math.floor((Date.now() - было) / (ДОХОД_ПЕРИОД_МИНУТ * 60_000));
      if (периодов < 1) continue;

      const сумма = бонус.value * периодов;
      const новаяОтметка = new Date(было + периодов * ДОХОД_ПЕРИОД_МИНУТ * 60_000).toISOString();
      let записано = false;
      try {
        записано = await this.db.transaction(async (client) => {
          const сдвиг = await client.query(
            `UPDATE guild_territories SET last_income_at = $3
              WHERE territory_id = $1 AND last_income_at = $2`,
            [строка.territory_id, new Date(было).toISOString(), новаяОтметка],
          );
          if (сдвиг.rowCount === 0) return false;
          await client.query(
            `UPDATE guilds SET gold = gold + $2, updated_at = NOW() WHERE id = $1`,
            [строка.guild_id, сумма],
          );
          return true;
        });
      } catch (e) {
        // Молчать здесь нельзя: гильдия, которой не платят, об этом не
        // узнает, и владение территорией перестанет что-то значить — точно
        // тот класс поломки, что прятался в молчании в §176.
        logger.error('[TerritoryBonuses] доход не начислен:', (e as Error).message);
        continue;
      }
      if (!записано) continue;

      выдано.push({
        territoryId: строка.territory_id,
        guildId: строка.guild_id!,
        territoryNameRu: территория.nameRu,
        gold: сумма,
      });
      logger.info(
        `[TerritoryBonuses] «${территория.nameRu}»: гильдии ${строка.guild_id} ` +
        `начислено ${сумма} за ${периодов} период(ов)`,
      );
    }
    return выдано;
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
