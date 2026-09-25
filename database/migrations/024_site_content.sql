-- ============================================================
-- Empire of Safavids — Migration 024
-- Контент сайта (CMS): новости, анонс, режим обслуживания
-- ============================================================
-- Раньше новости/аннонс были зашиты в client/web/index.html и
-- локали: их мог менять только тот, кто пересобирал сайт.
-- Теперь контент живёт в БД и редактируется из /admin.html
-- (вкладка «Управление сайтом»), доступной разработчикам,
-- администраторам и модераторам.
--
-- value — JSONB, схема зависит от ключа:
--   news        : { items: [{ title: {ru,en,az}, body: {ru,en,az}, date: string }] }
--   announcement: { enabled: boolean, text: {ru,en,az} }
--   maintenance : { enabled: boolean, text: {ru,en,az} }
-- ============================================================

CREATE TABLE IF NOT EXISTS site_content (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

COMMENT ON TABLE site_content IS 'Редактируемый контент лендинга (CMS)';
