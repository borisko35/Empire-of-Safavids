// ============================================================
// Система улучшения снаряжения — Empire of Safavids
// ============================================================

import { DatabaseService } from '../services/DatabaseService';
import { logger } from '../utils/logger';

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

  async enhance(
    characterId: string,
    inventorySlot: number,
    useProtectionScroll: boolean = false
  ): Promise<EnhancementOutcome> {
    return this.db.transaction(async (client) => {
      // Получаем предмет
      const slot = await client.query(
        'SELECT * FROM inventory WHERE character_id = $1 AND slot_index = $2 FOR UPDATE',
        [characterId, inventorySlot]
      );
      if (!slot.rows[0]) throw new Error('Item not found in slot');

      const currentEnh = slot.rows[0].enhancement as number;
      if (currentEnh >= 20) throw new Error('Item is already at maximum enhancement (+20)');

      const rate = ENHANCEMENT_RATES[currentEnh];

      // Проверяем золото
      const charRow = await client.query(
        'SELECT gold FROM characters WHERE id = $1 FOR UPDATE', [characterId]
      );
      if (charRow.rows[0].gold < rate.goldCost) throw new Error('Insufficient gold');

      // Проверяем материалы
      const matRow = await client.query(
        'SELECT quantity FROM inventory WHERE character_id = $1 AND item_id = $2',
        [characterId, rate.materialId]
      );
      if (!matRow.rows[0] || matRow.rows[0].quantity < rate.materialQty) {
        throw new Error(`Need ${rate.materialQty}x ${rate.materialId}`);
      }

      // Списываем ресурсы
      await client.query('UPDATE characters SET gold = gold - $1 WHERE id = $2', [rate.goldCost, characterId]);
      await client.query(
        'UPDATE inventory SET quantity = quantity - $1 WHERE character_id = $2 AND item_id = $3',
        [rate.materialQty, characterId, rate.materialId]
      );

      // Бросаем кубик
      const roll = Math.random();
      let outcome: EnhancementResult;
      let newEnh = currentEnh;

      if (roll < rate.success) {
        outcome = 'success';
        newEnh = currentEnh + 1;
      } else if (roll < rate.success + rate.fail) {
        outcome = 'fail';
        // Свиток защиты предотвращает понижение/уничтожение
      } else if (roll < rate.success + rate.fail + rate.downgrade) {
        outcome = useProtectionScroll ? 'fail' : 'downgrade';
        if (!useProtectionScroll) newEnh = Math.max(0, currentEnh - 1);
      } else {
        outcome = useProtectionScroll ? 'fail' : 'destroy';
        if (!useProtectionScroll) newEnh = 0;
      }

      if (outcome === 'destroy') {
        await client.query(
          'DELETE FROM inventory WHERE character_id = $1 AND slot_index = $2',
          [characterId, inventorySlot]
        );
      } else {
        await client.query(
          'UPDATE inventory SET enhancement = $1 WHERE character_id = $2 AND slot_index = $3',
          [newEnh, characterId, inventorySlot]
        );
      }

      const messages: Record<EnhancementResult, [string, string]> = {
        success:   [`Enhancement succeeded! +${newEnh}`,       `Улучшение успешно! +${newEnh}`],
        fail:      ['Enhancement failed. Item unchanged.',      'Улучшение провалилось. Предмет не изменён.'],
        downgrade: [`Enhancement failed. Downgraded to +${newEnh}`, `Провал! Уровень снижен до +${newEnh}`],
        destroy:   ['Enhancement failed. Item was destroyed!',  'Провал! Предмет уничтожен!'],
      };

      logger.info(`Enhancement: ${characterId} slot ${inventorySlot} +${currentEnh} → ${outcome} (+${newEnh})`);
      return {
        result: outcome,
        newEnhancement: newEnh,
        message: messages[outcome][0],
        messageRu: messages[outcome][1],
      };
    });
  }

  getEnhancementInfo(currentLevel: number) {
    return ENHANCEMENT_RATES[currentLevel] ?? null;
  }
}
