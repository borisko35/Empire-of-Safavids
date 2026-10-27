// ============================================================
// Слой наблюдений за привычками игрока — Empire of Safavids
// ============================================================
// Фундамент личных квестов (третий пункт 9-C в road-карте): «уникальные
// личные квесты требуют слоя наблюдений — что игрок делает чаще, и на этом
// основании — предложение». До сих пор мир не помнил ничего долговременного
// о манере игры: задачи дня стирались через сутки, репутация помнила только
// фракционную сторону тех же событий.
//
// ПОЧЕМУ КРЮЧОК В ReputationGrants. Шесть канонических дел (поле, данж,
// квест, PvP, аукцион, торговля) уже проходят через одну точку —
// grantReputation: там единый список REP и единый путь вызова. Наблюдение
// ставится рядом с начислением репутации, и «что случилось» остаётся с
// одним источником истины. Свои крючки в обработчиках значили бы вторую
// копию списка — а списки этого проекта разъезжались не раз.
//
// ПОЧЕМУ СЧЁТЧИК, А НЕ ЖУРНАЛ. Наблюдение отвечает на вопрос «что чаще»,
// а не «когда»: журнал из тысяч строк на персонажа ради суммы, которая и
// есть счётчик, — работа без пользы. Хранение — таблица (миграция 082):
// память мира не умирает на рестарте.
import { DatabaseService } from '../services/DatabaseService';
import type { RepKind } from './ReputationGrants';

export class PlayerObservations {
  private db = DatabaseService.getInstance();

  /** Заметить дело: счётчик растёт на единицу. Ошибка — не в бой. */
  async observe(characterId: string, kind: RepKind): Promise<void> {
    await this.db.query(
      `INSERT INTO player_observations (character_id, kind, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (character_id, kind)
       DO UPDATE SET count = player_observations.count + 1, updated_at = NOW()`,
      [characterId, kind],
    );
  }

  /**
   * Профиль привычек: все шесть счётчиков и верхний — «чаще всего».
   * Пустой профиль (top: null) у новичка — наблюдать пока нечего.
   */
  async profile(characterId: string): Promise<{ top: string | null; counts: Record<string, number> }> {
    const rows = await this.db.query<{ kind: string; count: number }>(
      'SELECT kind, count FROM player_observations WHERE character_id = $1 ORDER BY count DESC',
      [characterId],
    );
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.kind] = r.count;
    return { top: rows[0]?.kind ?? null, counts };
  }
}

/** Один экземпляр на процесс: крючок в ReputationGrants и маршрут читают одно. */
export const наблюдения = new PlayerObservations();
