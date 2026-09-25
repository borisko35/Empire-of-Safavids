// ============================================================
// PvP Arena Service — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';

export interface PvPMatch {
  id: number; player1_id: string; player2_id: string | null;
  winner_id: string | null; mode: string;
  player1_rating: number; player2_rating: number;
  rating_change: number; status: string;
}

export interface PvPRanking {
  character_id: string; character_name: string; rating: number;
  wins: number; losses: number; streak: number; best_streak: number; tier: string;
}

const TIER_THRESHOLDS = [
  { tier: 'legendary', min: 2400, icon: '👑' },
  { tier: 'diamond',   min: 2000, icon: '💎' },
  { tier: 'gold',      min: 1600, icon: '🥇' },
  { tier: 'silver',    min: 1200, icon: '🥈' },
  { tier: 'bronze',    min: 0,    icon: '🥉' },
];

function calcTier(rating: number): string {
  for (const t of TIER_THRESHOLDS) {
    if (rating >= t.min) return t.tier;
  }
  return 'bronze';
}

function calcRatingChange(winnerRating: number, loserRating: number, winnerWon: boolean): number {
  const expected = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  const actual = winnerWon ? 1 : 0;
  const k = 32;
  return Math.round(k * (actual - expected));
}

export class PvPService {
  private db = DatabaseService.getInstance();

  async findMatch(charId: string): Promise<PvPMatch | null> {
    // Ищем игрока с похожим рейтингом
    const myRank = await this.db.queryOne<{ rating: number }>(
      'SELECT rating FROM pvp_rankings WHERE character_id = $1', [charId]
    );
    const myRating = myRank?.rating ?? 1000;
    // Ищем открытый матч или создаём новый
    const openMatch = await this.db.queryOne<PvPMatch>(
      `SELECT * FROM pvp_arena
       WHERE player2_id IS NULL AND player1_id != $1 AND status = 'waiting'
       AND ABS(player1_rating - $2) < 300
       ORDER BY ABS(player1_rating - $2) LIMIT 1`,
      [charId, myRating]
    );
    if (openMatch) {
      await this.db.query(
        `UPDATE pvp_arena SET player2_id = $1, player2_rating = $2, status = 'active'
         WHERE id = $3`,
        [charId, myRating, openMatch.id]
      );
      return { ...openMatch, player2_id: charId, player2_rating: myRating, status: 'active' };
    }
    // Создаём новый матч
    const match = await this.db.queryOne<PvPMatch>(
      `INSERT INTO pvp_arena (player1_id, player1_rating, mode, status)
       VALUES ($1, $2, '1v1', 'waiting') RETURNING *`,
      [charId, myRating]
    );
    return match;
  }

  async completeMatch(matchId: number, winnerId: string): Promise<{ winnerChange: number; loserChange: number; winnerNewRating: number; loserNewRating: number }> {
    const match = await this.db.queryOne<PvPMatch>(
      'SELECT * FROM pvp_arena WHERE id = $1', [matchId]
    );
    if (!match || !match.player2_id) throw new Error('Match not found or not ready');

    const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id;
    const winnerRating = winnerId === match.player1_id ? match.player1_rating : match.player2_rating;
    const loserRating = loserId === match.player1_id ? match.player1_rating : match.player2_rating;

    const winnerChange = calcRatingChange(winnerRating, loserRating, true);
    const loserChange = calcRatingChange(loserRating, winnerRating, false);

    const winnerNewRating = Math.max(0, winnerRating + winnerChange);
    const loserNewRating = Math.max(0, loserRating + loserChange);

    await this.db.query(
      `UPDATE pvp_arena SET winner_id = $1, rating_change = $2, ended_at = NOW(), status = 'finished'
       WHERE id = $3`,
      [winnerId, winnerChange, matchId]
    );

    // Обновляем рейтинги
    await this.updateRanking(winnerId, winnerNewRating, true);
    await this.updateRanking(loserId, loserNewRating, false);

    logger.info(`[PvP] Match ${matchId} won by ${winnerId} (${winnerChange >= 0 ? '+' : ''}${winnerChange})`);
    return { winnerChange, loserChange, winnerNewRating, loserNewRating };
  }

  private async updateRanking(charId: string, newRating: number, won: boolean): Promise<void> {
    const existing = await this.db.queryOne<{ rating: number; wins: number; losses: number; streak: number; best_streak: number }>(
      'SELECT * FROM pvp_rankings WHERE character_id = $1', [charId]
    );
    if (existing) {
      const newStreak = won ? existing.streak + 1 : 0;
      const bestStreak = Math.max(existing.best_streak, newStreak);
      await this.db.query(
        `UPDATE pvp_rankings SET rating = $1, wins = wins + $2, losses = losses + $3,
         streak = $4, best_streak = $5, tier = $6 WHERE character_id = $7`,
        [newRating, won ? 1 : 0, won ? 0 : 1, newStreak, bestStreak, calcTier(newRating), charId]
      );
    } else {
      await this.db.query(
        `INSERT INTO pvp_rankings (character_id, rating, wins, losses, streak, best_streak, tier)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [charId, newRating, won ? 1 : 0, won ? 0 : 1, won ? 1 : 0, won ? 1 : 0, calcTier(newRating)]
      );
    }
  }

  async getRankings(limit = 50, offset = 0): Promise<PvPRanking[]> {
    return this.db.query<PvPRanking>(
      `SELECT r.*, c.name as character_name FROM pvp_rankings r
       JOIN characters c ON c.id = r.character_id
       ORDER BY r.rating DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  }

  async getMyRanking(charId: string): Promise<PvPRanking | null> {
    return this.db.queryOne<PvPRanking>(
      `SELECT r.*, c.name as character_name FROM pvp_rankings r
       JOIN characters c ON c.id = r.character_id
       WHERE r.character_id = $1`,
      [charId]
    );
  }

  async getMatchHistory(charId: string, limit = 20): Promise<PvPMatch[]> {
    return this.db.query<PvPMatch>(
      `SELECT * FROM pvp_arena
       WHERE player1_id = $1 OR player2_id = $1
       ORDER BY started_at DESC LIMIT $2`,
      [charId, limit]
    );
  }

  async cancelMatch(matchId: number, charId: string): Promise<void> {
    await this.db.query(
      `UPDATE pvp_arena SET status = 'cancelled', ended_at = NOW()
       WHERE id = $1 AND (player1_id = $2 OR player2_id = $2) AND status IN ('waiting', 'active')`,
      [matchId, charId]
    );
  }
}
