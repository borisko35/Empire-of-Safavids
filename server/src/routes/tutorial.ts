// ============================================================
// Tutorial Routes — Empire of Safavids
// ============================================================

import { Router, Request, Response } from 'express';
import { TutorialService } from '../services/TutorialService';
import { secureMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

export const tutorialRouter = Router();
const tutorialService = new TutorialService();

// GET /api/tutorial/steps — все шаги туториала
tutorialRouter.get('/steps', secureMiddleware, asyncHandler(async (_req: Request, res: Response) => {
  return res.json({ steps: tutorialService.getAllSteps() });
}));

// GET /api/tutorial/:characterId — прогресс туториала
tutorialRouter.get('/:characterId', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const progress = await tutorialService.getProgress(req.params.characterId);
  const step = tutorialService.getStep(progress.step);
  return res.json({ progress, currentStep: step });
}));

// POST /api/tutorial/:characterId/advance — перейти к следующему шагу
tutorialRouter.post('/:characterId/advance', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const result = await tutorialService.advanceStep(req.params.characterId);
  return res.json(result);
}));

// POST /api/tutorial/:characterId/skip — пропустить туториал
tutorialRouter.post('/:characterId/skip', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  await tutorialService.skipTutorial(req.params.characterId);
  return res.json({ success: true, message: 'Tutorial skipped' });
}));
