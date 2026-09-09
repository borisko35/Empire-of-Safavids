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
  async addPlayerToRegion(region: string, characterId: string): Promise<void> {
    await this.client.sAdd(`region:players:${region}`, characterId);
    await this.client.expire(`region:players:${region}`, 3600);
  }

  async removePlayerFromRegion(region: string, characterId: string): Promise<void> {
    await this.client.sRem(`region:players:${region}`, characterId);
  }

  async getPlayersInRegion(region: string): Promise<string[]> {
    return this.client.sMembers(`region:players:${region}`);
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
