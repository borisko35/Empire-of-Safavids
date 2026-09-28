// ============================================================
// REST-клиент — Empire of Safavids
// ============================================================

import { Character, RegionInfo, QuestDef, SkillDef } from './state';

/** Привязанный способ входа в том виде, как его отдаёт сервер */
export interface LinkedAccountInfo {
  method: 'password' | 'google' | 'facebook';
  label: string;
  email?: string | undefined;
  /** Можно ли отвязать. Сервер запрещает отвязать последний способ */
  canDetach: boolean;
  lockedReason?: string | undefined;
}

/** Шаг туториала в том виде, как его отдаёт сервер */
export interface TutorialStepApi {
  id: number;
  title: string;
  titleRu: string;
  description: string;
  descriptionRu: string;
  action: string;
  /** Идентификатор цели: NPC, предмет или монстр */
  target?: string;
  /** Сколько раз нужно повторить действие */
  count?: number;
  hint: string;
  hintRu: string;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

/** Реплика NPC с вариантами ответа */
export interface NpcLine {
  id: string;
  textRu: string;
  choices?: NpcChoice[];
}

export interface NpcChoice {
  labelRu: string;
  nextId: string;
  action?: string;
  questId?: string;
  itemId?: string;
}

export interface CompletedQuest {
  questId: string;
  titleRu: string;
  experience: number;
  gold: number;
}

/** Сюжетная сцена. Приходит вместе с ответом диалога, если квест сработал */
export interface StoryCutscene {
  id: string;
  title: string;
  titleRu: string;
  chapterId: string;
  backdrop: string;
  lines: { speaker: string; speakerName: string; text: string; textRu: string; delay?: number }[];
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('eos_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { message?: string; error?: string; code?: string };
    // Код ошибки: явный code либо одиночный токен в error («username_taken»)
    const code = b.code
      ?? (b.error && !b.error.includes(' ') ? b.error : undefined);
    throw new ApiError(b.message ?? b.error ?? `HTTP ${res.status}`, res.status, code);
  }
  return body as T;
}

export interface AuthData {
  token: string;
  jwtToken: string;
  userId: string;
  username: string;
}

export interface ActiveBuff {
  id: string;
  nameRu: string;
  icon: string;
  stat: string;
  magnitude: number;
  remainingSec: number;
}

export interface ResourcesState {
  hp: number; maxHp: number;
  mana: number; maxMana: number;
  stamina: number; maxStamina: number;
  /** Временный бонус, если предмет его даёт (кебаб, свиток учёного) */
  buff?: ActiveBuff | null;
}

export interface EquipmentState {
  items: { slot: string; itemId: string; nameRu: string; rarity: string; enhancement: number }[];
  stats: Record<string, number>;
  /** Специальные бонусы вне характеристик: вода (сапоги/плащ) */
  bonuses?: { waterSpeed: number; swimStamina: number };
}

export const api = {
  register: (body: {
    username: string; email: string; password: string; confirmPassword: string;
    agreeToTerms: boolean; agreeToPrivacy: boolean; birthYear: number;
  }) => req<{ data: AuthData }>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),

  login: (email: string, password: string) =>
    req<{ data: AuthData }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  logout: () => req<unknown>('/api/auth/logout', { method: 'POST' }),

  /** Вход без регистрации: создаёт гостевой аккаунт и сразу выдаёт сессию */
  guestLogin: () =>
    req<{ data: AuthData }>('/api/auth/guest', { method: 'POST' }),

  /** Какие внешние входы настроены на сервере (только публичные client_id) */
  oauthConfig: () =>
    req<{ success: boolean; data: { providers: { provider: string; clientId: string | null; authorizeUrl: string }[] } }>('/api/auth/oauth/config'),

  /** Начать внешний вход: сервер выдаёт одноразовый state и адрес перехода */
  oauthStart: (provider: string) =>
    req<{ data: { provider: string; state: string; authorizeUrl: string } }>('/api/auth/oauth/start', {
      method: 'POST',
      body: JSON.stringify({ provider }),
    }),

  /** Завершить внешний вход: код от провайдера меняется на сессию */
  oauthCallback: (provider: string, code: string, state: string) =>
    req<{ data: AuthData & { linked?: boolean; isNew?: boolean } }>('/api/auth/oauth/callback', {
      method: 'POST',
      body: JSON.stringify({ provider, code, state }),
    }),

  /** Присвоение гостевого аккаунта: задаёт почту и пароль, прогресс сохраняется */
  claimAccount: (email: string, password: string) =>
    req<{ success: boolean; message: string }>('/api/auth/claim', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  authMe: () =>
    req<{ success: boolean; data: { userId: string; username: string; email: string; isAdmin: boolean; adminRole: string; isGuest?: boolean } }>('/api/auth/me'),

  changePassword: (oldPass: string, newPass: string) =>
    req<{ success: boolean; message: string }>('/api/auth/change-password', {
      method: 'POST', body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass }),
    }),

  resetPassword: (email: string, newPassword: string) =>
    req<{ success: boolean; message: string }>('/api/auth/reset-password', {
      method: 'POST', body: JSON.stringify({ email, password: newPassword }),
    }),

  renameCharacter: (characterId: string, newName: string) =>
    req<{ success: boolean; character: any }>(`/api/characters/${characterId}/rename`, {
      method: 'POST', body: JSON.stringify({ name: newName }),
    }),

  getSkills: (characterId: string) =>
    req<{ skills: any[] }>(`/api/skills?characterId=${characterId}`),

  getAvailableSkills: (characterId: string, profession?: string) =>
    req<{ skills: any[] }>(`/api/skills/available?characterId=${characterId}${profession ? '&profession=' + profession : ''}`),

  learnSkill: (characterId: string, skillId: string) =>
    req<{ success: boolean; skill: any }>('/api/skills/learn', {
      method: 'POST', body: JSON.stringify({ characterId, skillId }),
    }),

  getProfession: (characterId: string) =>
    req<{ profession: any }>(`/api/skills/professions?characterId=${characterId}`),

  unlockProfession: (characterId: string, professionId: string) =>
    req<{ success: boolean; profession: any }>('/api/skills/professions/unlock', {
      method: 'POST', body: JSON.stringify({ characterId, professionId }),
    }),

  getProfessionSkills: (professionId: string) =>
    req<{ skills: any[] }>(`/api/skills/professions/${professionId}/skills`),

  adminSearch: (q: string) =>
    req<{ results: { id: string; name: string; class: string; level: number; region: string; user_id: string; email: string; is_banned: boolean }[] }>(`/api/admin/search?q=${encodeURIComponent(q)}`),

  adminMute: (characterId: string, durationMinutes: number, reason: string) =>
    req<{ success: boolean }>('/api/admin/mute', {
      method: 'POST', body: JSON.stringify({ characterId, durationMinutes, reason }),
    }),

  adminBan: (userId: string, reason: string, durationDays?: number) =>
    req<{ success: boolean }>('/api/admin/ban', {
      method: 'POST', body: JSON.stringify({ userId, reason, durationDays }),
    }),

  adminUnban: (userId: string) =>
    req<{ success: boolean }>('/api/admin/unban', {
      method: 'POST', body: JSON.stringify({ userId }),
    }),

  adminTeleport: (characterId: string, position: { x: number; y: number; z: number }, region: string) =>
    req<{ success: boolean }>('/api/admin/teleport', {
      method: 'POST', body: JSON.stringify({ characterId, position, region }),
    }),

  adminWeather: (kind: string) =>
    req<{ success: boolean; weather: string }>('/api/admin/weather', {
      method: 'POST', body: JSON.stringify({ kind }),
    }),

  adminGiveGold: (characterId: string, amount: number) =>
    req<{ success: boolean }>('/api/admin/give-gold', {
      method: 'POST', body: JSON.stringify({ characterId, amount }),
    }),

  adminGrantCurrency: (characterId: string, currency: string, amount: number, reason: string) =>
    req<{ success: boolean; balance: number }>('/api/admin/grant-currency', {
      method: 'POST', body: JSON.stringify({ characterId, currency, amount, reason }),
    }),

  adminRefund: (paymentId: string, reason: string) =>
    req<{ success: boolean; deduped: boolean; azens?: number }>('/api/admin/refund', {
      method: 'POST', body: JSON.stringify({ paymentId, reason }),
    }),

  adminGrants: (limit = 50) =>
    req<{ grants: { id: string; admin_id: string; character_id: string; currency: string; amount: string; reason: string; created_at: string; character_name: string; admin_email: string }[] }>(`/api/admin/grants?limit=${limit}`),

  adminPayments: (limit = 50) =>
    req<{ payments: { id: string; user_id: string; character_id: string; real_currency: string; real_amount: string; azens_credited: string; status: string; created_at: string; character_name: string }[] }>(`/api/admin/payments?limit=${limit}`),

  adminFinance: () =>
    req<{ byStatus: { status: string; count: number; minted: string; bonus: string }[]; circulating: { azens: string; gold: string; silver: string; syrian: string; debtors: number }; promoGranted: { azens: string; silver: string; syrian: string; redemptions: number }; grants: { currency: string; count: number; total: string }[]; velocity: { user_id: string; completed_24h: number }[] }>('/api/admin/finance'),

  adminPromoCreate: (body: { code: string; azens?: number; silver?: number; syrian?: number; maxUses?: number; expiresAt?: string }) =>
    req<{ success: boolean; promo: { code: string } }>('/api/admin/promocodes', {
      method: 'POST', body: JSON.stringify(body),
    }),

  adminPromos: () =>
    req<{ promos: { code: string; azens: string; silver: number; syrian: number; maxUses: number; usedCount: number; expiresAt: string | null }[] }>('/api/admin/promocodes'),

  characters: () => req<{ characters: Character[] }>('/api/characters'),

  createCharacter: (name: string, characterClass: string, serverId: string, referralCode?: string) =>
    req<{ character: Character }>('/api/characters', {
      method: 'POST',
      body: JSON.stringify({
        name, class: characterClass, serverId,
        // Код приглашения необязателен: без него сервер просто ничего не начислит
        ...(referralCode ? { referralCode } : {}),
      }),
    }),

  // Мой код приглашения, ссылка для друга и сколько я пригласил
  referralInfo: () =>
    req<{ code: string; invited: number; earnedGold: number; link: string }>('/api/characters/referral'),

  // ── Привязка аккаунта ──────────────────────────────────────
  accountIdentities: () =>
    req<{ accounts: LinkedAccountInfo[]; total: number }>('/api/auth/identities'),

  accountAddEmail: (email: string, password: string) =>
    req<{ success: boolean }>('/api/auth/identities/email', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  accountUnlink: (provider: string) =>
    req<{ success: boolean }>(`/api/auth/identities/${provider}/unlink`, { method: 'POST' }),

  deleteCharacter: (characterId: string) =>
    req<{ success: boolean }>(`/api/characters/${characterId}`, { method: 'DELETE' }),

  gameServers: () =>
    req<{ servers: { id: string; nameRu: string; online: number; recommended?: boolean }[] }>('/api/game/servers'),

  skills: (characterId: string) => req<{ skills: SkillDef[] }>(`/api/characters/${characterId}/skills`),

  inventory: (characterId: string) =>
    req<{ items: { itemId: string; nameRu: string; rarity: string; quantity: number; type: string; enhancement: number }[] }>(`/api/characters/${characterId}/inventory`),

  equipment: (characterId: string) =>
    req<EquipmentState>(`/api/characters/${characterId}/equipment`),

  equip: (characterId: string, itemId: string) =>
    req<EquipmentState>(`/api/characters/${characterId}/equipment/equip`, {
      method: 'POST',
      body: JSON.stringify({ itemId }),
    }),

  unequip: (characterId: string, slot: string) =>
    req<EquipmentState>(`/api/characters/${characterId}/equipment/unequip`, {
      method: 'POST',
      body: JSON.stringify({ slot }),
    }),

  useItem: (characterId: string, itemId: string) =>
    req<{ success: boolean; resources: ResourcesState }>(`/api/characters/${characterId}/inventory/use`, {
      method: 'POST',
      body: JSON.stringify({ itemId }),
    }),

  /** Активные временные бонусы с остатком времени */
  buffs: (characterId: string) =>
    req<{ buffs: ActiveBuff[]; damageMultiplier: number; expMultiplier: number }>(
      `/api/characters/${characterId}/buffs`
    ),

  enhance: (characterId: string, itemId: string) =>
    req<{ result: string; newEnhancement: number; message: string; messageRu: string }>(
      `/api/characters/${characterId}/enhance`,
      { method: 'POST', body: JSON.stringify({ itemId }) },
    ),

  shops: () => req<{ shops: { id: string; nameRu: string; items: { itemId: string; nameRu: string; price: number; currency: string; minLevel?: number }[] }[] }>('/api/game/shops'),

  shopBuy: (shopId: string, characterId: string, itemId: string, currency: 'gold' | 'azens' | 'silver' | 'syrian' = 'gold', quantity = 1) =>
    req<{ success: boolean; itemId: string; quantity: number; goldSpent: number; azensSpent: number; silverSpent: number; syrianSpent: number; gold?: number; azens?: number; silver?: number; syrian?: number }>(
      `/api/game/shops/${shopId}/buy`,
      { method: 'POST', body: JSON.stringify({ characterId, itemId, currency, quantity }) },
    ),

  shopSell: (shopId: string, characterId: string, itemId: string, quantity = 1) =>
    req<{ success: boolean; goldGained: number; gold: number }>(
      `/api/game/shops/${shopId}/sell`,
      { method: 'POST', body: JSON.stringify({ characterId, itemId, quantity }) },
    ),

  dungeons: () => req<{ dungeons: { id: string; nameRu: string; minLevel: number; maxLevel: number; region: string; difficulty?: string }[] }>('/api/game/dungeons'),

  dungeonEnter: (dungeonId: string, characterId: string) =>
    req<{ session: { id: string; dungeonNameRu: string; monsterCount: number; bossCount: number } }>(
      `/api/game/dungeons/${dungeonId}/enter`,
      { method: 'POST', body: JSON.stringify({ characterId }) },
    ),

  dungeonLeave: (characterId: string) =>
    req<{ success: boolean }>('/api/game/dungeons/leave', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),

  dungeonStatus: (characterId: string) =>
    req<{ active: boolean; dungeonNameRu?: string; bossCount?: number; killedBossCount?: number }>(
      '/api/game/dungeons/status',
      { method: 'POST', body: JSON.stringify({ characterId }) },
    ),

  tradeContracts: (characterId: string) =>    req<{
      contracts: { id: string; nameRu: string; fromRegion: string; toRegion: string; cargoNameRu: string; cargoQty: number; rewardGold: number; rewardSilver?: number; rewardSyrian?: number; minLevel: number; travelMinutes: number }[];
      /** Свой караван: null если контракта нет */
      active: { contractId: string; startedAt: number; arrivesAt: number; status: 'transit' | 'arrived'; cargoReturned: boolean; cargoItemId: string; cargoQty: number } | null;
      /** Серверное время — по нему считаем таймер, а не по часам игрока */
      serverTime: number;
    }>(`/api/game/trade/contracts?characterId=${encodeURIComponent(characterId)}`),

  tradeAccept: (characterId: string, contractId: string) =>
    req<{ success: boolean }>('/api/game/trade/accept', {
      method: 'POST',
      body: JSON.stringify({ characterId, contractId }),
    }),

  tradeDeliver: (characterId: string) =>
    req<{ success: boolean; gold: number; exp: number; silver?: number; syrian?: number }>('/api/game/trade/deliver', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),

  paymentRates: () =>
    req<{ rates: Record<string, { realAmount: number; azensAmount: number }>; packs: { id: string; realCurrency: string; realAmount: number; azens: number; bonusPct: number; tagRu?: string }[]; firstBonus: { multiplier: number; maxBonus: number }; premiumDurations: { days: number; priceAzens: number }[]; simulator: boolean }>('/api/game/payments/rates'),

  paymentTopup: (characterId: string, input: { packId: string } | { realCurrency: string; amount: number }) =>
    req<{ success: boolean; paymentId: string; status: string; packId: string | null; azensExpected: number; realCurrency: string; realAmount: number }>('/api/game/payments/topup', {
      method: 'POST',
      body: JSON.stringify({ characterId, ...input }),
    }),

  paymentStatus: (paymentId: string) =>
    req<{ paymentId: string; status: string; azensExpected: number; bonus: number; realCurrency: string; realAmount: number }>(`/api/game/payments/${paymentId}`),

  paymentHistory: (characterId: string) =>
    req<{ payments: { paymentId: string; status: string; packId: string | null; azensExpected: number; bonus: number; realCurrency: string; realAmount: number; createdAt: string }[] }>(`/api/game/payments/mine?characterId=${characterId}`),

  paymentSimulate: (characterId: string, paymentId: string) =>
    req<{ success: boolean; deduped: boolean; azens?: number; bonus?: number }>('/api/game/payments/simulate', {
      method: 'POST',
      body: JSON.stringify({ characterId, paymentId }),
    }),

  wallet: (characterId: string) =>
    req<{ gold: number; azens: number; isfahanSilver: number; syrianGold: number; hasToppedUp: boolean }>('/api/game/wallet', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),

  premiumStatus: (characterId: string) =>
    req<{ active: boolean; benefits: { expMultiplier: number; goldMultiplier: number } | null; durations: { days: number; priceAzens: number }[] }>('/api/game/premium/status', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),

  premiumPurchase: (characterId: string, days: number) =>
    req<{ success: boolean; days: number; price: number; azens: number }>('/api/game/premium/purchase', {
      method: 'POST',
      body: JSON.stringify({ characterId, days }),
    }),

  promoRedeem: (characterId: string, code: string) =>
    req<{ success: boolean; reward: { azens: number; silver: number; syrian: number }; wallet: { azens: number; isfahanSilver: number; syrianGold: number } }>('/api/game/promo/redeem', {
      method: 'POST',
      body: JSON.stringify({ characterId, code }),
    }),

  exchangePairs: () =>
    req<{ pairs: { id: string; from: string; to: string; give: number; receive: number }[] }>('/api/game/exchange/pairs'),

  exchange: (characterId: string, pairId: string, times = 1) =>
    req<{ success: boolean; pair: string; times: number; wallet: { gold: number; silver: number; syrian: number } }>('/api/game/exchange', {
      method: 'POST',
      body: JSON.stringify({ characterId, pairId, times }),
    }),

  giftSend: (characterId: string, targetName: string, itemId: string, quantity = 1) =>
    req<{ success: boolean; target: string; itemId: string; quantity: number }>('/api/game/gifts/send', {
      method: 'POST',
      body: JSON.stringify({ characterId, targetName, itemId, quantity }),
    }),

  battlepassStatus: (characterId: string) =>
    req<{ season: { id: string; nameRu: string; premiumPrice: number }; tiers: { tier: number; requiredPoints: number; freeReward: { type: string; amount?: number; nameRu: string }; premiumReward: { type: string; amount?: number; nameRu: string } }[]; progress: { points: number; is_premium: boolean; claimed_tiers: number[] | string } | null }>('/api/game/battlepass/status', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),

  battlepassPurchase: (characterId: string) =>
    req<{ success: boolean; price: number; azens: number; season: string }>('/api/game/battlepass/purchase', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),

  battlepassClaim: (characterId: string, tier: number, premium: boolean) =>
    req<{ success: boolean; reward: { type: string; amount?: number; nameRu: string } }>('/api/game/battlepass/claim', {
      method: 'POST',
      body: JSON.stringify({ characterId, tier, premium }),
    }),

  tradeCancel: (characterId: string) =>
    req<{ success: boolean }>('/api/game/trade/cancel', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),

  // ── Лодки и рыбалка ─────────────────────────────────────────
  boats: (characterId: string) =>
    req<{
      boats: { boatId: string; isActive: boolean; totalCatches: number; fatigue: number }[];
      catalog: Record<string, {
        id: string; name: string; nameRu: string; waterSpeed: number; swimSpeed: number;
        fishingBonus: number; catchLimit: number; price: number; minLevel: number;
        rarity: string; descriptionRu: string;
      }>;
      serverTime: number;
    }>(`/api/game/boats?characterId=${encodeURIComponent(characterId)}`),

  boatActivate: (characterId: string, boatId: string, position: { x: number; z: number }) =>
    req<{ success: boolean; boat: { nameRu: string } }>('/api/game/boats/activate', {
      method: 'POST',
      body: JSON.stringify({ characterId, boatId, position }),
    }),

  boatDeactivate: (characterId: string) =>
    req<{ success: boolean }>('/api/game/boats/deactivate', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),

  fishingState: (characterId: string) =>
    req<{
      cast: { castId: string; phase: string; biteAt: number; waitTotalMs: number; deep: boolean; luck: number } | null;
      boat: { nameRu: string; catchLimit: number; fishingBonus: number } | null;
      boatFatigue: number;
      fish: { id: string; nameRu: string; rarity: string; weightKg: number; deepOnly?: boolean; minLevel: number }[];
      serverTime: number;
    }>(`/api/game/fishing/state?characterId=${encodeURIComponent(characterId)}`),

  fishingCast: (characterId: string, position: { x: number; z: number }) =>
    req<{ success: boolean; cast: { castId: string; biteAt: number; waitTotalMs: number }; serverTime: number }>(
      '/api/game/fishing/cast', { method: 'POST', body: JSON.stringify({ characterId, position }) }),

  fishingReel: (characterId: string, castId: string) =>
    req<{
      success: boolean;
      fish?: { itemId: string; nameRu: string; quantity: number; weightKg: number; rarity: string };
      experience?: number; gold?: number; messageRu?: string;
      cast?: { phase: string; fishNameRu?: string; weightKg?: number };
      serverTime: number;
    }>('/api/game/fishing/reel', { method: 'POST', body: JSON.stringify({ characterId, castId }) }),

  fishingCancel: (characterId: string, castId: string) =>
    req<{ success: boolean }>('/api/game/fishing/cancel', {
      method: 'POST', body: JSON.stringify({ characterId, castId }),
    }),

  /**
   * Уровень крафта по профессиям. Раньше был один общий, и панель
   * показывала «Закрыто», не объясняя, чего не хватает.
   */
  craftingSkills: (characterId: string) =>
    req<{ levels: Record<string, number> }>(`/api/game/crafting/skills?characterId=${characterId}`),

  craftingRecipes: () =>
    req<{ recipes: { id: string; nameRu: string; resultItemId: string; resultQuantity: number; craftingTime: number; requiredLevel: number; successRate: number; ingredients: { itemId: string; quantity: number }[] }[] }>(
      '/api/game/crafting/recipes',
    ),

  craftingStart: (characterId: string, recipeId: string) =>
    req<{ job: { id: string; recipeId: string; completesAt: string } }>('/api/game/crafting/start', {
      method: 'POST',
      body: JSON.stringify({ characterId, recipeId }),
    }),

  craftingComplete: (jobId: string, characterId: string) =>
    req<{ success: boolean; itemId: string; quantity: number }>(`/api/game/crafting/${jobId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),

  auctionSearch: (query: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
    const suffix = qs.toString() ? `?${qs}` : '';
    return req<{ listings: { id: string; itemId: string; quantity: number; enhancement: number; price: number; sellerId: string; expiresAt: string }[] }>(`/api/game/auction${suffix}`);
  },

  auctionList: (body: { characterId: string; itemId: string; quantity: number; enhancement?: number; price: number }) =>
    req<{ listing: { id: string } }>('/api/game/auction/list', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  auctionBuy: (listingId: string, characterId: string) =>
    req<{ success: boolean; message: string }>(`/api/game/auction/${listingId}/buy`, {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),

  auctionMine: (characterId: string) =>
    req<{ listings: { id: string; itemId: string; nameRu: string; quantity: number; price: number; sold: boolean; canCancel: boolean; expiresAt: string; createdAt: string }[] }>(
      `/api/game/auction/mine?characterId=${characterId}`),

  auctionCancel: (listingId: string, characterId: string) =>
    req<{ success: boolean }>(`/api/game/auction/${listingId}`, {
      method: 'DELETE',
      body: JSON.stringify({ characterId }),
    }),

  partyCreate: (characterId: string) =>
    req<{ party: { id: string; members: { characterId: string; role: string }[] } }>('/api/game/parties', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),

  partyInfo: (partyId: string) =>
    req<{ party: { id: string; members: { characterId: string; role: string }[]; maxSize: number } | null }>(`/api/game/parties/${partyId}`),

  partyLeave: (partyId: string, characterId: string) =>
    req<{ success: boolean }>(`/api/game/parties/${partyId}/leave`, {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),

  /**
   * Пригласить в группу.
   *
   * inviterId, а не characterId: так маршрут называет того, кто зовёт, и по
   * нему проверяется, что он вообще глава. Переименовывать поле на клиенте
   * незачем — сервер проверяет именно это имя.
   */
  partyInvite: (partyId: string, inviterId: string, targetId: string) =>
    req<{ success: boolean }>(`/api/game/parties/${partyId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ inviterId, targetId }),
    }),

  regions: () => req<{ regions: RegionInfo[] }>('/api/world/regions'),

  travel: (characterId: string, region: string) =>
    req<{ character: Character }>('/api/world/travel', {
      method: 'POST',
      body: JSON.stringify({ characterId, region }),
    }),

  quests: () => req<{ quests: QuestDef[] }>('/api/game/quests'),

  questState: (characterId: string) =>
    req<{ quests: { questId: string; status: string; progress: Record<string, number> }[] }>(
      `/api/characters/${characterId}/quests`,
    ),

  acceptQuest: (characterId: string, questId: string) =>
    req<{ success: boolean }>(`/api/characters/${characterId}/quests/${questId}/accept`, { method: 'POST' }),

  questExplore: (characterId: string, questId: string, objectiveId: string) =>
    req<{ success: boolean; completed: { questId: string; titleRu: string; experience: number; gold: number }[] }>(
      `/api/characters/${characterId}/quests/${questId}/explore`,
      { method: 'POST', body: JSON.stringify({ objectiveId }) },
    ),

  // ── Друзья ────────────────────────────────────────────────
  friends: () =>
    req<{ friends: { userId: string; friendId: string; friendName: string; status: string; online: boolean; level: number; region: string }[]; pending: { userId: string; friendName: string; level: number }[] }>('/api/friends'),

  friendRequest: (friendId: string) =>
    req<{ success: boolean }>('/api/friends/request', { method: 'POST', body: JSON.stringify({ friendId }) }),

  friendAccept: (friendId: string) =>
    req<{ success: boolean }>('/api/friends/accept', { method: 'POST', body: JSON.stringify({ friendId }) }),

  friendRemove: (friendId: string) =>
    req<{ success: boolean }>(`/api/friends/${friendId}`, { method: 'DELETE' }),

  friendBlock: (friendId: string) =>
    req<{ success: boolean }>('/api/friends/block', { method: 'POST', body: JSON.stringify({ friendId }) }),

  // ── Рейтинги ──────────────────────────────────────────────
  leaderboard: (type: string, limit = 20, offset = 0) =>
    req<{ entries: { rank: number; characterId: string; characterName: string; className: string; level: number; value: number; guild?: string }[]; total: number }>(
      `/api/leaderboard/${type}?limit=${limit}&offset=${offset}`,
    ),

  leaderboardMe: (type: string, characterId: string) =>
    req<{ rank: { rank: number; value: number } | null }>(`/api/leaderboard/${type}/me?characterId=${characterId}`),

  // ── Туториал ──────────────────────────────────────────────
  // target/count обязательны в типе: без них клиент молча получал шаг
  // без цели и без счётчика, и такой шаг было невозможно закрыть
  tutorialSteps: () =>
    req<{ steps: TutorialStepApi[]; totalSteps: number }>('/api/tutorial/steps'),

  tutorialProgress: (characterId: string) =>
    req<{ progress: { step: number; completed: boolean }; currentStep: TutorialStepApi | null; totalSteps: number }>(`/api/tutorial/${characterId}`),

  tutorialAdvance: (characterId: string) =>
    req<{ step: number; completed: boolean; tutorialStep: TutorialStepApi; totalSteps: number }>(`/api/tutorial/${characterId}/advance`, { method: 'POST' }),

  tutorialSkip: (characterId: string) =>
    req<{ success: boolean }>(`/api/tutorial/${characterId}/skip`, { method: 'POST' }),

  // ── Шахматы Шаха ──────────────────────────────────────────
  chessStart: (betGold: number) =>
    req<{ gameId: string; board: (string | null)[][]; turn: string; status: string; betGold: number }>(
      '/api/chess/start', { method: 'POST', body: JSON.stringify({ betGold }) },
    ),

  chessMove: (gameId: string, from: { row: number; col: number }, to: { row: number; col: number }) =>
    req<{ board: (string | null)[][]; turn: string; status: string; result?: { winner: string; goldWon: number; messageRu: string } }>(
      '/api/chess/move', { method: 'POST', body: JSON.stringify({ gameId, from, to }) },
    ),

  chessState: (gameId: string) =>
    req<{ board: (string | null)[][]; turn: string; status: string; moveCount: number; betGold: number }>(
      `/api/chess/state/${gameId}`,
    ),

  chessResign: (gameId: string) =>
    req<{ success: boolean }>('/api/chess/resign', { method: 'POST', body: JSON.stringify({ gameId }) }),

  // ── Стихи Хафиза ──────────────────────────────────────────
  poetryChallenges: () =>
    req<{ challenges: { id: string; title: string; titleRu: string; difficulty: string; lineCount: number; reward: { gold: number; experience: number } }[] }>(
      '/api/poetry/challenges',
    ),

  poetryStart: (difficulty?: string) =>
    req<{ gameId: string; challenge: { id: string; title: string; titleRu: string; difficulty: string; lineCount: number }; options: { text: string; textRu: string }[] }>(
      '/api/poetry/start', { method: 'POST', body: JSON.stringify({ difficulty }) },
    ),

  poetrySelect: (gameId: string, lineIndex: number) =>
    req<{ selectedCount: number; isComplete: boolean; isCorrect: boolean }>(
      '/api/poetry/select', { method: 'POST', body: JSON.stringify({ gameId, lineIndex }) },
    ),

  poetryUndo: (gameId: string) =>
    req<{ selectedCount: number }>('/api/poetry/undo', { method: 'POST', body: JSON.stringify({ gameId }) }),

  poetryQuit: (gameId: string) =>
    req<{ success: boolean }>('/api/poetry/quit', { method: 'POST', body: JSON.stringify({ gameId }) }),

  // ── Хроники Сефевидов ─────────────────────────────────────
  // ── Сюжет: главы и кат-сцены ──────────────────────────────
  storyState: (characterId: string) =>
    req<{
      chapters: {
        chapter: { id: string; order: number; title: string; titleRu: string; description: string; descriptionRu: string; region: string; minLevel: number };
        quests: { id: string; titleRu: string; status: 'completed' | 'active' | 'locked' }[];
        done: number; total: number; percent: number; unlocked: boolean; started: boolean;
        cutscenes: { id: string; titleRu: string; watched: boolean }[];
      }[];
      currentChapterId: string | null;
      totalDone: number;
      totalQuests: number;
      cutscenesTotal: number;
    }>(`/api/story/state?characterId=${encodeURIComponent(characterId)}`),

  storyTakeCutscene: (characterId: string, questId: string, trigger: 'accept' | 'complete') =>
    req<{ cutscene: unknown | null }>('/api/story/cutscene/take', {
      method: 'POST', body: JSON.stringify({ characterId, questId, trigger }),
    }),

  storyCutsceneSkipped: (characterId: string, cutsceneId: string) =>
    req<{ success: boolean }>('/api/story/cutscene/skipped', {
      method: 'POST', body: JSON.stringify({ characterId, cutsceneId }),
    }),

  chronicles: () =>
    req<{
      entries: {
        id: string; category: string; title: string; titleRu: string;
        content: string; contentRu: string; unlocked: boolean; unlockHintRu: string | null;
      }[];
      unlocked: number;
      total: number;
    }>(
      '/api/chronicles',
    ),

  chroniclesByCategory: (cat: string) =>
    req<{ entries: {
      id: string; category: string; title: string; titleRu: string;
      content: string; contentRu: string; unlocked: boolean; unlockHintRu: string | null;
    }[] }>(
      `/api/chronicles/category/${cat}`,
    ),

  // ── Фичи (для лендинга) ───────────────────────────────────
  features: () =>
    req<{ features: { icon: string; title: string; titleRu: string; desc: string; descRu: string }[] }>(
      '/api/features',
    ),

  // ── Гильдии ──────────────────────────────────────────────
  // Персонаж обязателен в каждом маршруте: сервер ищет по guild_members
  // .character_id, а не по аккаунту. Раньше он не передавался, и панель
  // показывала «вы не в гильдии» игроку, который в гильдии состоял.
  guildMy: (characterId: string) => req<{ guild: any; rank: string } | null>(`/api/guilds?characterId=${characterId}`),
  guildSearch: (q: string) => req<{ guilds: any[] }>(`/api/guilds/search?q=${encodeURIComponent(q)}`),
  guildCreate: (characterId: string, name: string, tag: string, description: string) =>
    req<{ success: boolean; guild: any }>('/api/guilds/create', { method: 'POST', body: JSON.stringify({ characterId, name, tag, description }) }),
  guildJoin: (characterId: string, guildId: string) =>
    req<{ success: boolean }>('/api/guilds/join', { method: 'POST', body: JSON.stringify({ characterId, guildId }) }),
  guildLeave: (characterId: string) =>
    req<{ success: boolean }>('/api/guilds/leave', { method: 'POST', body: JSON.stringify({ characterId }) }),
  guildMembers: (characterId: string) => req<{ members: any[] }>(`/api/guilds/members?characterId=${characterId}`),
  guildRank: (actorId: string, targetId: string, rank: string) =>
    req<{ success: boolean }>('/api/guilds/rank', { method: 'POST', body: JSON.stringify({ characterId: actorId, targetId, rank }) }),
  guildDepositGold: (characterId: string, amount: number) =>
    req<{ success: boolean }>('/api/guilds/deposit-gold', { method: 'POST', body: JSON.stringify({ characterId, amount }) }),
  guildDepositItem: (characterId: string, itemId: string, qty = 1) =>
    req<{ success: boolean }>('/api/guilds/deposit-item', { method: 'POST', body: JSON.stringify({ characterId, itemId, qty }) }),
  guildWithdrawItem: (characterId: string, bankId: number, qty = 1) =>
    req<{ success: boolean }>('/api/guilds/withdraw-item', { method: 'POST', body: JSON.stringify({ characterId, bankId, qty }) }),
  guildBank: (characterId: string) => req<{ items: any[] }>(`/api/guilds/bank?characterId=${characterId}`),
  guildKick: (actorId: string, targetId: string) =>
    req<{ success: boolean }>('/api/guilds/kick', { method: 'POST', body: JSON.stringify({ characterId: actorId, targetId }) }),

  // ── Модерация ───────────────────────────────────────────
  // Жалоба на игрока. characterId — наш персонаж, его сервер сверяет
  // с владельцем аккаунта: иначе можно было бы жаловаться от чужого
  report: (characterId: string, reportedId: string, reason: string, detail = '') =>
    req<{ success: boolean; error?: string }>('/api/game/report', {
      method: 'POST',
      body: JSON.stringify({ characterId, reportedId, reason, detail }),
    }),

  // ── Достижения / Задачи / Репутация ─────────────────────
  // characterId обязателен: сервер считает открытые достижения по персонажу,
  // а не по аккаунту — иначе счётчик «Разблокировано» всегда нулевой
  achievements: (characterId: string) =>
    req<{ achievements: any[]; total: number; unlockedCount: number }>(
      `/api/progression/achievements?characterId=${characterId}`),
  // characterId обязателен: сервер ищет прогресс по персонажу, а не по аккаунту
  tasks: (characterId: string) =>
    req<{ tasks: any[]; completedCount: number }>(`/api/progression/tasks?characterId=${characterId}`),
  tasksProgress: (characterId: string) =>
    req<{ completedCount: number }>(`/api/progression/tasks/progress?characterId=${characterId}`),
  // Персонаж обязателен: сервер ищет по character_reputation.character_id,
  // а не по аккаунту. Раньше он не передавался, и панель всегда была пустой.
  reputation: (characterId: string) =>
    req<{ reputation: { faction: string; reputation: number; rank_title: string }[] }>(
      `/api/progression/reputation?characterId=${characterId}`),
  factions: () => req<{ factions: any[] }>('/api/progression/reputation/factions'),

  // ── Питомцы ─────────────────────────────────────────────
  // Персонаж обязателен: сервер искал питомцев по account id, из-за чего
  // список был пуст, а переименование меняло чужую строку
  pets: (characterId: string) => req<{ pets: any[]; allDefs: any[] }>(`/api/game/pets?characterId=${characterId}`),
  petsActive: (characterId: string) => req<{ pet: any }>(`/api/game/pets/active?characterId=${characterId}`),
  petAcquire: (characterId: string, petId: string) =>
    req<{ success: boolean; pet: any }>('/api/game/pets/acquire', { method: 'POST', body: JSON.stringify({ characterId, petId }) }),
  petActivate: (characterId: string, petDbId: number) =>
    req<{ success: boolean }>('/api/game/pets/activate', { method: 'POST', body: JSON.stringify({ characterId, petDbId }) }),
  petRename: (characterId: string, petDbId: number, nickname: string) =>
    req<{ success: boolean }>('/api/game/pets/rename', { method: 'POST', body: JSON.stringify({ characterId, petDbId, nickname }) }),
  petRelease: (characterId: string, petDbId: number) =>
    req<{ success: boolean }>('/api/game/pets/release', { method: 'POST', body: JSON.stringify({ characterId, petDbId }) }),

  // ── Зал славы мировых боссов ────────────────────────────
  // Раньше история побед над мировыми боссами писалась в базу, но смотреть
  // на неё было некому: панели не существовало
  hallOfFame: (limit = 20) =>
    req<{ entries: { rank: number; characterId: string; characterName: string; class: string;
      kills: number; guildId: string | null; guildName: string | null; lastKill: string }[] }>(
      `/api/hall-of-fame/bosses?limit=${limit}`),

  // ── Почтовый ящик ──────────────────────────────────────
  // Таблица mailbox была пуста: награды выдавались напрямую, и если
  // предмет не помещался в сумку, он просто пропадал
  mail: (characterId: string) =>
    req<{ items: { id: string; subject: string; body: string | null; gold: number;
      itemId: string | null; itemQty: number; isRead: boolean; senderName: string | null;
      expiresAt: string; createdAt: string }[]; unread: number }>(`/api/game/mail?characterId=${characterId}`),
  mailClaim: (characterId: string, id: string) =>
    req<{ success: boolean; gold: number; items: { itemId: string; qty: number }[] }>(
      '/api/game/mail/claim', { method: 'POST', body: JSON.stringify({ characterId, id }) }),
  mailRead: (characterId: string, id: string) =>
    req<{ success: boolean }>('/api/game/mail/read', { method: 'POST', body: JSON.stringify({ characterId, id }) }),

  // ── Уведомления ────────────────────────────────────────
  // Списка не было: сервер писал строки в таблицу notifications, а прочитать
  // их было нечем. Панели уведомлений в игре не существовало
  notifications: (characterId: string) =>
    req<{ items: { id: string; type: string; title_ru: string; body_ru: string; is_read: boolean; created_at: string }[]; unread: number }>(
      `/api/game/notifications?characterId=${characterId}`),
  notificationsReadAll: (characterId: string) =>
    req<{ success: boolean }>('/api/game/notifications/read-all', { method: 'POST', body: JSON.stringify({ characterId }) }),
  notificationRead: (characterId: string, id: string) =>
    req<{ success: boolean }>('/api/game/notifications/read', { method: 'POST', body: JSON.stringify({ characterId, id }) }),

  // ── Конюшня: скакуны ────────────────────────────────────
  mountsBuy: (shopId: string, characterId: string, mountId: string) =>
    req<{ success: boolean; gold?: number; azens?: number; silver?: number; syrian?: number; mount?: any; error?: string }>('/api/game/shops/' + shopId + '/buy', {
      method: 'POST',
      body: JSON.stringify({ characterId, itemId: mountId, currency: 'gold' }),
    }),
  mountsMy: (characterId: string) =>
    req<{ mounts: any[] }>('/api/game/mounts/my', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),
  mountActivate: (characterId: string, mountId: string) =>
    req<{ success: boolean }>('/api/game/mounts/activate', {
      method: 'POST',
      body: JSON.stringify({ characterId, mountId }),
    }),


  // ── Дом ─────────────────────────────────────────────────
  house: (characterId: string) =>
    req<{ house: any; playerDecorations: any[]; houseTypes: any[]; allDecorations: any[] }>(
      `/api/game/house?characterId=${characterId}`),
  houseBuy: (characterId: string, region: string, houseType: string) =>
    req<{ success: boolean; house: any }>('/api/game/house/buy', { method: 'POST', body: JSON.stringify({ characterId, region, houseType }) }),
  houseUpgrade: (characterId: string) =>
    req<{ success: boolean; house: any }>('/api/game/house/upgrade', { method: 'POST', body: JSON.stringify({ characterId }) }),
  houseDecorate: (characterId: string, decorationId: string) =>
    req<{ success: boolean }>('/api/game/house/decorate', { method: 'POST', body: JSON.stringify({ characterId, decorationId }) }),

  // ── PvP Арена ───────────────────────────────────────────
  pvpFindMatch: (characterId: string) => req<{ match: any }>('/api/game/pvp/find-match', { method: 'POST', body: JSON.stringify({ characterId }) }),
  // Исход боя подтверждают оба игрока, поэтому ответ может быть не
  // «победа», а «ждём второго». Клиент обязан это учитывать.
  pvpComplete: (characterId: string, matchId: number, winnerId: string) =>
    req<{
      status: 'settled' | 'pending' | 'draw';
      winnerId?: string; winnerChange?: number; loserChange?: number;
      winnerNewRating?: number; loserNewRating?: number; settleAfter?: string;
    }>('/api/game/pvp/complete', { method: 'POST', body: JSON.stringify({ characterId, matchId, winnerId }) }),
  pvpMatchStatus: (matchId: number) =>
    req<{
      status: 'settled' | 'pending' | 'draw';
      winnerId?: string; winnerChange?: number; loserChange?: number; settleAfter?: string;
    }>(`/api/game/pvp/matches/${matchId}/status`),
  pvpRankings: (limit = 50) => req<{ rankings: any[] }>(`/api/game/pvp/rankings?limit=${limit}`),
  // Персонаж обязателен: сервер искал рейтинг по account id, из-за чего свой
  // рейтинг и своя история матчей были пустыми у каждого
  pvpMe: (characterId: string) => req<{ ranking: any }>(`/api/game/pvp/me?characterId=${characterId}`),
  pvpHistory: (characterId: string) => req<{ history: any[] }>(`/api/game/pvp/history?characterId=${characterId}`),
  // Отмена поиска. Маршрут был написан, обёртки не было: матч оставался в
  // состоянии 'waiting' навсегда, и «Найти бой» нельзя было отменить
  pvpCancel: (characterId: string, matchId: number) =>
    req<{ success: boolean }>('/api/game/pvp/cancel', { method: 'POST', body: JSON.stringify({ characterId, matchId }) }),

  // ── Бесконечная Башня ───────────────────────────────────
  // Персонаж обязателен: сервер ищет по endless_tower.character_id, а не по
  // аккаунту. Раньше он не передавался, и прогресс башни был всегда нулевым
  towerProgress: (characterId: string) =>
    req<{ progress: any; floor: any }>(`/api/game/tower/progress?characterId=${characterId}`),
  towerStart: (characterId: string) =>
    req<{ progress: any; floor: any }>('/api/game/tower/start', { method: 'POST', body: JSON.stringify({ characterId }) }),
  towerCompleteFloor: (characterId: string, floor: number, timeSeconds: number) =>
    req<{ reward: any; newMax: boolean; nextFloor: any }>(
      '/api/game/tower/complete-floor', { method: 'POST', body: JSON.stringify({ characterId, floor, timeSeconds }) }),
  towerFloor: (num: number) => req<{ floor: any }>(`/api/game/tower/floor/${num}`),
  towerLeaderboard: () => req<{ leaderboard: any[] }>('/api/game/tower/leaderboard'),

  // ── NPC Диалоги ────────────────────────────────────────────
  npcInfo: () => req<{ npcs: { npcId: string; nameRu: string; role: string; region: string; helloLineId: string }[] }>('/api/npc/info'),

  npcDialog: (npcId: string, lineId?: string, characterId?: string) => {
    const q = new URLSearchParams();
    if (lineId) q.set('line', lineId);
    if (characterId) q.set('characterId', characterId);
    const qs = q.toString();
    return req<{ npcId: string; nameRu: string; role: string; region: string; line: NpcLine; questsCompleted?: CompletedQuest[]; cutscene?: StoryCutscene | null }>(
      `/api/npc/${encodeURIComponent(npcId)}/dialog${qs ? `?${qs}` : ''}`,
    );
  },

  npcReply: (npcId: string, lineId: string, choiceIndex: number, characterId?: string) =>
    req<{ npcId: string; nameRu: string; choice: NpcChoice; nextLine: NpcLine; memory?: { chatCount: number; friendshipLevel: number; tone?: string }; friendshipUp?: boolean; questsCompleted?: CompletedQuest[]; cutscene?: StoryCutscene | null }>(
      `/api/npc/${encodeURIComponent(npcId)}/dialog`,
      { method: 'POST', body: JSON.stringify({ lineId, choiceIndex, characterId }) },
    ),
};
