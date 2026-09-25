// ============================================================
// Skills & Professions Routes
// ============================================================

import { Router, Request, Response } from 'express';
import { skillsService } from '../services/SkillsService';
import { authMiddleware } from '../middleware/auth';

export const skillsRouter = Router();

// GET /api/skills — получить навыки персонажа
skillsRouter.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const skills = await skillsService.getCharacterSkills(req.query.characterId as string);
    res.json({ skills });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/skills/available — доступные навыки
skillsRouter.get('/available', authMiddleware, async (req: Request, res: Response) => {
  try {
    const skills = await skillsService.getAvailableSkills(
      req.query.characterId as string,
      req.query.profession as string | undefined
    );
    res.json({ skills });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/skills/learn — выучить навык
skillsRouter.post('/learn', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { characterId, skillId } = req.body;
    if (!characterId || !skillId) {
      return res.status(400).json({ error: 'characterId and skillId required' });
    }
    const skill = await skillsService.learnSkill(characterId, skillId, req.userId!);
    res.json({ success: true, skill });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST /api/skills/upgrade — улучшить навык (после боя)
skillsRouter.post('/upgrade', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { characterId, skillId, xp } = req.body;
    const result = await skillsService.upgradeSkill(characterId, skillId, xp || 10);
    res.json({ success: true, skill: result });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Professions
skillsRouter.get('/professions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const profession = await skillsService.getCharacterProfession(req.query.characterId as string);
    res.json({ profession });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

skillsRouter.post('/professions/unlock', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { characterId, professionId } = req.body;
    if (!characterId || !professionId) {
      return res.status(400).json({ error: 'characterId and professionId required' });
    }
    const profession = await skillsService.unlockProfession(characterId, professionId, req.userId!);
    res.json({ success: true, profession });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

skillsRouter.get('/professions/:id/skills', authMiddleware, async (req: Request, res: Response) => {
  try {
    const skills = await skillsService.getProfessionSkills(req.params.id);
    res.json({ skills });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Gain XP after combat
skillsRouter.post('/xp', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { characterId, skillId, xp } = req.body;
    if (!characterId || !skillId) {
      return res.status(400).json({ error: 'characterId and skillId required' });
    }
    const skill = await skillsService.upgradeSkill(characterId, skillId, xp || 10);
    const prof = await skillsService.gainProfessionXp(characterId, Math.floor((xp || 10) / 5));
    res.json({ success: true, skill, profession: prof });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
