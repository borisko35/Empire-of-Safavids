import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { CharacterService } from '../services/CharacterService';
import { CombatService } from '../services/CombatService';
import { CharacterClass } from '../types/game.types';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { MAX_CHARACTERS_PER_ACCOUNT } from '../../../shared/constants';

export const characterRouter = Router();
const characterService = new CharacterService();
const combatService = new CombatService();

const createCharacterSchema = Joi.object({
  name: Joi.string().min(2).max(24).pattern(/^[a-zA-Zа-яА-Я0-9_\- ]+$/).required(),
  class: Joi.string().valid(...Object.values(CharacterClass)).required(),
});

// GET /api/characters — список персонажей пользователя
characterRouter.get('/', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const characters = await characterService.getCharactersByUser(req.userId!);
  return res.json({ characters });
}));

// POST /api/characters — создать персонажа
characterRouter.post('/', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { error, value } = createCharacterSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const existing = await characterService.getCharactersByUser(req.userId!);
  if (existing.length >= MAX_CHARACTERS_PER_ACCOUNT) {
    return res.status(400).json({ error: `Maximum ${MAX_CHARACTERS_PER_ACCOUNT} characters per account` });
  }

  const character = await characterService.createCharacter(req.userId!, value.name, value.class);
  return res.status(201).json({ character });
}));

// GET /api/characters/:id/skills — навыки персонажа
characterRouter.get('/:id/skills', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  const skills = combatService.getClassSkills(character.class);
  return res.json({ skills });
}));

// GET /api/characters/:id/inventory — инвентарь персонажа
characterRouter.get('/:id/inventory', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  const items = await characterService.getInventory(req.params.id);
  return res.json({ items });
}));
