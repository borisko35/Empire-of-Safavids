-- ============================================================
-- Привязка аккаунтов — Empire of Safavids
-- ============================================================
-- Игрок заходит по Google, но привязать к аккаунту пароль не может:
-- change-password требует старый пароль, которого у него нет. А если он
-- войдёт как гость, то потеряет Google-вход.
--
-- Нужен честный признак «у аккаунта есть пароль». Гадать по password_hash
-- нельзя: у гостя там лежит случайный хеш, и по нему не отличить гостя от
-- игрока с настоящим паролем.
--
-- Заполняем признак для тех, у кого пароль заведомо есть:
--   - обычная регистрация: настоящая почта;
--   - гостю, сохранившему аккаунт: тоже настоящая почта.
-- Служебные адреса исключены: @oauth.invalid — вход только через провайдера,
-- @guest.invalid — гость, который ещё не сохранил аккаунт.

ALTER TABLE users ADD COLUMN IF NOT EXISTS has_password BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users
   SET has_password = TRUE
 WHERE is_guest = FALSE
   AND email NOT LIKE '%@oauth.invalid'
   AND email NOT LIKE '%@guest.invalid';

-- Частичный индекс: у большинства аккаунтов пароля нет (вход по Google),
-- и полный индекс по booleany-колонке только раздувал бы таблицу.
CREATE INDEX IF NOT EXISTS idx_users_has_password
  ON users(has_password) WHERE has_password = TRUE;
