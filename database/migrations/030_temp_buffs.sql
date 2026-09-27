-- ============================================================
-- 030 — Временные бонусы
-- ============================================================
-- Расходники в каталоге обещают временный эффект («+5% к урону на
-- 10 минут», «бонус к силе на 5 минут»), но системы эффектов не было:
-- useItem применял только мгновенное восстановление HP/маны/стамины,
-- а бонусная часть описания не выполнялась никогда.
--
-- Хранение то же, что у лодок: персонаж + id эффекта, составной ключ.
-- Повторный приём того же эффекта продлевает время до max(было, стало),
-- а не затирает его более коротким.

CREATE TABLE IF NOT EXISTS character_buffs (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  buff_id      VARCHAR(60) NOT NULL,
  magnitude    REAL NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, buff_id)
);

-- Бой спрашивает «что сейчас активно» на каждый удар: индекс по времени
-- окончания отсекает протухшие строки до выборки.
CREATE INDEX IF NOT EXISTS idx_character_buffs_expires
  ON character_buffs (character_id, expires_at);
