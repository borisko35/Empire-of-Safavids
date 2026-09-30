// Хранение эффектов монстров на игроке.
//
// ГРАНИЦА С ЧИСТЫМ МОДУЛЕМ. MonsterEffects решает, КАКОЙ эффект и с
// каким уроном, и не знает про базу. Этот сервис знает про базу и не
// решает ничего: он берёт готовый план и записывает его. Если бы решение
// переехало сюда, единственной его проверкой стал бы поиск по тексту
// файла - см. комментарий в MonsterEffects.
import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';
import {
  accruedDamage, accruedTicks, slowMultiplier, type DebuffKind, type DebuffPlan,
} from '../systems/MonsterEffects';

export interface ActiveDebuff {
  debuffId: string;
  kind: DebuffKind;
  magnitude: number;
  tickDamage: number;
  expiresAt: number;
  sourceInstance: string | null;
}

export interface TickResult {
  characterId: string;
  /** Сколько урона набежало за это время по всем эффектам. */
  damage: number;
  /** Что игрок увидит: иконки и оставшееся время. */
  debuffs: ActiveDebuff[];
}

export class DebuffService {
  private db = DatabaseService.getInstance();

  /**
   * Навесить эффект от удара монстра.
   *
   * Повторный удар тем же эффектом ПРОДЛЕВАЕТ срок, а не кладёт вторую
   * строку. Ключ в таблице - (персонаж, вид эффекта), поэтому «Рана» от
   * «Укуса» не копится: десять укусов за минуту дают одну рану, а не
   * десять. Иначе суммарный урон рос бы с числом попаданий, и монстр
   * становился бы тем сильнее, чем чаще бьёт, - а он и так бьёт по
   * кулдауну.
   */
  async apply(
    characterId: string,
    plan: DebuffPlan,
    sourceInstance: string | null,
    now: number = Date.now(),
  ): Promise<void> {
    if (!plan) return;
    try {
      await this.db.query(
        `INSERT INTO character_debuffs
           (character_id, debuff_id, kind, magnitude, tick_damage,
            source_instance, applied_at, expires_at, last_tick_at)
         VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), to_timestamp($8 / 1000.0), to_timestamp($7 / 1000.0))
         ON CONFLICT (character_id, debuff_id) DO UPDATE SET
           magnitude = EXCLUDED.magnitude,
           tick_damage = EXCLUDED.tick_damage,
           expires_at = EXCLUDED.expires_at,
           -- last_tick_at НЕ двигаем на каждый повтор. Иначе продление
           -- сбрасывало бы накопленный урон: рана, продлённая вторым
           -- укусом в момент, когда тик ещё не успел, никогда бы не
           -- накопила урона за всё время.
           source_instance = EXCLUDED.source_instance`,
        [
          characterId,
          plan.debuffId,
          plan.kind,
          plan.magnitude,
          plan.tickDamage,
          sourceInstance,
          now,
          now + plan.durationMs,
        ],
      );
    } catch (err) {
      // Эффект - украшение удара, а не условие боя. База мигнула: игрок
      // получает урон без отравления, и это переживаемо. Обратное - урон
      // без удара - было бы хуже.
      logger.warn('[Debuff] не применён:', (err as Error).message);
    }
  }

  /** Что сейчас висит на персонаже. Истёкшие не возвращаются. */
  async active(characterId: string): Promise<ActiveDebuff[]> {
    const rows = await this.db.query<{
      debuff_id: string; kind: DebuffKind; magnitude: number;
      tick_damage: number; expires_at: Date; source_instance: string | null;
    }>(
      `SELECT debuff_id, kind, magnitude, tick_damage, expires_at, source_instance
         FROM character_debuffs
        WHERE character_id = $1 AND expires_at > NOW()`,
      [characterId],
    );
    return rows.map(r => ({
      debuffId: r.debuff_id,
      kind: r.kind,
      magnitude: Number(r.magnitude ?? 0),
      tickDamage: Number(r.tick_damage ?? 0),
      expiresAt: r.expires_at instanceof Date ? r.expires_at.getTime() : Number(r.expires_at),
      sourceInstance: r.source_instance ?? null,
    }));
  }

  /**
   * Оглушён ли персонаж.
   *
   * Отдельный быстрый запрос вместо active() со сканированием списка:
   * проверка стоит на каждом боевом пакете, и идти за полным списком
   * ради одного «да/нет» расточительно.
   */
  async isStunned(characterId: string): Promise<boolean> {
    const row = await this.db.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM character_debuffs
        WHERE character_id = $1 AND kind = 'stun' AND expires_at > NOW()`,
      [characterId],
    );
    return Number(row?.n ?? 0) > 0;
  }

  /** Замедление игрока: 1 - идёт как обычно, меньше 1 - медленнее. */
  async speedMultiplier(characterId: string): Promise<number> {
    const rows = await this.db.query<{ magnitude: number }>(
      `SELECT magnitude FROM character_debuffs
        WHERE character_id = $1 AND kind = 'slow' AND expires_at > NOW()`,
      [characterId],
    );
    return slowMultiplier(rows.map(r => Number(r.magnitude ?? 0)));
  }

  /**
   * Начислить урон со временем и снять протухшие эффекты.
   *
   * Возвращает НОЛЬ, а не бросает, если эффектов нет: вызывается из
   * игрового цикла на каждого игрока в регионе, и отсутствие эффекта -
   * самый частый случай, а не сбой.
   */
  async settle(characterId: string, now: number = Date.now()): Promise<TickResult> {
    const пусто: TickResult = { characterId, damage: 0, debuffs: [] };
    let строки: Array<{
      debuff_id: string; kind: DebuffKind; magnitude: number; tick_damage: number;
      expires_at: Date; last_tick_at: Date; source_instance: string | null;
    }> = [];
    try {
      строки = await this.db.query<typeof строки[number]>(
        `SELECT debuff_id, kind, magnitude, tick_damage, expires_at, last_tick_at, source_instance
           FROM character_debuffs
          WHERE character_id = $1 AND expires_at > NOW()`,
        [characterId],
      );
    } catch (err) {
      logger.warn('[Debuff] не прочитан:', (err as Error).message);
      return пусто;
    }
    if (!строки.length) {
      await this.clearExpired(characterId).catch(() => {});
      return пусто;
    }

    let всегоУрона = 0;
    const осталось: ActiveDebuff[] = [];
    const двигать: { id: string; lastTickAt: number }[] = [];

    for (const r of строки) {
      const expiresAt = r.expires_at instanceof Date ? r.expires_at.getTime() : Number(r.expires_at);
      const lastTickAt = r.last_tick_at instanceof Date ? r.last_tick_at.getTime() : Number(r.last_tick_at);
      // Период тика разный: кровотечение раз в секунду, яд раз в две.
      // У оглушения, замедления и страха периода нет вовсе - тиков 0, и
      // accruedTicks честно вернёт ноль на нулевом периоде.
      const период = r.kind === 'poison' ? 2000 : r.kind === 'bleed' ? 1000 : 0;
      const сколько = accruedTicks(now, lastTickAt, период, expiresAt);
      if (сколько > 0) {
        всегоУрона += accruedDamage(сколько, Number(r.tick_damage ?? 0));
        двигать.push({ id: r.debuff_id, lastTickAt: lastTickAt + сколько * период });
      }
      осталось.push({
        debuffId: r.debuff_id,
        kind: r.kind,
        magnitude: Number(r.magnitude ?? 0),
        tickDamage: Number(r.tick_damage ?? 0),
        expiresAt,
        sourceInstance: r.source_instance ?? null,
      });
    }

    // last_tick_at двигаем ДО начисления, а не после: если игрок умер от
    // этого урона и сервер перезапустился, урон не начислился бы снова
    // с того же места. Остаток от деления теряется - сумма за все секунды
    // не должна зависеть от того, как часто сервер заглядывал.
    for (const d of двигать) {
      await this.db.query(
        `UPDATE character_debuffs SET last_tick_at = to_timestamp($1 / 1000.0)
          WHERE character_id = $2 AND debuff_id = $3`,
        [d.lastTickAt, characterId, d.id],
      ).catch((e: unknown) => logger.warn('[Debuff] last_tick_at:', (e as Error).message));
    }
    await this.clearExpired(characterId).catch(() => {});

    return { characterId, damage: всегоУрона, debuffs: осталось };
  }

  /** Снять всё: смерть, смена региона, выход из игры. */
  async clear(characterId: string): Promise<void> {
    await this.db.query('DELETE FROM character_debuffs WHERE character_id = $1', [characterId])
      .catch((e: unknown) => logger.warn('[Debuff] не очищены:', (e as Error).message));
  }

  private async clearExpired(characterId: string): Promise<void> {
    await this.db.query('DELETE FROM character_debuffs WHERE character_id = $1 AND expires_at <= NOW()', [characterId]);
  }
}

export const debuffs = new DebuffService();
