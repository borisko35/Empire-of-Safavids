// ============================================================
// Guild Routes — Empire of Safavids
// ============================================================

import { Router } from 'express';
import { GuildService } from '../services/GuildService';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const guilds = new GuildService();

router.get('/', authMiddleware, async (req: any, res) => {
  try {
    const data = await guilds.getGuildByCharacter(req.userId);
    res.json(data);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/search', authMiddleware, async (req, res) => {
  const q = String(req.query.q || '');
  const results = await guilds.searchGuilds(q);
  res.json({ guilds: results });
});

router.post('/create', authMiddleware, async (req: any, res) => {
  try {
    const { name, tag, description } = req.body;
    if (!name || !tag) { res.status(400).json({ error: 'Name and tag required' }); return; }
    const guild = await guilds.createGuild(name, tag, req.userId, description || '');
    res.json({ success: true, guild });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.post('/join', authMiddleware, async (req: any, res) => {
  try {
    await guilds.addMember(req.body.guildId, req.userId);
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.post('/leave', authMiddleware, async (req: any, res) => {
  try {
    const data = await guilds.getGuildByCharacter(req.userId);
    if (!data) { res.status(400).json({ error: 'Not in a guild' }); return; }
    // ТУТ БЫЛО removeMember. Уход главы оставлял гильдию сиротой: в
    // guilds.leader_id оставался его UUID, а назначить нового главу было
    // некому и нечем. leaveGuild передаёт главенство старшему из оставшихся.
    await guilds.leaveGuild(data.guild.id, req.userId);
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.get('/members', authMiddleware, async (req: any, res) => {
  try {
    const data = await guilds.getGuildByCharacter(req.userId);
    if (!data) { res.json({ members: [] }); return; }
    const members = await guilds.getMembers(data.guild.id);
    res.json({ members });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/rank', authMiddleware, async (req: any, res) => {
  try {
    const data = await guilds.getGuildByCharacter(req.userId);
    if (!data || !['leader', 'officer'].includes(data.rank)) {
      res.status(403).json({ error: 'No permission' }); return;
    }
    // Кто просит (req.userId) и кого меняем (body.characterId) — разные
    // люди. Раньше передавалось только двое, и сервис не мог отличить
    // «офицер назначает офицером» от «офицер назначает себя главным».
    await guilds.setRank(data.guild.id, req.userId, req.body.characterId, req.body.rank);
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.post('/deposit-gold', authMiddleware, async (req: any, res) => {
  try {
    const data = await guilds.getGuildByCharacter(req.userId);
    if (!data) { res.status(400).json({ error: 'Not in a guild' }); return; }
    await guilds.depositGold(data.guild.id, req.userId, req.body.amount);
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.get('/bank', authMiddleware, async (req: any, res) => {
  try {
    const data = await guilds.getGuildByCharacter(req.userId);
    if (!data) { res.json({ items: [] }); return; }
    const items = await guilds.getBankItems(data.guild.id);
    res.json({ items });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/kick', authMiddleware, async (req: any, res) => {
  try {
    const data = await guilds.getGuildByCharacter(req.userId);
    if (!data || !['leader', 'officer'].includes(data.rank)) {
      res.status(403).json({ error: 'No permission' }); return;
    }
    await guilds.removeMember(data.guild.id, req.body.characterId);
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

export default router;
