-- ============================================================
-- Зал славы: победитель мирового босса отдельной колонкой
-- ============================================================
-- ЧТО БЫЛО. Маршрут /api/hall-of-fame/bosses считает победы по персонажу и
-- писал «SELECT k.character_id», а в таблице победитель лежал только внутри
-- JSONB top_damage. PostgreSQL отвечал «column k.character_id does not exist»,
-- панель «Зал славы» получала 500 и не показывала никогда ни одного убийцы.
--
-- ЧТО ДЕЛАЕМ. Заводим колонку, переносим в неё победителя из JSONB (старые
-- строки) и пишем её при новом убийстве — в WorldEventSystem.recordKill.
-- Старые строки остаются в таблице: таблица — это история, терять её ради
-- чистоты схемы нельзя.

ALTER TABLE world_boss_kills
  ADD COLUMN IF NOT EXISTS character_id UUID REFERENCES characters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_world_boss_kills_character ON world_boss_kills(character_id);

-- Перенос из JSONB. Значение сверяется с форматом UUID ДО приведения типа:
-- кривая запись в top_damage оборвала бы миграцию целиком, и база осталась
-- бы без колонки, то есть с тем же500.
UPDATE world_boss_kills k
SET character_id = v.cid
FROM (
  SELECT id,
         CASE
           WHEN top_damage->0->>'characterId'
             ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           THEN (top_damage->0->>'characterId')::uuid
         END AS cid
  FROM world_boss_kills
  WHERE character_id IS NULL
) v
WHERE k.id = v.id
  AND k.character_id IS NULL;
