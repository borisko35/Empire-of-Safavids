// ============================================================
// Осады территорий гильдий — Empire of Safavids
// ============================================================
// ЧТО БЫЛО. Четыре территории объявлены в data/guilds.ts (очки захвата,
// очки защиты, расписание), таблица guild_territories создана миграцией 002
// и засеяна этими id. Но читать её не читал никто: поиск territory_id по
// всему проекту даёт только сами миграции. Уведомление siege_starting было
// объявлено в NotificationService и не отправлялось ни разу за всю историю.
// Дорожная карта обещала «осады выходных», а их не было ни в данных, ни в
// коде.
//
// ПОЧЕМУ УРОН ИДЁТ ОТ УБИЙСТВ, А НЕ ОТ ПОДХОДА К КРЕПОСТИ. Настоящей
// крепости, к которой можно подойти и ударить, в игре нет: нет ни модели, ни
// точки на карте, ни отдельной сущности. Урон наносится убийствами монстров в
// регионе осады. Это честный компромисс, а не украшение: настоящая точка осады
// - это геометрия и клиентский код, то есть отдельная работа.
//
// УРОН БЕЗ ГИЛЬДИИ НЕ ИДЁТ. Территория - владение гильдии, и некому её
// закрепить. Иначе одиночка пробивал бы крепость в ноль, и осада закрывалась
// бы как «взятая», а брать было бы некому.
//
// ЧЕСТНОЕ ОГРАНИЧЕНИЕ. Бонусы владельцу территории (trade_tax, gold_income и
// прочие из TerritoryDefinition.bonuses) здесь НЕ сделаны: объявлены они в
// данных так же давно, как и сами осады, и читает их пока только этот файл.

import { TERRITORIES, GUILD_SKILLS, type TerritoryDefinition } from '../data/guilds';
import { GAME_SERVERS } from '../../../shared/constants';
import { DatabaseService } from '../services/DatabaseService';
import { NotificationService } from '../services/NotificationService';
import { logger } from '../utils/logger';

/** Как долго длится осада. Часа хватает, чтобы собрать гарнизон. */
export const ДЛИТЕЛЬНОСТЬ_ОСАДЫ_МС = 60 * 60 * 1000;

/** За сколько до начала слать напоминание: текст уведомления обещает полчаса. */
export const НАПОМИНАНИЕ_ЗА_МС = 30 * 60 * 1000;

/** Тик планировщика. Реже - опаздывает объявление, чаще незачем. */
const ТИК_МС = 30 * 1000;

/**
 * Сколько убийств нужно, чтобы пробить крепость.
 *
 * Именно количество, а не фиксированный урон за убийство: прочность
 * территорий разная (5000 у базара, 60000 у порта), и одна цифра дала бы
 * либо мгновенный прорыв, либо недоступную стену. Деление прочности на это
 * число делает любую территорию одинаково пробиваемой, а различие остаётся
 * видимым в прочности и в истории.
 */
export const ЦЕЛЬ_УБИЙСТВ = 50;

const МС_В_СУТКАХ = 24 * 60 * 60 * 1000;

/** Дни недели по-английски: в таком виде написано siegeSchedule в данных. */
const ДНИ_НЕДЕЛИ: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

export interface РазобранноеРасписание {
  /** 0 = воскресенье, как в Date.getUTCDay. */
  деньНедели: number;
  час: number;
  минута: number;
}

/**
 * Разобрать «Saturday 20:00 UTC» из данных территории.
 *
 * null, а не догадка: расписание лежит строкой в файле данных, и опечатка
 * означала бы либо осаду не в тот день, либо осаду никогда. Молча разбирать
 * «как получится» нельзя: битая строка выглядела бы как «осад нет», а на
 * самом деле дело в одной букве в данных.
 */
export function разобратьРасписание(строка: string | null | undefined): РазобранноеРасписание | null {
  if (typeof строка !== 'string') return null;
  const части = строка.trim().split(/\s+/);
  if (части.length < 2) return null;
  const деньНедели = ДНИ_НЕДЕЛИ[части[0].toLowerCase()];
  if (деньНедели === undefined) return null;
  const время = /^(\d{1,2}):(\d{2})$/.exec(части[1]);
  if (время === null) return null;
  const час = Number(время[1]);
  const минута = Number(время[2]);
  // Час 24 и минута 60 не существуют. Без проверки опечатка «25:00»
  // превратилась бы в «1:00 следующего дня», и осада поехала бы на сутки
  // раньше - молча и навсегда.
  if (час > 23 || минута > 59) return null;
  return { деньНедели, час, минута };
}

/**
 * Ближайшее наступление осады СТРОГО ПОЗЖЕ указанного момента.
 *
 * Строго, а не включительно: ровно в момент начала осада ещё не наступила,
 * и tick не смог бы её открыть - осада не начиналась бы в ту секунду, на
 * которую и назначена.
 *
 * Всё в UTC: в данных написано «20:00 UTC», и пересчёт на местное время
 * означал бы, что осада в Баку и в Лос-Анджелесе идёт в разные часы при
 * одном territory_id.
 */
export function началоОсады(расписание: РазобранноеРасписание, от: Date): Date {
  const кандидат = new Date(от.getTime());
  кандидат.setUTCHours(расписание.час, расписание.минута, 0, 0);
  const сдвиг = (расписание.деньНедели - кандидат.getUTCDay() + 7) % 7;
  кандидат.setUTCDate(кандидат.getUTCDate() + сдвиг);
  if (кандидат.getTime() <= от.getTime()) {
    кандидат.setTime(кандидат.getTime() + 7 * МС_В_СУТКАХ);
  }
  return кандидат;
}

/**
 * Идёт ли осада прямо сейчас.
 *
 * Опорная точка сдвинута на длительность осады назад: началоОсады ищет
 * наступление строго позже опорной точки, поэтому сдвиг позволяет увидеть
 * начало, случившееся в пределах последнего часа. Без сдвига осада была бы
 * видна только на следующей неделе.
 */
export function идётЛиОсада(расписание: РазобранноеРасписание, сейчас: Date): boolean {
  const опорная = new Date(сейчас.getTime() - ДЛИТЕЛЬНОСТЬ_ОСАДЫ_МС);
  const прошло = сейчас.getTime() - началоОсады(расписание, опорная).getTime();
  return прошло >= 0 && прошло < ДЛИТЕЛЬНОСТЬ_ОСАДЫ_МС;
}

/** Пора ли слать напоминание: до начала меньше получаса, но ещё не началось. */
export function пораНапомнить(расписание: РазобранноеРасписание, сейчас: Date): boolean {
  const доНачала = началоОсады(расписание, сейчас).getTime() - сейчас.getTime();
  return доНачала > 0 && доНачала <= НАПОМИНАНИЕ_ЗА_МС;
}

/** Урон за одно убийство: ровно столько убийств, сколько ЦЕЛЬ_УБИЙСТВ. */
export function уронЗаУбийство(прочность: number): number {
  return Math.max(1, Math.floor(прочность / ЦЕЛЬ_УБИЙСТВ));
}

/**
 * Прочность крепости для показа, с проверкой против потолка из данных.
 *
 * В базе defense_hp объявлен как DEFAULT 100000 (миграция 002), а настоящие
 * очки защиты в TerritoryDefinition - от 5000 до 60000. До первой осады в
 * базе лежит именно DEFAULT, то есть 100000 при потолке 5000.
 *
 * Значение из базы принимается только если оно в пределах [0, потолок].
 * Всё остальное - это не текущая прочность, а незасеянное или испорченное
 * число; в таком случае показывается «крепость цела», то есть потолок.
 * Иначе игрок увидел бы 100000/5000 и решил, что осаду невозможно
 * пробить, - а это был бы враньём в интерфейсе.
 */
export function defensiveness(
  строка: { defense_hp: number } | undefined,
  территория: { defensePoints: number },
): number {
  const потолок = территория.defensePoints;
  const сырое = Number(строка?.defense_hp);
  if (!Number.isFinite(сырое)) return потолок;
  if (сырое < 0 || сырое > потолок) return потолок;
  return сырое;
}

/**
 * Состояние территории для маршрута и панели.
 *
 * Бонусы отдаются как есть, из данных. Русского названия достаточно: в игре
 * интерфейс идёт через словари переводов, а выдуманный азербайджанский
 * текст хуже русского среди азербайджана - это уже сделано с описаниями
 * навыков гильдий.
 */
export interface СостояниеТерритории {
  id: string;
  name: string;
  nameRu: string;
  region: string;
  /** null = территория ничья. */
  ownerGuildId: string | null;
  capturedAt: string | null;
  defenseHp: number;
  defenseMax: number;
  siegeActive: boolean;
  siegeSchedule: string;
  capturePoints: number;
  bonuses: TerritoryDefinition['bonuses'];
}

/** Строка осады из базы. */
export interface СтрокаОсады {  id: string;
  territory_id: string;
  started_at: string;
  ended_at: string | null;
  outcome: string;
  damage: number;
}

export class SiegeSystem {
  private static instance: SiegeSystem;

  private db = DatabaseService.getInstance();
  private notifications = new NotificationService();
  private timer: NodeJS.Timeout | null = null;
  /**
   * Территории, у которых осада идёт ПРЯМО СЕЙЧАС и куда идёт урон.
   *
   * В памяти, а не чтением базы на каждый удар: обработчик боя вызывается на
   * каждом добивании каждого игрока, и запрос в базу там поставил бы бой на
   * паузу. Пропуск «осада идёт, а в памяти её нет» закрыт восстановлением
   * из базы при старте.
   */
  private идущие = new Set<string>();
  /** Ключи «территория@момент начала» - чтобы не слать напоминание дважды. */
  private напомненные = new Set<string>();

  static getInstance(): SiegeSystem {
    if (!SiegeSystem.instance) {
      SiegeSystem.instance = new SiegeSystem();
    }
    return SiegeSystem.instance;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((e) => logger.error('[Siege] тик не удался:', e));
    }, ТИК_МС);
    logger.info(`[Siege] Планировщик запущен: территорий ${TERRITORIES.length}, тик ${ТИК_МС / 1000}с`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Вернуть в память осады, которые оборвались перезапуском.
   *
   * Без этого перезапуск посреди осады обнулил бы идущие: по расписанию
   * осада шла бы, урон не наносился бы никем, а закрылась бы молча, не
   * записав начала.
   */
  async restore(): Promise<void> {
    const строки = await this.db.query<СтрокаОсады>(
      `SELECT id, territory_id, started_at, ended_at, outcome, damage
         FROM guild_sieges WHERE ended_at IS NULL AND outcome = 'in_progress'`,
    );
    for (const строка of строки) this.идущие.add(строка.territory_id);
    if (строки.length > 0) {
      logger.info(`[Siege] Восстановлено осад в бою: ${строки.length}`);
    }
  }

  /** Идёт ли осада этой территории прямо сейчас. */
  идёт(territoryId: string): boolean {
    return this.идущие.has(territoryId);
  }

  /** Один проход планировщика по всем территориям. */
  private async tick(): Promise<void> {
    const сейчас = new Date();
    // Сначала доводим до конца начатое, потом открываем новое: иначе осада,
    // время которой только что вышло, была бы «незакрытой» до следующего
    // тика, а её строка продолжала бы висеть открытой.
    await this.закрытьПросроченные(сейчас);
    for (const территория of TERRITORIES) {
      try {
        await this.рассмотретьТерриторию(территория, сейчас);
      } catch (e) {
        // Одна битая территория не должна останавливать остальные три.
        logger.error(`[Siege] ${территория.id}: тик не удался:`, e);
      }
    }
  }

  /** Закрыть осады, у которых истекло время. */
  private async закрытьПросроченные(сейчас: Date): Promise<void> {
    const открытые = await this.db.query<СтрокаОсады>(
      `SELECT id, territory_id, started_at, ended_at, outcome, damage
         FROM guild_sieges WHERE ended_at IS NULL`,
    );
    for (const строка of открытые) {
      const территория = TERRITORIES.find((t) => t.id === строка.territory_id);
      if (территория === undefined) {
        // Территория убрана из данных, а осада её осталась висеть открытой.
        // Закрываем по часам, иначе уникальный индекс не пустит новую осаду
        // по этому id никогда.
        await this.db.query(
          `UPDATE guild_sieges SET ended_at = $2, updated_at = NOW()
            WHERE id = $1 AND ended_at IS NULL`,
          [строка.id, сейчас.toISOString()],
        );
        continue;
      }
      const конец = new Date(строка.started_at).getTime() + ДЛИТЕЛЬНОСТЬ_ОСАДЫ_МС;
      if (сейчас.getTime() < конец) continue;
      await this.закрыть(территория, строка.id, сейчас);
    }
  }

  private async рассмотретьТерриторию(территория: TerritoryDefinition, сейчас: Date): Promise<void> {
    const расписание = разобратьРасписание(территория.siegeSchedule);
    if (расписание === null) {
      // Битое расписание в данных. Пропускаем, но кричим: иначе осада
      // «не наступает» выглядела бы как забытое дело, а не как опечатка.
      logger.error(`[Siege] ${территория.id}: расписание «${территория.siegeSchedule}» не разобрано - осада не наступит`);
      return;
    }
    if (this.идущие.has(территория.id)) return;
    if (идётЛиОсада(расписание, сейчас)) {
      await this.начать(территория, расписание, сейчас);
      return;
    }
    if (пораНапомнить(расписание, сейчас)) {
      await this.напомнить(территория, расписание, сейчас);
    }
  }

  /**
   * Напоминание за полчаса.
   *
   * Строка осады создаётся уже здесь, а не в начале: так «осада идёт» и
   * «напоминание слали» хранятся в одном месте, а не в двух, и повторный
   * тик не наслал бы напоминание каждые полминуты весь получасовой промежуток.
   */
  private async напомнить(
    территория: TerritoryDefinition,
    расписание: РазобранноеРасписание,
    сейчас: Date,
  ): Promise<void> {
    const начало = началоОсады(расписание, сейчас);
    const ключ = `${территория.id}@${начало.getTime()}`;
    if (this.напомненные.has(ключ)) return;
    this.напомненные.add(ключ);

    const владелец = await this.владелец(территория.id);
    await this.db.query(
      `INSERT INTO guild_sieges (territory_id, started_at, defender_guild_id, outcome, reminder_sent_at)
       VALUES ($1, $2, $3, 'scheduled', $2)
       ON CONFLICT (territory_id) WHERE ended_at IS NULL DO NOTHING`,
      [территория.id, начало.toISOString(), владелец],
    );
    await this.объявить(территория, {
      territoryId: территория.id,
      startsAt: начало.toISOString(),
      phase: 'reminder',
    });
    logger.info(`[Siege] ${территория.id}: напоминание, начало ${начало.toISOString()}`);
  }

  /**
   * Начало осады.
   *
   * Строка могла быть создана напоминанием - тогда она уже есть, и её надо
   * перевести в «идёт», а не вставлять вторую (уникальный индекс на одну
   * открытую осаду это запрещает).
   */
  private async начать(
    территория: TerritoryDefinition,
    расписание: РазобранноеРасписание,
    сейчас: Date,
  ): Promise<void> {
    const начало = началоОсады(расписание, сейчас);
    const владелец = await this.владелец(территория.id);
    const строка = await this.db.queryOne<{ id: string }>(
      `INSERT INTO guild_sieges (territory_id, started_at, defender_guild_id, outcome, reminder_sent_at)
       VALUES ($1, $2, $3, 'in_progress', $2)
       ON CONFLICT (territory_id) WHERE ended_at IS NULL DO NOTHING
       RETURNING id`,
      [территория.id, начало.toISOString(), владелец],
    );
    if (строка === null) {
      // Строка уже создана напоминанием: переводим её в «идёт».
      await this.db.query(
        `UPDATE guild_sieges SET outcome = 'in_progress', defender_guild_id = COALESCE(defender_guild_id, $2),
              updated_at = NOW()
           WHERE territory_id = $1 AND ended_at IS NULL AND outcome = 'scheduled'`,
        [территория.id, владелец],
      );
      this.идущие.add(территория.id);
      return;
    }
    await this.db.query(
      `UPDATE guild_territories SET defense_hp = $2, updated_at = NOW() WHERE territory_id = $1`,
      [территория.id, территория.defensePoints],
    );
    this.идущие.add(территория.id);
    await this.объявить(территория, {
      territoryId: территория.id,
      startedAt: начало.toISOString(),
      endsAt: new Date(начало.getTime() + ДЛИТЕЛЬНОСТЬ_ОСАДЫ_МС).toISOString(),
      phase: 'started',
    });
    logger.info(`[Siege] ${территория.id}: осада началась, защитник ${владелец ?? 'никто'}`);
  }

  /**
   * Конец осады: восстановить крепость и закрыть строку.
   *
   * Итог «взята» или «отбита» здесь НЕ пишется. Единственный честный признак
   * захвата - сменившийся guild_id в guild_territories; второй источник
   * правды разошёлся бы с первым при любом сбое записи, а пострадала бы
   * история. Пока захвата нет (следующий пункт итерации), исход всегда
   * 'defended', и это написано честным словом в колонке, а не притворством.
   */
  private async закрыть(территория: TerritoryDefinition, siegeId: string, сейчас: Date): Promise<void> {
    await this.db.query(
      `UPDATE guild_sieges SET ended_at = $2, outcome = 'defended', updated_at = NOW()
        WHERE id = $1 AND ended_at IS NULL`,
      [siegeId, сейчас.toISOString()],
    );
    await this.db.query(
      `UPDATE guild_territories SET defense_hp = $2, updated_at = NOW() WHERE territory_id = $1`,
      [территория.id, территория.defensePoints],
    );
    this.идущие.delete(территория.id);
    logger.info(`[Siege] ${территория.id}: осада закончилась, крепость восстановлена`);
  }

  /**
   * Урон от убийства монстра в регионе.
   *
   * Вызывается из обработчика боя на каждом добивании, поэтому сперва
   * проверка по памяти: если в регионе нет идущей осады, ни одного запроса в
   * базу не уходит.
   */
  async нанестиУрон(characterId: string, region: string): Promise<void> {
    const территория = TERRITORIES.find((t) => t.region === region);
    if (территория === undefined) return;
    if (!this.идущие.has(территория.id)) return;

    const герой = await this.db.queryOne<{ guild_id: string | null }>(
      `SELECT guild_id FROM characters WHERE id = $1`,
      [characterId],
    );
    if (герой?.guild_id == null) return;

    const строка = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM guild_sieges WHERE territory_id = $1 AND ended_at IS NULL`,
      [территория.id],
    );
    if (строка === null) {
      // Память говорит «идёт», база — «нет». Верим базе и убираем из памяти:
      // иначе урон шёл бы в осаду, которой больше нет.
      this.идущие.delete(территория.id);
      return;
    }

    // Навык гильдии «Мастера осады»: +10% урона за уровень, максимум 5.
    // Читается по одной строке и только когда осада действительно идёт, то
    // есть раз в час на регион, а не на каждый удар каждого игрока.
    const урон = await this.уронСНавыком(герой.guild_id, территория.defensePoints);

    await this.db.query(
      `UPDATE guild_sieges SET damage = damage + $2, attacker_guild_id = $3, updated_at = NOW()
        WHERE id = $1`,
      [строка.id, урон, герой.guild_id],
    );
    const прочность = await this.db.queryOne<{ defense_hp: number; guild_id: string | null }>(
      `SELECT defense_hp, guild_id FROM guild_territories WHERE territory_id = $1`,
      [территория.id],
    );
    if (прочность === null) return;
    const осталось = Math.max(0, Number(прочность.defense_hp) - урон);
    await this.db.query(
      `UPDATE guild_territories
          SET defense_hp = $2, captured_at = CASE WHEN $3 AND $2 = 0 THEN NOW() ELSE captured_at END,
              updated_at = NOW()
        WHERE territory_id = $1`,
      [территория.id, осталось, прочность.guild_id !== герой.guild_id],
    );

    // Захват. Крепость падает, когда прочность обнулена, и пасть должна
    // ЧУЖОЙ гвардии: своей гильдии территория и не принадлежит, и не
    // переходит - иначе гильдия «забирала бы» сама себя и писала в лог о
    // захвате, которого не было.
    //
    // Исход осады НЕ ставится здесь. Единственный честный признак захвата -
    // сменившийся guild_id в guild_territories; второй источник правды
    // разошёлся бы с первым при любом сбое записи, и пострадала бы история.
    if (осталось === 0 && прочность.guild_id !== герой.guild_id) {
      await this.db.query(
        `UPDATE guild_territories SET guild_id = $2 WHERE territory_id = $1`,
        [территория.id, герой.guild_id],
      );
      await this.объявить(территория, {
        territoryId: территория.id,
        capturedBy: герой.guild_id,
        phase: 'captured',
      });
      logger.info(`[Siege] ${территория.id}: захвачена гильдией ${герой.guild_id}`);
    }
  }

  /** Урон за убийство с учётом навыка «Мастера осады». */
  private async уронСНавыком(guildId: string, прочность: number): Promise<number> {
    const базовый = уронЗаУбийство(прочность);
    const навык = await this.db.queryOne<{ level: number }>(
      `SELECT level FROM guild_skills WHERE guild_id = $1 AND skill_id = 'guild_siege_power'`,
      [guildId],
    );
    const уровень = Number(навык?.level ?? 0);
    if (уровень <= 0) return базовый;
    // Потолок берём из справочника, а не пишем константой: maxLevel в данных
    // и в коде разошлись бы при правке одного из них.
    const потолок = GUILD_SKILLS.find((s) => s.id === 'guild_siege_power')?.maxLevel ?? 0;
    const действует = Math.min(уровень, потолок);
    return Math.floor(базовый * (1 + 0.1 * действует));
  }

  /**
   * Состояние территорий для игрового интерфейса.
   *
   * Без этого осада выглядит «объявленной, но непрозрачной»: игрок получает
   * уведомление и наносит урон, не видя ни прочности крепости, ни её
   * владельца. TerritoryDefinition.capturePoints при этом остаётся полем,
   * которое никто не читает, - ровно та же болезнь, что была с боссами
   * данжей и бонусами сезонных праздников.
   */
  async territoryState(): Promise<СостояниеТерритории[]> {
    const строки = await this.db.query<{
      territory_id: string; guild_id: string | null; defense_hp: number; captured_at: string | null;
    }>(
      `SELECT territory_id, guild_id, defense_hp, captured_at FROM guild_territories`,
    );
    const поТаблице = new Map(строки.map((s) => [s.territory_id, s]));
    return TERRITORIES.map((территория) => {
      const строка = поТаблице.get(территория.id);
      return {
        id: территория.id,
        name: территория.name,
        nameRu: территория.nameRu,
        region: территория.region,
        ownerGuildId: строка?.guild_id ?? null,
        capturedAt: строка?.captured_at ?? null,
        // ЧТО ЗДЕСЬ БЫЛО: defenseHp брался из базы без сверки с данными, и на
        // живом сервере отдавалось 100000/5000 - то есть прочность больше
        // потолка в двадцать раз. Причина: defense_hp в guild_territories
        // объявлен как DEFAULT 100000 (миграция 002), а настоящие очки
        // защиты в данных - от 5000 до 60000, и до первой осады в базе лежит
        // именно этот DEFAULT. SiegeSystem при начале осады перезаписывает
        // его верным значением, но ДО первой осады игрок видел чепуху.
        //
        // Поэтому значение из базы принимается, только если оно правдоподобно:
        // ноль, отрицательное или число выше потолка - это не текущая
        // прочность, а незасеянное или испорченное значение, и оно
        // показывается как «крепость цела». Молчаливый 100000 был бы враньём
        // в интерфейсе, и на него опирался бы игрок.
        defenseHp: defensiveness(строка, территория),
        defenseMax: территория.defensePoints,
        siegeActive: this.идущие.has(территория.id),
        siegeSchedule: территория.siegeSchedule,
        capturePoints: территория.capturePoints,
        bonuses: территория.bonuses,
      };
    });
  }

  /** Кто держит территорию сейчас. */
  private async владелец(territoryId: string): Promise<string | null> {
    const строка = await this.db.queryOne<{ guild_id: string | null }>(
      `SELECT guild_id FROM guild_territories WHERE territory_id = $1`,
      [territoryId],
    );
    return строка?.guild_id ?? null;
  }

  /**
   * Объявить осаду игрокам её региона.
   *
   * Идём по настоящим шардам из GAME_SERVERS, а не по выдуманному «all»:
   * sendToRegion подписывается на канал region:<шард>:<регион>, и несуществующий
   * шард означал бы объявление в пустоту. Заодно sendGlobal здесь не годится -
   * на его канал global:notification не подписан ни один обработчик, то есть
   * уведомление ушло бы в никуда.
   */
  private async объявить(территория: TerritoryDefinition, данные: Record<string, unknown>): Promise<void> {
    const подробно = {
      ...данные,
      nameRu: территория.nameRu,
      region: территория.region,
    };
    for (const шард of GAME_SERVERS) {
      await this.notifications
        .sendToRegion(шард.id, территория.region, 'siege_starting', подробно)
        .catch((e) => logger.warn(`[Siege] ${территория.id}: объявление на ${шард.id} не ушло: ${e}`));
    }
  }
}
