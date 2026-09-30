-- ============================================================
-- Миграция 048: партии в шахматы и заложенная ставка
-- ============================================================
-- ЗАЧЕМ. Партия жила в памяти процесса, а золото по ней не двигалось
-- ни разу: `betGold` попадал в состояние, `goldWon` считался в
-- makeMove, и на этом всё заканчивалось. Игрок ставил 500 золота,
-- выигрывал, и ему показывали «Мат! Вы победили! +1000» - при этом в
-- кошельке было те же 500, с которых он начал.
--
-- ЧТО ЗДЕСЬ. Таблица партий. В ней три вещи, и все три нужны:
--
-- 1. bet_gold - сколько заложено. Без неё в перезапуске сервера
--    заложенное просто исчезло бы: партия в памяти, ставка в руках у
--    игрока, и после рестарта он молча терял деньги.
--
-- 2. state - доска, чей ход, история. Чтобы партию можно было
--    продолжить после перезапуска, а не начинать заново и не терять
--    заложенное. Поле JSONB, а не отдельные колонки на каждую клетку:
--    доска - это данные одного процесса, и разворачивать её в
--    36 колонок незачем.
--
-- 3. status - главное для честности. Выплата идёт только из строки,
--    где status = 'playing'. Повторный запрос на выплату ничего не
--    найдёт, и золото не удвоится дважды. Именно на этом держится
--    защита от нажатия «выплатить» дважды.
--
-- CHECK на status и на положительную ставку: нулевая ставка - это не
-- партия, а её запись всё равно занимала бы строку и выглядела бы в
-- списке как игра без денег.
--
-- Комментарии строго '--': в .sql-файле '//' не комментарий, и такой
-- файл роняет сайт целиком на этапе миграции.
CREATE TABLE IF NOT EXISTS chess_games (
  game_id      VARCHAR(80) PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  bet_gold     BIGINT NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'playing',
  payout_gold  BIGINT NOT NULL DEFAULT 0,
  state        JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);

-- Ставка не может быть нулевой: партия без денег - не партия.
ALTER TABLE chess_games
  DROP CONSTRAINT IF EXISTS chess_games_bet_positive;

ALTER TABLE chess_games
  ADD CONSTRAINT chess_games_bet_positive CHECK (bet_gold > 0);

-- Выплата неотрицательна: отрицательная означала бы, что у игрока
-- забирают золото по окончании партии, а это не выплата.
ALTER TABLE chess_games
  DROP CONSTRAINT IF EXISTS chess_games_payout_nonnegative;

ALTER TABLE chess_games
  ADD CONSTRAINT chess_games_payout_nonnegative CHECK (payout_gold >= 0);

-- Статус: незавершённая, завершённая, отказ. Свободный текст здесь
-- означил бы опечатку, которая навсегда оставила бы партию в
-- непонятном состоянии - и выплатить её было бы уже нечем.
ALTER TABLE chess_games
  DROP CONSTRAINT IF EXISTS chess_games_status_known;

ALTER TABLE chess_games
  ADD CONSTRAINT chess_games_status_known
  CHECK (status IN ('playing', 'finished', 'resigned'));

-- Партии игрока: и незакрытая, и закрытые. Игрок входит в игру и видит
-- свою текущую партию, а не 404.
CREATE INDEX IF NOT EXISTS idx_chess_games_character
  ON chess_games (character_id, status);
