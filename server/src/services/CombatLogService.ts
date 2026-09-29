// Журнал боёв: кто, кого, сколько урона, критический ли удар, где.
//
// ЗАЧЕМ. Таблица combat_logs была создана ещё в первой миграции, со всей
// схемой: атакующий, цель, навык, урон, крит, признак PvP, регион, время.
// И при этом в неё НИКТО НИКОГДА НЕ ПИСАЛ - она оставалась пустой все
// месяцы. Пункт плана звучал «журналирование боёв - таблица плюс запись
// урона», но таблица была уже готова: не хватало самой записи.
//
// СПОРЫ. Для разбора «он меня убил нечестно» нужна построчная история урона
// между игроками. Поэтому каждый удар PvP пишется целиком.
//
// БАЛАНС. Чтобы понять, что босс или элита стоит стеной, нужен урон по ним.
// Обычный мусор писать не будем: это самый потоковый вид удара, и в цифрах
// он ничего не решает. Пишем PvE по элитам и боссам - ровно то, о чём
// жалуются. Обычные монстры остаются без записи.
//
// ПОЧЕМУ НЕ БУФЕР, А ПРЯМАЯ ЗАПИСЬ. PvP-удары редки, элиты тоже не каждый
// бой. Прямая вставка даёт честный журнал сразу после боя: если сервер
// упадёт через две секунды, в журнале уже есть всё, что было до падения,
// и не приходится гадать, что потерялось.
//
// ПОЧЕМУ ОШИБКА ЗАПИСИ НЕ ЛОМАЕТ БОЙ. Запись урона - наблюдение, а не
// условие боя. Если база мигнула, игрок не должен за это расплачиваться
// боем: ошибка уходит в лог и проглатывается.
import { DatabaseService } from './DatabaseService';
import { logger } from '../utils/logger';

export interface CombatLogEntry {
  attackerId: string;
  /** UUID персонажа-цели. Для монстра null - у него нет своего id */
  targetId: string | null;
  /** Мирокаб для PvE. У монстра это 'mob_bandit_scout_1756500000000_a3f9x' */
  targetInstance: string | null;
  /** Тип цели: player или monster */
  targetKind: 'player' | 'monster';
  /** Имя цели, чтобы журнал читался глазами, а не по UUID */
  targetName: string | null;
  skillId: string | null;
  damage: number;
  isCritical: boolean;
  isPvp: boolean;
  region: string;
}

/**
 * Решение «писать ли этот удар» и с какими полями — вынесено отдельно от
 * самой записи, чтобы его можно было проверить без базы и без сокета.
 *
 * ПОЧЕМУ НЕ В ОБРАБОТЧИКЕ. Правило «пишем PvP целиком, PvE только по элитам
 * и боссам» - это и есть смысл журнала. Если оно живёт внутри
 * GameSocketHandler, единственная способность его проверить - поиск по
 * тексту файла, а такой проверке всё равно, писать монстрам или нет: она
 * находит строку `type !== 'normal'` и на этом успокаивается. Проверка,
 * которая не может упасть, хуже отсутствующей.
 */
export interface CombatLogInput {
  attackerId: string;
  target:
    | { kind: 'player'; id: string; name: string }
    /** monsterType — из каталога монстров: normal, elite или boss */
    | { kind: 'monster'; instanceId: string; name: string; monsterType: string };
  skillId: string | undefined;
  damage: number;
  isCritical: boolean;
  region: string;
}

/**
 * Собрать запись об ударе или null, если бить нечего.
 *
 * null - это решение, а не ошибка: обычный мусор пишется осознанно.
 */
export function buildCombatLogEntry(input: CombatLogInput): CombatLogEntry | null {
  const { target } = input;
  const isPvp = target.kind === 'player';

  // Обычных монстров не пишем: они самый потоковый вид удара, и в цифрах
  // они ничего не решают. Жалобы «босс стоит стеной» идут по элитам.
  if (!isPvp && target.kind === 'monster' && target.monsterType === 'normal') return null;

  return {
    attackerId: input.attackerId,
    // У монстра нет своего UUID, поэтому в target_id он не поместится
    targetId: target.kind === 'player' ? target.id : null,
    targetInstance: target.kind === 'monster' ? target.instanceId : null,
    targetKind: target.kind,
    targetName: target.name,
    skillId: input.skillId ?? null,
    damage: input.damage,
    isCritical: input.isCritical,
    isPvp,
    region: input.region,
  };
}

export interface CombatLogSummary {
  dealt: { hits: number; damage: number; criticals: number };
  taken: { hits: number; damage: number; criticals: number };
  bySkill: { skillId: string; hits: number; damage: number }[];
  byTarget: { targetName: string; targetKind: string; hits: number; damage: number }[];
}

export interface CombatLogRow {
  logged_at: string;
  attacker_id: string;
  attacker_name: string;
  target_kind: string;
  target_name: string | null;
  target_id: string | null;
  skill_id: string | null;
  damage: number;
  is_critical: boolean;
  is_pvp: boolean;
  region: string;
}

export class CombatLogService {
  private db = DatabaseService.getInstance();

  /**
   * Записать один удар.
   *
   * Принимает null и молча выходит: null - это решение «бить нечего»
   * (см. buildCombatLogEntry), а не ошибка. Если бы запись требовала
   * проверки на стороне вызова, рано или поздно в одном из двух мест
   * боя её забыли бы, и обычный мусор пошёл бы в журнал либо, что хуже,
   * попытка вставить null роняла бы удар.
   *
   * Ошибку глушим намеренно: журнал не должен влиять на бой. Иначе один
   * сбой базы превращает все удары в игре в ошибки, и вместо наблюдателя
   * получается новая причина поломок.
   */
  async record(entry: CombatLogEntry | null): Promise<void> {
    if (!entry) return;
    try {
      await this.db.query(
        `INSERT INTO combat_logs
           (attacker_id, target_id, target_instance, target_kind, target_name,
            skill_id, damage, is_critical, is_pvp, region)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          entry.attackerId,
          entry.targetId,
          entry.targetInstance,
          entry.targetKind,
          entry.targetName,
          entry.skillId,
          entry.damage,
          entry.isCritical,
          entry.isPvp,
          entry.region,
        ],
      );
    } catch (err) {
      logger.warn('[CombatLog] запись не удалась:', (err as Error).message);
    }
  }

  /**
   * История боёв персонажа: что он наносил и что получал.
   *
   * Это и есть ответ на вопрос «разбери спор». Возвращаются и строки, и
   * сводка: владельцу нужен итог, игроку - подробности.
   */
  async getForCharacter(characterId: string, days: number): Promise<{
    rows: CombatLogRow[];
    summary: CombatLogSummary;
  }> {
    // Срок обязателен и применяется к запросу. Первая версия принимала его
    // в подписи и молча не использовала: вопрос «что было в бою» получал
    // ответ за всю историю, и найти среди неё нужный бой было нечем. Плюс
    // границы: без них во входных данных вида days=-1 получился бы запрос
    // «за всё, что есть до сих пор», а при days=999999 — попытка вычитать
    // сантионное поле.
    const from = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 7;

    const rows = await this.db.query<CombatLogRow>(
      `SELECT to_char(c.logged_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS logged_at,
              c.attacker_id, a.name AS attacker_name,
              c.target_kind, c.target_name, c.target_id, c.skill_id,
              c.damage, c.is_critical, c.is_pvp, c.region
       FROM combat_logs c
       LEFT JOIN characters a ON a.id = c.attacker_id
       WHERE (c.attacker_id = $1 OR c.target_id = $1)
         AND c.logged_at >= NOW() - ($2 || ' days')::interval
       ORDER BY c.logged_at DESC
       LIMIT 500`,
      [characterId, String(from)],
    );

    const dealt = { hits: 0, damage: 0, criticals: 0 };
    const taken = { hits: 0, damage: 0, criticals: 0 };
    const bySkill = new Map<string, { hits: number; damage: number }>();
    const byTarget = new Map<string, { targetKind: string; hits: number; damage: number }>();

    for (const r of rows) {
      const isDealt = r.attacker_id === characterId;
      const side = isDealt ? dealt : taken;
      side.hits++;
      side.damage += r.damage;
      if (r.is_critical) side.criticals++;

      if (isDealt) {
        const skill = r.skill_id ?? '—';
        const cur = bySkill.get(skill) ?? { hits: 0, damage: 0 };
        cur.hits++; cur.damage += r.damage;
        bySkill.set(skill, cur);

        const name = r.target_name ?? (r.target_kind === 'monster' ? r.target_id ?? '—' : '—');
        const curT = byTarget.get(name) ?? { targetKind: r.target_kind, hits: 0, damage: 0 };
        curT.hits++; curT.damage += r.damage;
        byTarget.set(name, curT);
      }
    }

    return {
      rows,
      summary: {
        dealt,
        taken,
        bySkill: [...bySkill.entries()]
          .map(([skillId, v]) => ({ skillId, ...v }))
          .sort((x, y) => y.damage - x.damage),
        byTarget: [...byTarget.entries()]
          .map(([targetName, v]) => ({ targetName, ...v }))
          .sort((x, y) => y.damage - x.damage),
      },
    };
  }
}

export const combatLog = new CombatLogService();
