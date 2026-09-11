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
    req<{ items: { itemId: string; nameRu: string; rarity: string; quantity: number }[] }>(`/api/characters/${characterId}/inventory`),

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
