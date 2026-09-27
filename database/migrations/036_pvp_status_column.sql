-- ============================================================
-- PvP: колонка status — Empire of Safavids
-- ============================================================
-- ТУТ БЫЛА ПРИЧИНА 500 НА /api/game/pvp/find-match.
--
-- Код PvP с самого начала работал со статусом матча:
--     WHERE ... AND status = 'waiting'   (матчмейкинг)
--     SET ... status = 'active'
--     SET ... status = 'finished'         (бой закрыт)
--     SET ... status = 'draw'             (оба назвали разных)
--
-- Но колонки status в таблице pvp_arena НИКОГДА НЕ БЫЛО. В миграции 016
-- есть player1_id, player2_id, winner_id, mode, player1_rating,
-- player2_rating, rating_change, started_at, ended_at — и всё.
--
-- Из-за этого каждый запрос к pvp_arena падал с ошибкой «колонка не
-- существует», а find-match отдавал 500. PvP не работал никогда, и
-- кнопка «Найти бой» молча ничего не делала.
--
-- Отдельной миграцией, а не правкой 035: применённые миграции
-- отслеживаются в schema_migrations по имени файла, и если 035 уже
-- отработала, её правка просто не выполнится.

ALTER TABLE pvp_arena ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'waiting';

-- Восстанавливаем состояние уже существующих матчей по их данным.
-- Иначе все старые матчи молча получили бы 'waiting', и поиск соперника
-- начал бы подбирать себе в качестве соперника давно сыгранный бой.
UPDATE pvp_arena
   SET status = 'finished'
 WHERE winner_id IS NOT NULL;

UPDATE pvp_arena
   SET status = 'active'
 WHERE winner_id IS NULL
   AND player2_id IS NOT NULL;

-- Матчмейкинг ищет открытые бой по status: индекс по нему ускоряет
-- подбор. Частичный — закрытых матчей накапливается много, а ищутся
-- только открытые.
CREATE INDEX IF NOT EXISTS idx_pvp_arena_status
  ON pvp_arena(status) WHERE status <> 'finished';
