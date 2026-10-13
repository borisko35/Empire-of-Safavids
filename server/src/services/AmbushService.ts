// ============================================================
// Засада на караван — Шёлковый путь
// ============================================================
//
// ЧТО ЗДЕСЬ. Торговая система (TradeService) умела принять контракт,
// отправить караван и принять груз. Караван шёл в одиночку, и на дороге не
// было никого, кроме разбойников: весь риск лежал на том, кто принял
// контракт. Здесь появляется второй риск — такой же, как в жизни: груз
// можно отнять.
//
// ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ СЕРВИС, А НЕ МЕТОД TradeService. TradeService
// знает про контракты, груз и сроки. Он ничего не знает про бой: кто
// кого бьёт, где монстр стоит и что с ним будет, когда его убьют. Связывать
// это в одном классе означало бы, что торговля не может быть проверена без
// боя, а бой — без торговли. Здесь общая точка одна — trade_caravans, — и
// она по id.
//
// ЧТО ПРОВЕРЯЕТСЯ И ПОЧЕМУ ТАК.
//   • Гонорар списывается ДО подъёма конвоя. Обратный порядок дарил бы
//     бесплатную засаду: конвой убит, а золото не списали, потому что
//     что-то упало при выдаче.
//   • Чужой караван. Своего грабить бессмысленно, но правило всё равно
//     стоит: иначе один аккаунт с двумя персонажами кормит сам себя.
//   • Один засадный заход на караван. Иначе толпа собирает конвой за минуту
//     и делит между собой, и засада перестаёт быть состязанием.
//   • Караван должен быть в пути. Прибывший стоит у ворот получателя и
//     не охраняется.
import { DatabaseService } from '../services/DatabaseService';
import { CharacterService } from '../services/CharacterService';
import { RedisService } from '../services/RedisService';
import { GameLoop } from '../systems/GameLoop';
import { MONSTERS_DATABASE } from '../data/monsters';
import { ambushFor, ambushPoint } from '../data/ambushes';
import { TRADE_CONTRACTS } from '../systems/TradeService';
import type { Region } from '../types/game.types';
import { logger } from '../utils/logger';

/** Караван, видимый всем на дороге. Хозяина видно по имени — это и есть цель. */
export interface RoadCaravan {
  ownerId: string;
  ownerName: string;
  contractId: string;
  contractNameRu: string;
  originRegion: Region;
  destRegion: Region;
  cargoItemId: string;
  cargoQty: number;
  /** Момент прихода, мс серверного времени. */
  arrivesAt: number;
  /** Цена засады за этот караван. */
  bounty: number;
  /** Уже пробовали засадить — повторно нельзя. */
  ambushed: boolean;
}

export interface AmbushStart {
  ok: boolean;
  reason?: string;
  convoy?: {
    position: { x: number; y: number; z: number };
    total: number;
    secondsLeft: number;
  };
  gold?: number;
}

export class AmbushService {
  private db = DatabaseService.getInstance();
  private characters = new CharacterService();
  private redis = RedisService.getInstance();

  /**
   * Кто на дороге.
   *
   * Имя хозяина отдаётся: анонимный караван грабить неинтересно, и
   * секретность тут не цель, а спойлер. Строка с грузом, маршрутом и сроком —
   * всё, что нужно нападающему, и всё, что можно показать.
   */
  async дорога(characterId: string): Promise<RoadCaravan[]> {
    const rows = await this.db.query<{
      owner_id: string;
      name: string;
      contract_id: string;
      origin_region: Region;
      dest_region: Region;
      item_id: string;
      quantity: number;
      eta_minutes: number;
      started_at: Date;
      ambushed: boolean;
    }>(
      `SELECT c.owner_id, ch.name, c.contract_id, c.origin_region, c.dest_region,
              c.item_id, c.quantity, c.eta_minutes, c.started_at,
              (EXISTS (SELECT 1 FROM caravan_ambushes a
                        WHERE a.caravan_owner_id = c.owner_id
                          AND a.contract_id = c.contract_id)) AS ambushed
         FROM trade_caravans c
         JOIN characters ch ON ch.id = c.owner_id
        WHERE c.status = 'transit'
          AND c.owner_id <> $1
        ORDER BY c.started_at ASC
        LIMIT 20`,
      [characterId],
    );

    const сейчас = Date.now();
    return rows.map((r) => {
      const приход = new Date(r.started_at).getTime() + r.eta_minutes * 60_000;
      const контракт = TRADE_CONTRACTS.find((c) => c.id === r.contract_id);
      return {
        ownerId: r.owner_id,
        ownerName: r.name,
        contractId: r.contract_id,
        contractNameRu: контракт?.nameRu ?? r.contract_id,
        originRegion: r.origin_region,
        destRegion: r.dest_region,
        cargoItemId: r.item_id,
        cargoQty: r.quantity,
        arrivesAt: приход,
        bounty: ambushFor(r.contract_id)?.bounty ?? 0,
        ambushed: r.ambushed,
        // Прибывшие не охраняются: к моменту прихода `status` ещё transit,
        // пока никто не спросил, — и в списке они висели бы, хотя ограбить
        // их уже нельзя.
        ...(приход <= сейчас ? { arrivesAt: приход } : {}),
      };
    }).filter((c) => c.arrivesAt > сейчас);
  }

  /**
   * Поднять засаду.
   *
   * Гонорар и запись идут одной транзакцией: запись без гонорара дала бы
   * бесплатную засаду, а гонорар без записи — бессмысленное списание.
   */
  async начать(characterId: string, ownerId: string): Promise<AmbushStart> {
    if (!ownerId || ownerId === characterId) return { ok: false, reason: 'own_caravan' };

    const караваны = await this.db.query<{
      contract_id: string; item_id: string; quantity: number;
      status: string; eta_minutes: number; started_at: Date;
    }>(
      `SELECT contract_id, item_id, quantity, status, eta_minutes, started_at
         FROM trade_caravans
        WHERE owner_id = $1 AND status = 'transit'
        ORDER BY started_at DESC LIMIT 1`,
      [ownerId],
    );
    const караван = караваны[0];
    if (!караван) return { ok: false, reason: 'caravan_not_in_transit' };

    const приход = new Date(караван.started_at).getTime() + караван.eta_minutes * 60_000;
    const осталось = Math.floor((приход - Date.now()) / 1000);
    if (осталось <= 0) return { ok: false, reason: 'caravan_already_arrived' };

    const засада = ambushFor(караван.contract_id);
    if (!засада) return { ok: false, reason: 'ambush_not_defined' };

    const уже = await this.db.query(
      `SELECT 1 FROM caravan_ambushes WHERE caravan_owner_id = $1 AND contract_id = $2 LIMIT 1`,
      [ownerId, караван.contract_id],
    );
    if (уже.length) return { ok: false, reason: 'caravan_already_ambushed' };

    const герой = await this.characters.getCharacterById(characterId);
    if (!герой) return { ok: false, reason: 'character_not_found' };

    // Гонорар списывается ДО подъёма конвоя: если конвой не поднимется,
    // списание уже есть, и это честно — игрок заплатил за попытку.
    let золото: number | null = null;
    try {
      золото = await this.db.transaction(async (client) => {
        const списание = await client.query(
          `UPDATE characters SET gold = gold - $2, updated_at = NOW()
            WHERE id = $1 AND gold >= $2 RETURNING gold`,
          [characterId, засада.bounty],
        );
        if (списание.rowCount === 0) return null;
        await client.query(
          `INSERT INTO caravan_ambushes (ambusher_id, caravan_owner_id, contract_id, outcome, started_at)
           VALUES ($1, $2, $3, 'in_progress', NOW())`,
          [characterId, ownerId, караван.contract_id],
        );
        return Number(списание.rows[0].gold);
      });
    } catch (e) {
      logger.error('[Ambush] засада не началась:', (e as Error).message);
      return { ok: false, reason: 'ambush_failed' };
    }
    if (золото === null) return { ok: false, reason: 'no_gold' };

    // Конвой поднимается в точке засады его региона. Позиция берётся из
    // данных, а не от клиента: иначе игрок поднял бы засаду у себя на
    // крыше и никого не встретил.
    const ai = GameLoop.getInstance().getSpawnSystem().getAI();
    const шард = герой.serverId ?? 'isfahan';
    const база = ambushPoint(герой.region);
    let поднято = 0;
    const поднятые: string[] = [];
    for (const отряд of засада.escorts) {
      const def = MONSTERS_DATABASE[отряд.monsterId];
      if (!def) continue;
      for (let i = 0; i < отряд.count; i++) {
        const ctx = ai.spawnMonster(def, {
          x: база.x + отряд.offsetX + (i % 2) * 2,
          y: 0,
          z: база.z + отряд.offsetZ + Math.floor(i / 2) * 2,
        }, шард);
        // Объявляем вручную: спавн по точке идёт мимо SpawnSystem и сам
        // в Redis ничего не пишет, а без объявления конвой не существует
        // ни для кого, включая нападавшего.
        await this.redis.publish(`region:${шард}:${герой.region}:spawn`, {
          instanceId: ctx.instanceId,
          monsterId: def.id,
          nameRu: def.nameRu,
          position: ctx.position,
          hp: def.hp,
          type: def.type,
          aquatic: def.aquatic === true,
          aquaticSize: def.aquaticSize,
        }).catch(() => {});
        поднято++;
        поднятые.push(ctx.instanceId);
      }
    }

    if (!поднято) {
      logger.error('[Ambush] конвой не поднялся: нет ни одного монстра в базе');
      return { ok: false, reason: 'convoy_unavailable' };
    }

    // Состав конвоя — в Redis, а не в таблице. Засада живёт минуты и не
    // переживает перезапуск: если сервер упал посреди боя, караван должен
    // просто уехать, а не висеть вечно в базе в состоянии «засада идёт».
    // По той же причине монстры конвоя адресуются через обратную ссылку:
    // смерть приходит по instanceId, а засада знает про нападавшего.
    const ключЗасады = this.засадаKey(characterId, ownerId, караван.contract_id);
    for (const instanceId of поднятые) {
      await this.redis
        .set(`ambush:escort:${instanceId}`, ключЗасады, засада.durationSeconds)
        .catch(() => {});
      await this.redis.sadd(`ambush:convoy:${ключЗасады}`, instanceId).catch(() => {});
    }
    await this.redis.expire(`ambush:convoy:${ключЗасады}`, засада.durationSeconds).catch(() => {});

    logger.info(
      `[Ambush] ${characterId} поднял засаду на караван ${ownerId} (${караван.contract_id}), ` +
      `конвой ${поднято}, осталось ${осталось} с`,
    );

    return {
      ok: true,
      gold: золото,
      convoy: {
        position: { x: база.x, y: 0, z: база.z },
        total: поднято,
        secondsLeft: Math.min(засада.durationSeconds, осталось),
      },
    };
  }

  /**
   * Забрать добычу, когда конвой выбит.
   *
   * Вызывается из обработчика смерти монстра. Проверяется, что засада
   * действительно идёт и действительно про этого каравана: иначе любой
   * убитый монстр в регионе выдавал бы груз.
   */
  async собрать(
    ambusherId: string,
    caravanOwnerId: string,
    contractId: string,
  ): Promise<{ ok: boolean; items: { itemId: string; qty: number }[] }> {
    const засады = await this.db.query<{ id: string }>(
      `SELECT id FROM caravan_ambushes
        WHERE ambusher_id = $1 AND caravan_owner_id = $2 AND contract_id = $3 AND outcome = 'in_progress'
        LIMIT 1`,
      [ambusherId, caravanOwnerId, contractId],
    );
    const засада = засады[0];
    if (!засада) return { ok: false, items: [] };

    // Повторно закрыть нельзя: проверка выше отдаёт засаду один раз, но
    // между ней и UPDATE проходит время, и второй удар мог бы собрать добычу
    // дважды.
    const закрыта = await this.db.query(
      `UPDATE caravan_ambushes SET outcome = 'won', finished_at = NOW()
        WHERE id = $1 AND outcome = 'in_progress' RETURNING id`,
      [засада.id],
    );
    if (!закрыта.length) return { ok: false, items: [] };

    const караваны = await this.db.query<{ item_id: string; quantity: number }>(
      `SELECT item_id, quantity FROM trade_caravans
        WHERE owner_id = $1 AND contract_id = $2 AND status = 'transit' LIMIT 1`,
      [caravanOwnerId, contractId],
    );
    const караван = караваны[0];
    if (!караван) return { ok: true, items: [] };

    const засадаDef = ambushFor(contractId);
    const доля = Math.max(1, Math.floor(караван.quantity * (засадаDef?.cargoShare ?? 0.6)));
    await this.db.query(
      `UPDATE trade_caravans SET status = 'robbed', completed_at = NOW()
        WHERE owner_id = $1 AND contract_id = $2 AND status = 'transit'`,
      [caravanOwnerId, contractId],
    );
    await this.redis.del(`trade:contract:${caravanOwnerId}`).catch(() => {});
    await this.characters.addItems(ambusherId, [{ itemId: караван.item_id, qty: доля }]).catch(() => {});

    logger.info(`[Ambush] ${ambusherId} забрал ${доля} × ${караван.item_id} у каравана ${caravanOwnerId}`);
    return { ok: true, items: [{ itemId: караван.item_id, qty: доля }] };
  }

  /** Засада сорвалась: конвой ушёл, срок вышел. Гонорар не возвращается. */
  async сорвалась(ambusherId: string, caravanOwnerId: string, contractId: string): Promise<void> {
    await this.db.query(
      `UPDATE caravan_ambushes SET outcome = 'failed', finished_at = NOW()
        WHERE ambusher_id = $1 AND caravan_owner_id = $2 AND contract_id = $3 AND outcome = 'in_progress'`,
      [ambusherId, caravanOwnerId, contractId],
    ).catch((e) => logger.warn('[Ambush] не записать провал засады:', (e as Error).message));
  }

  private засадаKey(ambusherId: string, caravanOwnerId: string, contractId: string): string {
    return `${ambusherId}:${caravanOwnerId}:${contractId}`;
  }

  /**
   * Эскорт убит.
   *
   * Вызывается из обработчика смерти монстра. Возвращает добычу, только
   * когда убит ПОСЛЕДНИЙ: пока хоть один стоит, засада не выиграна.
   *
   * Если по instanceId нет обратной ссылки — это обычный монстр, а не
   * конвой. Намеренно молча: в регионе всегда есть разбойники, и каждый
   * второй должен был бы писать в лог, что его убили.
   */
  async эскортУбит(
    instanceId: string,
    attackerId: string,
  ): Promise<{ items: { itemId: string; qty: number }[] } | null> {
    const ключЗасады = await this.redis.get(`ambush:escort:${instanceId}`).catch(() => null);
    if (!ключЗасады) return null;

    const состав = `${String(ключЗасады).split(':')[0]}:${String(ключЗасады).split(':')[1]}`;
    const контракт = String(ключЗасады).split(':').slice(2).join(':');

    // srem в RedisService возвращает void, поэтому «остался ли кто-то» читается
// составом после удаления, а не счётчиком удалённых. smembers, а не scard:
    // scard в обвязке нет, а список нужен всё равно — он же показывает,
    // что засада ещё жива, если кто-то спросит.
    await this.redis.srem(`ambush:convoy:${String(ключЗасады)}`, instanceId).catch(() => {});
    const осталось = await this.redis.smembers(`ambush:convoy:${String(ключЗасады)}`).catch(() => []);
    if (осталось.length > 0) return null;

    const добыча = await this.собрать(состав.split(':')[0], состав.split(':')[1], контракт);
    if (!добыча.ok) return null;
    logger.info(`[Ambush] конвой выбит ${attackerId}, забрано ${JSON.stringify(добыча.items)}`);
    return добыча;
  }
}

export const ambush = new AmbushService();