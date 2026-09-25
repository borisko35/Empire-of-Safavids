-- ============================================================
-- Migration 026: Ответ команды в обратной связи
-- Empire of Safavids
-- ============================================================
-- Раньше игрок видел только плашку «Закрыто» без единого слова,
-- хотя форма обещала «Ответим в ближайшее время». Канала для ответа
-- не существовало — закрытое обращение выглядело как игнор.
--
-- Теперь у обращения есть ответ: его пишет модератор в /admin.html,
-- игрок видит его в блоке «Мои обращения» на /feedback.html.
--
-- reply      — текст ответа (NULL = ответа нет)
-- replied_at — когда ответ отправлен
-- replied_by — кто из персонала ответил
-- ============================================================

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS reply      TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS replied_by UUID REFERENCES users(id) ON DELETE SET NULL;
