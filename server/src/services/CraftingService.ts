// ============================================================
// Сервис крафтинга — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';
import { CRAFTING_RECIPES, CraftingCategory, canCraft } from '../data/crafting';
import { v4 as uuidv4 } from 'uuid';

export interface CraftingJob {
  id: string;
  characterId: string;
  recipeId: string;
  startedAt: Date;
  completesAt: Date;
  status: 'in_progress' | 'completed' | 'failed';
}

export class CraftingService {
  private db = DatabaseService.getInstance();

  /** Уровень ремесла из накопленного опыта (сервер — источник истины) */
  static craftingLevelFromXp(xp: number): number {
    return Math.max(1, Math.min(100, 1 + Math.floor(xp / 100)));
  }

  async startCrafting(
    characterId: string,
    recipeId: string
  ): Promise<CraftingJob> {
    const recipe = CRAFTING_RECIPES[recipeId];
    if (!recipe) throw new Error('Recipe not found');

    // Уровень крафта берём из БД — клиентское значение не доверенно
    const char = await this.db.queryOne<{ crafting_xp: string | number }>(
      'SELECT crafting_xp FROM characters WHERE id = $1',
      [characterId]
    );
    const craftingSkillLevel = CraftingService.craftingLevelFromXp(Number(char?.crafting_xp ?? 0));
    if (recipe.requiredLevel > craftingSkillLevel) {
      throw new Error(`Required crafting level: ${recipe.requiredLevel}`);
    }

    // Проверить инвентарь (суммарное количество по всем стекам предмета)
    const inventoryRows = await this.db.query<{ item_id: string; quantity: string }>(
      'SELECT item_id, SUM(quantity) as quantity FROM character_items WHERE character_id = $1 GROUP BY item_id',
      [characterId]
    );
    const inventory: Record<string, number> = {};
    inventoryRows.forEach(r => { inventory[r.item_id] = Number(r.quantity); });

    const { canCraft: possible, missing } = canCraft(recipeId, inventory);
    if (!possible) {
      throw new Error(`Missing materials: ${missing.map(m => `${m.itemId} (need ${m.required}, have ${m.have})`).join(', ')}`);
    }

    const job: CraftingJob = {
      id: uuidv4(),
      characterId,
      recipeId,
      startedAt: new Date(),
      completesAt: new Date(Date.now() + recipe.craftingTime * 1000),
      status: 'in_progress',
    };

    await this.db.transaction(async (client) => {
      // Списать материалы (проверка с блокировкой строки — защита от гонки)
      for (const ing of recipe.ingredients) {
        const res = await client.query(
          `UPDATE character_items SET quantity = quantity - $1
           WHERE id = (
             SELECT id FROM character_items
             WHERE character_id = $2 AND item_id = $3 AND quantity >= $1
             ORDER BY enhancement DESC LIMIT 1
             FOR UPDATE
           )`,
          [ing.quantity, characterId, ing.itemId]
        );
        if (res.rowCount === 0) {
          throw new Error(`Missing materials: ${ing.itemId} (need ${ing.quantity})`);
        }
        // Удалить опустевшие стеки
        await client.query(
          'DELETE FROM character_items WHERE character_id = $1 AND item_id = $2 AND quantity <= 0',
          [characterId, ing.itemId]
        );
      }

      // Сохранить задание на крафтинг
      await client.query(
        `INSERT INTO crafting_jobs (id, character_id, recipe_id, started_at, completes_at, status)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [job.id, job.characterId, job.recipeId, job.startedAt, job.completesAt, job.status]
      );
    });

    logger.info(`Crafting started: ${recipeId} by ${characterId}, completes at ${job.completesAt}`);
    return job;
  }

  async completeCrafting(jobId: string): Promise<{ success: boolean; itemId: string; quantity: number }> {
    // Строки crafting_jobs приходят в snake_case
    const job = await this.db.queryOne<{
      id: string; character_id: string; recipe_id: string; completes_at: Date; status: string;
    }>(
      'SELECT * FROM crafting_jobs WHERE id = $1 AND status = $2',
      [jobId, 'in_progress']
    );
    if (!job) throw new Error('Crafting job not found');
    if (new Date() < new Date(job.completes_at)) throw new Error('Crafting not yet complete');

    const recipe = CRAFTING_RECIPES[job.recipe_id];
    if (!recipe) throw new Error('Recipe not found');
    const success = Math.random() < recipe.successRate;

    await this.db.transaction(async (client) => {
      await client.query(
        'UPDATE crafting_jobs SET status = $1 WHERE id = $2',
        [success ? 'completed' : 'failed', jobId]
      );

      if (success) {
        // Добавить предмет в инвентарь
        await client.query(
          `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
           VALUES ($1, $2, $3, 0)
           ON CONFLICT (character_id, item_id, enhancement)
           DO UPDATE SET quantity = character_items.quantity + $3`,
          [job.character_id, recipe.resultItemId, recipe.resultQuantity]
        );
        // Начислить опыт ремесла
        await client.query(
          'UPDATE characters SET crafting_xp = crafting_xp + $2 WHERE id = $1',
          [job.character_id, recipe.experienceGain]
        );
      }
    });

    logger.info(`Crafting ${success ? 'succeeded' : 'failed'}: ${recipe.resultItemId} for ${job.character_id}`);
    return { success, itemId: recipe.resultItemId, quantity: success ? recipe.resultQuantity : 0 };
  }

  async getActiveJobs(characterId: string): Promise<CraftingJob[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM crafting_jobs WHERE character_id = $1 AND status = $2 ORDER BY started_at DESC',
      [characterId, 'in_progress']
    );
    return rows.map(r => ({
      id: String(r.id),
      characterId: String(r.character_id),
      recipeId: String(r.recipe_id),
      startedAt: new Date(r.started_at as string),
      completesAt: new Date(r.completes_at as string),
      status: r.status as CraftingJob['status'],
    }));
  }

  getRecipesByCategory(category: CraftingCategory) {
    return Object.values(CRAFTING_RECIPES).filter(r => r.category === category);
  }
}
