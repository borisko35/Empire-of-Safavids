-- ============================================================
-- 007: Унификация инвентаря — Empire of Safavids
-- ============================================================
-- Единое хранилище предметов — character_items (стеки).
-- Заточка является частью ключа стека: предмет +0 и тот же предмет +5
-- живут в разных строках. Экипированные слоты ссылаются на предмет
-- с его уровнем заточки; при надевании предмет списывается из сумки,
-- при снятии — возвращается.

-- Уровень заточки входит в уникальный ключ стека
ALTER TABLE character_items
  ADD COLUMN IF NOT EXISTS enhancement INT NOT NULL DEFAULT 0
    CHECK (enhancement >= 0 AND enhancement <= 20);

ALTER TABLE character_items
  DROP CONSTRAINT IF EXISTS character_items_character_id_item_id_key;

ALTER TABLE character_items
  ADD CONSTRAINT character_items_char_item_enh_key
  UNIQUE (character_id, item_id, enhancement);

-- Списание допускает временный ноль внутри транзакции: consume-логика
-- обнуляет стек и в том же выражении удаляет опустевшую строку.
ALTER TABLE character_items
  DROP CONSTRAINT IF EXISTS character_items_quantity_check;
ALTER TABLE character_items
  ADD CONSTRAINT character_items_quantity_check CHECK (quantity >= 0);

-- Экипированные слоты (по одному на слот персонажа)
CREATE TABLE IF NOT EXISTS character_equipment (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot         TEXT NOT NULL CHECK (slot IN ('weapon', 'armor', 'accessory')),
  item_id      TEXT NOT NULL,
  enhancement  INT  NOT NULL DEFAULT 0 CHECK (enhancement >= 0 AND enhancement <= 20),
  equipped_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, slot)
);

-- Перенос накоплений из legacy-таблицы inventory (миграции 001)
INSERT INTO character_items (character_id, item_id, quantity, enhancement)
SELECT i.character_id, i.item_id, SUM(i.quantity), MAX(i.enhancement)
FROM inventory i
JOIN characters c ON c.id = i.character_id
GROUP BY i.character_id, i.item_id
HAVING SUM(i.quantity) > 0
ON CONFLICT (character_id, item_id, enhancement)
DO UPDATE SET quantity = character_items.quantity + EXCLUDED.quantity;

-- Legacy-таблица больше не используется ни одним сервисом
DROP TABLE IF EXISTS inventory;
