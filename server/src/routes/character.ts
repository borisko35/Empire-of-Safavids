import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { CharacterService } from '../services/CharacterService';
import { CombatService } from '../services/CombatService';
import { QuestService } from '../services/QuestService';
import { EnhancementSystem } from '../systems/EnhancementSystem';
import { EquipmentCache } from '../services/EquipmentCache';
import { CharacterClass } from '../types/game.types';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { MAX_CHARACTERS_PER_ACCOUNT } from '../../../shared/constants';

export const characterRouter = Router();
const characterService = new CharacterService();
const combatService = new CombatService();
const questService = new QuestService();
const enhancementSystem = new EnhancementSystem();
const equipmentCache = EquipmentCache.getInstance();

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

// GET /api/characters/:id/equipment — экипировка и бонусы характеристик
characterRouter.get('/:id/equipment', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  const equipment = await characterService.getEquipment(req.params.id);
  return res.json(equipment);
}));

// POST /api/characters/:id/equipment/equip — надеть предмет { itemId }
characterRouter.post('/:id/equipment/equip', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  const itemId = req.body?.itemId;
  if (!itemId) return res.status(400).json({ error: 'Missing itemId' });
  try {
    const equipment = await characterService.equipItem(req.params.id, itemId);
    equipmentCache.invalidate(req.params.id);
    return res.json(equipment);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
}));

// POST /api/characters/:id/equipment/unequip — снять предмет { slot }
characterRouter.post('/:id/equipment/unequip', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  const slot = req.body?.slot;
  if (!['weapon', 'armor', 'accessory'].includes(slot)) {
    return res.status(400).json({ error: 'Invalid slot' });
  }
  try {
    const equipment = await characterService.unequipItem(req.params.id, slot);
    equipmentCache.invalidate(req.params.id);
    return res.json(equipment);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
}));

// POST /api/characters/:id/inventory/use — использовать расходник { itemId }
characterRouter.post('/:id/inventory/use', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  const itemId = req.body?.itemId;
  if (!itemId) return res.status(400).json({ error: 'Missing itemId' });
  try {
    const resources = await characterService.useItem(req.params.id, itemId);
    return res.json({ success: true, resources });
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
}));

// POST /api/characters/:id/enhance — заточить предмет { itemId }
characterRouter.post('/:id/enhance', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  const itemId = req.body?.itemId;
  if (!itemId) return res.status(400).json({ error: 'Missing itemId' });
  try {
    const outcome = await enhancementSystem.enhance(req.params.id, itemId);
    return res.json(outcome);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
}));

// GET /api/characters/:id/quests — прогресс квестов персонажа
characterRouter.get('/:id/quests', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  const quests = await questService.getState(req.params.id);
  return res.json({ quests });
}));

// POST /api/characters/:id/quests/:questId/accept — взять квест
characterRouter.post('/:id/quests/:questId/accept', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  const result = await questService.accept(req.params.id, req.params.questId);
  if (!result.ok) return res.status(400).json({ error: result.code });
  return res.json({ success: true });
}));
