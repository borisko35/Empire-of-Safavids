// ============================================================
// Referral Service — Empire of Safavids
// ============================================================
// Приглашение друзей — самый дешёвый способ привести нового игрока:
// он уже играет и уже хочет, чтобы друг увидел его город.
//
// Как это работает:
//   1. У игрока есть личный код (8 символов). Он берёт ссылку
//      /game/?ref=КОД и отправляет другу.
//   2. Друг заходит по ссылке, регистрируется (или играет гостем)
//      и создаёт персонажа.
//   3. В этот момент обоим начисляется золото.
//
// ПОЧЕМУ СЧЁТ ИДЁТ НА СОЗДАНИИ ПЕРСОНАЖА, А НЕ НА РЕГИСТРАЦИИ:
// золото лежит в characters.gold. В момент регистрации аккаунта персонажа
// ещё не существует, платить просто некому.
//
// ЗАЩИТА ОТ НАКРУТКИ — четыре правила, каждое закрывает свой способ:
//   1. referred_id UNIQUE в БД — пригласить одного игрока можно один раз.
//   2. Пригласить самого себя нельзя.
//   3. Награда начисляется только на существующий персонаж пригласившего:
//      получить код может лишь тот, кто уже зашёл в игру.
//   4. Золото капает на САМЫЙ СТАРЫЙ персонаж пригласившего, а не на все
//      сразу: иначе заведя пять персонажей можно было бы получать награду
//      пять раз за одного приглашённого.

import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';

/** Длина кода. 8 символов без 0/O/1/I — их невозможно спутать при чтении */
const CODE_LEN = 8;
/** Сколько букв в коде: 32, чтобы не путать похожие знаки */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Сколько золота получает приглашённый (стартовое золото персонажа — 100) */
export const REWARD_INVITED_GOLD = 1000;
/** Сколько золота получает пригласивший за каждого приглашённого */
export const REWARD_REFERRER_GOLD = 500;
/**
 * Максимум приглашений с одного кода. Страховка от «запостил ссылку
 * на форуме»: один игрок не должен раздавать награды сотням.
 */
export const MAX_INVITES_PER_CODE = 50;

export interface ReferralInfo {
  code: string;
  invited: number;
  earnedGold: number;
  /** Ссылка, которую игрок отправляет другу */
  link: string;
}

export class ReferralService {
  private db = DatabaseService.getInstance();

  /**
   * Код игрока. Создаётся при первом обращении, а не миграцией:
   * так в базе не появляется код у тех, кто никогда не звал друзей.
   */
  async getOrCreateCode(userId: string): Promise<string> {
    const existing = await this.db.queryOne<{ referral_code: string | null }>(
      'SELECT referral_code FROM users WHERE id = $1', [userId],
    );
    if (existing?.referral_code) return existing.referral_code;

    // Генерируем с проверкой: код короткий, коллизия возможна
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = this.randomCode();
      const clash = await this.db.queryOne('SELECT id FROM users WHERE referral_code = $1', [code]);
      if (clash) continue;
      await this.db.query('UPDATE users SET referral_code = $1 WHERE id = $2', [code, userId]);
      return code;
    }
    // Восемь попыток по 32⁸ вариантов — коллизия практически невозможна,
    // но если вдруг случится, пусть игрок увидит честную ошибку
    throw new Error('referral code collision');
  }

  /** Случайный код из алфавита без похожих символов */
  private randomCode(): string {
    let out = '';
    for (let i = 0; i < CODE_LEN; i++) {
      out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return out;
  }

  /**
   * Засчитать приглашение. Вызывается один раз — при создании персонажа
   * приглашённого игрока.
   *
   * Возвращает null, если приглашение не засчитано. Это НЕ ошибка:
   * неверный код, свой код или уже приглашённый — обычная ситуация,
   * а не повод пугать игрока сообщением.
   */
  async attribute(
    code: string | null | undefined,
    invitedCharacter: { id: string; userId: string },
  ): Promise<{ referrerId: string; invitedGold: number; referrerGold: number } | null> {
    if (!code) return null;
    const clean = code.trim().toUpperCase();
    if (clean.length !== CODE_LEN) return null;

    const referrer = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE referral_code = $1', [clean],
    );
    if (!referrer) return null;
    // Пригласить самого себя нельзя
    if (referrer.id === invitedCharacter.userId) return null;

    // Уже приглашён? UNIQUE в БД не даст записать вторую строку,
    // но проверяем заранее, чтобы не ловить исключение БД как ошибку
    const already = await this.db.queryOne(
      'SELECT id FROM referrals WHERE referred_id = $1', [invitedCharacter.userId],
    );
    if (already) return null;

    // Потолок по одному коду
    const count = await this.db.queryOne<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM referrals WHERE referrer_id = $1', [referrer.id],
    );
    if (Number(count?.n ?? 0) >= MAX_INVITES_PER_CODE) return null;

    // У пригласившего обязан быть персонаж: получить код может только тот,
    // кто уже заходил в игру. Иначе платить некуда.
    const referrerChar = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM characters WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [referrer.id],
    );
    if (!referrerChar) return null;

    try {
      await this.db.query(
        'INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)',
        [referrer.id, invitedCharacter.userId],
      );
    } catch {
      // Гонка: того же игрока пригласили параллельно. UNIQUE отработал,
      // это ожидаемое поведение, а не поломка
      return null;
    }

    // Приглашённому — на только что созданного персонажа
    await this.db.query(
      'UPDATE characters SET gold = gold + $1, updated_at = NOW() WHERE id = $2',
      [REWARD_INVITED_GOLD, invitedCharacter.id],
    );
    // Пригласившему — на самый старый персонаж (см. защиту от накрутки)
    await this.db.query(
      'UPDATE characters SET gold = gold + $1, updated_at = NOW() WHERE id = $2',
      [REWARD_REFERRER_GOLD, referrerChar.id],
    );

    logger.info(`[Referral] ${referrer.id} invited ${invitedCharacter.userId}`);
    return {
      referrerId: referrer.id,
      invitedGold: REWARD_INVITED_GOLD,
      referrerGold: REWARD_REFERRER_GOLD,
    };
  }

  /** Код игрока, сколько пригласил и сколько заработал */
  async getInfo(userId: string, origin: string): Promise<ReferralInfo> {
    const code = await this.getOrCreateCode(userId);
    const row = await this.db.queryOne<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM referrals WHERE referrer_id = $1', [userId],
    );
    const invited = Number(row?.n ?? 0);
    return {
      code,
      invited,
      earnedGold: invited * REWARD_REFERRER_GOLD,
      link: `${origin.replace(/\/+$/, '')}/game/?ref=${code}`,
    };
  }
}
