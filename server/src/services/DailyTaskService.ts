// ============================================================
// Daily Task Service — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';

export interface DailyTaskDef {
  id: string; title: string; title_ru: string;
  description: string; description_ru: string;
  task_type: string; target: string; required_count: number;
  reward_gold: number; reward_experience: number;
  reward_item_id?: string; reward_item_qty: number;
  min_level: number; region?: string; reset_hours: number;
}

export const DAILY_TASKS: DailyTaskDef[] = [
  { id: 'daily_kill_20', title: 'Monster Slaughter', title_ru: 'Бойня Монстров',
    description: 'Kill 20 monsters', description_ru: 'Убить 20 монстров',
    task_type: 'kill', target: 'any', required_count: 20,
    reward_gold: 200, reward_experience: 500, reward_item_id: 'pot_health_small', reward_item_qty: 5,
    min_level: 1, reset_hours: 24 },
  { id: 'daily_kill_elite', title: 'Elite Hunter', title_ru: 'Охотник на Элиту',
    description: 'Kill 5 elite monsters', description_ru: 'Убить 5 элитных монстров',
    task_type: 'kill_elite', target: 'elite', required_count: 5,
    reward_gold: 500, reward_experience: 1000, reward_item_id: 'pot_health_medium', reward_item_qty: 3,
    min_level: 10, reset_hours: 24 },
  // ТУТ БЫЛА ЗАДАЧА «Сбор Трав»: собрать 15 лепестков роз. Сбора в игре
  // НЕТ — mat_rose_petals встречается только как цель квеста, добыть его
  // нечем. Задача была невыполнима в принципе. Заменил на рыбалку: ловля
  // работает (FishingSystem) и подходит новичку.
  { id: 'daily_fishing', title: 'Fisher of the Day', title_ru: 'Рыбак Дня',
    description: 'Catch 5 fish', description_ru: 'Поймать 5 рыб',
    task_type: 'fish', target: 'any', required_count: 5,
    reward_gold: 150, reward_experience: 300, reward_item_id: 'food_kebab', reward_item_qty: 2,
    min_level: 1, reset_hours: 24 },
  { id: 'daily_dungeon', title: 'Dungeon Rush', title_ru: 'Рейд в Подземелье',
    description: 'Complete 2 dungeons', description_ru: 'Пройти 2 подземелья',
    task_type: 'dungeon', target: 'any', required_count: 2,
    reward_gold: 400, reward_experience: 800, reward_item_id: 'mat_iron_ore', reward_item_qty: 10,
    min_level: 5, reset_hours: 24 },
  { id: 'daily_trade', title: 'Merchant\'s Day', title_ru: 'Торговый День',
    description: 'Complete 3 trade contracts', description_ru: 'Выполнить 3 торговых контракта',
    task_type: 'trade', target: 'any', required_count: 3,
    reward_gold: 300, reward_experience: 400, reward_item_id: 'mat_silk_thread', reward_item_qty: 5,
    min_level: 5, reset_hours: 24 },
  { id: 'daily_craft', title: 'Master\'s Workshop', title_ru: 'Мастерская Мастера',
    description: 'Craft 5 items', description_ru: 'Скрафтить 5 предметов',
    task_type: 'craft', target: 'any', required_count: 5,
    reward_gold: 250, reward_experience: 400, reward_item_id: 'food_kebab', reward_item_qty: 3,
    min_level: 5, reset_hours: 24 },
  { id: 'daily_pvp', title: 'Arena Fighter', title_ru: 'Боец Арены',
    description: 'Win 3 PvP matches', description_ru: 'Выиграть 3 PvP-боя',
    task_type: 'pvp_win', target: 'any', required_count: 3,
    reward_gold: 500, reward_experience: 1000, reward_item_id: 'arm_iron_mail', reward_item_qty: 1,
    min_level: 10, reset_hours: 24 },
  // ЕЖЕНЕДЕЛЬНЫЕ
  { id: 'weekly_boss', title: 'Weekly Boss Hunt', title_ru: 'Еженедельная Охота на Босса',
    description: 'Kill 3 world bosses', description_ru: 'Убить 3 мировых боссов',
    task_type: 'kill_boss', target: 'world_boss', required_count: 3,
    reward_gold: 5000, reward_experience: 10000, reward_item_id: 'mat_dragon_scale', reward_item_qty: 5,
    min_level: 30, reset_hours: 168 },
  { id: 'weekly_quests', title: 'Quest Marathon', title_ru: 'Марафон Квестов',
    description: 'Complete 25 quests', description_ru: 'Выполнить 25 квестов',
    task_type: 'quest_complete', target: 'any', required_count: 25,
    reward_gold: 3000, reward_experience: 8000, reward_item_id: 'acc_ring_jade', reward_item_qty: 1,
    min_level: 10, reset_hours: 168 },
];

export class DailyTaskService {
  private db = DatabaseService.getInstance();

  async getAvailable(charId: string, playerLevel: number): Promise<(DailyTaskDef & { current: number; completed: boolean })[]> {
    const now = new Date();
    const tasks: (DailyTaskDef & { current: number; completed: boolean })[] = [];

    for (const task of DAILY_TASKS) {
      if (task.min_level > playerLevel) continue;

      const row = await this.db.queryOne<{
        current_count: number; completed: boolean; last_reset: string;
      }>(
        'SELECT current_count, completed, last_reset FROM character_daily_progress WHERE character_id = $1 AND task_id = $2',
        [charId, task.id]
      );

      // Проверяем, нужно ли сбросить
      if (row) {
        const lastReset = new Date(row.last_reset);
        const hoursSinceReset = (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60);
        if (hoursSinceReset >= task.reset_hours) {
          await this.db.query(
            `UPDATE character_daily_progress SET current_count = 0, completed = FALSE, last_reset = NOW()
             WHERE character_id = $1 AND task_id = $2`,
            [charId, task.id]
          );
          tasks.push({ ...task, current: 0, completed: false });
        } else {
          tasks.push({ ...task, current: row.current_count, completed: row.completed });
        }
      } else {
        tasks.push({ ...task, current: 0, completed: false });
      }
    }

    return tasks;
  }

  async updateProgress(charId: string, taskType: string, target: string, amount = 1): Promise<{ taskCompleted: boolean; taskId?: string; gold?: number; experience?: number; item?: string }> {
    const matchingTasks = DAILY_TASKS.filter(t => t.task_type === taskType && (t.target === 'any' || t.target === target));

    for (const task of matchingTasks) {
      const row = await this.db.queryOne<{ current_count: number; completed: boolean }>(
        'SELECT current_count, completed FROM character_daily_progress WHERE character_id = $1 AND task_id = $2',
        [charId, task.id]
      );

      if (!row || row.completed) continue;

      const newCount = (row?.current_count ?? 0) + amount;

      if (row) {
        await this.db.query(
          'UPDATE character_daily_progress SET current_count = $1 WHERE character_id = $2 AND task_id = $3',
          [newCount, charId, task.id]
        );
      } else {
        await this.db.query(
          'INSERT INTO character_daily_progress (character_id, task_id, current_count) VALUES ($1, $2, $3)',
          [charId, task.id, newCount]
        );
      }

      if (newCount >= task.required_count) {
        await this.db.query(
          'UPDATE character_daily_progress SET completed = TRUE, completed_at = NOW() WHERE character_id = $1 AND task_id = $2',
          [charId, task.id]
        );
        // Выдаём награды
        if (task.reward_gold > 0) {
          await this.db.query('UPDATE characters SET gold = gold + $1 WHERE id = $2', [task.reward_gold, charId]);
        }
        if (task.reward_experience > 0) {
          await this.db.query('UPDATE characters SET experience = experience + $1 WHERE id = $2', [task.reward_experience, charId]);
        }
        if (task.reward_item_id) {
          await this.db.query(
            `INSERT INTO character_inventory (character_id, item_id, quantity) VALUES ($1, $2, $3)
             ON CONFLICT (character_id, item_id) DO UPDATE SET quantity = character_inventory.quantity + $3`,
            [charId, task.reward_item_id, task.reward_item_qty]
          );
        }
        logger.info(`[DailyTask] ${charId} completed: ${task.id}`);
        return { taskCompleted: true, taskId: task.id, gold: task.reward_gold, experience: task.reward_experience, item: task.reward_item_id };
      }
    }

    return { taskCompleted: false };
  }

  async getCompletedCount(charId: string): Promise<number> {
    const row = await this.db.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM character_daily_progress WHERE character_id = $1 AND completed = TRUE',
      [charId]
    );
    return Number(row?.count ?? 0);
  }
}
