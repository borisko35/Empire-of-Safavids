// Аренда шарда инстансом.
//
// ЗАЧЕМ. Сейчас `SpawnSystem.activateShard()` кладёт shardId в ЛОКАЛЬНЫЙ
// Set, и все восемь шардов активируются в каждом процессе. При двух инстансах
// оба спавнили бы одних и техых монстров: два набора с разными instanceId,
// объявленных всем, но бить можно только своего. Вид «двойной толпы, одна
// невосприимчивая» — ровно то, ради чего мы и начали масштабирование.
//
// Аренда решает это одним механизмом: шард принадлежит одному инстансу, тот
// держит его бой и спавн. Взял — работает; потерял TTL — остановился;
// упавший инстанс освобождает шард по истечении срока.
//
// ПОЧЕМУ АРЕНДА, А НЕ ВЛАДЕНИЕ НАВСЕГДА. Инстансы падают, перезапускаются,
// выкатываются. Постоянное владение означало бы, что упавший инстанс утащил
// шард с собой — до перезапуска всего сервера. Аренда с TTL освобождает
// шард сама.
//
// ПОЧЕМУ HEARTBEAT, А НЕ ОДНО ВЗЯТИЕ. TTL сам по себе ничего не знает о
// том, жив ли инстанс: пока Redis не заметит, шард числится занятым.
// Heartbeat продлевает срок ТОЛЬКО у владельца — иначе два инстанса
// продлевали бы чужую аренду друг за другом.
import { RedisService } from '../services/RedisService';
import { logger } from '../utils/logger';
import { GAME_SERVERS } from '../../../shared/constants';

/** Срок аренды. 21 секунда: три продления укладываются с запасом. */
export const SHARD_LEASE_TTL_SEC = 21;

/** Как часто продлевать. Ровно втрое короче срока: три промаха до потери. */
export const SHARD_HEARTBEAT_EVERY_SEC = 7;

export interface ShardLeaseStatus {
  shardId: string;
  /** Сейчас мой? */
  mine: boolean;
  /** Чей в данный момент (id инстанса) — для логов и панели. */
  owner: string | null;
}

export class ShardLease {
  private redis = RedisService.getInstance();
  /** Свой код инстанса. Пока это код процесса; не идентификатор контейнера. */
  readonly instanceId: string;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(instanceId?: string) {
    // PID в id намеренно: при локальном запуске двух процессов для проверки
    // это единственный способ отличить их друг от друга.
    this.instanceId = instanceId ?? `inst_${Date.now()}_${process.pid}`;
  }

  private key(shardId: string): string {
    return `shard:lease:${shardId}`;
  }

  /**
   * Взять шард. true — теперь мой.
   *
   * СВОЯ АРЕНДА СЧИТАЕТСЯ УСПЕХОМ. Занятый ключ проверяется на владельца, и
   * если он наш — продлевается, а не отвергается.
   *
   * ЧТО ЗДЕСЬ БЫЛО. `acquireIfFree` смотрит только на существование ключа, и
   * потому ключ, занятый нами же на прошлой активации, выглядел как «занято
   * другим». Дальше это складывалось в поломку, замкнутую сама на себя:
   *
   *   17:44:45  [Spawn] Shard activated: isfahan
   *   17:53:17  [Spawn] Shard deactivated: isfahan   ← ушёл последний игрок
   *   18:00:27  Player authenticated: EosProbe        ← шард НЕ активирован
   *
   * Деактивация снимает шард с локального учёта, но аренда остаётся в Redis,
   * а сердцебиение её продлевает — срок не истекает никогда. Следующая
   * активация видела занятый ключ, отвергалась и не логировалась, и монстры в
   * мире не появлялись вовсе: ни одного `monster:spawned`, пустая полоса до
   * самой стены города, уровень 1, бой недоступен. Выглядит как «в игре нет
   * монстров», и выглядит одинаково при каждом следующем входе, пока сервер
   * не перезапустят.
   *
   * Теперь своя аренда продлевается и возвращает true: владелец один,
   * конкурента нет.
   */
  async acquire(shardId: string): Promise<boolean> {
    const взял = await this.redis.acquireIfFree(this.key(shardId), this.instanceId, SHARD_LEASE_TTL_SEC);
    if (взял) {
      logger.info(`[Shard] шард ${shardId} взят инстансом ${this.instanceId}`);
      return true;
    }
    const статус = await this.status(shardId);
    if (!статус.mine) return false;
    await this.renew(shardId);
    logger.info(`[Shard] шард ${shardId} уже был наш (${this.instanceId}), продлили`);
    return true;
  }

  /**
   * Продлить аренду. Только владелец. false — шард ушёл кому-то другому.
   *
   * Продление идёт тем же Lua-путём, что и снятие: «установить, только если
   * во мне». Через GET + EXPIRE и снятие чужого, и продление чужого
   * выглядели бы одинаково успешно.
   */
  async renew(shardId: string): Promise<boolean> {
    const продлил = await this.redis.renewIfOwner(this.key(shardId), this.instanceId, SHARD_LEASE_TTL_SEC);
    if (!продлил) logger.warn(`[Shard] шард ${shardId} больше не мой — продление не прошло`);
    return продлил;
  }

  /** Освободить шард. true — снял именно мой. */
  async release(shardId: string): Promise<boolean> {
    const снял = await this.redis.releaseIfOwner(this.key(shardId), this.instanceId);
    if (снял) logger.info(`[Shard] шард ${shardId} освобождён инстансом ${this.instanceId}`);
    return снял;
  }

  /** Состояние аренды — для логов и панели. */
  async status(shardId: string): Promise<ShardLeaseStatus> {
    const owner = await this.redis.get(this.key(shardId));
    return { shardId, mine: owner === this.instanceId, owner };
  }

  /**
   * Запустить сердцебиение по списку шардов.
   *
   * Один таймер на все шарды, а не таймер на шард: восемь таймеров на
   * восьми шардах дали бы восемь точек отказа в логах вместо одной.
   * Продление идёт по всем взятым сразу — меньше обращений к Redis.
   */
  startHeartbeat(шарды: string[] = GAME_SERVERS.map((с) => с.id)): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      void (async () => {
        for (const shardId of шарды) {
          try {
            const статус = await this.status(shardId);
            if (статус.owner === null) continue; // не мой — не трогаем
            if (!статус.mine) {
              logger.warn(`[Shard] шард ${shardId} у ${статус.owner}: свой пропущен`);
              continue;
            }
            await this.renew(shardId);
          } catch (e) {
            logger.error('[Shard] сердцебиение:', (e as Error).message);
          }
        }
      })();
    }, SHARD_HEARTBEAT_EVERY_SEC * 1000);
  }

  stopHeartbeat(): void {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
