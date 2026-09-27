-- ============================================================
-- Переименование колонки вклада в гильдии — Empire of Safavids
-- ============================================================
-- В миграции 015 колонка вклада участника названа `贡献_points`.
-- Первые два символа — китайские иероглифы U+8D21 U+733B, то есть
-- «вклад». Выглядит как опечатка, но код-то написан правильно:
-- GuildService обращается к contribution_points — и в выдаче списка
-- участников (SELECT gm.contribution_points), и в начислении вклада
-- (UPDATE guild_members SET contribution_points = ...).
--
-- Из-за несовпадения падало ВСЁ, что касается участников гильдии:
--   * список участников — самая частая операция в панели гильдии;
--   * начисление вклада при сдаче золота в казну;
--   * addMember, который вызывает getMembers для проверки лимита,
--     то есть вступление в гильдию.
--
-- Правкой файла 015 это не вылечить: применённые миграции записываются
-- в schema_migrations по имени файла и второй раз не выполняются. На
-- сервере колонка останется с иероглифами навсегда, если не переименовать
-- её отдельной миграцией. Исходную 015 не трогаем — на чистой установке
-- 015 создаст старую колонку, а эта миграция её переименует. Итог
-- одинаковый в обоих случаях.
--
-- Блок DO нужен для идемпотентности: он смотрит, что реально есть в
-- таблице, и ничего не делает, если колонка уже переименована. Без
-- проверки повторный запуск падал бы с ошибкой.

DO $$
DECLARE
  has_old BOOLEAN;
  has_new BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'guild_members' AND column_name = '贡献_points'
  ) INTO has_old;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'guild_members' AND column_name = 'contribution_points'
  ) INTO has_new;

  IF has_old AND NOT has_new THEN
    ALTER TABLE guild_members RENAME COLUMN "贡献_points" TO contribution_points;
  END IF;
END $$;

-- Значения, накопленные под старым именем, остаются на месте: переименование
-- колонки в Postgres не трогает данные. Нормализуем NULL в 0, потому что
-- в коде это число складывают и показывают игроку, а NULL там — арифметика.
UPDATE guild_members SET contribution_points = 0 WHERE contribution_points IS NULL;
