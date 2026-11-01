// ============================================================
// Система партий и рейдов — Empire of Safavids
// ============================================================

export type PartyRole = 'leader' | 'member';
export type LootRule  = 'free_for_all' | 'round_robin' | 'leader_decides' | 'need_greed';

export interface PartyMember {
  characterId: string;
  role: PartyRole;
  joinedAt: Date;
  /** Счетчик приглашенных друзей для кооперативного бонуса */
  referralCount: number;
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

// Партии хранятся в Redis (временные данные)
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
      members: [{ characterId: leaderId, role: 'leader', joinedAt: new Date(), referralCount: 0 }],
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

    party.members.push({ characterId: targetId, role: 'member', joinedAt: new Date(), referralCount: 0 });
    await this.saveParty(party);
    await this.redis.set(this.playerKey(targetId), party.id);

    await this.redis.publish(REDIS_CHANNELS.PARTY_MEMBER_JOINED, { partyId, characterId: targetId });
    logger.info(`${targetId} joined party ${partyId}`);
  }