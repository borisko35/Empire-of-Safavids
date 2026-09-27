// ============================================================
// Leaderboard Service — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';

export type LeaderboardType = 'level' | 'pvp' | 'kills' | 'quests' | 'playtime';

export interface LeaderboardEntry {
  rank: number;
  characterId: string;
  characterName: string;
  className: string;
  level: number;
  value: number;
  guild?: string;
}

export class LeaderboardService {
  private db = DatabaseService.getInstance();

  /**
   * Обновить статистику персонажа в рейтинге.
   *
   * ТУТ БЫЛА ОШИБКА, КОТОРУЮ НЕ ВИДНО. Колонки для INSERT брались из
   * Object.keys(stats) целиком, а значения — только те, что не undefined.
   * При частичном вызове (например передан уровень, но не опыт) списки
   * разъезжались: VALUES содержал плейсхолдеры по всем ключам, а параметров
   * было меньше, и значения ложились не в те колонки. Сейчас колонки и
   * значения собираются одним проходом, поэтому разъехаться не могут.
   */
  async updateStats(characterId: string, stats: {
    level?: number;
    experience?: number;
    pvpRating?: number;
    pvpWins?: number;
    pvpLosses?: number;
    monstersKilled?: number;
    questsCompleted?: number;
    playtimeSeconds?: number;
  }): Promise<void> {
    const cols: string[] = [];
    const values: unknown[] = [];
    const fields: string[] = [];

    for (const [key, val] of Object.entries(stats)) {
      if (val === undefined) continue;
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      values.push(val);
      // Плейсхолдер в VALUES идёт по номеру своего значения, а в DO UPDATE
      // — по тому же номеру. Оба считаются из values.length, поэтому всегда
      // совпадают
      const ph = `$${values.length}`;
      cols.push(col);
      fields.push(`${col} = ${ph}`);
    }

    if (cols.length === 0) return;

    await this.db.query(
      `INSERT INTO leaderboard (character_id, ${cols.join(', ')}, updated_at)
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}, NOW())
       ON CONFLICT (character_id) DO UPDATE SET ${fields.join(', ')}, updated_at = NOW()`,
      [characterId, ...values]
    );
  }

  /** Получить рейтинг */
  async getLeaderboard(
    type: LeaderboardType,
    limit = 20,
    offset = 0
  ): Promise<{ entries: LeaderboardEntry[]; total: number }> {
    const orderCol = this.getColumnForType(type);

    const countRow = await this.db.queryOne<{ count: string }>('SELECT COUNT(*) AS count FROM leaderboard');
    const total = Number(countRow?.count ?? 0);

    const rows = await this.db.query<{
      rank_num: string;
      character_id: string;
      character_name: string;
      class_name: string;
      level: number;
      value: number;
      guild_name: string | null;
    }>(
      `SELECT RANK() OVER (ORDER BY ${orderCol} DESC) AS rank_num,
              l.character_id, c.name AS character_name, c.class AS class_name,
              l.level, ${this.getValueExpression(type)} AS value,
              g.name AS guild_name
       FROM leaderboard l
       JOIN characters c ON c.id = l.character_id
       LEFT JOIN guild_members gm ON gm.character_id = l.character_id
       LEFT JOIN guilds g ON g.id = gm.guild_id
       ORDER BY ${orderCol} DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const entries = rows.map(r => ({
      rank: Number(r.rank_num),
      characterId: r.character_id,
      characterName: r.character_name,
      className: r.class_name,
      level: r.level,
      value: Number(r.value),
      guild: r.guild_name ?? undefined,
    }));

    return { entries, total };
  }

  /** Позиция конкретного игрока */
  async getPlayerRank(characterId: string, type: LeaderboardType): Promise<{ rank: number; value: number } | null> {
    const orderCol = this.getColumnForType(type);
    const row = await this.db.queryOne<{ rank: number; value: number }>(
      `WITH ranked AS (
        SELECT character_id, ${this.getValueExpression(type)} AS value,
               RANK() OVER (ORDER BY ${orderCol} DESC) AS rank
        FROM leaderboard
      )
      SELECT rank, value FROM ranked WHERE character_id = $1`,
      [characterId]
    );
    return row ? { rank: Number(row.rank), value: Number(row.value) } : null;
  }

  private getColumnForType(type: LeaderboardType): string {
    switch (type) {
      case 'level': return 'l.experience';
      case 'pvp': return 'l.pvp_rating';
      case 'kills': return 'l.monsters_killed';
      case 'quests': return 'l.quests_completed';
      case 'playtime': return 'l.playtime_seconds';
      default: return 'l.experience';
    }
  }

  private getValueExpression(type: LeaderboardType): string {
    switch (type) {
      case 'level': return 'l.experience';
      case 'pvp': return 'l.pvp_rating';
      case 'kills': return 'l.monsters_killed';
      case 'quests': return 'l.quests_completed';
      case 'playtime': return 'l.playtime_seconds';
      default: return 'l.experience';
    }
  }
}
