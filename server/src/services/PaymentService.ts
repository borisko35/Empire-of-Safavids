// ============================================================
// PaymentService — Empire of Safavids: жизненный цикл платежей
// ============================================================
// Денежное правило: AZENS начисляется ТОЛЬКО через completePayment
// (вебхук провайдера или симулятор в dev). Создание топ-апа лишь
// открывает pending-запись и ничего не начисляет.
//
// Идемпотентность: повторные вебхуки (ретраи провайдера) не должны
// кредитовать дважды — защита через статус + unique(provider,
// provider_payment_id).

import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './DatabaseService';
import { convertRealToAzens, getPack, FIRST_TOPUP_MULTIPLIER, FIRST_TOPUP_MAX_BONUS, DAILY_TOPUP_MAX_AZENS, DAILY_TOPUP_MAX_COUNT } from '../utils/economy';
import { logger } from '../utils/logger';

export interface PendingPayment {
  id: string;
  userId: string;
  characterId: string;
  provider: string;
  packId: string | null;
  bonus: number;
  realCurrency: string;
  realAmount: number;
  azensExpected: number;
  status: string;
  createdAt: Date;
}

export interface WebhookResult {
  ok: boolean;
  code?: string;
  deduped?: boolean;
  azens?: number;
  bonus?: number;
}

export class PaymentService {
  private db = DatabaseService.getInstance();

  /** Открыть pending-платёж: пакет или свободная сумма. Ничего не начисляет. */
  async createTopup(
    userId: string,
    characterId: string,
    input: { packId: string } | { realCurrency: string; amount: number }
  ): Promise<PendingPayment> {
    let realCurrency: string;
    let realAmount: number;
    let azens: number;
    let packId: string | null = null;

    if ('packId' in input) {
      const pack = getPack(input.packId);
      if (!pack) throw new Error('Unknown pack');
      packId = pack.id;
      realCurrency = pack.realCurrency;
      realAmount = pack.realAmount;
      azens = pack.azens;
    } else {
      const converted = convertRealToAzens(input.realCurrency, input.amount);
      azens = converted.azens;
      realCurrency = input.realCurrency.toLowerCase();
      realAmount = Math.floor(input.amount);
    }
    if (azens <= 0) throw new Error('Amount is below the minimum rate step');

    // Дневной антифрод-кап: сумма и число топ-апов юзера за сутки.
    const dayUse = await this.db.queryOne<{ total: string; cnt: string }>(
      `SELECT COALESCE(SUM(azens_credited), 0) AS total, COUNT(*) AS cnt
       FROM payments WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
       AND status IN ('pending', 'completed')`,
      [userId]
    );
    if (Number(dayUse?.cnt ?? 0) >= DAILY_TOPUP_MAX_COUNT) {
      throw new Error('Daily top-up count limit reached, try tomorrow');
    }
    if (Number(dayUse?.total ?? 0) + azens > DAILY_TOPUP_MAX_AZENS) {
      throw new Error('Daily top-up amount limit reached, try tomorrow');
    }

    const id = uuidv4();
    const idempotencyKey = uuidv4();
    await this.db.query(
      `INSERT INTO payments
         (id, user_id, character_id, provider, pack_id, real_currency, real_amount, azens_credited, status, idempotency_key)
       VALUES ($1, $2, $3, 'awaiting_provider', $4, $5, $6, $7, 'pending', $8)`,
      [id, userId, characterId, packId, realCurrency, realAmount, azens, idempotencyKey]
    );
    logger.info(`[Payments] pending ${id}: ${realAmount} ${realCurrency} -> ${azens} AZENS`);
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM payments WHERE id = $1',
      [id]
    );
    return this.mapRow(row!);
  }

  async getPayment(paymentId: string): Promise<PendingPayment | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM payments WHERE id = $1',
      [paymentId]
    );
    return row ? this.mapRow(row) : null;
  }

  /**
   * Запомнить идентификатор счёта у провайдера.
   *
   * Пишется сразу при создании счёта, а не при успешной оплате. Разница
   * видна на отмене: если игрок оплатил и тут же нажал «вернуть деньги»,
   * найти платёж по нашей записи не получится, а по референсу провайдера —
   * получится. В поддержке без этого отвечали бы «платежа не видим».
   *
   * Поле не перезаписывается: повторный вызов с другим значением означал бы
   * двойной счёт, и подмена идентификатора дала бы возможность начислить AZENS
   * по чужому платежу.
   */
  async attachProviderPaymentId(paymentId: string, providerPaymentId: string): Promise<void> {
    await this.db.query(
      `UPDATE payments SET provider_payment_id = $2, updated_at = NOW()
        WHERE id = $1 AND provider_payment_id IS NULL`,
      [paymentId, providerPaymentId]
    );
  }

  /**
   * Найти платёж по референсу провайдера.
   *
   * Нужен вебхуку: уведомление может прийти без наших метаданных, и тогда
   * единственный способ узнать, о каком платеже речь, — этот поиск.
   */
  async findByProviderPaymentId(
    provider: string,
    providerPaymentId: string
  ): Promise<PendingPayment | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM payments WHERE provider = $1 AND provider_payment_id = $2',
      [provider, providerPaymentId]
    );
    return row ? this.mapRow(row) : null;
  }

  /**
   * Завершить платёж (вебхук провайдера / симулятор).
   * Единственное место, где AZENS падает на баланс.
   */
  async completePayment(opts: {
    provider: string;
    providerPaymentId: string;
    paymentId?: string;
    succeed: boolean;
    failReason?: string;
  }): Promise<WebhookResult> {
    return this.db.transaction(async (client) => {
      // 1. Дедупликация по референсу провайдера: ретрай не должен платить дважды.
      const dup = await client.query(
        `SELECT id, status FROM payments
          WHERE provider = $1 AND provider_payment_id = $2`,
        [opts.provider, opts.providerPaymentId]
      );
      if ((dup.rowCount ?? 0) > 0) {
        return { ok: true, deduped: true };
      }

      // 2. Лочим платёж и проверяем статус.
      if (!opts.paymentId) return { ok: false, code: 'payment_not_found' };
      const res = await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [opts.paymentId]);
      if ((res.rowCount ?? 0) === 0) return { ok: false, code: 'payment_not_found' };
      const payment = res.rows[0] as { id: string; status: string; azens_credited: string; character_id: string; user_id: string };
      if (payment.status === 'completed') return { ok: true, deduped: true };
      if (payment.status !== 'pending') return { ok: false, code: 'payment_not_pending' };

      if (!opts.succeed) {
        await client.query(
          `UPDATE payments SET status = 'failed', fail_reason = $2, provider = $3,
            provider_payment_id = $4, updated_at = NOW() WHERE id = $1`,
          [payment.id, opts.failReason ?? 'provider declined', opts.provider, opts.providerPaymentId]
        );
        return { ok: true };
      }

      // Бонус первой покупки: x2 на первый завершённый платёж юзера, с капом.
      const base = Number(payment.azens_credited);
      const prior = await client.query(
        `SELECT COUNT(*)::int AS n FROM payments WHERE user_id = $1 AND status = 'completed'`,
        [payment.user_id]
      );
      const bonus = (prior.rows[0]?.n ?? 0) === 0
        ? Math.min(base * (FIRST_TOPUP_MULTIPLIER - 1), FIRST_TOPUP_MAX_BONUS)
        : 0;
      const total = base + bonus;

      await client.query('UPDATE characters SET azens = azens + $1 WHERE id = $2', [
        total,
        payment.character_id,
      ]);
      await client.query(
        `UPDATE payments SET status = 'completed', provider = $2,
          provider_payment_id = $3, bonus_azens = $4, updated_at = NOW() WHERE id = $1`,
        [payment.id, opts.provider, opts.providerPaymentId, bonus]
      );
      const bal = await client.query('SELECT azens FROM characters WHERE id = $1', [payment.character_id]);
      logger.info(`[Payments] completed ${payment.id}: +${total} AZENS${bonus > 0 ? ` (first-bonus ${bonus})` : ''}`);
      return { ok: true, azens: Number(bal.rows[0]?.azens ?? 0), bonus };
    });
  }

  /**
   * Возврат/чарджбэк по уже зачисленному платежу: статус -> refunded,
   * AZENS списываются обратно (баланс может уйти в минус = долг).
   * Идемпотентно, как и completePayment.
   */
  async reversePayment(opts: {
    provider: string;
    providerPaymentId: string;
    paymentId?: string;
    reason?: string;
  }): Promise<WebhookResult> {
    return this.db.transaction(async (client) => {
      const dup = await client.query(
        `SELECT id, status FROM payments
          WHERE provider = $1 AND provider_payment_id = $2`,
        [opts.provider, opts.providerPaymentId]
      );
      if ((dup.rowCount ?? 0) > 0) {
        return { ok: true, deduped: true };
      }
      if (!opts.paymentId) return { ok: false, code: 'payment_not_found' };
      const res = await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [opts.paymentId]);
      if ((res.rowCount ?? 0) === 0) return { ok: false, code: 'payment_not_found' };
      const payment = res.rows[0] as { id: string; status: string; azens_credited: string; character_id: string };
      if (payment.status === 'refunded' || payment.status === 'reversed') return { ok: true, deduped: true };
      if (payment.status !== 'completed') return { ok: false, code: 'payment_not_completed' };

      await client.query('UPDATE characters SET azens = azens - $1 WHERE id = $2', [
        Number(payment.azens_credited),
        payment.character_id,
      ]);
      await client.query(
        `UPDATE payments SET status = 'refunded', fail_reason = $2, provider = $3,
          provider_payment_id = $4, updated_at = NOW() WHERE id = $1`,
        [payment.id, opts.reason ?? 'refunded by provider', opts.provider, opts.providerPaymentId]
      );
      const bal = await client.query('SELECT azens FROM characters WHERE id = $1', [payment.character_id]);
      logger.info(`[Payments] refunded ${payment.id}: -${payment.azens_credited} AZENS`);
      return { ok: true, azens: Number(bal.rows[0]?.azens ?? 0) };
    });
  }

  async hasCompletedPayment(userId: string): Promise<boolean> {
    const row = await this.db.queryOne<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM payments WHERE user_id = $1 AND status = $2',
      [userId, 'completed']
    );
    return (row?.n ?? 0) > 0;
  }

  /** История платежей юзера (для экрана «Мои покупки», без секретов). */
  async listMine(userId: string, limit = 50): Promise<PendingPayment[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.max(1, Math.min(200, limit))]
    );
    return rows.map(r => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): PendingPayment {
    const g = (k: string): unknown => row[k];
    return {
      id: String(g('id')),
      userId: String(g('user_id')),
      characterId: String(g('character_id')),
      provider: String(g('provider') ?? 'awaiting_provider'),
      packId: g('pack_id') ? String(g('pack_id')) : null,
      bonus: Number(g('bonus_azens') ?? 0),
      realCurrency: String(g('real_currency')),
      realAmount: Number(g('real_amount')),
      azensExpected: Number(g('azens_credited')),
      status: String(g('status')),
      createdAt: g('created_at') as Date,
    };
  }
}
