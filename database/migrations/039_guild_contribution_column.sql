-- ============================================================
-- Переименование колонки вклада в гильдии — Empire of Safavids
-- ============================================================
-- В миграции 015 колонка вклада участника названа НЕ ЧЕМ В ЛАТИНИЦЕ: первые
-- два символа имени — иероглифы (китайское «вклад»), дальше _points. Выглядит
-- как опечатка, но код написан верно: GuildService обращается к
-- contribution_points — и в выдаче списка участников
-- (SELECT gm.contribution_points), и при начислении вклада
-- (UPDATE guild_members SET contribution_points = ...).
--
-- Из-за несовпадения падало ВСЁ, что касается участников гильдии:
--   * список участников — самая частая операция в панели гильдии;
--   * начисление вклада при сдаче золота в казну;
--   * addMember, который вызывает getMembers для проверки лимита,
--     то есть вступление в гильдию.
--
-- ПОЧЕМУ ЗДЕСЬ НЕТ ИМЕНИ СТАРОЙ КОЛОНКИ. Первая версия этой миграции
-- сравнивала старую колонку с её именем из 015 — и падала: имя с
-- не-латинскими символами не совпало при переносе файла, проверка решила,
-- что переименовывать нечего, а следующая строка уже требовала
-- contribution_points. Правило простое: неASCII-имя в SQL вообще не
-- упоминаем, иначе оно снова исказится.
--
-- Вместо этого колонка ищется по остаткам. В guild_members есть ровно пять
-- колонок: guild_id, character_id, rank, вклад и joined_at. Значит любая
-- колонка, кроме пяти известных, — это и есть вклад с искажённым именем.
--
-- Если найти не удалось (например, таблицу уже правили руками) — колонка
-- просто создаётся. Потеря данных при этом невозможна: писать в старое
-- имя код не мог — все обращения падали, и в колонке всегда был ноль.
--
-- Идемпотентно: если contribution_points уже есть, ничего не делаем.

DO $$
DECLARE
  odd_column TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'guild_members'
       AND column_name = 'contribution_points'
  ) THEN
    RETURN;
  END IF;

  -- Ищем колонку, которая не входит в известный набор.
  -- Схему указываем явно: иначе при нескольких схемах поиск мог бы найти
  -- одноимённую таблицу не в той.
  SELECT column_name INTO odd_column
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'guild_members'
     AND column_name NOT IN ('guild_id', 'character_id', 'rank', 'joined_at')
   LIMIT 1;

  IF odd_column IS NOT NULL THEN
    EXECUTE format('ALTER TABLE guild_members RENAME COLUMN %I TO contribution_points', odd_column);
  ELSE
    EXECUTE 'ALTER TABLE guild_members ADD COLUMN contribution_points INTEGER NOT NULL DEFAULT 0';
  END IF;

  -- NULL недопустим: в коде это число складывают и показывают игроку,
  -- а NULL там — арифметическая ошибка
  EXECUTE 'UPDATE guild_members SET contribution_points = 0 WHERE contribution_points IS NULL';
END $$;
