-- ============================================================
-- Миграция 062: гильдейские задания
-- ============================================================
-- ЗАЧЕМ. В data/guilds.ts лежали три задания (GUILD_MISSIONS) с целями,
-- наградами, откатом и требованием к составу - и НИ ОДНОГО импорта на них
-- не было. То есть гильдия не могла взять задание, сделать и получить
-- награду: нечего было взять и некому платить.
--
-- ЧТО ЗАВОДИТСЯ.
--   guild_missions          - что гильдия делает СЕЙЧАС и когда какое
--                             задание снова откроется. Одна строка на
--                             пару (гильдия, задание).
--   guild_mission_progress  - накопленный прогресс по каждой цели.
--
-- ПОЧЕМУ ПРОГРЕСС В ОТДЕЛЬНОЙ ТАБЛИЦЕ, А НЕ СЧЁТЧИК В missions.
-- У задания может быть несколько целей (сейчас одна, но в справочнике
-- поле objectives - массив). Счётчик на missions означал бы, что
-- добавление второй цели требует менять схему, а не данные.
--
-- ПРИВЯЗКА К ГИЛЬДИИ. character_id ссылается на участника, а не на
-- персонажа вообще: прогресс должен идти от своего и не может быть
-- приписан постороннему. Проверка принадлежности остаётся в коде.
--
-- ЗАЩИТА ОТ ПОВТОРНОЙ НАГРАДЫ. primary key (guild_id, mission_id) в
-- missions и primary key (mission_row, objective_index) в progress.
-- Награда выдаётся переводом status в 'claimed', и повторный перевод
-- уже не находит строки - ON CONFLICT DO NOTHING держит базу, а не
-- порядок операций.
--
-- Индекс по (character_id) нужен для выборки «сколько сделал участник»:
-- без него каждый убитый монстр просматривал бы таблицу целиком.
--
-- Комментарии строго '--': в .sql-файле '//' не комментарий, и такой
-- файл роняет сайт целиком на этапе миграции.
CREATE TABLE IF NOT EXISTS guild_missions (
  id            UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  guild_id      UUID        NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  mission_id    VARCHAR(50) NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'claimed')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Когда задание откроется снова. NULL = открыто сейчас. Заполняется в
  -- момент получения награды, потому что отсчёт идёт от выдачи, а не от
  -- последней попытки: иначе можно было бы бесконечно начинать заново.
  available_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  -- Кто начал и кто забрал. По журналу видно, кто именно получил награду.
  started_by    UUID REFERENCES characters(id) ON DELETE SET NULL,
  claimed_by    UUID REFERENCES characters(id) ON DELETE SET NULL,
  UNIQUE (guild_id, mission_id)
);

CREATE INDEX IF NOT EXISTS idx_guild_missions_guild
  ON guild_missions (guild_id, status);

CREATE TABLE IF NOT EXISTS guild_mission_progress (
  mission_row   UUID        NOT NULL REFERENCES guild_missions(id) ON DELETE CASCADE,
  -- Порядковый номер цели в objectives. НЕ индекс массива и не id
  -- цели: цели одного задания могут повторяться по типу (две цели
  -- «убить»), и тогда по типу их не различить.
  objective_index INTEGER   NOT NULL,
  -- У кого накоплено. NULL - общий прогресс гильдии, как у цели
  -- «собрать 500 шёлка», где важно количество, а не автор.
  character_id  UUID        REFERENCES characters(id) ON DELETE SET NULL,
  progress      INTEGER     NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Уникальность через ИНДЕКС, а не через PRIMARY KEY. PRIMARY KEY в
-- Postgres объявляет все свои колонки NOT NULL, а character_id здесь
-- nullable по смыслу: NULL означает «прогресс общий, гильдейский», как у
-- цели «собрать 500 шёлка», где важен объём, а не автор. С первичным
-- ключом такая миграция просто не применилась бы.
--
-- NULL в уникальном индексе не сравнивается с NULL: две строки с
-- character_id = NULL прошли бы незамеченными и накопили бы прогресс
-- дважды. Поэтому NULL заменяется на заведомый нулевой UUID прямо в
-- индексе. В самих данных остаётся NULL, и код различает «общий» и
-- «личный» прогресс как и задумано.
CREATE UNIQUE INDEX IF NOT EXISTS idx_guild_mission_progress_key
  ON guild_mission_progress (
    mission_row,
    objective_index,
    COALESCE(character_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
