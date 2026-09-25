-- ============================================================
-- 010: Данжи — Empire of Safavids
-- ============================================================
-- Сессии данжей, участники, прогресс боссов

-- Сессия данжа: группа игроков заходит вместе
CREATE TABLE dungeon_sessions (
  id            UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  dungeon_id    VARCHAR(50) NOT NULL,
  difficulty    VARCHAR(20) NOT NULL CHECK (difficulty IN ('normal', 'hard', 'heroic', 'mythic')),
  leader_id     UUID NOT NULL REFERENCES characters(id),
  max_size      SMALLINT NOT NULL DEFAULT 5,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  status        VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'abandoned')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dungeon_sessions_leader ON dungeon_sessions(leader_id);
CREATE INDEX idx_dungeon_sessions_status ON dungeon_sessions(status);

-- Участники сессии данжа
CREATE TABLE dungeon_members (
  session_id   UUID NOT NULL REFERENCES dungeon_sessions(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  role         VARCHAR(20) NOT NULL DEFAULT 'member'
    CHECK (role IN ('leader', 'member')),
  last_position JSONB NOT NULL DEFAULT '{"x":0,"y":0,"z":0}',
  PRIMARY KEY (session_id, character_id)
);

CREATE INDEX idx_dungeon_members_session ON dungeon_members(session_id);
CREATE INDEX idx_dungeon_members_character ON dungeon_members(character_id);

-- Прогресс по монстрам внутри данжа
CREATE TABLE dungeon_boss_progress (
  session_id   UUID NOT NULL REFERENCES dungeon_sessions(id) ON DELETE CASCADE,
  monster_id   VARCHAR(50) NOT NULL,
  damage_dealt BIGINT NOT NULL DEFAULT 0,
  killed       BOOLEAN NOT NULL DEFAULT FALSE,
  killed_at    TIMESTAMPTZ,
  PRIMARY KEY (session_id, monster_id)
);

-- Статистика прохождения данжей персонажем
CREATE TABLE dungeon_history (
  id            UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  character_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  dungeon_id    VARCHAR(50) NOT NULL,
  difficulty    VARCHAR(20) NOT NULL,
  result        VARCHAR(20) NOT NULL CHECK (result IN ('completed', 'failed', 'abandoned')),
  monsters_killed INTEGER NOT NULL DEFAULT 0,
  bosses_killed INTEGER NOT NULL DEFAULT 0,
  duration_sec  INTEGER,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dungeon_history_character ON dungeon_history(character_id);
CREATE INDEX idx_dungeon_history_dungeon ON dungeon_history(dungeon_id, result);

-- Запас входа в данж: лимит на количество входов в день
CREATE TABLE dungeon_attempts (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  dungeon_id   VARCHAR(50) NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  reset_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (character_id, dungeon_id)
);
