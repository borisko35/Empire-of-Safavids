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
  /**
   * Сколько попыток кражи этот NPC ВИДЕЛ (§359).
   *
   * Удачная кража счёт не двигает: жертва о ней не знает, и мир не может
   * реагировать на то, чего не видел. Событие ставит сокет-обработчик
   * через rememberTheft.
   */
  theftsSeen: number;
  lastTheftSeenAt: number;
  firstMeetingPhrases?: string[];
  /** подсказка для LLM — генерируется на лету, не хранится */
  llmHint?: string;
}

/** Тон по уровню дружбы: 0-1 нейтральный, 2-3 дружелюбный, 0 враждебный при отрицательных нотах */
export function toneByFriendship(level: number, notes: string[], theftsSeen = 0): 'neutral' | 'friendly' | 'hostile' {
  // Живые последствия (§359): NPC, видевший кражу, враждебен независимо от
  // дружбы. Друг может простить слово — попытку обокрасть не забывает.
  if (theftsSeen > 0) return 'hostile';
  const hostile = notes.some(n => /угроз|предал|обман/i.test(n));
  if (hostile) return 'hostile';
  if (level >= 3) return 'friendly';
  if (level >= 2) return 'friendly';
  return 'neutral';
}

/** Короткая LLM-подсказка для генерации реплики — без внешнего LLM, правило-шаблон */
export function buildLlmHint(npcId: string, nameRu: string, memory: NpcMemory): string {
  const tone = toneByFriendship(memory.friendshipLevel, memory.playerNotes, memory.theftsSeen ?? 0);
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
  theftsSeen: 0,
  lastTheftSeenAt: 0,
};

/** Потолок дружбы. Дальше NPC не становится «дружественнее», только тише. */
const MAX_FRIENDSHIP = 5;

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
    mem.tone = toneByFriendship(mem.friendshipLevel, mem.playerNotes, mem.theftsSeen ?? 0);
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

  /**
   * Отметить квест выполненным. Дружбу НЕ трогает.
   *
   * Раньше дружба росла здесь, и маршрут complete-quest прибавлял ещё единицу
   * поверх — выходило по два за квест. Теперь единственное место, где
   * растёт дружба, это growFriendship.
   */
  async addCompletedQuest(npcId: string, characterId: string, questId: string): Promise<void> {
    const memory = await this.getMemory(npcId, characterId);
    if (!memory.completedQuests.includes(questId)) {
      memory.completedQuests.push(questId);
      await this.saveMemory(npcId, characterId, memory);
    }
  }

  /**
   * Поднять дружбу на `by` пунктов. Единственное место, где она растёт.
   *
   * Отдельный метод, а не прибавка в addCompletedQuest, по двум причинам.
   * Первая: раньше дружба росла в двух местах, и по одному выполненному
   * квесту начислялось сразу два очка. Вторая: вызывающий должен уметь
   * спросить, вырос ли уровень, — иначе игроку не сообщают, что он
   * подружился, и радость от роста остаётся незамеченной.
   *
   * Потолок — 5, как и был.
   */
  async growFriendship(npcId: string, characterId: string, by = 1): Promise<{ level: number; leveledUp: boolean }> {
    const memory = await this.getMemory(npcId, characterId);
    const before = memory.friendshipLevel;
    const after = Math.min(MAX_FRIENDSHIP, before + Math.max(0, by));
    memory.friendshipLevel = after;
    // Пересчитываем тон сразу: реплики NPC выбираются по нему, и без
    // пересчёта следующая фраза была бы старой
    memory.tone = toneByFriendship(after, memory.playerNotes, memory.theftsSeen ?? 0);
    await this.saveMemory(npcId, characterId, memory);
    return { level: after, leveledUp: after > before };
  }

  async setTone(npcId: string, characterId: string, tone: NpcMemory['tone']): Promise<void> {
    const memory = await this.getMemory(npcId, characterId);
    memory.tone = tone;
    await this.saveMemory(npcId, characterId, memory);
  }

  /**
   * NPC видел попытку кражи (§359) и запомнил вора.
   *
   * Событие ставит сокет-обработчик, когда цель ВИДЕЛА попытку (reason
   * 'seen'): удачная кража обиды не оставляет — жертва ни о чём не знает,
   * а мир не реагирует на то, чего не видел. Счётчик двигает тон, заметка
   * даёт диалогу живой текст.
   */
  async rememberTheft(npcId: string, characterId: string, now: number = Date.now()): Promise<void> {
    const memory = await this.getMemory(npcId, characterId);
    memory.theftsSeen = (memory.theftsSeen ?? 0) + 1;
    memory.lastTheftSeenAt = now;
    const заметка = 'пытался обчистить мои карманы';
    if (!memory.playerNotes.includes(заметка) && memory.playerNotes.length < 5) {
      memory.playerNotes.push(заметка);
    }
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
