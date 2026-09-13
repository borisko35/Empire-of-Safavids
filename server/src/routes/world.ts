import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { Region } from '../types/game.types';
import { RedisService } from '../services/RedisService';
import { CharacterService } from '../services/CharacterService';
import { GameSocketHandler } from '../socket/GameSocketHandler';
import { asyncHandler } from '../utils/asyncHandler';
import { authMiddleware } from '../middleware/auth';
import { REGION_LEVEL_REQUIREMENTS, GAME_SERVERS } from '../../../shared/constants';

export const worldRouter = Router();
const redis = RedisService.getInstance();
const characterService = new CharacterService();

const travelSchema = Joi.object({
  characterId: Joi.string().uuid().required(),
  region: Joi.string().valid(...Object.values(Region)).required(),
});

const REGION_INFO: Record<Region, { name: string; nameRu: string; minLevel: number; description: string }> = {
  [Region.TABRIZ]: { name: 'Tabriz', nameRu: 'Тебриз', minLevel: REGION_LEVEL_REQUIREMENTS.tabriz, description: 'Столица Сефевидской империи. Стартовая зона для новых игроков.' },
  [Region.ISFAHAN]: { name: 'Isfahan', nameRu: 'Исфахан', minLevel: REGION_LEVEL_REQUIREMENTS.isfahan, description: '«Половина мира» — великолепный торговый город с мечетями и базарами.' },
  [Region.SHIRAZ]: { name: 'Shiraz', nameRu: 'Шираз', minLevel: REGION_LEVEL_REQUIREMENTS.shiraz, description: 'Город поэтов, садов и вина. Родина Хафиза и Саади.' },
  [Region.CAUCASUS]: { name: 'Caucasus', nameRu: 'Кавказ', minLevel: REGION_LEVEL_REQUIREMENTS.caucasus, description: 'Горные крепости и суровые воины. Зона активного PvP.' },
  [Region.MESOPOTAMIA]: { name: 'Mesopotamia', nameRu: 'Месопотамия', minLevel: REGION_LEVEL_REQUIREMENTS.mesopotamia, description: 'Спорные земли между Сефевидами и Османами. Постоянные сражения.' },
  [Region.KHORASAN]: { name: 'Khorasan', nameRu: 'Хорасан', minLevel: REGION_LEVEL_REQUIREMENTS.khorasan, description: 'Восточные рубежи. Рейдовые данжи и мировые боссы.' },
  [Region.PERSIAN_GULF]: { name: 'Persian Gulf', nameRu: 'Персидский залив', minLevel: REGION_LEVEL_REQUIREMENTS.persian_gulf, description: 'Морская торговля и пиратские сражения. Эндгейм-контент.' },
};

// GET /api/world/regions
worldRouter.get('/regions', asyncHandler(async (_req: Request, res: Response) => {
  const regions = await Promise.all(
    Object.entries(REGION_INFO).map(async ([key, info]) => {
      const onlinePlayers = (await Promise.all(GAME_SERVERS.map(sh => redis.getPlayersInRegion(sh.id, key)))).flat();
      return { id: key, ...info, onlinePlayers: onlinePlayers.length };
    })
  );
  return res.json({ regions });
}));

// GET /api/world/regions/:id
worldRouter.get('/regions/:id', asyncHandler(async (req: Request, res: Response) => {
  const region = req.params.id as Region;
  const info = REGION_INFO[region];
  if (!info) return res.status(404).json({ error: 'Region not found' });

  const onlinePlayers = (await Promise.all(GAME_SERVERS.map(sh => redis.getPlayersInRegion(sh.id, region)))).flat();
  return res.json({ id: region, ...info, onlinePlayers: onlinePlayers.length });
}));

// POST /api/world/travel — путешествие персонажа в другой регион.
// Мир бесшовный: позиция не меняется, меняется регион (спавн монстров,
// комнаты сокетов, чат) и проверяется требование по уровню.
worldRouter.post('/travel', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { error, value } = travelSchema.validate(req.body);
  if (error) return res.status(400).json({ error: 'invalid_request' });

  const region = value.region as Region;
  const info = REGION_INFO[region];
  if (!info) return res.status(404).json({ error: 'region_not_found' });

  const character = await characterService.getCharacterById(value.characterId);
  if (!character || character.userId !== req.userId) {
    return res.status(404).json({ error: 'character_not_found' });
  }
  if (character.region === region) {
    return res.json({ character, alreadyThere: true });
  }

  const minLevel = REGION_LEVEL_REQUIREMENTS[region] ?? 1;
  if (character.level < minLevel) {
    return res.status(403).json({ error: 'region_locked', minLevel });
  }

  const oldRegion = character.region;
  const updated = await characterService.updateRegion(character.id, region);
  if (!updated) return res.status(500).json({ error: 'server_error' });

  // Комнаты сокета и членство в Redis — чтобы чат/ИИ/онлайн сменили регион сразу
  await GameSocketHandler.getInstance()?.movePlayerRegion(character.id, oldRegion, region).catch(() => {});

  return res.json({ character: updated });
}));
