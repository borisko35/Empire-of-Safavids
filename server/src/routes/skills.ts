// ============================================================
// Skills & Professions Routes
// ============================================================

import { Router, Request, Response } from 'express';
import { skillsService } from '../services/SkillsService';
import { CharacterService } from '../services/CharacterService';
import { authMiddleware } from '../middleware/auth';

export const skillsRouter = Router();

// Свой экземпляр, а не общий синглтон: в CharacterService его нет, и брать
// чужой глобал значило бы связать маршруты навыков с порядком импорта
// остальных маршрутов.
const characterService = new CharacterService();

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

// МАРШРУТОВ НАЧИСЛЕНИЯ ОПЫТА БОЛЬШЕ НЕТ.
//
// Раньше здесь стояли POST /upgrade и POST /xp, и оба принимали
// { characterId, skillId, xp } из тела запроса. Проверки владельца не было
// ни на characterId, ни на skillId, а сумма опыта приходила от клиента.
// Итог: любой вошедший игрок мог одним POST поднять навык чужого
// персонажа до потолка, указав xp: 1000000. Клиент эти маршруты не звал
// ни разу, то есть пользы от них не было никому, кроме exploitation.
//
// Теперь опыт начисляет сервер сам за настоящие действия в бою
// (server/src/socket/GameSocketHandler.ts -> skillsService.gainSkillXp).
// Сумма берётся из удара, а не из пакета.
skillsRouter.get('/progress/:skillId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const characterId = String(req.query.characterId ?? '');
    const character = await characterService.getCharacterById(characterId);
    if (!character) return res.status(404).json({ error: 'Character not found' });
    // Только свой персонаж: прогресс навыка — часть состояния боя
    if (character.userId !== req.userId) return res.status(403).json({ error: 'Access denied' });
    const progress = await skillsService.getSkillProgress(characterId, req.params.skillId);
    if (!progress) return res.status(404).json({ error: 'Skill not known' });
    return res.json({ progress });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
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

// Маршрута POST /xp больше нет — см. объяснение выше у GET /progress.
