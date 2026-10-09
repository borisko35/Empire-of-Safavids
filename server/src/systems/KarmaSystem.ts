// ============================================================
// Система кармы и PvP — Empire of Safavids
// ============================================================

import { DatabaseService } from '../services/DatabaseService';
import { CharacterService } from '../services/CharacterService';
import { RedisService } from '../services/RedisService';
import { logger } from '../utils/logger';

export type PvPZoneType = 'safe' | 'contested' | 'pvp' | 'siege';

export interface KarmaEvent {
  type: 'pk_kill'        // Убийство мирного игрока
       | 'pk_kill_red'   // Убийство красного игрока
       | 'pvp_kill'      // Победа в честном PvP
       | 'bounty_kill'   // Убийство игрока с наградой
       | 'npc_kill'      // Убийство NPC-стражника
       | 'quest_good'    // Выполнение доброго квеста
       | 'quest_evil'    // Выполнение злого квеста
       | 'guard_strike'; // Удар стража по тёмному игроку
  delta: number;
}

export const KARMA_EVENTS: Record<KarmaEvent['type'], number> = {
  pk_kill:    -300,
  pk_kill_red: +100,
  pvp_kill:   +10,
  bounty_kill: +50,
  npc_kill:   -50,
  quest_good: +100,
  quest_evil: -150,
  // Удар стража. Раньше поле guardAttack в таблице последствий было объявлено
  // у красного и изгоя и не читалось нигде: город обещал наказание, а наказывать
  // было некому. Теперь читает его GameLoop, а число взято из
  // GUARD_STRIKE.KARMA в shared/stealth.ts - проверка guardStrike сверяет их.
  guard_strike: -100,
};

export type KarmaStatus = 'saint' | 'good' | 'neutral' | 'chaotic' | 'red' | 'outlaw';

export function getKarmaStatus(karma: number): KarmaStatus {
  if (karma >= 5000)  return 'saint';
  if (karma >= 1000)  return 'good';
  if (karma >= -500)  return 'neutral';
  if (karma >= -2000) return 'chaotic';
  if (karma >= -5000) return 'red';
  return 'outlaw';
}

export const KARMA_PENALTIES: Record<KarmaStatus, {
  nameRu: string;
  canBeAttacked: boolean;
  dropChanceOnDeath: number; // 0–1
  npcHostile: boolean;
  guardAttack: boolean;
  auctionBan: boolean;
}> = {
  saint:   { nameRu: 'Святой',    canBeAttacked: false, dropChanceOnDeath: 0,    npcHostile: false, guardAttack: false, auctionBan: false },
  good:    { nameRu: 'Добрый',    canBeAttacked: false, dropChanceOnDeath: 0,    npcHostile: false, guardAttack: false, auctionBan: false },
  neutral: { nameRu: 'Нейтральный', canBeAttacked: false, dropChanceOnDeath: 0,    npcHostile: false, guardAttack: false, auctionBan: false },
  chaotic: { nameRu: 'Хаотичный', canBeAttacked: true,  dropChanceOnDeath: 0.1,  npcHostile: false, guardAttack: false, auctionBan: false },
  red:     { nameRu: 'Красный',    canBeAttacked: true,  dropChanceOnDeath: 0.3,  npcHostile: true,  guardAttack: true,  auctionBan: false },
  outlaw:  { nameRu: 'Изгой',     canBeAttacked: true,  dropChanceOnDeath: 0.5,  npcHostile: true,  guardAttack: true,  auctionBan: true  },
};
/**
 * Враждебны ли монстры к такому персонажу.
 *
 * Истина у «красного» и «изгоя»: в таблице последствий у них npcHostile, и
 * монстры замечают их вдвое дальше, чем мирных (см. NPC_HUNT_RANGE_MULTIPLIER
 * в AISystem).
 *
 * Функция, а не пара ссылок в коде: таблица последствий — одно место, где
 * решено, что значит «красный». Читать её из двух файлов — верный способ
 * однажды разъехаться по порогам.
 */
export function isNpcHostile(karma: number): boolean {
  return KARMA_PENALTIES[getKarmaStatus(karma)].npcHostile;
}

/**
 * Бьёт ли такого персонажа стража.
 *
 * Истина у «красного» и «изгоя»: в таблице последствий у них guardAttack, и
 * только у них. Поле было объявлено и не читалось нигде, покаGameLoop не
 * начал звать эту функцию.
 *
 * Вторая дверь в ту же таблицу рядом с isNpcHostile, а не чтение таблицы из
 * GameLoop: читать KARMA_PENALTIES из игрового цикла запрещено проверкой
 * karmaNpcHostile («таблица последствий читается в одном месте»), и правильно -
 * пороги ранга должны читаться из одного файла.
 */
export function isGuardTarget(karma: number): boolean {
  return KARMA_PENALTIES[getKarmaStatus(karma)].guardAttack;
}


export const PVP_ZONES: Record<string, { type: PvPZoneType; nameRu: string; karmaOnKill: boolean }> = {
  tabriz:       { type: 'safe',      nameRu: 'Тебриз',          karmaOnKill: true  },
  isfahan:      { type: 'safe',      nameRu: 'Исфахан',         karmaOnKill: true  },
  shiraz:       { type: 'safe',      nameRu: 'Шираз',           karmaOnKill: true  },
  caucasus:     { type: 'contested', nameRu: 'Кавказ',          karmaOnKill: false },
  mesopotamia:  { type: 'pvp',       nameRu: 'Месопотамия',    karmaOnKill: false },
  khorasan:     { type: 'pvp',       nameRu: 'Хорасан',         karmaOnKill: false },
  persian_gulf: { type: 'pvp',       nameRu: 'Персидский залив', karmaOnKill: false },
};

/**
 * Что игрок теряет при смерти по карме.
 *
 * Шанс и доля берутся из одной цифры статуса: хаотичный — 0,1, красный —
 * 0,3, изгой — 0,5. Одна цифра на обе величины, иначе таблица последствий
 * разойдётся с тем, что игрок видит.
 *
 * `roll` передаётся снаружи, чтобы расчёт можно было проверить без
 * подмены случайности внутри.
 */
export function karmaDeathDrop(
  karma: number,
  gold: number,
  roll: number
): { dropped: number; chance: number } {
  const штраф = KARMA_PENALTIES[getKarmaStatus(karma)];
  const chance = штраф.dropChanceOnDeath;
  if (chance <= 0) return { dropped: 0, chance: 0 };
  if (roll >= chance) return { dropped: 0, chance };
  const золото = Math.max(0, Math.floor(gold));
  if (золото <= 0) return { dropped: 0, chance };
  // Не ниже одного золота: у изгоя с тремя золотом списание доли дало бы
  // ноль, и смерть перестала бы стоить ничего.
  const dropped = Math.max(1, Math.floor(золото * chance));
  return { dropped: Math.min(dropped, золото), chance };
}

export class KarmaSystem {
  private db  = DatabaseService.getInstance();
  private redis = RedisService.getInstance();
  /** Выплата награды за голову идёт через него же, а не прямым UPDATE. */
  private characters = new CharacterService();

  /**
   * Карма персонажа.
   *
   * Отдельное чтение, потому что в типе Character поля karma нет: карма лежит
   * в колонке characters, но в объект персонажа не попадает. Места, где она
   * нужна (смерть, аукцион, отношение NPC), идут через этот метод.
   */
  async getKarma(characterId: string): Promise<number> {
    const row = await this.db.queryOne<{ karma: number | null }>(
      'SELECT karma FROM characters WHERE id = $1',
      [characterId]
    );
    return Number(row?.karma ?? 0);
  }

  async applyKarmaEvent(
    characterId: string,
    eventType: KarmaEvent['type'],
    region: string
  ): Promise<{ newKarma: number; newStatus: KarmaStatus; statusChanged: boolean }> {
    const zone = PVP_ZONES[region];
    let delta = KARMA_EVENTS[eventType];

    // В PvP-зонах карма не снимается за убийство
    if (zone && !zone.karmaOnKill && eventType === 'pk_kill') delta = 0;

    const row = await this.db.queryOne<{ karma: number }>(
      'SELECT karma FROM characters WHERE id = $1', [characterId]
    );
    const oldKarma  = row?.karma ?? 0;
    const newKarma  = Math.max(-10000, Math.min(10000, oldKarma + delta));
    const oldStatus = getKarmaStatus(oldKarma);
    const newStatus = getKarmaStatus(newKarma);

    await this.db.query(
      'UPDATE characters SET karma = $1, updated_at = NOW() WHERE id = $2',
      [newKarma, characterId]
    );

    if (newStatus !== oldStatus) {
      logger.info(`Karma status: ${characterId} ${oldStatus} → ${newStatus} (${newKarma})`);
      await this.redis.publish('player:karma_changed', { characterId, oldStatus, newStatus, newKarma });
    }

    return { newKarma, newStatus, statusChanged: newStatus !== oldStatus };
  }

  /** Постепенное восстановление кармы (вызывать периодически) */
  async decayKarma(characterId: string): Promise<void> {
    const row = await this.db.queryOne<{ karma: number }>(
      'SELECT karma FROM characters WHERE id = $1', [characterId]
    );
    if (!row) return;
    const karma = row.karma;
    if (karma >= 0) return; // Положительная карма не восстанавливается авто
    const decay = Math.min(50, Math.abs(karma) * 0.01); // 1% в час
    await this.db.query(
      'UPDATE characters SET karma = LEAST(0, karma + $1) WHERE id = $2',
      [Math.ceil(decay), characterId]
    );
  }

  /**
   * Награда за убийство игрока: активные ставки на жертву.
   *
   * ЧТО ЗДЕСЬ БЫЛО. Метода не было, а таблица bounties имела колонки
   * claimed_at и claimer_id — то есть выплата была спроектирована и не
   * написана. Ставку можно было поставить (код был мёртвым), а получить
   * было нельзя: деньги уходили в никуда.
   *
   * Один UPDATE на все ставки: он же и признак «выдано», поэтому две
   * одновременные победы не заплатят дважды — обновляет только первая, вторая
   * получит ноль строк. Читать и потом писать нельзя: две вкладки успевают
   * прочитать «не выдано» обе.
   */
  async claimBounties(killerId: string, targetId: string): Promise<number> {
    const res = await this.db.query<{ amount: string }>(
      `UPDATE bounties
          SET is_active = FALSE, claimed_at = NOW(), claimer_id = $1
        WHERE target_id = $2 AND is_active = TRUE
      RETURNING amount`,
      [killerId, targetId]
    );
    const сумма = res.reduce((всего, строка) => всего + Number(строка.amount), 0);
    if (сумма > 0) {
      await this.characters.addGoldReward(killerId, сумма);
      logger.info(`[Karma] награда за голову выплачена: ${killerId} получил ${сумма}g за ${targetId}`);
    }
    return сумма;
  }

  /** Активные ставки на персонажа и их сумма. */
  async getBounty(characterId: string): Promise<number> {
    const row = await this.db.queryOne<{ bounty: number }>(
      'SELECT COALESCE(SUM(amount), 0) as bounty FROM bounties WHERE target_id = $1 AND is_active = TRUE',
      [characterId]
    );
    return row?.bounty ?? 0;
  }

  async placeBounty(placerId: string, targetId: string, amount: number): Promise<void> {
    if (amount < 100) throw new Error('Minimum bounty is 100 gold');
    // Ставить награду за голову на самого себя бессмысленно: убить себя,
    // чтобы получить свои же деньги. Раньше это проходило, потому что код
    // был мёртвым и не проверялся.
    if (placerId === targetId) throw new Error('Cannot place a bounty on yourself');

    // СПИСАНИЕ ПРОВЕРЯЕТСЯ ПО ЧИСЛУ ОБНОВЛЁННЫХ СТРОК.
    //
    // Прежде стоял UPDATE с условием `gold >= $1`, и результат его игнорился:
    // у игрока без золота не обновлялась ни одна строка, а вставка в
    // bounties выполнялась всё равно. Получалась БЕСПЛАТНАЯ НАГРАДА ЗА
    // ГОЛОВУ — ставка без единой монеты. Транзакция откатывает только при
    // исключении, а «обновилось ноль строк» исключением не является.
    const списано = await this.db.transaction(async (client) => {
      const res = await client.query(
        'UPDATE characters SET gold = gold - $1 WHERE id = $2 AND gold >= $1 RETURNING id',
        [amount, placerId]
      );
      // Ноль обновлённых строк — золота не хватило. Именно результат строк,
      // а не «исключения не было»: транзакция откатывается только при
      // исключении, а «нечего обновлять» не является исключением.
      if (res.rows.length === 0) return false;
      await client.query(
        `INSERT INTO bounties (id, placer_id, target_id, amount, is_active, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, TRUE, NOW())`,
        [placerId, targetId, amount]
      );
      return true;
    });
    if (!списано) throw new Error('Not enough gold');

    await this.redis.publish('player:bounty_placed', { targetId, amount, placerId });
    logger.info(`Bounty placed: ${amount}g on ${targetId} by ${placerId}`);
  }
}
