-- ============================================================
-- 011: Партии — Empire of Safavids
-- ============================================================
-- Партии: группа из 2-5 игроков для совместного прохождения контента

CREATE TABLE parties (
  id          UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  leader_id   UUID NOT NULL REFERENCES characters(id),
  max_size    SMALLINT NOT NULL DEFAULT 5 CHECK (max_size BETWEEN 2 AND 5),
  status      VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disbanded')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_parties_leader ON parties(leader_id);
CREATE INDEX idx_parties_status ON parties(status);

-- Участники партии
CREATE TABLE party_members (
  party_id     UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  role         VARCHAR(20) NOT NULL DEFAULT 'member'
    CHECK (role IN ('leader', 'member')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (party_id, character_id)
);

CREATE INDEX idx_party_members_party ON party_members(party_id);
CREATE INDEX idx_party_members_character ON party_members(character_id);

-- Прогресс партии: общий счётчик убийств, общий опыт
CREATE TABLE party_progress (
  party_id       UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  total_kills    INTEGER NOT NULL DEFAULT 0,
  total_exp      BIGINT NOT NULL DEFAULT 0,
  last_activity  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (party_id)
);

-- Приглашения в партию
CREATE TABLE party_invites (
  id           UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  party_id     UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  inviter_id   UUID NOT NULL REFERENCES characters(id),
  target_id    UUID NOT NULL REFERENCES characters(id),
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  UNIQUE(party_id, target_id)
);

CREATE INDEX idx_party_invites_target ON party_invites(target_id, status);
CREATE INDEX idx_party_invites_party ON party_invites(party_id);
