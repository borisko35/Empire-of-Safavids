// ============================================================
// Личные поручения — Empire of Safavids
// ============================================================
// Потребитель слоя наблюдений (§365): мир заметил, что игрок делает чаще, —
// и НПС, связанный с этим делом, предлагает личное поручение. Третий пункт
// 9-C: «предложение на основании наблюдения за привычками игрока».
//
// ПОЧЕМУ ПРОГРЕСС ЛЕНИВЫЙ. Поручение хранит базовую линию — счётчик
// наблюдений на момент принятия; прогресс = текущий счётчик минус база.
// Никаких новых крючков в бой: наблюдение (§365) уже считает каждое дело
// в единой точке, и поручение не может разойтись с наблюдением по
// построению. Кэш прогресса в строке разошёлся бы с первой же минуты.
//
// ПОЧЕМУ ШАБЛОНЫ ДЕРЖАТ NПС. Поручение персонально по ВИДУ дела: охотнику
// предлагает стражник, торговцу — купец. Настоящая ветвящаяся беседа с
// этими НПС — следующий кусок; здесь поручение предлагается панелью задач
// от имени НПС, чьё имя лежит в шаблоне.
import { DatabaseService } from '../services/DatabaseService';
import { CharacterService } from '../services/CharacterService';
import { наблюдения } from './PlayerObservations';
import type { RepKind } from './ReputationGrants';

export interface ErrandTemplate {
  kind: RepKind;
  /** id для отладки; игроку показывается titleRu/title (у задач тот же приём) */
  id: string;
  title: string;
  titleRu: string;
  desc: string;
  descRu: string;
  /** Кто предлагает: имя НПС из реестра, знакомого игроку */
  npcRu: string;
  npc: string;
  target: number;
  rewardGold: number;
  rewardExp: number;
}

/**
 * Шаблоны по шести видам наблюдения — ровно по одному на каждый.
 *
 * Числа — ВЫБОР по меркам задач дня (150–500 золота, цели 2–20): личное
 * поручение окно длиннее суточной задачи, поэтому платит чуть выше верхней
 * границы и просит чуть больше. НПС соответствуют фракциям, которые эти
 * дела замечают (см. REP в ReputationGrants).
 */
export const ERRAND_TEMPLATES: readonly ErrandTemplate[] = [
  { kind: 'monsterKill', id: 'errand_road', title: 'Bandits on the roads', titleRu: 'Разбойники на дорогах', desc: 'Cut down the bandits haunting the roads', descRu: 'Руби разбойников, что завелись на дорогах', npcRu: 'Стражник Рустам', npc: 'Guard Rustam', target: 20, rewardGold: 400, rewardExp: 800 },
  { kind: 'dungeonClear', id: 'errand_dark', title: 'Into the dark', titleRu: 'Спуск в темноту', desc: 'Clear dungeons the Order cannot ignore', descRu: 'Пройди подземелья, мимо которых Орден не пройдёт', npcRu: 'Стражник Рустам', npc: 'Guard Rustam', target: 3, rewardGold: 600, rewardExp: 1200 },
  { kind: 'questDone', id: 'errand_word', title: 'A word kept', titleRu: 'Долг слову', desc: 'Finish what the story asks of you', descRu: 'Доведи до конца то, о чём просит история', npcRu: 'Суфий Мевлана', npc: 'Sufi Mevlana', target: 5, rewardGold: 400, rewardExp: 800 },
  { kind: 'pvpWin', id: 'errand_blade', title: 'Proof of the blade', titleRu: 'Проверка клинка', desc: 'Win duels the Shadow deems worthy', descRu: 'Одержи победы, достойные внимания Тени', npcRu: 'Наставник Тени', npc: 'Shadow Mentor', target: 5, rewardGold: 500, rewardExp: 1000 },
  { kind: 'auctionSale', id: 'errand_voice', title: 'The voice of trade', titleRu: 'Голос торга', desc: 'Sell wares until the Guild knows your name', descRu: 'Продай товар так, чтобы Гильдия узнала тебя', npcRu: 'Торговец Джафар', npc: 'Merchant Jafar', target: 10, rewardGold: 400, rewardExp: 800 },
  { kind: 'tradeDone', id: 'errand_road_call', title: 'The road calls', titleRu: 'Дорога зовёт', desc: 'Carry contracts along the Silk Road', descRu: 'Сноси контракты по Шёлковому пути', npcRu: 'Торговец Джафар', npc: 'Merchant Jafar', target: 5, rewardGold: 500, rewardExp: 1000 },
];

function шаблон(kind: string): ErrandTemplate | null {
  return ERRAND_TEMPLATES.find((t) => t.kind === kind) ?? null;
}

export interface ErrandStatus {
  /** Поручения нет: новичок или всё сдано — можно предложить новое */
  state: 'none' | 'active' | 'done';
  template: ErrandTemplate | null;
  progress: number;
  target: number;
  rewardGold: number;
  rewardExp: number;
}

export class PersonalErrands {
  private db = DatabaseService.getInstance();
  private characters = new CharacterService();

  /** Текущее состояние поручения персонажа. */
  async status(characterId: string): Promise<ErrandStatus> {
    const rows = await this.db.query<{ kind: string; target: number; base_count: number }>(
      'SELECT kind, target, base_count FROM personal_errands WHERE character_id = $1',
      [characterId],
    );
    const строка = rows[0];
    if (!строка) {
      return { state: 'none', template: null, progress: 0, target: 0, rewardGold: 0, rewardExp: 0 };
    }
    const шаблонP = шаблон(строка.kind);
    if (!шаблонP) {
      // Данные шаблона ушли вперёд строк в базе: поручение зависло бы
      // вечно. Честно снять его — игрок примет новое.
      await this.db.query('DELETE FROM personal_errands WHERE character_id = $1', [characterId]);
      return { state: 'none', template: null, progress: 0, target: 0, rewardGold: 0, rewardExp: 0 };
    }
    const профиль = await наблюдения.profile(characterId);
    const progress = Math.max(0, (профиль.counts[строка.kind] ?? 0) - строка.base_count);
    const готово = progress >= строка.target;
    return {
      state: готово ? 'done' : 'active',
      template: шаблонP,
      progress,
      target: строка.target,
      rewardGold: шаблонP.rewardGold,
      rewardExp: шаблонP.rewardExp,
    };
  }

  /**
   * Принять поручение по верхнему делу профиля.
   *
   * Персональность здесь и есть: шаблон выбирается тем, что мир заметил,
   * а не меню. База — текущий счётчик: прежние заслуги в прогресс не идут.
   */
  async accept(characterId: string): Promise<{ ok: true; template: ErrandTemplate } | { ok: false; code: string }> {
    const active = await this.status(characterId);
    if (active.state === 'active' || active.state === 'done') return { ok: false, code: 'errand_already_active' };

    const профиль = await наблюдения.profile(characterId);
    if (!профиль.top) return { ok: false, code: 'errand_no_profile' };
    const шаблонP = шаблон(профиль.top);
    if (!шаблонP) return { ok: false, code: 'errand_no_profile' };

    await this.db.query(
      'INSERT INTO personal_errands (character_id, kind, target, base_count) VALUES ($1, $2, $3, $4)',
      [characterId, шаблонP.kind, шаблонP.target, профиль.counts[шаблонP.kind] ?? 0],
    );
    return { ok: true, template: шаблонP };
  }

  /**
   * Сдать поручение и выдать награду.
   *
   * Золото через addGoldReward (сезонный множитель — правило проекта),
   * опыт через addExperience. Строка удаляется: награда выдана, поручение
   * больше не активно, следующее появится на новом верхнем деле.
   */
  async claim(characterId: string): Promise<{ ok: true; gold: number; exp: number } | { ok: false; code: string }> {
    const active = await this.status(characterId);
    if (active.state === 'none') return { ok: false, code: 'errand_not_active' };
    if (active.state !== 'done') return { ok: false, code: 'errand_not_done' };
    const шаблонP = active.template!;
    if (!шаблонP) return { ok: false, code: 'errand_not_active' };

    await this.characters.addGoldReward(characterId, шаблонP.rewardGold);
    await this.characters.addExperience(characterId, шаблонP.rewardExp);
    await this.db.query('DELETE FROM personal_errands WHERE character_id = $1', [characterId]);
    return { ok: true, gold: шаблонP.rewardGold, exp: шаблонP.rewardExp };
  }
}

export const поручения = new PersonalErrands();
