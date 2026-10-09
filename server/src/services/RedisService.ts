import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

export class RedisService {
  private static instance: RedisService;
  private client: RedisClientType;
  // Отдельное соединение для подписок: клиент в режиме подписчика
  // не может выполнять обычные команды.
  private subscriber: RedisClientType | null = null;
  private handlers = new Map<string, ((message: Record<string, unknown>) => void)[]>();
  private subscribedChannels = new Set<string>();

  private constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    }) as RedisClientType;

    this.client.on('error', (err) => logger.error('Redis error:', err));
    this.client.on('connect', () => logger.info('Redis connected'));
  }

  static getInstance(): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService();
    }
    return RedisService.instance;
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  // ============================================================
  // Базовые операции (публичный API вместо доступа к private client)
  // ============================================================
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setEx(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  // ── Множества ──────────────────────────────────────────────────────
  // Добавлены ради рейдов: список открытых рейдов это множество, а не список.
  // Разница не в типе, а в том, что удаление чужого рейда не требует знать,
  // весь ли массив он занимает: массив пришлось бы перечитывать и переписывать
  // целиком, и два писателя затирали бы друг друга.

  /** Добавить в множество. Повторное добавление не ошибка. */
  async sadd(key: string, ...members: string[]): Promise<void> {
    if (members.length) await this.client.sAdd(key, members);
  }

  /** Убрать из множества. Отсутствие элемента не ошибка. */
  async srem(key: string, ...members: string[]): Promise<void> {
    if (members.length) await this.client.sRem(key, members);
  }

  /** Состав множества; пустое множество — пустой массив, а не null. */
  async smembers(key: string): Promise<string[]> {
    return this.client.sMembers(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  // Кэш позиций игроков в реальном времени
  async setPlayerPosition(characterId: string, position: object): Promise<void> {
    await this.client.setEx(
      `player:position:${characterId}`,
      300, // 5 минут TTL
      JSON.stringify(position)
    );
  }

  async getPlayerPosition(characterId: string): Promise<object | null> {
    const data = await this.client.get(`player:position:${characterId}`);
    return data ? JSON.parse(data) : null;
  }

  // Онлайн-игроки в регионе
  /** Членство в регионе конкретного шарда (игрового сервера) */
  async addPlayerToRegion(shardId: string, region: string, characterId: string): Promise<void> {
    const key = `region:players:${shardId}:${region}`;
    await this.client.sAdd(key, characterId);
    await this.client.expire(key, 3600);
    await this.client.sAdd(`shard:members:${shardId}`, characterId);
    await this.client.expire(`shard:members:${shardId}`, 7200);
  }

  async removePlayerFromRegion(shardId: string, region: string, characterId: string): Promise<void> {
    await this.client.sRem(`region:players:${shardId}:${region}`, characterId);
    await this.client.sRem(`shard:members:${shardId}`, characterId);
  }

  async getPlayersInRegion(shardId: string, region: string): Promise<string[]> {
    return this.client.sMembers(`region:players:${shardId}:${region}`);
  }

  /** Сколько игроков сейчас в мире данного шарда */
  async getShardOnline(shardId: string): Promise<number> {
    return this.client.sCard(`shard:members:${shardId}`);
  }

  /** Онлайн ли конкретный персонаж (проверяет наличие свежего ключа позиции) */
  async isPlayerOnline(characterId: string): Promise<boolean> {
    try {
      const exists = await this.client.exists(`player:position:${characterId}`);
      if (exists) return true;
      // fallback: проверить членство в shard:members (на случай если позиция ещё не записана)
      // перебираем известные шарды — импорт избегаем, используем ключи напрямую
      const keys = await this.client.keys('shard:members:*').catch(() => [] as string[]);
      for (const key of keys) {
        const member = await this.client.sIsMember(key, characterId).catch(() => false);
        if (member) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Пакетная проверка онлайна */
  async arePlayersOnline(characterIds: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    if (characterIds.length === 0) return result;
    await Promise.all(characterIds.map(async (id) => {
      result.set(id, await this.isPlayerOnline(id));
    }));
    return result;
  }

  /** Онлайн ли пользователь (любой из его персонажей онлайн) */
  async isUserOnline(userId: string): Promise<boolean> {
    try {
      const { DatabaseService } = await import('./DatabaseService');
      const db = DatabaseService.getInstance();
      const rows = await db.query<{ id: string }>('SELECT id FROM characters WHERE user_id = $1', [userId]);
      for (const r of rows) {
        if (await this.isPlayerOnline(r.id)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Сессии
  async setSession(token: string, userId: string, ttl = 86400): Promise<void> {
    await this.client.setEx(`session:${token}`, ttl, userId);
  }

  async getSession(token: string): Promise<string | null> {
    return this.client.get(`session:${token}`);
  }

  async deleteSession(token: string): Promise<void> {
    await this.client.del(`session:${token}`);
  }

  // ============================================================
  // Pub/Sub для игровых событий
  // ============================================================
  async publish(channel: string, message: object): Promise<void> {
    await this.client.publish(channel, JSON.stringify(message));
  }

  /**
   * Подписка на канал. Лениво создаёт отдельное subscriber-соединение.
   * Возвращает функцию отписки.
   */
  async subscribe(
    channel: string,
    handler: (message: Record<string, unknown>) => void
  ): Promise<() => void> {
    if (!this.subscriber) {
      this.subscriber = this.client.duplicate() as RedisClientType;
      await this.subscriber.connect();
    }

    const list = this.handlers.get(channel) ?? [];
    list.push(handler);
    this.handlers.set(channel, list);

    // Один dispatch-listener на канал; обработчиков может быть несколько
    if (!this.subscribedChannels.has(channel)) {
      this.subscribedChannels.add(channel);
      await this.subscriber.subscribe(channel, (raw, chan) => this.dispatch(chan, raw));
    }

    return () => {
      const remaining = (this.handlers.get(channel) ?? []).filter(h => h !== handler);
      this.handlers.set(channel, remaining);
      if (remaining.length === 0 && this.subscriber) {
        this.subscribedChannels.delete(channel);
        void this.subscriber.unsubscribe(channel).catch(() => {});
      }
    };
  }

  private dispatch(channel: string, raw: string): void {
    const list = this.handlers.get(channel);
    if (!list) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // не JSON — игнорируем
    }
    for (const h of list) {
      try {
        h(parsed);
      } catch (err) {
        logger.error(`Redis handler error for ${channel}:`, err);
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.disconnect();
      this.subscriber = null;
    }
    await this.client.disconnect();
  }
}
