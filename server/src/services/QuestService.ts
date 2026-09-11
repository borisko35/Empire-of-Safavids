import { DatabaseService } from './DatabaseService';
import { CharacterService } from './CharacterService';
import { QUESTS_DATABASE } from '../data/quests';
import { ITEMS_DATABASE } from '../data/items';
import { logger } from '../utils/logger';

// ============================================================
// Прогресс квестов — Empire of Safavids
// ============================================================
// Сервер — источник истины: kill-цели инкрементируются при убийстве
// монстров, квесты с чисто kill-целями завершаются автоматически
// с выдачей наград. Цели talk/collect/explore пока не трекаются —
// такие квесты остаются активными (завершение вручную позже).

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

      // Завершаемо, если все обязательные цели — kill и все выполнены
      const required = def.objectives.filter(o => !o.optional);
      const allKillTracked = required.length > 0 && required.every(o => o.type === 'kill');
      const allDone = allKillTracked && required.every(o => (progress[o.id] ?? 0) >= o.required);

      if (!allDone) {
        await this.db.query(
          'UPDATE character_quests SET progress = $2::jsonb WHERE character_id = $1 AND quest_id = $3',
          [characterId, JSON.stringify(progress), st.questId],
        );
        continue;
      }

      await this.db.query(
        `UPDATE character_quests SET progress = $2::jsonb, status = 'completed', completed_at = NOW()
         WHERE character_id = $1 AND quest_id = $3`,
        [characterId, JSON.stringify(progress), st.questId],
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

      completed.push({
        questId: def.id,
        titleRu: def.titleRu,
        experience: def.rewards.experience,
        gold: def.rewards.gold,
        items,
        leveledUp: reward?.leveledUp,
        newLevel: reward?.newLevel,
      });
      logger.info(`Quest completed: ${def.id} by character ${characterId}`);
    }

    return completed;
  }
}
