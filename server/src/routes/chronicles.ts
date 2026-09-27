// ============================================================
// Chronicles of the Safavids — API routes
// ============================================================

import { Router } from 'express';
import { ChroniclesService } from '../services/ChroniclesService';
import { DatabaseService } from '../services/DatabaseService';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const chronicles = new ChroniclesService();
const db = DatabaseService.getInstance();

/**
 * Квесты, которые персонаж уже выполнил. Отсюда берётся решение,
 * какие записи хроник открыты. Раньше маршрут отдавал все записи
 * разом, и условия открытия ничего не делали.
 *
 * Сбой БД не должен закрывать энциклопедию целиком: отдаём пустой
 * список и открытым остаётся только базовый контент.
 */
async function completedQuests(userId: string): Promise<string[]> {
  const rows = await db.query<{ quest_id: string }>(
    `SELECT q.quest_id
       FROM character_quests q
       JOIN characters c ON c.id = q.character_id
      WHERE c.user_id = $1 AND q.status = 'completed'`,
    [userId]
  ).catch(() => []);
  return rows.map(r => r.quest_id);
}

// Все записи с флагом «открыто» именно для этого персонажа
router.get('/', authMiddleware, async (req, res) => {
  const done = await completedQuests(req.userId as string);
  const entries = chronicles.getView(done);
  res.json({
    entries,
    unlocked: entries.filter(e => e.unlocked).length,
    total: entries.length,
  });
});

// По категории
router.get('/category/:cat', authMiddleware, async (req, res) => {
  const done = await completedQuests(req.userId as string);
  const entries = chronicles.getView(done).filter(e => e.category === req.params.cat);
  res.json({ entries });
});

// Одна запись. Закрытая отдаётся с подсказкой, но без текста,
// чтобы условие открытия нельзя было обойти, угадав id.
router.get('/:id', authMiddleware, async (req, res) => {
  const entry = chronicles.getById(req.params.id);
  if (!entry) { res.status(404).json({ error: 'Entry not found' }); return; }
  const done = await completedQuests(req.userId as string);
  const unlocked = entry.unlockCondition === 'default' || done.includes(entry.unlockCondition);
  if (!unlocked) {
    res.json({ entry: { id: entry.id, category: entry.category, locked: true } });
    return;
  }
  res.json({ entry: { ...entry, unlocked: true, locked: false } });
});

export default router;
