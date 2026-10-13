// Караул — вербовка в казармах.
//
// ЧТО ЭТО. Маршруты панели «Вербовка караула»: что доступно к найму, что
// уже нанято, наём и распускание.
//
// ПРОВЕРКА ВЛАДЕНИЯ. Идентификатор персонажа берётся из тела запроса, как
// в остальных маршрутах characterService. Пропустить эту проверку — значит
// нанять солдата за чужое золото и за чужой счёт: стоимость списывается с
// персонажа, а не с аккаунта.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ЕЩЁ ОДИН РАЗДЕЛ В game.ts. В game.ts семьдесят
// маршрутов и своя проверка владения на каждый; этот отвечает за одну панель
// и тянет за собой свой сервис, который больше нигде не нужен.

import { Router, Request, Response } from 'express';
import { soldiers } from '../services/SoldierService';
import { CharacterService } from '../services/CharacterService';
import { asyncHandler } from '../utils/asyncHandler';
import { secureMiddleware } from '../middleware/auth';
import { SOLDIERS, SoldierTier } from '../data/soldiers';

export const soldiersRouter = Router();
const characters = new CharacterService();

/**
 * Идентификатор персонажа из тела запроса, уже проверенный на владение.
 *
 * Намеренно повторяет deviceBodyCharacterId из routes/game.ts: та ошибка с
 * подменой идентификатора повторилась шесть раз (задачи, репутация, конюшня,
 * башня, гильдии, питомцы) и каждый раз выглядела как «панель пустая».
 */
const bodyCharacterId = async (req: Request, res: Response): Promise<string | null> => {
  const characterId = String(req.body?.characterId ?? req.query?.characterId ?? '');
  if (!characterId) {
    res.status(400).json({ error: 'characterId is required' });
    return null;
  }
  const character = await characters.getCharacterById(characterId);
  if (!character || character.userId !== req.userId) {
    res.status(403).json({ error: 'Character does not belong to you' });
    return null;
  }
  return characterId;
};

/** Панель: доли к найму и то, что уже в карауле. */
soldiersRouter.get('/', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const characterId = await bodyCharacterId(req, res);
  if (!characterId) return;
  const character = await characters.getCharacterById(characterId);
  if (!character) {
    res.status(404).json({ error: 'character not found' });
    return;
  }
  const каталог = await soldiers.каталог(characterId, Number(character.gold));
  res.json({ success: true, ...каталог, soldiers: await soldiers.список(characterId) });
}));

/** Нанять. */
soldiersRouter.post('/hire', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const characterId = await bodyCharacterId(req, res);
  if (!characterId) return;
  const tier = String(req.body?.tier ?? '') as SoldierTier;
  // Проверка ключа здесь, а не только в сервисе: неизвестная строка от
  // клиента должна быть отказом маршрута (400), а не пустым результатом.
  if (!SOLDIERS[tier]) {
    res.status(400).json({ error: `unknown tier: ${tier}` });
    return;
  }
  const результат = await soldiers.нанять(characterId, tier);
  if (!результат.ok) {
    // 409, а не 400: запрос разобран верно, помешало состояние игрока.
    res.status(409).json({ success: false, reason: результат.reason });
    return;
  }
  res.json({ success: true, gold: результат.gold, soldier: результат.soldier });
}));

/** Распустить. Золота не возвращается — наём впрок. */
soldiersRouter.post('/dismiss', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const characterId = await bodyCharacterId(req, res);
  if (!characterId) return;
  const id = String(req.body?.id ?? '');
  if (!id) {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  const снят = await soldiers.распустить(characterId, id);
  if (!снят) {
    res.status(404).json({ error: 'soldier not found' });
    return;
  }
  res.json({ success: true });
}));