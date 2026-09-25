-- Migration 017: multi-currency wallets (AZENS premium, Isfahan silver, Syrian gold)
-- AZENS: premium currency topped up with real money, spent in premium shop / battle pass.
-- isfahan_silver / syrian_gold: free currencies from quests, trade and events (never sold for real money).

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS azens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS isfahan_silver BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS syrian_gold BIGINT NOT NULL DEFAULT 0;

-- Ledger of real-money top-ups (audit + support). Amounts in minor units of real currency.
CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id    UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  real_currency   VARCHAR(10) NOT NULL,
  real_amount     BIGINT NOT NULL CHECK (real_amount > 0),
  azens_credited  NUMERIC(12, 2) NOT NULL CHECK (azens_credited >= 0),
  status          VARCHAR(20) NOT NULL DEFAULT 'completed',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_character ON payments(character_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at DESC);
