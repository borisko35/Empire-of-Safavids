-- ============================================================
-- Empire of Safavids — Skills, Professions, Name Change Migration
-- Migration: 022
-- ============================================================

-- Таблица профессий
CREATE TABLE IF NOT EXISTS professions (
  id          VARCHAR(50) PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  icon        VARCHAR(50),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Промо-данные профессий
INSERT INTO professions (id, name, description, icon) VALUES
  ('warrior', 'Воин', 'Мастер ближнего боя. Увеличивает урон оружием.', 'sword'),
  ('archer', 'Лучник', 'Мастер дальнего боя. Увеличивает точность и урон из лука.', 'bow'),
  ('merchant', 'Торговец', 'Уменьшает цены в магазине на 10%.', 'coins'),
  ('herbalist', 'Травник', 'Увеличивает эффективность зелий на 20%.', 'leaf'),
  ('blacksmith', 'Кузнец', 'Позволяет создавать оружие и броню.', 'hammer'),
  ('explorer', 'Исследователь', 'Открывает секретные локации на карте.', 'compass')
ON CONFLICT (id) DO NOTHING;

-- Таблица навыков персонажа
CREATE TABLE IF NOT EXISTS character_skills (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  skill_id     VARCHAR(50) NOT NULL,
  level        SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 50),
  xp           BIGINT NOT NULL DEFAULT 0,
  unlocked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(character_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_character_skills_char ON character_skills(character_id);

-- Таблица профессий персонажа
CREATE TABLE IF NOT EXISTS character_professions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  profession_id VARCHAR(50) NOT NULL REFERENCES professions(id) ON DELETE CASCADE,
  level        SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 100),
  xp           BIGINT NOT NULL DEFAULT 0,
  unlocked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(character_id, profession_id)
);

CREATE INDEX IF NOT EXISTS idx_char_professions_char ON character_professions(character_id);

-- Добавляем колонку last_name_change для отслеживания смены ника
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS last_name_change_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS profession_id VARCHAR(50) REFERENCES professions(id);

-- Таблица чат-логов (опционально, для сохранения истории)
CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGSERIAL,
  channel     VARCHAR(20) NOT NULL, -- world, region, guild, alliance, trade, auction, war, system
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id, created_at DESC);
