-- ============================================================
-- 009: Игровые серверы (шарды) — Empire of Safavids
-- ============================================================
-- Персонаж привязан к игровому серверу при создании. Существующие
-- персонажи остаются на сервере по умолчанию.

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS server_id TEXT NOT NULL DEFAULT 'isfahan';

CREATE INDEX IF NOT EXISTS idx_characters_server ON characters(server_id);
