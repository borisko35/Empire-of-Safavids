-- Migration 003: Monetization, Mounts, Pets, Premium, Battle Pass

-- Premium subscriptions
CREATE TABLE premium_subscriptions (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL
);

-- Battle Pass progress
CREATE TABLE battle_pass_progress (
  character_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  season_id     VARCHAR(50) NOT NULL,
  is_premium    BOOLEAN NOT NULL DEFAULT FALSE,
  points        INTEGER NOT NULL DEFAULT 0,
  claimed_tiers JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (character_id, season_id)
);

-- Mounts
CREATE TABLE character_mounts (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  mount_id     VARCHAR(50) NOT NULL,
  level        SMALLINT NOT NULL DEFAULT 1,
  experience   INTEGER NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT FALSE,
  custom_name  VARCHAR(30),
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, mount_id)
);

-- Pets
CREATE TABLE character_pets (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  pet_id       VARCHAR(50) NOT NULL,
  level        SMALLINT NOT NULL DEFAULT 1,
  experience   INTEGER NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT FALSE,
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, pet_id)
);

-- Notifications
CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  type         VARCHAR(50) NOT NULL,
  title_ru     VARCHAR(100) NOT NULL,
  body_ru      TEXT NOT NULL,
  data         JSONB DEFAULT '{}',
  is_read      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_character ON notifications(character_id) WHERE is_read = FALSE;

-- Admin logs
CREATE TABLE admin_logs (
  id         BIGSERIAL PRIMARY KEY,
  admin_id   UUID NOT NULL,
  action     VARCHAR(50) NOT NULL,
  target_id  UUID,
  details    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_admin_logs_created ON admin_logs(created_at DESC);

-- Anti-cheat violations
CREATE TABLE anticheat_violations (
  id           BIGSERIAL PRIMARY KEY,
  character_id UUID NOT NULL,
  type         VARCHAR(50) NOT NULL,
  details      TEXT NOT NULL,
  severity     SMALLINT NOT NULL DEFAULT 1,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_anticheat_character ON anticheat_violations(character_id, detected_at DESC);

-- Character mutes
CREATE TABLE character_mutes (
  character_id UUID PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  muted_until  TIMESTAMPTZ NOT NULL,
  reason       TEXT,
  muted_by     UUID
);

-- Bounties
CREATE TABLE bounties (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  placer_id  UUID NOT NULL REFERENCES characters(id),
  target_id  UUID NOT NULL REFERENCES characters(id),
  amount     BIGINT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  claimer_id UUID REFERENCES characters(id)
);
CREATE INDEX idx_bounties_target ON bounties(target_id) WHERE is_active = TRUE;

-- Character achievements
CREATE TABLE character_achievements (
  character_id   UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  achievement_id VARCHAR(50) NOT NULL,
  earned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, achievement_id)
);

-- Ban until field
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_until TIMESTAMPTZ;
