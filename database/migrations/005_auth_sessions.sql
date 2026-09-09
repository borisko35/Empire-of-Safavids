-- Migration 005: Auth sessions table
CREATE TABLE user_sessions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(36) UNIQUE NOT NULL,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user    ON user_sessions(user_id);
CREATE INDEX idx_sessions_token   ON user_sessions(token);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);

-- Автоочистка истекших сессий (запускать периодически)
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
  DELETE FROM user_sessions WHERE expires_at < NOW();
$$ LANGUAGE sql;

-- История входов
CREATE TABLE login_history (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address INET,
  user_agent TEXT,
  success    BOOLEAN NOT NULL,
  fail_reason VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_login_history_user ON login_history(user_id, created_at DESC);
