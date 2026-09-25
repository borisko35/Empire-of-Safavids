-- ============================================================
-- Empire of Safavids — Initial Database Schema
-- Migration: 001
-- ============================================================

-- Расширения (uuid-ossp отключён из-за mismatch версий: сервер PG16, библиотеки PG18)
-- Используем встроенную генерацию UUID через функцию generate_uuid_v4()
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- Для поиска по имени

-- Функция генерации UUID (замена uuid_generate_v4 из uuid-ossp)
CREATE OR REPLACE FUNCTION generate_uuid_v4() RETURNS uuid AS $$
  SELECT md5(random()::text || clock_timestamp()::text)::uuid;
$$ LANGUAGE sql IMMUTABLE;

-- ============================================================
-- Пользователи
-- ============================================================
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  username      VARCHAR(20) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_banned     BOOLEAN DEFAULT FALSE,
  ban_reason    TEXT,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);

-- ============================================================
-- Персонажи
-- ============================================================
CREATE TABLE characters (
  id           UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(24) UNIQUE NOT NULL,
  class        VARCHAR(30) NOT NULL,
  level        SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 100),
  experience   BIGINT NOT NULL DEFAULT 0,
  stats        JSONB NOT NULL DEFAULT '{}',
  hp           INTEGER NOT NULL,
  max_hp       INTEGER NOT NULL,
  mana         INTEGER NOT NULL,
  max_mana     INTEGER NOT NULL,
  stamina      INTEGER NOT NULL,
  max_stamina  INTEGER NOT NULL,
  position     JSONB NOT NULL DEFAULT '{"x":0,"y":0,"z":0}',
  region       VARCHAR(30) NOT NULL DEFAULT 'tabriz',
  guild_id     UUID,
  gold         BIGINT NOT NULL DEFAULT 100,
  karma        INTEGER NOT NULL DEFAULT 0,
  play_time    BIGINT NOT NULL DEFAULT 0, -- секунды
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_characters_user_id ON characters(user_id);
CREATE INDEX idx_characters_region ON characters(region);
CREATE INDEX idx_characters_name_trgm ON characters USING gin(name gin_trgm_ops);

-- ============================================================
-- Инвентарь
-- ============================================================
CREATE TABLE inventory (
  id           UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot_index   SMALLINT NOT NULL,
  item_id      VARCHAR(50) NOT NULL,
  quantity     INTEGER NOT NULL DEFAULT 1,
  enhancement  SMALLINT NOT NULL DEFAULT 0 CHECK (enhancement BETWEEN 0 AND 20),
  gem_slots    JSONB DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(character_id, slot_index)
);

CREATE INDEX idx_inventory_character ON inventory(character_id);

-- ============================================================
-- Гильдии
-- ============================================================
CREATE TABLE guilds (
  id          UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  name        VARCHAR(30) UNIQUE NOT NULL,
  description TEXT,
  leader_id   UUID NOT NULL REFERENCES characters(id),
  level       SMALLINT NOT NULL DEFAULT 1,
  territory   VARCHAR(30),
  gold        BIGINT NOT NULL DEFAULT 0,
  emblem      VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE guild_members (
  guild_id     UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  rank         VARCHAR(20) NOT NULL DEFAULT 'member',
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, character_id)
);

-- ============================================================
-- Квесты персонажей
-- ============================================================
CREATE TABLE character_quests (
  id           UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  quest_id     VARCHAR(50) NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'active', -- active, completed, failed
  progress     JSONB NOT NULL DEFAULT '{}',
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(character_id, quest_id)
);

CREATE INDEX idx_quests_character ON character_quests(character_id);

-- ============================================================
-- Торговля (Аукционный дом)
-- ============================================================
CREATE TABLE auction_listings (
  id           UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  seller_id    UUID NOT NULL REFERENCES characters(id),
  item_id      VARCHAR(50) NOT NULL,
  quantity     INTEGER NOT NULL DEFAULT 1,
  enhancement  SMALLINT NOT NULL DEFAULT 0,
  price        BIGINT NOT NULL,
  buyout_price BIGINT,
  expires_at   TIMESTAMPTZ NOT NULL,
  sold_at      TIMESTAMPTZ,
  buyer_id     UUID REFERENCES characters(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auction_item ON auction_listings(item_id) WHERE sold_at IS NULL;
CREATE INDEX idx_auction_seller ON auction_listings(seller_id);
CREATE INDEX idx_auction_expires ON auction_listings(expires_at) WHERE sold_at IS NULL;

-- ============================================================
-- Боевые логи (для аналитики)
-- ============================================================
CREATE TABLE combat_logs (
  id           BIGSERIAL,
  attacker_id  UUID NOT NULL,
  target_id    UUID NOT NULL,
  skill_id     VARCHAR(50),
  damage       INTEGER NOT NULL,
  is_critical  BOOLEAN NOT NULL DEFAULT FALSE,
  is_pvp       BOOLEAN NOT NULL DEFAULT FALSE,
  region       VARCHAR(30) NOT NULL,
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- В партиционированной таблице PK обязан включать ключ партиционирования
  PRIMARY KEY (id, logged_at)
) PARTITION BY RANGE (logged_at);

-- Партиция на текущий месяц
CREATE TABLE combat_logs_2024_01 PARTITION OF combat_logs
  FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- Catch-all: логи вне диапазона явных партиций (иначе вставка упадёт)
CREATE TABLE combat_logs_default PARTITION OF combat_logs DEFAULT;
