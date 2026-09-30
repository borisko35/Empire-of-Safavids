// Награда за переход по рекламной ссылке: ссылка с настоящим
// идентификатором игрока и выдача золота ровно один раз.
//
// ПОЧЕМУ ЭТО НЕ ПРОСТО ССЫЛКА В HTML. Раньше на объявлении сайта стояла
// ссылка с буквальным текстом «?userid=PLAYER_ID» вместо идентификатора.
// Подставить его на статической странице нечем, и все игроки уходили в
// рекламную сеть с ОДНИМ И ТЕМ ЖЕ sub-id. Сети считают такой поток
// невалидным и блокируют аккаунт публишера, то есть ссылка приносила не
// доход, а потерю. Идентификатор подставляет сервер, потому что только он
// знает, кто вошёл.
//
// ВЫДАЧА ОДИН РАЗ, И ПРОВЕРЯЕТСЯ БАЗОЙ, А НЕ КОДОМ. Запись идёт через
// INSERT ... ON CONFLICT DO NOTHING RETURNING: строка возвращается только
// при первой попытке. Второй запрос на награду получает пустой ответ и
// отказ, даже если два нажатия пришли одновременно. Проверка «а заявлял ли
// игрок» в коде была бы проверкой с зазором: между SELECT и UPDATE другой
// запрос успевает вклиниться.
import { DatabaseService } from './DatabaseService';
import { CharacterService } from './CharacterService';

/** Ключ награды. Одна ссылка - один ключ, иначе можно было бы обойти запрет повторной выдачи. */
export const REWARD_KEY = 'browsermmorpg';

/** Сколько золота за переход. Число взято из текста объявления на сайте. */
export const REWARD_GOLD = 100;

/**
 * Адрес страницы перехода.
 *
 * В переменной окружения, а не в коде: при смене партнёрки или сети не
 * пришлось бы пересобирать образ. Пустое значение означает «ссылка не
 * настроена», и маршрут честно отвечает отказом, а не отдаёт битую ссылку.
 */
const PARTNER_URL =
  process.env.REWARD_PARTNER_URL ??
  'https://browsermmorpg.com/px/087bd24089ff03b6f2fd2bd5f0cc5594';

/** Заголовки, которые сеть требует на своей стороне. */
export function partnerConfigured(): boolean {
  return PARTNER_URL.trim().length > 0;
}

/**
 * Ссылка для конкретного игрока.
 *
 * Идентификатор подставляется ЗДЕСЬ и только здесь. В шаблоне подставлять
 * нечего - это единственное место, где известно, кто игрок.
 */
export function linkFor(characterId: string): string {
  const url = new URL(PARTNER_URL);
  url.searchParams.set('userid', characterId);
  return url.toString();
}

export type ClaimResult =
  | { ok: true; gold: number; alreadyClaimed: false }
  | { ok: false; code: 'already_claimed' | 'no_character' | 'no_link'; gold?: number };

export class RewardService {
  private db = DatabaseService.getInstance();

  /**
   * Выдать награду, если её ещё не было.
   *
   * Порядок: сначала запись факта, потом золото. Обратный порядок дал бы
   * золото дважды, если бы запись упала: игрок получил бы и золото, и
   * право получить его снова.
   *
   * Если золото не начислилось, запись остаётся - и повторная попытка
   * вернёт «уже получено». Это осознанный размен: игрок теряет 100 золота
   * один раз, но сайт не платит дважды и не позволяет набить награду
   * перезапуском. Альтернатива - откатывать запись, но тогда между
   * откатом и начислением снова появляется зазор.
   */
  async claim(characterId: string): Promise<ClaimResult> {
    if (!partnerConfigured()) return { ok: false, code: 'no_link' };

    const персонаж = await new CharacterService().getCharacterById(characterId);
    if (!персонаж) return { ok: false, code: 'no_character' };

    // Запись факта и проверка «уже было» - один запрос. ON CONFLICT DO
    // NOTHING без RETURNING вернул бы UPDATE 0 и на первый, и на второй
    // раз, и отличить их было бы нечем.
    const запись = await this.db.query<{ character_id: string; gold: number }>(
      `INSERT INTO reward_claims (character_id, reward_key, gold)
       VALUES ($1, $2, $3)
       ON CONFLICT (character_id, reward_key) DO NOTHING
       RETURNING character_id, gold`,
      [characterId, REWARD_KEY, REWARD_GOLD],
    );
    if (запись.length === 0) return { ok: false, code: 'already_claimed' };

    // ПОЧЕМУ ИГРОК МОЖЕТ ПОЛУЧИТЬ БОЛЬШЕ, ЧЕМ ОБЕЩАНО.
    // Выдача идёт через addGoldReward, который умножает на сезонный
    // множитель золота, а он считается как 1 + процент/100 и потому всегда
    // не меньше единицы. Во время праздника игрок получает 130 вместо 100 -
    // это подарок, а не недобор.
    //
    // Почему не addGold, который умножает ровно. Тогда обещание «100 золота»
    // выполнялось бы буквально, но игрок, который крафтит во время праздника,
    // получил бы 130, а по ссылке - 100. Одна и та же награда по двум разным
    // правилам - это ровно та двойная правда, из-за которой описание
    // расходится с выдачей.
    //
    // Меньше обещанного получить нельзя: множитель не опускается ниже 1.
    const новый = await new CharacterService().addGoldReward(characterId, REWARD_GOLD);
    return { ok: true, gold: новый, alreadyClaimed: false };
  }

  /** Получал ли игрок эту награду. Для панели: кнопка должна гаснуть. */
  async hasClaimed(characterId: string): Promise<boolean> {
    const row = await this.db.queryOne<{ n: number }>(
      'SELECT count(*) AS n FROM reward_claims WHERE character_id = $1 AND reward_key = $2',
      [characterId, REWARD_KEY],
    );
    return Number(row?.n ?? 0) > 0;
  }
}
