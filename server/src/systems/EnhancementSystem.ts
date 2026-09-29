// ============================================================
// Система улучшения снаряжения — Empire of Safavids
// ============================================================

import { PoolClient } from 'pg';
import { DatabaseService } from '../services/DatabaseService';
import { logger } from '../utils/logger';
import { ITEMS_DATABASE } from '../data/items';
import { ItemType } from '../types/game.types';
import { professionOf } from '../services/ProfessionService';
import { professionBonuses } from './ProfessionBonuses';

export type EnhancementResult = 'success' | 'fail' | 'downgrade' | 'destroy';

export interface EnhancementOutcome {
  result: EnhancementResult;
  newEnhancement: number;
  message: string;
  messageRu: string;
}

// Шансы улучшения по уровням (+0 → +20)
const ENHANCEMENT_RATES: Record<number, {
  success: number;   // шанс успеха
  fail: number;      // шанс провала
  downgrade: number; // шанс понижения
  destroy: number;   // шанс уничтожения
  goldCost: number;
  materialId: string;
  materialQty: number;
}> = {
   0: { success: 1.00, fail: 0.00, downgrade: 0.00, destroy: 0.00, goldCost: 100,    materialId: 'mat_iron_ore',  materialQty: 2  },
   1: { success: 0.95, fail: 0.05, downgrade: 0.00, destroy: 0.00, goldCost: 200,    materialId: 'mat_iron_ore',  materialQty: 4  },
   2: { success: 0.90, fail: 0.10, downgrade: 0.00, destroy: 0.00, goldCost: 400,    materialId: 'mat_iron_ore',  materialQty: 6  },
   3: { success: 0.85, fail: 0.15, downgrade: 0.00, destroy: 0.00, goldCost: 800,    materialId: 'mat_iron_ore',  materialQty: 10 },
   4: { success: 0.80, fail: 0.20, downgrade: 0.00, destroy: 0.00, goldCost: 1500,   materialId: 'mat_turquoise', materialQty: 1  },
   5: { success: 0.70, fail: 0.20, downgrade: 0.10, destroy: 0.00, goldCost: 3000,   materialId: 'mat_turquoise', materialQty: 2  },
   6: { success: 0.60, fail: 0.25, downgrade: 0.15, destroy: 0.00, goldCost: 5000,   materialId: 'mat_turquoise', materialQty: 3  },
   7: { success: 0.50, fail: 0.25, downgrade: 0.20, destroy: 0.05, goldCost: 8000,   materialId: 'mat_turquoise', materialQty: 5  },
   8: { success: 0.40, fail: 0.25, downgrade: 0.25, destroy: 0.10, goldCost: 12000,  materialId: 'mat_turquoise', materialQty: 8  },
   9: { success: 0.30, fail: 0.25, downgrade: 0.30, destroy: 0.15, goldCost: 20000,  materialId: 'mat_turquoise', materialQty: 12 },
  10: { success: 0.20, fail: 0.25, downgrade: 0.35, destroy: 0.20, goldCost: 35000,  materialId: 'mat_dragon_scale', materialQty: 1 },
  11: { success: 0.18, fail: 0.22, downgrade: 0.35, destroy: 0.25, goldCost: 50000,  materialId: 'mat_dragon_scale', materialQty: 2 },
  12: { success: 0.15, fail: 0.20, downgrade: 0.35, destroy: 0.30, goldCost: 70000,  materialId: 'mat_dragon_scale', materialQty: 3 },
  13: { success: 0.12, fail: 0.18, downgrade: 0.35, destroy: 0.35, goldCost: 100000, materialId: 'mat_dragon_scale', materialQty: 5 },
  14: { success: 0.10, fail: 0.15, downgrade: 0.35, destroy: 0.40, goldCost: 150000, materialId: 'mat_dragon_scale', materialQty: 7 },
  15: { success: 0.08, fail: 0.12, downgrade: 0.35, destroy: 0.45, goldCost: 200000, materialId: 'mat_dragon_scale', materialQty: 10 },
  16: { success: 0.06, fail: 0.10, downgrade: 0.34, destroy: 0.50, goldCost: 300000, materialId: 'mat_dragon_scale', materialQty: 15 },
  17: { success: 0.05, fail: 0.08, downgrade: 0.32, destroy: 0.55, goldCost: 400000, materialId: 'mat_dragon_scale', materialQty: 20 },
  18: { success: 0.04, fail: 0.06, downgrade: 0.30, destroy: 0.60, goldCost: 600000, materialId: 'mat_dragon_scale', materialQty: 30 },
  19: { success: 0.02, fail: 0.03, downgrade: 0.25, destroy: 0.70, goldCost: 900000, materialId: 'mat_dragon_scale', materialQty: 50 },
};

export class EnhancementSystem {
  private db = DatabaseService.getInstance();

  /**
   * Заточить предмет из сумки.
   * Стек предмета хранится по (персонаж, предмет, уровень заточки):
   * успех переносит один экземпляр из яруса +N в ярус +(N+1),
   * downgrade — в +(N−1), destroy — уничтожает экземпляр.
   */
  async enhance(characterId: string, itemId: string): Promise<EnhancementOutcome> {
    // Стоимость улучшения снижается профессией «Кузнец». Считается здесь,
    // а не в маршруте: единственное место, где золото реально списывается,
    // иначе скидка существовала бы только на словах.
    const def = ITEMS_DATABASE[itemId];
    if (!def) throw new Error('Item not found');
    if (def.type !== ItemType.WEAPON && def.type !== ItemType.ARMOR && def.type !== ItemType.ACCESSORY) {
      throw new Error('Only equipment can be enhanced');
    }

    return this.db.transaction(async (client) => {
      // Верхний (самый заточенный) стек предмета
      const stack = await client.query(
        `SELECT enhancement, quantity FROM character_items
         WHERE character_id = $1 AND item_id = $2
         ORDER BY enhancement DESC LIMIT 1 FOR UPDATE`,
        [characterId, itemId]
      );
      if (!stack.rows[0]) throw new Error('Item not in inventory');

      const currentEnh = Number(stack.rows[0].enhancement);
      if (currentEnh >= 20) throw new Error('Item is already at maximum enhancement (+20)');

      const rate = ENHANCEMENT_RATES[currentEnh];

      // Проверяем золото
      const charRow = await client.query(
        'SELECT gold FROM characters WHERE id = $1 FOR UPDATE', [characterId]
      );
      const prof = await professionOf(characterId);
const costMult = professionBonuses(prof?.id ?? null, prof?.level ?? 0).enhanceCost;
// Округление вниз и минимум в 1: скидка не должна превращать улучшение
// в бесплатное, иначе на высоких уровнях кузнец ломал бы игру.
const goldCost = Math.max(1, Math.floor(rate.goldCost * costMult));
if (charRow.rows[0].gold < goldCost) throw new Error('Insufficient gold');

      // Проверяем материалы
      const matRow = await client.query(
        'SELECT SUM(quantity) AS total FROM character_items WHERE character_id = $1 AND item_id = $2',
        [characterId, rate.materialId]
      );
      if (!matRow.rows[0] || Number(matRow.rows[0].total) < rate.materialQty) {
        throw new Error(`Need ${rate.materialQty}x ${rate.materialId}`);
      }

      // Списываем ресурсы
      await client.query('UPDATE characters SET gold = gold - $1 WHERE id = $2', [goldCost, characterId]);
      await this.consumeMaterials(client, characterId, rate.materialId, rate.materialQty);

      // Бросаем кубик
      const roll = Math.random();
      let outcome: EnhancementResult;
      let newEnh = currentEnh;

      if (roll < rate.success) {
        outcome = 'success';
        newEnh = currentEnh + 1;
      } else if (roll < rate.success + rate.fail) {
        outcome = 'fail';
      } else if (roll < rate.success + rate.fail + rate.downgrade) {
        outcome = 'downgrade';
        newEnh = Math.max(0, currentEnh - 1);
      } else {
        outcome = 'destroy';
        newEnh = 0;
      }

      if (outcome === 'destroy') {
        await this.consumeMaterials(client, characterId, itemId, 1);
      } else if (outcome === 'success' || outcome === 'downgrade') {
        // Переносим экземпляр между ярусами заточки
        await this.consumeMaterials(client, characterId, itemId, 1);
        await client.query(
          `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
           VALUES ($1, $2, 1, $3)
           ON CONFLICT (character_id, item_id, enhancement)
           DO UPDATE SET quantity = character_items.quantity + 1`,
          [characterId, itemId, newEnh]
        );
      }
      // outcome === 'fail': предмет остаётся без изменений

      const messages: Record<EnhancementResult, [string, string]> = {
        success:   [`Enhancement succeeded! +${newEnh}`,       `Улучшение успешно! +${newEnh}`],
        fail:      ['Enhancement failed. Item unchanged.',      'Улучшение провалилось. Предмет не изменён.'],
        downgrade: [`Enhancement failed. Downgraded to +${newEnh}`, `Провал! Уровень снижен до +${newEnh}`],
        destroy:   ['Enhancement failed. Item was destroyed!',  'Провал! Предмет уничтожен!'],
      };

      logger.info(`Enhancement: ${characterId} ${itemId} +${currentEnh} → ${outcome} (+${newEnh})`);
      return {
        result: outcome,
        newEnhancement: newEnh,
        message: messages[outcome][0],
        messageRu: messages[outcome][1],
      };
    });
  }

  /** Списать quantity экземпляров предмета, удаляя опустевшие стеки. */
  private async consumeMaterials(
    client: PoolClient,
    characterId: string,
    itemId: string,
    quantity: number
  ): Promise<void> {
    await client.query(
      `UPDATE character_items SET quantity = quantity - $1
       WHERE id = (
         SELECT id FROM character_items
         WHERE character_id = $2 AND item_id = $3 AND quantity >= $1
         ORDER BY enhancement DESC LIMIT 1
         FOR UPDATE
       )`,
      [quantity, characterId, itemId]
    );
    await client.query(
      'DELETE FROM character_items WHERE character_id = $1 AND item_id = $2 AND quantity <= 0',
      [characterId, itemId]
    );
  }

  getEnhancementInfo(currentLevel: number) {
    return ENHANCEMENT_RATES[currentLevel] ?? null;
  }
}
