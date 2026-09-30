// ============================================================
// Poetry of Hafiz — API routes — Empire of Safavids
// ============================================================

import { Router } from 'express';
import { getPoetryGame, POETRY_CHALLENGES } from '../systems/PoetryOfHafiz';
import { authMiddleware } from '../middleware/auth';
import { DatabaseService } from '../services/DatabaseService';
import { LeaderboardService } from '../services/LeaderboardService';
import { AchievementService } from '../services/AchievementService';
import { logger } from '../utils/logger';

const router = Router();
const poetry = getPoetryGame();
// Свои экземпляры, а не синглтоны из маршрутов: у каждого сервиса своё
// подключение к базе, и взятие чужого молча связало бы два маршрута.
const db = DatabaseService.getInstance();
const leaderboard = new LeaderboardService();
const achievements = new AchievementService();

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

// ── Забрать награду за стихотворение ───────────────────────────
// Раньше маршрута завершения не было вовсе. Маршрут /select доводил игру
// до isComplete, панель показывала «сложено правильно» - и всё. Награды в
// данных стояли (50, 150 и 500 золота по сложности), но до кошелька не
// доходили: игра просто заканчивалась.
//
// Платит только за ВЕРНО собранное и только ОДИН раз: повторный запрос
// с тем же gameId возвращает alreadyClaimed, а не ещё одну выплату.
router.post('/finish', authMiddleware, async (req: any, res) => {
  try {
    const characterId = String(req.body?.characterId ?? '');
    const { gameId } = req.body ?? {};
    if (!characterId || !gameId) {
      res.status(400).json({ error: 'characterId and gameId are required' });
      return;
    }
    // Проверка владения: без неё один вошедший забрал бы награду за
    // чужую игру, зная её gameId.
    const свой = await db.queryOne<{ id: string }>(
      'SELECT id FROM characters WHERE id = $1 AND user_id = $2', [characterId, req.userId],
    );
    if (!свой) { res.status(404).json({ error: 'character_not_found' }); return; }

    const игра = poetry.getResult(gameId);
    if (!игра) { res.status(404).json({ error: 'game_not_found' }); return; }
    // Здесь различаем четыре отказа. «Ничего не пришло» после верно
    // собранного стиха - это обман, и игрок должен знать, что именно
    // произошло: не собрал, собрал неверно или уже забрал.
    if (игра.rewarded) { res.status(409).json({ error: 'already_claimed' }); return; }
    if (!игра.isComplete) { res.status(400).json({ error: 'not_complete' }); return; }
    if (!игра.isCorrect) { res.status(400).json({ error: 'not_correct' }); return; }

    // claimReward сам ставит флаг. Ставить его ДО начисления нельзя: сбой
    // оплаты оставил бы игрока без награды и без права повторить.
    const забрано = poetry.claimReward(gameId);
    if (!забрано) { res.status(409).json({ error: 'already_claimed' }); return; }

    // Оплата и счётчик - одним UPDATE. Разными запросами был бы зазор,
    // в котором награда начислена, а счётчик нет: достижение «Поэт
    // Шираза» осталось бы несчитанным навсегда.
    const оплата = await db.queryOne<{ gold: number; experience: number }>(
      `UPDATE characters
          SET gold = gold + $1, experience = experience + $2
        WHERE id = $3
      RETURNING gold, experience`,
      [забрано.reward.gold, забрано.reward.experience, characterId],
    );

    try {
      await leaderboard.increment(characterId, { poetryCompleted: 1 });
      const новые = await achievements.checkAll(characterId);
      res.json({
        success: true,
        reward: забрано.reward,
        gold: Number(оплата?.gold ?? 0),
        experience: Number(оплата?.experience ?? 0),
        achievements: новые,
      });
    } catch (err) {
      // Золото начислено, а счётчик или достижение не записались. Игрок
      // получил своё - сообщаем об этом и не отбираем: повторный запрос
      // всё равно упрётся в already_claimed, так что доплатить счётчик
      // можно будет только вручную. Это лучше, чем отнимать награду за
      // сбой записи счётчика.
      // Диагностика без домыслов. Сообщение выбросившегося может быть
      // пустым - выбросить можно что угодно, и строка «счётчик не
      // записан:» с пустотой после не говорит ничего. Поэтому пишем
      // ещё и имя конструктора: Error с пустым message и голый объект
      // выглядят в логе одинаково.
      const причина = err instanceof Error
        ? `${err.name}: ${err.message}`
        : `не Error, а ${Object.prototype.toString.call(err)} ${JSON.stringify(err)}`;
      logger.error(`[Poetry] счётчик стихов не записан (${причина})`);
      res.json({
        success: true,
        reward: забрано.reward,
        gold: Number(оплата?.gold ?? 0),
        experience: Number(оплата?.experience ?? 0),
        achievements: [],
        counterSaved: false,
      });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
