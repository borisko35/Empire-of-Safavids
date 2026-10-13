// ============================================================
// Караул — наём, состояние, участие в бою
// ============================================================
//
// ЗАЧЕМ. Сервис к таблице character_soldiers (миграция 078). Здесь три
// вещи, которые нельзя разложить на остальной код:
//
//   1. Наём за золото — с единственной настоящей проверкой «хватает ли».
//   2. Отдых. Солдат, которого полчаса не били, должен встать, иначе
//      караул умирает один раз и нанимать второго бессмысленно.
//   3. Вклад в урон. Солдаты бьют вместе с игроком, и их урон виден
//      отдельной строкой, а не растворяется в цифре игрока.
//
// ПОЧЕМУ НЕ ЧАСТЬ КОМБАТ-СЕРВИСА. CombatService считает урон по формуле
// «атакующий против цели», и формуле не известно, кто ещё стоит рядом.
// Караул — это про КТО рядом, а не про сколько считается, поэтому он и
// живёт отдельно, а CombatService о нём не знает.
//
// ПОЧЕМУ ЗДОРОВЬЕ В БАЗЕ, А НЕ В ПАМЯТИ. Игрок переподключается и ждёт
// перезагрузки сервера: состояние караула обязано пережить и то и
// другое. Плюс оно читается в панели, то есть должно быть там, где всё
// остальное состояние.
import { DatabaseService } from './DatabaseService';
import { CharacterService } from './CharacterService';
import {
  SOLDIERS,
  SOLDIER_TIERS,
  MAX_SOLDIERS,
  SoldierTier,
  SoldierDefinition,
  отдых,
} from '../data/soldiers';
import { logger } from '../utils/logger';

export interface SoldierRow {
  id: string;
  character_id: string;
  tier: SoldierTier;
  hp: number;
  max_hp: number;
  last_damage_at: Date;
  hired_at: Date;
}

/** Готовый к бою солдат: строка базы плюс то, что знает только сервер. */
export interface SoldierView extends SoldierRow {
  def: SoldierDefinition;
}

export interface HireResult {
  ok: boolean;
  reason?: 'no_gold' | 'limit' | 'unknown_tier' | 'level';
  /** Сколько осталось золота после найма. */
  gold?: number;
  soldier?: SoldierView;
}

export interface SoldierContribution {
  /** Идентификатор строки караула. */
  id: string;
  tier: SoldierTier;
  /** Сколько ударил. */
  damage: number;
  /** Убил ли насмерть. */
  killed: boolean;
}

/** За сколько минут покоя считается солдат «не получавшим урона». */
const ОТДЫХ_ПОРОГ_MS = 60_000;

export class SoldierService {
  private db = DatabaseService.getInstance();
  private characters = new CharacterService();

  /**
   * Привести здоровье к состоянию «сколько он намотан сейчас».
   *
   * Отдых считается при ЧТЕНИИ, а не отдельным тиком: иначе состояние
   * солдат, которыми никто не пользуется, тикало бы вхолостую, а после
   * перезапуска сервера отдых начинался бы с нуля.
   */
  private async применитьОтдых(строка: SoldierRow): Promise<SoldierRow> {
    if (строка.hp >= строка.max_hp) return строка;
    const прошло = Date.now() - new Date(строка.last_damage_at).getTime();
    if (прошло < ОТДЫХ_ПОРОГ_MS) return строка;
    const hp = отдых(строка.hp, строка.max_hp, прошло / 60000);
    if (hp === строка.hp) return строка;
    await this.db.query(
      `UPDATE character_soldiers SET hp = $2, updated_at = NOW() WHERE id = $1 AND hp < $3`,
      [строка.id, hp, строка.max_hp],
    );
    return { ...строка, hp };
  }

  async список(characterId: string): Promise<SoldierView[]> {
    const rows = await this.db.query<SoldierRow>(
      `SELECT id, character_id, tier, hp, max_hp, last_damage_at, hired_at
         FROM character_soldiers WHERE character_id = $1
        ORDER BY hired_at ASC`,
      [characterId],
    );
    const сОтдыхом = await Promise.all(rows.map((r) => this.применитьОтдых(r)));
    return сОтдыхом.map((r) => ({ ...r, def: SOLDIERS[r.tier] }));
  }

  /**
   * Нанять солдата.
   *
   * Порядок проверок важен и не переставляется:
   *
   *   доля известна → уровень → лимит → деньги → вставка
   *
   * Проверка лимита до денег: иначе игрок, у которого караул полон,
   * получал бы отказ «не хватает золота» на запрос, который всё равно
   * нельзя выполнить, и панель показывала бы несуществующую нехватку.
   */
  async нанять(characterId: string, tier: SoldierTier): Promise<HireResult> {
    const def = SOLDIERS[tier];
    if (!def) return { ok: false, reason: 'unknown_tier' };

    const персонаж = await this.characters.getCharacterById(characterId).catch(() => null);
    if (!персонаж) return { ok: false, reason: 'unknown_tier' };
    if (персонаж.level < def.minLevel) return { ok: false, reason: 'level' };

    const свои = await this.список(characterId);
    if (свои.length >= MAX_SOLDIERS) return { ok: false, reason: 'limit' };

    if (Number(персонаж.gold) < def.cost) return { ok: false, reason: 'no_gold' };

    // Списание и вставка одной транзакцией. По отдельности списание могло
    // пройти, а вставка не пройти — и игрок заплатил бы за солдата, которого
    // не получил. Ровно тот случай, из-за которого в гильдейских навыках
    // пришлось заводить миграцию 058.
    //
    // `gold >= стоимость` в UPDATE, а не проверка выше: между проверкой и
    // списанием золото могло уйти на что-то ещё (другой запрос того же
    // игрока), и списание прошло бы в минус.
    try {
      const результат = await this.db.transaction(async (client) => {
        const списание = await client.query(
          `UPDATE characters SET gold = gold - $2, updated_at = NOW()
            WHERE id = $1 AND gold >= $2 RETURNING gold`,
          [characterId, def.cost],
        );
        if (списание.rowCount === 0) return null;
        const вставка = await client.query(
          `INSERT INTO character_soldiers (character_id, tier, hp, max_hp)
           VALUES ($1, $2, $3, $3)
           RETURNING id, character_id, tier, hp, max_hp, last_damage_at, hired_at`,
          [characterId, tier, def.maxHp],
        );
        return { gold: Number(списание.rows[0].gold), строка: вставка.rows[0] as SoldierRow };
      });
      if (!результат) return { ok: false, reason: 'no_gold' };
      return {
        ok: true,
        gold: результат.gold,
        soldier: { ...результат.строка, def },
      };
    } catch (e) {
      logger.error('[Soldiers] наём не удался:', (e as Error).message);
      return { ok: false, reason: 'no_gold' };
    }
  }

  async распустить(characterId: string, soldierId: string): Promise<boolean> {
    const rows = await this.db.query(
      `DELETE FROM character_soldiers WHERE id = $1 AND character_id = $2 RETURNING id`,
      [soldierId, characterId],
    );
    return rows.length > 0;
  }

  /**
   * Ударить цель вместе с игроком.
   *
   * Один удар игрока вызывает один заход всех живых солдат: столько
   * урона, сколько у них есть, тем же заходом считается смерть цели.
   *
   * Живыми считаются только те, у кого есть чем бить. Раненый солдат не
   * исчезает: он лечится на отдыхе. Иначе первый же волк выбивал бы
   * караул целиком, и вербовка превращалась бы в повторную покупку
   * после каждой стычки.
   */
  async ударить(
    characterId: string,
    применитьУрон: (tier: SoldierTier, damage: number) => number,
  ): Promise<SoldierContribution[]> {
    const свои = await this.список(characterId);
    const вклад: SoldierContribution[] = [];
    for (const солдат of свои) {
      // Солдат, которого только что нашли мёртвым в базе, всё равно
      // ударит один раз: проверка на >0 нужна, чтобы урон не ушёл в никуда.
      const damage = Math.max(1, солдат.def.damage);
      const осталось = применитьУрон(солдат.tier, damage);
      вклад.push({ id: солдат.id, tier: солдат.tier, damage, killed: осталось <= 0 });
    }
    return вклад;
  }

  /**
   * Забрать часть урона на солдат вместо игрока.
   *
   * Доля считается от guardShare доли, и каждый раз, когда наёмник
   * берёт удар, его здоровье падает. Солдат не может умереть от
   * одного-единственного удара: игрок выбирал его как щит, и щит,
   * рассыпающийся от первого же касания, щитом не был бы.
   */
  async принятьУрон(characterId: string, урон: number): Promise<{ поглощено: number; ранений: number }> {
    if (урон <= 0) return { поглощено: 0, ранений: 0 };
    const свои = await this.список(characterId);
    const живые = свои.filter((s) => s.hp > 0);
    if (!живые.length) return { поглощено: 0, ранений: 0 };

    const щит = живые.reduce((a, b) => (a.def.guardShare >= b.def.guardShare ? a : b));
    const доля = щит.def.guardShare;
    const поглощено = Math.max(1, Math.floor(урон * доля));

    // Добивать нельзя: минимум 1 единица здоровья остаётся, иначе караул
    // выбивался одним заходом и вербовка теряла смысл за минуту.
    const новыйHp = Math.max(1, щит.hp - поглощено);
    await this.db.query(
      `UPDATE character_soldiers SET hp = $2, last_damage_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [щит.id, новыйHp],
    );
    return { поглощено, ранений: живые.length };
  }

  /** Справка для панели: доли, лимит и то, что игрок уже может взять. */
  /**
   * Справка для панели: доли, лимит и то, что игрок уже может взять.
   *
   * `level` не входит в ответ: доступность каждой доли панель считает сама по
   * `def.minLevel` — и считает тем же числом, на которое смотрит сервис при
   * найме. Второе место, где решается «можно ли», было бы вторым местом,
   * где эти два решения могут разойтись.
   */
  async каталог(characterId: string, gold: number): Promise<{
    tiers: SoldierDefinition[];
    limit: number;
    hired: number;
    gold: number;
  }> {
    const свои = await this.список(characterId);
    return {
      tiers: SOLDIER_TIERS,
      limit: MAX_SOLDIERS,
      hired: свои.length,
      gold,
    };
  }
}

export const soldiers = new SoldierService();