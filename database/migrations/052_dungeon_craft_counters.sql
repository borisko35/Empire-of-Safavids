-- ============================================================
-- Миграция 052: счётчики подземелий и крафта
-- ============================================================
-- ЗАЧЕМ. У трёх достижений было написано «пройти первое подземелье»,
-- «скрафтить первый предмет» и «скрафтить 50 предметов», и условия не
-- было ни у одного: счётчиков не существовало. Все три были в списке
-- «пока не считается», хотя подземелья и крафт в игре работают.
--
-- Оба счётчика живут в leaderboard рядом с убийствами, парированиями,
-- стихами и победами в шахматах. Своя таблица означала бы третье место
-- учёта, где счётчик легко забыть внести в COUNTER_COLUMN, и
-- достижение молча перестало бы выдаваться.
--
-- Комментарии строго '--': в .sql-файле '//' не комментарий, и такой файл
-- роняет сайт целиком на этапе миграции.
ALTER TABLE leaderboard
  ADD COLUMN IF NOT EXISTS dungeons_cleared INT NOT NULL DEFAULT 0;

ALTER TABLE leaderboard
  ADD COLUMN IF NOT EXISTS items_crafted INT NOT NULL DEFAULT 0;

-- Счётчики неотрицательны: пройденное подземелье и скрафченный предмет не
-- могут быть отняты. Верхние границы - грубый предохранитель от ошибки,
-- при которой одна и та же событие писалась бы дважды.
--
-- Границы взяты с запасом, а не «по максимуму в игре»: если бы они были
-- точными, любая ошибка с двойным начислением делала бы достижение
-- недостижимым навсегда, и чинить пришлось бы вручную. 10000 подземелий и
-- 100000 предметов недостижимы, но и не помешают выдать достижение.
ALTER TABLE leaderboard
  DROP CONSTRAINT IF EXISTS leaderboard_dungeons_cleared_range;

ALTER TABLE leaderboard
  ADD CONSTRAINT leaderboard_dungeons_cleared_range
  CHECK (dungeons_cleared >= 0 AND dungeons_cleared <= 10000);

ALTER TABLE leaderboard
  DROP CONSTRAINT IF EXISTS leaderboard_items_crafted_range;

ALTER TABLE leaderboard
  ADD CONSTRAINT leaderboard_items_crafted_range
  CHECK (items_crafted >= 0 AND items_crafted <= 100000);
