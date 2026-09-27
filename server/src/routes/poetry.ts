// ============================================================
// Poetry of Hafiz — API routes — Empire of Safavids
// ============================================================

import { Router } from 'express';
import { getPoetryGame, POETRY_CHALLENGES } from '../systems/PoetryOfHafiz';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const poetry = getPoetryGame();

// Список доступных стихотворений
router.get('/challenges', authMiddleware, (_req, res) => {
  res.json({
    challenges: POETRY_CHALLENGES.map(c => ({
      id: c.id,
      title: c.title,
      titleRu: c.titleRu,
      difficulty: c.difficulty,
      lineCount: c.lines.length,
      reward: c.reward,
    })),
  });
});

// Начать игру
router.post('/start', authMiddleware, (req: any, res) => {
  try {
    // challengeId — чтобы игрок начинал именно то стихотворение, которое
    // выбрал в списке. Раньше выбор строки в списке ни на что не влиял:
    // сервер брал случайное стихотворение той же сложности.
    const state = poetry.startGame(req.userId, req.body.difficulty, req.body.challengeId);
    if (!state) { res.status(400).json({ error: 'No challenge available' }); return; }
    const data = poetry.getChallenge(state.gameId);
    if (!data) { res.status(500).json({ error: 'Challenge not found' }); return; }
    res.json({
      gameId: state.gameId,
      challenge: {
        id: data.challenge.id,
        title: data.challenge.title,
        titleRu: data.challenge.titleRu,
        difficulty: data.challenge.difficulty,
        lineCount: data.challenge.lines.length,
      },
      options: data.shuffled,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Выбрать строку
router.post('/select', authMiddleware, (req, res) => {
  try {
    const { gameId, lineIndex } = req.body;
    const state = poetry.selectLine(gameId, lineIndex);
    if (!state) { res.status(400).json({ error: 'Invalid selection' }); return; }
    res.json({
      selectedCount: state.selectedLines.length,
      isComplete: state.isComplete,
      isCorrect: state.isCorrect,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Отменить последний выбор
router.post('/undo', authMiddleware, (req, res) => {
  const { gameId } = req.body;
  const state = poetry.getResult(gameId);
  if (!state || state.isComplete) { res.status(400).json({ error: 'Cannot undo' }); return; }
  state.selectedLines.pop();
  res.json({ selectedCount: state.selectedLines.length });
});

// Удалить игру
router.post('/quit', authMiddleware, (req, res) => {
  poetry.deleteGame(req.body.gameId);
  res.json({ success: true });
});

export default router;
