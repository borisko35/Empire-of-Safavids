// ============================================================
// NPC Intelligence System — Empire of Safavids
// ============================================================
// Интеллект НПС: динамические диалоги, реакция на квесты,
// случайные реплики, память о игроке.

export interface NpcContext {
  /** characterId игрока */
  characterId: string;
  /** Уровень игрока */
  characterLevel: number;
  /** Активные квесты игрока */
  activeQuestIds: string[];
  /** Завершённые квесты игрока */
  completedQuestIds: string[];
  /** Золото игрока */
  gold: number;
  /** Текущий регион игрока */
  region: string;
  /** Время суток (0-23) */
  gameHour: number;
  /** Кэшированный инвентарь { itemId: qty } — если передан, hasItem проверяется по нему без запроса в БД */
  inventory?: Record<string, number>;
}

export interface DynamicLine {
  id: string;
  textRu: string;
  choices?: DynamicChoice[];
  /** Условие показа реплики */
  when?: DynamicCondition;
  /** Как часто показывать (0-1, default 1.0) */
  frequency?: number;
}

export interface DynamicChoice {
  labelRu: string;
  nextId: string;
  action?: 'quest' | 'trade' | 'item' | 'move' | 'close' | 'knowledge';
  questId?: string;
  itemId?: string;
  /** Условие показа выбора */
  when?: DynamicCondition;
}

export interface DynamicCondition {
  /** Минимальный уровень игрока */
  minLevel?: number;
  /** Максимальный уровень игрока */
  maxLevel?: number;
  /** Квест должен быть активен */
  questActive?: string;
  /** Квест должен быть завершён */
  questCompleted?: string;
  /** NPC должен дать этот квест */
  questGiven?: string;
  /** NPC не должен давать этот квест */
  questNotGiven?: string;
  /** Игрок должен иметь предмет */
  hasItem?: string;
  /** Золото >= X */
  minGold?: number;
  /** Золото <= X */
  maxGold?: number;
  /** Region должен совпадать */
  regionMatch?: string;
  /** Время суток (час) */
  hour?: number;
  /** Неофицерское условие: функция-предикат */
  custom?: (ctx: NpcContext) => boolean;
}

/** Проверка условия — async т.к. hasItem требует запроса инвентаря */
export async function checkCondition(cond: DynamicCondition | undefined, ctx: NpcContext): Promise<boolean> {
  if (!cond) return true;
  if (cond.minLevel && ctx.characterLevel < cond.minLevel) return false;
  if (cond.maxLevel && ctx.characterLevel > cond.maxLevel) return false;
  if (cond.questActive && !ctx.activeQuestIds.includes(cond.questActive)) return false;
  if (cond.questCompleted && !ctx.completedQuestIds.includes(cond.questCompleted)) return false;
  if (cond.questGiven && !ctx.activeQuestIds.includes(cond.questGiven)) return false;
  if (cond.questNotGiven && ctx.activeQuestIds.includes(cond.questNotGiven)) return false;
  if (cond.hasItem) {
    if (ctx.inventory) {
      if (!ctx.inventory[cond.hasItem] || ctx.inventory[cond.hasItem] <= 0) return false;
    } else {
      try {
        const { CharacterService } = await import('./CharacterService');
        const svc = new CharacterService();
        const qty = await svc.getItemQuantities(ctx.characterId);
        if (!qty[cond.hasItem] || qty[cond.hasItem] <= 0) return false;
      } catch {
        return false;
      }
    }
  }
  if (cond.minGold && ctx.gold < cond.minGold) return false;
  if (cond.maxGold && ctx.gold > cond.maxGold) return false;
  if (cond.regionMatch && ctx.region !== cond.regionMatch) return false;
  if (cond.hour !== undefined && ctx.gameHour !== cond.hour) return false;
  if (cond.custom && !cond.custom(ctx)) return false;
  return true;
}

/** Синхронный вариант — использует только кэшированный inventory из ctx (для быстрых фильтраций без БД) */
export function checkConditionSync(cond: DynamicCondition | undefined, ctx: NpcContext): boolean {
  if (!cond) return true;
  if (cond.minLevel && ctx.characterLevel < cond.minLevel) return false;
  if (cond.maxLevel && ctx.characterLevel > cond.maxLevel) return false;
  if (cond.questActive && !ctx.activeQuestIds.includes(cond.questActive)) return false;
  if (cond.questCompleted && !ctx.completedQuestIds.includes(cond.questCompleted)) return false;
  if (cond.questGiven && !ctx.activeQuestIds.includes(cond.questGiven)) return false;
  if (cond.questNotGiven && ctx.activeQuestIds.includes(cond.questNotGiven)) return false;
  if (cond.hasItem) {
    if (ctx.inventory) {
      if (!ctx.inventory[cond.hasItem] || ctx.inventory[cond.hasItem] <= 0) return false;
    } else {
      // без кэша инвентаря — считаем что предмета нет (строгая проверка)
      return false;
    }
  }
  if (cond.minGold && ctx.gold < cond.minGold) return false;
  if (cond.maxGold && ctx.gold > cond.maxGold) return false;
  if (cond.regionMatch && ctx.region !== cond.regionMatch) return false;
  if (cond.hour !== undefined && ctx.gameHour !== cond.hour) return false;
  if (cond.custom && !cond.custom(ctx)) return false;
  return true;
}

/** Получить доступные реплики с учётом условий (async — учитывает hasItem) */
export async function getEligibleLines(
  lines: Record<string, DynamicLine>,
  ctx: NpcContext,
  filterBy?: string[],
): Promise<Map<string, DynamicLine>> {
  const result = new Map<string, DynamicLine>();
  for (const [id, line] of Object.entries(lines)) {
    if (filterBy && !filterBy.includes(id)) continue;
    if (await checkCondition(line.when, ctx)) {
      result.set(id, line);
    }
  }
  return result;
}

/** Синхронный вариант getEligibleLines — без запроса БД (требует inventory в ctx если есть hasItem) */
export function getEligibleLinesSync(
  lines: Record<string, DynamicLine>,
  ctx: NpcContext,
  filterBy?: string[],
): Map<string, DynamicLine> {
  const result = new Map<string, DynamicLine>();
  for (const [id, line] of Object.entries(lines)) {
    if (filterBy && !filterBy.includes(id)) continue;
    if (checkConditionSync(line.when, ctx)) {
      result.set(id, line);
    }
  }
  return result;
}

/** Выбрать случайную реплику из доступных с учётом частоты */
export function pickRandomLine(
  eligible: Map<string, DynamicLine>,
  excludeIds: string[] = [],
): string | null {
  const candidates = Array.from(eligible.entries())
    .filter(([id]) => !excludeIds.includes(id))
    .map(([id, line]) => ({
      id,
      line,
      weight: line.frequency ?? 1.0,
    }));

  if (candidates.length === 0) return null;

  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const c of candidates) {
    rand -= c.weight;
    if (rand <= 0) return c.id;
  }
  return candidates[candidates.length - 1].id;
}

/** Добавить случайную реплику в конец диалога */
export async function appendRandomLines(
  baseLines: Record<string, DynamicLine>,
  randomPool: Record<string, DynamicLine>,
  ctx: NpcContext,
  maxCount = 3,
): Promise<Record<string, DynamicLine>> {
  const eligible = await getEligibleLines(randomPool, ctx);
  const selected = Array.from(eligible.keys()).sort(() => Math.random() - 0.5).slice(0, maxCount);
  const result = { ...baseLines };
  for (const id of selected) {
    result[id] = { ...randomPool[id] };
  }
  return result;
}
