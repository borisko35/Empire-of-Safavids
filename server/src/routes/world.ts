import { Router, Request, Response } from 'express';
import { Region } from '../types/game.types';
import { RedisService } from '../services/RedisService';
import { asyncHandler } from '../utils/asyncHandler';
import { REGION_LEVEL_REQUIREMENTS } from '../../../shared/constants';

export const worldRouter = Router();
const redis = RedisService.getInstance();

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
      const onlinePlayers = await redis.getPlayersInRegion(key);
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

  const onlinePlayers = await redis.getPlayersInRegion(region);
  return res.json({ id: region, ...info, onlinePlayers: onlinePlayers.length });
}));
