// ============================================================
// REST-клиент — Empire of Safavids
// ============================================================

import { Character, RegionInfo, QuestDef, SkillDef } from './state';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
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

export interface ResourcesState {
  hp: number; maxHp: number;
  mana: number; maxMana: number;
  stamina: number; maxStamina: number;
}

export interface EquipmentState {
  items: { slot: string; itemId: string; nameRu: string; rarity: string; enhancement: number }[];
  stats: Record<string, number>;
}

export const api = {
  register: (body: {
    username: string; email: string; password: string; confirmPassword: string;
    agreeToTerms: boolean; agreeToPrivacy: boolean; birthYear: number;
  }) => req<{ data: AuthData }>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),

  login: (email: string, password: string) =>
    req<{ data: AuthData }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  logout: () => req<unknown>('/api/auth/logout', { method: 'POST' }),

  characters: () => req<{ characters: Character[] }>('/api/characters'),

  createCharacter: (name: string, characterClass: string) =>
    req<{ character: Character }>('/api/characters', {
      method: 'POST',
      body: JSON.stringify({ name, class: characterClass }),
    }),

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

  enhance: (characterId: string, itemId: string) =>
    req<{ result: string; newEnhancement: number; message: string; messageRu: string }>(
      `/api/characters/${characterId}/enhance`,
      { method: 'POST', body: JSON.stringify({ itemId }) },
    ),

  shops: () => req<{ shops: { id: string; nameRu: string; items: { itemId: string; price: number; currency: string; minLevel?: number }[] }[] }>('/api/game/shops'),

  shopBuy: (shopId: string, characterId: string, itemId: string, quantity = 1) =>
    req<{ success: boolean; itemId: string; quantity: number; goldSpent: number; gold: number }>(
      `/api/game/shops/${shopId}/buy`,
      { method: 'POST', body: JSON.stringify({ characterId, itemId, quantity }) },
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

  tradeContracts: () =>
    req<{ contracts: { id: string; nameRu: string; fromRegion: string; toRegion: string; cargoNameRu: string; cargoQty: number; rewardGold: number; minLevel: number }[] }>(
      '/api/game/trade/contracts',
    ),

  tradeAccept: (characterId: string, contractId: string) =>
    req<{ success: boolean }>('/api/game/trade/accept', {
      method: 'POST',
      body: JSON.stringify({ characterId, contractId }),
    }),

  tradeDeliver: (characterId: string) =>
    req<{ success: boolean; gold: number; exp: number }>('/api/game/trade/deliver', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),

  tradeCancel: (characterId: string) =>
    req<{ success: boolean }>('/api/game/trade/cancel', {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    }),

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

  auctionCancel: (listingId: string, characterId: string) =>
    req<boolean>(`/api/game/auction/${listingId}`, {
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
};
