-- ============================================================
-- Empire of Safavids — Migration 023
-- Дедупликация character_quests + уникальный индекс
-- ============================================================
-- Проблема: у одного персонажа появлялось две строки одного квеста —
-- одна completed, вторая active с пустым progress {}. Навигатор
-- (client/src/app/world.ts refreshNavTarget) берёт первый активный
-- квест и упирается в его talk-цель, поэтому стрелка-навигатор
-- «залипала» на Глашатае, хотя квест уже был сдан.
--
-- Причина дублей: в 001_initial_schema.sql нет UNIQUE на
-- (character_id, quest_id), а accept() проверяет состояние выборкой —
-- при гонке (клик по NPC + фолбэк-вызов accept с клиента) строка
-- вставлялась дважды.
--
-- Оставляем лучшую строку: completed > active, затем более свежий
-- started_at. После ставим уникальный индекс, чтобы дубли не
-- появлялись больше никогда.
-- ============================================================

-- 1. Удаляем худшие дубликаты (остаётся одна строка на квест)
DELETE FROM character_quests q
USING character_quests k
WHERE q.character_id = k.character_id
  AND q.quest_id = k.quest_id
  AND (
    -- k лучше q: сданный квест важнее активного
    (k.status = 'completed' AND q.status <> 'completed')
    -- одинаковый статус: оставляем более свежий прогресс
    OR (k.status = q.status AND k.started_at > q.started_at)
    -- полное равенство: разрешаем по физической строке
    OR (k.status = q.status AND k.started_at = q.started_at AND k.ctid > q.ctid)
  );

-- 2. Уникальный индекс: одна строка квеста на персонажа
CREATE UNIQUE INDEX IF NOT EXISTS uq_character_quests_char_quest
  ON character_quests (character_id, quest_id);
