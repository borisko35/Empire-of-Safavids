-- ============================================================
-- 028 — Лодки и рыбалка
-- ============================================================
-- Лодки повторяют механику коней (character_mounts, MountSystem):
-- покупаются один раз, живут отдельным каталогом BOATS, активна одна.
-- Отличие от коней — усталость: лодка может наловить catchLimit рыбы
-- подряд, потом её надо разогнать (войти и выйти), иначе это бесконечный
-- фарм с бесконечной рыбой.

CREATE TABLE IF NOT EXISTS character_boats (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  boat_id       VARCHAR(100) NOT NULL,
  is_active     BOOLEAN DEFAULT FALSE,
  total_catches INTEGER DEFAULT 0,
  fatigue       INTEGER DEFAULT 0,
  acquired_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (character_id, boat_id)
);

CREATE INDEX IF NOT EXISTS idx_character_boats_active
  ON character_boats (character_id, is_active);

-- Активной может быть только одна лодка на персонажа. Без этого
-- ограничения можно было бы «разогнать» несколько лодок разом.
CREATE UNIQUE INDEX IF NOT EXISTS uq_character_boats_one_active
  ON character_boats (character_id) WHERE is_active = TRUE;
