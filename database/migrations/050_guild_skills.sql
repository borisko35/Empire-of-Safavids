-- ============================================================
-- Миграция 050: уровни навыков гильдии
-- ============================================================
-- ЗАЧЕМ. В data/guilds.ts объявлено пять навыков гильдии с ценой
-- уровня, и файл не импортировался вообще: навыков не существовало.
-- Теперь они покупаются золотом гильдии и дают то, что действительно
-- можно применить.
--
-- ГЛАВНОЕ - CHECK НА УРОВЕНЬ. Навык нельзя купить выше потолка,
-- объявленного в данных (maxLevel), иначе гильдия могла бы заплатить за
-- уровень, которого не существует, и бонус рос бы вечно. Потолок
-- продублирован здесь числом, а не взят из кода: CHECK не умеет ходить в
-- TypeScript, и ссылка на справочник была бы комментарием, который
-- однажды станет ложью.
--
-- Первичный ключ по (гильдия, навык) означает, что у навыка один
-- уровень, а не строка на каждую покупку: иначе на десятом уровне
-- появилось бы десять строк и десять бонусов подряд.
--
-- Комментарии строго '--': в .sql-файле '//' не комментарий, и такой файл
-- роняет сайт целиком на этапе миграции.
CREATE TABLE IF NOT EXISTS guild_skills (
  guild_id    UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  skill_id    VARCHAR(50) NOT NULL,
  level       INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, skill_id)
);

-- Уровень неотрицателен: отрицательный дал бы отрицательный бонус, то
-- есть штраф за неудачную покупку.
ALTER TABLE guild_skills
  DROP CONSTRAINT IF EXISTS guild_skills_level_range;

ALTER TABLE guild_skills
  ADD CONSTRAINT guild_skills_level_range CHECK (level >= 0 AND level <= 10);

-- Вид эффекта ограничен списком. Опечатка в id навыка не создала бы
-- строку, которую никто не прочитает, - она была бы отвергнута.
ALTER TABLE guild_skills
  DROP CONSTRAINT IF EXISTS guild_skills_id_known;

ALTER TABLE guild_skills
  ADD CONSTRAINT guild_skills_id_known CHECK (
    skill_id IN ('guild_exp_boost', 'guild_gold_boost', 'guild_hp_boost', 'guild_craft_speed', 'guild_siege_power')
  );
