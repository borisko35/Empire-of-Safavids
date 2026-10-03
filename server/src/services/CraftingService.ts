// ============================================================
// Сервис крафтинга — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
// Счётчик скрафченных предметов для достижения. Общая таблица
// leaderboard, а не своя: свой счётчик - третье место учёта, где его
// легко забыть внести в список достижений.
import { LeaderboardService } from './LeaderboardService';
// Навыки гильдии: «Мастер ремесла» уменьшает время крафта. Отдельный
// сервис от счётчика, потому что это другой вопрос - не «сколько раз
// случилось», а «быстрее ли выходит».
import { GuildService } from './GuildService';
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

/**
 * Все профессии. Порядок как в данных — он же порядок показа в панели.
 */
  static readonly CATEGORIES: CraftingCategory[] = [
    'blacksmithing', 'tailoring', 'alchemy', 'cooking', 'jewelcrafting', 'carpentry',
  ];

  /**
   * Уровень в профессии. Читает crafting_skills, а при отсутствии строки
   * переносит общий прогресс characters.crafting_xp.
   *
   * ПЕРЕНОС ПРОГРЕССА. Игрок с 5000 общего опыта получает уровень 51 в
   * каждой профессии, в которой ещё не крафтил, а не начинает с нуля.
   * Иначе все, кто играл до этого изменения, потеряли бы накопленное и
   * узнали бы об этом, только увидев закрытые рецепты.
   */
  async skillLevels(characterId: string): Promise<Record<string, number>> {
    const rows = await this.db.query<{ category: string; experience: number }>(
      `SELECT category, experience FROM crafting_skills WHERE character_id = $1`,
      [characterId]
    ).catch((): { category: string; experience: number }[] => []);
    const found = new Map(rows.map((r: { category: string; experience: number }) => [r.category, Number(r.experience) || 0]));

    // Общий опыт нужен только для переноса: пока строки нет, берём его
    const pooled = rows.length ? 0 : await this.pooledXp(characterId);
    const out: Record<string, number> = {};
    for (const cat of CraftingService.CATEGORIES) {
      const xp = found.has(cat) ? (found.get(cat) as number) : pooled;
      out[cat] = CraftingService.craftingLevelFromXp(xp);
    }
    return out;
  }

  /** Общий накопленный опыт крафта — только для переноса на профессии */
  private async pooledXp(characterId: string): Promise<number> {
    const row = await this.db.queryOne<{ crafting_xp: string | number }>(
      'SELECT crafting_xp FROM characters WHERE id = $1',
      [characterId]
    ).catch(() => null);
    return Number(row?.crafting_xp ?? 0);
  }

  async startCrafting(
    characterId: string,
    recipeId: string
  ): Promise<CraftingJob> {
    const recipe = CRAFTING_RECIPES[recipeId];
    if (!recipe) throw new Error('Recipe not found');

    // Уровень берём из БД — клиентское значение не доверенно
    //
    // Проверяется ПРОФЕССИЯ рецепта, а не общий уровень крафта. Раньше
    // кузнечный опыт открывал рецепты ювелира, потому что category у
    // рецепта в данных есть, но сервер его не смотрел.
    // Один крафт за раз. Раньше проверки не было вовсе: клиент прячет
    // кнопки, пока задание есть, но это защита интерфейса, а не сервера.
    // Двойной клик по «Начать» (первый запрос ещё не ответил) запускал два
    // крафта, материалы списывались дважды, а на клиенте оставался только
    // второй идентификатор — первое задание становилось невидимым, и
    // изготовленную вещь было уже не забрать.
    // Один крафт за раз. Раньше проверки не было вовсе: клиент прячет
    // кнопки, пока задание есть, но это защита интерфейса, а не сервера.
    // Двойной клик по «Начать» (первый запрос ещё не ответил) запускал два
    // крафта, материалы списывались дважды, а на клиенте оставался только
    // второй идентификатор — первое задание становилось невидимым, и
    // изготовленную вещь было уже не забрать.
    //
    // Проверка стоит ДО списания материалов: иначе при отказе игрок потерял бы
    // всё и не получил бы ничего.
    const задания = await this.getActiveJobs(characterId);
    if (задания.length > 0) {
      throw new Error(`Craft already in progress: ${задания[0].recipeId}`);
    }


    const levels = await this.skillLevels(characterId);
    const craftingSkillLevel = levels[recipe.category] ?? 1;
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

    // Навык гильдии «Мастер ремесла»: -5% к времени крафта за уровень.
    //
    // Множитель берётся ОТДЕЛЬНЫМ вызовом и подстрахован catch: getBonuses
    // ходит в базу, и отказ базы не должен срывать начало крафта. Игрок без
    // гильдии получает обычное время, и это правильное поведение.
    let множительКрафта = 1;
    try {
      множительКрафта = (await new GuildService().getBonuses(characterId)).craft;
    } catch (err) {
      logger.warn('[Craft] бонус гильдии недоступен:', (err as Error).message);
    }
    if (!Number.isFinite(множительКрафта) || множительКрафта <= 0) множительКрафта = 1;

    const job: CraftingJob = {
      id: uuidv4(),
      characterId,
      recipeId,
      startedAt: new Date(),
      // Навык гильдии «Мастер ремесла»: -5% к времени крафта за уровень.
      //
      // Множитель берётся ОТДЕЛЬНЫМ вызовом и в try/catch: getBonuses ходит
      // в базу, и отказ базы не должен срывать начало крафта. Игрок без
      // гильдии получает обычное время - это и есть правильное поведение.
      completesAt: new Date(Date.now() + recipe.craftingTime * 1000 * множительКрафта),
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
        // Начислить опыт ремесла — в профессию рецепта, плюс суммой в
        // characters.crafting_xp, чтобы общее число не потерялось.
        //
        // Через client, а не через this.db: свой вызов открыл бы другое
        // соединение в обход транзакции, и при откате крафта опыт в
        // профессии остался бы, а предмет — нет.
        await client.query(
          `INSERT INTO crafting_skills (character_id, category, level, experience)
           VALUES ($1, $2, 1, $3)
           ON CONFLICT (character_id, category) DO UPDATE
             SET experience = crafting_skills.experience + $3,
                 level = 1 + (crafting_skills.experience + $3) / 100`,
          [job.character_id, recipe.category, recipe.experienceGain]
        );
        await client.query(
          'UPDATE characters SET crafting_xp = crafting_xp + $2 WHERE id = $1',
          [job.character_id, recipe.experienceGain]
        );
      }
    });

    logger.info(`Crafting ${success ? 'succeeded' : 'failed'}: ${recipe.resultItemId} for ${job.character_id}`);

    // Счётчик достижения растёт ТОЛЬКО за успешный крафт и ТОЛЬКО после
    // завершения транзакции.
    //
    // ПОЧЕМУ ПОСЛЕ, А НЕ ВНУТРИ ЧЕРЕЗ client.query. Свой вызов increment
    // открыл бы другое соединение в обход транзакции: при откате крафта
    // предмет и опыт исчезли бы, а счётчик остался бы. Ровно та ошибка,
    // о которой предупреждает комментарий выше про опыт ремесла.
    //
    // ПОЧЕМУ НЕ ЗА НЕУДАЧНЫЙ КРАФТ. Предмет не выдан, деньги за него не
    // заплачены. Считать попытку было бы достижением «скрафтить»,
    // которого игрок не выполнил.
    if (success) {
      // Ошибка здесь не поднимается: предмет уже в инвентаре, и ронять
      // маршрут из-за счётчика - значит показать игроку ошибку на
      // честно выданный предмет.
      await new LeaderboardService().increment(job.character_id, { itemsCrafted: 1 })
        .catch(err => logger.error('[Craft] счётчик предметов не вырос:', (err as Error).message));
    }

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
