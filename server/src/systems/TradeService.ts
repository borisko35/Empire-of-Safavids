// ============================================================
// Торговые контракты (Шёлковый путь) — Empire of Safavids
// ============================================================
// Игрок принимает контракт в городе-отправителе, закупает груз
// (предметы списываются при приёме) и доставляет его в город-
// получатель. На маршрут влияют разбойники и война — груз может
// выпасть после смерти (упрощение: списывается при приёме контракта).

import { Region } from '../types/game.types';
import { CharacterService } from '../services/CharacterService';
import { DatabaseService } from '../services/DatabaseService';
import { ITEMS_DATABASE } from '../data/items';
import { RedisService } from '../services/RedisService';
import { grantReputation } from './ReputationGrants';
// Счётчик выполненных контрактов для достижения. Общая таблица
// leaderboard - там же убийства, парирования, стихи, шахматы, крафт.
import { LeaderboardService } from '../services/LeaderboardService';
import { TerritoryBonuses } from './TerritoryBonuses';
import { logger } from '../utils/logger';

export interface TradeContractDef {
  id: string;
  /** Английское название. Раньше у контрактов было только nameRu, и
   *  перевод невозможно было взять из данных: словарь заполняется из
   *  серверных названий, а не наоборот. */
  name: string;
  nameRu: string;
  fromRegion: Region;
  toRegion: Region;
  cargoItemId: string;
  cargoQty: number;
  rewardGold: number;
  rewardExp: number;
  /** Бонус исфаханским серебром (бесплатная валюта). */
  rewardSilver?: number;
  /** Бонус сирийским золотом (бесплатная валюта). */
  rewardSyrian?: number;
  minLevel: number;
  /**
   * Сколько минут идти каравану. Раньше контракт можно было закрыть сразу
   * же, не выйдя из города отправителя — груз исчезал навсегда, если игрок
   * закрывал панель и забывал про него. Теперь караван реально в пути:
   * груз лежит в нём, счётчик тикает, и сдать его можно только после прихода.
   */
  travelMinutes: number;
}

export type CaravanStatus = 'transit' | 'arrived';

export interface ActiveContract {
  contractId: string;
  startedAt: number;
  /** Момент прихода каравана (мс, серверное время) */
  arrivesAt: number;
  status: CaravanStatus;
  /** Груз уже вернулся в сумку игрока (при приходе) */
  cargoReturned: boolean;
  cargoItemId: string;
  cargoQty: number;
}

const CONTRACT_KEY = (characterId: string) => `trade:contract:${characterId}`;
const KEY_TTL_SECONDS = 7 * 24 * 3600;

export const TRADE_CONTRACTS: TradeContractDef[] = [
  {
    id: 'trade_tabriz_isfahan_silk',
    name: 'Silk for Isfahan',
    nameRu: 'Шёлк для Исфахана',
    fromRegion: Region.TABRIZ, toRegion: Region.ISFAHAN,
    cargoItemId: 'mat_silk', cargoQty: 3,
    rewardGold: 450, rewardExp: 400, rewardSilver: 15, minLevel: 5,
    travelMinutes: 3,
  },
  {
    id: 'trade_isfahan_shiraz_saffron',
    name: 'Saffron to Shiraz',
    nameRu: 'Шафран в Шираз',
    fromRegion: Region.ISFAHAN, toRegion: Region.SHIRAZ,
    cargoItemId: 'mat_saffron', cargoQty: 2,
    rewardGold: 700, rewardExp: 900, minLevel: 20,
    travelMinutes: 5,
  },
  {
    id: 'trade_shiraz_caucasus_turquoise',
    name: 'Turquoise to the Caucasus',
    nameRu: 'Бирюза на Кавказ',
    fromRegion: Region.SHIRAZ, toRegion: Region.CAUCASUS,
    cargoItemId: 'mat_turquoise', cargoQty: 2,
    rewardGold: 900, rewardExp: 1600, minLevel: 40,
    travelMinutes: 8,
  },
  {
    id: 'trade_caucasus_meso_ore',
    name: 'Ore for the Military Camps',
    nameRu: 'Руда для военных лагерей',
    fromRegion: Region.CAUCASUS, toRegion: Region.MESOPOTAMIA,
    cargoItemId: 'mat_iron_ore', cargoQty: 20,
    rewardGold: 1200, rewardExp: 2600, minLevel: 55,
    travelMinutes: 12,
  },
  {
    id: 'trade_isfahan_khorasan_scale',
    // Название приведено в соответствие с грузом. Контракт звался
    // «Драконья чешуя в Хорасан», а mat_dragon_scale в данных называется
    // «Перо Симурга» и описан как крайне редкий материал для легендарного
    // крафта: игрок читал про чешуюю, а везёт перо. Переименован контракт,
    // а не предмет, потому что на перне держится легенда крафта и описание
    // предмета, а идентификатор mat_dragon_scale внутренний и на игру не
    // влияет.
    name: 'Simurgh Feather to Khorasan',
    nameRu: 'Перо Симурга в Хорасан',
    fromRegion: Region.ISFAHAN, toRegion: Region.KHORASAN,
    cargoItemId: 'mat_dragon_scale', cargoQty: 1,
    rewardGold: 8000, rewardExp: 5200, rewardSilver: 120, rewardSyrian: 40, minLevel: 70,
    travelMinutes: 15,
  },
];

/**
 * Сколько караванщики не доверяют грабителю (§361).
 *
 * ВЫБОР, не измерение. Рамки: меньше 10 минут игрок не успел бы связать
 * отказ с засадой; больше двух часов — наказание жило бы дольше, чем
 * memory мира в соседних правилах (розыск стражи — 10 минут). Засада —
 * публичное действие: конвой поднят у всех на глазах, караванщик знает
 * нападавшего, и записано это в caravan_ambushes.
 */
const CARAVAN_GRUDGE_MINUTES = 30;

export class TradeService {
  private redis = RedisService.getInstance();
  private characters = new CharacterService();
  private db = DatabaseService.getInstance();

  listContracts(): TradeContractDef[] {
    return TRADE_CONTRACTS;
  }

  /**
   * Активный караван игрока. Строка из trade_caravans — источник истины
   * (груз физически лежит в караване, а не в памяти Redis). Здесь же
   * проверяется, не пора ли сдавать груз: при наступлении eta_minutes
   * караван переходит в 'arrived', а груз возвращается в сумку игрока —
   * иначе доставка была бы невозможна из другого города.
   */
  async getActive(characterId: string): Promise<ActiveContract | null> {
    const row = await this.db.queryOne<{
      contract_id: string | null; item_id: string; quantity: number;
      eta_minutes: number; started_at: Date; status: string;
    }>(
      `SELECT contract_id, item_id, quantity, eta_minutes, started_at, status
         FROM trade_caravans
        WHERE owner_id = $1 AND status <> 'cancelled'
        ORDER BY started_at DESC
        LIMIT 1`,
      [characterId]
    ).catch(() => null);
    if (!row) return null;

    const def = TRADE_CONTRACTS.find(c => c.id === row.contract_id);
    // Контракт из старой версии (без contract_id) — просто убираем, чтобы
    // не висел вечно и не блокировал новый
    if (!def) {
      await this.db.query('DELETE FROM trade_caravans WHERE owner_id = $1', [characterId]).catch(() => {});
      return null;
    }

    const startedAt = new Date(row.started_at).getTime();
    const arrivesAt = startedAt + row.eta_minutes * 60_000;
    const arrived = Date.now() >= arrivesAt;
    let cargoReturned = arrived;

    if (arrived && row.status === 'transit') {
      // Груз приехал — возвращаем его игроку ровно один раз
      await this.characters.addItems(characterId, [{ itemId: row.item_id, qty: row.quantity }]).catch(() => {});
      await this.db.query(
        `UPDATE trade_caravans SET status = 'arrived', completed_at = NOW()
          WHERE owner_id = $1 AND status = 'transit'`,
        [characterId]
      ).catch(() => {});
      cargoReturned = true;
    }

    return {
      contractId: def.id,
      startedAt,
      arrivesAt,
      status: cargoReturned ? 'arrived' : 'transit',
      cargoReturned,
      cargoItemId: row.item_id,
      cargoQty: row.quantity,
    };
  }

  /**
   * Есть ли у персонажа свежая засада на караван (§361).
   *
   * Источник — таблица caravan_ambushes, куда пишет AmbushService в момент
   * поднятия конвоя: отдельная «карта обид» была бы второй истиной, и
   * караванщики помнили бы не то, что случилось, а то, что запомнилось.
   */
  private async помнятГрабителя(characterId: string): Promise<boolean> {
    const обида = await this.db.queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM caravan_ambushes
        WHERE ambusher_id = $1 AND started_at > NOW() - make_interval(mins => $2)`,
      [characterId, CARAVAN_GRUDGE_MINUTES],
    );
    return (обида?.n ?? 0) > 0;
  }

  async accept(
    characterId: string,
    contractId: string
  ): Promise<{ ok: true; contract: TradeContractDef; active: ActiveContract } | { ok: false; code: string }> {
    const def = TRADE_CONTRACTS.find(c => c.id === contractId);
    if (!def) return { ok: false, code: 'contract_not_found' };

    const character = await this.characters.getCharacterById(characterId);
    if (!character) return { ok: false, code: 'character_not_found' };
    if (character.level < def.minLevel) return { ok: false, code: 'contract_level_low' };
    if (character.region !== def.fromRegion) return { ok: false, code: 'contract_wrong_region' };
    if (await this.getActive(characterId)) return { ok: false, code: 'contract_already_active' };

    // Живые последствия (§361): караванщики помнят грабителя. Удачной засада
    // быть не обязана — попытка уже публична, и доверие ушло.
    if (await this.помнятГрабителя(characterId)) return { ok: false, code: 'caravan_grudge' };

    const startsAt = new Date();
    const active: ActiveContract = {
      contractId,
      startedAt: startsAt.getTime(),
      arrivesAt: startsAt.getTime() + def.travelMinutes * 60_000,
      status: 'transit',
      cargoReturned: false,
      cargoItemId: def.cargoItemId,
      cargoQty: def.cargoQty,
    };
    // Караван — источник истины, без строки груз потерялся бы навсегда.
    // Поэтому создаём строку ПЕРВОЙ, и лишь потом списываем груз: если
    // INSERT не прошёл (нет миграции, отказ базы) — контракт не примется,
    // но игрок ничего не потеряет.
    try {
      await this.db.query(
        `INSERT INTO trade_caravans
           (owner_id, origin_region, dest_region, item_id, quantity, base_value, status, eta_minutes, started_at, contract_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'transit', $7, $8, $9)`,
        [characterId, def.fromRegion, def.toRegion, def.cargoItemId, def.cargoQty,
          (ITEMS_DATABASE[def.cargoItemId]?.price ?? 0) * def.cargoQty,
          def.travelMinutes, startsAt, def.id]
      );
    } catch (e) {
      logger.error('[Trade] Караван не создан, груз не списывается:', e);
      return { ok: false, code: 'contract_caravan_unavailable' };
    }
    // Строка каравана создана — теперь груз действительно уезжает
    await this.characters.removeItems(characterId, [{ itemId: def.cargoItemId, qty: def.cargoQty }]);
    // Redis остаётся как быстрый кэш «есть активный контракт»
    await this.redis.set(CONTRACT_KEY(characterId), JSON.stringify(active), KEY_TTL_SECONDS).catch(() => {});
    logger.info(`[Trade] Contract ${contractId} accepted by ${characterId}, eta ${def.travelMinutes} min`);
    return { ok: true, contract: def, active };
  }

  async deliver(
    characterId: string
  ): Promise<{ ok: true; gold: number; exp: number; silver: number; syrian: number; contract: TradeContractDef; налог: number } | { ok: false; code: string }> {
    const active = await this.getActive(characterId);
    if (!active) return { ok: false, code: 'contract_none_active' };

    const def = TRADE_CONTRACTS.find(c => c.id === active.contractId);
    if (!def) return { ok: false, code: 'contract_not_found' };

    // Раньше можно было сдать груз сразу, не выйдя из города отправителя.
    // Теперь караван должен реально дойти.
    if (active.status !== 'arrived') return { ok: false, code: 'contract_caravan_in_transit' };

    const character = await this.characters.getCharacterById(characterId);
    if (!character) return { ok: false, code: 'character_not_found' };
    if (character.region !== def.toRegion) return { ok: false, code: 'contract_not_delivered' };

    // Груз должен быть в сумке: сдаём его вместе с наградой
    await this.characters.removeItems(characterId, [{ itemId: def.cargoItemId, qty: def.cargoQty }]).catch(() => {});

    // НАЛОГ С КАРАВАНА (§181). Территория в регионе ОТПРАВЛЕНИЯ берёт пошлину
    // с чужих караванов: базар берёт своё за то, что через него выкупили груз.
    //
    // ПОЧЕМУ ОТПРАВЛЕНИЕ, А НЕ НАЗНАЧЕНИЕ. Проверено расчётом по данным: налог
    // объявлен у территорий Тебриза и Персидского залива, а прибывают караваны
    // в Исфахан, Шираз, Кавказ, Месопотамию и Хорасан. Пересечения нет ни с
    // одним - по назначению налог не сработал бы НИКОГДА, и смысл владения
    // территорией не появился бы вовсе. Отправление пересекается: «Большой
    // Базар Тебриза» это как раз город, из которого караван уходит.
    //
    // Платится здесь, на доставке, а не при приёме контракта: пошлина за
    // доставленный груз. Караван, который потом ограбили, пошлины не платит —
    // и это правильно, потому что платить было бы не с чего.
    //
    // Отказ здесь не глотаем: налог, который не посчитался, тихо сделал бы
    // владение территорией бесполезным — ровно тот класс поломки, что
    // прятался в молчании в §176.
    let налог = 0;
    try {
      const сбор = await TerritoryBonuses.getInstance()
        .налогКаравана(characterId, def.fromRegion)
        .catch((e: unknown) => {
          logger.error('[Trade] налог не посчитан:', (e as Error).message);
          return null;
        });
      if (сбор) {
        налог = Math.floor(def.rewardGold * сбор.rate);
        if (налог > 0) {
          await this.db.query(
            `UPDATE guilds SET gold = gold + $2, updated_at = NOW() WHERE id = $1`,
            [сбор.guildId, налог],
          ).catch((e) => logger.warn('[Trade] налог не зачислен гильдии:', (e as Error).message));
          logger.info(
            `[Trade] ${characterId} заплатил налог ${налог} за «${сбор.territoryNameRu}» гильдии ${сбор.guildId}`,
          );
        }
      }
    } catch (e) {
      logger.error('[Trade] налог с каравана не взят:', (e as Error).message);
    }
    const золотоИгроку = def.rewardGold - налог;

    await this.characters.addGoldReward(characterId, золотоИгроку).catch(() => {});
    await this.characters.addExperience(characterId, def.rewardExp).catch(() => {});
    const silver = def.rewardSilver ?? 0;
    const syrian = def.rewardSyrian ?? 0;
    if (silver > 0) await this.characters.addSilver(characterId, silver).catch(() => {});
    if (syrian > 0) await this.characters.addSyrianGold(characterId, syrian).catch(() => {});
    await this.db.query(
      `UPDATE trade_caravans SET status = 'delivered', completed_at = NOW()
        WHERE owner_id = $1 AND status = 'arrived'`,
      [characterId]
    ).catch(() => {});
    await this.redis.del(CONTRACT_KEY(characterId)).catch(() => {});
    logger.info(`[Trade] Contract ${def.id} delivered by ${characterId}`);
    // Репутация за доставленный караван — фракция Торговцев. Повторно не
    // начислится: после сдачи статус становится 'delivered', и getActive
    // возвращает null, поэтому повторный deliver отсекается строкой выше.
    void grantReputation(characterId, 'tradeDone');

    // Счётчик достижения. Начисляется ТОЛЬКО здесь, где груз сдан и
    // награда выдана: принять контракт - ещё не выполнить его.
    //
    // ПОСЛЕ выплат. Если бы счётчик рос, а выплата упала, контракт был бы
    // засчитан, а денег не было бы. Порядок «сначала награда, потом
    // счётчик» означает, что счётчик считает выполненное.
    await new LeaderboardService().increment(characterId, { tradesCompleted: 1 })
      .catch(err => logger.error('[Trade] счётчик контрактов не вырос:', (err as Error).message));

    // Золото в ответе — фактически выплаченное, без налога: панель показывает
    // игроку то, что пришло в сумку, а не то, что было до пошлины.
    return { ok: true, gold: золотоИгроку, exp: def.rewardExp, silver, syrian, contract: def, налог };
  }

  /** Отказаться от контракта: груз возвращается (караван развернулся) */
  async cancel(characterId: string): Promise<boolean> {
    const active = await this.getActive(characterId);
    if (!active) return false;
    // Если караван уже пришёл, груз лежит в сумке — второй раз не отдаём
    if (active.status === 'transit') {
      await this.characters.addItems(characterId, [{ itemId: active.cargoItemId, qty: active.cargoQty }]).catch(() => {});
    }
    await this.db.query(
      `UPDATE trade_caravans SET status = 'cancelled', completed_at = NOW()
        WHERE owner_id = $1 AND status IN ('transit', 'arrived')`,
      [characterId]
    ).catch(() => {});
    await this.redis.del(CONTRACT_KEY(characterId)).catch(() => {});
    return true;
  }

  /** Описание контрактов для клиента (с именами предметов) */
  listForClient(): (TradeContractDef & { cargoNameRu: string })[] {
    return TRADE_CONTRACTS.map(c => ({
      ...c,
      cargoNameRu: ITEMS_DATABASE[c.cargoItemId]?.nameRu ?? c.cargoItemId,
    }));
  }
}
