// ============================================================
// NPC Memory System — Empire of Safavids
// ============================================================
// Память НПС: каждый NPC помнит о взаимодействиях с игроком.

import { RedisService } from './RedisService';

export interface NpcMemory {
  givenQuests: string[];
  completedQuests: string[];
  interactionCount: number;
  lastInteractionAt: number;
  friendshipLevel: number;
  playerNotes: string[];
  tone: 'neutral' | 'friendly' | 'hostile';
  firstMeetingPhrases?: string[];
  /** подсказка для LLM — генерируется на лету, не хранится */
  llmHint?: string;
}

/** Тон по уровню дружбы: 0-1 нейтральный, 2-3 дружелюбный, 0 враждебный при отрицательных нотах */
export function toneByFriendship(level: number, notes: string[]): 'neutral' | 'friendly' | 'hostile' {
  const hostile = notes.some(n => /угроз|предал|обман/i.test(n));
  if (hostile) return 'hostile';
  if (level >= 3) return 'friendly';
  if (level >= 2) return 'friendly';
  return 'neutral';
}

/** Короткая LLM-подсказка для генерации реплики — без внешнего LLM, правило-шаблон */
export function buildLlmHint(npcId: string, nameRu: string, memory: NpcMemory): string {
  const tone = toneByFriendship(memory.friendshipLevel, memory.playerNotes);
  const last = memory.playerNotes[memory.playerNotes.length - 1] ?? '';
  const base = tone === 'friendly' ? `Ты дружелюбно относишься к игроку, помнишь его помощь` : tone === 'hostile' ? `Ты насторожен, помнишь обиду` : `Ты нейтрален, оцениваешь игрока`;
  return `[LLM hint] NPC ${nameRu} (${npcId}) tone=${tone} friendship=${memory.friendshipLevel} lastNote="${last}". ${base}. Отвечай в стиле эпохи Сефевидов, коротко, ветвящимся выбором.`;
}

const DEFAULT_MEMORY: NpcMemory = {
  givenQuests: [],
  completedQuests: [],
  interactionCount: 0,
  lastInteractionAt: 0,
  friendshipLevel: 0,
  playerNotes: [],
  tone: 'neutral',
};

export class NpcMemoryService {
  private redis = RedisService.getInstance();

  private key(npcId: string, characterId: string): string {
    return `npc:memory:${npcId}:${characterId}`;
  }

  private chatKey(npcId: string, characterId: string): string {
    return `npc:chat:${npcId}:${characterId}`;
  }

  async getMemory(npcId: string, characterId: string): Promise<NpcMemory> {
    const raw = await this.redis.get(this.key(npcId, characterId));
    let mem: NpcMemory;
    if (!raw) mem = { ...DEFAULT_MEMORY };
    else {
      try { mem = JSON.parse(raw) as NpcMemory; } catch { mem = { ...DEFAULT_MEMORY }; }
    }
    // авто-тон по дружбе + LLM-хинт (не персистим, считаем на лету)
    mem.tone = toneByFriendship(mem.friendshipLevel, mem.playerNotes);
    mem.llmHint = buildLlmHint(npcId, npcId, mem);
    return mem;
  }

  async saveMemory(npcId: string, characterId: string, memory: NpcMemory): Promise<void> {
    await this.redis.set(this.key(npcId, characterId), JSON.stringify(memory));
  }

  async incrementChat(npcId: string, characterId: string): Promise<number> {
    const count = await this.redis.incr(this.chatKey(npcId, characterId));
    await this.redis.expire(this.chatKey(npcId, characterId), 86400 * 7);
    return count;
  }

  async addGivenQuest(npcId: string, characterId: string, questId: string): Promise<void> {
    const memory = await this.getMemory(npcId, characterId);
    if (!memory.givenQuests.includes(questId)) {
      memory.givenQuests.push(questId);
      await this.saveMemory(npcId, characterId, memory);
    }
  }

  async addCompletedQuest(npcId: string, characterId: string, questId: string): Promise<void> {
    const memory = await this.getMemory(npcId, characterId);
    if (!memory.completedQuests.includes(questId)) {
      memory.completedQuests.push(questId);
    }
    memory.friendshipLevel = Math.min(5, memory.friendshipLevel + 1);
    await this.saveMemory(npcId, characterId, memory);
  }

  async setTone(npcId: string, characterId: string, tone: NpcMemory['tone']): Promise<void> {
    const memory = await this.getMemory(npcId, characterId);
    memory.tone = tone;
    await this.saveMemory(npcId, characterId, memory);
  }

  async addNote(npcId: string, characterId: string, note: string): Promise<void> {
    const memory = await this.getMemory(npcId, characterId);
    if (memory.playerNotes.length < 5) {
      memory.playerNotes.push(note);
      await this.saveMemory(npcId, characterId, memory);
    }
  }

  async hasGivenQuest(npcId: string, characterId: string, questId: string): Promise<boolean> {
    const memory = await this.getMemory(npcId, characterId);
    return memory.givenQuests.includes(questId);
  }

  async hasCompletedQuest(npcId: string, characterId: string, questId: string): Promise<boolean> {
    const memory = await this.getMemory(npcId, characterId);
    return memory.completedQuests.includes(questId);
  }

  async updateLastInteraction(npcId: string, characterId: string): Promise<void> {
    const memory = await this.getMemory(npcId, characterId);
    memory.lastInteractionAt = Date.now();
    await this.saveMemory(npcId, characterId, memory);
  }

  async getChatCount(npcId: string, characterId: string): Promise<number> {
    const raw = await this.redis.get(this.chatKey(npcId, characterId));
    return raw ? parseInt(raw, 10) : 0;
  }

  async resetMemory(npcId: string, characterId: string): Promise<void> {
    await this.redis.del(this.key(npcId, characterId));
    await this.redis.del(this.chatKey(npcId, characterId));
  }
}
