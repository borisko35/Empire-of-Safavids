// ============================================================
// Guild Service — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { RedisService } from './RedisService';
import { logger } from '../utils/logger';

export interface Guild {
  id: string; name: string; tag: string; leader_id: string;
  description: string; level: number; experience: number; gold: number;
  max_members: number; banner_color: string; created_at: string;
}

export interface GuildMember {
  character_id: string; character_name: string; rank: string;
  contribution_points: number; joined_at: string; level: number; online: boolean;
}

export class GuildService {
  private db = DatabaseService.getInstance();
  private redis = RedisService.getInstance();

  async createGuild(name: string, tag: string, leaderId: string, desc: string): Promise<Guild> {
    // Проверяем, не состоит ли уже в гильдии
    const existing = await this.db.queryOne(
      'SELECT guild_id FROM guild_members WHERE character_id = $1', [leaderId]
    );
    if (existing) throw new Error('Already in a guild');

    // Проверяем уникальность
    const nameTaken = await this.db.queryOne(
      'SELECT id FROM guilds WHERE name = $1 OR tag = $2', [name, tag]
    );
    if (nameTaken) throw new Error('Guild name or tag taken');

    const result = await this.db.queryOne<Guild>(
      `INSERT INTO guilds (name, tag, leader_id, description)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, tag, leaderId, desc]
    );
    // Добавляем создателя как лидера
    await this.db.query(
      `INSERT INTO guild_members (guild_id, character_id, rank)
       VALUES ($1, $2, 'leader')`, [result!.id, leaderId]
    );
    logger.info(`[Guild] Created: ${name} [${tag}] by ${leaderId}`);
    return result!;
  }

  async getGuild(guildId: string): Promise<Guild | null> {
    return this.db.queryOne<Guild>('SELECT * FROM guilds WHERE id = $1', [guildId]);
  }

  async getGuildByCharacter(charId: string): Promise<{ guild: Guild; rank: string } | null> {
    const row = await this.db.queryOne<{ guild_id: string; rank: string }>(
      'SELECT guild_id, rank FROM guild_members WHERE character_id = $1', [charId]
    );
    if (!row) return null;
    const guild = await this.getGuild(row.guild_id);
    return guild ? { guild, rank: row.rank } : null;
  }

  async getMembers(guildId: string): Promise<GuildMember[]> {
    const members = await this.db.query<GuildMember>(
      `SELECT gm.character_id, c.name as character_name, gm.rank,
              gm.contribution_points, gm.joined_at, c.level, FALSE as online
       FROM guild_members gm
       JOIN characters c ON c.id = gm.character_id
       WHERE gm.guild_id = $1
       ORDER BY
         CASE gm.rank WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 WHEN 'veteran' THEN 2 ELSE 3 END,
         c.level DESC`,
      [guildId]
    );

    // ТУТ БЫЛО ЛОЖНОЕ «НИКТО НЕ В СЕТИ». В SQL жёстко стояло FALSE as online,
    // и поле возвращалось с ответом, не глядя в Redis. Итог: список участников
    // показывал ВСЕХ офлайн, даже тех, кто прямо сейчас играет в этой же
    // гильдии. Для гильдии это не мелочь: «кто сейчас на связи» — первое,
    // что ищут в составе, и ради этого в MMO и вступают.
    // Тот же вызов уже использует FriendsService для друзей — логика одна.
    if (members.length > 0) {
      const onlineMap = await this.redis
        .arePlayersOnline(members.map(m => m.character_id))
        .catch(() => new Map<string, boolean>());
      for (const member of members) {
        member.online = onlineMap.get(member.character_id) ?? false;
      }
    }

    return members;
  }

  async addMember(guildId: string, charId: string): Promise<void> {
    const guild = await this.getGuild(guildId);
    if (!guild) throw new Error('Guild not found');
    const members = await this.getMembers(guildId);
    if (members.length >= guild.max_members) throw new Error('Guild is full');
    const existing = await this.db.queryOne(
      'SELECT guild_id FROM guild_members WHERE character_id = $1', [charId]
    );
    if (existing) throw new Error('Already in a guild');
    await this.db.query(
      'INSERT INTO guild_members (guild_id, character_id) VALUES ($1, $2)',
      [guildId, charId]
    );
    await this.addLog(guildId, 'member_joined', charId);
  }

  async removeMember(guildId: string, charId: string): Promise<void> {
    await this.db.query(
      'DELETE FROM guild_members WHERE guild_id = $1 AND character_id = $2',
      [guildId, charId]
    );
    await this.addLog(guildId, 'member_left', charId);
  }

  async setRank(guildId: string, charId: string, rank: string): Promise<void> {
    await this.db.query(
      'UPDATE guild_members SET rank = $1 WHERE guild_id = $2 AND character_id = $3',
      [rank, guildId, charId]
    );
  }

  async addContribution(guildId: string, charId: string, points: number): Promise<void> {
    await this.db.query(
      `UPDATE guild_members SET contribution_points = contribution_points + $1
       WHERE guild_id = $2 AND character_id = $3`,
      [points, guildId, charId]
    );
    await this.db.query(
      'UPDATE guilds SET experience = experience + $1 WHERE id = $2',
      [points, guildId]
    );
  }

  async depositGold(guildId: string, _charId: string, amount: number): Promise<void> {
    await this.db.query(
      'UPDATE guilds SET gold = gold + $1 WHERE id = $2',
      [amount, guildId]
    );
    await this.addContribution(guildId, _charId, Math.floor(amount / 10));
  }

  async depositItem(guildId: string, charId: string, itemId: string, qty: number): Promise<void> {
    await this.db.query(
      'INSERT INTO guild_bank (guild_id, item_id, quantity, deposited_by) VALUES ($1, $2, $3, $4)',
      [guildId, itemId, qty, charId]
    );
    await this.addContribution(guildId, charId, qty * 5);
  }

  async getBankItems(guildId: string): Promise<{ id: number; item_id: string; quantity: number; deposited_by: string; deposited_at: string }[]> {
    return this.db.query(
      'SELECT * FROM guild_bank WHERE guild_id = $1 ORDER BY deposited_at DESC',
      [guildId]
    );
  }

  async searchGuilds(query: string, limit = 20): Promise<Guild[]> {
    return this.db.query<Guild>(
      `SELECT * FROM guilds
       WHERE name ILIKE $1 OR tag ILIKE $1
       ORDER BY level DESC LIMIT $2`,
      [`%${query}%`, limit]
    );
  }

  /** Alias for game.ts compatibility */
  async listGuilds(): Promise<Guild[]> {
    return this.db.query<Guild>('SELECT * FROM guilds ORDER BY level DESC LIMIT 50');
  }

  /** Alias — createGuild with positional args for game.ts */
  async createGuildCompat(leaderId: string, name: string, description: string): Promise<Guild> {
    return this.createGuild(name, name.slice(0, 6).toUpperCase(), leaderId, description);
  }

  /** Alias for game.ts */
  async getGuildInfo(guildId: string): Promise<Guild | null> {
    return this.getGuild(guildId);
  }

  /** Alias for game.ts */
  async getGuildMembers(guildId: string): Promise<GuildMember[]> {
    return this.getMembers(guildId);
  }

  /** Alias for game.ts */
  async inviteMember(guildId: string, _inviterId: string, targetId: string): Promise<void> {
    return this.addMember(guildId, targetId);
  }

  /** Alias for game.ts */
  async kickMember(guildId: string, _kickerId: string, targetId: string): Promise<void> {
    return this.removeMember(guildId, targetId);
  }

  private async addLog(guildId: string, action: string, actorId: string): Promise<void> {
    await this.db.query(
      'INSERT INTO guild_logs (guild_id, action, actor_name) VALUES ($1, $2, $3)',
      [guildId, action, actorId]
    );
  }
}
