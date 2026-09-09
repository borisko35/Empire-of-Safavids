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
  | 'premium_purchased' | 'battle_pass_purchased' | 'achievement_earned';

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

  async getDailyActiveUsers(date: Date): Promise<number> {
    const row = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT user_id) as count FROM analytics_events WHERE event='player_login' AND DATE(timestamp)=DATE($1)`,
      [date]
    );
    return parseInt(row?.count ?? '0');
  }

  async getMonthlyActiveUsers(year: number, month: number): Promise<number> {
    const row = await this.db.queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT user_id) as count FROM analytics_events WHERE event='player_login' AND EXTRACT(YEAR FROM timestamp)=$1 AND EXTRACT(MONTH FROM timestamp)=$2`,
      [year, month]
    );
    return parseInt(row?.count ?? '0');
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
