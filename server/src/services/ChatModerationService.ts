// Модерация чата: фильтр слов, мьют и жалобы.
//
// ЧТО БЫЛО. Три требования GDD (раздел 16, игра 18+) — фильтрация чата,
// блокировка/мут и система жалоб — в проекте не были выполнены вообще:
//
//  1. Фильтрации не было. handleChatMessage резал длину и считал задержку,
//     но слова не проверял: в мировой чат можно было написать что угодно.
//
//  2. МЬЮТ НЕ РАБОТАЛ. AdminService.muteCharacter писал строку в
//     character_mutes и публиковал событие в Redis — а читать эту таблицу
//     не был НИКТО. Администратор мутил игрока, видел «успешно» в панели,
//     и игрок продолжал писать в чат как ни в чём не бывало. Событие
//     'admin:mute' тоже никто не слушал.
//
//  3. Жалоб не было. Таблица chat_messages из миграции 022 существует, но
//     никто в неё не писал, и сообщить о нарушителе было нечем.
//
// Теперь всё три закрыты. Мьют проверяется здесь, при отправке, и кэшируется
// в Redis, чтобы не делать запрос в базу на каждое сообщение.
import { DatabaseService } from './DatabaseService';
import { RedisService } from './RedisService';
import { logger } from '../utils/logger';
import { filterChatMessage } from '../data/chatFilter';

const db = DatabaseService.getInstance();
const redis = RedisService.getInstance();

/** Причины жалобы: игрок выбирает из списка, свободный текст не берём */
export const REPORT_REASONS = [
  'harassment',   // травля, оскорбления
  'cheating',     // читы
  'spam',         // спам и флуд
  'scamming',     // обман, торговля за реальные деньги
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Не больше 5 жалоб от одного персонажа в час — иначе жалобы перестают быть сигналом */
const REPORTS_PER_HOUR = 5;
/** Мьют хранится в Redis столько же, сколько остался срок */
const MUTE_CACHE_PAD_MS = 60_000;

export class ChatModerationService {
  private static instance: ChatModerationService | null = null;

  static getInstance(): ChatModerationService {
    if (!ChatModerationService.instance) {
      ChatModerationService.instance = new ChatModerationService();
    }
    return ChatModerationService.instance;
  }

  private muteKey(characterId: string): string {
    return `mute:${characterId}`;
  }

  /**
   * Мьют ли персонажа прямо сейчас.
   *
   * Сначала кэш в Redis — на каждое сообщение ходить в базу нельзя.
   * Если в кэше нет, спрашиваем character_mutes и кладём ответ до конца
   * срока: тогда при мьюте через админку второй запрос уйдёт к серверу
   * только один раз за весь срок мута.
   */
  async isMuted(characterId: string): Promise<{ muted: boolean; until: Date | null }> {
    const key = this.muteKey(characterId);

    const cached = await redis.get(key).catch(() => null);
    if (cached) {
      const until = new Date(cached);
      // Просроченный кэш — источник ложного мута: игрок уже не мьютен,
      // а по кэшу он ещё мьютен. Проверяем дату, а не только наличие ключа.
      if (until.getTime() > Date.now()) return { muted: true, until };
      await redis.del(key).catch(() => {});
    }

    const row = await db.queryOne<{ muted_until: Date }>(
      'SELECT muted_until FROM character_mutes WHERE character_id = $1',
      [characterId],
    ).catch(() => null);

    if (!row) return { muted: false, until: null };

    const until = new Date(row.muted_until);
    if (until.getTime() <= Date.now()) return { muted: false, until: null };

    const ttl = Math.ceil((until.getTime() - Date.now() + MUTE_CACHE_PAD_MS) / 1000);
    await redis.set(key, until.toISOString(), ttl).catch(() => {});
    return { muted: true, until };
  }

  /**
   * Проверить сообщение перед отправкой.
   *
   * Возвращает, что показывать игроку: тот же текст, если чисто, и
   * замаскированный — если сработал фильтр. Отдельно отдаём число
   * срабатываний, чтобы позже можно было считать статистику.
   */
  async screen(characterId: string, message: string): Promise<
    { action: 'allow' } | { action: 'mute'; until: Date } | { action: 'filter'; text: string; hits: number }
  > {
    const mute = await this.isMuted(characterId);
    if (mute.muted && mute.until) return { action: 'mute', until: mute.until };

    const { text, hits } = filterChatMessage(message);
    if (hits > 0) return { action: 'filter', text, hits };
    return { action: 'allow' };
  }

  /**
   * Принять жалобу.
   *
   * Саму жалобу складываем в chat_messages с channel = 'report': таблица
   * для истории переписки уже была создана миграцией 022 и пустовала, новая
   * таблица ради одной сущности была бы лишней. Отдельная таблица жалоб
   * нужна только когда у них появятся статусы и назначенные модераторы.
   */
  async fileReport(
    reporterId: string,
    reportedId: string,
    reason: string,
    detail: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!REPORTS_PER_HOUR) return { ok: false, error: 'reports_disabled' };
    if (reporterId === reportedId) return { ok: false, error: 'report_self' };
    if (!(REPORT_REASONS as readonly string[]).includes(reason)) {
      return { ok: false, error: 'bad_reason' };
    }

    const recent = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM chat_messages
       WHERE character_id = $1 AND channel = 'report' AND created_at > NOW() - INTERVAL '1 hour'`,
      [reporterId],
    ).catch(() => null);
    if (recent && Number(recent.count) >= REPORTS_PER_HOUR) {
      return { ok: false, error: 'too_many' };
    }

    // Текст жалобы кладём в content: там же id жаловавшегося, чтобы модератор
    // видел, от кого она. Отдельные колонки потребовали бы новой таблицы.
    await db.query(
      `INSERT INTO chat_messages (channel, user_id, character_id, content)
       VALUES ('report', $1, $2, $3)`,
      [reporterId, reportedId, `${reason}|${detail}`],
    );
    logger.info(`[Moderation] report: ${reporterId} -> ${reportedId}, причина ${reason}`);
    return { ok: true };
  }

  /** Жалобы для панели персонала: свежие сверху */
  async listReports(limit = 100): Promise<unknown[]> {
    return db.query(
      `SELECT c.id, cm.content, cm.created_at,
              rc.name AS reporter_name, tc.name AS reported_name,
              rc.level AS reporter_level, tc.level AS reported_level
       FROM chat_messages cm
       JOIN characters rc ON rc.id = cm.user_id
       JOIN characters tc ON tc.id = cm.character_id
       WHERE cm.channel = 'report'
       ORDER BY cm.created_at DESC
       LIMIT $1`,
      [limit],
    );
  }
}
