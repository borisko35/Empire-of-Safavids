-- ============================================================
-- Migration 020: Fix missing columns in existing tables
-- Empire of Safavids
-- ============================================================

-- character_pets: добавляем id и nickname если нет
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'character_pets' AND column_name = 'id') THEN
    ALTER TABLE character_pets ADD COLUMN id SERIAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'character_pets' AND column_name = 'nickname') THEN
    ALTER TABLE character_pets ADD COLUMN nickname VARCHAR(100);
  END IF;
END $$;

-- character_reputation: добавляем reputation, rank_title; убираем старые points/rank
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'character_reputation' AND column_name = 'reputation') THEN
    ALTER TABLE character_reputation ADD COLUMN reputation INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'character_reputation' AND column_name = 'rank_title') THEN
    ALTER TABLE character_reputation ADD COLUMN rank_title VARCHAR(50) DEFAULT 'Незнакомец';
  END IF;
  -- Удаляем старые колонки если есть новые
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'character_reputation' AND column_name = 'reputation') THEN
    ALTER TABLE character_reputation DROP COLUMN IF EXISTS points;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'character_reputation' AND column_name = 'rank_title') THEN
    ALTER TABLE character_reputation DROP COLUMN IF EXISTS rank;
  END IF;
END $$;

-- character_mounts: добавляем custom_name если нет
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'character_mounts' AND column_name = 'custom_name') THEN
    ALTER TABLE character_mounts ADD COLUMN custom_name VARCHAR(30);
  END IF;
END $$;

