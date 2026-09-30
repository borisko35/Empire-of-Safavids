// Заложенная ставка в шахматах.
//
// ЗАЧЕМ ОТДЕЛЬНО ОТ ДВИЖКА. ChessOfTheShah ничего не знает про базу и
// ничего не знает про золото: это доска и правила. Ставка - это деньги,
// и если бы она жила в движке, то же самое повторилось бы: правила
// оказались бы неотделимы от кошелька, и любая правка правил тянула бы за
// собой деньги.
//
// ЗАЧЕМ В БАЗЕ, А НЕ В ПАМЯТИ. Партия жила в Map процесса. Значит
// перезапуск сервера стирал её, а вместе с ней и смысл заложенного:
// игрок вернулся бы к 404 и молча потерял бы деньги. Теперь партия и
// заложенное лежат рядом, и перезапуск продолжает то, что начато.
//
// ГЛАВНОЕ ПРАВИЛО. Выплата идёт ТОЛЬКО из строки со статусом playing,
// и перевод денег происходит после того, как строка переведена в
// finished и это удалось. Порядок именно такой: сначала занимаем строку,
// потом платим. Обратный порядок опасен - если платёж прошёл, а строка
// не обновилась, повторный запрос заплатил бы дважды. Здесь повторный
// запрос не найдёт строку в playing и не заплатит ничего.
import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';
import type { ChessGameState } from '../systems/ChessOfTheShah';

export type ChessOutcome = 'white' | 'black' | 'draw';

/** Ставки, которые в состоянии партии превращать нельзя. */
export const MIN_BET = 10;
export const MAX_BET = 5000;
export const DEFAULT_BET = 50;

/**
 * Сколько платим по итогам партии.
 *
 * Чистая функция - ради неё тест перебирает все три исхода и крайние
 * ставки. Правила простые, но именно они превращают партию в игру на
 * деньги, а опечатка в них стоила бы игроку либо золота, либо вдвое
 * больше.
 *
 * ПОЧЕМУ НЕ ПРОСТО «x2». Победа - две ставки, ничья - одна, поражение -
 * ноль. Заложенное отнимается при открытии партии, поэтому выплата
 * «две ставки» означает чистую прибыль в размере ставки, а «одна
 * ставка» - возврат того, что было заложено. Проигрыш ничего не
 * возвращает: ставка ушла мастеру.
 */
export function payoutFor(betGold: number, outcome: ChessOutcome): number {
  const ставка = Math.max(0, Math.floor(Number(betGold) || 0));
  if (outcome === 'draw') return ставка;
  if (outcome === 'white') return ставка * 2;
  return 0;
}

/** Привести запрошенную ставку к допустимой. */
export function normalizeBet(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_BET;
  return Math.min(MAX_BET, Math.max(MIN_BET, n));
}

export interface OpenResult {
  ok: boolean;
  reason?: 'no_gold';
  goldLeft?: number;
}

export interface SettleResult {
  ok: boolean;
  /** Уже закрытая партия: выплата уже была и повторно не пойдёт. */
  alreadySettled?: boolean;
  payout?: number;
  gold?: number;
}

export class ChessBetService {
  private db = DatabaseService.getInstance();

  /**
   * Заложить ставку и открыть партию.
   *
   * Списание и вставка строки - разные запросы, и это не shortcuts:
   * списание падает, если золота не хватает (`WHERE gold >= $2`), и
   * тогда строки партии не будет вовсе. Порядок выбран в пользу
   * сначала денег: строка партии без заложенного - это партия, на
   * которой можно играть, но выиграть с неё нечего.
   */
  async open(gameId: string, characterId: string, betGold: number, state: ChessGameState): Promise<OpenResult> {
    const ставка = normalizeBet(betGold);
    try {
      const списание = await this.db.queryOne<{ gold: number }>(
        'UPDATE characters SET gold = gold - $1 WHERE id = $2 AND gold >= $1 RETURNING gold',
        [ставка, characterId],
      );
      if (!списание) return { ok: false, reason: 'no_gold' };

      await this.db.query(
        `INSERT INTO chess_games (game_id, character_id, bet_gold, status, state)
         VALUES ($1, $2, $3, 'playing', $4::jsonb)`,
        [gameId, characterId, ставка, JSON.stringify(состояниеВJson(state))],
      );
      return { ok: true, goldLeft: Number(списание.gold ?? 0) };
    } catch (err) {
      // Деньги списались, а строка не легла: возвращаем. Без этого игрок
      // терял бы ставку на каждом сбое записи, и партия без причины
      // становилась дороже.
      await this.db.query('UPDATE characters SET gold = gold + $1 WHERE id = $2', [ставка, characterId])
        .catch((e: unknown) => logger.error('[Chess] откат ставки не удался:', (e as Error).message));
      logger.error('[Chess] партия не открылась:', (err as Error).message);
      return { ok: false, reason: 'no_gold' };
    }
  }

  /**
   * Закрыть партию и выплатить.
   *
   * Три шага, и порядок между ними обязателен.
   *
   * 1. Читаем ставку. Выплата не выводится из суммы наоборот: победитель
   *    получает удвоенную, а проигравший ноль, и записать «ставка» в
   *    payout_gold означало бы, что в базе лежит число, не равное
   *    выданному. Разошлись бы учёт и кошелёк, и разбираться потом
   *    пришлось бы вслепую.
   *
   * 2. Занимаем строку: UPDATE со статусом playing. Именно он не даёт
   *    заплатить дважды - повторный запрос не найдёт строку в playing и
   *    не дойдёт до начисления. Обратный порядок опасен: если бы начисление
   *    шло первым, а занимание строки падало, игрок получил бы деньги за
   *    партию, которая в учёте осталась открытой.
   *
   * 3. Платим. Ошибка на этом шаге оставляет партию закрытой без выплаты
   *    - это заметно и разбираемо, в отличие от выплаты дважды.
   */
  async settle(gameId: string, characterId: string, outcome: ChessOutcome): Promise<SettleResult> {
    const ставка = await this.db.queryOne<{ bet_gold: number }>(
      'SELECT bet_gold FROM chess_games WHERE game_id = $1 AND character_id = $2 AND status = $3',
      [gameId, characterId, 'playing'],
    );
    if (!ставка) return { ok: false, alreadySettled: true };

    const выплата = payoutFor(Number(ставка.bet_gold), outcome);
    const заняли = await this.db.queryOne<{ game_id: string }>(
      `UPDATE chess_games
          SET status = 'finished', payout_gold = $3, finished_at = NOW()
        WHERE game_id = $1 AND character_id = $2 AND status = 'playing'
      RETURNING game_id`,
      [gameId, characterId, выплата],
    );
    if (!заняли) return { ok: false, alreadySettled: true };

    if (выплата === 0) return { ok: true, payout: 0 };
    try {
      const начисление = await this.db.queryOne<{ gold: number }>(
        'UPDATE characters SET gold = gold + $1 WHERE id = $2 RETURNING gold',
        [выплата, characterId],
      );
      return { ok: true, payout: выплата, gold: Number(начисление?.gold ?? 0) };
    } catch (err) {
      logger.error('[Chess] выплата не прошла:', (err as Error).message);
      return { ok: false, payout: выплата };
    }
  }

  /**
   * Сдаться. Заложенное не возвращается - в этом и смысл ставки.
   *
   * Партия помечается отказом, и повторный запрос на выплату по ней
   * ничего не даст: статус уже не playing.
   */
  async resign(gameId: string, characterId: string): Promise<{ ok: boolean; alreadyClosed: boolean }> {
    // RETURNING вместо отдельного SELECT. Предыдущая версия спрашивала
    // «есть ли партия в статусе resigned» - и получала «да» даже при
    // повторной сдаче, потому что партия действительно была отказана, но
    // не этим вызовом. Ответ врал: игрок видел «закрыто», как будто его
    // запрос что-то сделал.
    //
    // Денег тут не входит, поэтому ложный ответ не стоил золота. Но он
    // стоил бы в следующей правке, где по нему решают, показывать ли
    // сообщение.
    const закрыли = await this.db.queryOne<{ game_id: string }>(
      `UPDATE chess_games SET status = 'resigned', finished_at = NOW()
        WHERE game_id = $1 AND character_id = $2 AND status = 'playing'
      RETURNING game_id`,
      [gameId, characterId],
    );
    return { ok: !!закрыли, alreadyClosed: !закрыли };
  }

  /**
   * Незакрытая партия игрока, чтобы продолжить её после перезапуска.
   *
   * Возвращается последняя: игрок не может вести две партии на одни
   * деньги, и новая сломала бы расчёт первой.
   */
  async findPlaying(characterId: string): Promise<{ gameId: string; betGold: number; state: ChessGameState | null } | null> {
    const r = await this.db.queryOne<{ game_id: string; bet_gold: number; state: unknown }>(
      `SELECT game_id, bet_gold, state FROM chess_games
        WHERE character_id = $1 AND status = 'playing'
        ORDER BY created_at DESC LIMIT 1`,
      [characterId],
    );
    if (!r) return null;
    return {
      gameId: r.game_id,
      betGold: Number(r.bet_gold ?? 0),
      state: (r.state as ChessGameState | null) ?? null,
    };
  }
  // Счётчика побед здесь нет намеренно: достижение «Шахматный Гений»
  // требует счётчика в общем списке, а тот живёт в таблице leaderboard.
  // Считать победы отдельным запросом и раскладывать по двум местам
  // значило бы завести третье место учёта. Пока такого счётчика нет,
  // достижение честно показывается как несчитанное - см. getProgress.
}

/** Состояние в форму, пригодную для jsonb: без ключей undefined. */
function состояниеВJson(state: ChessGameState): Record<string, unknown> {
  return JSON.parse(JSON.stringify({
    board: state.board,
    turn: state.turn,
    whiteKing: state.whiteKing,
    blackKing: state.blackKing,
    moveHistory: state.moveHistory,
    status: state.status,
    betGold: state.betGold,
    whitePlayerId: state.whitePlayerId,
  })) as Record<string, unknown>;
}
