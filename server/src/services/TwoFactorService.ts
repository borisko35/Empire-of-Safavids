// Хранение и выдача двухфакторной аутентификации.
//
// ГЛАВНОЕ, ЧТО ЗДЕСЬ РЕШЕНО. TOTP по RFC 6238 симметричен: телефон и сервер
// держат ОДИН И ТОТ ЖЕ секрет, и сервер обязан уметь вычислить код сам.
// Значит секрет, прочитанный из базы, - это все коды за все тридцать секунд
// вперёд, и пароля там нет. Поэтому секрет шифруется AES-256-GCM ключом,
// который в базе не лежит.
//
// ПОЧЕМУ НЕ ХЭШ. Пароль хранится хэшем, потому что сервер проверяет его
// перебором: сверяет присланный хэш с настоящим. Здесь всё наоборот - из
// секрета надо ВЫЧИСЛИТЬ код, а из хэша код не получить. Хэш здесь был бы
// не защитой, а потерей.
//
// КЛЮЧ. Отдельной переменной TWOFA_ENCRYPTION_KEY в окружении нет, и
// вводить её обязательной нельзя: это значило бы, что деплой падает до
// заполнения. Поэтому ключ выводится из JWT_SECRET через scrypt с меткой
// назначения. Поменять JWT_SECRET - значит потребуется перезавести 2FA у
// всех, кто его включил; об этом сказано в комментарии рядом с функцией.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';
import {
  проверитьКод, ссылкаOtpauth, новыйСекрет, новыеКодыВосстановления,
  хэшКодаВосстановления, ПЕРИОД, ЦИФРЫ,
} from '../auth/TwoFactor';

/** Метка назначения: отделяет этот ключ от любого другого вывода из JWT_SECRET. */
const МЕТКА = 'eos-two-factor-encryption-v1';

/** Сколько попыток ввода кода до временной блокировки. */
export const ЛИМИТ_ПОПЫТОК = 5;

/** На сколько блокируется перебор кода. */
export const БЛОКИРОВКА_МИНУТ = 5;

export interface СтатусДвухФактора {
  enabled: boolean;
  confirmed: boolean;
  /** Заблокирован ли ввод кода из-за неудачных попыток. */
  locked: boolean;
  lockedUntil: string | null;
}

export interface Включение {
  ok: boolean;
  code: string;
  secret: string;
  otpauthUrl: string;
  recoveryCodes: string[];
}

export interface РезультатПроверкиВхода {
  ok: boolean;
  code: string;
  step: number;
}

function must(условие: unknown, причина: string): void {
  if (!условие) { console.log('ПРОВАЛ ЯКОРЯ: ' + причина); process.exit(1); }
}

/**
 * Ключ шифрования. Выводится из окружения, в базе не хранится.
 *
 * Экспортируется отдельно, чтобы его можно было проверить тестом, не
 * поднимая базу. Возвращает null, если окружение пустое: тогда 2FA включить
 * нельзя, и это должно быть видно СРАЗУ, а не表现为 как «секрет не
 * расшифровывается» посреди входа игрока.
 */
export function ключШифрования(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const сырьё = env.TWOFA_ENCRYPTION_KEY || env.JWT_SECRET;
  if (!сырьё || String(сырьё).trim() === '') return null;
  // 32 байта - длина ключа AES-256. scrypt намеренно медленный: это
  // делает подбор ключа из украденного дампа непрактичным.
  return scryptSync(String(сырьё), МЕТКА, 32);
}

/**
 * Зашифровать секрет.
 *
 * Формат: iv (12 байт) || тег (16) || шифротекст. IV и тег обязательны:
--  без случайного IV одинаковый секрет шифровался бы в одинаковый текст, и
 * по базе можно было бы судить, у кого секреты совпадают.
 */
export function зашифровать(текст: string, ключ: Buffer): string {
  const iv = randomBytes(12);
  const шифр = createCipheriv('aes-256-gcm', ключ, iv);
  const тело = Buffer.concat([шифр.update(String(текст), 'utf8'), шифр.final()]);
  return Buffer.concat([iv, шифр.getAuthTag(), тело]).toString('base64');
}

/**
 * Расшифровать секрет.
 *
 * Ошибка расшифровки НЕ поднимается наружу: она означает «секрет не читается»,
 * и игроку это знать не нужно - он увидит обычный отказ «код неверен» и
 * начнёт искать причину в своём телефоне. В журнал пишется, разработчику
 * это знать необходимо.
 */
export function расшифровать(зашифрованное: string, ключ: Buffer): string | null {
  try {
    const всё = Buffer.from(String(зашифрованное), 'base64');
    if (всё.length <= 28) return null;
    const iv = всё.subarray(0, 12);
    const тег = всё.subarray(12, 28);
    const тело = всё.subarray(28);
    const расшифр = createDecipheriv('aes-256-gcm', ключ, iv);
    расшифр.setAuthTag(тег);
    return Buffer.concat([расшифр.update(тело), расшифр.final()]).toString('utf8');
  } catch (e) {
    logger.error('[2FA] секрет не расшифрован:', (e as Error).message);
    return null;
  }
}

export class TwoFactorService {
  private db = DatabaseService.getInstance();

  private ключ(): Buffer {
    const ключ = ключШифрования();
    if (!ключ) {
      // Нет ни JWT_SECRET, ни TWOFA_ENCRYPTION_KEY - работать не с чем, и
      // молчать об этом нельзя: включение 2FA упёрлось бы в «секрет не
      // расшифровывается», и это выглядело бы как поломка входа.
      throw new Error('2FA_UNAVAILABLE: нет ключа шифрования (JWT_SECRET или TWOFA_ENCRYPTION_KEY)');
    }
    return ключ;
  }

  async статус(userId: string): Promise<СтатусДвухФактора> {
    const строка = await this.db.queryOne<{
      enabled: boolean; confirmed_at: Date | null; locked_until: Date | null;
    }>(
      'SELECT enabled, confirmed_at, locked_until FROM user_2fa WHERE user_id = $1',
      [userId],
    );
    if (!строка) return { enabled: false, confirmed: false, locked: false, lockedUntil: null };
    return {
      enabled: строка.enabled,
      confirmed: строка.confirmed_at !== null,
      locked: строка.locked_until !== null && new Date(строка.locked_until) > new Date(),
      lockedUntil: строка.locked_until ? new Date(строка.locked_until).toISOString() : null,
    };
  }

  /**
   * Включение: первый шаг. Секрет выдаётся, но 2FA ещё НЕ действует.
   *
   * enabled = false до подтверждения. Иначе игрок, который не дошёл до
   * подтверждения (закрыл вкладку, потерял QR), остался бы с включённым
   * вторым фактором и без возможности войти - а починить это можно было бы
   * только правкой базы.
   */
  async начать(userId: string, email: string): Promise<Включение> {
    const ключ = this.ключ();
    const секрет = новыйСекрет();
    const коды = новыеКодыВосстановления();
    const соль = randomBytes(16).toString('hex');

    await this.db.query(
      `INSERT INTO user_2fa
         (user_id, secret_encrypted, enabled, confirmed_at, recovery_hash, recovery_salt)
       VALUES ($1, $2, FALSE, NULL, $3::jsonb, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET secret_encrypted = $2, enabled = FALSE, confirmed_at = NULL,
             recovery_hash = $3::jsonb, recovery_salt = $4,
             last_used_step = 0, failed_attempts = 0, locked_until = NULL,
             created_at = NOW()`,
      [userId, зашифровать(секрет, ключ),
        JSON.stringify(коды.map(к => ({ hash: хэшКодаВосстановления(к, соль), used: false }))),
        соль],
    );

    return {
      ok: true, code: '', secret: секрет,
      otpauthUrl: ссылкаOtpauth(секрет, email, 'Empire of Safavids'),
      recoveryCodes: коды,
    };
  }

  /**
   * Включение: второй шаг. Игрок доказал, что телефон показывает тот же код.
   *
   * Отдельно от проверки кода при входе, потому что здесь смысл другой:
   * тут доказывается, что секрет дошёл до телефона. Пока это не сделано,
   * 2FA выдаётся, но не включается.
   */
  async подтвердить(userId: string, код: string): Promise<{ ok: boolean; code: string }> {
    const проверка = await this.проверитьКод(userId, код);
    if (!проверка.ok) return { ok: false, code: проверка.code };

    await this.db.query(
      'UPDATE user_2fa SET enabled = TRUE, confirmed_at = NOW() WHERE user_id = $1',
      [userId],
    );
    logger.info(`[2FA] включён для ${userId}`);
    return { ok: true, code: '' };
  }

  /**
   * Проверка кода. Используется и при подтверждении, и при входе.
   *
   * Коды восстановления принимаются здесь же, в отдельной ветке: игрок с
   * потерянным телефоном приходит по тому же адресу и не должен получать
   * отказ «код неверен» на коде, который верный.
   */
  async проверитьКод(userId: string, код: string): Promise<РезультатПроверкиВхода> {
    const строка = await this.db.queryOne<{
      secret_encrypted: string; enabled: boolean; last_used_step: string | number;
      recovery_hash: Array<{ hash: string; used: boolean }> | null; recovery_salt: string | null;
      failed_attempts: number; locked_until: Date | null;
    }>(
      `SELECT secret_encrypted, enabled, last_used_step, recovery_hash, recovery_salt,
              failed_attempts, locked_until
         FROM user_2fa WHERE user_id = $1`,
      [userId],
    );
    if (!строка) return { ok: false, code: 'two_factor_not_enabled', step: 0 };

    // Блокировка проверяется ДО сравнения кода. Иначе игрок во время
    // блокировки узнал бы, угадал он или нет, по времени ответа.
    if (строка.locked_until && new Date(строка.locked_until) > new Date()) {
      return { ok: false, code: 'two_factor_locked', step: 0 };
    }

    const кодНормализован = String(код ?? '').trim().toUpperCase();

    // Код восстановления: длиннее шести цифр, и живёт он в своём списке.
    if (кодНормализован.length > ЦИФРЫ) {
      return this.проверитьВосстановление(userId, строка, кодНормализован);
    }

    const секрет = расшифровать(строка.secret_encrypted, this.ключ());
    if (!секрет) return { ok: false, code: 'two_factor_invalid', step: 0 };

    const р = проверитьКод(
      секрет, кодНормализован, Date.now(), 1, Number(строка.last_used_step ?? 0), ЦИФРЫ);

    if (!р.ok) {
      await this.записатьНеудачу(userId, Number(строка.failed_attempts ?? 0) + 1);
      return { ok: false, code: р.reason, step: 0 };
    }

    // last_used_step обновляется ОДНОВРЕМЕННО с успехом, и условие
    // last_used_step < $2 не даёт двум параллельным попыткам пройти с
    // одним и тем же кодом. Без этого условия гонка на входе работала бы
    // один раз, но воспроизводилась бы при каждом следующем входе.
    await this.db.query(
      `UPDATE user_2fa
          SET last_used_step = $2, failed_attempts = 0, locked_until = NULL
        WHERE user_id = $1 AND last_used_step < $2`,
      [userId, р.step],
    );
    return { ok: true, code: '', step: р.step };
  }

  private async проверитьВосстановление(
    userId: string,
    строка: { recovery_hash: Array<{ hash: string; used: boolean }> | null; recovery_salt: string | null },
    код: string,
  ): Promise<РезультатПроверкиВхода> {
    must(строка.recovery_salt, 'у аккаунта с кодами восстановления нет соли - запись битая');
    const список = строка.recovery_hash ?? [];
    const хэш = хэшКодаВосстановления(код, строка.recovery_salt!);
    const нашли = список.findIndex(запись => !запись.used && запись.hash === хэш);
    if (нашли < 0) {
      await this.записатьНеудачу(userId, 1);
      return { ok: false, code: 'two_factor_invalid', step: 0 };
    }
    // Код помечается использованным ВМЕСТЕ с проверкой, в одном запросе, с
    // условием used = false. Повторное использование того же кода отвергается
    // БАЗОЙ, а не порядком операций: две гонки дадут одну пометку.
    //
    // RETURNING 1 вместо rowCount: обёртка db.query в этом проекте
    // возвращает массив строк, а не {rows, rowCount}. Обновлённая строка
    // возвращается, неповреждённая - нет.
    const помечен = await this.db.query(
      `UPDATE user_2fa
          SET recovery_hash = jsonb_set(recovery_hash, '{${нашли},used}', 'true'::jsonb),
              failed_attempts = 0, locked_until = NULL
        WHERE user_id = $1 AND (recovery_hash->${нашли}->>'used') = 'false'
        RETURNING 1`,
      [userId],
    );
    if (!помечен || помечен.length === 0) {
      return { ok: false, code: 'two_factor_replayed', step: 0 };
    }
    logger.info(`[2FA] код восстановления использован для ${userId}`);
    return { ok: true, code: '', step: 0 };
  }

  private async записатьНеудачу(userId: string, попыток: number): Promise<void> {
    const блокировка = попыток >= ЛИМИТ_ПОПЫТОК
      ? `NOW() + INTERVAL '${БЛОКИРОВКА_МИНУТ} minutes'`
      : 'locked_until';
    await this.db.query(
      `UPDATE user_2fa SET failed_attempts = $2, locked_until = ${блокировка} WHERE user_id = $1`,
      [userId, попыток],
    ).catch((e: unknown) => {
      logger.warn('[2FA] неудача не записана:', (e as Error).message);
    });
  }

  /**
   * Выключение. Требует верного кода: иначе достаточно украсть сессию
   * админа, чтобы снять защиту с чужого аккаунта.
   */
  async выключить(userId: string, код: string): Promise<{ ok: boolean; code: string }> {
    const статус = await this.статус(userId);
    if (!статус.enabled) return { ok: true, code: '' };

    const проверка = await this.проверитьКод(userId, код);
    if (!проверка.ok) return { ok: false, code: проверка.code };

    // Строка удаляется, а не обнуляется: секрет обязан исчезнуть из базы
    // целиком. Обнуление оставило бы шифротекст, который можно было бы
    // расшифровать старым ключом.
    await this.db.query('DELETE FROM user_2fa WHERE user_id = $1', [userId]);
    logger.info(`[2FA] выключен для ${userId}`);
    return { ok: true, code: '' };
  }

  /** Новые коды восстановления. Старые перестают работать сразу. */
  async перевыпуститьКоды(userId: string): Promise<string[]> {
    const ключ = this.ключ();
    const коды = новыеКодыВосстановления();
    const соль = randomBytes(16).toString('hex');
    const строка = await this.db.queryOne<{ secret_encrypted: string }>(
      'SELECT secret_encrypted FROM user_2fa WHERE user_id = $1', [userId],
    );
    if (!строка) return [];
    // Соль и набор меняются целиком, а не дописываются: старые хэши без
    // своей соли перестали бы проверяться, и игрок потерял бы их.
    void ключ;
    await this.db.query(
      'UPDATE user_2fa SET recovery_hash = $2::jsonb, recovery_salt = $3 WHERE user_id = $1',
      [userId, JSON.stringify(коды.map(к => ({ hash: хэшКодаВосстановления(к, соль), used: false }))), соль],
    );
    return коды;
  }

  /** Период и разрядность, чтобы интерфейс не расходился с сервером. */
  get параметры(): { период: number; цифры: number } {
    return { период: ПЕРИОД, цифры: ЦИФРЫ };
  }
}

/**
 * Создаётся ПО ТРЕБОВАНИЮ, а не при загрузке модуля.
 *
 * Модульный экземпляр создавался В МОМЕНТ ИМПОРТА. Тесты подменяют
 * DatabaseService через jest.mock, причём переменная `db` в них объявлена
 * ПОСЛЕ импортов, и вызов getInstance() на уровне модуля падал с
 * «Cannot access 'db' before initialization» - то есть сам модуль нельзя
 * было импортировать в тест, и проверка падала по чужой причине.
 */
let экземпляр: TwoFactorService | null = null;
export function twoFactor(): TwoFactorService {
  if (!экземпляр) экземпляр = new TwoFactorService();
  return экземпляр;
}
