-- Migration 004: Analytics
CREATE TABLE analytics_events (
  id           BIGSERIAL PRIMARY KEY,
  event        VARCHAR(50) NOT NULL,
  user_id      UUID,
  character_id UUID,
  properties   JSONB NOT NULL DEFAULT '{}',
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (timestamp);

CREATE TABLE analytics_events_2025_q1 PARTITION OF analytics_events
  FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
CREATE TABLE analytics_events_2025_q2 PARTITION OF analytics_events
  FOR VALUES FROM ('2025-04-01') TO ('2025-07-01');
CREATE TABLE analytics_events_2025_q3 PARTITION OF analytics_events
  FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
CREATE TABLE analytics_events_2025_q4 PARTITION OF analytics_events
  FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');

CREATE INDEX idx_analytics_event ON analytics_events(event, timestamp DESC);
CREATE INDEX idx_analytics_user ON analytics_events(user_id, timestamp DESC);
