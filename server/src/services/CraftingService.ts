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

  async startCrafting(
    characterId: string,
    recipeId: string,
    craftingSkillLevel: number
  ): Promise<CraftingJob> {
    const recipe = CRAFTING_RECIPES[recipeId];
    if (!recipe) throw new Error('Recipe not found');
    if (recipe.requiredLevel > craftingSkillLevel) {
      throw new Error(`Required crafting level: ${recipe.requiredLevel}`);
    }

    // Проверить инвентарь
    const inventoryRows = await this.db.query<{ item_id: string; quantity: number }>(
      'SELECT item_id, SUM(quantity) as quantity FROM inventory WHERE character_id = $1 GROUP BY item_id',
      [characterId]
    );
    const inventory: Record<string, number> = {};
    inventoryRows.forEach(r => { inventory[r.item_id] = r.quantity; });

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
      // Списать материалы
      for (const ing of recipe.ingredients) {
        await client.query(
          `UPDATE inventory SET quantity = quantity - $1
           WHERE character_id = $2 AND item_id = $3`,
          [ing.quantity, characterId, ing.itemId]
        );
        // Удалить пустые слоты
        await client.query(
          'DELETE FROM inventory WHERE character_id = $1 AND item_id = $2 AND quantity <= 0',
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
    const job = await this.db.queryOne<CraftingJob>(
      'SELECT * FROM crafting_jobs WHERE id = $1 AND status = $2',
      [jobId, 'in_progress']
    );
    if (!job) throw new Error('Crafting job not found');
    if (new Date() < job.completesAt) throw new Error('Crafting not yet complete');

    const recipe = CRAFTING_RECIPES[job.recipeId];
    const success = Math.random() < recipe.successRate;

    await this.db.transaction(async (client) => {
      await client.query(
        'UPDATE crafting_jobs SET status = $1 WHERE id = $2',
        [success ? 'completed' : 'failed', jobId]
      );

      if (success) {
        // Добавить предмет в инвентарь
        await client.query(
          `INSERT INTO inventory (id, character_id, slot_index, item_id, quantity, enhancement)
           SELECT $1, $2,
             COALESCE((SELECT MAX(slot_index) + 1 FROM inventory WHERE character_id = $2), 0),
             $3, $4, 0
           ON CONFLICT (character_id, slot_index) DO UPDATE SET quantity = inventory.quantity + $4`,
          [uuidv4(), job.characterId, recipe.resultItemId, recipe.resultQuantity]
        );
        // Начислить опыт крафтинга
        await client.query(
          `UPDATE characters SET updated_at = NOW() WHERE id = $1`,
          [job.characterId]
        );
      }
    });

    logger.info(`Crafting ${success ? 'succeeded' : 'failed'}: ${recipe.resultItemId} for ${job.characterId}`);
    return { success, itemId: recipe.resultItemId, quantity: success ? recipe.resultQuantity : 0 };
  }

  async getActiveJobs(characterId: string): Promise<CraftingJob[]> {
    return this.db.query<CraftingJob>(
      'SELECT * FROM crafting_jobs WHERE character_id = $1 AND status = $2 ORDER BY started_at DESC',
      [characterId, 'in_progress']
    );
  }

  getRecipesByCategory(category: CraftingCategory) {
    return Object.values(CRAFTING_RECIPES).filter(r => r.category === category);
  }
}
