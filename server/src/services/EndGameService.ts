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

  /** Завершить этаж */
  async completeFloor(charId: string, floor: number, timeSeconds: number): Promise<{ reward: { gold: number; experience: number; items: string[] }; newMax: boolean }> {
    const floorData = this.getFloor(floor);
    const progress = await this.getProgress(charId);

    // Выдать награды
    if (floorData.reward.gold > 0) {
      await this.db.query('UPDATE characters SET gold = gold + $1 WHERE id = $2', [floorData.reward.gold, charId]);
    }
    if (floorData.reward.experience > 0) {
      await this.db.query('UPDATE characters SET experience = experience + $1 WHERE id = $2', [floorData.reward.experience, charId]);
    }
    for (const itemId of floorData.reward.items) {
      await this.db.query(
        `INSERT INTO character_inventory (character_id, item_id, quantity) VALUES ($1, $2, 1)
         ON CONFLICT (character_id, item_id) DO UPDATE SET quantity = character_inventory.quantity + 1`,
        [charId, itemId]
      );
    }

    const newMax = floor > progress.max_floor;
    const bestTime = (progress.best_time_seconds === 0 || timeSeconds < progress.best_time_seconds) && newMax
      ? timeSeconds : progress.best_time_seconds;

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

    logger.info(`[Tower] ${charId} cleared floor ${floor} in ${timeSeconds}s`);
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
