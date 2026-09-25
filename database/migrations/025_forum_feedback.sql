-- ============================================================
-- Migration 025: Форум и обратная связь
-- Empire of Safavids
-- ============================================================
-- Форум — три раздела: обсуждения, советы, вопросы-ответы.
-- В разделе «Вопросы и ответы» автор темы (или персонал) может
-- отметить ответ как решение — оно всплывает над остальными.
--
-- Обратная связь — форма на /feedback.html, очередь в /admin.html.
-- ============================================================

-- ── РАЗДЕЛЫ ФОРУМА ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forum_categories (
  id          VARCHAR(40) PRIMARY KEY,
  name        JSONB NOT NULL DEFAULT '{}',
  description JSONB NOT NULL DEFAULT '{}',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO forum_categories (id, name, description, sort_order) VALUES
  ('discussions',
   '{"ru":"Обсуждения","en":"Discussions","az":"Müzakirələr"}',
   '{"ru":"Любые темы по игре: обновления, идеи, поиск команды","en":"Anything about the game: updates, ideas, looking for a group","az":"Oyunla bağlı hər şey: yeniləmələr, ideyalar, komanda axtarışı"}',
   1),
  ('tips',
   '{"ru":"Советы","en":"Tips","az":"Məsləhətlər"}',
   '{"ru":"Гайды, фишки, билды и стратегии","en":"Guides, tricks, builds and strategies","az":"Təlimatlar, fəndlər, billdlər və strategiyalar"}',
   2),
  ('qa',
   '{"ru":"Вопросы и ответы","en":"Questions & Answers","az":"Suallar və cavablar"}',
   '{"ru":"Задай вопрос — лучший ответ можно отметить как решение","en":"Ask a question — the best answer can be marked as the solution","az":"Sual ver — ən yaxşı cavabı həll kimi işarələmək olar"}',
   3)
ON CONFLICT (id) DO NOTHING;

-- ── ТЕМЫ ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forum_topics (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id    VARCHAR(40) NOT NULL REFERENCES forum_categories(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          VARCHAR(160) NOT NULL,
  body           TEXT NOT NULL,
  views          INTEGER NOT NULL DEFAULT 0,
  pinned         BOOLEAN NOT NULL DEFAULT FALSE,
  locked         BOOLEAN NOT NULL DEFAULT FALSE,
  -- Отмеченный как решение ответ (см. forum_posts.id)
  solved_post_id UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_post_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── ОТВЕТЫ ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forum_posts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id   UUID NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_topics_category ON forum_topics (category_id, pinned DESC, last_post_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_topics_last      ON forum_topics (last_post_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_topic      ON forum_posts (topic_id, created_at);

-- ── ОБРАТНАЯ СВЯЗЬ ─────────────────────────────────────────
-- status: new → read → closed
CREATE TABLE IF NOT EXISTS feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  category    VARCHAR(40) NOT NULL DEFAULT 'other',
  message     TEXT NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'new',
  handled_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  handled_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user   ON feedback (user_id, created_at DESC);
