// ============================================================
// Сервис гильдий — Empire of Safavids
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './DatabaseService';
import { RedisService } from './RedisService';
import { logger } from '../utils/logger';
import { camelizeRow } from '../utils/camelize';
import { Guild } from '../types/game.types';
import { GuildRank, canPromote, getGuildRankPermissions } from '../data/guilds';

export class GuildService {
  private db = DatabaseService.getInstance();
  private redis = RedisService.getInstance();

  async createGuild(leaderId: string, name: string, description: string): Promise<Guild> {
    const existing = await this.db.queryOne('SELECT id FROM guilds WHERE name = $1', [name]);
    if (existing) throw new Error('Guild name already taken');

    const guild: Guild = {
      id: uuidv4(),
      name,
      description,
      leaderId,
      members: [leaderId],
      level: 1,
      gold: 0,
      createdAt: new Date(),
    };

    await this.db.transaction(async (client) => {
      await client.query(
        'INSERT INTO guilds (id, name, description, leader_id, level, gold, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)',
        [guild.id, guild.name, guild.description, guild.leaderId, guild.level, guild.gold, guild.createdAt]
      );
      await client.query(
        'INSERT INTO guild_members (guild_id, character_id, rank) VALUES ($1,$2,$3)',
        [guild.id, leaderId, 'leader']
      );
      await client.query(
        'UPDATE characters SET guild_id = $1 WHERE id = $2',
        [guild.id, leaderId]
      );
    });

    logger.info(`Guild created: ${name} by ${leaderId}`);
    return guild;
  }

  async inviteMember(guildId: string, inviterId: string, targetId: string): Promise<void> {
    const inviterRank = await this.getMemberRank(guildId, inviterId);
    const perms = getGuildRankPermissions(inviterRank as GuildRank);
    if (!perms?.invite) throw new Error('No permission to invite');

    const memberCount = await this.db.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM guild_members WHERE guild_id = $1', [guildId]
    );
    if (parseInt(memberCount?.count ?? '0') >= 100) throw new Error('Guild is full (max 100 members)');

    await this.db.transaction(async (client) => {
      await client.query(
        'INSERT INTO guild_members (guild_id, character_id, rank) VALUES ($1,$2,$3)',
        [guildId, targetId, 'recruit']
      );
      await client.query('UPDATE characters SET guild_id = $1 WHERE id = $2', [guildId, targetId]);
    });

    await this.redis.publish('guild:member_joined', { guildId, characterId: targetId });
    logger.info(`Character ${targetId} joined guild ${guildId}`);
  }

  async kickMember(guildId: string, kickerId: string, targetId: string): Promise<void> {
    const kickerRank = await this.getMemberRank(guildId, kickerId);
    const perms = getGuildRankPermissions(kickerRank as GuildRank);
    if (!perms?.kick) throw new Error('No permission to kick');

    const targetRank = await this.getMemberRank(guildId, targetId);
    if (targetRank === 'leader') throw new Error('Cannot kick the guild leader');

    await this.db.transaction(async (client) => {
      await client.query('DELETE FROM guild_members WHERE guild_id = $1 AND character_id = $2', [guildId, targetId]);
      await client.query('UPDATE characters SET guild_id = NULL WHERE id = $1', [targetId]);
    });

    logger.info(`Character ${targetId} kicked from guild ${guildId} by ${kickerId}`);
  }

  async promoteMember(guildId: string, promoterId: string, targetId: string, newRank: GuildRank): Promise<void> {
    const promoterRank = await this.getMemberRank(guildId, promoterId);
    const perms = getGuildRankPermissions(promoterRank as GuildRank);
    if (!perms?.promote) throw new Error('No permission to promote');

    const targetRank = await this.getMemberRank(guildId, targetId);
    if (!canPromote(promoterRank as GuildRank, targetRank as GuildRank)) {
      throw new Error('Cannot promote to this rank');
    }

    await this.db.query(
      'UPDATE guild_members SET rank = $1 WHERE guild_id = $2 AND character_id = $3',
      [newRank, guildId, targetId]
    );
  }

  async depositGold(guildId: string, characterId: string, amount: number): Promise<void> {
    await this.db.transaction(async (client) => {
      const char = await client.query('SELECT gold FROM characters WHERE id = $1 FOR UPDATE', [characterId]);
      if (!char.rows[0] || char.rows[0].gold < amount) throw new Error('Insufficient gold');

      await client.query('UPDATE characters SET gold = gold - $1 WHERE id = $2', [amount, characterId]);
      await client.query('UPDATE guilds SET gold = gold + $1, updated_at = NOW() WHERE id = $2', [amount, guildId]);
    });
  }

  /** Список всех гильдий: имя, лидер, число членов (для панели гильдий) */
  async listGuilds(): Promise<{ id: string; name: string; description: string; leaderName: string; members: number }[]> {
    const rows = await this.db.query<Record<string, unknown>>(
          );
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      description: String(r.description),
      leaderName: String(r.leader_name),
      members: Number(r.members),
    }));
  }

  async getGuildInfo(guildId: string): Promise<Guild | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM guilds WHERE id = $1', [guildId]
    );
    return camelizeRow<Guild>(row);
  }

  async getGuildMembers(guildId: string): Promise<{ characterId: string; rank: GuildRank; joinedAt: Date }[]> {
    return this.db.query(
      'SELECT character_id as "characterId", rank, joined_at as "joinedAt" FROM guild_members WHERE guild_id = $1 ORDER BY joined_at ASC',
      [guildId]
    );
  }

  private async getMemberRank(guildId: string, characterId: string): Promise<string> {
    const row = await this.db.queryOne<{ rank: string }>(
      'SELECT rank FROM guild_members WHERE guild_id = $1 AND character_id = $2',
      [guildId, characterId]
    );
    if (!row) throw new Error('Character is not a guild member');
    return row.rank;
  }
}
