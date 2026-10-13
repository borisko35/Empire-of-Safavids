-- ============================================================
-- Миграция 078: караул игрока
-- ============================================================
-- ЗАЧЕМ. «Вербовка караула» из очереди идей карты (ROADMAP §3,
-- пункт 2): игрок нанимает солдат и выводит их в бой. Хранить их
-- было негде — ни таблицы, ни поля в characters.
--
-- ЧТО ЗДЕСЬ. Одна строка на (персонаж, доля). Доли три: ополченец,
-- ветеран, гвардеец (server/src/data/soldiers.ts). Строка, а не
-- число в characters, потому что у каждого солдата своё здоровье и
-- своё время найма: панящий караул и свежий — это разные вещи, и
-- «у игрока 3 солдата» сказало бы о числе, но не о состоянии.
--
-- Почему CHECK на tier, а не только TEXT: доля приходит из тела
-- запроса. Без ограничения в базу попадала бы любая строка, и
-- сервис молча раздавал бы за неё урон по нулю — тот самый класс
-- «поле объявлено, но не читается».
--
-- CASCADE: персонаж удалён — караул не нужен. Строки копились бы
-- вечно и читались бы только этим персонажем.
CREATE TABLE IF NOT EXISTS character_soldiers (
  id           UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  tier         TEXT NOT NULL,
  hp           INTEGER NOT NULL,
  max_hp       INTEGER NOT NULL,
  -- Когда последний раз получал урон. По этому и только этому числу
  -- считается отдых: восстановление не должно идти, пока солдат в бою.
  last_damage_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hired_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT character_soldiers_tier_known
    CHECK (tier IN ('levy', 'veteran', 'elite')),
  CONSTRAINT character_soldiers_hp_in_range
    CHECK (hp >= 0 AND hp <= max_hp),
  CONSTRAINT character_soldiers_max_hp_positive
    CHECK (max_hp > 0)
);

-- Главный запрос панели: «мой караул, от свежих к старым». Без индекса
-- он всё равно отвечал бы мгновенно — строк мало, — но составной ключ
-- (персонаж, доля) всё равно нужен: проверка «свободна ли доза» идёт
-- именно так, и при отсутствии индекса каждая проверка просматривала
-- бы всю таблицу по мере роста числа игроков.
CREATE UNIQUE INDEX IF NOT EXISTS idx_character_soldiers_char_tier
  ON character_soldiers(character_id, tier);