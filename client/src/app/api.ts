// ============================================================
// REST-клиент — Empire of Safavids
// ============================================================

import { Character, RegionInfo, QuestDef, SkillDef } from './state';

class ApiError extends Error {
  constructor(message: string, public status: number) {
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
    const message = (body as { message?: string; error?: string }).message
      ?? (body as { error?: string }).error
      ?? `HTTP ${res.status}`;
    throw new ApiError(message, res.status);
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

  regions: () => req<{ regions: RegionInfo[] }>('/api/world/regions'),

  quests: () => req<{ quests: QuestDef[] }>('/api/game/quests'),
};
