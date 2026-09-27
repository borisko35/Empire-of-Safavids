// ============================================================
// Account Linking Service — Empire of Safavids
// ============================================================
// Аккаунт должен давать больше одного способа войти. Иначе игрок, зашедший
// по Google, оказывается в ловушке: пароля у него нет (change-password
// требует старый), а потерять Google-вход он не может.
//
// Что здесь можно:
//   - посмотреть, какие способы входа привязаны;
//   - задать пароль, если его ещё нет (вход по Google);
//   - отвязать Google/Facebook, если остаётся другой способ войти.
//
// ГЛАВНОЕ ПРАВИЛО: нельзя отвязать последний способ входа. Иначе игрок
// нажимает «отвязать» и навсегда теряет доступ к своему персонажу.
//
// ТУТ БЫЛА ДЫРА В OAuthService.login(). Когда игрок уже вошёл и нажал
// «Войти через Google», код сначала искал готовую привязку и, найдя её,
// ВХОДИЛ В ЧУЖОЙ АККАУНТ вместо того, чтобы привязать свой Google к
// текущему. Теперь это исправлено: чужой аккаунт — явная ошибка, а не
// тихая смена личности.

import bcrypt from 'bcryptjs';
import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';
import type { OAuthProvider } from '../../../shared/auth.types';

export type LinkMethod = 'password' | 'google' | 'facebook';

export interface LinkedAccount {
  method: LinkMethod;
  /** Человеческое название способа входа */
  label: string;
  /** Почта, если способ её даёт (Google/Facebook) */
  email?: string | undefined;
  /** Можно ли этот способ отвязать */
  canDetach: boolean;
  /** Почему нельзя — показываем игроку, а не молчим */
  lockedReason?: string | undefined;
}

export interface LinkInfo {
  accounts: LinkedAccount[];
  /** Сколько всего способов входа */
  total: number;
}

export class AccountLinkService {
  private db = DatabaseService.getInstance();

  /** Какие способы входа привязаны к аккаунту */
  async getInfo(userId: string): Promise<LinkInfo> {
    const user = await this.db.queryOne<{ has_password: boolean; email: string }>(
      'SELECT has_password, email FROM users WHERE id = $1', [userId],
    );
    if (!user) throw linkError('user_not_found', 'Аккаунт не найден');

    const identities = await this.db.query<{
      provider: string; provider_id: string; email: string | null;
    }>(
      `SELECT i.provider, i.provider_id,
              u.email
         FROM user_identities i
         JOIN users u ON u.id = i.user_id
        WHERE i.user_id = $1`, [userId],
    );

    // Сначала собираем способы входа, потом решаем, что можно отвязать
    const found: Array<Omit<LinkedAccount, 'canDetach' | 'lockedReason'>> = [];
    if (user.has_password) {
      // Почту показываем: игрок должен видеть, под какой почтой он входит
      const mail = user.email.endsWith('@oauth.invalid') || user.email.endsWith('@guest.invalid')
        ? undefined : user.email;
      found.push({ method: 'password', label: 'Email и пароль', email: mail });
    }
    for (const row of identities) {
      // Служебная почта — не настоящая почта игрока, показывать её нельзя
      const real = row.email && !row.email.endsWith('@oauth.invalid') ? row.email : undefined;
      found.push({
        method: row.provider as LinkMethod,
        label: row.provider === 'google' ? 'Google' : 'Facebook',
        email: real,
      });
    }

    // Отвязать можно всё, кроме последнего: иначе доступ пропадёт навсегда.
    // Игроку говорим об этом прямо, а не прячем кнопку молча.
    const total = found.length;
    const accounts: LinkedAccount[] = found.map((a) => (
      total > 1
        ? { ...a, canDetach: true }
        : { ...a, canDetach: false, lockedReason: 'last_way_in' }
    ));
    return { accounts, total };
  }

  /**
   * Добавить вход по почте и паролю аккаунту, у которого его нет.
   *
   * ПОЧЕМУ НУЖНА И ПОЧТА, И ПАРОЛЬ, А НЕ ТОЛЬКО ПАРОЛЬ:
   * вход идёт только по почте (AuthService.login ищет по email). У аккаунта,
   * созданного через Google, стоит служебная почта google_…@oauth.invalid,
   * которую никто в руки не введёт. Пароль без почты был бы мёртвым.
   *
   * Если пароль уже есть — это не «привязка», а смена, и её делает
   * отдельный маршрут со старым паролем. Переиспользовать этот метод
   * для смены нельзя: иначе любой, укравший токен, сменил бы пароль
   * и захватил аккаунт.
   */
  async addEmailLogin(userId: string, email: string, password: string): Promise<void> {
    if (password.length < 8) {
      throw linkError('weak_password', 'Пароль должен быть не короче 8 символов');
    }
    const clean = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
      throw linkError('email_invalid', 'Проверьте адрес почты');
    }

    const user = await this.db.queryOne<{ has_password: boolean; email: string }>(
      'SELECT has_password, email FROM users WHERE id = $1', [userId],
    );
    if (!user) throw linkError('user_not_found', 'Аккаунт не найден');
    if (user.has_password) {
      throw linkError('password_already_set', 'Пароль уже задан. Смените его в настройках');
    }

    // Служебная почта значит, что настоящей ещё нет — привязывать можно.
    // Настоящая — значит вход по почте уже работает.
    const hasRealEmail = !user.email.endsWith('@oauth.invalid') && !user.email.endsWith('@guest.invalid');
    if (hasRealEmail) {
      throw linkError('email_not_usable', 'Этот аккаунт уже входит по почте');
    }

    // Почта уникальна: иначе игрок введёт чужую почту и попадёт не в тот аккаунт
    const taken = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE email = $1', [clean],
    );
    if (taken) throw linkError('email_taken', 'Эта почта уже занята другим аккаунтом');

    const hash = await bcrypt.hash(password, 12);
    await this.db.query(
      `UPDATE users SET email = $1, password_hash = $2, has_password = TRUE, updated_at = NOW()
        WHERE id = $3`, [clean, hash, userId],
    );
    logger.info(`[Link] Email login added for user ${userId}`);
  }

  /**
   * Отвязать внешний вход. Пароль отвязать нельзя — его можно сменить.
   *
   * Отказ, если это последний способ войти: потерять доступ к персонажу
   * нельзя ни при каких условиях.
   */
  async unlink(userId: string, provider: OAuthProvider): Promise<void> {
    const info = await this.getInfo(userId);
    if (!info.accounts.some((a) => a.method === provider)) {
      throw linkError('not_linked', 'Этот способ входа не привязан');
    }
    if (info.total <= 1) {
      throw linkError('last_way_in', 'Это единственный способ входа. Сначала добавьте другой');
    }
    await this.db.query(
      'DELETE FROM user_identities WHERE user_id = $1 AND provider = $2', [userId, provider],
    );
    logger.info(`[Link] ${userId} unlinked ${provider}`);
  }
}

function linkError(code: string, message: string): Error {
  const err = new Error(message);
  (err as Error & { code: string }).code = code;
  return err;
}
