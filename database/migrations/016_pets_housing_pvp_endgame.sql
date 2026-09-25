-- ============================================================
-- Migration 016: Pets, Housing, PvP Arena, End-game
-- Empire of Safavids
-- ============================================================

-- ── ПИТОМЦЫ ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pets (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  name_ru VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL,
  rarity VARCHAR(30) DEFAULT 'common',
  base_strength INTEGER DEFAULT 0,
  base_agility INTEGER DEFAULT 0,
  base_intelligence INTEGER DEFAULT 0,
  ability_name VARCHAR(100),
  ability_name_ru VARCHAR(100),
  ability_damage INTEGER DEFAULT 0,
  ability_cooldown INTEGER DEFAULT 10,
  model_path VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS character_pets (
  id SERIAL PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  pet_id VARCHAR(100) NOT NULL REFERENCES pets(id),
  nickname VARCHAR(100),
  level INTEGER DEFAULT 1,
  experience INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT FALSE,
  acquired_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_char_pets ON character_pets(character_id);

-- ── ДОМ / НЕДВИЖИМОСТЬ ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS player_houses (
  id SERIAL PRIMARY KEY,
  character_id UUID UNIQUE NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  region VARCHAR(50) NOT NULL,
  house_type VARCHAR(50) DEFAULT 'cottage',
  level INTEGER DEFAULT 1,
  decoration_points INTEGER DEFAULT 0,
  storage_slots INTEGER DEFAULT 20,
  craft_bonus DECIMAL(3,2) DEFAULT 0.00,
  purchased_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS house_decorations (
  id SERIAL PRIMARY KEY,
  house_id INTEGER NOT NULL REFERENCES player_houses(id) ON DELETE CASCADE,
  item_id VARCHAR(100) NOT NULL,
  slot_x INTEGER DEFAULT 0,
  slot_y INTEGER DEFAULT 0,
  placed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── PvP АРЕНА ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pvp_arena (
  id SERIAL PRIMARY KEY,
  season INTEGER DEFAULT 1,
  player1_id UUID NOT NULL REFERENCES characters(id),
  player2_id UUID REFERENCES characters(id),
  winner_id UUID REFERENCES characters(id),
  mode VARCHAR(20) DEFAULT '1v1',
  player1_rating INTEGER DEFAULT 1000,
  player2_rating INTEGER DEFAULT 1000,
  rating_change INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pvp_rankings (
  character_id UUID PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  season INTEGER DEFAULT 1,
  rating INTEGER DEFAULT 1000,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  streak INTEGER DEFAULT 0,
  best_streak INTEGER DEFAULT 0,
  tier VARCHAR(20) DEFAULT 'bronze'
);

CREATE INDEX IF NOT EXISTS idx_pvp_rankings_rating ON pvp_rankings(rating DESC);

-- ── КОМБО-УДАРЫ / ПАРАД ────────────────────────────────────
CREATE TABLE IF NOT EXISTS combat_logs (
  id SERIAL PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  combo_count INTEGER DEFAULT 0,
  perfect_blocks INTEGER DEFAULT 0,
  max_combo INTEGER DEFAULT 0,
  total_damage BIGINT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── УЛУЧШЕНИЕ ПРЕДМЕТОВ (ENCHANTS) ─────────────────────────
CREATE TABLE IF NOT EXISTS item_enchants (
  id SERIAL PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_slot VARCHAR(50) NOT NULL,
  enchant_type VARCHAR(50) NOT NULL,
  enchant_level INTEGER DEFAULT 1,
  bonus_value INTEGER DEFAULT 0,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── ТОРГОВЫЕ КАРАВАНЫ ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_caravans (
  id SERIAL PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  origin_region VARCHAR(50) NOT NULL,
  dest_region VARCHAR(50) NOT NULL,
  item_id VARCHAR(100) NOT NULL,
  quantity INTEGER DEFAULT 1,
  base_value INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  eta_minutes INTEGER DEFAULT 30,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ── БЕСКОНЕЧНАЯ БАШНЯ ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS endless_tower (
  id SERIAL PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  max_floor INTEGER DEFAULT 0,
  current_floor INTEGER DEFAULT 1,
  best_time_seconds INTEGER DEFAULT 0,
  runs_total INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
