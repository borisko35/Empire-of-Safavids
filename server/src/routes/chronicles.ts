// ============================================================
// Chronicles of the Safavids — API routes
// ============================================================

import { Router } from 'express';
import { ChroniclesService } from '../services/ChroniclesService';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const chronicles = new ChroniclesService();

// Все записи
router.get('/', authMiddleware, (_req, res) => {
  res.json({ entries: chronicles.getAll() });
});

// По категории
router.get('/category/:cat', authMiddleware, (req, res) => {
  const cat = req.params.cat as any;
  res.json({ entries: chronicles.getByCategory(cat) });
});

// Одна запись
router.get('/:id', authMiddleware, (req, res) => {
  const entry = chronicles.getById(req.params.id);
  if (!entry) { res.status(404).json({ error: 'Entry not found' }); return; }
  res.json({ entry });
});

export default router;
