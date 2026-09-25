-- ============================================================
-- 008: Профессии и прогрессия крафта — Empire of Safavids
-- ============================================================
-- Уровень крафта вычисляется из накопленного опыта на сервере;
-- клиентское значение больше не принимается.

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS crafting_xp BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN characters.crafting_xp IS 'Накопленный опыт ремёсел; уровень = 1 + crafting_xp / 100 (макс. 100)';
