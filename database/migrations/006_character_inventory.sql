-- ============================================================
-- 006: Инвентарь персонажей — Empire of Safavids
-- ============================================================
-- Предметы хранятся стеками: уникальность по (персонаж, предмет),
-- количество наращивается при повторном выпадении.

CREATE TABLE IF NOT EXISTS character_items (
  id          BIGSERIAL PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL,
  quantity    INT  NOT NULL DEFAULT 1 CHECK (quantity > 0),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (character_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_character_items_char ON character_items(character_id);
