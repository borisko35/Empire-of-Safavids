// ============================================================
// Analytics Service - Empire of Safavids
// ============================================================

import { DatabaseService } from '../services/DatabaseService';
import { logger } from '../utils/logger';

export type AnalyticsEvent =
  | 'player_login' | 'player_logout' | 'character_created'
  | 'level_up' | 'item_crafted' | 'item_purchased'
  | 'auction_listing' | 'auction_sale' | 'dungeon_completed'
  | 'boss_killed' | 'pvp_kill' | 'guild_created'
  | 'premium_purchased' | 'battle_pass_purchased' | 'achievement_earned'
  // Воронка гостевого входа: guest_login — сколько людей начали играть
  // без регистрации, guest_claimed — сколько из них оставили аккаунт.
  // Конверсия второго в первое и есть главная метрика новой фичи.
  | 'guest_login' | 'guest_claimed'
  // session_start — игрок ВОШЁЛ В МИР, а не нажал «Войти». Это единственное
  // событие, по которому честно считаются активные игроки: player_login
  // срабатывает только на форме входа, а токен живёт 30 дней, так что
  // обычный заход на следующий день не оставлял в аналитике ничего.
  | 'session_start';

export class AnalyticsService {
  private db = DatabaseService.getInstance();
  private buffer: { event: AnalyticsEvent; userId?: string; characterId?: string; properties: Record<string, unknown>; timestamp: Date }[] = [];

  constructor() {
    setInterval(() => this.flush(), 5000);
  }

  track(event: AnalyticsEvent, properties: Record<string, unknown> = {}, userId?: string, characterId?: string): void {
    this.buffer.push({ event, userId, characterId, properties, timestamp: new Date() });
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    try {
      const values = batch.map((_, i) => `($${i*5+1},$${i*5+2},$${i*5+3},$${i*5+4},$${i*5+5})`).join(',');
      const params = batch.flatMap(r => [r.event, r.userId ?? null, r.characterId ?? null, JSON.stringify(r.properties), r.timestamp]);
      await this.db.query(`INSERT INTO analytics_events (event,user_id,character_id,properties,timestamp) VALUES ${values}`, params);
    } catch (err) {
      logger.error('[Analytics] Flush failed:', err);
      this.buffer.unshift(...batch);
    }
  }

  /**
   * Активные ИГРОКИ за день: те, кто заходил в мир.
   *
   * Именно эта величина отвечает на вопрос «сколько нас было в игре», и
   * только она годится для удержания. getDailyActiveUsers() ниже считает
   * другое (входы через форму) и не должна называться DAU.
   */
  async getDailyActivePlayers(date: Date): Promise<number> {
    const row = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT user_id) as count FROM analytics_events WHERE event='session_start' AND DATE(timestamp)=DATE($1)`,
      [date]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  /**
   * Входы через форму. ВНИМАНИЕ: это не DAU.
   *
   * Сессия в Redis живёт 30 дней, поэтому игрок, зашедший в игру на второй
   * день, не вызывает player_login вообще. Метрика показывает, сколько раз
   * открыли экран входа, а не сколько играли.
   */
  async getDailyActiveUsers(date: Date): Promise<number> {
    const row = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT user_id) as count FROM analytics_events WHERE event='player_login' AND DATE(timestamp)=DATE($1)`,
      [date]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async getMonthlyActiveUsers(year: number, month: number): Promise<number> {
    const row = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT user_id) as count FROM analytics_events WHERE event='player_login' AND EXTRACT(YEAR FROM timestamp)=$1 AND EXTRACT(MONTH FROM timestamp)=$2`,
      [year, month]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async getClassPopularity(): Promise<{ class: string; count: number }[]> {
    return this.db.query(`SELECT class, COUNT(*) as count FROM characters GROUP BY class ORDER BY count DESC`, []);
  }

  async getLevelDistribution(): Promise<{ level: number; count: number }[]> {
    return this.db.query(`SELECT level, COUNT(*) as count FROM characters GROUP BY level ORDER BY level ASC`, []);
  }

  async getRegionPopulation(): Promise<{ region: string; count: number }[]> {
    return this.db.query(`SELECT region, COUNT(*) as count FROM characters GROUP BY region ORDER BY count DESC`, []);
  }
}

export const analytics = new AnalyticsService();
