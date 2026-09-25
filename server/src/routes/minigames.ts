// ============================================================
// Chess of the Shah — API routes — Empire of Safavids
// ============================================================

import { Router } from 'express';
import { getChessGame } from '../systems/ChessOfTheShah';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const chess = getChessGame();

// Начать партию
router.post('/start', authMiddleware, (req: any, res) => {
  try {
    const playerId = req.userId;
    const betGold = Math.min(Math.max(Number(req.body.betGold) || 50, 10), 5000);
    const game = chess.startGame(playerId, betGold);
    res.json({
      gameId: game.gameId,
      board: game.board,
      turn: game.turn,
      status: game.status,
      betGold: game.betGold,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Сделать ход
router.post('/move', authMiddleware, (req: any, res) => {
  try {
    const { gameId, from, to } = req.body;
    const result = chess.makeMove(gameId, req.userId, { from, to });
    if (!result.success) {
      res.status(400).json({ error: 'Invalid move' });
      return;
    }
    const resp: any = {
      board: result.state.board,
      turn: result.state.turn,
      status: result.state.status,
    };
    if (result.result) {
      resp.result = result.result;
    } else {
      // AI делает ход
      const aiState = chess.aiMove(gameId);
      if (aiState) {
        resp.board = aiState.board;
        resp.turn = aiState.turn;
        resp.status = aiState.status;
        if (aiState.status === 'checkmate' || aiState.status === 'stalemate') {
          resp.result = {
            winner: aiState.status === 'checkmate' ? 'black' : 'draw',
            goldWon: betGoldFromState(aiState),
            messageRu: aiState.status === 'checkmate' ? 'Мат! Шахматный Мастер победил!' : 'Пат — ничья!',
          };
        }
      }
    }
    res.json(resp);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

function betGoldFromState(state: any): number {
  return state.betGold ?? 50;
}

// Получить текущую игру
router.get('/state/:gameId', authMiddleware, (req, res) => {
  const game = chess.getGame(req.params.gameId);
  if (!game) { res.status(404).json({ error: 'Game not found' }); return; }
  res.json({
    board: game.board,
    turn: game.turn,
    status: game.status,
    moveCount: game.moveHistory.length,
    betGold: game.betGold,
  });
});

// Сдаться / выйти
router.post('/resign', authMiddleware, (req, res) => {
  const { gameId } = req.body;
  chess.deleteGame(gameId);
  res.json({ success: true });
});

export default router;
