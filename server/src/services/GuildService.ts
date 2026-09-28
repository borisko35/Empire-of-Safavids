// ============================================================
// Guild Service — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { RedisService } from './RedisService';
import { ITEMS_DATABASE } from '../data/items';
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

/** Строка склада гильдии вместе с названием предмета */
export interface GuildBankItem {
  id: number; item_id: string; quantity: number;
  deposited_by: string; deposited_at: string; nameRu: string;
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

  /**
   * Исключить участника.
   *
   * ТУТ БЫЛО: голый DELETE без единой проверки. Маршрут /kick смотрел только,
   * КТО просит (глава или офицер), но не КОГО. Итог: офицер мог исключить
   * главного, а глава — исключить себя, и в обоих случаях гильдия оставалась
   * без управления: в guilds.leader_id оставался UUID человека, который уже
   * не в гильдии, и управлять ею было уже некому.
   *
   * Главного исключить нельзя: сначала он должен назначить преемника.
   */
  async removeMember(guildId: string, charId: string): Promise<void> {
    const guild = await this.getGuild(guildId);
    if (!guild) throw new Error('GUILD_NOT_FOUND');
    if (guild.leader_id === charId) throw new Error('GUILD_LEADER_PROTECTED');
    await this.db.query(
      'DELETE FROM guild_members WHERE guild_id = $1 AND character_id = $2',
      [guildId, charId]
    );
    await this.addLog(guildId, 'member_left', charId);
  }

  /**
   * Покинуть гильдию.
   *
   * Если уходит глава, преемником становится самый старший из оставшихся, а
   * guilds.leader_id переписывается. Без этого уход главя навсегда оставлял
   * гильдию сиротой: назначить нового главу было нечем, а маршрут /rank такую
   * возможность и не давал.
   */
  async leaveGuild(guildId: string, charId: string): Promise<void> {
    const guild = await this.getGuild(guildId);
    if (!guild) throw new Error('GUILD_NOT_FOUND');
    const wasLeader = guild.leader_id === charId;

    await this.db.query(
      'DELETE FROM guild_members WHERE guild_id = $1 AND character_id = $2',
      [guildId, charId]
    );
    await this.addLog(guildId, 'member_left', charId);
    if (wasLeader) await this.promoteSuccessor(guildId);
  }

  /**
   * Передать главенство самому старшему из оставшихся.
   *
   * Порядок тот же, что и в списке участников: офицер, ветеран, участник,
   * а внутри ранга — кто больше внёс. Если не осталось никого, гильдия
   * удаляется: пустая строка в поиске гильдий только мешает.
   */
  private async promoteSuccessor(guildId: string): Promise<void> {
    const next = await this.db.queryOne<{ character_id: string }>(
      `SELECT character_id FROM guild_members
       WHERE guild_id = $1
       ORDER BY CASE rank WHEN 'officer' THEN 0 WHEN 'veteran' THEN 1 ELSE 2 END,
                contribution_points DESC, joined_at ASC
       LIMIT 1`,
      [guildId]
    );
    if (!next) {
      await this.db.query('DELETE FROM guilds WHERE id = $1', [guildId]);
      return;
    }
    await this.db.query(
      'UPDATE guilds SET leader_id = $1 WHERE id = $2',
      [next.character_id, guildId]
    );
    await this.db.query(
      `UPDATE guild_members SET rank = 'leader'
       WHERE guild_id = $1 AND character_id = $2`,
      [guildId, next.character_id]
    );
    await this.addLog(guildId, 'leader_changed', next.character_id);
  }

  /**
   * Назначить ранг участнику.
   *
   * ТУТ БЫЛО: UPDATE без проверок. Офицер мог сделать себя главным, главу
   * можно было разжаловать в участника — и гильдия снова оказывалась сиротой,
   * только теперь уже по вине офицера. Ранг приходил строкой из тела запроса,
   * то есть в таблицу могло попасть что угодно.
   *
   * Теперь ранг сверяется со списком, главу не трогают, и ранг нельзя выдать
   * себе.
   */
  async setRank(guildId: string, actorId: string, charId: string, rank: string): Promise<void> {
    const GUILD_RANKS = ['leader', 'officer', 'veteran', 'member'];
    if (!GUILD_RANKS.includes(rank)) throw new Error('RANK_INVALID');
    if (actorId === charId) throw new Error('RANK_SELF');
    const guild = await this.getGuild(guildId);
    if (!guild) throw new Error('GUILD_NOT_FOUND');
    if (guild.leader_id === charId) throw new Error('GUILD_LEADER_PROTECTED');
    if (rank === 'leader') {
      // Передача прав — это leave плюс назначение, одним UPDATE не обойтись
      throw new Error('RANK_TRANSFER_UNSUPPORTED');
    }
    // RETURNING, потому что db.query отдаёт строки, а не rowCount: без него
    // нельзя отличить «ранг назначен» от «такого участника нет» — оба случая
    // молча проходят, и игрок думает, что назначил, а ничего не изменилось
    const res = await this.db.query<{ character_id: string }>(
      'UPDATE guild_members SET rank = $1 WHERE guild_id = $2 AND character_id = $3 RETURNING character_id',
      [rank, guildId, charId]
    );
    if (res.length === 0) throw new Error('MEMBER_NOT_FOUND');
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

  /**
   * Положить золото в общий котёл гильдии.
   *
   * ТУТ БЫЛО: золото просто ПРИБАВЛЯЛОСЬ к золоту гильдии, а у игрока
   * ничего не вычиталось. То есть любой желающий мог положить в котёл
   * сколько угодно золота из воздуха и поднять валюту всей гильдии.
   * Та же поломка, что с предметами ниже: склад пополнялся из ниоткуда.
   *
   * Теперь сначала списываем у игрока (атомарно, с проверкой баланса), и
   * только потом кладём в котёл — обе операции в одной транзакции, чтобы не
   * было окна «золото забрали, а в котёл не положили».
   */
  async depositGold(guildId: string, charId: string, amount: number): Promise<void> {
    const gold = Math.max(0, Math.floor(amount));
    if (gold <= 0) throw new Error('GOLD_AMOUNT_INVALID');

    await this.db.transaction(async (client) => {
      const paid = await client.query(
        'UPDATE characters SET gold = gold - $1 WHERE id = $2 AND gold >= $1 RETURNING gold',
        [gold, charId]
      );
      if (paid.rowCount === 0) throw new Error('GOLD_NOT_ENOUGH');
      await client.query('UPDATE guilds SET gold = gold + $1 WHERE id = $2', [gold, guildId]);
      // Вклад засчитывается в той же транзакции, что и списание: иначе
      // игрок теряет золото без вклада в развитие гильдии
      await client.query(
        'UPDATE guild_members SET contribution_points = contribution_points + $1 WHERE guild_id = $2 AND character_id = $3',
        [Math.floor(gold / 10), guildId, charId]
      );
    });
  }

  /**
   * Положить предмет на склад гильдии.
   *
   * ТУТ БЫЛО: предмет просто ВСТАВЛЯЛСЯ в таблицу склада, а из инвентаря
   * игрока ничего не исчезало. Склад пополнялся из воздуха — сколько угодно
   * копий любого предмета, без всякой оплаты.
   *
   * Теперь предмет сначала списывается из инвентаря и только потом появляется
   * на складе, обе операции в одной транзакции.
   */
  async depositItem(guildId: string, charId: string, itemId: string, qty: number): Promise<void> {
    const count = Math.max(1, Math.floor(qty));

    // Членство проверяется ДО транзакции. Раньше не проверялось вовсе:
    // depositItem был единственным писателем в guild_bank и не вызывался
    // никем, так что дыра была незаметна — но как только кнопка появилась,
    // любой персонаж мог складывать предметы в чужой склад
    await this.requireMember(guildId, charId);

    await this.db.transaction(async (client) => {
      const took = await client.query(
        `UPDATE character_items SET quantity = quantity - $1
         WHERE id = (
           SELECT id FROM character_items
           WHERE character_id = $2 AND item_id = $3 AND quantity >= $1
           ORDER BY enhancement DESC LIMIT 1
           FOR UPDATE
         )`,
        [count, charId, itemId]
      );
      if (took.rowCount === 0) throw new Error('ITEM_NOT_ENOUGH');
      // Строка с quantity <= 0 удаляется, как и в аукционе: иначе в инвентаре
      // остаются пустые предметы, и они занимают место в выпадающих списках
      await client.query(
        `DELETE FROM character_items
         WHERE character_id = $1 AND item_id = $2 AND quantity <= 0`,
        [charId, itemId]
      );
      await client.query(
        'INSERT INTO guild_bank (guild_id, item_id, quantity, deposited_by) VALUES ($1, $2, $3, $4)',
        [guildId, itemId, count, charId]
      );
      await client.query(
        'UPDATE guild_members SET contribution_points = contribution_points + $1 WHERE guild_id = $2 AND character_id = $3',
        [count * 5, guildId, charId]
      );
    });
  }

  /**
   * Забрать предмет со склада гильдии.
   *
   * Без этого склад был бы ловушкой: положить можно, забрать нельзя, и
   * игрок потерял бы вещи навсегда. Точка отказа та же, что и у вклада:
   * склад общий, но списание идёт по строкам под FOR UPDATE, поэтому два
   * игрока не могут забрать один и тот же предмет дважды.
   */
  async withdrawItem(guildId: string, charId: string, bankId: number, qty: number): Promise<void> {
    const count = Math.max(1, Math.floor(qty));
    await this.requireMember(guildId, charId);

    await this.db.transaction(async (client) => {
      const row = await client.query(
        `SELECT item_id, quantity FROM guild_bank
         WHERE id = $1 AND guild_id = $2 FOR UPDATE`,
        [bankId, guildId]
      );
      const item = row.rows[0] as { item_id: string; quantity: number } | undefined;
      if (!item) throw new Error('BANK_ROW_NOT_FOUND');
      if (item.quantity < count) throw new Error('BANK_NOT_ENOUGH');

      const took = await client.query(
        `UPDATE guild_bank SET quantity = quantity - $1 WHERE id = $2 AND quantity >= $1`,
        [count, bankId]
      );
      if (took.rowCount === 0) throw new Error('BANK_NOT_ENOUGH');
      if (item.quantity - count <= 0) {
        await client.query('DELETE FROM guild_bank WHERE id = $1', [bankId]);
      }
      await client.query(
        `INSERT INTO character_items (character_id, item_id, quantity, enhancement)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (character_id, item_id, enhancement)
         DO UPDATE SET quantity = character_items.quantity + $3`,
        [charId, item.item_id, count]
      );
      // Вклад давал вклад за штуку — возврат её отнимает. Иначе можно было
      // бы бесконечно класть и забирать, набивая очки вклада
      await client.query(
        `UPDATE guild_members SET contribution_points = GREATEST(0, contribution_points - $1)
         WHERE guild_id = $2 AND character_id = $3`,
        [count * 5, guildId, charId]
      );
    });
  }

  /** Проверка членства: не в гильдии — ошибка, а не пустой склад */
  private async requireMember(guildId: string, charId: string): Promise<void> {
    const row = await this.db.queryOne<{ character_id: string }>(
      'SELECT character_id FROM guild_members WHERE guild_id = $1 AND character_id = $2',
      [guildId, charId]
    );
    if (!row) throw new Error('NOT_A_MEMBER');
  }

  /**
   * Содержимое склада с названиями предметов.
   *
   * Раньше отдавались сырые item_id, и клиенту нечего было показать, кроме
   * внутренних ключей вида mat_dragon_scale.
   */
  async getBankItems(guildId: string): Promise<GuildBankItem[]> {
    const rows = await this.db.query<{ id: number; item_id: string; quantity: number; deposited_by: string; deposited_at: string }>(
      'SELECT * FROM guild_bank WHERE guild_id = $1 ORDER BY deposited_at DESC',
      [guildId]
    );
    return rows.map(r => ({
      ...r,
      nameRu: ITEMS_DATABASE[r.item_id]?.nameRu ?? r.item_id,
    }));
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
