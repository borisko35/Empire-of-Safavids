-- ============================================================
-- 032_oauth_identities.sql — вход через Google и VK
-- ============================================================
-- Зачем: пароль — это стена. Человек должен придумать пароль, запомнить
-- его и подтвердить почту, а «войти через Google» — один клик. Для
-- привлечения людей это даёт больше, чем любая другая фича входа.
--
-- Почему отдельная таблица, а не колонка в users:
--   — у одного человека может быть несколько входов (Google + VK +
--     гостевой), привязанных к ОДНОМУ user_id;
--   — благодаря общему user_id гостевый прогресс не теряется при
--     привязке внешнего аккаунта: персонаж, вещи и квесты остаются;
--   — секреты провайдера остаются на сервере и в базу не попадают:
--     здесь только идентификатор провайдера.

CREATE TABLE IF NOT EXISTS user_identities (
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    VARCHAR(20) NOT NULL,          -- 'google' | 'vk'
  provider_id TEXT        NOT NULL,          -- стабильный id у провайдера
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Один внешний аккаунт не может принадлежать двум игрокам
  PRIMARY KEY (provider, provider_id)
);

-- Привязки конкретного игрока (для «подключённых входов» в настройках)
CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);

-- Гостевые аккаунты: нужны для чистки и для анализа конверсии
-- гость → «залогинился через внешний сервис»
CREATE INDEX IF NOT EXISTS idx_users_guest_unclaimed
  ON users(created_at)
  WHERE is_guest = TRUE AND claimed_at IS NULL;
