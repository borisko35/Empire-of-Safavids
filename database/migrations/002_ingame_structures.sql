-- Дополнительные таблицы для внутриигровых структур
-- Migration: 002

-- ============================================================
-- Крафтинг
-- ============================================================
CREATE TABLE crafting_jobs (
  id           UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  recipe_id    VARCHAR(50) NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completes_at TIMESTAMPTZ NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  CONSTRAINT chk_status CHECK (status IN ('in_progress', 'completed', 'failed'))
);

CREATE INDEX idx_crafting_character ON crafting_jobs(character_id);
CREATE INDEX idx_crafting_status ON crafting_jobs(status) WHERE status = 'in_progress';

-- ============================================================
-- Навыки крафтинга
-- ============================================================
CREATE TABLE crafting_skills (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  category     VARCHAR(30) NOT NULL,
  level        SMALLINT NOT NULL DEFAULT 1,
  experience   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, category)
);

-- ============================================================
-- Квесты персонажей (расширение)
-- ============================================================
ALTER TABLE character_quests ADD COLUMN IF NOT EXISTS
  fail_reason TEXT;

-- ============================================================
-- Репутация с фракциями
-- ============================================================
CREATE TABLE character_reputation (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  faction      VARCHAR(50) NOT NULL,
  points       INTEGER NOT NULL DEFAULT 0,
  rank         VARCHAR(20) NOT NULL DEFAULT 'neutral',
  PRIMARY KEY (character_id, faction)
);

-- ============================================================
-- Территории гильдий
-- ============================================================
CREATE TABLE guild_territories (
  territory_id VARCHAR(50) PRIMARY KEY,
  guild_id     UUID REFERENCES guilds(id) ON DELETE SET NULL,
  captured_at  TIMESTAMPTZ,
  defense_hp   INTEGER NOT NULL DEFAULT 100000,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Заполнить территории
INSERT INTO guild_territories (territory_id) VALUES
  ('territory_tabriz_market'),
  ('territory_isfahan_palace'),
  ('territory_caucasus_fortress'),
  ('territory_persian_gulf_port')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Навыки гильдий
-- ============================================================
CREATE TABLE guild_skills (
  guild_id  UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  skill_id  VARCHAR(50) NOT NULL,
  level     SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, skill_id)
);

-- ============================================================
-- Мировые боссы — расписание респавна
-- ============================================================
CREATE TABLE world_boss_schedule (
  boss_id       VARCHAR(50) PRIMARY KEY,
  last_killed   TIMESTAMPTZ,
  next_spawn    TIMESTAMPTZ,
  is_alive      BOOLEAN NOT NULL DEFAULT TRUE,
  kill_count    INTEGER NOT NULL DEFAULT 0
);

INSERT INTO world_boss_schedule (boss_id, next_spawn) VALUES
  ('world_boss_simurgh', NOW() + INTERVAL '7 days'),
  ('world_boss_rustam_reborn', NOW() + INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- ============================================================
-- История убийств мировых боссов
-- ============================================================
CREATE TABLE world_boss_kills (
  id           BIGSERIAL PRIMARY KEY,
  boss_id      VARCHAR(50) NOT NULL,
  guild_id     UUID REFERENCES guilds(id),
  top_damage   JSONB NOT NULL DEFAULT '[]', -- [{characterId, damage}]
  killed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Титулы персонажей
-- ============================================================
CREATE TABLE character_titles (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  title        VARCHAR(100) NOT NULL,
  earned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (character_id, title)
);

-- ============================================================
-- Почтовый ящик (для получения наград аукциона)
-- ============================================================
CREATE TABLE mailbox (
  id           UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  recipient_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  sender_id    UUID REFERENCES characters(id) ON DELETE SET NULL,
  subject      VARCHAR(100) NOT NULL,
  body         TEXT,
  gold         BIGINT NOT NULL DEFAULT 0,
  item_id      VARCHAR(50),
  item_qty     INTEGER DEFAULT 0,
  is_read      BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NOW() volatile — нельзя в предикате частичного индекса
CREATE INDEX idx_mailbox_recipient ON mailbox(recipient_id);
