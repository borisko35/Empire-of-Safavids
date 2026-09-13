import { DatabaseService } from './DatabaseService';
import { CharacterService } from './CharacterService';
import { QUESTS_DATABASE, QuestDefinition, QuestObjectiveDef } from '../data/quests';
import { ITEMS_DATABASE } from '../data/items';
import { logger } from '../utils/logger';

// ============================================================
// Прогресс квестов — Empire of Safavids
// ============================================================
// Сервер — источник истины. kill-цели инкрементируются при убийстве
// монстров; collect-цели проверяются по инвентарю (при завершении
// предметы списываются); talk/explore — по факту нахождения в регионе
// квеста. evaluateQuests() вызывается после лута, покупки и крафта.

export interface QuestStateRow {
  questId: string;
  status: 'active' | 'completed';
  progress: Record<string, number>;
  acceptedAt?: string;
  completedAt?: string;
}

export interface CompletedQuestInfo {
  questId: string;
  titleRu: string;
  experience: number;
  gold: number;
  items: { itemId: string; nameRu: string; quantity: number }[];
  leveledUp?: boolean;
  newLevel?: number;
}

export type AcceptQuestResult =
  | { ok: true }
  | { ok: false; code: 'quest_not_found' | 'quest_level_low' | 'quest_class_mismatch' | 'quest_locked' | 'quest_already_completed' | 'character_not_found' };

export class QuestService {
  private db = DatabaseService.getInstance();
  private characters = new CharacterService();

  /** Состояние всех квестов персонажа (таблица character_quests из схемы 001) */
  async getState(characterId: string): Promise<QuestStateRow[]> {
    const rows = await this.db.query<{
      quest_id: string; status: string; progress: Record<string, number> | string;
      started_at: Date; completed_at: Date | null;
    }>(
      'SELECT quest_id, status, progress, started_at, completed_at FROM character_quests WHERE character_id = $1 ORDER BY started_at',
      [characterId],
    );
    return rows.map(r => ({
      questId: r.quest_id,
      status: r.status as QuestStateRow['status'],
      progress: (typeof r.progress === 'string' ? JSON.parse(r.progress) : r.progress) ?? {},
      acceptedAt: r.started_at?.toISOString?.(),
      completedAt: r.completed_at?.toISOString?.() ?? undefined,
    }));
  }

  /** Взять квест (идемпотентно для уже активного) */
  async accept(characterId: string, questId: string): Promise<AcceptQuestResult> {
    const def = QUESTS_DATABASE[questId];
    if (!def) return { ok: false, code: 'quest_not_found' };

    const character = await this.characters.getCharacterById(characterId);
    if (!character) return { ok: false, code: 'character_not_found' };
    if (def.minLevel > character.level) return { ok: false, code: 'quest_level_low' };
    if (def.requiredClass && def.requiredClass !== character.class) return { ok: false, code: 'quest_class_mismatch' };

    const state = await this.getState(characterId);
    const existing = state.find(s => s.questId === questId);
    if (existing?.status === 'active') return { ok: true };
    if (existing?.status === 'completed' && !def.repeatable) return { ok: false, code: 'quest_already_completed' };

    if (def.prerequisites.length) {
      const done = new Set(state.filter(s => s.status === 'completed').map(s => s.questId));
      if (!def.prerequisites.every(p => done.has(p))) return { ok: false, code: 'quest_locked' };
    }

    await this.db.query(
      `INSERT INTO character_quests (character_id, quest_id, status, progress)
       VALUES ($1, $2, 'active', '{}'::jsonb)
       ON CONFLICT (character_id, quest_id)
       DO UPDATE SET status = 'active', progress = '{}'::jsonb, started_at = NOW(), completed_at = NULL`,
      [characterId, questId],
    );
    return { ok: true };
  }

  /**
   * Засчитать убийство монстра во все активные квесты персонажа.
   * Возвращает квесты, завершённые этим убийством (с выданными наградами).
   */
  async recordKill(characterId: string, monsterId: string): Promise<CompletedQuestInfo[]> {
    const active = (await this.getState(characterId)).filter(s => s.status === 'active');
    const completed: CompletedQuestInfo[] = [];

    for (const st of active) {
      const def = QUESTS_DATABASE[st.questId];
      if (!def) continue;

      const killObjectives = def.objectives.filter(o => o.type === 'kill' && o.target === monsterId);
      if (!killObjectives.length) continue;

      const progress: Record<string, number> = { ...st.progress };
      for (const o of killObjectives) {
        progress[o.id] = Math.min(o.required, (progress[o.id] ?? 0) + 1);
      }

      await this.db.query(
        'UPDATE character_quests SET progress = $2::jsonb WHERE character_id = $1 AND quest_id = $3',
        [characterId, JSON.stringify(progress), st.questId],
      );

      // Чисто kill-квесты завершаются сразу; смешанные добьёт evaluateQuests
      const required = def.objectives.filter(o => !o.optional);
      const allKillTracked = required.length > 0 && required.every(o => o.type === 'kill');
      const allDone = allKillTracked && required.every(o => (progress[o.id] ?? 0) >= o.required);

      if (allDone) {
        completed.push(await this.completeQuest(characterId, def, progress));
      }
    }

    return completed;
  }

  /**
   * Проверить активные квесты, чьи цели зависят от состояния мира:
   * collect — по инвентарю (списывается при завершении),
   * talk/explore — по нахождению персонажа в регионе квеста.
   * Вызывается после лута, покупки в магазине и завершения крафта.
   */
  async evaluateQuests(characterId: string): Promise<CompletedQuestInfo[]> {
    const character = await this.characters.getCharacterById(characterId).catch(() => null);
    if (!character) return [];

    const state = (await this.getState(characterId)).filter(s => s.status === 'active');
    const completed: CompletedQuestInfo[] = [];

    for (const st of state) {
      const def = QUESTS_DATABASE[st.questId];
      if (!def) continue;
      if (!def.objectives.some(o => !o.optional && o.type !== 'kill')) continue; // чисто kill уже проверены

      const required = def.objectives.filter(o => !o.optional);
      const inventory = await this.characters.getItemQuantities(characterId);

      const objectiveDone = (o: QuestObjectiveDef): boolean => {
        if (o.type === 'kill') return (st.progress[o.id] ?? 0) >= o.required;
        if (o.type === 'collect') return (inventory[o.target] ?? 0) >= o.required;
        if (o.type === 'talk' || o.type === 'explore') return character.region === def.npcGiverRegion;
        return false;
      };

      if (!required.every(objectiveDone)) continue;

      // Списать collect-груз
      const collect = required.filter(o => o.type === 'collect');
      if (collect.length) {
        try {
          await this.characters.removeItems(
            characterId,
            collect.map(o => ({ itemId: o.target, qty: o.required })),
          );
        } catch {
          continue; // инвентарь изменился между проверкой и списанием
        }
      }

      completed.push(await this.completeQuest(characterId, def, st.progress));
    }

    return completed;
  }

  /** Завершить квест: статус в БД, награды (опыт/золото/предметы/титул) */
  private async completeQuest(
    characterId: string,
    def: QuestDefinition,
    progress: Record<string, number>
  ): Promise<CompletedQuestInfo> {
    await this.db.query(
      `UPDATE character_quests SET progress = $2::jsonb, status = 'completed', completed_at = NOW()
       WHERE character_id = $1 AND quest_id = $3`,
      [characterId, JSON.stringify(progress), def.id],
    );

    const reward = await this.characters.addExperience(characterId, def.rewards.experience).catch(() => null);
    await this.characters.addGold(characterId, def.rewards.gold).catch(() => {});
    const items: CompletedQuestInfo['items'] = [];
    if (def.rewards.items?.length) {
      await this.characters.addItems(
        characterId,
        def.rewards.items.map(it => ({ itemId: it.itemId, qty: it.quantity })),
      ).catch(() => {});
      for (const it of def.rewards.items) {
        items.push({ itemId: it.itemId, nameRu: ITEMS_DATABASE[it.itemId]?.nameRu ?? it.itemId, quantity: it.quantity });
      }
    }
    if (def.rewards.title) {
      await this.db.query(
        `INSERT INTO character_titles (character_id, title) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [characterId, def.rewards.title],
      ).catch(() => {});
    }

    logger.info(`Quest completed: ${def.id} by character ${characterId}`);
    return {
      questId: def.id,
      titleRu: def.titleRu,
      experience: def.rewards.experience,
      gold: def.rewards.gold,
      items,
      leveledUp: reward?.leveledUp,
      newLevel: reward?.newLevel,
    };
  }
}
