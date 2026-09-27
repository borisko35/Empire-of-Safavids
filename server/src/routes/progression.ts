// ============================================================
// Achievements / Daily Tasks / Reputation Routes
// ============================================================

import { Router } from 'express';
import { AchievementService } from '../services/AchievementService';
import { DailyTaskService } from '../services/DailyTaskService';
import { ReputationService } from '../services/ReputationService';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const achievements = new AchievementService();
const dailyTasks = new DailyTaskService();
const reputation = new ReputationService();

// ── Achievements ────────────────────────────────────────
router.get('/achievements', authMiddleware, async (req: any, res) => {
  const all = await achievements.getAll();
  const unlocked = await achievements.getUnlocked(req.userId);
  const unlockedIds = new Set(unlocked.map(a => a.id));
  res.json({
    achievements: all.map(a => ({ ...a, unlocked: unlockedIds.has(a.id) })),
    total: all.length,
    unlockedCount: unlocked.length,
  });
});

router.get('/achievements/:id/progress', authMiddleware, async (req: any, res) => {
  const progress = await achievements.getProgress(req.userId, req.params.id);
  res.json(progress);
});

// ── Daily Tasks ─────────────────────────────────────────
// ТУТ БЫЛА ОШИБКА: маршрут передавал req.userId, а сервис ищет по
// character_daily_progress.character_id. Идентификатор аккаунта и
// идентификатор персонажа — разные числа, поэтому прогресс всегда был
// нулевым: задачи дня нельзя было выполнить в принципе.
router.get('/tasks', authMiddleware, async (req: any, res) => {
  const characterId = String(req.query.characterId ?? '');
  if (!characterId) return res.status(400).json({ error: 'characterId is required' });
  const char = await (await import('../services/DatabaseService')).DatabaseService.getInstance()
    .queryOne<{ level: number }>('SELECT level FROM characters WHERE id = $1', [characterId]);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const tasks = await dailyTasks.getAvailable(characterId, char.level);
  const completedCount = await dailyTasks.getCompletedCount(characterId);
  res.json({ tasks, completedCount });
});

router.get('/tasks/progress', authMiddleware, async (req: any, res) => {
  const characterId = String(req.query.characterId ?? '');
  if (!characterId) return res.status(400).json({ error: 'characterId is required' });
  const completedCount = await dailyTasks.getCompletedCount(characterId);
  res.json({ completedCount });
});

// ── Reputation ──────────────────────────────────────────
router.get('/reputation', authMiddleware, async (req: any, res) => {
  const data = await reputation.getReputation(req.userId);
  res.json({ reputation: data });
});

router.get('/reputation/factions', authMiddleware, (_req, res) => {
  res.json({ factions: reputation.getAllFactions() });
});

router.get('/reputation/:factionId', authMiddleware, async (req: any, res) => {
  const info = await reputation.getFactionInfo(req.params.factionId);
  if (!info) { res.status(404).json({ error: 'Faction not found' }); return; }
  const rep = await reputation.getReputation(req.userId);
  const myRep = rep.find(r => r.faction === info.id);
  res.json({ faction: info, myReputation: myRep?.reputation ?? 0, myRank: myRep?.rank_title ?? info.ranks[0].nameRu });
});

export default router;
