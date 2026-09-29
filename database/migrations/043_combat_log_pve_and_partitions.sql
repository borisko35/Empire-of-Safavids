-- ============================================================
-- Журнал боёв: урон по монстрам и партиции на 2026 год
-- ============================================================
-- ЧТО БЫЛО. Таблица combat_logs создана ещё в первой миграции, со всей
-- схемой: атакующий, цель, навык, урон, крит, признак PvP, регион, время.
-- За все месяцы в неё не записал НИКТО - она оставалась пустой.
--
-- ПОЧЕМУ НЕ ПРОСТО ЗАПИСАТЬ. Колонка target_id объявлена UUID NOT NULL.
-- У игрока UUID есть, а у монстра идентификатор инстанса такой:
--   mob_bandit_scout_1756500000000_a3f9x
-- То есть в существующую таблицу урон по монстру не помещается физически.
-- Колонка is_pvp при этом была заведена - видно, что PvE задумывался, но
-- схема под него не сложилась, и дело остановилось на пустой таблице.
--
-- ЧТО ДЕЛАЕМ.
--   1. target_id становится nullable: у монстра своего UUID нет.
--   2. Появляются target_instance (мирокаб монстра), target_kind
--      ('player' | 'monster') и target_name - чтобы журнал читался глазами.
--   3. Проверка: цель должна быть названа хоть как-то. Иначе в журнале
--      появятся строки "кто-то ударил неизвестно кого", и разбирать их
--      будет нечем.
--   4. Индексы под разбор споров. Их не было вовсе: единственный индекс
--      таблицы - составной первичный ключ (id, logged_at), и поиск по
--      персонажу шёл полным перебором. На большой таблице вопрос «покажи
--      бои вот этого игрока» превращался в минутный ответ.
--   5. Партиции на 2026 год. Объявлена была одна, за январь 2024, плюс
--      ловушка DEFAULT, в которую сваливался весь новый урон. Проверено на
--      боевой базе: строк ноль, поэтому прикрепить партиции можно, не
--      перенося данные.
--
-- ПРО ДРУГИЕ ТАБЛИЦЫ. У analytics_events та же конструкция и та же
-- ловушка, но в неё УЖЕ лежат события 2026 года, и Postgres не даст
-- прикрепить партицию поверх непустой ловушки. Там сначала нужно вынести
-- старые строки из DEFAULT - это отдельная работа с данными, и молча
-- трогать её нельзя.

-- ── 1–3. Цель умеет быть монстром ──

ALTER TABLE combat_logs
  ADD COLUMN IF NOT EXISTS target_instance VARCHAR(80),
  ADD COLUMN IF NOT EXISTS target_kind VARCHAR(20) NOT NULL DEFAULT 'player',
  ADD COLUMN IF NOT EXISTS target_name VARCHAR(80);

ALTER TABLE combat_logs
  ALTER COLUMN target_id DROP NOT NULL;

-- Postgres не умеет NOT VALID для CHECK на партиционированной таблице, а
-- проверить все таблицы заново незачем: строк всё равно ноль. Проверка
-- всё равно нужна - иначе в журнал просочится удар по неизвестной цели и
-- разбирать такой бой будет нечем.
ALTER TABLE combat_logs
  DROP CONSTRAINT IF EXISTS combat_logs_target_known;

ALTER TABLE combat_logs
  ADD CONSTRAINT combat_logs_target_known
  CHECK (target_id IS NOT NULL OR target_instance IS NOT NULL);

-- Значение из ограничения перечисления, а не свободный текст: иначе через
-- год в журнале появятся "PLAYER" и "игрок", и сводка по ним развалится.
ALTER TABLE combat_logs
  DROP CONSTRAINT IF EXISTS combat_logs_target_kind_known;

ALTER TABLE combat_logs
  ADD CONSTRAINT combat_logs_target_kind_known
  CHECK (target_kind IN ('player', 'monster'));

-- ── 4. Индексы под разбор споров ──

CREATE INDEX IF NOT EXISTS idx_combat_logs_attacker
  ON combat_logs (attacker_id, logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_combat_logs_target
  ON combat_logs (target_id, logged_at DESC);

-- Поиск «кто бил этого монстра» - мирокаб не UUID, поэтому обычный индекс по
-- колонке target_id его не накроет.
CREATE INDEX IF NOT EXISTS idx_combat_logs_instance
  ON combat_logs (target_instance, logged_at DESC)
  WHERE target_instance IS NOT NULL;

-- ── 5. Партиции на 2026–2027 годы ──

CREATE TABLE IF NOT EXISTS combat_logs_2026_q1 PARTITION OF combat_logs
  FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS combat_logs_2026_q2 PARTITION OF combat_logs
  FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS combat_logs_2026_q3 PARTITION OF combat_logs
  FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS combat_logs_2026_q4 PARTITION OF combat_logs
  FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS combat_logs_2027_q1 PARTITION OF combat_logs
  FOR VALUES FROM ('2027-01-01') TO ('2027-04-01');
