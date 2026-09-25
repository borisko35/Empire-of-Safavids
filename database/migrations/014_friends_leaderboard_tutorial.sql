-- ============================================================
-- 014_Friends, Leaderboard, Tutorial — Empire of Safavids
-- ============================================================

-- ── Система друзей ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friends (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, accepted, blocked
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, friend_id)
);
CREATE INDEX idx_friends_friend ON friends(friend_id, status);
CREATE INDEX idx_friends_user ON friends(user_id, status);

-- ── Рейтинги ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leaderboard (
  character_id  UUID PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  level         INT NOT NULL DEFAULT 1,
  experience    BIGINT NOT NULL DEFAULT 0,
  pvp_rating    INT NOT NULL DEFAULT 1000,
  pvp_wins      INT NOT NULL DEFAULT 0,
  pvp_losses    INT NOT NULL DEFAULT 0,
  monsters_killed BIGINT NOT NULL DEFAULT 0,
  quests_completed INT NOT NULL DEFAULT 0,
  playtime_seconds BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_leaderboard_level ON leaderboard(level DESC, experience DESC);
CREATE INDEX idx_leaderboard_exp ON leaderboard(experience DESC);
CREATE INDEX idx_leaderboard_pvp ON leaderboard(pvp_rating DESC);
CREATE INDEX idx_leaderboard_kills ON leaderboard(monsters_killed DESC);

-- ── Прогресс туториала ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutorial_progress (
  character_id  UUID PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  current_step  INT NOT NULL DEFAULT 0,
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
