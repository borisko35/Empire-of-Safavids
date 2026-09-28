// ============================================================
// Achievements / Daily Tasks / Reputation Routes
// ============================================================

import { Router } from 'express';
import { AchievementService } from '../services/AchievementService';
import { DailyTaskService } from '../services/DailyTaskService';
import { ReputationService } from '../services/ReputationService';
import { DatabaseService } from '../services/DatabaseService';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const achievements = new AchievementService();
const dailyTasks = new DailyTaskService();
const reputation = new ReputationService();
const db = DatabaseService.getInstance();

// ── Achievements ────────────────────────────────────────
// ТУТ БЫЛА ТА ЖЕ ОШИБКА, ЧТО В ЗАДАЧАХ ДНЯ: персонаж не передавался вовсе,
// а открытые достижения искались по req.userId — идентификатору АККАУНТА —
// в таблице character_achievements.character_id. Панель поэтому всегда
// показывала «Разблокировано: 0 / 21», а строки не загорались даже у того,
// кто что-то достиг: определения задач и достижений лежат в коде, а вот
// прогресс игрока — в базе, и искать его надо по персонажу.
router.get('/achievements', authMiddleware, async (req: any, res) => {
  const characterId = String(req.query.characterId ?? '');
  if (!characterId) return res.status(400).json({ error: 'characterId is required' });
  const char = await db.queryOne<{ id: string }>(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2', [characterId, req.userId]
  );
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const all = await achievements.getAll();
  const unlocked = await achievements.getUnlocked(characterId);
  const unlockedIds = new Set(unlocked.map(a => a.id));
  res.json({
    achievements: all.map(a => ({ ...a, unlocked: unlockedIds.has(a.id) })),
    total: all.length,
    unlockedCount: unlocked.length,
  });
});

router.get('/achievements/:id/progress', authMiddleware, async (req: any, res) => {
  // Та же болезнь: прогресс по character_id, а спрашивали про аккаунт
  const characterId = String(req.query.characterId ?? '');
  if (!characterId) return res.status(400).json({ error: 'characterId is required' });
  const char = await db.queryOne<{ id: string }>(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2', [characterId, req.userId]
  );
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const progress = await achievements.getProgress(characterId, req.params.id);
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
  const char = await db.queryOne<{ level: number }>(
    'SELECT level FROM characters WHERE id = $1 AND user_id = $2', [characterId, req.userId]
  );
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
// ТУТ БЫЛА ТА ЖЕ ОШИБКА, ЧТО И С ЗАДАЧАМИ ДНЯ. Маршрут отдавал сервису
// req.userId — идентификатор АККАУНТА, а ReputationService ищет по
// character_reputation.character_id, то есть по идентификатору ПЕРСОНАЖА.
// Это разные числа, поэтому репутация не показывалась никогда: даже если бы
// она начислялась, панель увидела бы пустоту.
//
// Теперь персонаж запрашивается явно, как в /tasks, и проверяется, что он
// принадлежит игроку.
async function ownedCharacterId(req: any, res: any): Promise<string | null> {
  const characterId = String(req.query.characterId ?? '');
  if (!characterId) {
    res.status(400).json({ error: 'CHARACTER_REQUIRED' });
    return null;
  }
  const row = await db.queryOne<{ id: string }>(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.userId]
  );
  if (!row) {
    res.status(403).json({ error: 'CHARACTER_NOT_YOURS' });
    return null;
  }
  return characterId;
}

router.get('/reputation', authMiddleware, async (req: any, res) => {
  const characterId = await ownedCharacterId(req, res);
  if (!characterId) return;
  const data = await reputation.getReputation(characterId);
  res.json({ reputation: data });
});

router.get('/reputation/factions', authMiddleware, (_req, res) => {
  res.json({ factions: reputation.getAllFactions() });
});

router.get('/reputation/:factionId', authMiddleware, async (req: any, res) => {
  const info = await reputation.getFactionInfo(req.params.factionId);
  if (!info) { res.status(404).json({ error: 'Faction not found' }); return; }
  // Тот же былой баг с идентификатором аккаунта вместо персонажа
  const characterId = await ownedCharacterId(req, res);
  if (!characterId) return;
  const rep = await reputation.getReputation(characterId);
  const myRep = rep.find(r => r.faction === info.id);
  res.json({ faction: info, myReputation: myRep?.reputation ?? 0, myRank: myRep?.rank_title ?? info.ranks[0].nameRu });
});

export default router;
