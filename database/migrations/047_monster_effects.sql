-- ============================================================
-- Миграция 047: эффекты монстров на игроке
-- ============================================================
-- ЗАЧЕМ. У одиннадцати способностей монстров был объявлен эффект
-- (stun, slow, bleed, poison, fear) и длительность, и НИ ОДИН не
-- читался нигде: ни в GameLoop, ни в обработчике боя. Монстр бил
-- числом и забывал про то, что у него в данных написано. Игрок видел
-- обычный удар от «Землетрясения» с остановкой на 5 секунд.
--
-- ОДНА ТАБЛИЦА НА ВСЕ ПЯТЬ. Сначала хотелось трёх: отдельно оглушение,
-- отдельно урон со временем, отдельно замедление. Отказался: у всех
-- пятого один срок, одно обновление и один источник, а три таблицы
-- означали бы три места, где надо не забыть продлить срок. Здесь
-- различает вид эффекта колонка kind с CHECK - опечатку в виде
-- эффекта база не примет, а не создаст строку, которую никто не
-- прочитает.
--
-- ПОЧЕМУ last_tick_at. Урон со временем должен капать по тикам, и
-- игрок, вышедший из игры на час, не должен получить за этот час
-- три тысячи тиков. Срок ограничен expires_at, а накопление тиков
-- считается от last_tick_at и не превышает срок действия: игрок
-- закрыл вкладку - эффект истёк, а не продолжал тикать.
--
-- tick_damage только у bleed и poison: оглушению и замедлению урон
-- со временем не свой, и CHECK это запрещает. Заодно ловит ошибку
-- вида «выдал оглушение, а урон капает».
--
-- Комментарии строго '--': в .sql-файле '//' не комментарий, и такой
-- файл роняет сайт целиком на этапе миграции.
CREATE TABLE IF NOT EXISTS character_debuffs (
  character_id     UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  debuff_id        VARCHAR(60) NOT NULL,
  kind             VARCHAR(20) NOT NULL,
  -- slow: доля замедления от 0 до 1. Для остальных видов ноль.
  magnitude        REAL NOT NULL DEFAULT 0,
  -- bleed, poison: урон за один тик. Для остальных видов ноль.
  tick_damage      INTEGER NOT NULL DEFAULT 0,
  source_instance  VARCHAR(80),
  applied_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,
  last_tick_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, debuff_id)
);

-- Вид эффекта: не свободный текст. Опечатка в данных монстра не создаст
-- строку, которую никто не прочитает, - она будет отвергнута.
ALTER TABLE character_debuffs
  DROP CONSTRAINT IF EXISTS character_debuffs_kind_known;

ALTER TABLE character_debuffs
  ADD CONSTRAINT character_debuffs_kind_known
  CHECK (kind IN ('stun', 'slow', 'bleed', 'poison', 'fear'));

-- Урон со временем есть только у кровотечения и отравления. У
-- оглушения, замедления и страха его быть не должно.
ALTER TABLE character_debuffs
  DROP CONSTRAINT IF EXISTS character_debuffs_damage_only_for_dots;

ALTER TABLE character_debuffs
  ADD CONSTRAINT character_debuffs_damage_only_for_dots
  CHECK (
    (kind IN ('bleed', 'poison') AND tick_damage > 0)
    OR (kind NOT IN ('bleed', 'poison') AND tick_damage = 0)
  );

-- Замедление обязано что-то замедлять: доля 0 означала бы эффект без
-- последствий, и игрок увидел бы иконку, которая ничего не делает.
ALTER TABLE character_debuffs
  DROP CONSTRAINT IF EXISTS character_debuffs_slow_has_magnitude;

ALTER TABLE character_debuffs
  ADD CONSTRAINT character_debuffs_slow_has_magnitude
  CHECK (kind <> 'slow' OR (magnitude > 0 AND magnitude <= 1));

-- Срок всегда положителен: эффект с expires_at = applied_at продлился бы
-- на ноль секунд и выглядел бы в панели как применённый, но не работал.
ALTER TABLE character_debuffs
  DROP CONSTRAINT IF EXISTS character_debuffs_expires_after_applied;

ALTER TABLE character_debuffs
  ADD CONSTRAINT character_debuffs_expires_after_applied
  CHECK (expires_at > applied_at);

-- Тик урона спрашивается по персонажу и по сроку: истёкшие строки
-- отсекаются до выборки, а не после.
CREATE INDEX IF NOT EXISTS idx_character_debuffs_expires
  ON character_debuffs (character_id, expires_at);
