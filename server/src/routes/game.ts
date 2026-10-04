import { Router, Request, Response, NextFunction } from 'express';
import { secureMiddleware } from '../middleware/auth';
import { AuctionService, AuctionError } from '../services/AuctionService';
import { auctionRateLimiter, apiRateLimiter } from '../middleware/rateLimiter';
import { CraftingService } from '../services/CraftingService';
import { DailyTaskService } from '../services/DailyTaskService';
import { ChatModerationService } from '../services/ChatModerationService';
import { startPvpArena } from '../systems/PvpArenaFlow';
import { pvpArena } from '../systems/PvpArenaService';
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
// Награда за переход по рекламной ссылке. Ссылка собирается на
// идентификаторе игрока, золото выдаётся один раз на персонажа.
import { RewardService, linkFor, partnerConfigured, REWARD_GOLD } from '../services/RewardService';
import { CRAFTING_RECIPES } from '../data/crafting';
import { ITEMS_DATABASE } from '../data/items';
import { asyncHandler } from '../utils/asyncHandler';
import { AZENS_CONVERSION_RATES, AZENS_PACKS, PREMIUM_DURATIONS, FIRST_TOPUP_MULTIPLIER, FIRST_TOPUP_MAX_BONUS, EXCHANGE_PAIRS, getExchangePair, shopCurrencyToWallet } from '../utils/economy';
import { MOUNTS, MountSystem } from '../systems/MountSystem';
import { BoatSystem, BOATS } from '../systems/BoatSystem';
import { FishingSystem, FISH_TABLE } from '../systems/FishingSystem';
import { PetService } from '../services/PetService';
import { HousingService, HOUSE_TYPES, DECORATIONS } from '../services/HousingService';
import { PvPService } from '../services/PvPService';
import { EndGameService } from '../services/EndGameService';
import { PremiumSystem, CURRENT_SEASON, BATTLE_PASS_TIERS } from '../systems/PremiumSystem';
import { PaymentService } from '../services/PaymentService';
import { AuthService } from '../services/AuthService';
import { professionOf } from '../services/ProfessionService';
import { professionBonuses } from '../systems/ProfessionBonuses';
import { PromoService } from '../services/PromoService';
import { NotificationService } from '../services/NotificationService';
import { MailService } from '../services/MailService';
import { logger } from '../utils/logger';
import { PAYMENT_PROVIDERS, UNSIGNED_PROVIDERS } from '../services/paymentProviders';
import {
  createYooKassaPayment, fetchYooKassaPayment, isYooKassaEnabled, resolveYooKassaNotification,
} from '../services/payments/yookassa';
import {
  createXsollaPayment, isXsollaEnabled, resolveXsollaNotification, XSOLLA,
} from '../services/payments/xsolla';
import { xsollaSku } from '../services/payments/xsolla/token';
import Joi from 'joi';

export const gameRouter = Router();

/**
 * Схема тела POST /payments/topup.
 *
 * ПОЧЕМУ ОНА ВЫНЕСЕНА. Раз запрос проверяется прямо в маршруте, единственный
 * способ доказать, что он не отвергает собственные запросы клиента, - это
 * прогнать настоящую схему. Копия схемы в проверке ничего не доказывает: она
 * живёт своей жизнью и остаётся зелёной, когда настоящая поломана. Раньше
 * ровно это и произошло - поле provider было в клиенте, но не в схеме, и
 * каждый клик «Купить» отвечал 400.
 *
 * Поле provider обязано быть здесь: клиент шлёт его всегда (api.ts), а
 * схема без allowUnknown отбрасывает тело целиком. Значение берётся из
 * проверенного value, а не из req.body - иначе в маршрут проходит то, что
 * проверка не видела.
 */
export const topupSchema = Joi.object({
  characterId: Joi.string().uuid().required(),
  packId: Joi.string().max(32).optional(),
  realCurrency: Joi.string().valid(...Object.keys(AZENS_CONVERSION_RATES)).optional(),
  amount: Joi.number().positive().max(1000000).optional(),
  provider: Joi.string().trim().lowercase().max(32).optional(),
}).xor('packId', 'realCurrency').with('realCurrency', 'amount');

/** Провайдер по умолчанию, если клиент поле не прислал. */
/** Запасное имя, когда не настроен ни один провайдер. */
const ЗАПАСНОЙ_ПРОВАЙДЕР = 'yookassa';

/**
 * Провайдер по умолчанию - тот, который реально настроен на сервере.
 *
 * ПОЧЕМУ БОЛЬШЕ НЕ КОНСТАНТА. Раньше здесь стояло 'yookassa' жёстко, и
 * клиент дублировал то же самое у себя. В итоге покупка упиралась в
 * «провайдер не настроен», хотя настроен был другой - Xsolla. Схема
 * принимала поле, маршрут его читал, а толку не было: имя провайдера было
 * прописано в двух местах и разъехалось с реальностью.
 *
 * Теперь клиент имя не присылает, а решение принимает сервер по своим
 * ключам. Порядок: сначала Xsolla, потом ЮKassa, а если не настроен
 * ничего - возвращается запасное имя, и маршрут честно отвечает «провайдер
 * не настроен».
 */
export function выборПровайдера(env: NodeJS.ProcessEnv = process.env): string {
  if (isXsollaEnabled(env)) return XSOLLA;
  if (isYooKassaEnabled()) return 'yookassa';
  return ЗАПАСНОЙ_ПРОВАЙДЕР;
}

/**
 * Куда провайдер возвращает игрока после оплаты.
 *
 * Адрес берётся из настройки PUBLIC_URL, а не из заголовка запроса: игрок
 * может прийти с чужого домена, и тогда возврат ушёл бы туда, куда он не
 * собирался. Провайдеру отдаётся наш paymentId — по нему страница чека
 * понимает, какой платёж проверять.
 */
function paymentReturnUrl(req: Request, paymentId: string): string {
  const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host') ?? ''}`).replace(/\/+$/, '');
  return `${base}/game/?payment=${encodeURIComponent(paymentId)}`;
}

/**
 * Страна игрока для Xsolla: ISO 3166-1 alpha-2.
 *
 * ПОЧЕМУ ИЗ ЗАГОЛОВКА, А НЕ ИЗ ПРОФИЛЯ. Страны в игре нет - её нигде не
 * спрашивают, и заводить поле ради одного платежа незачем. Заголовок Xsolla
 * для этого и существует: страна определяется по адресу, из которого пришёл
 * запрос. Xsolla принимает и то, и другое, но адрес известен всегда.
 *
 * Если страна не определилась, возвращается null, и createXsollaPayment
 * откажется создавать счёт: лучше «платёж не создан» игроку, чем витрина с
 * ценой не в той валюте.
 */
function paymentCountry(req: Request): string | null {
  const заголовок = req.header('x-solla-country') ?? req.header('cf-ipcountry') ?? '';
  const код = заголовок.trim();
  // Только две латинские буквы: значение из заголовка не доверяем, оно
  // приходит извне и может содержать что угодно.
  return /^[A-Za-z]{2}$/.test(код) ? код.toUpperCase() : null;
}

// Создаём сервисы лениво-локально там, где нужны
import { QuestService } from '../services/QuestService';
import { REDIS_CHANNELS } from '../../../shared/constants';
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
// Для вебхука Xsolla user_validation: он спрашивает, существует ли игрок.
const authService = new AuthService();
const promoService = new PromoService();
const notificationService = new NotificationService();
const mailService = MailService.getInstance();
const mountSystem = new MountSystem();
const boatSystem = new BoatSystem();
const fishing = FishingSystem.getInstance();
const petService = new PetService();
const housingService = new HousingService();
const chatModeration = ChatModerationService.getInstance();
const pvpService = new PvPService();
const endgameService = new EndGameService();
const dailyTasks = new DailyTaskService();

// ============================================================
// Защита: персонаж в запросе должен принадлежать авторизованному
// пользователю. Без этого любой игрок мог тратить золото чужого
// персонажа (покупка на аукционе, депозит в гильдию и т.д.).
// ============================================================
const requireCharacterOwnership = (field = 'characterId') =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Тело или строка запроса: GET-маршруты (?characterId=) и POST-маршруты
    // (JSON-тело) ходят через одну и ту же проверку. Раньше читалось только
    // тело — и пять GET-маршрутов отвечали 400 «Missing characterId», пока
    // идентификатор лежал в query.
    const raw = req.body?.[field] ?? req.query?.[field];
    const characterId = Array.isArray(raw) ? raw[0] : raw;
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

/**
 * Идентификатор персонажа из тела запроса или из строки запроса.
 *
 * Службы ищут по character_id, а req.userId — это идентификатор АККАУНТА.
 * Эта ошибка повторилась уже шесть раз (задачи дня, репутация, конюшня,
 * башня, гильдии, питомцы), и каждая выглядела как «панель пустая».
 * requireCharacterOwnership проверяет принадлежность, но кладёт проверку
 * внутрь middleware; GET-маршрутам она недоступна, поэтому идентификатор
 * достаётся здесь — и уже проверенным.
 */
const bodyCharacterId = async (req: Request, res: Response): Promise<string | null> => {
  const characterId = String(req.body?.characterId ?? req.query?.characterId ?? '');
  if (!characterId) {
    res.status(400).json({ error: 'characterId is required' });
    return null;
  }
  const character = await characterService.getCharacterById(characterId);
  if (!character || character.userId !== req.userId) {
    res.status(403).json({ error: 'Character does not belong to you' });
    return null;
  }
  return characterId;
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

// Ограничение частоты на выставление лотов и покупку. Пресет на 20 в минуту
// был написан, но не подключён: покупка лота пишет в базу и двигает золото
// нескольких сторон, и без ограничения ею можно было нагрузить базу
gameRouter.post('/auction/list', auctionRateLimiter, secureMiddleware, requireCharacterOwnership(),
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
      // Отказ с кодом переводится на клиенте, сумма идёт числом. Раньше сюда
      // попадала строка по-английски и игрок читал её как есть.
      if (err instanceof AuctionError) {
        return res.status(400).json({ error: err.code, ...err.params });
      }
      return res.status(400).json({ error: (err as Error).message });
    }
  })
);

gameRouter.post('/auction/:listingId/buy', auctionRateLimiter, secureMiddleware, requireCharacterOwnership(),
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

// Мои лоты.
//
// Раньше маршрута не было, а AuctionService.getSellerListings был написан и
// не вызывался: игрок не видел, что именно он выставил, и не мог снять лот.
// api.auctionCancel на клиенте тоже существовал и не звался — кнопки «Снять
// лот» в панели не было.
gameRouter.get('/auction/mine', secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = String(req.query.characterId ?? '');
    if (!characterId) return res.status(400).json({ error: 'characterId is required' });
    const character = await characterService.getCharacterById(characterId);
    if (!character || character.userId !== req.userId) {
      return res.status(403).json({ error: 'Character does not belong to you' });
    }
    const listings = await auctionService.getSellerListings(characterId);
    return res.json({
      listings: listings.map(l => ({
        id: l.id,
        itemId: l.itemId,
        nameRu: ITEMS_DATABASE[l.itemId]?.nameRu ?? l.itemId,
        quantity: l.quantity,
        price: l.price,
        sold: !!l.soldAt,
        // Просроченный лот ещё можно снять — предмет вернётся в сумку
        canCancel: !l.soldAt,
        expiresAt: l.expiresAt,
        createdAt: l.createdAt,
      })),
    });
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

    // Скидка профессии «Торговец». Раньше описание обещало «скидка 10% на все
    // покупки», и цена считалась ровно как в каталоге: обещание было пустым
    // текстом. Скидка не опускает цену ниже половины, иначе на высоких
    // уровнях покупка стала бы бесплатной.
    //
    // Округление вниз: цена должна быть целой, а округление вверх при скидке
    // в 1% на дешёвом товаре означало бы «скидку» ценой в золото.
    const prof = await professionOf(value.characterId);
    const priceMult = professionBonuses(prof?.id ?? null, prof?.level ?? 0).price;
    const totalCost = Math.max(1, Math.floor(entry.price * value.quantity * priceMult));
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
    // Лодки — тоже не предмет сумки: у них свой каталог и своя таблица
    if (entry.kind === 'boat' || value.itemId.startsWith('boat_')) {
      const def = BOATS[value.itemId];
      if (!def) return res.status(400).json({ error: 'Boat definition not found' });
      // Лодка одна, а цена считается как price * quantity. С quantity = 3
      // игрок отдавал бы три цены и получал одну лодку: переплата без
      // пользы. Раньше это проходило молча, потому что ветка лодок идёт
      // мимо обычных товаров и количество там никто не проверял.
      if (value.quantity > 1) {
        return res.status(400).json({ error: 'Лодка покупается по одной' });
      }
      let boat;
      try {
        boat = await boatSystem.purchase(value.characterId, value.itemId);
      } catch (err) {
        // Деньги списаны на общей ветке выше — возвращаем, иначе игрок
        // теряет их на «уже куплено» и «нужен уровень».
        //
        // Возврат идёт в той же валюте, в которой шла оплата. Возврат
        // золотом за азены превращал бы покупку в обмен валюты: сейчас все
        // лодки за золото и расхождения не видно, но стоит положить лодку
        // в премиальный магазин - и игрок получит золото за азены.
        await characterService.refund(value.characterId, walletCurrency, totalCost).catch(() => {});
        return res.status(400).json({ error: (err as Error).message });
      }
      return res.status(201).json({
        success: true, itemId: value.itemId, boat,
        gold, azens, silver, syrian,
        goldSpent: walletCurrency === 'gold' ? totalCost : 0,
      });
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
    // Продажа лута NPC-лавке - тоже доход, поэтому сезонный бонус к золоту
    // её касается. А вот возврат за неудачную покупку выше остался на
    // addGold: возврат не должен ни выплачиваться, ни выплачиваться больше.
    const gold = await characterService.addGoldReward(value.characterId, totalGain);
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
    const { error, value } = topupSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const character = await characterService.getCharacterById(value.characterId);
    if (!character) return res.status(404).json({ error: 'Character not found' });

    try {
      const payment = await paymentService.createTopup(
        character.userId,
        value.characterId,
        value.packId ? { packId: value.packId } : { realCurrency: value.realCurrency, amount: value.amount }
      );

      // Счёт у провайдера. Без этого pending-запись осталась бы навсегда
      // «ожидающей», и игрок ушёл бы со страницы без способа заплатить.
      //
      // Если провайдер не настроен, платёж всё равно создан и вернётся его
      // id: он понадобится, когда ключи появятся. Молча возвращать ошибку
      // «провайдер недоступен» значило бы, что игрок даже не сможет узнать,
      // что его заказ ушёл.
      // Из проверенного value, а не из req.body. Схема приводит регистр и
      // обрезает пробелы; сырое тело этим свойствам не обязано.
      // Поле provider остаётся в схеме: старый клиент его присылает, и его
      // надо принять, а не отвергнуть. Но приоритет у сервера: без поля
      // выборПровайдера смотрит на свои ключи, а не на клиентское имя.
      const provider = String(value.provider ?? выборПровайдера());
      let checkoutUrl: string | null = null;
      let providerError: string | null = null;

      if (provider === 'yookassa') {
        if (!isYooKassaEnabled()) {
          providerError = 'provider_not_configured';
        } else {
          try {
            const invoice = await createYooKassaPayment({
              paymentId: payment.id,
              amount: payment.realAmount.toFixed(2),
              currency: payment.realCurrency.toUpperCase(),
              description: `Empire of Safavids — ${value.packId ?? 'AZENS'}`,
              returnUrl: paymentReturnUrl(req, payment.id),
              confirmUrl: paymentReturnUrl(req, payment.id),
              idempotenceKey: `${payment.id}`,
            }, process.env);
            checkoutUrl = invoice.confirmation?.confirmation_url ?? null;
            // id счёта сохраняем сразу: без него возврат после отмены и
            // разбирательства с поддержкой упираются в «платёжа не найдено»
            if (invoice.id) await paymentService.attachProviderPaymentId(payment.id, invoice.id);
          } catch (err) {
            logger.error(`[Payments] yookassa create failed for ${payment.id}: ${(err as Error).message}`);
            providerError = 'provider_request_failed';
          }
        }
      } else if (provider === XSOLLA) {
        if (!isXsollaEnabled()) {
          providerError = 'provider_not_configured';
        } else {
          try {
            // Набор становится товаром в каталоге Xsolla: SKU собирается из
            // нашего packId. Сумма не передаётся - её берёт каталог, и это
            // цена живёт в ДВУХ местах сразу (economy.ts и каталог). Расхождение
            // ловится в вебхуке сверкой суммы, а не молчанием здесь.
            const sku = xsollaSku(value.packId ?? 'rub_m');
            const invoice = await createXsollaPayment({
              paymentId: payment.id,
              userId: character.userId,
              sku,
              quantity: 1,
              returnUrl: paymentReturnUrl(req, payment.id),
              // Страны у персонажа нет: в игре её не спрашивают. Без неё
              // Xsolla не определяет валюту и покажет цену не в той, а
              // поле country формально обязательное - витрина не откроется.
              country: paymentCountry(req),
              // Страну знаем не всегда, а Xsolla просит страну ЛИБО адрес.
              // req.ip - это ровно тот адрес, с которого пришёл запрос, и он
              // есть всегда. Без него запрос уходил без страны и получал
              // 422 «user.country.value or the header X-User-Ip must be
              // specified» - витрина не открывалась.
              userIp: req.ip,
              language: 'ru',
            }, process.env);
            checkoutUrl = invoice.checkoutUrl;
            // order_id Xsolla пригодится при разбирательствах, а наш
            // payment_id уже записан в заказ как external_id.
            if (invoice.orderId) await paymentService.attachProviderPaymentId(payment.id, invoice.orderId);
            providerError = invoice.providerError;
          } catch (err) {
            logger.error(`[Payments] xsolla create failed for ${payment.id}: ${(err as Error).message}`);
            providerError = 'provider_request_failed';
          }
        }
      } else {
        providerError = 'unknown_provider';
      }

      // ПОЧЕМУ ЛОГ. providerError уходит клиенту только как «не удалось
      // открыть страницу оплаты», и по логам было не видно, ЧТО именно сломалось:
      // в журнале оставался только 201 без тела. Из-за этой слепой зоны поиск
      // причины занял несколько заходов. Теперь причина пишется в лог всегда,
      // когда счёт не создан, - молча пропадать ей нельзя.
      if (providerError) {
        logger.error(`[Payments] ${provider} nedal schet dlya ${payment.id}: ${providerError}`);
      }

      return res.status(201).json({
        success: true,
        paymentId: payment.id,
        status: payment.status,
        packId: payment.packId,
        azensExpected: payment.azensExpected,
        realCurrency: payment.realCurrency,
        realAmount: payment.realAmount,
        // Куда игрок идёт платить. null означает «счёт не создан», а не
        // «оплачено»: клиент обязан показать это честно, а не закрыть окно.
        checkoutUrl,
        providerError,
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

// POST /api/game/payments/webhook/yookassa — уведомление ЮKassa.
//
// ГЛАВНОЕ ОТЛИЧИЕ ОТ ВЕБХУКА С ПОДПИСЬЮ. Тело уведомления здесь — только
// повод задать вопрос. Из него берётся идентификатор платежа, и сервер
// переспрашивает у API ЮKassa, каким платёж на самом деле стал. Начисление
// идёт по ответу API.
//
// Почему так: подписи у ЮKassa нет, а маршрут публичен. Если бы мы поверили
// телу уведомления, достаточно было бы одного POST с
// { event: 'payment.succeeded', object: { id: 'любой' } }, чтобы напечатать
// себе AZENS. Одного переспроса достаточно: платежа с выдуманным id у
// ЮKassa не существует, и запрос вернёт 404.
//
// Уведомления приходят чаще, чем платёж меняет состояние: ЮKassa шлёт
// payment.succeeded и по факту оплаты, и по захвату, а иногда повторно.
// Повторы не приводят к двойному начислению — completePayment дедуплицирует
// по provider_payment_id.
//
// Решение принимает resolveYooKassaNotification, а не этот маршрут: правило
// «начислить только по ответу API» проверяется там настоящим запуском. Здесь
// маршрут лишь превращает результат в код ответа, и потому короткий.
gameRouter.post('/payments/webhook/yookassa', asyncHandler(async (req: Request, res: Response) => {
  if (!isYooKassaEnabled()) {
    // Не 500: без ключей это не сбой, а штатное состояние. ЮKassa будет
    // повторять уведомление, и на все попытки ответ одинаковый.
    return res.status(503).json({ error: 'provider_not_configured' });
  }

  const decision = await resolveYooKassaNotification(
    req.body,
    async (id) => {
      try {
        return await fetchYooKassaPayment(id, process.env);
      } catch (err) {
        if ((err as Error).message === 'yookassa_payment_not_found') return null;
        throw err;
      }
    },
    async (id) => (await paymentService.findByProviderPaymentId('yookassa', id))?.id ?? null
  );

  if (decision.action === 'retry') {
    // 5xx, а не 200: так ЮKassa повторит уведомление, и деньги доедут при
    // следующей попытке вместо тихой потери.
    logger.error(`[Payments] yookassa ${decision.reason}`);
    return res.status(502).json({ error: 'provider_unreachable' });
  }
  if (decision.action === 'reject') {
    logger.warn(`[Payments] yookassa rejected notification: ${decision.reason}`);
    return res.status(400).json({ error: decision.reason });
  }
  if (decision.action === 'ignore' || !decision.event) {
    // Платёж ещё не решён. Не ошибка и не отказ: начислять нечего, и начисление
    // придёт, когда статус сменится.
    return res.json({ success: true, applied: false, status: decision.remoteStatus });
  }

  const event = decision.event;
  const result = event.kind === 'refunded'
    ? await paymentService.reversePayment({
        provider: 'yookassa', providerPaymentId: event.providerPaymentId,
        paymentId: event.paymentId, reason: event.failReason,
      })
    : await paymentService.completePayment({
        provider: 'yookassa', providerPaymentId: event.providerPaymentId,
        paymentId: event.paymentId, succeed: event.kind === 'completed', failReason: event.failReason,
      });

  if (!result.ok) return res.status(400).json({ error: result.code });
  return res.json({ success: true, applied: true, deduped: result.deduped ?? false, azens: result.azens });
}));

// POST /api/game/payments/webhook/xsolla — вебхуки Xsolla.
//
// ОТДЕЛЬНЫЙ МАРШРУТ, А НЕ ОБЩИЙ /webhook/:provider, потому что у Xsolla
// три вебхука с разными ответами, и один из них вообще не про оплату:
// user_validation спрашивает, существует ли игрок, и обязан ответить 204.
// Общий реестр умеет только разобрать тело и начислить.
//
// КОДЫ ОТВЕТОВ ЗДЕСЬ — ЭТО ДЕНЬГИ, А НЕ СТИЛЬ. Правило Xsolla: ответ 4xx,
// отсутствие ответа или 5xx означает ВОЗВРАТ ПЛАТЕЖА ПОКУПАТЕЛЮ. Поэтому
//   204 — приняли (order_paid начислено, user_validation подтверждён);
//   400 — подделка или заказ не наш: повторять нечего;
//   500 — наша ошибка или провайдер выключен: Xsolla повторит (20 попыток).
// Путать второй и третий местами нельзя ни в ту, ни в другую сторону.
gameRouter.post('/payments/webhook/xsolla', asyncHandler(async (req: Request, res: Response) => {
  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? '';
  const decision = await resolveXsollaNotification({
    // Именно сырое тело. Подпись по пересобранному JSON не сойдётся, и это
    // выглядит как «секрет неверный».
    rawBody,
    signatureHeader: req.header('authorization'),
    body: req.body,
    userExists: (id) => authService.userExists(id),
    findPayment: async (id) => {
      const payment = await paymentService.getPayment(id);
      if (!payment) return null;
      return {
        id: payment.id,
        realAmount: payment.realAmount,
        realCurrency: payment.realCurrency,
      };
    },
  }, process.env);

  switch (decision.action) {
    case 'ack':
    case 'confirm-user':
      // 204 без тела. Xsolla считает это успехом.
      return res.status(204).end();
    case 'reject':
      logger.warn(`[Payments] xsolla rejected: ${decision.reason}`);
      return res.status(400).json({ error: decision.reason });
    case 'retry':
      logger.error(`[Payments] xsolla retry: ${decision.reason}`);
      return res.status(500).json({ error: decision.reason });
    default:
      break;
  }

  const order = decision.order;
  const payment = decision.payment;
  if (!order || !payment || order.transactionId === null) {
    // Решение «начислить» без номера транзакции означало бы начисление без
    // ключа дедупликации: повторный вебхок начислил бы дважды.
    logger.error('[Payments] xsolla credit without transaction id');
    return res.status(500).json({ error: 'no_transaction_id' });
  }

  // Расхождение суммы не отменяет начисление: мы обещали азены за свою цену.
  // Но молчать об этом нельзя - цена живёт в economy.ts и в каталоге Xsolla,
  // и если они разошлись, это надо видеть в логах, а не узнавать от игрока.
  if (decision.amountMismatch) {
    logger.error(
      `[Payments] xsolla amount mismatch for ${payment.id}: Xsolla ${order.amount} ${order.currency},`
      + ` ours ${payment.realAmount} ${payment.realCurrency}`,
    );
  }

  const result = decision.action === 'reverse'
    ? await paymentService.reversePayment({
        provider: XSOLLA,
        providerPaymentId: order.transactionId,
        paymentId: payment.id,
        reason: 'xsolla_order_canceled',
      })
    : await paymentService.completePayment({
        provider: XSOLLA,
        providerPaymentId: order.transactionId,
        paymentId: payment.id,
        succeed: true,
      });

  if (!result.ok) {
    // Начисление не прошло. 5xx, а не 400: платёж настоящий, и Xsolla
    // повторит вебхук, а не вернёт деньги.
    logger.error(`[Payments] xsolla apply failed: ${result.code}`);
    return res.status(500).json({ error: result.code });
  }
  return res.json({
    success: true,
    applied: true,
    deduped: result.deduped ?? false,
    azens: result.azens,
    bonus: result.bonus ?? 0,
  });
}));

// POST /api/game/payments/webhook/:provider — подтверждение провайдера (без auth, по HMAC).
// Тело: { paymentId, providerPaymentId, status: 'completed' | 'failed', failReason? }
// Подпись: HMAC-SHA256 hex от сырого тела, заголовок x-payment-signature, секрет PAYMENT_WEBHOOK_SECRET.
gameRouter.post('/payments/webhook/:provider', asyncHandler(async (req: Request, res: Response) => {
  const name = req.params.provider.toLowerCase();
  // ЮKassa не подписывает уведомления, и доверять присланному нельзя. Если бы
  // он попал в общий реестр, один POST нарисовал бы AZENS без оплаты: маршрут
  // выше переспрашивает API, а этот по подписи.
  if (UNSIGNED_PROVIDERS.includes(name)) {
    return res.status(400).json({ error: 'provider_requires_api_verification' });
  }
  // Xsolla обслуживается выше, отдельным маршрутом. Попав сюда, он попал бы
  // в разбор тела по общему контракту, где user_validation выглядит как
  // платёж и был бы начислен.
  if (name === XSOLLA) {
    return res.status(400).json({ error: 'provider_has_dedicated_webhook_route' });
  }
  const provider = PAYMENT_PROVIDERS[name];
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

// POST /api/game/dungeons/invite — позвать друга в заход
// { characterId, friendUserId }. Отправить может только лидер своего захода.
gameRouter.post(
  '/dungeons/invite',
  secureMiddleware,
  requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await dungeonService.inviteToRun(
      req.body.characterId,
      req.body.friendUserId,
    );
    if (!result.ok) {
      res.status(400).json({ error: result.code });
      return;
    }
    // Уведомление идёт через существующий персональный канал: подписка
    // раздаёт его игроку через activePlayers. Отдельный канал не заводился.
    await redis
      .publish(REDIS_CHANNELS.PLAYER_NOTIFICATION, {
        characterId: result.inviteeCharacterId,
        type: 'dungeon_invite',
        inviteId: result.inviteId,
      })
      .catch((e: unknown) => {
        logger.warn('[Dungeon] приглашение создано, но уведомление не ушло:', (e as Error).message);
      });
    res.json({ inviteId: result.inviteId });
  })
);

// POST /api/game/dungeons/invite/:inviteId/answer — согласиться или отказаться
gameRouter.post(
  '/dungeons/invite/:inviteId/answer',
  secureMiddleware,
  requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await dungeonService.answerInvite(
      req.body.characterId,
      req.params.inviteId,
      req.body.accept !== false,
    );
    if (!result.ok) {
      res.status(400).json({ error: result.code });
      return;
    }
    res.json({ joined: result.joined });
  })
);

// GET /api/game/dungeons/chests — сундуки моего захода. Клиент рисует их по
// этому списку, поэтому картинка и игра показывают одну и ту же точку.
gameRouter.get(
  '/dungeons/chests',
  secureMiddleware,
  requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    res.json({ chests: dungeonService.listChests(characterId) });
  })
);

// POST /api/game/dungeons/chests/:chestId/open — вскрыть сундук.
// Координаты идут в запрос, чтобы сервер отказал, если игрок далеко: добыча
// выдаётся по идентификатору из сессии, а не по присланным координатам.
gameRouter.post('/dungeons/chests/:chestId/open', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    const x = Number(req.body?.x);
    const z = Number(req.body?.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return res.status(400).json({ error: 'chest_bad_position' });
    }
    const result = await dungeonService.openChest(characterId, req.params.chestId, { x, z });
    if (!result.ok) return res.status(400).json({ error: result.code });
    res.json({ gold: result.gold, experience: result.experience });
  })
);
// GET /api/game/dungeons/:dungeonId/records — рекорды прохождений
gameRouter.get(
  '/dungeons/:dungeonId/records',
  secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const сколько = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
    res.json({ records: await dungeonService.dungeonRecords(req.params.dungeonId, сколько) });
  })
);

// GET /api/game/dungeons/:dungeonId/sessions — открытые заходы, к которым
// можно присоединиться. Без этого кнопка «вступить» не знает, к кому идти.
gameRouter.get(
  '/dungeons/:dungeonId/sessions',
  secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ sessions: dungeonService.listOpenSessions(req.params.dungeonId) });
  })
);

// POST /api/game/dungeons/:dungeonId/join — присоединиться к чужому
// заходу { characterId, sessionId }
gameRouter.post('/dungeons/:dungeonId/join', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await dungeonService.join(req.body.characterId, req.body.sessionId);
    if (!result.ok) return res.status(400).json({ error: result.code });
    res.json({ sessionId: result.session.id, attemptsLeft: result.attemptsLeft });
  })
);
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
        // Сколько попыток осталось. Без этого игрок видит, что кнопка
        // перестала работать, и не понимает почему: «вход запрещён» без
        // числа выглядит как поломка, а «осталось 0 до завтра» — как правило
        attemptsLeft: result.attemptsLeft,
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
    if (!session) {
      // Попытки отдаём даже без активной сессии: именно когда игрок стоит
      // вне данжа, ему и нужно знать, сколько раз ещё можно войти. Без этого
      // кнопка «Войти» просто перестаёт работать, и выглядит поломкой, а не
      // правилом игры
      const available = await Promise.all(
        Object.keys(DUNGEONS_DATABASE).map(async (id) =>
          [id, await dungeonService.attemptsLeft(req.body.characterId, id)] as const)
      );
      return res.json({ active: false, attempts: Object.fromEntries(available) });
    }
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

// GET /api/game/trade/contracts — список маршрутов + состояние своего каравана
gameRouter.get('/trade/contracts', secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = String(req.query.characterId ?? '');
    // Показываем караван только своего персонажа — иначе можно было бы
    // подсмотреть чужой маршрут по id
    const mine = characterId
      ? await characterService.getCharacterById(characterId).catch(() => null)
      : null;
    const active = mine && mine.userId === req.userId
      ? await tradeService.getActive(characterId).catch(() => null)
      : null;
    return res.json({
      contracts: tradeService.listForClient(),
      active,
      serverTime: Date.now(),
    });
  })
);

// GET /api/game/reward-link — ссылка перехода с идентификатором игрока
// Зачем маршрут, а не ссылка в HTML. Страница сайта статическая, и
// подставить в неё идентификатор игрока нечем: раньше там стоял
// буквальный «?userid=PLAYER_ID», и все игроки уходили к партнёру с одним
// и тем же sub-id. Такой поток партнёр считает невалидным.
gameRouter.get('/reward-link', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    if (!partnerConfigured()) {
      return res.status(503).json({ success: false, error: 'reward_link_not_configured' });
    }
    const characterId = String(req.query.characterId ?? '');
    const rewards = new RewardService();
    return res.json({
      url: linkFor(characterId),
      gold: REWARD_GOLD,
      // Панель гасит кнопку сразу, а не после неудачной попытки.
      alreadyClaimed: await rewards.hasClaimed(characterId),
    });
  }));

// POST /api/game/reward-claim — забрать награду
//
// Выдача происходит по нажатию кнопки, без подтверждения от партнёрской
// сети. Честное следствие: игрок может нажать и не перейти по ссылке, и
// золото всё равно получит. Защита есть только от повторной выдачи - один
// раз на персонажа, и проверяет её база, а не код.
gameRouter.post('/reward-claim', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = String(req.body?.characterId ?? '');
    const итог = await new RewardService().claim(characterId);
    if (!итог.ok) {
      // 409, а не 200 с нулем: игрок должен отличать «уже получено» от
      // «начислено».
      return res.status(409).json({ success: false, error: итог.code });
    }
    return res.json({ success: true, gold: итог.gold });
  }));

// POST /api/game/trade/accept — принять контракт { characterId, contractId }
gameRouter.post('/trade/accept', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const contractId = req.body?.contractId;
    if (!contractId) return res.status(400).json({ error: 'Missing contractId' });
    const result = await tradeService.accept(req.body.characterId, contractId);
    if (!result.ok) return res.status(400).json({ error: result.code });
    return res.status(201).json({ success: true, contract: result.contract, active: result.active });
  })
);

// POST /api/game/trade/deliver — доставить груз (нужно быть в городе назначения) { characterId }
gameRouter.post('/trade/deliver', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await tradeService.deliver(req.body.characterId);
    if (!result.ok) return res.status(400).json({ error: result.code });
    // Задача дня «Торговый День». Раньше висела вечно 0/3
    await dailyTasks.updateProgress(req.body.characterId, 'trade', 'any').catch(() => {});
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
// GET /api/game/crafting/skills — уровень крафта по профессиям
//
// В данных шесть профессий, и уровень теперь свой у каждой. Раньше был
// один общий: кузнечный опыт открывал рецепты ювелира, и панель об
// этом не говорила — просто показывала «Закрыто».
// GET /api/game/crafting/jobs — что сейчас в работе.
//
// Маршрут появился вместе с защитой от второго крафта. Без него клиент знал
// о своём задании только из localStorage: очистка данных сайта или другое
// устройство делали задание невидимым навсегда — материалы списаны, предмет
// не выдан, забрать его было нечем.
gameRouter.get('/crafting/jobs', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const characterId = await bodyCharacterId(req, res);
  if (!characterId) return;
  const jobs = await craftingService.getActiveJobs(characterId);
  return res.json({ jobs });
}));

gameRouter.get('/crafting/skills', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const characterId = await bodyCharacterId(req, res);
  if (!characterId) return;
  const levels = await craftingService.skillLevels(characterId);
  return res.json({ levels });
}));

gameRouter.post('/crafting/:jobId/complete', secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await craftingService.completeCrafting(req.params.jobId);
      // Крафченые предметы могут закрыть collect-цели квестов
      const characterId = (req.body ?? {}).characterId;
      const questsCompleted = characterId ? await questEvaluate(String(characterId)) : [];
      // Задача дня «Мастерская Мастера». Раньше висела вечно 0/5
      if (characterId) {
        await dailyTasks.updateProgress(String(characterId), 'craft', 'any').catch(() => {});
      }
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

// Предметы на склад гильдии.
//
// ЧТО БЫЛО. GuildService.depositItem был единственным писателем в таблицу
// guild_bank во всём репозитории — и не вызывался нигде. Маршрут /deposit
// вызывал depositGold, у которого похожее имя, и это легко принять за
// рабочую связку. Панель склада показывала пустоту, а работала только кнопка
// вклада золота.
gameRouter.post('/guilds/:guildId/deposit-item', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const { itemId, qty } = req.body as { itemId?: string; qty?: number };
    if (!itemId) return res.status(400).json({ error: 'itemId is required' });
    try {
      await guildService.depositItem(req.params.guildId, req.body.characterId, itemId, Number(qty ?? 1));
      return res.json({ success: true });
    } catch (err) {
      const code = (err as Error).message;
      if (code === 'ITEM_NOT_ENOUGH') return res.status(400).json({ error: 'ITEM_NOT_ENOUGH' });
      if (code === 'NOT_A_MEMBER') return res.status(403).json({ error: 'NOT_A_MEMBER' });
      throw err;
    }
  })
);

gameRouter.post('/guilds/:guildId/withdraw-item', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const bankId = Number(req.body.bankId);
    if (!Number.isInteger(bankId) || bankId <= 0) return res.status(400).json({ error: 'bankId is required' });
    try {
      await guildService.withdrawItem(req.params.guildId, req.body.characterId, bankId, Number(req.body.qty ?? 1));
      return res.json({ success: true });
    } catch (err) {
      const code = (err as Error).message;
      if (code === 'BANK_NOT_ENOUGH' || code === 'BANK_ROW_NOT_FOUND') {
        return res.status(400).json({ error: code });
      }
      if (code === 'NOT_A_MEMBER') return res.status(403).json({ error: 'NOT_A_MEMBER' });
      throw err;
    }
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
    // Карма идёт в фильтр: без неё личный квест либо виден святому, либо
    // отклоняется только при попытке взять. И то и другое — ошибка.
    const карма = await characterService.getKarma(char.id);
    // Выполненные квесты — тоже обязательный аргумент фильтра. Раньше здесь
    // стоял пустой массив, и это ломало две вещи сразу: выполненные обычные
    // квесты оставались в списке навсегда, а любой квест с предыдущими
    // (prerequisites) не показывался никогда - ведь отсутствующий в пустом
    // списке предыдущий квест означает «не выполнен».
    const состояние = await questService.getState(char.id);
    const выполненные = состояние.filter((с) => с.status === 'completed').map((с) => с.questId);
    quests = getAvailableQuests(char.level, выполненные, char.class, карма);
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

// ============================================================
// ЛОДКИ И РЫБАЛКА
// ============================================================
// Лодка снимает замедление воды и открывает глубоководный улов.
// Рыбалка: заброс → ждём поклёвку → подсекаем вовремя. Время реакции
// считает сервер, поэтому «мгновенную» подсечку подделать нельзя.

gameRouter.get('/boats', secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = String(req.query.characterId ?? '');
    const mine = characterId
      ? await characterService.getCharacterById(characterId).catch(() => null)
      : null;
    if (!mine || mine.userId !== req.userId) {
      return res.status(403).json({ error: 'Character does not belong to you' });
    }
    const boats = await boatSystem.getCharacterBoats(characterId);
    return res.json({ boats, catalog: BOATS, serverTime: Date.now() });
  })
);

gameRouter.post('/boats/activate', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const { characterId, boatId, position } = req.body;
    if (!characterId || !boatId) return res.status(400).json({ error: 'characterId and boatId required' });
    try {
      const def = await boatSystem.activate(characterId, boatId, position);
      return res.json({ success: true, boat: def });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  })
);

gameRouter.post('/boats/deactivate', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const { characterId } = req.body;
    if (!characterId) return res.status(400).json({ error: 'characterId required' });
    await boatSystem.deactivate(characterId);
    return res.json({ success: true });
  })
);

/** Забросить удочку. Позицию берём из тела запроса и проверяем на сервере */
gameRouter.post('/fishing/cast', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const { characterId, position } = req.body;
    if (!characterId) return res.status(400).json({ error: 'characterId required' });
    const result = await fishing.cast(characterId, position);
    if (!result.ok) {
      return res.status(400).json({ error: result.code, cast: result.cast, messageRu: result.messageRu });
    }
    return res.json({ success: true, cast: result.cast, serverTime: Date.now() });
  })
);

/** Подсечь. Реакция считается по серверным часам, не по клиентским */
gameRouter.post('/fishing/reel', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const { characterId, castId } = req.body;
    if (!characterId || !castId) return res.status(400).json({ error: 'characterId and castId required' });
    const result = await fishing.reel(characterId, castId);
    if (!result.ok) {
      return res.status(400).json({ error: result.code, cast: result.cast, messageRu: result.messageRu });
    }
    const questsDone = await questEvaluate(characterId);
    return res.json({
      success: true, cast: result.cast, fish: result.fish,
      experience: result.experience, gold: result.gold,
      messageRu: result.messageRu, questsCompleted: questsDone, serverTime: Date.now(),
    });
  })
);

gameRouter.post('/fishing/cancel', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const { characterId, castId } = req.body;
    if (!characterId) return res.status(400).json({ error: 'characterId required' });
    return res.json({ success: fishing.cancel(characterId, castId) });
  })
);

/** Состояние рыбалки: активный заброс + каталог рыбы для панели */
gameRouter.get('/fishing/state', secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = String(req.query.characterId ?? '');
    const mine = characterId
      ? await characterService.getCharacterById(characterId).catch(() => null)
      : null;
    if (!mine || mine.userId !== req.userId) {
      return res.status(403).json({ error: 'Character does not belong to you' });
    }
    const boatRow = await boatSystem.getActiveBoat(characterId);
    return res.json({
      cast: fishing.getActiveCast(characterId),
      boat: boatRow ? BOATS[boatRow.boatId] ?? null : null,
      boatFatigue: boatRow?.fatigue ?? 0,
      fish: FISH_TABLE,
      serverTime: Date.now(),
    });
  })
);

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
    // Скорость и названия считает сервер: у клиента была своя копия таблицы
    // скакунов на три записи из шести, и половина описаний не показывалась
    const mounts = await mountSystem.listForPlayer(characterId);
    return res.json({ mounts });
  })
);

// ── Питомцы ──────────────────────────────────────────────
// ШЕСТОЕ повторение той же поломки. Маршруты отдавали сервису req.userId —
// идентификатор АККАУНТА, а PetService ищет по character_pets.character_id.
// Это разные числа, поэтому питомцев не было видно никогда: getPets всегда
// возвращала пустой список, а renamePet и releasePet меняли строку под чужим
// идентификатором — то есть не ту. Заодно это объясняет, почему «переименовать
// и отпустить» выглядело как неподключённая кнопка: кнопок не было, а если бы
// были — молчали бы.
gameRouter.get('/pets', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    const list = await petService.getPets(characterId);
    res.json({ pets: list, allDefs: petService.getAllDefs() });
  })
);

gameRouter.get('/pets/active', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    const pet = await petService.getActivePet(characterId);
    res.json({ pet });
  })
);

gameRouter.post('/pets/acquire', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    try {
      const pet = await petService.acquirePet(characterId, req.body.petId);
      return res.json({ success: true, pet });
    } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  })
);

gameRouter.post('/pets/activate', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    try {
      await petService.setActive(characterId, req.body.petDbId);
      return res.json({ success: true });
    } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  })
);

gameRouter.post('/pets/rename', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    const nickname = String(req.body.nickname ?? '').trim();
    if (!nickname) return res.status(400).json({ error: 'nickname is required' });
    await petService.renamePet(characterId, req.body.petDbId, nickname);
    return res.json({ success: true });
  })
);

gameRouter.post('/pets/release', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    await petService.releasePet(characterId, req.body.petDbId);
    return res.json({ success: true });
  })
);

// ── Почтовый ящик ─────────────────────────────────────────
// Таблица mailbox создана миграцией 002 и была пуста. Награды выдавались
// напрямую, из чего следовало: продавец аукциона не мог получить вещь,
// если она не помещалась в сумку, и забрать её позже было нечем — просто
// терялась. Теперь такие награды кладутся в письмо.
gameRouter.get('/mail', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const characterId = await bodyCharacterId(req, res);
  if (!characterId) return;
  const [items, unread] = await Promise.all([
    mailService.list(characterId),
    mailService.unreadCount(characterId),
  ]);
  return res.json({ items, unread });
}));

gameRouter.post('/mail/claim', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    try {
      const reward = await mailService.claim(req.body.id, characterId);
      return res.json({ success: true, ...reward });
    } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  })
);

gameRouter.post('/mail/read', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    const ok = await mailService.markRead(req.body.id, characterId);
    if (!ok) return res.status(404).json({ error: 'Письмо не найдено' });
    return res.json({ success: true });
  })
);

// ── Уведомления ──────────────────────────────────────────
// ЧТО БЫЛО. NotificationService писал строки в таблицу notifications (лот
// продан, новое письмо, мировой босс), и getUnread/markAllRead были написаны и
// не вызывались нигде. Панели уведомлений в игре не существовало, а тост
// исчезал через пару секунд. Возвращаться к списку было некуда.
//
// Персонаж обязателен: notifications.character_id — это персонаж, а не аккаунт.
gameRouter.get('/notifications', secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    const [items, unread] = await Promise.all([
      notificationService.list(characterId),
      notificationService.getUnreadCount(characterId),
    ]);
    return res.json({ items, unread });
  })
);

gameRouter.post('/notifications/read-all', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    await notificationService.markAllRead(characterId);
    return res.json({ success: true });
  })
);

gameRouter.post('/notifications/read', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    const ok = await notificationService.markRead(characterId, req.body.id);
    if (!ok) return res.status(404).json({ error: 'Notification not found' });
    return res.json({ success: true });
  })
);

// ── Недвижимость ─────────────────────────────────────────
// СЕДЬМОЕ повторение той же поломки: HousingService ищет по
// player_houses.character_id, а маршруты передавали req.userId. Дом не
// показывался никогда, а placeDecoration менял строку под чужим
// идентификатором — то есть не ту.
const HOUSE_TYPES_SIMPLE = Object.entries(HOUSE_TYPES).map(([k, v]) => ({ id: k, ...v }));
const DECORATIONS_SIMPLE = Object.entries(DECORATIONS).map(([k, v]) => ({ id: k, ...v }));

// ============================================================
// POST /api/game/report — жалоба на игрока
// ============================================================
//
// Жалоба нужна была с самого начала и была невозможна: игрок не мог
// ни на кого пожаловаться, а модератор — узнать. Отправку ограничиваем
// пятью жалобами в час внутри сервиса, иначе форму использовали бы для
// забивания базы.
//
// characterId проверяется на принадлежность игроку: иначе можно было бы
// жаловаться от чужого персонажа и подставлять чужие жалобы.
gameRouter.post('/report', secureMiddleware, apiRateLimiter, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    const reportedId = String(req.body?.reportedId ?? '');
    if (!reportedId) {
      return res.status(400).json({ success: false, error: 'reportedId is required' });
    }
    const result = await chatModeration.fileReport(
      characterId,
      reportedId,
      String(req.body?.reason ?? 'other'),
      String(req.body?.detail ?? '').slice(0, 500),
    );
    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error });
    }
    return res.json({ success: true });
  })
);

gameRouter.get('/house', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    const house = await housingService.getHouse(characterId);
    const decorations = house ? await housingService.getDecorations(characterId) : [];
    return res.json({
      house,
      playerDecorations: decorations,
      houseTypes: HOUSE_TYPES_SIMPLE,
      allDecorations: DECORATIONS_SIMPLE,
    });
  })
);

gameRouter.post('/house/buy', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    try {
      const house = await housingService.buyHouse(characterId, req.body.region, req.body.houseType);
      return res.json({ success: true, house });
    } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  })
);

gameRouter.post('/house/upgrade', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    try {
      const house = await housingService.upgradeHouse(characterId);
      return res.json({ success: true, house });
    } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  })
);

gameRouter.post('/house/decorate', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    try {
      await housingService.placeDecoration(characterId, req.body.decorationId);
      return res.json({ success: true });
    } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  })
);

// ── PvP Арена ────────────────────────────────────────────
// ТУТ БЫЛА ОШИБКА: findMatch ждёт character_id, а передавали user_id.
// Матчмейкинг не мог найти соперника и падал на внешнем ключе — PvP был
// мёртв с момента написания, а кнопка «Найти бой» молча ничего не делала.
gameRouter.post('/pvp/find-match', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = req.body.characterId;
    try {
      const match = await pvpService.findMatch(characterId);
      if (!match) {
        return res.json({ match: null, searching: true, message: 'Ищем соперника' });
      }
      // Соперник найден — сервер поднимает арену и будит обоих.
      // Раньше второй игрок не узнавал о матче вообще: он лежал в таблице
      // и ждал, пока кто-нибудь посмотрит.
      startPvpArena(match.id, characterId);
      const arena = pvpArena.arenaOf(characterId);
      return res.json({
        match,
        searching: false,
        // Соперник ещё не подтвердил готовность — клиент ждёт pvp:match_found
        arena: arena ? { endsAt: arena.endsAt, opponent: pvpArena.opponentOf(characterId) } : null,
      });
    } catch (err) { return res.status(500).json({ error: (err as Error).message }); }
  })
);

// ТУТ БЫЛА ДЫРА: winnerId приходил из тела запроса и не проверялся.
// Теперь исход подтверждают оба игрока, а сервер сверяет, что вызывающий
// — участник матча, иначе можно было бы накрутить рейтинг себе и снять
// его с чужого персонажа.
gameRouter.post('/pvp/complete', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const matchId = Number(req.body.matchId);
    const claimedWinnerId = String(req.body.winnerId ?? '');
    if (!Number.isFinite(matchId) || !claimedWinnerId) {
      return res.status(400).json({ error: 'matchId and winnerId are required' });
    }
    try {
      const result = await pvpService.reportResult(matchId, req.body.characterId, claimedWinnerId);
      // Задача дня «Боец Арены» засчитывается только реальной победе,
      // а не тем, что игрок назвал себя победителем
      if (result.status === 'settled' && result.winnerId) {
        await dailyTasks.updateProgress(result.winnerId, 'pvp_win', 'any').catch(() => {});
      }
      return res.json(result);
    } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  })
);

// GET /api/game/pvp/matches/:id/status — закрылся матч или ждёт второго
// Нужен клиенту, чтобы показать «ожидаем подтверждения соперника».
gameRouter.get('/pvp/matches/:id/status', secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const matchId = Number(req.params.id);
    if (!Number.isFinite(matchId)) return res.status(400).json({ error: 'bad id' });
    try {
      return res.json(await pvpService.getMatchStatus(matchId));
    } catch (err) { return res.status(400).json({ error: (err as Error).message }); }
  })
);

gameRouter.get('/pvp/rankings', secureMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const limit = Number((req.query as any).limit) || 50;
  const rankings = await pvpService.getRankings(limit);
  return res.json({ rankings });
}));

// ВОСЬМОЕ повторение. PvPService ищет по pvp_rankings.character_id и
// pvp_arena.player1_id, а маршруты передавали req.userId. Свой рейтинг и своя
// история матчей показывали пустоту у каждого, кто играл.
// А отмена поиска не работала по той же причине: UPDATE шёл по нулю строк, и
// матч оставался в состоянии 'waiting' — то есть «Найти бой» нельзя было
// отменить вообще.
gameRouter.get('/pvp/me', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    const rank = await pvpService.getMyRanking(characterId);
    return res.json({ ranking: rank });
  })
);

gameRouter.get('/pvp/history', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    const history = await pvpService.getMatchHistory(characterId);
    return res.json({ history });
  })
);

gameRouter.post('/pvp/cancel', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await bodyCharacterId(req, res);
    if (!characterId) return;
    await pvpService.cancelMatch(req.body.matchId, characterId);
    return res.json({ success: true });
  })
);

// ── Бесконечная Башня ────────────────────────────────────
// ТУТ БЫЛА ТА ЖЕ ОШИБКА, ЧТО И В РЕПУТАЦИИ, ЗАДАЧАХ ДНЯ И КОНЮШНЕ.
// Маршруты отдавали сервису req.userId — идентификатор АККАУНТА, а таблица
// endless_tower keyed по character_id. Это разные числа, поэтому прогресс
// башни не читался никогда: getProgress всегда возвращала пустую заглушку
// (max_floor: 0), а completeFloor писала строку под идентификатором аккаунта
// — в рейтинге башни такой персонаж не появлялся никогда.
//
// Плюс кнопка «Пройти этаж» в клиенте отсутствовала: api.towerCompleteFloor и
// api.towerFloor были написаны и не вызывались ни разу, поэтому пройти этаж
// было нечем, а max_floor оставался нулём навсегда.
const towerCharacterId = async (req: Request, res: Response): Promise<string | null> => {
  const characterId = String((req.body as Record<string, unknown>)?.characterId ?? req.query.characterId ?? '');
  if (!characterId) {
    res.status(400).json({ error: 'characterId is required' });
    return null;
  }
  const character = await characterService.getCharacterById(characterId);
  if (!character || character.userId !== req.userId) {
    res.status(403).json({ error: 'Character does not belong to you' });
    return null;
  }
  return characterId;
};

gameRouter.get('/tower/progress', secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await towerCharacterId(req, res);
    if (!characterId) return;
    const progress = await endgameService.getProgress(characterId);
    return res.json({ progress, floor: endgameService.getFloor(progress.current_floor) });
  })
);

gameRouter.post('/tower/start', secureMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = await towerCharacterId(req, res);
    if (!characterId) return;
    const progress = await endgameService.startRun(characterId);
    const floor = endgameService.getFloor(1);
    return res.json({ progress, floor });
  })
);

gameRouter.post('/tower/complete-floor', secureMiddleware, requireCharacterOwnership(),
  asyncHandler(async (req: Request, res: Response) => {
    const characterId = String(req.body.characterId);
    const floor = Number(req.body.floor);
    const timeSeconds = Number(req.body.timeSeconds);
    if (!Number.isInteger(floor) || floor < 1) return res.status(400).json({ error: 'floor must be a positive integer' });
    if (!Number.isFinite(timeSeconds) || timeSeconds <= 0) return res.status(400).json({ error: 'timeSeconds must be positive' });
    try {
      const result = await endgameService.completeFloor(characterId, floor, timeSeconds);
      const nextFloor = endgameService.getFloor(floor + 1);
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
