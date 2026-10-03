import { DatabaseService } from './DatabaseService';
import { CharacterService } from './CharacterService';
import { QUESTS_DATABASE, QuestDefinition, QuestObjectiveDef } from '../data/quests';
import { ITEMS_DATABASE } from '../data/items';
import { grantReputation } from '../systems/ReputationGrants';
import { LeaderboardService } from './LeaderboardService';
import { QUEST_NPC_ALIAS } from '../../../shared/constants';
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
  azens?: number;
  isfahanSilver?: number;
  syrianGold?: number;
  items: { itemId: string; nameRu: string; quantity: number }[];
  leveledUp?: boolean;
  newLevel?: number;
}

export type AcceptQuestResult =
  | { ok: true }
  | { ok: false; code: 'quest_not_found' | 'quest_level_low' | 'quest_class_mismatch' | 'quest_locked' | 'quest_karma_too_high' | 'quest_karma_too_low' | 'quest_already_completed' | 'character_not_found' };

export class QuestService {
  private db = DatabaseService.getInstance();
  private characters = new CharacterService();
  /**
   * Рейтинг нужен здесь ради одного счётчика: вкладка «Квесты» показывала
   * ноль у всех, потому что колонку quests_completed не писал никто.
   * Накапливаем именно здесь, где квест закрывается, а не в тике регенерации:
   * тик перезаписывает строку рейтинга целиком раз в 5 секунд.
   */
  private leaderboard = new LeaderboardService();

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
/**
   * Карма персонажа для личных квестов.
   *
   * Отдельное чтение, потому что в типе Character поля karma нет: карма лежит
   * в колонке characters, но в объект персонажа не попадает. Ошибка чтения —
   * ноль, то есть «личный квест тебе не выдаётся»: переживать работу
   * лишним запросом не стоит.
   */


  async accept(characterId: string, questId: string): Promise<AcceptQuestResult> {
    const def = QUESTS_DATABASE[questId];
    if (!def) return { ok: false, code: 'quest_not_found' };

    const character = await this.characters.getCharacterById(characterId);
    if (!character) return { ok: false, code: 'character_not_found' };
    if (def.minLevel > character.level) return { ok: false, code: 'quest_level_low' };
    if (def.requiredClass && def.requiredClass !== character.class) return { ok: false, code: 'quest_class_mismatch' };

    // Личный квест по тёмной карме. Условие есть и в списке доступных, но
    // там оно фильтр, а здесь — правило: иначе квест можно взять ручным
    // запросом, минуя список.
    if (def.requiresKarmaAtMost !== undefined || def.requiresKarmaAtLeast !== undefined) {
      const карма = await this.characters.getKarma(characterId);
      // Два разных отказа, а не один: «заказ слишком чистый для тебя» и
      // «тебе ещё не доверяют» — противоположные вещи, и игрок должен
      // понимать, что именно его не пускает.
      if (def.requiresKarmaAtMost !== undefined && карма > def.requiresKarmaAtMost) {
        return { ok: false, code: 'quest_karma_too_high' };
      }
      if (def.requiresKarmaAtLeast !== undefined && карма < def.requiresKarmaAtLeast) {
        return { ok: false, code: 'quest_karma_too_low' };
      }
    }

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
   * Засчитать разговор с NPC: talk-цели, указывающие на этого NPC
   * (напрямую или через QUEST_NPC_ALIAS), закрываются сразу.
   * После — общая проверка завершения (evaluateQuests).
   * Вызывается из POST /api/npc/:npcId/dialog.
   */
  async recordTalk(characterId: string, npcId: string): Promise<CompletedQuestInfo[]> {
    const active = (await this.getState(characterId)).filter(s => s.status === 'active');
    for (const st of active) {
      const def = QUESTS_DATABASE[st.questId];
      if (!def) continue;
      const talkObjectives = def.objectives.filter(o =>
        !o.optional && o.type === 'talk' &&
        (o.target === npcId || QUEST_NPC_ALIAS[o.target] === npcId)
      );
      if (!talkObjectives.length) continue;
      const progress: Record<string, number> = { ...st.progress };
      for (const o of talkObjectives) {
        progress[o.id] = Math.max(progress[o.id] ?? 0, o.required);
      }
      await this.db.query(
        'UPDATE character_quests SET progress = $2::jsonb WHERE character_id = $1 AND quest_id = $3',
        [characterId, JSON.stringify(progress), st.questId],
      );
    }
    return this.evaluateQuests(characterId);
  }

  /**
   * Засчитать точку explore: клиент подошёл к цели (<=8м, проверено
   * координатами навигатора). Прогресс ставится, дальше — общая проверка.
   */
  async recordExplore(characterId: string, questId: string, objectiveId?: string): Promise<CompletedQuestInfo[]> {
    const state = (await this.getState(characterId)).filter(s => s.status === 'active');
    const st = state.find(s => s.questId === questId);
    if (!st) return [];
    const def = QUESTS_DATABASE[questId];
    if (!def) return [];
    const targets = def.objectives.filter(o =>
      !o.optional && o.type === 'explore' && (!objectiveId || o.id === objectiveId)
    );
    if (!targets.length) return [];
    const progress: Record<string, number> = { ...st.progress };
    for (const o of targets) {
      progress[o.id] = Math.max(progress[o.id] ?? 0, o.required);
    }
    await this.db.query(
      'UPDATE character_quests SET progress = $2::jsonb WHERE character_id = $1 AND quest_id = $3',
      [characterId, JSON.stringify(progress), questId],
    );
    return this.evaluateQuests(characterId);
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
    let inventory: Record<string, number> | null = null;

    for (const st of state) {
      const def = QUESTS_DATABASE[st.questId];
      if (!def) continue;
      if (!def.objectives.some(o => !o.optional && o.type !== 'kill')) continue; // чисто kill уже проверены

      const required = def.objectives.filter(o => !o.optional);
      const collect = required.filter(o => o.type === 'collect');
      if (collect.length && !inventory) inventory = await this.characters.getItemQuantities(characterId);

      // Collect-прогресс НИКОГДА не записывался: цели проверялись по инвентарю
      // прямо здесь, а в character_quests оставался нулевой. Из-за этого в
      // журнале заданий всегда горело «0/8», даже когда шкуры лежали в сумке.
      let progress = st.progress;
      if (collect.length) {
        const next: Record<string, number> = { ...st.progress };
        let changed = false;
        for (const o of collect) {
          const have = Math.min(o.required, inventory?.[o.target] ?? 0);
          if (next[o.id] !== have) { next[o.id] = have; changed = true; }
        }
        if (changed) {
          await this.db.query(
            'UPDATE character_quests SET progress = $2::jsonb WHERE character_id = $1 AND quest_id = $3',
            [characterId, JSON.stringify(next), st.questId],
          ).catch(() => {});
          progress = next;
        }
      }

      const objectiveDone = (o: QuestObjectiveDef): boolean => {
        if (o.type === 'kill') return (progress[o.id] ?? 0) >= o.required;
        if (o.type === 'collect') return (inventory?.[o.target] ?? 0) >= o.required;
        // talk/explore закрываются только явными событиями:
        // talk — через recordTalk (диалог), explore — через recordExplore
        // (клиент рядом с точкой). Проверка региона здесь НЕ нужна,
        // иначе квест завершался бы без похода к цели.
        if (o.type === 'talk' || o.type === 'explore') return (progress[o.id] ?? 0) >= o.required;
        return false;
      };

      if (!required.every(objectiveDone)) continue;

      // Списать collect-груз
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

      // talk/explore прогресс уже проставлен событиями, collect — выше.
      // Дописываем недостающее, иначе у завершённого квеста в журнале
      // оставались незакрытые цели.
      const finalProgress: Record<string, number> = { ...progress };
      for (const o of required) {
        if (finalProgress[o.id] == null) finalProgress[o.id] = o.required;
      }

      completed.push(await this.completeQuest(characterId, def, finalProgress));
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
    await this.characters.addGoldReward(characterId, def.rewards.gold).catch(() => {});
    const azens = def.rewards.azens ?? 0;
    const isfahanSilver = def.rewards.isfahanSilver ?? 0;
    const syrianGold = def.rewards.syrianGold ?? 0;
    if (azens > 0) await this.characters.addAzens(characterId, azens).catch(() => {});
    if (isfahanSilver > 0) await this.characters.addSilver(characterId, isfahanSilver).catch(() => {});
    if (syrianGold > 0) await this.characters.addSyrianGold(characterId, syrianGold).catch(() => {});
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

    // Репутация за квест. Раньше не начислялась нигде: addReputation был
    // написан, но не вызывался, и панель репутации показывала честные нули.
    // Счётчик выполненных квестов для вкладки рейтинга «Квесты» — так же
    // пустая, как была «Убийства»: quests_completed никто не писал.
    void this.leaderboard.increment(characterId, { questsCompleted: 1 })
      .catch(() => { /* рейтинг не критичен для выдачи награды */ });
    void grantReputation(characterId, 'questDone');
    return {
      questId: def.id,
      titleRu: def.titleRu,
      experience: def.rewards.experience,
      gold: def.rewards.gold,
      azens: azens > 0 ? azens : undefined,
      isfahanSilver: isfahanSilver > 0 ? isfahanSilver : undefined,
      syrianGold: syrianGold > 0 ? syrianGold : undefined,
      items,
      leveledUp: reward?.leveledUp,
      newLevel: reward?.newLevel,
    };
  }
}
