-- ============================================================
-- Migration 015: Guilds, Achievements, Daily Tasks, Reputation
-- Empire of Safavids
-- ============================================================

-- ── ГИЛЬДИИ ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guilds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) UNIQUE NOT NULL,
  tag VARCHAR(10) UNIQUE NOT NULL,
  leader_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  description TEXT DEFAULT '',
  level INTEGER DEFAULT 1,
  experience BIGINT DEFAULT 0,
  gold BIGINT DEFAULT 0,
  max_members INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  banner_color VARCHAR(7) DEFAULT '#C9A84C'
);

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  rank VARCHAR(20) DEFAULT 'member',
 贡献_points INTEGER DEFAULT 0,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (guild_id, character_id)
);

CREATE TABLE IF NOT EXISTS guild_logs (
  id SERIAL PRIMARY KEY,
  guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  actor_name VARCHAR(50),
  target_name VARCHAR(50),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guild_members_char ON guild_members(character_id);

-- ── ДОСТИЖЕНИЯ ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS achievements (
  id VARCHAR(100) PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  title_ru VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  description_ru TEXT NOT NULL,
  category VARCHAR(50) NOT NULL,
  icon VARCHAR(50) DEFAULT '⭐',
  reward_gold INTEGER DEFAULT 0,
  reward_experience INTEGER DEFAULT 0,
  reward_title VARCHAR(100),
  reward_item_id VARCHAR(100),
  hidden BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS character_achievements (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  achievement_id VARCHAR(100) NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (character_id, achievement_id)
);

-- ── ЕЖЕДНЕВНЫЕ / ЕЖЕНЕДЕЛЬНЫЕ ЗАДАЧИ ─────────────────────────
CREATE TABLE IF NOT EXISTS daily_tasks (
  id VARCHAR(100) PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  title_ru VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  description_ru TEXT NOT NULL,
  task_type VARCHAR(50) NOT NULL,
  target VARCHAR(100) NOT NULL,
  required_count INTEGER DEFAULT 1,
  reward_gold INTEGER DEFAULT 0,
  reward_experience INTEGER DEFAULT 0,
  reward_item_id VARCHAR(100),
  reward_item_qty INTEGER DEFAULT 1,
  min_level INTEGER DEFAULT 1,
  region VARCHAR(50),
  reset_hours INTEGER DEFAULT 24
);

CREATE TABLE IF NOT EXISTS character_daily_progress (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  task_id VARCHAR(100) NOT NULL REFERENCES daily_tasks(id) ON DELETE CASCADE,
  current_count INTEGER DEFAULT 0,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  last_reset TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (character_id, task_id)
);

-- ── РЕПУТАЦИЯ С ФРАКЦИЯМИ ───────────────────────────────────
CREATE TABLE IF NOT EXISTS character_reputation (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  faction VARCHAR(50) NOT NULL,
  reputation INTEGER DEFAULT 0,
  rank_title VARCHAR(50) DEFAULT 'Незнакомец',
  PRIMARY KEY (character_id, faction)
);

-- ── ГИЛЬДЕЙСКИЙ БАНК ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guild_bank (
  id SERIAL PRIMARY KEY,
  guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  item_id VARCHAR(100) NOT NULL,
  quantity INTEGER DEFAULT 1,
  deposited_by UUID REFERENCES characters(id),
  deposited_at TIMESTAMPTZ DEFAULT NOW()
);
