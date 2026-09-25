// ============================================================
// Ekonomika — Empire of Safavids: AZENS, Isfahan silver, Syrian gold
// ============================================================
// AZENS: premium currency, topped up with real money (rates below),
// spent in the premium shop and on the battle pass.
// isfahanSilver / syrianGold: FREE currencies from quests, trade and
// events. They are never sold for real money.

// Conversion table: realAmount of real money -> azensAmount of AZENS.
export const AZENS_CONVERSION_RATES: Record<string, { realAmount: number; azensAmount: number }> = {
  rub: { realAmount: 100, azensAmount: 25 },
  man: { realAmount: 500, azensAmount: 250 },
  uah: { realAmount: 1000, azensAmount: 220 },
  usd: { realAmount: 5, azensAmount: 110 },
  eur: { realAmount: 5, azensAmount: 110 },
};

export type RealCurrency = keyof typeof AZENS_CONVERSION_RATES;

/** How many AZENS a real-money amount buys (only whole rate steps count). */
export function getAzensForRealMoney(realCurrency: string, amount: number): number {
  const rate = AZENS_CONVERSION_RATES[realCurrency.toLowerCase()];
  if (!rate || !Number.isFinite(amount) || amount <= 0) return 0;
  return rate.azensAmount * Math.floor(amount / rate.realAmount);
}

/** Split a payment into credited AZENS + leftover real money. */
export function convertRealToAzens(realCurrency: string, amount: number): { azens: number; realSpent: number; remaining: number } {
  const key = realCurrency.toLowerCase();
  const rate = AZENS_CONVERSION_RATES[key];
  const azens = getAzensForRealMoney(key, amount);
  if (!rate || azens <= 0) return { azens: 0, realSpent: 0, remaining: amount };
  const steps = Math.floor(amount / rate.realAmount);
  const realSpent = rate.realAmount * steps;
  return { azens, realSpent, remaining: amount - realSpent };
}

/** Shop "premium" currency is paid with AZENS; silver/syrian shops with free currencies. */
export type WalletCurrency = 'gold' | 'azens' | 'silver' | 'syrian';

export function shopCurrencyToWallet(currency: string): WalletCurrency {
  if (currency === 'premium') return 'azens';
  if (currency === 'silver') return 'silver';
  if (currency === 'syrian') return 'syrian';
  return 'gold';
}

/** Starter wallet for new characters. */
export function initialWallet(): { azens: number; isfahanSilver: number; syrianGold: number } {
  return { azens: 0, isfahanSilver: 0, syrianGold: 0 };
}

// ============================================================
// AZENS packs: fixed bundles with volume bonus (convert better
// than free amounts). packId is stored on the payment row.
// ============================================================
export interface AzensPack {
  id: string;
  realCurrency: string;
  realAmount: number;
  /** Total AZENS credited (base + bonus already included). */
  azens: number;
  /** Bonus percent over the base rate, for display. */
  bonusPct: number;
  tagRu?: string;
}

export const AZENS_PACKS: AzensPack[] = [
  { id: 'rub_s', realCurrency: 'rub', realAmount: 100, azens: 25, bonusPct: 0 },
  { id: 'rub_m', realCurrency: 'rub', realAmount: 500, azens: 140, bonusPct: 12, tagRu: 'Выгодно' },
  { id: 'rub_l', realCurrency: 'rub', realAmount: 1000, azens: 300, bonusPct: 20, tagRu: 'Хит' },
  { id: 'man_s', realCurrency: 'man', realAmount: 500, azens: 250, bonusPct: 0 },
  { id: 'man_m', realCurrency: 'man', realAmount: 1000, azens: 550, bonusPct: 10, tagRu: 'Выгодно' },
  { id: 'man_l', realCurrency: 'man', realAmount: 2000, azens: 1200, bonusPct: 20, tagRu: 'Хит' },
  { id: 'uah_s', realCurrency: 'uah', realAmount: 1000, azens: 220, bonusPct: 0 },
  { id: 'uah_m', realCurrency: 'uah', realAmount: 2000, azens: 480, bonusPct: 9, tagRu: 'Выгодно' },
  { id: 'uah_l', realCurrency: 'uah', realAmount: 5000, azens: 1300, bonusPct: 18, tagRu: 'Хит' },
  { id: 'usd_s', realCurrency: 'usd', realAmount: 5, azens: 110, bonusPct: 0 },
  { id: 'usd_m', realCurrency: 'usd', realAmount: 20, azens: 480, bonusPct: 9, tagRu: 'Выгодно' },
  { id: 'usd_l', realCurrency: 'usd', realAmount: 50, azens: 1300, bonusPct: 18, tagRu: 'Хит' },
  { id: 'eur_s', realCurrency: 'eur', realAmount: 5, azens: 110, bonusPct: 0 },
  { id: 'eur_m', realCurrency: 'eur', realAmount: 20, azens: 480, bonusPct: 9, tagRu: 'Выгодно' },
  { id: 'eur_l', realCurrency: 'eur', realAmount: 50, azens: 1300, bonusPct: 18, tagRu: 'Хит' },
];

export function getPack(packId: string): AzensPack | undefined {
  return AZENS_PACKS.find(p => p.id === packId);
}

// ============================================================
// First-purchase bonus: x2 AZENS on the first completed payment
// per user, capped so a huge first top-up cannot mint millions.
// ============================================================
export const FIRST_TOPUP_MULTIPLIER = 2;
export const FIRST_TOPUP_MAX_BONUS = 300;

// ============================================================
// Premium account for AZENS: duration in days -> price.
// ============================================================
export const PREMIUM_DURATIONS: { days: number; priceAzens: number }[] = [
  { days: 7, priceAzens: 150 },
  { days: 30, priceAzens: 500 },
];

// ============================================================
// Antifraud caps: per user, per calendar day (UTC).
// ============================================================
export const DAILY_TOPUP_MAX_AZENS = 5000;
export const DAILY_TOPUP_MAX_COUNT = 10;

// ============================================================
// Обменник свободных валют: курс уже включает комиссию.
// ============================================================
export type ExchangeCurrency = 'gold' | 'silver' | 'syrian';

export interface ExchangePair {
  id: string;
  from: ExchangeCurrency;
  to: ExchangeCurrency;
  /** Сколько from отдать за одну операцию. */
  give: number;
  /** Сколько to получить (комиссия уже в курсе). */
  receive: number;
}

export const EXCHANGE_PAIRS: ExchangePair[] = [
  { id: 'silver_to_gold', from: 'silver', to: 'gold', give: 25, receive: 1 },
  { id: 'syrian_to_gold', from: 'syrian', to: 'gold', give: 5, receive: 1 },
  { id: 'gold_to_silver', from: 'gold', to: 'silver', give: 1, receive: 20 },
  { id: 'gold_to_syrian', from: 'gold', to: 'syrian', give: 50, receive: 1 },
  { id: 'silver_to_syrian', from: 'silver', to: 'syrian', give: 100, receive: 1 },
];

export function getExchangePair(pairId: string): ExchangePair | undefined {
  return EXCHANGE_PAIRS.find(p => p.id === pairId);
}

/** Плата за выставление лота на аукцион — в исфаханском серебре. */
export const AUCTION_LISTING_FEE_SILVER = 10;
