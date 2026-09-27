-- ============================================================
-- Загрузка фото и видео на сайт — Empire of Safavids
-- ============================================================
-- Разработчик, админы и модераторы заливают снимки и ролики, чтобы
-- ставить их на страницы сайта вместо того, чтобы каждый раз искать
-- файл на диске и просить вебмастера.
--
-- storage_name — НЕ имя файла, который прислал человек, а сгенерированный.
-- Оригинальное имя живёт отдельно, для показа в панели. Так имя от
-- пользователя физически не касается файловой системы: никаких «..»,
-- никаких слешей, никакой подмены расширения.

CREATE TABLE IF NOT EXISTS media_files (
  id            UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  -- Сгенерированное имя на диске: только безопасные символы
  storage_name  VARCHAR(80) NOT NULL UNIQUE,
  -- Имя, которое прислал человек. Показывается в панели, на диск не идёт
  original_name VARCHAR(255) NOT NULL,
  -- Проверено по сигнатуре файла, а не по тому, что прислал браузер
  kind          VARCHAR(10) NOT NULL CHECK (kind IN ('image', 'video')),
  mime          VARCHAR(60) NOT NULL,
  size_bytes    BIGINT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  duration_sec  NUMERIC(6, 2),
  -- Кто залил: показываем, кто что добавил
  uploaded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Панель показывает свежие сверху
CREATE INDEX IF NOT EXISTS idx_media_files_created ON media_files(created_at DESC);
