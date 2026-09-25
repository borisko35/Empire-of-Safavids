import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { CharacterService } from '../services/CharacterService';
import { CombatService } from '../services/CombatService';
import { QuestService } from '../services/QuestService';
import { EnhancementSystem } from '../systems/EnhancementSystem';
import { EquipmentCache } from '../services/EquipmentCache';
import { CharacterClass } from '../types/game.types';
import { secureMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { MAX_CHARACTERS_PER_ACCOUNT, DEFAULT_SERVER_ID, isValidServerId } from '../../../shared/constants';
import { DatabaseService } from '../services/DatabaseService';
import { logger } from '../utils/logger';

export const characterRouter = Router();
const characterService = new CharacterService();
const combatService = new CombatService();
const questService = new QuestService();
const enhancementSystem = new EnhancementSystem();
const equipmentCache = EquipmentCache.getInstance();

const createCharacterSchema = Joi.object({
  name: Joi.string().min(2).max(24).pattern(/^[a-zA-Zа-яА-Я0-9_\- ]+$/).required(),
  class: Joi.string().valid(...Object.values(CharacterClass)).required(),
  serverId: Joi.string().default(DEFAULT_SERVER_ID),
});

// GET /api/characters — список персонажей пользователя
characterRouter.get('/', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const characters = await characterService.getCharactersByUser(req.userId!);
  return res.json({ characters });
}));

// POST /api/characters — создать персонажа
characterRouter.post('/', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { error, value } = createCharacterSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const existing = await characterService.getCharactersByUser(req.userId!);
  if (existing.length >= MAX_CHARACTERS_PER_ACCOUNT) {
    return res.status(400).json({ error: `Maximum ${MAX_CHARACTERS_PER_ACCOUNT} characters per account` });
  }

  if (!isValidServerId(value.serverId)) {
    return res.status(400).json({ error: 'Unknown game server' });
  }

  const character = await characterService.createCharacter(req.userId!, value.name, value.class, value.serverId);
  return res.status(201).json({ character });
}));

// POST /api/characters/:id/rename — смена ника за АЗЭНЫ
characterRouter.post('/:id/rename', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name || name.length < 2 || name.length > 24) {
    return res.status(400).json({ error: 'Имя должно быть от 2 до 24 символов' });
  }
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Персонаж не найден' });
  }
  if (character.name === name) {
    return res.status(400).json({ error: 'Новое имя совпадает со старым' });
  }
  // Проверка уникальности
  const exists = await characterService.getCharacterByNameExact(name);
  if (exists) {
    return res.status(400).json({ error: 'Такое имя уже занято' });
  }
  // Стоимость: 500 АЗЭНОВ
  const cost = 500;
  if ((character.azens ?? 0) < cost) {
    return res.status(400).json({ error: `Недостаточно АЗЭНОВ. Нужно ${cost}`, needed: cost, have: character.azens });
  }
  // Выполняем изменение имени и списание АЗЭН
  await DatabaseService.getInstance().query(
    'UPDATE characters SET name = $1, azens = azens - $2, last_name_change_at = NOW() WHERE id = $3',
    [name, cost, req.params.id]
  );
  logger.info(`[Character] ${req.userId} renamed ${character.name} -> ${name}`);
  const updated = await characterService.getCharacterById(req.params.id);
  return res.json({ success: true, character: updated });
}));
characterRouter.delete('/:id', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  try {
    await characterService.deleteCharacter(req.params.id);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
  return res.json({ success: true });
}));

// GET /api/characters/:id/skills — навыки персонажа
characterRouter.get('/:id/skills', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  const skills = combatService.getClassSkills(character.class);
  return res.json({ skills });
}));

// GET /api/characters/:id/inventory — инвентарь персонажа
characterRouter.get('/:id/inventory', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  const items = await characterService.getInventory(req.params.id);
  return res.json({ items });
}));

// GET /api/characters/:id/equipment — экипировка и бонусы характеристик
characterRouter.get('/:id/equipment', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  const equipment = await characterService.getEquipment(req.params.id);
  return res.json(equipment);
}));

// POST /api/characters/:id/equipment/equip — надеть предмет { itemId }
characterRouter.post('/:id/equipment/equip', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
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
characterRouter.post('/:id/equipment/unequip', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
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
characterRouter.post('/:id/inventory/use', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
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
characterRouter.post('/:id/enhance', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
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
characterRouter.get('/:id/quests', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  const quests = await questService.getState(req.params.id);
  return res.json({ quests });
}));

// POST /api/characters/:id/quests/:questId/accept — взять квест
characterRouter.post('/:id/quests/:questId/accept', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  const result = await questService.accept(req.params.id, req.params.questId);
  if (!result.ok) return res.status(400).json({ error: result.code });
  return res.json({ success: true });
}));

// POST /api/characters/:id/quests/:questId/explore — игрок дошёл до точки (тело: objectiveId)
characterRouter.post('/:id/quests/:questId/explore', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const character = await characterService.getCharacterById(req.params.id);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'Character not found' });
  }
  const { objectiveId } = req.body as { objectiveId?: string };
  const completed = await questService.recordExplore(req.params.id, req.params.questId, objectiveId);
  return res.json({ success: true, completed });
}));
