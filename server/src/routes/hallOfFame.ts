// Зал славы мировых боссов.
//
// ЧТО ЭТО. Таблица world_boss_kills с прошлого коммита наполняется: каждая
// победа пишется отдельной строкой. Но наполняться ей было незачем — смотреть
// на историю убийств было некому. Этот маршрут и есть тот, кому смотреть.
//
// ЧТО ПОКАЗЫВАЕТ. Кто и сколько раз повалил мирового босса, с гильдией и
// классом. Порядок — по числу побед, затем по дате последней: при равном
// счёте первым шёл тот, кто убил раньше.
//
// ЧЕГО НЕТ И ПОЧЕМУ. top_damage в базе заполняется одним победителем:
// сервер не собирает расклад по урону за бой. Показывать «долю урона» было бы
// значило показать игроку цифру, которую никто не измерял. Когда появится
// настоящий сбор урона, поле начнёт значить то, что написано в названии.

import { Router, Request, Response } from 'express';
import { DatabaseService } from '../services/DatabaseService';
import { asyncHandler } from '../utils/asyncHandler';
import { secureMiddleware } from '../middleware/auth';

export const hallOfFameRouter = Router();
const db = DatabaseService.getInstance();

/** Сколько строк отдаём за раз. Больше не нужно: список длиннее только мешает. */
const DEFAULT_LIMIT = 20;

/**
 * Топ убийц мировых боссов.
 *
 * Считаем по самой таблице, а не по character_titles: титул «убийца Симурга»
 * может достаться кому-то один раз, а здесь интересует именно число побед.
 */
hallOfFameRouter.get('/bosses', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const raw = Number((req.query as { limit?: string }).limit);
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(50, Math.floor(raw)) : DEFAULT_LIMIT;

  const rows = await db.query<{
    character_id: string;
    character_name: string;
    kills: string;
    guild_id: string | null;
    guild_name: string | null;
    class_name: string;
    last_kill: Date;
  }>(
    `SELECT k.character_id,
            COUNT(*) AS kills,
            MAX(k.killed_at) AS last_kill,
            c.name AS character_name,
            c.class AS class_name,
            g.id AS guild_id,
            g.name AS guild_name
     FROM world_boss_kills k
     JOIN characters c ON c.id = k.character_id
     LEFT JOIN guild_members gm ON gm.character_id = k.character_id
     LEFT JOIN guilds g ON g.id = gm.guild_id
     GROUP BY k.character_id, c.name, c.class, g.id, g.name
     ORDER BY kills DESC, last_kill ASC
     LIMIT $1`,
    [limit]
  );

  return res.json({
    entries: rows.map((r, i) => ({
      rank: i + 1,
      characterId: r.character_id,
      characterName: r.character_name,
      class: r.class_name,
      kills: Number(r.kills),
      guildId: r.guild_id,
      guildName: r.guild_name,
      lastKill: r.last_kill,
    })),
  });
}));
