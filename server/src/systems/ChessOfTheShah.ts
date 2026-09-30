// ============================================================
// Chess of the Shah — Мини-игра: шахматы — Empire of Safavids
// ============================================================
// Мини-игра в таверне. Игрок vs NPC "Шахматный Мастер".
// Упрощённые шахматы 6×6 (быстрая партия ~5-10 минут).
// Ставки золотом: победа = x2, ничья = x1.

import { logger } from '../utils/logger';

export type ChessPiece = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | 'k' | 'q' | 'r' | 'b' | 'n' | 'p';
export type ChessColor = 'white' | 'black';

export interface ChessPosition { row: number; col: number; }

export interface ChessMove {
  from: ChessPosition;
  to: ChessPosition;
  promotion?: string;
}

export interface ChessGameState {
  gameId: string;
  board: (string | null)[][];  // 6×6
  turn: ChessColor;
  whiteKing: ChessPosition;
  blackKing: ChessPosition;
  moveHistory: ChessMove[];
  status: 'playing' | 'check' | 'checkmate' | 'stalemate' | 'draw';
  betGold: number;
  whitePlayerId: string;
}

export interface ChessGameResult {
  winner: ChessColor | 'draw';
  goldWon: number;
  message: string;
  messageRu: string;
}

// Начальная расстановка 6×6 (без ферзей для ускорения)
// Белые — uppercase (K, Q, R, B, N, P), чёрные — lowercase (k, q, r, b, n, p)
const INITIAL_BOARD: (string | null)[][] = [
  ['r', 'n', 'b', 'b', 'n', 'r'],  // чёрные (bottom-up view: row 0 = black back rank)
  ['p', 'p', 'p', 'p', 'p', 'p'],  // чёрные пешки
  [null, null, null, null, null, null],
  [null, null, null, null, null, null],
  ['P', 'P', 'P', 'P', 'P', 'P'],  // белые пешки
  ['R', 'N', 'B', 'B', 'N', 'R'],  // белые
];

const PIECE_VALUES: Record<string, number> = {
  'P': 1, 'p': 1, 'N': 3, 'n': 3, 'B': 3, 'b': 3,
  'R': 5, 'r': 5, 'Q': 9, 'q': 9, 'K': 0, 'k': 0,
};

export class ChessOfTheShah {
  private games = new Map<string, ChessGameState>();

  /** Начать новую партию */
  startGame(playerId: string, betGold: number): ChessGameState {
    const board = INITIAL_BOARD.map(row => [...row]);
    const gameId = `chess_${playerId}_${Date.now()}`;

    const state: ChessGameState = {
      gameId,
      board,
      turn: 'white', // Белые ходят первыми (игрок)
      whiteKing: { row: 5, col: 2 },
      blackKing: { row: 0, col: 2 },
      moveHistory: [],
      status: 'playing',
      betGold,
      whitePlayerId: playerId,
    };

    this.games.set(gameId, state);
    logger.info(`[Chess] Game ${gameId} started, bet: ${betGold} gold`);
    return state;
  }

  /** Сделать ход */
  makeMove(gameId: string, playerId: string, move: ChessMove): { success: boolean; state: ChessGameState; result?: ChessGameResult } {
    const game = this.games.get(gameId);
    if (!game) return { success: false, state: null! };
    if (game.whitePlayerId !== playerId) return { success: false, state: game };

    const { from, to } = move;
    const piece = game.board[from.row][from.col];

    // Валидация
    if (!piece) return { success: false, state: game };
    const isWhite = piece === piece.toUpperCase();
    if ((game.turn === 'white' && !isWhite) || (game.turn === 'black' && isWhite)) {
      return { success: false, state: game };
    }

    // Простая валидация движения (без проверки шаха для упрощения)
    if (!this.isValidMove(game, from, to)) {
      return { success: false, state: game };
    }

    // Выполнить ход
    game.board[to.row][to.col] = piece;
    game.board[from.row][from.col] = null;

    // Пешка → ферзь на последней линии
    if (piece === 'P' && to.row === 0) game.board[to.row][to.col] = 'Q';
    if (piece === 'p' && to.row === 5) game.board[to.row][to.col] = 'q';

    // Обновить позицию короля
    if (piece === 'K') game.whiteKing = { ...to };
    if (piece === 'k') game.blackKing = { ...to };

    game.moveHistory.push(move);

    // Проверка на мат/пат
    const opponent = game.turn === 'white' ? 'black' : 'white';
    const hasLegalMove = this.hasAnyLegalMove(game, opponent);

    if (!hasLegalMove) {
      // Проверяем, атакован ли король (мат) или нет (пат)
      const kingPos = opponent === 'white' ? game.whiteKing : game.blackKing;
      const isCheck = this.isSquareAttacked(game, kingPos, opponent);
      game.status = isCheck ? 'checkmate' : 'stalemate';
    } else {
      game.status = 'playing';
    }

    game.turn = opponent;

    // Шах-мат: игра окончена
    if (game.status === 'checkmate') {
      const result: ChessGameResult = {
        winner: game.turn === 'black' ? 'white' : 'black', // Тот, кто сделал мат
        goldWon: game.betGold * 2,
        message: game.turn === 'black' ? 'Checkmate! You win!' : 'Checkmate! Shah wins!',
        messageRu: game.turn === 'black' ? 'Мат! Вы победили!' : 'Мат! Шахматный Мастер победил!',
      };
      return { success: true, state: game, result };
    }

    if (game.status === 'stalemate') {
      const result: ChessGameResult = {
        winner: 'draw',
        goldWon: game.betGold,
        message: 'Stalemate — draw!',
        messageRu: 'Пат — ничья!',
      };
      return { success: true, state: game, result };
    }

    return { success: true, state: game };
  }

  /** AI делает ход (простая эвристика) */
  aiMove(gameId: string): ChessGameState | null {
    const game = this.games.get(gameId);
    if (!game || game.turn !== 'black') return null;

    // Собираем все возможные ходы чёрных
    const moves: ChessMove[] = [];
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const piece = game.board[r][c];
        if (!piece || piece !== piece.toLowerCase()) continue; // только чёрные
        for (let tr = 0; tr < 6; tr++) {
          for (let tc = 0; tc < 6; tc++) {
            const move = { from: { row: r, col: c }, to: { row: tr, col: tc } };
            if (this.isValidMove(game, move.from, move.to)) {
              moves.push(move);
            }
          }
        }
      }
    }

    if (moves.length === 0) return game;

    // Приоритет: взятие > продвижение > случайный ход
    moves.sort((a, b) => {
      const capturedA = game.board[a.to.row][a.to.col];
      const capturedB = game.board[b.to.row][b.to.col];
      const valA = capturedA ? PIECE_VALUES[capturedA] : 0;
      const valB = capturedB ? PIECE_VALUES[capturedB] : 0;
      return valB - valA;
    });

    // Берём лучший ход (с небольшой рандомизацией)
    const bestMoves = moves.slice(0, Math.min(3, moves.length));
    const chosen = bestMoves[Math.floor(Math.random() * bestMoves.length)];

    const result = this.makeMove(gameId, game.whitePlayerId, chosen);
    return result.state;
  }

  /** Проверка валидности хода (базовые правила) */
  private isValidMove(game: ChessGameState, from: ChessPosition, to: ChessPosition): boolean {
    if (from.row === to.row && from.col === to.col) return false;
    if (to.row < 0 || to.row >= 6 || to.col < 0 || to.col >= 6) return false;

    const piece = game.board[from.row][from.col];
    if (!piece) return false;

    const target = game.board[to.row][to.col];
    const isWhite = piece === piece.toUpperCase();

    // Нельзя бить свою фигуру
    if (target) {
      const targetIsWhite = target === target.toUpperCase();
      if (isWhite === targetIsWhite) return false;
    }

    const dr = to.row - from.row;
    const dc = to.col - from.col;
    const absR = Math.abs(dr);
    const absC = Math.abs(dc);

    const type = piece.toUpperCase();

    switch (type) {
      case 'P': { // Пешка
        const dir = isWhite ? -1 : 1;
        const startRow = isWhite ? 5 : 1;
        if (dc === 0 && !target && dr === dir) return true;
        if (dc === 0 && !target && dr === dir * 2 && from.row === startRow) return true;
        if (absC === 1 && dr === dir && target) return true;
        return false;
      }
      case 'R': return this.isStraight(game, from, to);
      case 'B': return this.isDiagonal(game, from, to);
      case 'Q': return this.isStraight(game, from, to) || this.isDiagonal(game, from, to);
      case 'N': return (absR === 2 && absC === 1) || (absR === 1 && absC === 2);
      case 'K': return absR <= 1 && absC <= 1;
      default: return false;
    }
  }

  private isStraight(game: ChessGameState, from: ChessPosition, to: ChessPosition): boolean {
    if (from.row !== to.row && from.col !== to.col) return false;
    const dr = Math.sign(to.row - from.row);
    const dc = Math.sign(to.col - from.col);
    let r = from.row + dr, c = from.col + dc;
    while (r !== to.row || c !== to.col) {
      if (game.board[r][c]) return false;
      r += dr; c += dc;
    }
    return true;
  }

  private isDiagonal(game: ChessGameState, from: ChessPosition, to: ChessPosition): boolean {
    if (Math.abs(to.row - from.row) !== Math.abs(to.col - from.col)) return false;
    const dr = Math.sign(to.row - from.row);
    const dc = Math.sign(to.col - from.col);
    let r = from.row + dr, c = from.col + dc;
    while (r !== to.row || c !== to.col) {
      if (game.board[r][c]) return false;
      r += dr; c += dc;
    }
    return true;
  }

  private isSquareAttacked(game: ChessGameState, pos: ChessPosition, defender: ChessColor): boolean {
    // Проверяем, атакует ли какая-либо фигура противника данную клетку
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const piece = game.board[r][c];
        if (!piece) continue;
        const isWhite = piece === piece.toUpperCase();
        if ((defender === 'white' && isWhite) || (defender === 'black' && !isWhite)) continue;
        if (this.isValidMove(game, { row: r, col: c }, pos)) return true;
      }
    }
    return false;
  }

  private hasAnyLegalMove(game: ChessGameState, color: ChessColor): boolean {
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const piece = game.board[r][c];
        if (!piece) continue;
        const isWhite = piece === piece.toUpperCase();
        if ((color === 'white' && !isWhite) || (color === 'black' && isWhite)) continue;
        for (let tr = 0; tr < 6; tr++) {
          for (let tc = 0; tc < 6; tc++) {
            if (this.isValidMove(game, { row: r, col: c }, { row: tr, col: tc })) return true;
          }
        }
      }
    }
    return false;
  }

  /** Получить игру */
  getGame(gameId: string): ChessGameState | undefined {
    return this.games.get(gameId);
  }

  /**
   * Вернуть партию в память движка из сохранённого состояния.
   *
   * ЗАЧЕМ. Движок держит доску в Map процесса, и после перезапуска Map
   * пуст: игрок с живой партией и заложенной ставкой получал 404 и молча
   * терял деньги. Состояние лежит в базе, и этот метод кладёт его обратно.
   *
   * Поле gameId восстанавливается из переданного, а не из state: там его
   * может не быть, а Map ключуется именно им.
   */
  restore(state: ChessGameState & { gameId?: string }): ChessGameState | null {
    if (!state?.board || !Array.isArray(state.board)) return null;
    const gameId = state.gameId ?? `chess_${state.whitePlayerId ?? 'unknown'}_${Date.now()}`;
    const restored: ChessGameState = {
      gameId,
      board: state.board,
      turn: state.turn ?? 'white',
      whiteKing: state.whiteKing ?? { row: 5, col: 2 },
      blackKing: state.blackKing ?? { row: 0, col: 2 },
      moveHistory: state.moveHistory ?? [],
      status: state.status ?? 'playing',
      betGold: Number(state.betGold ?? 0),
      whitePlayerId: state.whitePlayerId ?? '',
    };
    this.games.set(gameId, restored);
    logger.info(`[Chess] Game ${gameId} restored, bet: ${restored.betGold} gold`);
    return restored;
  }

  /** Удалить игру */
  deleteGame(gameId: string): void {
    this.games.delete(gameId);
  }
}

// Singleton
let instance: ChessOfTheShah | null = null;
export function getChessGame(): ChessOfTheShah {
  if (!instance) instance = new ChessOfTheShah();
  return instance;
}
