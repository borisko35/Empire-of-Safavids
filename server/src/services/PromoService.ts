// ============================================================
// PromoService — Empire of Safavids: промокоды на валюту
// ============================================================
// Один код — одно погашение на персонажа. Лимиты использований и
// срок годности проверяются в транзакции с блокировкой строки.

import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';

export interface PromoDef {
  code: string;
  azens: number;
  silver: number;
  syrian: number;
  maxUses: number;
  usedCount: number;
  expiresAt: Date | null;
}

export interface PromoReward {
  azens: number;
  silver: number;
  syrian: number;
}

export class PromoService {
  private db = DatabaseService.getInstance();

  static normalize(code: string): string {
    return code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  }

  async create(
    adminId: string,
    input: { code: string; azens?: number; silver?: number; syrian?: number; maxUses?: number; expiresAt?: string }
  ): Promise<PromoDef> {
    const code = PromoService.normalize(input.code);
    if (code.length < 4 || code.length > 32) throw new Error('Code must be 4-32 chars (A-Z, 0-9, -, _)');
    const azens = Math.max(0, Number(input.azens ?? 0));
    const silver = Math.max(0, Math.floor(Number(input.silver ?? 0)));
    const syrian = Math.max(0, Math.floor(Number(input.syrian ?? 0)));
    if (azens <= 0 && silver <= 0 && syrian <= 0) throw new Error('Promo must grant something');
    const maxUses = Math.max(1, Math.min(1000000, Math.floor(Number(input.maxUses ?? 1))));
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error('Bad expiresAt');

    try {
      const rows = await this.db.query<Record<string, unknown>>(
        `INSERT INTO promo_codes (code, azens, silver, syrian, max_uses, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING code, azens, silver, syrian, max_uses AS "maxUses", used_count AS "usedCount", expires_at AS "expiresAt"`,
        [code, azens, silver, syrian, maxUses, expiresAt?.toISOString() ?? null, adminId]
      );
      logger.info(`[Promo] created ${code} by ${adminId}`);
      return rows[0] as unknown as PromoDef;
    } catch {
      throw new Error('Promo code already exists');
    }
  }

  async list(): Promise<PromoDef[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT code, azens, silver, syrian, max_uses AS "maxUses",
              used_count AS "usedCount", expires_at AS "expiresAt"
       FROM promo_codes ORDER BY created_at DESC LIMIT 200`
    );
    return rows as unknown as PromoDef[];
  }

  async redeem(characterId: string, rawCode: string): Promise<PromoReward> {
    const code = PromoService.normalize(rawCode);
    if (!code) throw new Error('Bad code');

    return this.db.transaction(async (client) => {
      const res = await client.query('SELECT * FROM promo_codes WHERE code = $1 FOR UPDATE', [code]);
      if (res.rowCount === 0) throw new Error('Promo not found');
      const promo = res.rows[0] as {
        azens: string; silver: string; syrian: string;
        max_uses: number; used_count: number; expires_at: Date | null;
      };
      if (promo.expires_at && new Date(promo.expires_at).getTime() < Date.now()) {
        throw new Error('Promo expired');
      }
      if (Number(promo.used_count) >= Number(promo.max_uses)) throw new Error('Promo exhausted');
      const used = await client.query(
        'SELECT 1 FROM promo_uses WHERE code = $1 AND character_id = $2',
        [code, characterId]
      );
      if ((used.rowCount ?? 0) > 0) throw new Error('Already redeemed');

      const azens = Number(promo.azens);
      const silver = Number(promo.silver);
      const syrian = Number(promo.syrian);
      if (azens > 0) await client.query('UPDATE characters SET azens = azens + $1 WHERE id = $2', [azens, characterId]);
      if (silver > 0) await client.query('UPDATE characters SET isfahan_silver = isfahan_silver + $1 WHERE id = $2', [silver, characterId]);
      if (syrian > 0) await client.query('UPDATE characters SET syrian_gold = syrian_gold + $1 WHERE id = $2', [syrian, characterId]);
      await client.query('INSERT INTO promo_uses (code, character_id) VALUES ($1, $2)', [code, characterId]);
      await client.query('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = $1', [code]);

      logger.info(`[Promo] ${code} redeemed by ${characterId}`);
      return { azens, silver, syrian };
    });
  }
}
