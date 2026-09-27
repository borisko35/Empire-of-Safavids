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
  /** Что назвал первый игрок: null — ещё не ответил */
  p1_confirmed?: string | null;
  /** Что назвал второй игрок */
  p2_confirmed?: string | null;
  /** До какого момента ждём второго подтверждения */
  settle_after?: Date | string | null;
}

/** Сколько ждём второго подтверждения, секунд */
export const PVP_CONFIRM_WINDOW_SEC = 90;

/** Что вернуть игроку после попытки подтвердить исход */
export interface PvPSettleResult {
  /** 'settled' — бой закрыт, рейтинг пересчитан */
  status: 'settled' | 'pending' | 'draw';
  winnerId?: string | undefined;
  winnerChange?: number | undefined;
  loserChange?: number | undefined;
  winnerNewRating?: number | undefined;
  loserNewRating?: number | undefined;
  /** До какого момента ждём второго, если status = 'pending' */
  settleAfter?: string | undefined;
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

  /**
   * Игрок объявляет исход боя. Исход засчитывается, только когда
   * подтвердили оба — либо оба назвали одного, либо один не ответил
   * за отведённое время.
   *
   * Раньше winnerId приходил из тела запроса и не проверялся НИКОМ:
   * можно было назвать победителем любого персонажа и накрутить рейтинг.
   * Теперь вызывающий обязан быть участником матча, а названный
   * победитель — одним из двоих.
   */
  async reportResult(
    matchId: number,
    characterId: string,
    claimedWinnerId: string,
  ): Promise<PvPSettleResult> {
    const match = await this.db.queryOne<PvPMatch>(
      'SELECT * FROM pvp_arena WHERE id = $1', [matchId],
    );
    if (!match || !match.player2_id) throw new Error('Match not found or not ready');

    // Матч уже рассчитан — повторно пересчитывать рейтинг нельзя,
    // иначе можно было бы дёрнуть /complete много раз и накрутить очки
    if (match.status === 'finished' || match.winner_id) {
      throw new Error('Match already finished');
    }

    const isP1 = characterId === match.player1_id;
    const isP2 = characterId === match.player2_id;
    if (!isP1 && !isP2) throw new Error('You are not a participant of this match');

    // Победителем может быть только один из двоих. Иначе можно было бы
    // подсунуть третьего персонажа и начислить ему победу
    if (claimedWinnerId !== match.player1_id && claimedWinnerId !== match.player2_id) {
      throw new Error('Winner must be one of the match participants');
    }

    // Записываем ответ игрока и назначаем срок ожидания второму
    const settleAfter = new Date(Date.now() + PVP_CONFIRM_WINDOW_SEC * 1000);
    await this.db.query(
      `UPDATE pvp_arena
          SET ${isP1 ? 'p1_confirmed' : 'p2_confirmed'} = $1,
              settle_after = COALESCE(settle_after, $2)
        WHERE id = $3`,
      [claimedWinnerId, settleAfter.toISOString(), matchId],
    );

    return this.trySettle(matchId);
  }

  /**
   * Попытаться закрыть матч по накопленным подтверждениям.
   * Правила описаны в миграции 035.
   */
  async trySettle(matchId: number): Promise<PvPSettleResult> {
    const match = await this.db.queryOne<PvPMatch>(
      'SELECT * FROM pvp_arena WHERE id = $1', [matchId],
    );
    if (!match || !match.player2_id) throw new Error('Match not found or not ready');
    if (match.status === 'finished' || match.winner_id) {
      return { status: 'settled', winnerId: match.winner_id ?? undefined };
    }

    const p1 = match.p1_confirmed ?? null;
    const p2 = match.p2_confirmed ?? null;
    const deadline = match.settle_after ? new Date(match.settle_after).getTime() : 0;
    const expired = deadline > 0 && Date.now() >= deadline;

    // 1) Оба назвали одного — победа ему
    if (p1 && p2 && p1 === p2) {
      return this.finishMatch(match, p1);
    }

    // 2) Оба ответили, но назвали разных — ничья. Иначе врать выгодно
    if (p1 && p2 && p1 !== p2) {
      await this.db.query(
        `UPDATE pvp_arena SET status = 'draw', ended_at = NOW(), settle_after = NULL
          WHERE id = $1 AND status <> 'finished'`, [matchId],
      );
      logger.info(`[PvP] Match ${matchId} disputed by both players → draw`);
      return { status: 'draw' };
    }

    // 3) Один не ответил за отведённое время — он проиграл
    if (expired) {
      const answered = p1 ?? p2;
      if (answered) {
        logger.info(`[PvP] Match ${matchId}: opponent silent, win to ${answered}`);
        return this.finishMatch(match, answered);
      }
      // не ответил никто — закрываем в ничью, рейтинг не трогаем
      await this.db.query(
        `UPDATE pvp_arena SET status = 'draw', ended_at = NOW(), settle_after = NULL
          WHERE id = $1 AND status <> 'finished'`, [matchId],
      );
      return { status: 'draw' };
    }

    // 4) Ждём второго
    return {
      status: 'pending',
      settleAfter: match.settle_after ? new Date(match.settle_after).toISOString() : undefined,
    };
  }

  /** Закрыть матч победой winnerId и пересчитать рейтинг */
  private async finishMatch(match: PvPMatch, winnerId: string): Promise<PvPSettleResult> {
    const loserId = winnerId === match.player1_id ? match.player2_id! : match.player1_id;
    const winnerRating = winnerId === match.player1_id ? match.player1_rating : match.player2_rating;
    const loserRating = loserId === match.player1_id ? match.player1_rating : match.player2_rating;

    const winnerChange = calcRatingChange(winnerRating, loserRating, true);
    const loserChange = calcRatingChange(loserRating, winnerRating, false);

    const winnerNewRating = Math.max(0, winnerRating + winnerChange);
    const loserNewRating = Math.max(0, loserRating + loserChange);

    // status <> 'finished' в WHERE: если два запроса пришли одновременно,
    // второй не должен начислить рейтинг поверх первого
    const done = await this.db.query(
      `UPDATE pvp_arena SET winner_id = $1, rating_change = $2, ended_at = NOW(),
              status = 'finished', settle_after = NULL
        WHERE id = $3 AND status <> 'finished' AND winner_id IS NULL`,
      [winnerId, winnerChange, match.id],
    );
    if (!done.length) {
      // Матч уже закрыт другим запросом — возвращаем как есть
      return { status: 'settled', winnerId: undefined };
    }

    await this.updateRanking(winnerId, winnerNewRating, true);
    await this.updateRanking(loserId, loserNewRating, false);

    logger.info(`[PvP] Match ${match.id} won by ${winnerId} (${winnerChange >= 0 ? '+' : ''}${winnerChange})`);
    return { status: 'settled', winnerId, winnerChange, loserChange, winnerNewRating, loserNewRating };
  }

  /** Статус матча для клиента: закрыт он и ждёт ли подтверждения */
  async getMatchStatus(matchId: number): Promise<PvPSettleResult> {
    return this.trySettle(matchId);
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
