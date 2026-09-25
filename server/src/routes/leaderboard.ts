// ============================================================
// Leaderboard Routes — Empire of Safavids
// ============================================================

import { Router, Request, Response } from 'express';
import { LeaderboardService, LeaderboardType } from '../services/LeaderboardService';
import { secureMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

export const leaderboardRouter = Router();
const leaderboardService = new LeaderboardService();

const VALID_TYPES = new Set<LeaderboardType>(['level', 'pvp', 'kills', 'quests', 'playtime']);

// GET /api/leaderboard/top/:type — публичный топ для лендинга (без авторизации, лимит до 20)
leaderboardRouter.get('/top/:type', asyncHandler(async (req: Request, res: Response) => {
  const type = req.params.type as LeaderboardType;
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: 'Invalid leaderboard type. Use: level, pvp, kills, quests, playtime' });
  }
  const limit = Math.min(Number(req.query.limit) || 10, 20);
  const result = await leaderboardService.getLeaderboard(type, limit, 0);
  return res.json(result);
}));

// GET /api/leaderboard/:type — получить рейтинг
leaderboardRouter.get('/:type', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const type = req.params.type as LeaderboardType;
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: 'Invalid leaderboard type. Use: level, pvp, kills, quests, playtime' });
  }
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;
  const result = await leaderboardService.getLeaderboard(type, limit, offset);
  return res.json(result);
}));

// GET /api/leaderboard/:type/me — моя позиция
leaderboardRouter.get('/:type/me', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const type = req.params.type as LeaderboardType;
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: 'Invalid leaderboard type' });
  }
  // Нужен characterId — берём из query
  const characterId = req.query.characterId as string;
  if (!characterId) return res.status(400).json({ error: 'characterId required' });
  const rank = await leaderboardService.getPlayerRank(characterId, type);
  return res.json({ rank });
}));
