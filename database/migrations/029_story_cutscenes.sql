-- ============================================================
-- 029 — Сюжет: главы и кат-сцены
-- ============================================================
-- Таблица просмотренных сцен нужна, чтобы не показывать кат-сцену
-- второй раз при повторном выполнении квеста (ежедневные задания
-- выполняются много раз) и чтобы «пропустить» тоже засчитывалось.

CREATE TABLE IF NOT EXISTS character_cutscenes (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  cutscene_id   VARCHAR(100) NOT NULL,
  watched_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (character_id, cutscene_id)
);
