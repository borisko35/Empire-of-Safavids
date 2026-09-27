-- ============================================================
-- Приглашение друзей — Empire of Safavids
-- ============================================================
-- Механика: у игрока есть личный код. Он кладёт ссылку
-- /game/?ref=КОД. Кто пришёл по ней и создал персонажа, засчитывается
-- приглашённым, и обоим начисляется золото.
--
-- ПОЧЕМУ СЧЁТ ИДЁТ НА СОЗДАНИИ ПЕРСОНАЖА, А НЕ НА РЕГИСТРАЦИИ:
-- золото лежит в characters.gold. На момент регистрации аккаунта
-- персонажа ещё нет — платить было бы некому. Персонаж появляется
-- один раз, и обе стороны к этому моменту уже существуют.

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(16);

-- Код выдаётся лениво, при первом запросе, поэтому миграция не приписывает
-- его всем сразу: у старых игроков он появится при входе.
-- Частичный индекс — иначе миллион пустых строк сравнивались бы между собой.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code
  ON users(referral_code) WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS referrals (
  id          UUID PRIMARY KEY DEFAULT generate_uuid_v4(),
  -- кто пригласил
  referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- кого пригласили; UNIQUE — пригласить одного игрока можно только раз,
  -- иначе можно было бы переприглашать его же бесконечно и farmить награды
  referred_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
