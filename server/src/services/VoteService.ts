// Голосование на рейтинговом сайте browsermmorpg.com: факт голоса и награда.
//
// ЗАЧЕМ. Голос на рейтинговом сайте поднимает игру в списке, а награда за него
// — причина возвращаться. Но без записи в базе голос неотличим от клика: игрок
// нажал кнопку, а игра об этом не узнала. Награду нельзя было ни выдать, ни
// ограничить по времени — то есть обещание «проголосуй и получи» было обещанием
// ни на чём.
//
// ЧТО ЗДЕСЬ. Одна строка на персонажа: когда голос отдан и сколько наград
// получено. Кулдаун — 12 часов, как принято на рейтинговых сайтах; раньше
// награду не даём, но и не молчим: возвращаем, через сколько можно снова.
//
// ПОЧЕМУ ОДНА СТРОКА, А НЕ ИСТОРИЯ ГОЛОСОВ. История нужна для статистики, а не
// для награды; её можно добавить позже, не трогая эту таблицу. Пока важно
// одно: голос учтён и награда выдана ровно один раз.
import { DatabaseService } from './DatabaseService';
import { CharacterService } from './CharacterService';

/** Кулдаун между голосами. 12 часов — стандарт рейтинговых сайтов. */
export const КУЛДАУН_ГОЛОСА_МС = 12 * 60 * 60 * 1000;

/** Сколько золота даёт один голос. */
export const НАГРАДА_ЗА_ГОЛОС = 500;

export interface СтатусГолоса {
  /** Можно ли голосовать прямо сейчас. */
  canVote: boolean;
  /** Когда можно голосовать снова (ISO). null, если можно сейчас. */
  nextVoteAt: string | null;
  /** Сколько наград за голоса получил персонаж. */
  rewardsClaimed: number;
}

export type ИтогГолоса =
  | { ok: true; gold: number; nextVoteAt: string }
  | { ok: false; code: 'cooldown' | 'no_character'; nextVoteAt?: string };

export class VoteService {
  private static instance: VoteService;
  private db = DatabaseService.getInstance();

  static getInstance(): VoteService {
    if (!VoteService.instance) VoteService.instance = new VoteService();
    return VoteService.instance;
  }

  /** Статус без записи: читается только строка, ничего не меняется. */
  async status(characterId: string): Promise<СтатусГолоса> {
    const строка = await this.db.queryOne<{ voted_at: string; rewards_claimed: number }>(
      'SELECT voted_at, rewards_claimed FROM player_votes WHERE character_id = $1',
      [characterId],
    );
    if (строка === null) {
      return { canVote: true, nextVoteAt: null, rewardsClaimed: 0 };
    }
    const следующий = new Date(new Date(строка.voted_at).getTime() + КУЛДАУН_ГОЛОСА_МС);
    const сейчас = Date.now();
    return {
      canVote: следующий.getTime() <= сейчас,
      nextVoteAt: следующий.toISOString(),
      rewardsClaimed: Number(строка.rewards_claimed),
    };
  }

  /**
   * Засчитать голос и выдать награду.
   *
   * Порядок: сначала запись факта, потом золото. Обратный порядок дал бы
   * золото дважды, если бы запись упала: игрок получил бы и золото, и право
   * получить его снова.
   *
   * Запись идёт через INSERT ... ON CONFLICT DO NOTHING RETURNING: строка
   * возвращается только при первой попытке. Второй запрос на награду получает
   * пустой ответ и отказ, даже если два нажатия пришли одновременно.
   */
  async vote(characterId: string): Promise<ИтогГолоса> {
    const персонаж = await new CharacterService().getCharacterById(characterId);
    if (!персонаж) return { ok: false, code: 'no_character' };

    const вставлено = await this.db.queryOne<{ voted_at: string }>(
      `INSERT INTO player_votes (character_id, voted_at, rewards_claimed)
       VALUES ($1, NOW(), 1)
       ON CONFLICT (character_id) DO NOTHING
       RETURNING voted_at`,
      [characterId],
    );
    if (вставлено === null) {
      // Уже голосовал: когда можно снова, чтобы игрок не гадал.
      const статус = await this.status(characterId);
      return { ok: false, code: 'cooldown', nextVoteAt: статус.nextVoteAt ?? undefined };
    }

    // Награда — через addGoldReward, а не addGold: это награда, и сезонный
    // бонус к золоту к ней относится так же, как к остальным наградам.
    await new CharacterService().addGoldReward(characterId, НАГРАДА_ЗА_ГОЛОС);
    return {
      ok: true,
      gold: НАГРАДА_ЗА_ГОЛОС,
      nextVoteAt: new Date(
        new Date(вставлено.voted_at).getTime() + КУЛДАУН_ГОЛОСА_МС,
      ).toISOString(),
    };
  }
}