-- Migration 018: payment lifecycle (pending -> completed/failed), provider idempotency, admin grants journal.
-- Money rule: AZENS is credited ONLY through completePayment (provider webhook or senior-admin grant).
-- Top-up creation never credits anything by itself.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider VARCHAR(30) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS provider_payment_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100),
  ADD COLUMN IF NOT EXISTS fail_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_status_check') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_status_check
      CHECK (status IN ('pending', 'completed', 'failed', 'refunded', 'reversed'));
  END IF;
END $$;

-- Same provider payment must never credit twice (webhook retries are normal).
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_ref
  ON payments(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency
  ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Journal of manual currency grants. Reason is mandatory: no silent money printing.
CREATE TABLE IF NOT EXISTS admin_grants (
  id           UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  admin_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  currency     VARCHAR(20) NOT NULL CHECK (currency IN ('azens', 'gold', 'isfahan_silver', 'syrian_gold')),
  amount       NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  reason       VARCHAR(500) NOT NULL CHECK (reason <> ''),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_grants_character ON admin_grants(character_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_grants_admin ON admin_grants(admin_id, created_at DESC);
