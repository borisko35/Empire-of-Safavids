import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { Region } from '../types/game.types';
import { RedisService } from '../services/RedisService';
import { CharacterService } from '../services/CharacterService';
import { GameSocketHandler } from '../socket/GameSocketHandler';
import { asyncHandler } from '../utils/asyncHandler';
import { secureMiddleware } from '../middleware/auth';
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
  [Region.HERAT]: { name: 'Herat', nameRu: 'Герат', minLevel: REGION_LEVEL_REQUIREMENTS.herat, description: 'Самый дальний регион за Хорасаном. Ворота, караваны и последний рубеж.' },
  [Region.EAST_FRONTIER]: { name: 'Far East', nameRu: 'Крайний восток', minLevel: REGION_LEVEL_REQUIREMENTS.east_frontier, description: 'Застава, дорога через горы и земля за гребнем хребта. Дальше на восток карты нет.' },
  [Region.WEST_FRONTIER]: { name: 'Far West', nameRu: 'Крайний запад', minLevel: REGION_LEVEL_REQUIREMENTS.west_frontier, description: 'Степь на западной кромке мира и дальний предел за ней. Самый трудный край.' },
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

// GET /api/world/zones — все зоны с границами
worldRouter.get('/zones', asyncHandler(async (_req: Request, res: Response) => {
  const { ZONES } = await import('../../../shared/constants');
  return res.json({ zones: ZONES });
}));

// POST /api/world/zone/check — в какой зоне находится точка
worldRouter.post('/zone/check', asyncHandler(async (req: Request, res: Response) => {
  const { x, z } = req.body as { x: number; z: number };
  if (typeof x !== 'number' || typeof z !== 'number') {
    return res.status(400).json({ error: 'invalid_coordinates' });
  }
  const { getZoneAt } = await import('../../../shared/constants');
  const zone = getZoneAt(x, z);
  return res.json({ zone });
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
worldRouter.post('/travel', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
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

  // ЗАТВОРА ПО УРОВНЮ НЕТ, и это решение владельца: преграды на пути
  // игрока не ставим. Если он уверен в себе и рассчитывает справиться с
  // сильными монстрами - это его право и его решение.
  //
  // Раньше здесь стояло сравнение уровня с требованием региона и ответ 403
  // region_locked. Требование осталось в данных и показывается как
  // сведения, но не как замок.


  const oldRegion = character.region;
  const updated = await characterService.updateRegion(character.id, region);
  if (!updated) return res.status(500).json({ error: 'server_error' });

  // Комнаты сокета и членство в Redis — чтобы чат/ИИ/онлайн сменили регион сразу
  await GameSocketHandler.getInstance()?.movePlayerRegion(character.id, oldRegion, region).catch(() => {});

  return res.json({ character: updated });
}));
