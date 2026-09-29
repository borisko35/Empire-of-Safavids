// Миграция 044: боевая стойка персонажа.
//
// ЗАЧЕМ. Стойка нужна, чтобы переключение боевых стилей было настоящей
// механикой, а не картинкой в интерфейсе. Без отдельного поля на сервере
// стойка была бы только визуальной: любой пакет от клиента мог бы притвориться
// любой стойкой, а перезаход обнулял бы выбор.
//
// Хранится в characters, потому что стойка - это часть персонажа, а не
// временное состояние боя (как блок или рывок, которые живут в памяти).
// По умолчанию 'balanced' - тот же обычный бой, что был до появления стоек.
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS combat_stance TEXT NOT NULL DEFAULT 'balanced';

-- Значения ограничены списком: иначе в базу можно было бы записать что
-- угодно, и сервер не знал бы, что с этим делать.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'characters_combat_stance_check') THEN
    ALTER TABLE characters ADD CONSTRAINT characters_combat_stance_check
      CHECK (combat_stance IN ('balanced', 'sickle_dance', 'shah_shield', 'mounted_archery'));
  END IF;
END $$;
