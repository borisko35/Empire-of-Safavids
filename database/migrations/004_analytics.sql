-- Migration 004: Analytics
CREATE TABLE analytics_events (
  id           BIGSERIAL,
  event        VARCHAR(50) NOT NULL,
  user_id      UUID,
  character_id UUID,
  properties   JSONB NOT NULL DEFAULT '{}',
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- В партиционированной таблице PK обязан включать ключ партиционирования
  PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE TABLE analytics_events_2025_q1 PARTITION OF analytics_events
  FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE analytics_events_2025_q2 PARTITION OF analytics_events
  FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE analytics_events_2025_q3 PARTITION OF analytics_events
  FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE analytics_events_2025_q4 PARTITION OF analytics_events
  FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

-- Catch-all: события вне 2025 года (иначе вставка упадёт)
CREATE TABLE analytics_events_default PARTITION OF analytics_events DEFAULT;

CREATE INDEX idx_analytics_event ON analytics_events(event, timestamp DESC);
CREATE INDEX idx_analytics_user ON analytics_events(user_id, timestamp DESC);
