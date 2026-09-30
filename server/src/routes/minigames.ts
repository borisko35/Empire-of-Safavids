// ============================================================
// Chess of the Shah — API routes — Empire of Safavids
// ============================================================
//
// ЗАЧЕМ МАРШРУТЫ ПЕРЕПИСАНЫ. Раньше здесь бралась ставка из тела запроса,
// подрезалась до 10..5000 и записывалась в состояние партии. Дальше
// `goldWon` считался в makeMove, показывался в ответе - и всё. Ни одно
// движение в characters.gold не происходило. Игрок ставил 500, выигрывал,
// видел «+1000» и получал те же 500, что и до партии.
//
// ЧТО СТАЛО. Ставка закладывается при открытии партии, и если золота не
// хватает - партия не открывается вовсе, с честным кодом. Выплата идёт
// при закрытии, и ровно один раз: строка партии переводится в finished
// до начисления, поэтому повторный запрос ничего не платит.
//
// ПОЧЕМУ ПРОДОЛЖЕНИЕ ПОСЛЕ ПЕРЕЗАПУСКА. Партия раньше жила в памяти
// процесса. Перезапуск стирал её, и игрок возвращался к 404, молча теряя
// заложенное. Теперь партия и ставка лежат в базе рядом, и незакрытая
// партия находится по персонажу.
import { Router } from 'express';
import { getChessGame } from '../systems/ChessOfTheShah';
import { authMiddleware } from '../middleware/auth';
import { ChessBetService, normalizeBet, MIN_BET, MAX_BET, DEFAULT_BET } from '../services/ChessBetService';
import { logger } from '../utils/logger';
import { DatabaseService } from '../services/DatabaseService';

const router = Router();
const chess = getChessGame();
const bets = new ChessBetService();

const db = DatabaseService.getInstance();

/**
 * Персонаж по id, и только если он принадлежит вошедшему.
 *
 * ЗАЧЕМ ЭТО ПОЯВИЛОСЬ. Ставка списывается с characters.gold, а characters
 * заводится на ПЕРСОНАЖА, а не на аккаунт: у одного аккаунта несколько
 * персонажей. Маршрут брал id из сессии и считал его за персонажа. Списание
 * не находило строку, и сервер отвечал «не хватает золота» - то есть
 * врал о причине при совершенно достаточном кошельке.
 *
 * Проверка принадлежности не формальность: без неё один вошедший снял бы
 * ставку с чужого персонажа, зная его id.
 */
async function свойПерсонаж(req: any, res: any): Promise<string | null> {
  const characterId = String(req.body?.characterId ?? req.query.characterId ?? '');
  if (!characterId) { res.status(400).json({ error: 'characterId is required' }); return null; }
  const строка = await db.queryOne<{ id: string }>(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2', [characterId, req.userId],
  );
  if (!строка) { res.status(404).json({ error: 'character_not_found' }); return null; }
  return строка.id;
}

/**
 * Восстановить партию в память движка.
 *
 * Движок держит доску в Map, а база - её копию. После перезапуска Map
 * пуст, и `getGame` вернул бы 404 на живой партии с заложенным.
 */
function восстановить(state: Parameters<typeof chess.restore>[0]): void {
  chess.restore(state);
}

// Начать партию
router.post('/start', authMiddleware, async (req: any, res) => {
  try {
    const персонаж = await свойПерсонаж(req, res);
    if (!персонаж) return;
    const betGold = normalizeBet(req.body?.betGold);
    const game = chess.startGame(персонаж, betGold);

    const открытие = await bets.open(game.gameId, персонаж, betGold, game);
    if (!открытие.ok) {
      // Партия в памяти уже создана, но деньги не заложены. Убираем её,
      // иначе по gameId можно было бы играть без ставки.
      chess.deleteGame(game.gameId);
      res.status(400).json({
        error: req.body?.betGold > MAX_BET ? `bet_too_big` : 'not_enough_gold',
        minBet: MIN_BET,
        maxBet: MAX_BET,
        defaultBet: DEFAULT_BET,
      });
      return;
    }

    res.json({
      gameId: game.gameId,
      board: game.board,
      turn: game.turn,
      status: game.status,
      betGold: game.betGold,
      goldLeft: открытие.goldLeft,
    });
  } catch (err) {
    logger.error('[Chess] start failed:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Закрыть партию один раз: занять строку, потом заплатить. */
async function закрыть(gameId: string, characterId: string, outcome: 'white' | 'black' | 'draw'): Promise<{ payout: number; gold?: number; alreadySettled?: boolean }> {
  const итог = await bets.settle(gameId, characterId, outcome);
  return { payout: итог.payout ?? 0, gold: итог.gold, alreadySettled: итог.alreadySettled };
}

// Сделать ход
router.post('/move', authMiddleware, async (req: any, res) => {
  try {
    const персонаж = await свойПерсонаж(req, res);
    if (!персонаж) return;
    const { gameId, from, to } = req.body ?? {};
    const result = chess.makeMove(gameId, персонаж, { from, to });
    if (!result.success) {
      res.status(400).json({ error: 'invalid_move' });
      return;
    }
    const resp: any = {
      board: result.state.board,
      turn: result.state.turn,
      status: result.state.status,
      betGold: result.state.betGold,
    };

    if (result.result) {
      // Партия кончилась ходом игрока. Выплата - по-настоящему.
      const исход = result.result.winner;
      const оплата = await закрыть(gameId, персонаж, исход === 'draw' ? 'draw' : исход);
      resp.result = { ...result.result, goldWon: оплата.payout, gold: оплата.gold, alreadySettled: оплата.alreadySettled };
      chess.deleteGame(gameId);
      res.json(resp);
      return;
    }

    // Ход мастера
    const aiState = chess.aiMove(gameId);
    if (aiState) {
      resp.board = aiState.board;
      resp.turn = aiState.turn;
      resp.status = aiState.status;
      if (aiState.status === 'checkmate' || aiState.status === 'stalemate') {
        const исход = aiState.status === 'checkmate' ? 'black' : 'draw';
        const оплата = await закрыть(gameId, персонаж, исход);
        resp.result = {
          winner: исход,
          goldWon: оплата.payout,
          gold: оплата.gold,
          alreadySettled: оплата.alreadySettled,
          messageRu: исход === 'black' ? 'Мат! Шахматный Мастер победил!' : 'Пат — ничья!',
        };
        chess.deleteGame(gameId);
      }
    }
    res.json(resp);
  } catch (err) {
    logger.error('[Chess] move failed:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Текущая партия. Ищем и в памяти, и в базе: после перезапуска в памяти
// пусто, а партия с заложенным жива.
router.get('/state/:gameId', authMiddleware, async (req, res) => {
  const персонаж = await свойПерсонаж(req, res);
  if (!персонаж) return;
  const game = chess.getGame(req.params.gameId);
  if (game) {
    res.json({
      board: game.board,
      turn: game.turn,
      status: game.status,
      moveCount: game.moveHistory.length,
      betGold: game.betGold,
    });
    return;
  }
  const изБазы = await bets.findPlaying(персонаж);
  if (!изБазы || изБазы.gameId !== req.params.gameId || !изБазы.state) {
    res.status(404).json({ error: 'game_not_found' });
    return;
  }
  восстановить(изБазы.state);
  res.json({
    board: изБазы.state.board,
    turn: изБазы.state.turn,
    status: изБазы.state.status,
    moveCount: изБазы.state.moveHistory?.length ?? 0,
    betGold: изБазы.betGold,
    restored: true,
  });
});

// Незакрытая партия игрока: клиент зовёт это при входе, чтобы вернуть
// игрока к доске, а не выбрасывать из партии с заложенным.
router.get('/current', authMiddleware, async (req, res) => {
  const персонаж = await свойПерсонаж(req, res);
  if (!персонаж) return;
  const изБазы = await bets.findPlaying(персонаж);
  if (!изБазы) { res.json({ game: null }); return; }
  if (изБазы.state) восстановить(изБазы.state);
  res.json({
    game: {
      gameId: изБазы.gameId,
      betGold: изБазы.betGold,
      board: изБазы.state?.board ?? null,
      turn: изБазы.state?.turn ?? 'white',
      status: изБазы.state?.status ?? 'playing',
      moveCount: изБазы.state?.moveHistory?.length ?? 0,
    },
  });
});

// Сдаться / выйти. Заложенное не возвращается - в этом и смысл ставки.
router.post('/resign', authMiddleware, async (req, res) => {
  const персонаж = await свойПерсонаж(req, res);
  if (!персонаж) return;
  const gameId = String(req.body?.gameId ?? '');
  if (!gameId) { res.status(400).json({ error: 'gameId is required' }); return; }
  const итог = await bets.resign(gameId, персонаж);
  chess.deleteGame(gameId);
  res.json({ success: true, closed: итог.ok, alreadyClosed: итог.alreadyClosed, betLost: итог.ok });
});

export default router;
