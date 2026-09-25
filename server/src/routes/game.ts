import { Router, Request, Response, NextFunction } from 'express';
import { secureMiddleware } from '../middleware/auth';
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
import { asyncHandler } from '../utils/asyncHandler';
import { AZENS_CONVERSION_RATES, AZENS_PACKS, PREMIUM_DURATIONS, FIRST_TOPUP_MULTIPLIER, FIRST_TOPUP_MAX_BONUS, EXCHANGE_PAIRS, getExchangePair, shopCurrencyToWallet } from '../utils/economy';
import { MOUNTS, MountSystem } from '../systems/MountSystem';
import { PetService } from '../services/PetService';
import { HousingService, HOUSE_TYPES, DECORATIONS } from '../services/HousingService';
import { PvPService } from '../services/PvPService';
import { EndGameService } from '../services/EndGameService';
import { PremiumSystem, CURRENT_SEASON, BATTLE_PASS_TIERS } from '../systems/PremiumSystem';
import { PaymentService } from '../services/PaymentService';
import { PromoService } from '../services/PromoService';
import { NotificationService } from '../services/NotificationService';
import { PAYMENT_PROVIDERS } from '../services/paymentProviders';
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
const premiumSystem = new PremiumSystem();
const paymentService = new PaymentService();
const promoService = new PromoService();
const notificationService = new NotificationService();
const mountSystem = new MountSystem();
const petService = new PetService();
const housingService = new HousingService();
const pvpService = new PvPService();
const endgameService = new EndGameService();

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

gameRouter.get('/auction', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
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

gameRouter.post('/auction/list', secureMiddleware, requireCharacterOwnership(),
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

gameRouter.post('/auction/:listingId/buy', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await auctionService.buyListing(req.params.listingId, req.body.characterId);
    return res.json(result);
  })
);

gameRouter.delete('/auction/:listingId', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const success = await auctionService.cancelListing(req.params.listingId, req.body.characterId);
    return res.json({ success });
  })
);

// ============================================================
// МАГАЗИНЫ
// ============================================================

gameRouter.get('/shops', (_req: Request, res: Response) => {
  const shops = Object.entries(NPC_SHOPS).map(([id, shop]) => ({
    id,
    nameRu: shop.nameRu,
    items: shop.items.map((item) => ({
      ...item,
      nameRu: ITEMS_DATABASE[item.itemId]?.nameRu ?? item.itemId,
    })),
  }));
  return res.json({ shops });
});

gameRouter.get('/shops/:shopId', (req: Request, res: Response) => {
  const shop = NPC_SHOPS[req.params.shopId];
  if (!shop) return res.status(404).json({ error: 'Shop not found' });
  return res.json({ id: req.params.shopId, ...shop });
});

// POST /api/game/shops/:shopId/buy — покупка предмета за золото { characterId, itemId, quantity? }
gameRouter.post('/shops/:shopId/buy', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = Joi.object({
      characterId: Joi.string().uuid().required(),
      itemId: Joi.string().required(),
      quantity: Joi.number().integer().min(1).max(10).default(1),
      currency: Joi.string().valid('gold', 'azens', 'silver', 'syrian').optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const shop = NPC_SHOPS[req.params.shopId];
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    const entry = shop.items.find(i => i.itemId === value.itemId);
    if (!entry) return res.status(400).json({ error: 'Item not sold in this shop' });
    // Валюта магазина "premium" оплачивается AZENS; "gold" — золотом.
    // Явный параметр currency должен совпадать с валютой товара.
    const walletCurrency = shopCurrencyToWallet(entry.currency);
    if (value.currency && value.currency !== walletCurrency) {
      return res.status(400).json({ error: `This item costs ${walletCurrency}` });
    }
    if (entry.minLevel) {
      const character = await characterService.getCharacterById(value.characterId);
      if (character && character.level < entry.minLevel) {
        return res.status(400).json({ error: `Requires level ${entry.minLevel}` });
      }
    }

    const totalCost = entry.price * value.quantity;
    let gold: number | undefined;
    let azens: number | undefined;
    let silver: number | undefined;
    let syrian: number | undefined;
    try {
      if (walletCurrency === 'azens') {
        await characterService.assertSolvent(value.characterId);
        azens = await characterService.spendAzens(value.characterId, totalCost);
      } else if (walletCurrency === 'silver') {
        silver = await characterService.spendSilver(value.characterId, totalCost);
      } else if (walletCurrency === 'syrian') {
        syrian = await characterService.spendSyrianGold(value.characterId, totalCost);
      } else {
        gold = await characterService.spendGold(value.characterId, totalCost);
      }
    } catch (err) {
      const msg = (err as Error).message;
      const code = msg.startsWith('AZENS debt') ? 'azens_debt' : undefined;
      return res.status(code ? 403 : 400).json({ error: msg, ...(code ? { code } : {}) });
    }
    // Скакуны не кладутся в инвентарь — идут напрямую в MountSystem
    if (value.itemId.startsWith('mount_')) {
      const def = MOUNTS[value.itemId];
      if (!def) return res.status(400).json({ error: 'Mount definition not found' });
      const mount = await mountSystem.addMount(value.characterId, value.itemId);
      const questsDone = await questEvaluate(value.characterId);
      return res.status(201).json({ success: true, itemId: value.itemId, quantity: value.quantity, goldSpent: walletCurrency === 'gold' ? totalCost : 0, azensSpent: walletCurrency === 'azens' ? totalCost : 0, silverSpent: walletCurrency === 'silver' ? totalCost : 0, syrianSpent: walletCurrency === 'syrian' ? totalCost : 0, gold, azens, silver, syrian, mount, questsCompleted: questsDone });
    }
    await characterService.addItems(value.characterId, [{ itemId: value.itemId, qty: value.quantity }]);

    // Купленные материалы могут закрыть collect-цели квестов
    const questsDone = await questEvaluate(value.characterId);

    return res.status(201).json({ success: true, itemId: value.itemId, quantity: value.quantity, goldSpent: walletCurrency === 'gold' ? totalCost : 0, azensSpent: walletCurrency === 'azens' ? totalCost : 0, silverSpent: walletCurrency === 'silver' ? totalCost : 0, syrianSpent: walletCurrency === 'syrian' ? totalCost : 0, gold, azens, silver, syrian, questsCompleted: questsDone });
  })
);

// POST /api/game/shops/:shopId/sell — скупка лута магазином (45% цены) { characterId, itemId, quantity? }
gameRouter.post('/shops/:shopId/sell', secureMiddleware, requireCharacterOwnership(),
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

// ============================================================
// ОБМЕННИК свободных валют (золото/серебро/сирийское золото)
// ============================================================

// GET /api/game/exchange/pairs — курсы обменника
gameRouter.get('/exchange/pairs', secureMiddleware, (_req: Request, res: Response) => {
  return res.json({ pairs: EXCHANGE_PAIRS });
});

// POST /api/game/exchange — обмен { characterId, pairId, times? }
gameRouter.post('/exchange', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = Joi.object({
      characterId: Joi.string().uuid().required(),
      pairId: Joi.string().required(),
      times: Joi.number().integer().min(1).max(100).default(1),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const pair = getExchangePair(value.pairId);
    if (!pair) return res.status(404).json({ error: 'Exchange pair not found' });
    const col = { gold: 'gold', silver: 'isfahan_silver', syrian: 'syrian_gold' } as const;
    try {
      const wallet = await characterService.exchange(
        value.characterId, col[pair.from], pair.give * value.times, col[pair.to], pair.receive * value.times
      );
      return res.json({ success: true, pair: pair.id, times: value.times, wallet });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  })
);

// ============================================================
// ПОДАРКИ: передача предметов другому персонажу
// ============================================================

// POST /api/game/gifts/send — подарок { characterId, targetName, itemId, quantity? }
gameRouter.post('/gifts/send', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = Joi.object({
      characterId: Joi.string().uuid().required(),
      targetName: Joi.string().min(2).max(24).required(),
      itemId: Joi.string().required(),
      quantity: Joi.number().integer().min(1).max(10).default(1),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const sender = await characterService.getCharacterById(value.characterId);
    if (!sender) return res.status(404).json({ error: 'Character not found' });
    const def = ITEMS_DATABASE[value.itemId];
    if (!def) return res.status(400).json({ error: 'Item not found' });
    if (String(def.type) === 'quest') {
      return res.status(400).json({ error: 'Quest items cannot be gifted' });
    }
    const target = await characterService.getCharacterByNameExact(value.targetName);
    if (!target) return res.status(404).json({ error: 'Target character not found' });
    if (target.id === sender.id) return res.status(400).json({ error: 'Cannot gift yourself' });

    try {
      await characterService.removeItems(sender.id, [{ itemId: value.itemId, qty: value.quantity }]);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
    await characterService.addItems(target.id, [{ itemId: value.itemId, qty: value.quantity }]);
    await notificationService.send(target.id, 'mail_received', {
      from: sender.name, itemId: value.itemId, quantity: value.quantity,
    }).catch(() => {});
    return res.status(201).json({ success: true, target: target.name, itemId: value.itemId, quantity: value.quantity });
  })
);

// ============================================================
// ВНУТРИИГРОВЫЕ ТРАНЗАКЦИИ: AZENS, кошелёк, батл-пасс
// ============================================================

// GET /api/game/payments/rates — курсы, пакеты и бонус первой покупки (публично)
gameRouter.get('/payments/rates', (_req: Request, res: Response) => {
  return res.json({
    rates: AZENS_CONVERSION_RATES,
    packs: AZENS_PACKS,
    firstBonus: { multiplier: FIRST_TOPUP_MULTIPLIER, maxBonus: FIRST_TOPUP_MAX_BONUS },
    premiumDurations: PREMIUM_DURATIONS,
    simulator: process.env.PAYMENTS_SIMULATOR === 'true',
  });
});

// POST /api/game/payments/topup — открыть pending-платёж { characterId, packId } или { characterId, realCurrency, amount }
// ВНИМАНИЕ: ничего не начисляет. AZENS падают на баланс только через
// вебхук провайдера (POST /payments/webhook/:provider) после реальной оплаты.
gameRouter.post('/payments/topup', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = Joi.object({
      characterId: Joi.string().uuid().required(),
      packId: Joi.string().max(32).optional(),
      realCurrency: Joi.string().valid(...Object.keys(AZENS_CONVERSION_RATES)).optional(),
      amount: Joi.number().positive().max(1000000).optional(),
    }).xor('packId', 'realCurrency').with('realCurrency', 'amount');
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const character = await characterService.getCharacterById(value.characterId);
    if (!character) return res.status(404).json({ error: 'Character not found' });

    try {
      const payment = await paymentService.createTopup(
        character.userId,
        value.characterId,
        value.packId ? { packId: value.packId } : { realCurrency: value.realCurrency, amount: value.amount }
      );
      return res.status(201).json({
        success: true,
        paymentId: payment.id,
        status: payment.status,
        packId: payment.packId,
        azensExpected: payment.azensExpected,
        realCurrency: payment.realCurrency,
        realAmount: payment.realAmount,
      });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  })
);

// GET /api/game/payments/mine?characterId= — история платежей (для «Мои покупки»)
gameRouter.get('/payments/mine', secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = String(req.query.characterId ?? '');
    const character = await characterService.getCharacterById(characterId);
    if (!character || character.userId !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const payments = await paymentService.listMine(character.userId, Number(req.query.limit) || 50);
    return res.json({
      payments: payments.map(p => ({
        paymentId: p.id,
        status: p.status,
        packId: p.packId,
        azensExpected: p.azensExpected,
        bonus: p.bonus,
        realCurrency: p.realCurrency,
        realAmount: p.realAmount,
        createdAt: p.createdAt,
      })),
    });
  })
);
// GET /api/game/payments/:paymentId — статус платежа (для опроса клиентом)
gameRouter.get('/payments/:paymentId', secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const payment = await paymentService.getPayment(req.params.paymentId);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    const character = await characterService.getCharacterById(payment.characterId);
    if (!character || character.userId !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    return res.json({
      paymentId: payment.id,
      status: payment.status,
      azensExpected: payment.azensExpected,
      bonus: payment.bonus,
      realCurrency: payment.realCurrency,
      realAmount: payment.realAmount,
    });
  })
);

// POST /api/game/payments/webhook/:provider — подтверждение провайдера (без auth, по HMAC).
// Тело: { paymentId, providerPaymentId, status: 'completed' | 'failed', failReason? }
// Подпись: HMAC-SHA256 hex от сырого тела, заголовок x-payment-signature, секрет PAYMENT_WEBHOOK_SECRET.
gameRouter.post('/payments/webhook/:provider', asyncHandler(async (req: Request, res: Response) => {
  const provider = PAYMENT_PROVIDERS[req.params.provider.toLowerCase()];
  if (!provider) return res.status(404).json({ error: 'Unknown payment provider' });

  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? '';
  if (!provider.verifySignature(rawBody, req.header('x-payment-signature'))) {
    return res.status(401).json({ error: 'Bad webhook signature' });
  }
  const event = provider.parseEvent(req.body);
  if (!event) return res.status(400).json({ error: 'Ignoring non-payment event' });

  const result = event.kind === 'refunded'
    ? await paymentService.reversePayment({
        provider: provider.name,
        providerPaymentId: event.providerPaymentId,
        paymentId: event.paymentId,
        reason: event.failReason,
      })
    : await paymentService.completePayment({
        provider: provider.name,
        providerPaymentId: event.providerPaymentId,
        paymentId: event.paymentId,
        succeed: event.kind === 'completed',
        failReason: event.failReason,
      });
  if (!result.ok) return res.status(400).json({ error: result.code });
  return res.json({ success: true, deduped: result.deduped ?? false, azens: result.azens, bonus: result.bonus ?? 0 });
}));

// POST /api/game/payments/simulate — dev-симулятор провайдера { paymentId }
// Работает ТОЛЬКО при PAYMENTS_SIMULATOR=true. Идёт тем же путём completePayment,
// что и настоящий вебхук, поэтому механика честная, а «печатать» деньги из
// клиента в проде нельзя.
gameRouter.post('/payments/simulate', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    if (process.env.PAYMENTS_SIMULATOR !== 'true') {
      return res.status(403).json({ error: 'Payment simulator is disabled' });
    }
    const schema = Joi.object({
      characterId: Joi.string().uuid().required(),
      paymentId: Joi.string().uuid().required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const payment = await paymentService.getPayment(value.paymentId);
    if (!payment || payment.characterId !== value.characterId) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    const result = await paymentService.completePayment({
      provider: 'simulator',
      providerPaymentId: `sim_${value.paymentId}`,
      paymentId: value.paymentId,
      succeed: true,
    });
    if (!result.ok) return res.status(400).json({ error: result.code });
    return res.json({ success: true, deduped: result.deduped ?? false, azens: result.azens, bonus: result.bonus ?? 0 });
  })
);

// POST /api/game/wallet — балансы всех валют персонажа { characterId }
gameRouter.post('/wallet', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const character = await characterService.getCharacterById(req.body.characterId);
    if (!character) return res.status(404).json({ error: 'Character not found' });
    return res.json({
      gold: character.gold ?? 0,
      azens: character.azens ?? 0,
      isfahanSilver: character.isfahanSilver ?? 0,
      syrianGold: character.syrianGold ?? 0,
      hasToppedUp: await paymentService.hasCompletedPayment(character.userId),
    });
  })
);

// ============================================================
// PREMIUM-АККАУНТ за AZENS
// ============================================================

// POST /api/game/premium/status — активен ли премиум { characterId }
gameRouter.post('/premium/status', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const character = await characterService.getCharacterById(req.body.characterId);
    if (!character) return res.status(404).json({ error: 'Character not found' });
    const benefits = await premiumSystem.getPremiumBenefits(character.userId);
    return res.json({ active: !!benefits, benefits, durations: PREMIUM_DURATIONS });
  })
);

// POST /api/game/premium/purchase — купить премиум за AZENS { characterId, days: 7 | 30 }
gameRouter.post('/premium/purchase', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = Joi.object({
      characterId: Joi.string().uuid().required(),
      days: Joi.number().valid(...PREMIUM_DURATIONS.map(d => d.days)).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const character = await characterService.getCharacterById(value.characterId);
    if (!character) return res.status(404).json({ error: 'Character not found' });
    const price = PREMIUM_DURATIONS.find(d => d.days === value.days)!.priceAzens;
    try {
      await characterService.assertSolvent(value.characterId);
      await characterService.spendAzens(value.characterId, price);
    } catch (err) {
      const code = (err as Error).message.startsWith('AZENS debt') ? 'azens_debt' : undefined;
      return res.status(code ? 403 : 400).json({ error: (err as Error).message, price, ...(code ? { code } : {}) });
    }
    await premiumSystem.activatePremium(character.userId, value.days);
    const updated = await characterService.getCharacterById(value.characterId);
    return res.status(201).json({ success: true, days: value.days, price, azens: updated?.azens ?? 0 });
  })
);

// ============================================================
// ПРОМОКОДЫ
// ============================================================

// POST /api/game/promo/redeem — погасить промокод { characterId, code }
gameRouter.post('/promo/redeem', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = Joi.object({
      characterId: Joi.string().uuid().required(),
      code: Joi.string().min(1).max(40).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    try {
      const reward = await promoService.redeem(value.characterId, value.code);
      const character = await characterService.getCharacterById(value.characterId);
      return res.json({
        success: true,
        reward,
        wallet: {
          azens: character?.azens ?? 0,
          isfahanSilver: character?.isfahanSilver ?? 0,
          syrianGold: character?.syrianGold ?? 0,
        },
      });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  })
);

// POST /api/game/battlepass/purchase — купить премиум БП за AZENS { characterId }
gameRouter.post('/battlepass/purchase', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const price = CURRENT_SEASON.premiumPrice;
    try {
      await characterService.assertSolvent(req.body.characterId);
      await characterService.spendAzens(req.body.characterId, price);
    } catch (err) {
      const code = (err as Error).message.startsWith('AZENS debt') ? 'azens_debt' : undefined;
      return res.status(code ? 403 : 400).json({ error: (err as Error).message, price, ...(code ? { code } : {}) });
    }
    await premiumSystem.purchaseBattlePass(req.body.characterId);
    const character = await characterService.getCharacterById(req.body.characterId);
    return res.status(201).json({ success: true, price, azens: character?.azens ?? 0, season: CURRENT_SEASON.id });
  })
);

// POST /api/game/battlepass/status — прогресс сезона { characterId }
gameRouter.post('/battlepass/status', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const progress = await premiumSystem.getProgress(req.body.characterId);
    return res.json({ season: CURRENT_SEASON, tiers: BATTLE_PASS_TIERS, progress: progress ?? null });
  })
);

// POST /api/game/battlepass/claim — забрать награду тира { characterId, tier, premium }
gameRouter.post('/battlepass/claim', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const schema = Joi.object({
      characterId: Joi.string().uuid().required(),
      tier: Joi.number().integer().min(1).max(50).required(),
      premium: Joi.boolean().default(false),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const reward = await premiumSystem.claimTierReward(value.characterId, value.tier, value.premium);
    if (!reward) return res.status(400).json({ error: 'Reward not available' });
    return res.json({ success: true, reward });
  })
);

// GET /api/game/servers — список игровых серверов и онлайн на каждом
gameRouter.get('/servers', secureMiddleware, asyncHandler(async (_req: Request, res: Response) => {
  const servers = await Promise.all(GAME_SERVERS.map(async (srv) => ({
    ...srv,
    online: await redis.getShardOnline(srv.id),
  })));
  return res.json({ servers });
}));

// GET /api/game/servers-status — публичный онлайн шардов для лендинга (без авторизации)
gameRouter.get('/servers-status', asyncHandler(async (_req: Request, res: Response) => {
  const servers = await Promise.all(GAME_SERVERS.map(async (srv) => ({
    id: srv.id,
    nameRu: srv.nameRu,
    online: await redis.getShardOnline(srv.id),
  })));
  return res.json({ servers });
}));

// ============================================================
// ДАНЖИ
// ============================================================

// POST /api/game/dungeons/:dungeonId/enter — начать сессию данжа { characterId }
gameRouter.post('/dungeons/:dungeonId/enter', secureMiddleware, requireCharacterOwnership(),
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
gameRouter.post('/dungeons/leave', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const left = await dungeonService.leave(req.body.characterId);
    return res.json({ success: left });
  })
);

// POST /api/game/dungeons/status — прогресс активной сессии { characterId }
gameRouter.post('/dungeons/status', secureMiddleware, requireCharacterOwnership(),
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
gameRouter.get('/trade/contracts', secureMiddleware, (_req: Request, res: Response) => {
  return res.json({ contracts: tradeService.listForClient() });
});

// POST /api/game/trade/accept — принять контракт { characterId, contractId }
gameRouter.post('/trade/accept', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const contractId = req.body?.contractId;
    if (!contractId) return res.status(400).json({ error: 'Missing contractId' });
    const result = await tradeService.accept(req.body.characterId, contractId);
    if (!result.ok) return res.status(400).json({ error: result.code });
    return res.status(201).json({ success: true, contract: result.contract });
  })
);

// POST /api/game/trade/deliver — доставить груз (нужно быть в городе назначения) { characterId }
gameRouter.post('/trade/deliver', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await tradeService.deliver(req.body.characterId);
    if (!result.ok) return res.status(400).json({ error: result.code });
    return res.json({ success: true, gold: result.gold, exp: result.exp, silver: result.silver, syrian: result.syrian });
  })
);

// POST /api/game/trade/cancel — отказаться от контракта (груз возвращается) { characterId }
gameRouter.post('/trade/cancel', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const cancelled = await tradeService.cancel(req.body.characterId);
    return res.json({ success: cancelled });
  })
);

// ============================================================
// КРАФТИНГ
// ============================================================

gameRouter.get('/crafting/recipes', secureMiddleware, (req: Request, res: Response) => {
  const { category } = req.query;
  const recipes = category
    ? craftingService.getRecipesByCategory(category as never)
    : Object.values(CRAFTING_RECIPES);
  return res.json({ recipes });
});

gameRouter.post('/crafting/start', secureMiddleware, requireCharacterOwnership(),
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

gameRouter.post('/crafting/:jobId/complete', secureMiddleware,
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

// GET /api/game/guilds — список всех гильдий
gameRouter.get('/guilds', secureMiddleware, asyncHandler(async (_req: Request, res: Response) => {
  const guilds = await guildService.listGuilds();
  return res.json({ guilds });
}));

gameRouter.post('/guilds', secureMiddleware, requireBodyField('leaderId'),
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

    const guild = await guildService.createGuildCompat(value.leaderId, value.name, value.description);
    return res.status(201).json({ guild });
  })
);

gameRouter.get('/guilds/:guildId', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const guild = await guildService.getGuildInfo(req.params.guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });
  const members = await guildService.getGuildMembers(req.params.guildId);
  return res.json({ guild, members });
}));

gameRouter.post('/guilds/:guildId/invite', secureMiddleware, requireBodyField('inviterId'),
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

gameRouter.post('/guilds/:guildId/kick', secureMiddleware, requireBodyField('kickerId'),
  asyncHandler(async (req: Request, res: Response) => {
    const kicker = await characterService.getCharacterById(req.body.kickerId);
    if (!kicker || kicker.userId !== req.userId) {
      return res.status(403).json({ success: false, error: 'Character does not belong to you' });
    }
    await guildService.kickMember(req.params.guildId, req.body.kickerId, req.body.targetId);
    return res.json({ success: true });
  })
);

gameRouter.post('/guilds/:guildId/deposit', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    await guildService.depositGold(req.params.guildId, req.body.characterId, req.body.amount);
    return res.json({ success: true });
  })
);

// ============================================================
// ПАРТИИ
// ============================================================

gameRouter.post('/parties', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const party = await partySystem.createParty(req.body.characterId, req.body.lootRule);
    return res.status(201).json({ party });
  })
);

gameRouter.post('/parties/:partyId/invite', secureMiddleware, requireBodyField('inviterId'),
  asyncHandler(async (req: Request, res: Response) => {
    const inviter = await characterService.getCharacterById(req.body.inviterId);
    if (!inviter || inviter.userId !== req.userId) {
      return res.status(403).json({ success: false, error: 'Character does not belong to you' });
    }
    await partySystem.inviteToParty(req.params.partyId, req.body.inviterId, req.body.targetId);
    return res.json({ success: true });
  })
);

gameRouter.post('/parties/:partyId/leave', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    await partySystem.leaveParty(req.params.partyId, req.body.characterId);
    return res.json({ success: true });
  })
);

gameRouter.get('/parties/:partyId', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  // getParty приватный — используем публичный доступ через invite-free чтение
  const party = await partySystem.getPartyInfo(req.params.partyId);
  if (!party) return res.status(404).json({ error: 'Party not found' });
  return res.json({ party });
}));

// ============================================================
// КВЕСТЫ
// ============================================================

gameRouter.get('/quests', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
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

gameRouter.post('/mounts/activate', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const { characterId, mountId } = req.body;
    if (!characterId || !mountId) return res.status(400).json({ error: 'characterId and mountId required' });
    const def = MOUNTS[mountId];
    if (!def) return res.status(400).json({ error: 'Mount not found' });
    await mountSystem.activateMount(characterId, mountId);
    return res.json({ success: true });
  })
);

gameRouter.post('/mounts/my', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const { characterId } = req.body;
    if (!characterId) return res.status(400).json({ error: 'characterId required' });
    const mounts = await mountSystem.getCharacterMounts(characterId);
    return res.json({ mounts });
  })
);

// ── Питомцы ──────────────────────────────────────────────
gameRouter.get('/pets', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const list = await petService.getPets(req.userId!);
  res.json({ pets: list, allDefs: petService.getAllDefs() });
}));

gameRouter.get('/pets/active', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const pet = await petService.getActivePet(req.userId!);
  res.json({ pet });
}));

gameRouter.post('/pets/acquire', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const pet = await petService.acquirePet(req.userId!, req.body.petId);
      return res.json({ success: true, pet });
    } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  })
);

gameRouter.post('/pets/activate', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      await petService.setActive(req.userId!, req.body.petDbId);
      return res.json({ success: true });
    } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  })
);

gameRouter.post('/pets/rename', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    await petService.renamePet(req.userId!, req.body.petDbId, req.body.nickname);
    return res.json({ success: true });
  })
);

gameRouter.post('/pets/release', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    await petService.releasePet(req.userId!, req.body.petDbId);
    return res.json({ success: true });
  })
);

// ── Недвижимость ─────────────────────────────────────────
const HOUSE_TYPES_SIMPLE = Object.entries(HOUSE_TYPES).map(([k, v]) => ({ id: k, ...v }));
const DECORATIONS_SIMPLE = Object.entries(DECORATIONS).map(([k, v]) => ({ id: k, ...v }));

gameRouter.get('/house', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const house = await housingService.getHouse(req.userId!);
  const decorations = house ? await housingService.getDecorations(req.userId!) : [];
  return res.json({ house, playerDecorations: decorations, houseTypes: HOUSE_TYPES_SIMPLE, allDecorations: DECORATIONS_SIMPLE });
}));

gameRouter.post('/house/buy', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const house = await housingService.buyHouse(req.userId!, req.body.region, req.body.houseType);
      return res.json({ success: true, house });
    } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  })
);

gameRouter.post('/house/upgrade', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const house = await housingService.upgradeHouse(req.userId!);
      return res.json({ success: true, house });
    } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  })
);

gameRouter.post('/house/decorate', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      await housingService.placeDecoration(req.userId!, req.body.decorationId);
      return res.json({ success: true });
    } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  })
);

// ── PvP Арена ────────────────────────────────────────────
gameRouter.post('/pvp/find-match', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const match = await pvpService.findMatch(req.userId!);
      return res.json({ match });
    } catch (err) { return res.status(500).json({ error: (err as Error).message }); }
  })
);

gameRouter.post('/pvp/complete', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await pvpService.completeMatch(req.body.matchId, req.body.winnerId);
      return res.json(result);
    } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  })
);

gameRouter.get('/pvp/rankings', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const limit = Number((req.query as any).limit) || 50;
  const rankings = await pvpService.getRankings(limit);
  return res.json({ rankings });
}));

gameRouter.get('/pvp/me', secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const rank = await pvpService.getMyRanking(req.userId!);
    return res.json({ ranking: rank });
  })
);

gameRouter.get('/pvp/history', secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const history = await pvpService.getMatchHistory(req.userId!);
    return res.json({ history });
  })
);

gameRouter.post('/pvp/cancel', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    await pvpService.cancelMatch(req.body.matchId, req.userId!);
    return res.json({ success: true });
  })
);

// ── Бесконечная Башня ────────────────────────────────────
gameRouter.get('/tower/progress', secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const progress = await endgameService.getProgress(req.userId!);
    return res.json({ progress });
  })
);

gameRouter.post('/tower/start', secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const progress = await endgameService.startRun(req.userId!);
    const floor = endgameService.getFloor(1);
    return res.json({ progress, floor });
  })
);

gameRouter.post('/tower/complete-floor', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await endgameService.completeFloor(req.userId!, req.body.floor, req.body.timeSeconds);
      const nextFloor = endgameService.getFloor(req.body.floor + 1);
      return res.json({ ...result, nextFloor });
    } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  })
);

gameRouter.get('/tower/floor/:num', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const floor = endgameService.getFloor(Number(req.params.num));
  return res.json({ floor });
}));

gameRouter.get('/tower/leaderboard', secureMiddleware, asyncHandler(async (_req: Request, res: Response) => {
  const lb = await endgameService.getLeaderboard();
  return res.json({ leaderboard: lb });
}));
