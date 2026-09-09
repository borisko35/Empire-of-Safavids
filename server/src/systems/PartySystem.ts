// ============================================================
// Система партий и рейдов — Empire of Safavids
// ============================================================

import { RedisService } from '../services/RedisService';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

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

export interface RaidGroup {
  id: string;
  name: string;
  parties: Party[];
  maxParties: number;
  leaderId: string;
  createdAt: Date;
}

export class PartySystem {
  private redis = RedisService.getInstance();

  // Партии хранятся в Redis (временные данные)
  private partyKey  = (id: string) => `party:${id}`;
  private raidKey   = (id: string) => `raid:${id}`;
  private playerKey = (id: string) => `player:party:${id}`;

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

    await this.redis.publish('party:member_joined', { partyId, characterId: targetId });
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
    await this.redis.publish('party:member_left', { partyId, characterId });
  }

  async disbandParty(partyId: string): Promise<void> {
    const party = await this.getParty(partyId);
    if (!party) return;
    // Удаляем данные из Redis
    await this.redis.del(this.partyKey(partyId));
    for (const member of party.members) {
      await this.redis.del(this.playerKey(member.characterId));
    }
    await this.redis.publish('party:disbanded', { partyId });
    logger.info(`Party disbanded: ${partyId}`);
  }

  /** Распределение опыта в партии */
  distributeExp(baseExp: number, partySize: number): number {
    // Бонус за партию: +20% за каждого дополнительного члена
    const bonus = 1 + (partySize - 1) * 0.2;
    return Math.floor((baseExp * bonus) / partySize);
  }

  // Рейды (4 партии по 5 человек = 20 игроков)
  async createRaid(leaderId: string, name: string): Promise<RaidGroup> {
    const leaderParty = await this.createParty(leaderId);
    const raid: RaidGroup = {
      id: uuidv4(),
      name,
      parties: [leaderParty],
      maxParties: 4,
      leaderId,
      createdAt: new Date(),
    };
    // Рейд тоже живёт в Redis (временные данные)
    await this.redis.set(this.raidKey(raid.id), JSON.stringify(raid), 6 * 3600);
    logger.info(`Raid created: ${raid.id} "${name}" by ${leaderId}`);
    return raid;
  }

  /** Публичное чтение партии (для REST-роута) */
  async getPartyInfo(partyId: string): Promise<Party | null> {
    return this.getParty(partyId);
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
    await this.redis.publish('party:updated', { partyId: party.id, members: party.members });
  }
}
