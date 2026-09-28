// ============================================================
// Daily Task Service — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { PremiumSystem } from '../systems/PremiumSystem';
import { logger } from '../utils/logger';

/**
 * Сколько очков сезона даёт одно игровое действие.
 *
 * Лестница идёт до 4900 очков на 50-й уровень. Считаем для игрока, который
 * заходит ежедневно, делает 20 действий и закрывает 3 задачи: при 5 очках за
 * действие и 25 за задачу выходит 175 очков в день, то есть вся лестница
 * примерно за 28 дней. Это длина нормального сезона.
 *
 * Проверено на числах: при 10 очках за действие лестница проходилась за
 * 14 дней — вдвое быстрее, и пропуск переставал быть целью.
 */
const SEASON_POINTS_PER_ACTION = 5;

/**
 * Добавка за выполнение задачи дня.
 *
 * Задача — это уже «целое» действие игрока, а не одна операция, поэтому
 * она стоит в несколько раз дороже обычного действия.
 */
const SEASON_POINTS_PER_TASK = 25;

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

/**
 * Записать каталог из кода в таблицу daily_tasks.
 *
 * UPSERT по id: повторный посев на каждом старте безопасен и не плодит
 * дублей. НО: он затирает правки, внесённые в базу вручную. Это сделано
 * намеренно — иначе через месяц никто не вспомнит, какие задачи вообще
 * должны быть, и каталог в коде перестанет быть правдой. Если понадобится
 * править награды без релиза, здесь должна появиться явная отметка
   «зафиксировано в базе», и посев её пропускает.
 */
  async seedCatalog(): Promise<number> {
    let written = 0;
    for (const task of await this.catalog()) {
      await this.db.query(
        `INSERT INTO daily_tasks
           (id, title, title_ru, description, description_ru, task_type, target,
            required_count, reward_gold, reward_experience, reward_item_id,
            reward_item_qty, min_level, region, reset_hours)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, title_ru = EXCLUDED.title_ru,
           description = EXCLUDED.description, description_ru = EXCLUDED.description_ru,
           task_type = EXCLUDED.task_type, target = EXCLUDED.target,
           required_count = EXCLUDED.required_count, reward_gold = EXCLUDED.reward_gold,
           reward_experience = EXCLUDED.reward_experience,
           reward_item_id = EXCLUDED.reward_item_id, reward_item_qty = EXCLUDED.reward_item_qty,
           min_level = EXCLUDED.min_level, region = EXCLUDED.region,
           reset_hours = EXCLUDED.reset_hours`,
        [task.id, task.title, task.title_ru, task.description, task.description_ru,
         task.task_type, task.target, task.required_count, task.reward_gold,
         task.reward_experience, task.reward_item_id ?? null, task.reward_item_qty,
         task.min_level, task.region ?? null, task.reset_hours]
      );
      written++;
    }
    return written;
  }

  /**
   * Прочитать каталог из базы, с откатом на код.
   *
   * Откат тут не перестраховка, а требование: панель задач показывает
   * «задач нет» без всякой ошибки, и игрок решит, что его обманули. Пустой
   * список из-за сбоя базы хуже, чем список из кода, — он ещё и тихий.
   */
  async loadCatalog(): Promise<DailyTaskDef[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM daily_tasks`
    ).catch((e) => {
      logger.warn('[DailyTask] каталог не прочитан, берём из кода:', e);
      return [];
    });
    if (!rows.length) return DAILY_TASKS;

    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      title_ru: String(r.title_ru),
      description: String(r.description),
      description_ru: String(r.description_ru),
      task_type: String(r.task_type),
      target: String(r.target),
      required_count: Number(r.required_count) || 1,
      reward_gold: Number(r.reward_gold) || 0,
      reward_experience: Number(r.reward_experience) || 0,
      reward_item_id: (r.reward_item_id as string | null) ?? undefined,
      reward_item_qty: Number(r.reward_item_qty) || 0,
      min_level: Number(r.min_level) || 1,
      region: (r.region as string | null) ?? undefined,
      reset_hours: Number(r.reset_hours) || 24,
    }));
  }

  /**
   * Актуальный каталог: из базы, но при сбое — из кода.
   *
   * Вызывается на каждый чих: getAvailable дёргается на каждый показ панели,
   * и updateProgress — на каждое событие боя. Поэтому результат кэшируем и
   * перечитываем раз в пять минут: править награды в базе без релиза нужно,
   * но не чаще раза в пять минут, а ходить в базу на каждый убитый монстр —
   * расточительно.
   */
  private catalogCache: DailyTaskDef[] | null = null;
  private catalogLoadedAt = 0;

  private static readonly CATALOG_TTL_MS = 5 * 60 * 1000;

  async catalog(): Promise<DailyTaskDef[]> {
    if (this.catalogCache && Date.now() - this.catalogLoadedAt < DailyTaskService.CATALOG_TTL_MS) {
      return this.catalogCache;
    }
    this.catalogCache = await this.loadCatalog();
    this.catalogLoadedAt = Date.now();
    return this.catalogCache;
  }

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
    const matchingTasks = (await this.catalog()).filter(t => t.task_type === taskType && (t.target === 'any' || t.target === target));

    // ТУТ БЫЛА ПРОБЛЕМА: очки боевого пропуска не начислялись НИГДЕ.
    // PremiumSystem.addSeasonPoints был написан целиком, но не вызывался ни
    // разу за всё время существования проекта. Итог: игрок мог купить пропуск
    // и не получить ничего — очки всегда оставались на нуле, и ни один
    // уровень не открывался. Покупка за реальные деньги без награды хуже,
    // чем отсутствие фичи: об этом узнаёшь только по факту.
    //
    // Начисляем здесь, а не в восьми местах вызова: updateProgress — общая
    // точка для убийств, квестов, данжа, крафта, торговли, PvP и рыбалки.
    // Одно место вместо восьми, и забыть его уже негде.
    //
    // Зачитываемся ДО работы с задачами и НЕ.await на результат: начисление
    // очков не должно иметь возможности сорвать выдачу награды за задачу.
    // Ошибка проглатывается с записью в журнал, а не падает наружу.
    void this.grantSeasonPoints(charId, SEASON_POINTS_PER_ACTION * Math.max(1, amount));

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
          // ТУТ БЫЛО ПРИЧИНОЙ, ПОЧЕМУ ПРЕДМЕТ НИКОГДА НЕ ВЫДАВАЛСЯ.
          // Таблицы character_inventory в базе НЕТ: файл миграции называется
          // 006_character_inventory.sql, но внутри он создаёт character_items.
          // Ошибка не бросалась наружу — вызывающий код глотал её через
          // .catch(() => {}), — но обрывала метод ПОСЛЕ того, как задача уже
          // помечена выполненной и уже начислены золото и опыт. Из-за этого
          // не доходил return, и игрок не получал событие daily:task:
          // задача засчитывалась молча, предмет не выдавался, уведомления
          // не было. Проверено: character_inventory не встречается ни в одной
          // миграции, а весь остальной код (CharacterService, CraftingService,
          // AuctionService) работает через character_items.
          //
          // Настоящий уникальный индекс — ТРЁХколоночный:
          // UNIQUE (character_id, item_id, enhancement). Отсюда enhancement
          // в списке колонок и в цели конфликта: с двумя колонками Postgres
          // не нашёл бы индекс и упал бы с новой ошибкой.
          await this.db.query(
            `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
             VALUES ($1, $2, $3, 0)
             ON CONFLICT (character_id, item_id, enhancement)
             DO UPDATE SET quantity = character_items.quantity + EXCLUDED.quantity`,
            [charId, task.reward_item_id, task.reward_item_qty]
          );
        }
        logger.info(`[DailyTask] ${charId} completed: ${task.id}`);
        // За выполненную задачу — отдельная добавка очков сезона
        void this.grantSeasonPoints(charId, SEASON_POINTS_PER_TASK);
        return { taskCompleted: true, taskId: task.id, gold: task.reward_gold, experience: task.reward_experience, item: task.reward_item_id };
      }
    }

    return { taskCompleted: false };
  }

  /**
   * Начислить очки сезона, проглотив возможные ошибки.
   *
   * Отдельный метод и именно «проглатывающий» — по двум причинам.
   * Первая: начисление очков не должно иметь возможности сорвать выдачу
   * награды за задачу дня. Пропуск — украшение, а золото и предметы это
   * оплата за выполненную работу.
   * Вторая: игрок, который никогда не открывал пропуск, всё равно должен
   * получать очки. addSeasonPoints сам заводит ему запись в бесплатной
   * лестнице, поэтому отдельная проверка «а куплен ли пропуск» здесь была бы
   * лишней.
   */
  private async grantSeasonPoints(charId: string, points: number): Promise<void> {
    if (points <= 0) return;
    try {
      await new PremiumSystem().addSeasonPoints(charId, points);
    } catch (error) {
      logger.warn('[DailyTask] season points not granted:', error);
    }
  }

  async getCompletedCount(charId: string): Promise<number> {
    const row = await this.db.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM character_daily_progress WHERE character_id = $1 AND completed = TRUE',
      [charId]
    );
    return Number(row?.count ?? 0);
  }
}
