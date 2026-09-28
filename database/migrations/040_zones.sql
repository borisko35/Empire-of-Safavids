-- ============================================================
-- Зоны внутри регионов: колонка zone в characters
-- ============================================================
-- Каждый регион разделён на зоны с прямоугольными границами.
-- Зона определяет уровень опасности, набор монстров и квестов.
-- Колонка zone хранит id зоны (например, "tabriz_center").

ALTER TABLE characters ADD COLUMN IF NOT EXISTS zone VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_characters_zone ON characters(zone);

-- Заполняем зону для существующих персонажей по их позиции
UPDATE characters c
SET zone = z.id
FROM (
  SELECT c2.id,
    COALESCE(
      (SELECT z.id FROM (
        SELECT 'tabriz_center' AS id, -50 AS x1, -50 AS z1, 50 AS x2, 50 AS z2
        UNION ALL SELECT 'tabriz_outskirts', -150, -150, 150, 150
        UNION ALL SELECT 'tabriz_north', -200, 50, 200, 200
        UNION ALL SELECT 'isfahan_bazaar', -30, -30, 30, 30
        UNION ALL SELECT 'isfahan_gates', -100, -100, 100, 100
        UNION ALL SELECT 'isfahan_south', -150, -200, 150, -100
        UNION ALL SELECT 'shiraz_gardens', 60, -90, 120, -30
        UNION ALL SELECT 'shiraz_walls', 40, -110, 140, -10
        UNION ALL SELECT 'shiraz_east', 140, -150, 250, 0
        UNION ALL SELECT 'caucasus_pass', 30, 110, 90, 170
        UNION ALL SELECT 'caucasus_fortress', 10, 80, 50, 120
        UNION ALL SELECT 'caucasus_peaks', 90, 170, 150, 230
        UNION ALL SELECT 'mesopotamia_river', 170, 20, 230, 80
        UNION ALL SELECT 'mesopotamia_ruins', 230, 80, 290, 140
        UNION ALL SELECT 'mesopotamia_frontier', 140, 0, 170, 20
        UNION ALL SELECT 'khorasan_oasis', 120, 170, 180, 230
        UNION ALL SELECT 'khorasan_caravanserai', 180, 230, 240, 290
        UNION ALL SELECT 'khorasan_east', 240, 290, 300, 350
        UNION ALL SELECT 'persian_gulf_harbor', -90, -200, -30, -140
        UNION ALL SELECT 'persian_gulf_waters', -150, -260, 30, -140
        UNION ALL SELECT 'persian_gulf_islands', -200, -300, -100, -200
      ) z WHERE (c2.position->>'x')::float >= z.x1 AND (c2.position->>'x')::float <= z.x2
        AND (c2.position->>'z')::float >= z.z1 AND (c2.position->>'z')::float <= z.z2
        LIMIT 1),
      'unknown'
    ) AS id
  FROM characters c2
) z WHERE c.id = z.id;
