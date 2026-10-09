// ============================================================
// Система партий и рейдов — Empire of Safavids
// ============================================================

import { RedisService } from '../services/RedisService';
import { CharacterService } from '../services/CharacterService';
import { DungeonService, type DungeonSession } from './DungeonService';
import { DUNGEONS_DATABASE, type DungeonDefinition } from '../data/dungeons';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { REDIS_CHANNELS } from '../../../shared/constants';

export type PartyRole = 'leader' | 'member';
export type LootRule  = 'free_for_all' | 'round_robin' | 'leader_decides' | 'need_greed';

export interface PartyMember {
  characterId: string;
  role: PartyRole;
  joinedAt: Date;
}

export interface Party {
  id: string;
  members: PartyMember[];
  maxSize: number;
  lootRule: LootRule;
  createdAt: Date;
}

/**
 * Рейд: сбор партий, входящих в один заход.
 *
 * Два новых поля против прежних — и оба несущественные.
 *
 * `dungeonId` — какому подземелью рейд принадлежит. Без него состав партий
 * существовал сам по себе и ни с чем не был связан: рейд можно было бы
 * собрать и посмотреть на него, и никуда бы он не вёл.
 *
 * `sessionId` — заход, ради которого рейд собирается. Рейд не своя механика:
 * это тот же заход DungeonService, в который входят партиями.
 */
export interface RaidGroup {
  id: string;
  name: string;
  parties: Party[];
  maxParties: number;
  leaderId: string;
  /** Подземелье рейда. Обязано быть помечено isRaid. */
  dungeonId: string;
  /** Заход в подземелье, к которому рейд привязан. */
  sessionId: string;
  createdAt: Date;
}

/**
 * Срок жизни рейда в Redis — 6 часов.
 *
 * Ровно столько же, сколько было зашито в мёртвом createRaid. Совпадение не
 * случайно: там число стояло без причины, здесь у него есть причина — рейд
 * держится дольше обычной партии (12 часов), потому что заход на двадцать
 * человек не собирается за вечер.
 */
const RAID_TTL_SECONDS = 6 * 3600;

/** Строка списка открытых рейдов — ровно то, что нужно панели выбора. */
export interface RaidListing {
  raidId: string;
  name: string;
  parties: number;
  maxParties: number;
  members: number;
  maxPlayers: number;
}

export class PartySystem {
  private redis = RedisService.getInstance();
  private characters = new CharacterService();
  /**
   * Заходы подземелий — синглтон, а не новый экземпляр.
   *
   * Именно потому и синглтон: рейд обязан видеть те же сессии, что и кнопка
   * «войти». Второй экземпляр был бы вторым списком заходов в том же процессе,
   * и рейд собрался бы вокруг сессии, которой никто не видит.
   */
  private dungeons = DungeonService.getInstance();

  // Партии хранятся в Redis (временные данные)
  private partyKey  = (id: string) => `party:${id}`;
  private raidKey   = (id: string) => `raid:${id}`;
  private playerKey = (id: string) => `player:party:${id}`;
  /** Множество открытых рейдов данжа: список для панели. */
  private raidIndexKey = (dungeonId: string) => `raid:index:${dungeonId}`;
  /** Кто в каком рейде: обратная ссылка для игрока. */
  private playerRaidKey = (characterId: string) => `player:raid:${characterId}`;

  async createParty(leaderId: string, lootRule: LootRule = 'round_robin'): Promise<Party> {
    // Проверяем, не в партии ли уже
    const existing = await this.redis.get(this.playerKey(leaderId));
    if (existing) throw new Error('Already in a party');

    const party: Party = {
      id: uuidv4(),
      members: [{ characterId: leaderId, role: 'leader', joinedAt: new Date() }],
      maxSize: 5,
      lootRule,
      createdAt: new Date(),
    };

    await this.saveParty(party);
    // Быстрый индекс: characterId -> partyId (для чата и приглашений)
    await this.redis.set(this.playerKey(leaderId), party.id);
    logger.info(`Party created: ${party.id} by ${leaderId}`);
    return party;
  }

  async inviteToParty(partyId: string, inviterId: string, targetId: string): Promise<void> {
    const party = await this.getParty(partyId);
    if (!party) throw new Error('Party not found');
    if (party.members.length >= party.maxSize) throw new Error('Party is full (max 5)');
    if (!party.members.find(m => m.characterId === inviterId && m.role === 'leader')) {
      throw new Error('Only the party leader can invite');
    }
    if (party.members.find(m => m.characterId === targetId)) {
      throw new Error('Player is already in the party');
    }

    party.members.push({ characterId: targetId, role: 'member', joinedAt: new Date() });
    await this.saveParty(party);
    await this.redis.set(this.playerKey(targetId), party.id);

    await this.redis.publish(REDIS_CHANNELS.PARTY_MEMBER_JOINED, { partyId, characterId: targetId });
    logger.info(`${targetId} joined party ${partyId}`);
  }

  async leaveParty(partyId: string, characterId: string): Promise<void> {
    const party = await this.getParty(partyId);
    if (!party) return;

    const isLeader = party.members.find(m => m.characterId === characterId)?.role === 'leader';
    party.members = party.members.filter(m => m.characterId !== characterId);
    await this.redis.del(this.playerKey(characterId));

    if (party.members.length === 0) {
      await this.disbandParty(partyId);
      return;
    }

    // Передаём лидерство следующему
    if (isLeader) party.members[0].role = 'leader';

    await this.saveParty(party);
    await this.redis.publish(REDIS_CHANNELS.PARTY_MEMBER_LEFT, { partyId, characterId });
  }

  async disbandParty(partyId: string): Promise<void> {
    const party = await this.getParty(partyId);
    if (!party) return;
    // Удаляем данные из Redis
    await this.redis.del(this.partyKey(partyId));
    for (const member of party.members) {
      await this.redis.del(this.playerKey(member.characterId));
    }
    // Состав обязателен в событии: партия к этому моменту уже удалена из
    // Redis, и подписчик, который ищет участников по partyId, не найдёт
    // никого. Без members никто из ушедших не узнает, что партия
    // расформирована, - панель продолжит показывать её.
    await this.redis.publish(REDIS_CHANNELS.PARTY_DISBANDED, { partyId, members: party.members });
    logger.info(`Party disbanded: ${partyId}`);
  }

  /** Распределение опыта в партии */
  distributeExp(baseExp: number, partySize: number): number {
    // Бонус за партию: +20% за каждого дополнительного члена
    const bonus = 1 + (partySize - 1) * 0.2;
    return Math.floor((baseExp * bonus) / partySize);
  }

  // ── РЕЙДЫ ────────────────────────────────────────────────────────────
  // ЧТО ЗДЕСЬ БЫЛО. createRaid лежал с момента своего появления и не имел
  // ни одного вызова, ни одного читателя. Рейда в игре не существовало:
  // заход на двадцать человек был один (пещеры Хорасана), и от обычного
  // подземелья его ничто не отличало.
  //
  // ЧТО ЗДЕСЬ ТЕПЕРЬ. Рейд — это заход, в который собираются ПАРТИИ.
  // Одна партия = до пяти человек, четыре партии = двадцать. Разница с
  // обычным заходом не в числе мест (у рейда их тоже двадцать), а в том,
  // что входят не поодиночке, а целой партией: человек не может уйти в
  // рейд один, оставив товарищей снаружи.
  //
  // Рейд не своя механика и не своя копия сессии. Это заход DungeonService
  // плюс состав партий в Redis. Своя копия означала бы второе место, где
  // живут монстры и где надо отдельно считать убитых боссов.

  /**
   * Открыть рейд: создать партию лидера и привязать к ней заход в данж.
   *
   * Порядок именно такой — сначала заход, потом запись в Redis. Наоборот
   * рейд остался бы в списке без сессии: игрок увидел бы «сбор 1/4 партий»,
   * нажал «вступить» и получил отказ, которого нет ни в одном слове.
   */
  async createRaid(leaderId: string, name: string, dungeonId: string): Promise<
    { ok: true; raid: RaidGroup } | { ok: false; code: string }
  > {
    const def = DUNGEONS_DATABASE[dungeonId];
    // Рейд бывает только у подземелья, которое помечено рейдом. Иначе в рейд
    // можно было бы загнать гробницу, где пять человек, и четыре партии туда
    // просто не влезли бы — а список показывал бы «сбор 1/4».
    if (!def?.isRaid) return { ok: false, code: 'raid_not_raid_dungeon' };

    // Лидер не должен состоять в другом рейде.
    //
    // Раньше этого не было, и было бы опасно: партия лидера переиспользуется
    // (см. ниже), поэтому второй вызов создал бы ВТОРОЙ рейд с той же
    // партией в обоих. Человек оказался бы в двух рейдах сразу, причём в
    // списках обоих светилась бы одна и та же партия, а заход был один.
    const ужеВРейде = await this.redis.get(this.playerRaidKey(leaderId));
    if (ужеВРейде) {
      const прежний = await this.getRaid(ужеВРейде);
      const сессияПрежнего = прежний ? this.dungeons.getSession(прежний.sessionId) : undefined;
      // Закрытый рейд не мешает: ссылки на него могли не убраться, если
      // сервер перезапустился. Живой — мешает, и очень.
      if (прежний && сессияПрежнего && !сессияПрежнего.completedAt) {
        return { ok: false, code: 'raid_already_in_raid' };
      }
      await this.redis.del(this.playerRaidKey(leaderId));
    }

    // Лидер уже может быть в партии: createParty бросает исключение, и рейд
    // не создался бы, оставив игрока ни с чем.
    //
    // Бросок перехватывается: createParty кидает обычный Error, который
    // дошёл бы до маршрута как 500 «внутренняя ошибка». Здесь рейд должен
    // ответить кодом, как отвечает на всё остальное.
    const existing = await this.redis.get(this.playerKey(leaderId));
    let leaderParty: Party;
    try {
      leaderParty = existing
        ? (await this.getParty(existing)) ?? (await this.createParty(leaderId))
        : await this.createParty(leaderId);
    } catch {
      return { ok: false, code: 'raid_party_create_failed' };
    }

    const заход = await this.dungeons.enter(leaderId, dungeonId);
    if (!заход.ok) return { ok: false, code: заход.code };

    const maxParties = Math.max(1, Math.ceil(def.maxPlayers / Math.max(1, leaderParty.maxSize)));
    const raid: RaidGroup = {
      id: uuidv4(),
      name: name.slice(0, 40),
      parties: [leaderParty],
      maxParties,
      leaderId,
      dungeonId,
      sessionId: заход.session.id,
      createdAt: new Date(),
    };
    await this.saveRaid(raid);
    logger.info(`[Party] рейд ${raid.id} «${raid.name}» создан ${leaderId}, ` +
      `${dungeonId}, заход ${raid.sessionId}, партий 1/${maxParties}`);
    return { ok: true, raid };
  }

  /**
   * Войти в рейд всей партией.
   *
   * ГЛАВНОЕ ПРАВИЛО — ВСЯ ИЛИ НИКТО. Партия проверяется целиком ДО того, как
   * кто-либо в неё войдёт. Проверять по одному и отпускать на волю значило бы
   * оставить внутри двоих из пяти: «рейд из трёх человек», куда вошли не
   * те, кого игрок звал. Хуже — потом никто не поймёт, почему трое в рейде, а
   * двое стоят снаружи и ждут.
   *
   * Если вход всё же сорвался на середине (гонка с чужим заходом), уже
   * вошедших выгоняем обратно: половина партии внутри хуже, чем её отсутствие.
   */
  async joinRaid(characterId: string, raidId: string): Promise<
    { ok: true; joined: string[]; raid: RaidGroup } | { ok: false; code: string }
  > {
    const raid = await this.getRaid(raidId);
    if (!raid) return { ok: false, code: 'raid_not_found' };

    const сессия = this.dungeons.getSession(raid.sessionId);
    if (!сессия || сессия.completedAt) return { ok: false, code: 'raid_closed' };

    const def = DUNGEONS_DATABASE[raid.dungeonId];
    if (!def) return { ok: false, code: 'dungeon_not_found' };

    const partyId = await this.redis.get(this.playerKey(characterId));
    if (!partyId) return { ok: false, code: 'raid_no_party' };
    const party = await this.getParty(partyId);
    if (!party) return { ok: false, code: 'raid_no_party' };

    // Та же партия, что уже в рейде — повторный вход не ошибка, но и не дело:
    // второй раз списывать попытку было бы наказанием за нажатие кнопки.
    if (raid.parties.some(p => p.id === party.id)) return { ok: false, code: 'raid_party_already_in' };
    if (raid.parties.length >= raid.maxParties) return { ok: false, code: 'raid_full' };

    const members = party.members.map(m => m.characterId);
    // Мест в заходе хватит всем или никому.
    if (сессия.members.size + members.length > def.maxPlayers) {
      return { ok: false, code: 'dungeon_full' };
    }

    // Предварительная проверка: ни одного join, пока не проверены все.
    for (const id of members) {
      const отказ = await this.canJoinRun(id, def, сессия);
      if (отказ) return { ok: false, code: отказ };
    }

    const вошедшие: string[] = [];
    for (const id of members) {
      const результат = await this.dungeons.join(id, raid.sessionId);
      if (!результат.ok) {
        for (const уже of вошедшие) {
          await this.dungeons.leave(уже).catch(() => undefined);
        }
        logger.warn(`[Party] рейд ${raid.id}: вход ${id} сорвался (${результат.code}), ` +
          `${вошедшие.length} откатил`);
        return { ok: false, code: результат.code };
      }
      вошедшие.push(id);
    }

    raid.parties.push(party);
    await this.saveRaid(raid);
    for (const id of members) await this.redis.set(this.playerRaidKey(id), raid.id);
    logger.info(`[Party] партия ${party.id} (${members.length}) в рейде ${raid.id}, ` +
      `партий ${raid.parties.length}/${raid.maxParties}, в заходе ${сессия.members.size}/${def.maxPlayers}`);
    return { ok: true, joined: вошедшие, raid };
  }

  /**
   * Открытые рейды данжа — то, что показывает панель.
   *
   * Мёртвые рейды (сессия закрыта) выбрасываются и из ответа, и из индекса:
   * индекс в Redis иначе копил бы мёртвые записи до истечения TTL.
   */
  async listOpenRaids(dungeonId: string): Promise<RaidListing[]> {
    const def = DUNGEONS_DATABASE[dungeonId];
    if (!def?.isRaid) return [];

    const ids = await this.redis.smembers(this.raidIndexKey(dungeonId));
    const открытые: RaidListing[] = [];
    const мёртвые: string[] = [];

    for (const id of ids) {
      const raid = await this.getRaid(id);
      const сессия = raid ? this.dungeons.getSession(raid.sessionId) : undefined;
      if (!raid || !сессия || сессия.completedAt) {
        мёртвые.push(id);
        continue;
      }
      открытые.push({
        raidId: raid.id,
        name: raid.name,
        parties: raid.parties.length,
        maxParties: raid.maxParties,
        members: сессия.members.size,
        maxPlayers: def.maxPlayers,
      });
    }

    if (мёртвые.length) await this.redis.srem(this.raidIndexKey(dungeonId), ...мёртвые);
    return открытые;
  }

  /** Рейд, в котором состоит персонаж, или null. */
  async getRaidOf(characterId: string): Promise<RaidGroup | null> {
    const id = await this.redis.get(this.playerRaidKey(characterId));
    if (!id) return null;
    return this.getRaid(id);
  }

  /**
   * Может ли персонаж войти в этот заход — без самого входа.
   *
   * Те же правила, что у DungeonService.join, только без побочных эффектов:
   * precheck в joinRaid обязан спрашивать ровно то же, что потом проверит
   * join. Списки, разошедшиеся после правки одного из них, означали бы
   * «проверили — зашли» с разным смыслом.
   */
  private async canJoinRun(
    characterId: string,
    def: DungeonDefinition,
    сессия: DungeonSession
  ): Promise<string | null> {
    if (сессия.completedAt) return 'dungeon_session_closed';
    if (сессия.members.has(characterId)) return 'dungeon_already_in_session';
    if (сессия.members.size >= def.maxPlayers) return 'dungeon_full';

    const занятый = this.dungeons.getSessionForCharacter(characterId);
    if (занятый && !занятый.completedAt) return 'dungeon_already_inside';

    const character = await this.characters.getCharacterById(characterId);
    if (!character) return 'character_not_found';
    if (character.level < def.minLevel || character.level > def.maxLevel) return 'dungeon_level_range';
    if (character.region !== def.region) return 'dungeon_wrong_region';
    if ((character.serverId ?? 'isfahan') !== сессия.shardId) return 'dungeon_wrong_shard';
    if (await this.dungeons.attemptsLeft(characterId, def.id) <= 0) return 'dungeon_attempts_exhausted';
    return null;
  }

  /** Публичное чтение партии (для REST-роута) */
  async getPartyInfo(partyId: string): Promise<Party | null> {
    return this.getParty(partyId);
  }

  /** Публичное чтение рейда (для REST-роута). */
  async getRaidInfo(raidId: string): Promise<RaidGroup | null> {
    return this.getRaid(raidId);
  }

  private async getRaid(raidId: string): Promise<RaidGroup | null> {
    const raw = await this.redis.get(this.raidKey(raidId));
    if (!raw) return null;
    try {
      const raid = JSON.parse(raw) as RaidGroup;
      raid.createdAt = new Date(raid.createdAt);
      raid.parties = (raid.parties ?? []).map(p => ({
        ...p,
        createdAt: new Date(p.createdAt),
        members: (p.members ?? []).map(m => ({ ...m, joinedAt: new Date(m.joinedAt) })),
      }));
      return raid;
    } catch {
      return null;
    }
  }

  /**
   * Сохранить рейд: содержимое и в списке данжа.
   *
   * Два ключа, а не один. По содержимому находят рейд по id (кнопка
   * «вступить»), по индексу — все открытые рейды данжа (панель). Писать
   * только содержимое значило бы, что рейд есть, а панель его не видит.
   */
  private async saveRaid(raid: RaidGroup): Promise<void> {
    await this.redis.set(this.raidKey(raid.id), JSON.stringify(raid), RAID_TTL_SECONDS);
    await this.redis.sadd(this.raidIndexKey(raid.dungeonId), raid.id);
  }

  private async getParty(partyId: string): Promise<Party | null> {
    const raw = await this.redis.get(this.partyKey(partyId));
    if (!raw) return null;
    try {
      const party = JSON.parse(raw) as Party;
      // Dates при сериализации превратились в строки
      party.createdAt = new Date(party.createdAt);
      party.members = party.members.map(m => ({ ...m, joinedAt: new Date(m.joinedAt) }));
      return party;
    } catch {
      return null;
    }
  }

  private async saveParty(party: Party): Promise<void> {
    // TTL 12 часов: брошенные партии не копятся в Redis
    await this.redis.set(this.partyKey(party.id), JSON.stringify(party), 12 * 3600);
    await this.redis.publish(REDIS_CHANNELS.PARTY_UPDATED, { partyId: party.id, members: party.members });
  }
}
