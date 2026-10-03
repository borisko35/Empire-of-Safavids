import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './DatabaseService';
import { Character, CharacterClass, CharacterStats, Region, ItemType, EquipmentBonuses } from '../types/game.types';
import { camelizeRow, camelizeRows } from '../utils/camelize';
import { LevelingSystem } from '../systems/LevelingSystem';
import { ITEMS_DATABASE } from '../data/items';
import { REGION_SPAWNS, getZoneAt } from '../../../shared/constants';
import { getBuffService, ITEM_BUFFS, type ActiveBuff } from './BuffService';
import { ReferralService } from './ReferralService';
import { logger } from '../utils/logger';
import { analytics } from './AnalyticsService';
import { seasonalEvent } from './SeasonalEventService';
import { weatherExpMultiplier } from '../systems/WorldTimeSystem';
import type { WalletCurrency } from '../utils/economy';
import { MAX_LEVEL, DEFAULT_SERVER_ID, getRegionSpawn, STAMINA } from '../../../shared/constants';
import { isCombatStance, type CombatStance } from '../systems/CombatStance';
// Навыки гильдии. Импорт здесь, а не только в маршрутах: бонус к опыту
// считается в addExperience, и он должен попадать в ту же цепочку, что бафф,
// сезонный праздник и бонус профессии.
import { GuildService } from './GuildService';
import { professionOf } from './ProfessionService';
import { professionBonuses } from '../systems/ProfessionBonuses';
import { guildMissionService } from './GuildMissionService';

const BASE_STATS: Record<CharacterClass, CharacterStats> = {
  [CharacterClass.QIZILBASH]: {
    strength: 20, agility: 12, intelligence: 5, endurance: 18, charisma: 8,
  },
  [CharacterClass.SUFI_MYSTIC]: {
    strength: 6, agility: 10, intelligence: 22, endurance: 10, charisma: 15,
  },
  [CharacterClass.PERSIAN_ARCHER]: {
    strength: 12, agility: 22, intelligence: 8, endurance: 12, charisma: 10,
  },
  [CharacterClass.BAZAAR_MERCHANT]: {
    strength: 8, agility: 14, intelligence: 12, endurance: 10, charisma: 20,
  },
  [CharacterClass.COURT_DIPLOMAT]: {
    strength: 7, agility: 13, intelligence: 15, endurance: 9, charisma: 22,
  },
};

/**
 * Что восстанавливает расходник. Вынесено из класса, чтобы тесты
 * целостности могли сверить таблицу с каталогом предметов: предмет,
 * обещающий в описании восстановление, обязан здесь быть — иначе
 * useItem бросает «Item has no usable effect».
 */
export const USE_ITEM_EFFECTS: Record<string, { hp?: number; mana?: number; stamina?: number }> = {
  con_health_potion_s: { hp: 200 },
  con_health_potion_m: { hp: 800 },
  con_mana_potion: { mana: 300 },
  con_stamina_food: { stamina: 150 },
  // Второй слой расходников (префикс pot_/food_) был описан в каталоге,
  // но отсутствовал здесь — useItem бросал «Item has no usable effect»,
  // то есть выпить зелье или съесть кебаб было невозможно. Значения взяты
  // из описаний предметов. Бонус к силе/урону из описаний пока не
  // реализован: для этого нужна система временных модификаторов.
  pot_health_small: { hp: 50 },
  pot_health_medium: { hp: 150 },
  pot_mana_small: { mana: 40 },
  pot_stamina_small: { stamina: 30 },
  food_kebab: { hp: 80 },
};

export class CharacterService {
  private db = DatabaseService.getInstance();
  private leveling = new LevelingSystem();

  async createCharacter(
    userId: string,
    name: string,
    characterClass: CharacterClass,
    serverId: string = DEFAULT_SERVER_ID,
    /** Код приглашения из ссылки ?ref= — может быть пустым */
    referralCode?: string,
  ): Promise<Character> {
    const stats = BASE_STATS[characterClass];
    const maxHp = 100 + stats.endurance * 10;
    const maxMana = 50 + stats.intelligence * 8;
    const maxStamina = 100 + stats.agility * 5;

    // ЧТО БЫЛО. Точка старта и регион задавались двумя разными вещами:
    // position = (0,0) - это Исфахан по REGION_SPAWNS, а region стоял
    // Region.TABRIZ. Персонаж рождался на площади столицы, а сервер
    // считал его в Тебризе, где требуется 20 уровень.
    //
    // Чем это оборачивалось. Персонаж 1-го уровня числился в регионе,
    // в который нельзя попасть: требование уровня переставало быть
    // затвором, потому что новичок рождался по ту сторону ворот.
    // Отсюда же монстры, комнаты сокетов, чат и квесты ключились на
    // Тебриц, а игрок стоял в Исфахане, и подпись в углу экрана врала.
    // А recordRegionVisit сразу помечал Тебриз посещённым - «посетить
    // Тебриз» засчитывалось, никуда не сходив.
    //
    // Комментарий в коде это оправдывал: мол, Тебриц - стартовый город.
    // Но город, который построен и в который ставят спавн, - Исфахан.
    // Это остался след от времени, когда столицу называли tabriz.
    //
    // ЧТО СДЕЛАНО. Точка, регион и зона берутся из ОДНОГО источника -
    // якоря Исфахана в REGION_SPAWNS, а зона считается от той же точки
    // функцией getZoneAt. Три поля не могут разойтись между собой: их
    // негде вводить по отдельности.
    const СТАРТОВЫЙ_РЕГИОН = Region.ISFAHAN;
    const якорь = REGION_SPAWNS[СТАРТОВЫЙ_РЕГИОН];
    const стартовая_позиция = { x: якорь.x, y: 0, z: якорь.z };
    const стартовая_зона = getZoneAt(якорь.x, якорь.z);

    const character: Character = {
      id: uuidv4(),
      userId,
      name,
      class: characterClass,
      level: 1,
      experience: 0,
      stats,
      hp: maxHp,
      maxHp,
      mana: maxMana,
      maxMana,
      stamina: maxStamina,
      maxStamina,
      position: стартовая_позиция,
      region: СТАРТОВЫЙ_РЕГИОН,
      // Зона пишется сразу, при создании. Раньше колонка zone вообще не
      // попадала в INSERT и молча брала значение из умолчания базы, а
      // имя региона в интерфейсе бралось из characters.region. Вместе
      // это давало подпись «Тебриз» рядом с площадью Исфахана.
      zone: стартовая_зона?.id,
      serverId,
      gold: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.query(
      `INSERT INTO characters
        (id, user_id, name, class, level, experience, stats, hp, max_hp, base_max_hp,
         mana, max_mana, stamina, max_stamina, position, region, zone, server_id, gold, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        character.id, character.userId, character.name, character.class,
        character.level, character.experience, JSON.stringify(character.stats),
        character.hp, character.maxHp,
        // Позиция 10 - base_max_hp, ровно по плейсхолдеру $10. На своём
        // месте, а не в конце списка: плейсхолдеры нумеруются по позиции,
        // и значение на чужом месте молча кладёт одно поле в другое.
        character.maxHp,
        character.mana, character.maxMana,
        character.stamina, character.maxStamina, JSON.stringify(character.position),
        // 16 - region, 17 - zone. Зона вставлена ровно на своё место:
        // при добавлении колонки в конец списка без сдвига плейсхолдеров
        // значение zone молча легло бы в server_id.
        character.region, character.zone ?? null,
        character.serverId, character.gold, character.createdAt, character.updatedAt,
      ]
    );

    // Стартовый регион считается посещённым: персонаж стоит в нём, значит
    // он там и был. Иначе «посетить все семь регионов» было бы недостижимо
    // для новичка - ему пришлось бы сходить в Исфахан, чтобы тот засчитался.
    await this.recordRegionVisit(character.id, character.region);

    // Приглашение друга засчитывается здесь, а не при регистрации:
    // золото лежит в characters.gold, и на момент регистрации аккаунта
    // персонажа ещё нет. Ошибка начисления не должна помешать игроку
    // создать персонажа, поэтому просто логируем.
    try {
      await new ReferralService().attribute(referralCode, {
        id: character.id,
        userId,
      });
    } catch (err) {
      logger.warn(`[Referral] не удалось засчитать приглашение: ${(err as Error).message}`);
    }

    // Шаг воронки «зашёл → завёл персонажа». Событие character_created
    // было в списке AnalyticsEvent, но его не писал никто — из-за чего
    // воронку посчитать было нечем: без него неизвестно, сколько людей
    // дошло до игры, а сколько застряло на экране входа.
    analytics.track(
      'character_created',
      { class: characterClass, serverId },
      userId,
      character.id,
    );

    return character;
  }

  /**
   * Занято ли имя персонажа.
   *
   * Нужно для внятного ответа игроку: без этой проверки совпадение имени
   * роняло вставку, и человек видел ошибку базы вместо «это имя занято».
   * Регистр не различаем — игрок не должен гадать, в чём разница.
   */
  async isNameTaken(name: string): Promise<boolean> {
    const row = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM characters WHERE LOWER(name) = LOWER($1) LIMIT 1',
      [name],
    );
    return !!row;
  }

  /**
   * Удаление персонажа со всеми зависимостями, у которых нет каскада.
   * Глава гильдии удалиться не может — сначала передать лидерство.
   */
  async deleteCharacter(characterId: string): Promise<void> {
    await this.db.transaction(async (client) => {
      const own = await client.query('SELECT id FROM characters WHERE id = $1', [characterId]);
      if (own.rowCount === 0) throw new Error('Character not found');
      const leaderOf = await client.query('SELECT id FROM guilds WHERE leader_id = $1', [characterId]);
      if ((leaderOf.rowCount ?? 0) > 0) {
        throw new Error('Guild leader cannot be deleted: transfer leadership first');
      }
      // Партии: выйти; если лидер — передать старейшему участнику
      const ledParties = await client.query('SELECT id FROM parties WHERE leader_id = $1', [characterId]);
      for (const row of ledParties.rows as { id: string }[]) {
        const other = await client.query(
          `SELECT character_id FROM party_members WHERE party_id = $1 AND character_id <> $2
           ORDER BY joined_at LIMIT 1`,
          [row.id, characterId]
        );
        if (other.rowCount === 0) {
          await client.query('DELETE FROM parties WHERE id = $1', [row.id]);
        } else {
          const next = (other.rows[0] as { character_id: string }).character_id;
          await client.query('UPDATE parties SET leader_id = $1 WHERE id = $2', [next, row.id]);
          await client.query(
            `UPDATE party_members SET role = 'leader' WHERE party_id = $1 AND character_id = $2`,
            [row.id, next]
          );
        }
      }
      await client.query('DELETE FROM party_members WHERE character_id = $1', [characterId]);
      await client.query('DELETE FROM party_invites WHERE inviter_id = $1 OR target_id = $1', [characterId]);
      // Аукцион и торговые стенды: снять свои лоты
      await client.query('DELETE FROM auction_listings WHERE seller_id = $1 OR buyer_id = $1', [characterId]);
      await client.query('DELETE FROM trade_listings WHERE seller_id = $1', [characterId]);
      await client.query('DELETE FROM trade_history WHERE seller_id = $1 OR buyer_id = $1', [characterId]);
      await client.query('DELETE FROM trade_contracts WHERE seller_id = $1 OR buyer_id = $1', [characterId]);
      // PvP-арена и награды за голову с участием
      await client.query(
        'DELETE FROM pvp_arena WHERE player1_id = $1 OR player2_id = $1 OR winner_id = $1',
        [characterId]
      );
      await client.query(
        'DELETE FROM bounties WHERE placer_id = $1 OR target_id = $1 OR claimer_id = $1',
        [characterId]
      );
      // Вклады в банк гильдии — обезличить, историю сохранить
      await client.query('UPDATE guild_bank SET deposited_by = NULL WHERE deposited_by = $1', [characterId]);
      await client.query('DELETE FROM characters WHERE id = $1', [characterId]);
    });
  }

  async getCharactersByUser(userId: string): Promise<Character[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM characters WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return camelizeRows<Character>(rows).map(c => this.parseJsonFields(c));
  }

  async getCharacterById(characterId: string): Promise<Character | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM characters WHERE id = $1',
      [characterId]
    );
    if (!row) return null;
    const character = camelizeRow<Character>(row)!;
    return this.parseJsonFields(character);
  }

  /** JSONB-колонки могут прийти строкой — нормализуем в объекты */
  private parseJsonFields(character: Character): Character {
    const c = character as Character & { stats?: unknown; position?: unknown };
    if (typeof c.stats === 'string') c.stats = JSON.parse(c.stats) as CharacterStats;
    if (typeof c.position === 'string') c.position = JSON.parse(c.position);
    return character;
  }

  /**
   * Начислить опыт. Единственная точка для всех источников (убийства,
   * квесты, рыбалка, караваны, данжи, группа), поэтому временной бонус
   * «+50% к опыту» применяется именно здесь и работает везде сразу.
   *
   * Множитель каждый раз считается от базовой суммы заново, а не
   * накапливается: повторный запрос не умножит опыт дважды.
   */
  async addExperience(characterId: string, amount: number): Promise<{ leveledUp: boolean; newLevel: number }> {
    const character = await this.getCharacterById(characterId);
    if (!character) throw new Error('Character not found');

    const mult = await getBuffService().getExpMultiplier(characterId);
    // Сезонный праздник. Комментарий выше обещал этот бонус years назад, а
    // кода не было: умножался только бафф из базы. Теперь умножается и он.
    const seasonal = seasonalEvent.expMultiplier();
    // Бонус профессии «Исследователь». Раньше описание обещало «открывает
    // секретные локации» — такой системы в игре нет, и обещание было пустым.
    // Теперь обещает опыт, и он считается здесь же, а не в описании.
    const prof = await professionOf(characterId);
    const profExp = professionBonuses(prof?.id ?? null, prof?.level ?? 0).experience;
    // Навык гильдии «Благословение Учёного». До этого в data/guilds.ts был
    // объявлен навык с описанием «+2% к опыту за каждый уровень», и он не
    // существовал нигде. Теперь бонус гильдии входит в ту же цепочку.
    //
    // Ошибка не роняет начисление опыта: если гильдия недоступна, игрок
    // получает опыт без бонуса, а не остаётся без опыта вообще. Отлов
    // ошибки здесь не маскировка - бонус не должен быть причиной потери
    // опыта, иначе отказ базы был бы наказан игроку дважды.
    let guildExp = 1;
    try {
      guildExp = (await new GuildService().getBonuses(characterId)).exp;
    } catch {
      guildExp = 1;
    }
    // Бонус погоды. Объявлялся в WEATHER_EFFECTS как expMod и не читался
    // нигде: в дождь опыт шёл по базовой ставке. Считается здесь, в той
    // же цепочке, что сезон, профессия и гильдия.
    const weather = weatherExpMultiplier();
    const total = Math.floor(amount * mult * seasonal * profExp * guildExp * weather);

    // Делегируем единой системе прокачки (прирост статов/навыков при level up)
    const result = await this.leveling.addExperience(character, total, 'experience_gain');
    return { leveledUp: result.leveledUp, newLevel: result.leveledUp ? result.newLevel : character.level };
  }

  async updatePosition(characterId: string, position: { x: number; y: number; z: number }): Promise<void> {
    await this.db.query(
      'UPDATE characters SET position = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(position), characterId]
    );
  }

  // ============================================================
  // Боевая стойка
  // ============================================================

  /**
   * Текущая стойка персонажа.
   *
   * Строка из базы может оказаться чем угодно, если её правили вручную или
   * база отстала от миграции. Поэтому незнакомое значение заменяется обычным
   * боем прямо здесь: стойка не должна быть причиной, по которой не работает
   * удар. Валидация в базе (CHECK) - вторая линия, а не единственная.
   */
  async getStance(characterId: string): Promise<CombatStance> {
    const rows = await this.db.query<{ combat_stance: string }>(
      'SELECT combat_stance FROM characters WHERE id = $1',
      [characterId]
    );
    const value = rows[0]?.combat_stance ?? 'balanced';
    return isCombatStance(value) ? value : 'balanced';
  }

  /**
   * Переключить стойку.
   *
   * Возвращает фактически применённую стойку: если просили неизвестную, applied
   * будет 'balanced', и вызывающий код покажет честное значение, а не то,
   * о котором просили.
   */
  async setStance(characterId: string, stance: string): Promise<CombatStance> {
    if (!isCombatStance(stance)) return this.getStance(characterId);
    await this.db.query(
      'UPDATE characters SET combat_stance = $1, updated_at = NOW() WHERE id = $2',
      [stance, characterId]
    );
    return stance;
  }

  // ============================================================
  // Боевые операции (персистентное состояние HP/маны/стамины)
  // ============================================================

  /** Нанести урон. Возвращает оставшееся HP и признак смерти. */
  /**
   * Вернуть полное здоровье. Используется после боя на арене: урон был
   * честным, но следов о нём остаться не должно, иначе проигравший вышел
   * бы из города с 1 HP.
   */
  async restoreHp(characterId: string): Promise<number> {
    const row = await this.db.queryOne<{ hp: number }>(
      'UPDATE characters SET hp = max_hp, updated_at = NOW() WHERE id = $1 RETURNING hp',
      [characterId],
    );
    return row?.hp ?? 0;
  }

  /**
   * Пересчитать запас здоровья с учётом бонуса гильдии.
   *
   * ПОЧЕМУ МЕНЯЕТСЯ КОЛОНКА, А НЕ ЧТЕНИЕ. max_hp читает бой: applyDamage
   * возвращает его вместе с уроном. Если бонус считать при каждом чтении,
   * в горячий путь попадёт запрос в базу за уровнями навыка - то есть
   * запрос на каждый удар каждого игрока. Поэтому колонка пересчитывается
   * при изменениях, а бой читает готовое число, как и раньше.
   *
   * Схема: max_hp = base_max_hp * множитель. GREATEST(1, ...) - решает
   * две вещи: округление не может дать ноль, а отрицательный множитель
   * (мусор в данных) не сделает персонажа бессмертным и не сломает бой.
   *
   * Текущий hp не трогается: игрок не должен терять здоровье от того, что
   * кто-то в его гильдии купил навык.
   */
  async recalcMaxHp(characterId: string, multiplier: number): Promise<void> {
    const множитель = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
    await this.db.query(
      'UPDATE characters SET max_hp = GREATEST(1, ROUND(base_max_hp * $2::numeric)), updated_at = NOW() WHERE id = $1',
      [characterId, множитель],
    ).catch((e: unknown) => {
      // Ошибка не поднимается: потеря бонуса лучше упавшего вызова из
      // левелинга или покупки навыка. Причина - в журнал.
      logger.error('[Character] запас здоровья не пересчитан:', (e as Error).message);
    });
  }

  async applyDamage(characterId: string, damage: number): Promise<{ hp: number; maxHp: number; died: boolean }> {
    const row = await this.db.queryOne<{ hp: number; max_hp: number }>(
      'UPDATE characters SET hp = GREATEST(0, hp - $1), updated_at = NOW() WHERE id = $2 RETURNING hp, max_hp',
      [Math.max(0, Math.floor(damage)), characterId]
    );
    if (!row) throw new Error('Character not found');
    return { hp: row.hp, maxHp: row.max_hp, died: row.hp <= 0 };
  }

  /** Восстановить HP (лечение). Возвращает актуальное HP. */
  async applyHeal(characterId: string, amount: number): Promise<{ hp: number; maxHp: number }> {
    const row = await this.db.queryOne<{ hp: number; max_hp: number }>(
      'UPDATE characters SET hp = LEAST(max_hp, hp + $1), updated_at = NOW() WHERE id = $2 RETURNING hp, max_hp',
      [Math.max(0, Math.floor(amount)), characterId]
    );
    if (!row) throw new Error('Character not found');
    return { hp: row.hp, maxHp: row.max_hp };
  }

  /** Списать ману/стамину. false — если ресурсов не хватает (действие невозможно). */
  async spendResources(characterId: string, manaCost: number, staminaCost: number): Promise<boolean> {
    const affected = await this.db.run(
      `UPDATE characters SET
         mana = mana - $1, stamina = stamina - $2, updated_at = NOW()
       WHERE id = $3 AND mana >= $1 AND stamina >= $2`,
      [Math.max(0, manaCost), Math.max(0, staminaCost), characterId]
    );
    return affected > 0;
  }

  /**
   * Возрождение после смерти: 50% HP/маны и полная стамина.
   *
   * `spot` — точка смерти (респавн на месте за золото). Без неё игрок
   * возвращается на стартовую точку региона.
   * `goldCost` списывается В ТОМ ЖЕ UPDATE, что и восстановление: две
   * отдельные операции оставляли бы окно, в котором персонаж уже живой,
   * а золото ещё не списано (или наоборот). `WHERE gold >= $3` делает
   * проверку и списание атомарными — конкурентный вызов не сможет
   * воскресить бесплатно.
   *
   * Ничего не бросает: неудача описана в результате, вызывающий решает,
   * что показать игроку.
   */
  async respawn(
    characterId: string,
    options: { spot?: { x: number; z: number }; goldCost?: number } = {}
  ): Promise<
    | { ok: true; hp: number; maxHp: number; gold: number; position: { x: number; y: number; z: number } }
    | { ok: false; reason: 'not_found' | 'no_gold' }
  > {
    // Респавн на месте — точка уже известна, регион за ней не нужен
    let position: { x: number; z: number };
    if (options.spot) {
      position = { x: options.spot.x, z: options.spot.z };
    } else {
      const current = await this.db.queryOne<{ region: string }>(
        'SELECT region FROM characters WHERE id = $1',
        [characterId]
      );
      position = getRegionSpawn(current?.region ?? Region.TABRIZ);
    }
    const point = { x: position.x, y: 0, z: position.z };
    const cost = Math.max(0, Math.floor(options.goldCost ?? 0));
    const row = await this.db.queryOne<{ hp: number; max_hp: number; gold: number }>(
      `UPDATE characters SET
         hp = GREATEST(1, FLOOR(max_hp * 0.5)),
         mana = GREATEST(FLOOR(max_mana * 0.5), 0),
         stamina = max_stamina,
         position = $2::jsonb,
         gold = gold - $3,
         updated_at = NOW()
       WHERE id = $1 AND gold >= $3
       RETURNING hp, max_hp, gold`,
      [characterId, JSON.stringify(point), cost]
    );
    if (row) {
      return { ok: true, hp: row.hp, maxHp: row.max_hp, gold: Number(row.gold), position: point };
    }
    // UPDATE ничего не вернул: либо персонажа нет, либо не хватило золота
    if (cost <= 0) return { ok: false, reason: 'not_found' };
    const exists = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM characters WHERE id = $1',
      [characterId]
    );
    return exists ? { ok: false, reason: 'no_gold' } : { ok: false, reason: 'not_found' };
  }

  /** Максимальный уровень (из общих констант) */
  getMaxLevel(): number {
    return MAX_LEVEL;
  }

  // ============================================================
  // Регенерация и ресурсы
  // ============================================================

  /**
   * Регенерация ресурсов (за 5-секундный тик сервера).
   * `inWater` — игрок в глубокой воде: стамина не восстанавливается, а
   * расходуется. Раньше она regen'илась одинаково для стоящего, бегущего
   * и плывущего — плыть можно было бесконечно.
   */
  async regenResources(characterId: string, inWater = false): Promise<{
    hp: number; maxHp: number; mana: number; maxMana: number;
    stamina: number; maxStamina: number; level: number; experience: number; gold: number;
  } | null> {
    const row = await this.db.queryOne<Record<string, number>>(
      `UPDATE characters SET
         hp      = LEAST(max_hp,      hp + GREATEST(1, FLOOR(max_hp * 0.012) * 5)),
         mana    = LEAST(max_mana,    mana + GREATEST(1, FLOOR(max_mana * 0.02) * 5)),
         stamina = CASE WHEN $2::boolean
                        THEN GREATEST(0, stamina - GREATEST(1, FLOOR(max_stamina * $3) * 5))
                        ELSE LEAST(max_stamina, stamina + GREATEST(1, FLOOR(max_stamina * 0.04) * 5))
                   END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING hp, max_hp, mana, max_mana, stamina, max_stamina, level, experience, gold`,
      [characterId, inWater, STAMINA.SWIM_DRAIN_PER_5S]
    );
    if (!row) return null;
    return {
      hp: Number(row.hp), maxHp: Number(row.max_hp),
      mana: Number(row.mana), maxMana: Number(row.max_mana),
      stamina: Number(row.stamina), maxStamina: Number(row.max_stamina),
      level: Number(row.level), experience: Number(row.experience), gold: Number(row.gold),
    };
  }

  /**
   * Начислить золото. Возвращает новый баланс.
   *
   * Сумма приводится к нулю снизу, поэтому метод умеет только ПРИБАВЛЯТЬ.
   * Расход идёт через spendGold, возврат за неудачную покупку - тоже сюда.
   * Сезонного бонуса здесь нет намеренно: умножать возврат нельзя, иначе во
   * время праздника неудачная покупка платила бы сверх.
   */
  async addGold(characterId: string, amount: number): Promise<number> {
    const row = await this.db.queryOne<{ gold: number }>(
      'UPDATE characters SET gold = gold + $1 WHERE id = $2 RETURNING gold',
      [Math.max(0, Math.floor(amount)), characterId]
    );
    if (!row) throw new Error('Character not found');
    return Number(row.gold);
  }

  /**
   * Начислить золото ЗА НАГРАДУ — с сезонным бонусом.
   *
   * Отдельный метод, а не флажок у addGold, потому что через addGold идёт
   * и возврат за неудачную покупку. Если бы бонус применялся там, то во
   * время праздника возврат платил бы больше, чем отдано.
   */
/**
 * Карма персонажа.
 *
 * Отдельное чтение: в типе Character поля karma нет, карма лежит в колонке
 * characters, но в объект персонажа не попадает. Места, где она нужна,
 * идут через этот метод, а не пишут свой запрос: формулировки разъезжаются,
 * и про null забывает одна из сторон.
 *
 * Отсутствие строки — это ноль, то есть нейтральный персонаж. Лучше, чем
 * молчаливый undefined, на котором арифметика даёт NaN.
 */
  async getKarma(characterId: string): Promise<number> {
    const row = await this.db.queryOne<{ karma: number | null }>(
      'SELECT karma FROM characters WHERE id = $1',
      [characterId],
    );
    return Number(row?.karma ?? 0);
  }

  async addGoldReward(characterId: string, amount: number): Promise<number> {
    return this.addGold(characterId, Math.floor(amount * seasonalEvent.goldMultiplier()));
  }

  /**
   * Вернуть потраченное - в той же валюте, в которой тратили.
   *
   * ПОЧЕМУ ЭТО НЕ «ПРОСТО ВЕРНУТЬ В ЗОЛОТО». Маршрут покупки списывает
   * цену из кошелька, который указал магазин, и при неудачной выдаче
   * возвращал сумму через addGold - то есть всегда золотом. Сегодня все
   * лодки продаются за золото, поэтому расхождение не проявлялось. Но
   * стоит положить лодку в магазин за азены - и покупка «платит азенами,
   * а возвращает золото»: премиальная валюта превращается в золото, то
   * есть покупка становится обменом валюты, а не покупкой.
   *
   * Возврат идёт через add*, а не через addGoldReward: это не награда, и
   * сезонный бонус к возврату отношения не имеет.
   */
  async refund(characterId: string, wallet: WalletCurrency, amount: number): Promise<void> {
    const value = Math.max(0, Math.floor(amount));
    if (value === 0) return;
    if (wallet === 'azens') { await this.addAzens(characterId, value); return; }
    if (wallet === 'silver') { await this.addSilver(characterId, value); return; }
    if (wallet === 'syrian') { await this.addSyrianGold(characterId, value); return; }
    await this.addGold(characterId, value);
  }

  /** Атомарно списать золото. Бросает ошибку, если средств недостаточно. Возвращает остаток. */
  async spendGold(characterId: string, amount: number): Promise<number> {
    const cost = Math.max(0, Math.floor(amount));
    const row = await this.db.queryOne<{ gold: number }>(
      'UPDATE characters SET gold = gold - $1 WHERE id = $2 AND gold >= $1 RETURNING gold',
      [cost, characterId]
    );
    if (!row) throw new Error('Insufficient gold');
    return Number(row.gold);
  }

  /** Начислить AZENS (премиум-валюта). Возвращает новый баланс. */
  async addAzens(characterId: string, amount: number): Promise<number> {
    const row = await this.db.queryOne<{ azens: number }>(
      'UPDATE characters SET azens = azens + $1 WHERE id = $2 RETURNING azens',
      [Math.max(0, amount), characterId]
    );
    if (!row) throw new Error('Character not found');
    return Number(row.azens);
  }

  /** Атомарно списать AZENS. Бросает ошибку при нехватке. Возвращает остаток. */
  async spendAzens(characterId: string, amount: number): Promise<number> {
    const cost = Math.max(0, amount);
    const row = await this.db.queryOne<{ azens: number }>(
      'UPDATE characters SET azens = azens - $1 WHERE id = $2 AND azens >= $1 RETURNING azens',
      [cost, characterId]
    );
    if (!row) throw new Error('Insufficient AZENS');
    return Number(row.azens);
  }

  /** Начислить исфаханское серебро (бесплатная валюта квестов/ивентов). */
  async addSilver(characterId: string, amount: number): Promise<number> {
    const row = await this.db.queryOne<{ isfahan_silver: number }>(
      'UPDATE characters SET isfahan_silver = isfahan_silver + $1 WHERE id = $2 RETURNING isfahan_silver',
      [Math.max(0, Math.floor(amount)), characterId]
    );
    if (!row) throw new Error('Character not found');
    return Number(row.isfahan_silver);
  }

  /** Начислить сирийское золото (бесплатная валюта квестов/ивентов). */
  async addSyrianGold(characterId: string, amount: number): Promise<number> {
    const row = await this.db.queryOne<{ syrian_gold: number }>(
      'UPDATE characters SET syrian_gold = syrian_gold + $1 WHERE id = $2 RETURNING syrian_gold',
      [Math.max(0, Math.floor(amount)), characterId]
    );
    if (!row) throw new Error('Character not found');
    return Number(row.syrian_gold);
  }

  /** Атомарно списать исфаханское серебро. Бросает ошибку при нехватке. */
  async spendSilver(characterId: string, amount: number): Promise<number> {
    const cost = Math.max(0, Math.floor(amount));
    const row = await this.db.queryOne<{ isfahan_silver: number }>(
      'UPDATE characters SET isfahan_silver = isfahan_silver - $1 WHERE id = $2 AND isfahan_silver >= $1 RETURNING isfahan_silver',
      [cost, characterId]
    );
    if (!row) throw new Error('Insufficient Isfahan silver');
    return Number(row.isfahan_silver);
  }

  /** Атомарно списать сирийское золото. Бросает ошибку при нехватке. */
  async spendSyrianGold(characterId: string, amount: number): Promise<number> {
    const cost = Math.max(0, Math.floor(amount));
    const row = await this.db.queryOne<{ syrian_gold: number }>(
      'UPDATE characters SET syrian_gold = syrian_gold - $1 WHERE id = $2 AND syrian_gold >= $1 RETURNING syrian_gold',
      [cost, characterId]
    );
    if (!row) throw new Error('Insufficient Syrian gold');
    return Number(row.syrian_gold);
  }

  /** Атомный обмен свободных валют (золото/серебро/сирийское золото). */
  async exchange(
    characterId: string,
    debit: 'gold' | 'isfahan_silver' | 'syrian_gold',
    debitAmount: number,
    credit: 'gold' | 'isfahan_silver' | 'syrian_gold',
    creditAmount: number
  ): Promise<{ gold: number; silver: number; syrian: number }> {
    const cols = ['gold', 'isfahan_silver', 'syrian_gold'] as const;
    if (!cols.includes(debit) || !cols.includes(credit) || debit === credit) {
      throw new Error('Bad exchange pair');
    }
    const give = Math.max(1, Math.floor(debitAmount));
    const get = Math.max(1, Math.floor(creditAmount));
    const row = await this.db.queryOne<{ gold: number; isfahan_silver: number; syrian_gold: number }>(
      `UPDATE characters SET ${debit} = ${debit} - $1, ${credit} = ${credit} + $2
       WHERE id = $3 AND ${debit} >= $1
       RETURNING gold, isfahan_silver, syrian_gold`,
      [give, get, characterId]
    );
    if (!row) throw new Error('Insufficient funds for exchange');
    return { gold: Number(row.gold), silver: Number(row.isfahan_silver), syrian: Number(row.syrian_gold) };
  }

  /** Точный поиск персонажа по имени (для подарков). */
  async getCharacterByNameExact(name: string): Promise<Character | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM characters WHERE name = $1',
      [name]
    );
    if (!row) return null;
    return this.parseJsonFields(camelizeRow<Character>(row)!);
  }

  /** Долговая политика: при минусе по AZENS (чарджбэк/рефанд) любые траты
   *  запрещены до погашения. Проверять перед каждой тратой AZENS. */
  async assertSolvent(characterId: string): Promise<void> {
    const row = await this.db.queryOne<{ azens: number }>(
      'SELECT azens FROM characters WHERE id = $1',
      [characterId]
    );
    if (!row) throw new Error('Character not found');
    if (Number(row.azens) < 0) throw new Error('AZENS debt: top up to continue');
  }

  /**
   * Отметить, что персонаж побывал в регионе.
   *
   * Зачем отдельная таблица посещений, если есть characters.region: там лежит
   * ТЕКУЩИЙ регион, а достижениям нужен весь пройденный путь. Из одного
   * столбца «где персонаж сейчас» нельзя вывести ни «посетил Тебриз», ни
   * «посетил все семь» - в нём лежит только одна точка маршрута.
   *
   * ON CONFLICT DO NOTHING, а не DO UPDATE со счётчиком приходов: повторный
   * приход в тот же город не должен ни плодить строки, ни требовать записи.
   * Строка означает «здесь был», а не «сколько раз ходил».
   *
   * Ошибка не поднимается. Если запись не легла, персонаж всё равно
   * оказался в регионе, и ронять путешествие из-за отметки значило бы
   * наказать игрока за то, что он просто куда-то дошёл.
   */
  private async recordRegionVisit(characterId: string, region: Region): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO region_visits (character_id, region)
         VALUES ($1, $2)
         ON CONFLICT (character_id, region) DO NOTHING`,
        [characterId, region],
      );
    } catch (err) {
      logger.warn(`[Regions] не удалось отметить посещение ${region}: ${(err as Error).message}`);
    }
  }

  /** Сменить регион персонажа (путешествие). Возвращает обновлённого персонажа. */
  async updateRegion(characterId: string, region: Region): Promise<Character | null> {
    // ЧТО БЫЛО. Метод менял ровно одну вещь - region, - и больше ничего.
    // Путешествие меняло МЕТКУ, а персонаж оставался стоять на прежних
    // координатах. Зона же считалась функцией координат (getZoneAt на
    // каждом шаге), так что после поездки персонаж оказывался сразу в двух
    // местах: region = khorasan в базе и zone = tabriz_north по старой точке.
    // Оба поля хранились, оба показывались.
    //
    // Теперь регион и координаты меняются вместе: якорь региона из
    // REGION_SPAWNS, зона считается от новой точки. Регион стал местом,
    // а не подписью.
    const якорь = REGION_SPAWNS[region];
    if (!якорь) {
      // Раньше такой случай проходил молча: UPDATE отрабатывал, игрок
      // менял регион на тот, у которого нет ни якоря, ни зон, и оказывался
      // посреди пустоты без спавнов. Теперь это ошибка, а не поломка.
      logger.warn(`[Regions] путешествие без якоря: регион ${String(region)}`);
      return null;
    }
    const позиция = { x: якорь.x, y: 0, z: якорь.z };
    const зона = getZoneAt(якорь.x, якорь.z);

    const row = await this.db.queryOne<{ id: string }>(
      `UPDATE characters
          SET region = $2,
              position = $3,
              zone = $4,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id`,
      [characterId, region, JSON.stringify(позиция), зона?.id ?? null]
    );
    if (!row) return null;
    // Отметка посещения: сменить регион и забыть об этом нельзя, иначе
    // история путешествий не накапливалась бы и достижения по регионам
    // остались бы недостижимыми навсегда.
    await this.recordRegionVisit(characterId, region);
    return this.getCharacterById(characterId);
  }

  /** Сменить зону персонажа (при пересечении границы зоны). */
  async updateZone(characterId: string, zone: string | null): Promise<void> {
    await this.db.query(
      'UPDATE characters SET zone = $2, updated_at = NOW() WHERE id = $1',
      [characterId, zone]
    );
  }

  // ============================================================
  // Инвентарь (стеки: персонаж + предмет + уровень заточки)
  // ============================================================

  /** Добавить предметы (лут, награды). Стеки разводятся по уровню заточки. */
  async addItems(characterId: string, items: { itemId: string; qty: number; enhancement?: number }[]): Promise<void> {
    for (const it of items) {
      const enhancement = Math.max(0, Math.min(20, Math.floor(it.enhancement ?? 0)));
      await this.db.query(
        `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (character_id, item_id, enhancement)
         DO UPDATE SET quantity = character_items.quantity + EXCLUDED.quantity`,
        [characterId, it.itemId, Math.max(1, Math.floor(it.qty)), enhancement]
      );
      // Прогресс гильдейских заданий типа «собрать». void: addItems зовут
      // десять мест, включая выдачу наград, и ожидание не должно
      // становиться частью выдачи.
      void guildMissionService.onItemGained(characterId, it.itemId, Math.max(1, Math.floor(it.qty)));
    }
  }

  /** Списать предметы (сначала из более заточенных стеков). Бросает ошибку при нехватке. */
  async removeItems(characterId: string, items: { itemId: string; qty: number }[]): Promise<void> {
    await this.db.transaction(async (client) => {
      for (const it of items) {
        const qty = Math.max(1, Math.floor(it.qty));
        const res = await client.query(
          `UPDATE character_items SET quantity = quantity - $1
           WHERE id = (
             SELECT id FROM character_items
             WHERE character_id = $2 AND item_id = $3 AND quantity >= $1
             ORDER BY enhancement DESC LIMIT 1
             FOR UPDATE
           )`,
          [qty, characterId, it.itemId]
        );
        if (res.rowCount === 0) {
          const have = await client.query(
            'SELECT COALESCE(SUM(quantity), 0) AS total FROM character_items WHERE character_id = $1 AND item_id = $2',
            [characterId, it.itemId]
          );
          throw new Error(`Not enough items: ${it.itemId} (need ${qty}, have ${Number(have.rows[0].total)})`);
        }
        await client.query(
          'DELETE FROM character_items WHERE character_id = $1 AND item_id = $2 AND quantity <= 0',
          [characterId, it.itemId]
        );
      }
    });
  }

  /** Суммарное количество предмета по всем стекам: { itemId: qty } */
  async getItemQuantities(characterId: string): Promise<Record<string, number>> {
    const rows = await this.db.query<{ item_id: string; total: string | number }>(
      'SELECT item_id, SUM(quantity) AS total FROM character_items WHERE character_id = $1 GROUP BY item_id',
      [characterId]
    );
    const map: Record<string, number> = {};
    for (const r of rows) map[r.item_id] = Number(r.total);
    return map;
  }

  /** Инвентарь с именами/редкостью из ITEMS_DATABASE. */
  async getInventory(characterId: string): Promise<InventoryEntry[]> {
    const rows = await this.db.query<{ item_id: string; quantity: number; enhancement: number }>(
      'SELECT item_id, quantity, enhancement FROM character_items WHERE character_id = $1 ORDER BY acquired_at DESC',
      [characterId]
    );
    return rows
      .map(r => {
        const def = ITEMS_DATABASE[r.item_id];
        return {
          itemId: r.item_id,
          name: def?.name ?? r.item_id,
          nameRu: def?.nameRu ?? r.item_id,
          type: def?.type ?? 'material',
          rarity: def?.rarity ?? 'common',
          quantity: Number(r.quantity),
          enhancement: Number(r.enhancement),
        };
      });
  }

  // ============================================================
  // Экипировка (оружие / броня / аксессуар)
  // ============================================================

  private static SLOT_BY_TYPE: Partial<Record<ItemType, 'weapon' | 'armor' | 'accessory'>> = {
    [ItemType.WEAPON]: 'weapon',
    [ItemType.ARMOR]: 'armor',
    [ItemType.ACCESSORY]: 'accessory',
  };

  /** Экипированные предметы и агрегированные бонусы характеристик (+5% за уровень заточки). */
  async getEquipment(characterId: string): Promise<{ items: EquippedItem[]; stats: CharacterStats; bonuses: EquipmentBonuses }> {
    const rows = await this.db.query<{ slot: string; item_id: string; enhancement: number }>(
      'SELECT slot, item_id, enhancement FROM character_equipment WHERE character_id = $1',
      [characterId]
    );
    const items: EquippedItem[] = [];
    const stats: CharacterStats = { strength: 0, agility: 0, intelligence: 0, endurance: 0, charisma: 0 };
    // Бонусы воды копятся отдельно от характеристик: они не должны попадать
    // в сумму «Бонус характеристик» в панели персонажа
    const bonuses: EquipmentBonuses = { waterSpeed: 0, swimStamina: 0 };
    for (const r of rows) {
      const def = ITEMS_DATABASE[r.item_id];
      const enhancement = Number(r.enhancement);
      const mult = 1 + 0.05 * enhancement;
      items.push({
        slot: r.slot as EquippedItem['slot'],
        itemId: r.item_id,
        name: def?.name ?? r.item_id,
        nameRu: def?.nameRu ?? r.item_id,
        rarity: def?.rarity ?? 'common',
        enhancement,
        stats: def?.stats,
      });
      for (const [key, value] of Object.entries(def?.stats ?? {})) {
        if (key in stats) stats[key as keyof CharacterStats] += Math.round(Number(value) * mult);
      }
      bonuses.waterSpeed = Math.min(1, bonuses.waterSpeed + (def?.waterSpeed ?? 0) * mult);
      bonuses.swimStamina = Math.min(0.75, bonuses.swimStamina + (def?.swimStamina ?? 0) * mult);
    }
    return { items, stats, bonuses };
  }

  /** Надеть предмет: списывается из сумки, предыдущий предмет слота возвращается в неё. */
  async equipItem(characterId: string, itemId: string): Promise<{ items: EquippedItem[]; stats: CharacterStats }> {
    const def = ITEMS_DATABASE[itemId];
    if (!def) throw new Error('Item not found');
    const slot = CharacterService.SLOT_BY_TYPE[def.type];
    if (!slot) throw new Error('Item cannot be equipped');
    const character = await this.getCharacterById(characterId);
    if (!character) throw new Error('Character not found');
    if (def.level > character.level) throw new Error(`Requires level ${def.level}`);

    await this.db.transaction(async (client) => {
      // Взять один экземпляр из сумки (сверху — самый заточенный)
      const taken = await client.query(
        `UPDATE character_items SET quantity = quantity - 1
         WHERE id = (
           SELECT id FROM character_items
           WHERE character_id = $1 AND item_id = $2 AND quantity >= 1
           ORDER BY enhancement DESC LIMIT 1
           FOR UPDATE
         )
         RETURNING enhancement`,
        [characterId, itemId]
      );
      if (taken.rowCount === 0) throw new Error('Item not in inventory');
      const enhancement = Number(taken.rows[0].enhancement);
      await client.query(
        'DELETE FROM character_items WHERE character_id = $1 AND item_id = $2 AND quantity <= 0',
        [characterId, itemId]
      );

      // Снять предыдущий предмет слота обратно в сумку
      const prev = await client.query(
        'SELECT item_id, enhancement FROM character_equipment WHERE character_id = $1 AND slot = $2 FOR UPDATE',
        [characterId, slot]
      );
      if (prev.rows[0]) {
        await client.query(
          `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
           VALUES ($1, $2, 1, $3)
           ON CONFLICT (character_id, item_id, enhancement)
           DO UPDATE SET quantity = character_items.quantity + 1`,
          [characterId, prev.rows[0].item_id, Number(prev.rows[0].enhancement)]
        );
      }

      await client.query(
        `INSERT INTO character_equipment (character_id, slot, item_id, enhancement, equipped_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (character_id, slot)
         DO UPDATE SET item_id = EXCLUDED.item_id, enhancement = EXCLUDED.enhancement, equipped_at = NOW()`,
        [characterId, slot, itemId, enhancement]
      );
    });

    return this.getEquipment(characterId);
  }

  /** Снять предмет слота обратно в сумку. */
  async unequipItem(characterId: string, slot: 'weapon' | 'armor' | 'accessory'): Promise<{ items: EquippedItem[]; stats: CharacterStats }> {
    await this.db.transaction(async (client) => {
      const row = await client.query(
        'SELECT item_id, enhancement FROM character_equipment WHERE character_id = $1 AND slot = $2 FOR UPDATE',
        [characterId, slot]
      );
      if (!row.rows[0]) throw new Error('Nothing equipped in slot');
      await client.query(
        `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
         VALUES ($1, $2, 1, $3)
         ON CONFLICT (character_id, item_id, enhancement)
         DO UPDATE SET quantity = character_items.quantity + 1`,
        [characterId, row.rows[0].item_id, Number(row.rows[0].enhancement)]
      );
      await client.query(
        'DELETE FROM character_equipment WHERE character_id = $1 AND slot = $2',
        [characterId, slot]
      );
    });
    return this.getEquipment(characterId);
  }

  // ============================================================
  // Расходники
  // ============================================================

  private static USE_ITEM_EFFECTS = USE_ITEM_EFFECTS;

  /**
   * Использовать расходник: списывает предмет, восстанавливает ресурсы
   * и/или выдаёт временный бонус (кебаб, свиток учёного).
   */
  async useItem(characterId: string, itemId: string): Promise<{
    hp: number; maxHp: number; mana: number; maxMana: number; stamina: number; maxStamina: number;
    buff: ActiveBuff | null;
  }> {
    const def = ITEMS_DATABASE[itemId];
    if (!def) throw new Error('Item not found');
    if (def.type !== ItemType.CONSUMABLE) throw new Error('Item is not consumable');
    const effect = CharacterService.USE_ITEM_EFFECTS[itemId];
    // Предмет может не восстанавливать ресурсы, а давать временный бонус
    // (Свиток Учёного) — тогда всё, что он обещает, это бонус.
    const buffId = ITEM_BUFFS[itemId];
    if (!effect && !buffId) throw new Error('Item has no usable effect');

    await this.removeItems(characterId, [{ itemId, qty: 1 }]);
    const buff = buffId ? await getBuffService().grant(characterId, buffId) : null;

    // Бонус профессии «Травник»: восстановление от зелий и��насток сильнее.
    // Описание обещало «зелья действуют на 20% сильнее», и обещание было
    // ни с чем не связано. Множитель применяется к самому эффекту, а не к
    // величине запаса сверху: итог всё равно обрезается по максимуму, так
    // что «более сильное зелье» и «то же зелье при полном здоровье» - это
    // одно и то же.
    const prof = await professionOf(characterId);
    const potionMult = professionBonuses(prof?.id ?? null, prof?.level ?? 0).potion;
    const healed = (v: number): number => Math.max(1, Math.round(v * potionMult));

    const sets: string[] = [];
    const params: number[] = [];
    let i = 2; // $1 = characterId
    if (effect?.hp)      { sets.push(`hp = LEAST(max_hp, hp + ${i})`);          params.push(healed(effect.hp)); i++; }
    if (effect?.mana)    { sets.push(`mana = LEAST(max_mana, mana + ${i})`);    params.push(healed(effect.mana)); i++; }
    if (effect?.stamina) { sets.push(`stamina = LEAST(max_stamina, stamina + ${i})`); params.push(healed(effect.stamina)); i++; }
    // Предмет без мгновенного восстановления: трогаем только отметку времени
    if (!sets.length) {
      await this.db.query('UPDATE characters SET updated_at = NOW() WHERE id = $1', [characterId]);
      const cur = await this.getCharacterById(characterId);
      if (!cur) throw new Error('Character not found');
      return {
        hp: cur.hp, maxHp: cur.maxHp,
        mana: cur.mana, maxMana: cur.maxMana,
        stamina: cur.stamina, maxStamina: cur.maxStamina,
        buff,
      };
    }
    const row = await this.db.queryOne<Record<string, number>>(
      `UPDATE characters SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $1
       RETURNING hp, max_hp, mana, max_mana, stamina, max_stamina`,
      [characterId, ...params]
    );
    if (!row) throw new Error('Character not found');
    return {
      hp: Number(row.hp), maxHp: Number(row.max_hp),
      mana: Number(row.mana), maxMana: Number(row.max_mana),
      stamina: Number(row.stamina), maxStamina: Number(row.max_stamina),
      buff,
    };
  }
}

export interface InventoryEntry {
  itemId: string;
  name: string;
  nameRu: string;
  type: string;
  rarity: string;
  quantity: number;
  enhancement: number;
}

export interface EquippedItem {
  slot: 'weapon' | 'armor' | 'accessory';
  itemId: string;
  name: string;
  nameRu: string;
  rarity: string;
  enhancement: number;
  stats?: Partial<CharacterStats>;
}
