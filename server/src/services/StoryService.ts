// ============================================================
// Сюжет: прогресс по главам и выдача кат-сцен
// — Empire of Safavids
// ============================================================
// Две задачи:
//   1) сказать игроку, где он в сюжете (глава, сколько квестов пройдено),
//   2) выдать кат-сцену, когда игрок дошёл до нужного момента.
//
// Сцену отдаём только в момент срабатывания и помечаем как просмотренную.
// Иначе можно было бы перебирать id и читать весь сюжет заранее —
// на клиенте это просто список строк, никакой защиты у него нет.

import { DatabaseService } from '../services/DatabaseService';
import { QUESTS_DATABASE } from '../data/quests';
import { CHAPTERS, ChapterDef } from '../data/chapters';
import { CUTSCENES, CutsceneDef, getCutsceneForQuest } from '../data/cutscenes';
import { logger } from '../utils/logger';

export interface ChapterProgress {
  chapter: ChapterDef;
  /** Квесты главы по id */
  quests: { id: string; titleRu: string; status: 'completed' | 'active' | 'locked' }[];
  done: number;
  total: number;
  /** 0..1 */
  percent: number;
  /** Глава открыта (по уровню) */
  unlocked: boolean;
  /** Главы подряд перед ней закрыты — значит игрок ещё не готов */
  started: boolean;
  cutscenes: { id: string; titleRu: string; watched: boolean }[];
}

export interface StoryState {
  chapters: ChapterProgress[];
  /** Глава, в которой игрок сейчас (первая с незакрытым квестом) */
  currentChapterId: string | null;
  /** Всего пройдено сюжетных квестов */
  totalDone: number;
  totalQuests: number;
}

export class StoryService {
  private db = DatabaseService.getInstance();

  /** Статус всех квестов персонажа: questId -> 'active' | 'completed' */
  private async questStatuses(characterId: string): Promise<Map<string, 'active' | 'completed'>> {
    const rows = await this.db.query<{ quest_id: string; status: string }>(
      'SELECT quest_id, status FROM character_quests WHERE character_id = $1',
      [characterId]
    ).catch(() => []);
    return new Map(rows.map(r => [r.quest_id, r.status as 'active' | 'completed']));
  }

  async getState(characterId: string, level: number): Promise<StoryState> {
    const statuses = await this.questStatuses(characterId);
    const watched = await this.watchedCutscenes(characterId);

    // Просмотрена ли глава: все её квесты закрыты
    const isDone = (ch: ChapterDef) => ch.quests.every(q => statuses.get(q) === 'completed');
    const previousDone = new Set<string>();
    const chapters: ChapterProgress[] = [];

    for (const ch of [...CHAPTERS].sort((a, b) => a.order - b.order)) {
      const quests = ch.quests.map(id => ({
        id,
        titleRu: QUESTS_DATABASE[id]?.titleRu ?? id,
        status: statuses.get(id) ?? 'locked' as const,
      }));
      const done = quests.filter(q => q.status === 'completed').length;
      chapters.push({
        chapter: ch,
        quests,
        done,
        total: ch.quests.length,
        percent: ch.quests.length ? done / ch.quests.length : 0,
        unlocked: level >= ch.minLevel,
        // Глава «начата», если её предшественница закрыта или она сама открыта по уровню
        started: level >= ch.minLevel || previousDone.size > 0 && [...previousDone].some(p => p === prevId(ch)),
        cutscenes: ch.cutscenes.map(id => {
          const cs = CUTSCENES.find(c => c.id === id);
          return { id, titleRu: cs?.titleRu ?? id, watched: watched.has(id) };
        }),
      });
      if (isDone(ch)) previousDone.add(ch.id);
    }

    const current = chapters.find(c => !c.quests.every(q => q.status === 'completed')) ?? null;
    const totalQuests = chapters.reduce((a, c) => a + c.total, 0);
    const totalDone = chapters.reduce((a, c) => a + c.done, 0);

    return {
      chapters,
      currentChapterId: current?.chapter.id ?? null,
      totalDone,
      totalQuests,
    };
  }

  /**
   * Сцены к событию квеста. Возвращает сцену только если она ещё не
   * просмотрена — и сразу помечает просмотренной.
   */
  async takeCutscene(
    characterId: string,
    questId: string,
    trigger: 'accept' | 'complete'
  ): Promise<CutsceneDef | null> {
    const def = getCutsceneForQuest(questId, trigger);
    if (!def) return null;
    if (await this.hasWatched(characterId, def.id)) return null;
    await this.markWatched(characterId, def.id);
    logger.info(`[Story] ${characterId} посмотрел сцену ${def.id}`);
    return def;
  }

  private async hasWatched(characterId: string, cutsceneId: string): Promise<boolean> {
    const row = await this.db.queryOne<{ cutscene_id: string }>(
      'SELECT cutscene_id FROM character_cutscenes WHERE character_id = $1 AND cutscene_id = $2',
      [characterId, cutsceneId]
    ).catch(() => null);
    return !!row;
  }

  private async watchedCutscenes(characterId: string): Promise<Set<string>> {
    const rows = await this.db.query<{ cutscene_id: string }>(
      'SELECT cutscene_id FROM character_cutscenes WHERE character_id = $1',
      [characterId]
    ).catch(() => []);
    return new Set(rows.map(r => r.cutscene_id));
  }

  private async markWatched(characterId: string, cutsceneId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO character_cutscenes (character_id, cutscene_id, watched_at)
       VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`,
      [characterId, cutsceneId]
    ).catch((e) => logger.debug('[Story] Не отметить сцену просмотренной:', e));
  }

  /** Отметить сцену просмотренной вручную (кнопка «пропустить») */
  async markSkipped(characterId: string, cutsceneId: string): Promise<void> {
    await this.markWatched(characterId, cutsceneId);
  }
}

/** id предыдущей главы (для логики «начата») */
function prevId(ch: ChapterDef): string {
  const sorted = [...CHAPTERS].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex(c => c.id === ch.id);
  return i > 0 ? sorted[i - 1].id : '';
}
