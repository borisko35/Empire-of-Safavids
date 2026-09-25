-- ============================================================
-- 012: Торговля — Empire of Safavids
-- ============================================================
-- Контракты торговли между игроками и торговые посты

-- Активные торговые контракты (торговля между персонажами)
CREATE TABLE trade_contracts (
  id            UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  seller_id     UUID NOT NULL REFERENCES characters(id),
  buyer_id      UUID NOT NULL REFERENCES characters(id),
  items         JSONB NOT NULL DEFAULT '[]', -- [{itemId, qty, enhancement, price}]
  total_price   BIGINT NOT NULL,
  currency      VARCHAR(20) NOT NULL DEFAULT 'gold' CHECK (currency IN ('gold', 'gems')),
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'cancelled', 'expired')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
  completed_at  TIMESTAMPTZ
);

CREATE INDEX idx_trade_contracts_seller ON trade_contracts(seller_id, status);
CREATE INDEX idx_trade_contracts_buyer ON trade_contracts(buyer_id, status);
CREATE INDEX idx_trade_contracts_status ON trade_contracts(status, expires_at);

-- История торгов (завершённые и отменённые)
CREATE TABLE trade_history (
  id            UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  contract_id   UUID NOT NULL REFERENCES trade_contracts(id),
  seller_id     UUID NOT NULL REFERENCES characters(id),
  buyer_id      UUID NOT NULL REFERENCES characters(id),
  items         JSONB NOT NULL DEFAULT '[]',
  total_price   BIGINT NOT NULL,
  result        VARCHAR(20) NOT NULL CHECK (result IN ('completed', 'cancelled', 'expired')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trade_history_seller ON trade_history(seller_id);
CREATE INDEX idx_trade_history_buyer ON trade_history(buyer_id);

-- Торговые предложения (auction-style listings) — расширение аукциона
CREATE TABLE trade_listings (
  id            UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  seller_id     UUID NOT NULL REFERENCES characters(id),
  item_id       VARCHAR(50) NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1,
  enhancement   SMALLINT NOT NULL DEFAULT 0 CHECK (enhancement >= 0 AND enhancement <= 20),
  price         BIGINT NOT NULL,
  buyout_price  BIGINT,
  currency      VARCHAR(20) NOT NULL DEFAULT 'gold',
  status        VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'sold', 'cancelled', 'expired')),
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sold_at       TIMESTAMPTZ
);

CREATE INDEX idx_trade_listings_seller ON trade_listings(seller_id, status);
CREATE INDEX idx_trade_listings_item ON trade_listings(item_id, status);
CREATE INDEX idx_trade_listings_active ON trade_listings(status) WHERE status = 'active';
CREATE INDEX idx_trade_listings_expires ON trade_listings(expires_at) WHERE status = 'active';
