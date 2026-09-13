import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuctionService } from '../services/AuctionService';
import { CraftingService } from '../services/CraftingService';
import { GuildService } from '../services/GuildService';
import { NPC_SHOPS } from '../services/AuctionService';
import { QUESTS_DATABASE, getAvailableQuests } from '../data/quests';
import { DUNGEONS_DATABASE, getDungeonsByLevel } from '../data/dungeons';
import { getWorldBosses } from '../data/monsters';
import { CharacterService } from '../services/CharacterService';
import { PartySystem } from '../systems/PartySystem';
import { DungeonService } from '../systems/DungeonService';
import { GAME_SERVERS } from '../../../shared/constants';
import { RedisService } from '../services/RedisService';
const redis = RedisService.getInstance();
import { TradeService } from '../systems/TradeService';
import { CRAFTING_RECIPES } from '../data/crafting';
import { ITEMS_DATABASE } from '../data/items';
import { asyncHandler, errorResponse } from '../utils/asyncHandler';
import Joi from 'joi';

export const gameRouter = Router();

// Создаём сервисы лениво-локально там, где нужны
import { QuestService } from '../services/QuestService';
const questService = new QuestService();

/** Квесты с collect-целями могут закрыться после пополнения инвентаря */
const questEvaluate = (characterId: string) =>
  questService.evaluateQuests(characterId).catch(() => []);

const auctionService = new AuctionService();
const craftingService = new CraftingService();
const guildService = new GuildService();
const characterService = new CharacterService();
const partySystem = new PartySystem();
const dungeonService = DungeonService.getInstance();
const tradeService = new TradeService();

// ============================================================
// Защита: персонаж в запросе должен принадлежать авторизованному
// пользователю. Без этого любой игрок мог тратить золото чужого
// персонажа (покупка на аукционе, депозит в гильдию и т.д.).
// ============================================================
const requireCharacterOwnership = (field = 'characterId') =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const characterId = req.body?.[field];
    if (!characterId) {
      res.status(400).json({ success: false, error: `Missing ${field}` });
      return;
    }
    const character = await characterService.getCharacterById(characterId);
    if (!character || character.userId !== req.userId) {
      res.status(403).json({ success: false, error: 'Character does not belong to you' });
      return;
    }
    next();
  };

const requireBodyField = (field: string) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.body?.[field]) {
      res.status(400).json({ success: false, error: `Missing ${field}` });
      return;
    }
    next();
  };

// ============================================================
// АУКЦИОН
// ============================================================

gameRouter.get('/auction', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { itemId, maxPrice, minEnhancement, limit, offset } = req.query;
  const listings = await auctionService.searchListings(
    itemId as string,
    maxPrice ? Number(maxPrice) : undefined,
    minEnhancement ? Number(minEnhancement) : undefined,
    limit ? Number(limit) : 50,
    offset ? Number(offset) : 0
  );
  return res.json({ listings });
}));

gameRouter.post('/auction/list', authMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = Joi.object({
      characterId: Joi.string().uuid().required(),
      itemId: Joi.string().required(),
      quantity: Joi.number().integer().min(1).required(),
      enhancement: Joi.number().integer().min(0).max(20).default(0),
      price: Joi.number().integer().min(1).required(),
      buyoutPrice: Joi.number().integer().min(1).optional(),
      durationHours: Joi.number().integer().valid(12, 24, 48, 72).default(24),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    try {
      const listing = await auctionService.createListing(
        value.characterId, value.itemId, value.quantity,
        value.enhancement, value.price, value.buyoutPrice, value.durationHours
      );
      return res.status(201).json({ listing });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  })
);

gameRouter.post('/auction/:listingId/buy', authMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await auctionService.buyListing(req.params.listingId, req.body.characterId);
    return res.json(result);
  })
);

gameRouter.delete('/auction/:listingId', authMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const success = await auctionService.cancelListing(req.params.listingId, req.body.characterId);
    return res.json({ success });
  })
);

// ============================================================
// МАГАЗИНЫ
// ============================================================

gameRouter.get('/shops', (_req: Request, res: Response) => {
  const shops = Object.entries(NPC_SHOPS).map(([id, shop]) => ({ id, ...shop }));
  return res.json({ shops });
});

gameRouter.get('/shops/:shopId', (req: Request, res: Response) => {
  const shop = NPC_SHOPS[req.params.shopId];
  if (!shop) return res.status(404).json({ error: 'Shop not found' });
  return res.json({ id: req.params.shopId, ...shop });
});

// POST /api/game/shops/:shopId/buy — покупка предмета за золото { characterId, itemId, quantity? }
gameRouter.post('/shops/:shopId/buy', authMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = Joi.object({
      characterId: Joi.string().uuid().required(),
      itemId: Joi.string().required(),
      quantity: Joi.number().integer().min(1).max(10).default(1),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const shop = NPC_SHOPS[req.params.shopId];
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    const entry = shop.items.find(i => i.itemId === value.itemId);
    if (!entry) return res.status(400).json({ error: 'Item not sold in this shop' });
    if (entry.currency !== 'gold') {
      return res.status(400).json({ error: 'Premium currency purchases are not supported yet' });
    }
    if (entry.minLevel) {
      const character = await characterService.getCharacterById(value.characterId);
      if (character && character.level < entry.minLevel) {
        return res.status(400).json({ error: `Requires level ${entry.minLevel}` });
      }
    }

    const totalCost = entry.price * value.quantity;
    let remaining: number;
    try {
      remaining = await characterService.spendGold(value.characterId, totalCost);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
    await characterService.addItems(value.characterId, [{ itemId: value.itemId, qty: value.quantity }]);

    // Купленные материалы могут закрыть collect-цели квестов
    const questsDone = await questEvaluate(value.characterId);

    return res.status(201).json({ success: true, itemId: value.itemId, quantity: value.quantity, goldSpent: totalCost, gold: remaining, questsCompleted: questsDone });
  })
);

// POST /api/game/shops/:shopId/sell — скупка лута магазином (45% цены) { characterId, itemId, quantity? }
gameRouter.post('/shops/:shopId/sell', authMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = Joi.object({
      characterId: Joi.string().uuid().required(),
      itemId: Joi.string().required(),
      quantity: Joi.number().integer().min(1).max(99).default(1),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    if (!NPC_SHOPS[req.params.shopId]) return res.status(404).json({ error: 'Shop not found' });

    const def = ITEMS_DATABASE[value.itemId];
    if (!def) return res.status(400).json({ error: 'Item not found' });

    const totalGain = Math.floor(def.price * 0.45) * value.quantity;
    try {
      await characterService.removeItems(value.characterId, [{ itemId: value.itemId, qty: value.quantity }]);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
    const gold = await characterService.addGold(value.characterId, totalGain);
    return res.json({ success: true, goldGained: totalGain, gold });
  })
);

// GET /api/game/servers — список игровых серверов и онлайн на каждом
gameRouter.get('/servers', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const servers = await Promise.all(GAME_SERVERS.map(async (srv) => ({
    ...srv,
    online: await redis.getShardOnline(srv.id),
  })));
  return res.json({ servers });
}));

// ============================================================
// ДАНЖИ
// ============================================================

// POST /api/game/dungeons/:dungeonId/enter — начать сессию данжа { characterId }
gameRouter.post('/dungeons/:dungeonId/enter', authMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await dungeonService.enter(req.body.characterId, req.params.dungeonId);
    if (!result.ok) return res.status(400).json({ error: result.code });

    const def = DUNGEONS_DATABASE[req.params.dungeonId];
    return res.status(201).json({
      session: {
        id: result.session.id,
        dungeonId: result.session.dungeonId,
        dungeonNameRu: def?.nameRu ?? req.params.dungeonId,
        monsterCount: result.session.monsterIds.size,
        bossCount: result.session.requiredBossIds.size,
        killedBossCount: result.session.killedBossIds.size,
      },
    });
  })
);

// POST /api/game/dungeons/leave — покинуть данж { characterId }
gameRouter.post('/dungeons/leave', authMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const left = await dungeonService.leave(req.body.characterId);
    return res.json({ success: left });
  })
);

// POST /api/game/dungeons/status — прогресс активной сессии { characterId }
gameRouter.post('/dungeons/status', authMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const session = dungeonService.getSessionForCharacter(req.body.characterId);
    if (!session) return res.json({ active: false });
    const def = DUNGEONS_DATABASE[session.dungeonId];
    return res.json({
      active: true,
      id: session.id,
      dungeonId: session.dungeonId,
      dungeonNameRu: def?.nameRu ?? session.dungeonId,
      bossCount: session.requiredBossIds.size,
      killedBossCount: session.killedBossIds.size,
      startedAt: session.startedAt,
    });
  })
);

// ============================================================
// ТОРГОВЫЕ КОНТРАКТЫ (Шёлковый путь)
// ============================================================

// GET /api/game/trade/contracts — список маршрутов
gameRouter.get('/trade/contracts', authMiddleware, (_req: Request, res: Response) => {
  return res.json({ contracts: tradeService.listForClient() });
});

// POST /api/game/trade/accept — принять контракт { characterId, contractId }
gameRouter.post('/trade/accept', authMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const contractId = req.body?.contractId;
    if (!contractId) return res.status(400).json({ error: 'Missing contractId' });
    const result = await tradeService.accept(req.body.characterId, contractId);
    if (!result.ok) return res.status(400).json({ error: result.code });
    return res.status(201).json({ success: true, contract: result.contract });
  })
);

// POST /api/game/trade/deliver — доставить груз (нужно быть в городе назначения) { characterId }
gameRouter.post('/trade/deliver', authMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await tradeService.deliver(req.body.characterId);
    if (!result.ok) return res.status(400).json({ error: result.code });
    return res.json({ success: true, gold: result.gold, exp: result.exp });
  })
);

// POST /api/game/trade/cancel — отказаться от контракта (груз возвращается) { characterId }
gameRouter.post('/trade/cancel', authMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const cancelled = await tradeService.cancel(req.body.characterId);
    return res.json({ success: cancelled });
  })
);

// ============================================================
// КРАФТИНГ
// ============================================================

gameRouter.get('/crafting/recipes', authMiddleware, (req: Request, res: Response) => {
  const { category } = req.query;
  const recipes = category
    ? craftingService.getRecipesByCategory(category as never)
    : Object.values(CRAFTING_RECIPES);
  return res.json({ recipes });
});

gameRouter.post('/crafting/start', authMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = Joi.object({
      characterId: Joi.string().uuid().required(),
      recipeId: Joi.string().required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    try {
      // Уровень ремесла считается на сервере из crafting_xp
      const job = await craftingService.startCrafting(value.characterId, value.recipeId);
      return res.status(201).json({ job });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  })
);

gameRouter.post('/crafting/:jobId/complete', authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await craftingService.completeCrafting(req.params.jobId);
      // Крафченые предметы могут закрыть collect-цели квестов
      const characterId = (req.body ?? {}).characterId;
      const questsCompleted = characterId ? await questEvaluate(String(characterId)) : [];
      return res.json({ ...result, questsCompleted });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  })
);

// ============================================================
// ГИЛЬДИИ
// ============================================================

gameRouter.post('/guilds', authMiddleware, requireBodyField('leaderId'),
  asyncHandler(async (req: Request, res: Response) => {
    // Лидер гильдии должен быть собственным персонажем
    const leader = await characterService.getCharacterById(req.body.leaderId);
    if (!leader || leader.userId !== req.userId) {
      return res.status(403).json({ success: false, error: 'Character does not belong to you' });
    }

    const schema = Joi.object({
      leaderId: Joi.string().uuid().required(),
      name: Joi.string().min(2).max(30).required(),
      description: Joi.string().max(500).default(''),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const guild = await guildService.createGuild(value.leaderId, value.name, value.description);
    return res.status(201).json({ guild });
  })
);

gameRouter.get('/guilds/:guildId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const guild = await guildService.getGuildInfo(req.params.guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });
  const members = await guildService.getGuildMembers(req.params.guildId);
  return res.json({ guild, members });
}));

gameRouter.post('/guilds/:guildId/invite', authMiddleware, requireBodyField('inviterId'),
  asyncHandler(async (req: Request, res: Response) => {
    // Действия от имени гильдии выполняет собственный персонаж
    const inviter = await characterService.getCharacterById(req.body.inviterId);
    if (!inviter || inviter.userId !== req.userId) {
      return res.status(403).json({ success: false, error: 'Character does not belong to you' });
    }
    await guildService.inviteMember(req.params.guildId, req.body.inviterId, req.body.targetId);
    return res.json({ success: true });
  })
);

gameRouter.post('/guilds/:guildId/kick', authMiddleware, requireBodyField('kickerId'),
  asyncHandler(async (req: Request, res: Response) => {
    const kicker = await characterService.getCharacterById(req.body.kickerId);
    if (!kicker || kicker.userId !== req.userId) {
      return res.status(403).json({ success: false, error: 'Character does not belong to you' });
    }
    await guildService.kickMember(req.params.guildId, req.body.kickerId, req.body.targetId);
    return res.json({ success: true });
  })
);

gameRouter.post('/guilds/:guildId/deposit', authMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    await guildService.depositGold(req.params.guildId, req.body.characterId, req.body.amount);
    return res.json({ success: true });
  })
);

// ============================================================
// ПАРТИИ
// ============================================================

gameRouter.post('/parties', authMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const party = await partySystem.createParty(req.body.characterId, req.body.lootRule);
    return res.status(201).json({ party });
  })
);

gameRouter.post('/parties/:partyId/invite', authMiddleware, requireBodyField('inviterId'),
  asyncHandler(async (req: Request, res: Response) => {
    const inviter = await characterService.getCharacterById(req.body.inviterId);
    if (!inviter || inviter.userId !== req.userId) {
      return res.status(403).json({ success: false, error: 'Character does not belong to you' });
    }
    await partySystem.inviteToParty(req.params.partyId, req.body.inviterId, req.body.targetId);
    return res.json({ success: true });
  })
);

gameRouter.post('/parties/:partyId/leave', authMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    await partySystem.leaveParty(req.params.partyId, req.body.characterId);
    return res.json({ success: true });
  })
);

gameRouter.get('/parties/:partyId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  // getParty приватный — используем публичный доступ через invite-free чтение
  const party = await partySystem.getPartyInfo(req.params.partyId);
  if (!party) return res.status(404).json({ error: 'Party not found' });
  return res.json({ party });
}));

// ============================================================
// КВЕСТЫ
// ============================================================

gameRouter.get('/quests', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { level, characterId, type } = req.query;
  let quests = Object.values(QUESTS_DATABASE);
  if (type) quests = quests.filter(q => q.type === type);
  if (level) {
    if (!characterId) {
      return res.status(400).json({ error: 'characterId is required when level filter is used' });
    }
    const char = await characterService.getCharacterById(characterId as string);
    if (!char || char.userId !== req.userId) {
      return res.status(403).json({ error: 'Character does not belong to you' });
    }
    quests = getAvailableQuests(char.level, [], char.class);
  }
  return res.json({ quests });
}));

gameRouter.get('/quests/:questId', (_req: Request, res: Response) => {
  const quest = QUESTS_DATABASE[_req.params.questId];
  if (!quest) return res.status(404).json({ error: 'Quest not found' });
  return res.json({ quest });
});

// ============================================================
// ДАНЖИ
// ============================================================

gameRouter.get('/dungeons', (_req: Request, res: Response) => {
  const { level } = _req.query;
  const dungeons = level
    ? getDungeonsByLevel(Number(level))
    : Object.values(DUNGEONS_DATABASE);
  return res.json({ dungeons });
});

gameRouter.get('/dungeons/:dungeonId', (req: Request, res: Response) => {
  const dungeon = DUNGEONS_DATABASE[req.params.dungeonId];
  if (!dungeon) return res.status(404).json({ error: 'Dungeon not found' });
  return res.json({ dungeon });
});

// ============================================================
// МИРОВЫЕ БОССЫ
// ============================================================

gameRouter.get('/world-bosses', (_req: Request, res: Response) => {
  const bosses = getWorldBosses();
  return res.json({ bosses });
});

// Единая обработка ошибок async-маршрутов (БД/Redis недоступны и т.п.)
gameRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  return errorResponse(res, err, 500);
});
