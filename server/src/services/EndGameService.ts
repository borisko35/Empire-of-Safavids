// ============================================================
// End-game Service — Endless Tower, Inferno Dungeons
// ============================================================

import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';

export interface TowerRun {
  character_id: string; max_floor: number; current_floor: number;
  best_time_seconds: number; runs_total: number;
}

export interface TowerFloor {
  floor: number; monsterCount: number; monsterLevel: number;
  monsterType: string; bossFloor: boolean; reward: { gold: number; experience: number; items: string[] };
}

/**
 * Меньше десяти секунд этаж не занимает. Время приходит от клиента, и без
 * нижней границы «лучшее время» в рейтинге башни было бы равно одной секунде
 * у всех, кто захотел бы в него попасть.
 */
const MIN_FLOOR_SECONDS = 10;

export class EndGameService {
  private db = DatabaseService.getInstance();

  /** Сгенерировать этаж башни */
  getFloor(floor: number): TowerFloor {
    const baseLevel = 50 + floor * 2;
    const monsterCount = 5 + Math.floor(floor * 1.5);
    const bossFloor = floor % 5 === 0;
    const monsters = ['mob_road_bandit', 'mob_assassin_acolyte', 'mob_sand_elemental', 'mob_undead_guardian'];
    const monsterType = bossFloor ? 'world_boss_simurgh' : monsters[floor % monsters.length];
    const goldReward = floor * 100 + (bossFloor ? 2000 : 0);
    const expReward = floor * 200 + (bossFloor ? 5000 : 0);
    const items: string[] = [];
    if (bossFloor) {
      items.push('mat_dragon_scale');
      if (floor % 10 === 0) items.push('acc_amulet_safavid');
    }
    return { floor, monsterCount, monsterLevel: baseLevel, monsterType, bossFloor, reward: { gold: goldReward, experience: expReward, items } };
  }

  /** Получить прогресс башни */
  async getProgress(charId: string): Promise<TowerRun> {
    const row = await this.db.queryOne<TowerRun>(
      'SELECT * FROM endless_tower WHERE character_id = $1', [charId]
    );
    return row ?? { character_id: charId, max_floor: 0, current_floor: 1, best_time_seconds: 0, runs_total: 0 };
  }

  /**
   * Завершить этаж.
   *
   * Проверяем, что этаж действительно тот, который игрок бежал. Без проверки
   * можно было отправить floor: 999 и получить награду за любой этаж разом —
   * единственный способ набить бесконечное золото через башню. Правило
   * простое: пройти можно ровно текущий этаж, а вперёд — только на один.
   */
  async completeFloor(charId: string, floor: number, timeSeconds: number): Promise<{ reward: { gold: number; experience: number; items: string[] }; newMax: boolean }> {
    const progress = await this.getProgress(charId);

    // current_floor в свежей записи равен 1, пока забег не начат. Первый
    // этаж можно закрыть без startRun — он и есть текущий
    const current = progress.runs_total > 0 ? progress.current_floor : 1;
    if (floor > current + 1) {
      throw new Error(`Floor ${floor} is locked: current is ${current}, you may clear at most ${current + 1}`);
    }
    if (floor < current) {
      // Повторное прохождение уже взятого этажа: награду не выдаём второй раз
      throw new Error(`Floor ${floor} was already cleared (current is ${current})`);
    }

    const floorData = this.getFloor(floor);

    // Время приходит из тела запроса, проверить его нечем. Но и пропустить
    // его нельзя: иначе «лучшее время» в рейтинге башни равнялось бы одной
    // секунде у каждого, кто захотел бы туда попасть. Ниже физического
    // минимума не принимаем, иначе в рейтинге будет ноль секунд.
    const time = Math.max(MIN_FLOOR_SECONDS, Math.round(timeSeconds));


    // Выдать награды
    if (floorData.reward.gold > 0) {
      await this.db.query('UPDATE characters SET gold = gold + $1 WHERE id = $2', [floorData.reward.gold, charId]);
    }
    if (floorData.reward.experience > 0) {
      await this.db.query('UPDATE characters SET experience = experience + $1 WHERE id = $2', [floorData.reward.experience, charId]);
    }
    for (const itemId of floorData.reward.items) {
      // Та же ошибка, что была в DailyTaskService: таблицы
      // character_inventory не существует, есть character_items, а её
      // уникальный индекс трёхколоночный — (character_id, item_id,
      // enhancement). Здесь ошибка стояла В ЦИКЛЕ: первый предмет ронял
      // весь метод, и золото с опытом этажа уже начислены оставались без
      // записи о прохождении — игрок проходил этаж и не получал награду.
      await this.db.query(
        `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
         VALUES ($1, $2, 1, 0)
         ON CONFLICT (character_id, item_id, enhancement)
         DO UPDATE SET quantity = character_items.quantity + 1`,
        [charId, itemId]
      );
    }

    const newMax = floor > progress.max_floor;
    // Рекорд ставится на `time`, а не на присланное время: иначе наша же
    // проверка минимума обнуляла бы рекорд у честного игрока, который пробежал
    // этаж быстрее десяти секунд (такое возможно на первом этаже)
    const bestTime = (progress.best_time_seconds === 0 || time < progress.best_time_seconds) && newMax
      ? time : progress.best_time_seconds;

    if (progress.runs_total > 0) {
      await this.db.query(
        `UPDATE endless_tower SET max_floor = GREATEST(max_floor, $1), current_floor = $2,
         best_time_seconds = CASE WHEN $3 > 0 AND ($3 < best_time_seconds OR best_time_seconds = 0) THEN $3 ELSE best_time_seconds END,
         runs_total = runs_total + 1, updated_at = NOW()
         WHERE character_id = $4`,
        [floor, floor + 1, bestTime, charId]
      );
    } else {
      await this.db.query(
        `INSERT INTO endless_tower (character_id, max_floor, current_floor, best_time_seconds, runs_total)
         VALUES ($1, $2, $3, $4, 1)`,
        [charId, floor, floor + 1, bestTime]
      );
    }

    logger.info(`[Tower] ${charId} cleared floor ${floor} in ${time}s`);
    return { reward: floorData.reward, newMax };
  }

  /** Начать забег */
  async startRun(charId: string): Promise<TowerRun> {
    const progress = await this.getProgress(charId);
    if (progress.runs_total > 0) {
      await this.db.query(
        'UPDATE endless_tower SET current_floor = 1, updated_at = NOW() WHERE character_id = $1',
        [charId]
      );
    }
    return { ...progress, current_floor: 1 };
  }

  /** Рейтинг башни */
  async getLeaderboard(limit = 20): Promise<{ character_id: string; character_name: string; max_floor: number; best_time_seconds: number }[]> {
    return this.db.query(
      `SELECT t.character_id, c.name as character_name, t.max_floor, t.best_time_seconds
       FROM endless_tower t JOIN characters c ON c.id = t.character_id
       ORDER BY t.max_floor DESC, t.best_time_seconds ASC LIMIT $1`,
      [limit]
    );
  }
}
