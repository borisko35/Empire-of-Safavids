-- ============================================================
-- Миграция 079: засады на караваны
-- ============================================================
-- ЗАЧЕМ. «Шёлковый путь» из очереди идей карты (ROADMAP §3, пункт 4):
-- грабёж караванов другими игроками. Торговля была, а караван шёл в
-- одиночку: весь риск лежал на том, кто принял контракт, и на дороге не
-- было никого, кроме разбойников.
--
-- ЧТО ЗДЕСЬ. Одна строка на попытку засады: кто поднял, на чей караван,
-- по какому договору и чем кончилось. Исходов четыре — и важна не сама
-- таблица, а переходы:
--
--   in_progress → won     конвой выбит, часть груза забрана
--   in_progress → failed  конвой ушёл или срок вышел, гонорар сгорел
--
-- Почему UNIQUE на (caravan_owner_id, contract_id), а не на нападавшего:
-- один караван грабят один раз. Иначе толпа собирает конвой за минуту и
-- делит добычу между собой, и засада перестаёт быть состязанием.
--
-- Ссылка на trade_caravans по составному ключу, а не по id: у trade_caravans
-- нет своего идентификатора, первичным там (owner_id, contract_id). Ссылка
-- по выдуманному id была бы ссылкой в пустоту, и каскад не сработал бы.
CREATE TABLE IF NOT EXISTS caravan_ambushes (
  id                UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  ambusher_id       UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  caravan_owner_id  UUID NOT NULL,
  contract_id       VARCHAR(100) NOT NULL,
  -- in_progress | won | failed
  outcome           TEXT NOT NULL DEFAULT 'in_progress',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ,
  CONSTRAINT caravan_ambushes_outcome_known
    CHECK (outcome IN ('in_progress', 'won', 'failed')),
  CONSTRAINT caravan_ambushes_finished_with_outcome
    CHECK ((outcome = 'in_progress') = (finished_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_caravan_ambushes_once
  ON caravan_ambushes (caravan_owner_id, contract_id);

CREATE INDEX IF NOT EXISTS idx_caravan_ambushes_ambusher
  ON caravan_ambushes (ambusher_id, started_at DESC);

-- Главный вопрос панели «кто на дороге»: караваны в пути плюс признак,
-- что этот караван уже пробовали засадить. Именно EXISTS, а не поле в
-- trade_caravans: засада живёт своей жизнью и не должна тащить на себе
-- колонку, которую читают только из одного запроса.
CREATE INDEX IF NOT EXISTS idx_trade_caravans_in_transit
  ON trade_caravans (status, started_at DESC);