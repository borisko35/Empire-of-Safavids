-- Migration 019: AZENS packs, first-purchase bonus, promocodes.
-- payments.pack_id: fixed bundle bought (NULL = free amount).
-- payments.bonus_azens: extra AZENS credited on top (first-purchase x2 etc.).

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS pack_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS bonus_azens NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- Promocodes: AZENS / silver / syrian rewards, limited uses and lifetime.
CREATE TABLE IF NOT EXISTS promo_codes (
  code        VARCHAR(32) PRIMARY KEY,
  azens       NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (azens >= 0),
  silver      BIGINT NOT NULL DEFAULT 0 CHECK (silver >= 0),
  syrian      BIGINT NOT NULL DEFAULT 0 CHECK (syrian >= 0),
  max_uses    INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count  INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at  TIMESTAMPTZ,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (azens > 0 OR silver > 0 OR syrian > 0)
);

-- One redemption per character (a player cannot farm one code with alts on one char).
CREATE TABLE IF NOT EXISTS promo_uses (
  code         VARCHAR(32) NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  used_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (code, character_id)
);
