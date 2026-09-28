-- ============================================================
-- Гильдии: четыре колонки, которые код требует, а база их не даёт
-- ============================================================
-- ЧТО БЫЛО. Таблицу создала 001 (id, name, description, leader_id, level,
-- territory, gold, emblem, created_at, updated_at). Миграция 015 объявила
-- guilds заново — но через CREATE TABLE IF NOT EXISTS, который не
-- выполняется, если таблица уже есть. В итоге колонок tag, experience,
-- max_members и banner_color не было никогда, а код опирался на них с
-- самого начала:
--
--   * createGuild делает INSERT INTO guilds (name, tag, ...) — создать
--     гильдию было нельзя ни разу: в продовой базе 0 гильдий и 0 участников;
--   * searchGuilds ищет по tag — запрос падал с «column "tag" does not
--     exist», ответ не отправлялся вовсе, и клиент получал 504;
--   * addMember сверялся с guild.max_members, которого нет в SELECT *,
--     то есть с undefined: сравнение всегда ложно, лимит гильдии не действовал;
--   * addContribution делает UPDATE guilds SET experience = experience + $1.
--
-- Правкой 015 это не починить: применённые миграции записываются в
-- schema_migrations по имени файла и второй раз не выполняются.

ALTER TABLE guilds ADD COLUMN IF NOT EXISTS tag          VARCHAR(10) UNIQUE;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS experience   BIGINT   NOT NULL DEFAULT 0;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS max_members  INTEGER  NOT NULL DEFAULT 30;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS banner_color VARCHAR(7) NOT NULL DEFAULT '#C9A84C';

-- Тег для уже существующих гильдий: берём префикс названия, а если он пуст
-- или занят другой гильдией — нейтральный по id. UNIQUE оборвал бы
-- миграцию на повторе, поэтому решать это надо здесь, а не в коде.
UPDATE guilds g
SET tag = CASE
    WHEN p.prefix = '' THEN upper(substr(md5(g.id::text), 1, 6))
    WHEN EXISTS (
      SELECT 1 FROM guilds x
      WHERE x.id <> g.id
        AND upper(left(regexp_replace(x.name, '\W+', '', 'g'), 6)) = p.prefix
    ) THEN upper(substr(md5(g.id::text), 1, 6))
    ELSE p.prefix
  END
FROM (SELECT id, upper(left(regexp_replace(name, '\W+', '', 'g'), 6)) AS prefix FROM guilds) p
WHERE g.id = p.id
  AND g.tag IS NULL;
