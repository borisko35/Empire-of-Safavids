-- Несколько стеков одного предмета: без этого maxStack нельзя enforce'ить.
--
-- Зачем. Поле maxStack есть у 79 предметов (у 34 - 999, у 28 - 1) и оно нигде
-- не проверялось: addItems складывал количество без условия, и предмет с
-- maxStack 5 доходил до 5000 в ОДНОЙ строке. Цифры были украшением.
--
-- Почему одной проверкой здесь не обойтись. Уникальный ключ стека -
-- (character_id, item_id, enhancement): одна строка на предмет и заточку.
-- 3000 зелий с maxStack 20 - это 150 стеков, а схема допускает только один.
-- То есть данные предполагают возможность, которой в базе нет.
--
-- stack_index добавляется в ключ. Нумерация с нуля; существующие строки
-- получают 0 и остаются валидными без переноса данных.
ALTER TABLE character_items
  ADD COLUMN IF NOT EXISTS stack_index INT NOT NULL DEFAULT 0
    CHECK (stack_index >= 0);

-- Старый ключ обязан быть снят ДО создания нового: на тех же столбцах
-- осталось бы два уникальных ограничения, и второе_stack вставить было бы
-- нельзя.
ALTER TABLE character_items
  DROP CONSTRAINT IF EXISTS character_items_char_item_enh_key;

ALTER TABLE character_items
  ADD CONSTRAINT character_items_char_item_enh_stack_key
  UNIQUE (character_id, item_id, enhancement, stack_index);

-- Заполнение стеков ищет среди неполных по (предмет, заточка). Без индекса
-- при большом инвентаре это перебор строк.
CREATE INDEX IF NOT EXISTS idx_character_items_stack_fill
  ON character_items (character_id, item_id, enhancement, quantity);
