-- ============================================================
-- 013_Admin — Empire of Safavids
-- ============================================================
-- Административные возможности

-- Флаг администратора на аккаунте
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role VARCHAR(20) NOT NULL DEFAULT 'gm';

-- Роли: gm, senior_gm, admin, superadmin
CREATE INDEX idx_users_admin ON users(is_admin) WHERE is_admin = TRUE;

-- Лог админских действий (уже существует в 003, но добавим полную версию)
-- (admin_logs уже существует из 003)
CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON admin_logs(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_target ON admin_logs(target_id, created_at DESC);

-- Таблица предупреждений (mute) — уже существует в 003 как character_mutes
-- Добавим индекс для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_character_mutes_active ON character_mutes(muted_until);

-- Примечание: таблица admin_logs уже существует из миграции 003
-- character_mutes уже существует из миграции 003
