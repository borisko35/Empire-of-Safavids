// Воронка новичка и удержание D1/D7/D30.
//
// ЗАЧЕМ. У владельца был только DAU/MAU, а по ним не видно, где именно
// отваливаются люди: зашёл на сайт, застрял на экране входа, завёл
// персонажа, бросил на третьем уровне или вернулся через неделю. Всё это
// смотрится одинаково — «всё плохо».
//
// ЧТО СЧИТАЕМ. Когорта — люди, чей ПЕРВый вход (session_start, guest_login
// или player_login) попал в окно. Дальше для каждого из них смотрим, что
// он делал после этого первого входа:
//
//   начали            — первый вход в окне
//   завели персонажа  — событие character_created
//   дошли до 5/10/20  — событие level_up с to >= этого уровня
//
// ВАЖНО ПРО ДАННЫЕ. Событие session_start пишется с 29 сентября 2026
// (до него входа в мир не существовало в аналитике). Когорты, собранные до
// этой даты, покажут возвращения заниженными: часть игроков приходила по
// живой сессии и не оставляла событий. Такие когорты в отчёте помечены
// флагом full, и по ним нельзя читать D7/D30 как честные числа.
//
// ЕЩЁ ОДНА ЧЕСТНОСТЬ. Молодая когорта не «удерживается на 0%», а ещё не
// дожила до дня N: у когорты вчерашнего дня D7 неизвестен, и показывать 0%
// значит соврать. Такие значения возвращаются как null, а не как ноль.
import { DatabaseService } from './DatabaseService';

export const FUNNEL_LEVELS = [5, 10, 20] as const;

export interface FunnelCounts {
  started: number;
  withCharacter: number;
  levels: Record<number, number>;
}

export interface FunnelStep {
  /** Ключ шага: started / character / level5 / level10 … */
  step: string;
  titleRu: string;
  users: number;
  /** Доля от предыдущего шага, null если предыдущего шага ноль */
  fromPrevious: number | null;
  /** Доля от первого шага, null если первого шага ноль */
  fromStart: number | null;
}

export interface RetentionRow {
  /** День первого входа когорты, YYYY-MM-DD */
  day: string;
  users: number;
  /** Сколько вернулись ровно через N дней (0 — не вернулись) */
  d1: number;
  d7: number;
  d30: number;
}

export interface RetentionCohort {
  day: string;
  users: number;
  /** null = когорта ещё не дожила до этого дня, число было бы выдумкой */
  d1: number | null;
  d7: number | null;
  d30: number | null;
  /** false у когорт, собранных до появления session_start: по ним D7/D30 занижены */
  full: boolean;
}

export interface RetentionReport {
  from: string;
  to: string;
  cohorts: RetentionCohort[];
  totals: {
    users: number;
    d1: number | null;
    d7: number | null;
    d30: number | null;
  };
  /** Когорты, у которых хотя бы один из D1/D7/D30 ещё неизвестен */
  incompleteCohorts: number;
}

const RETENTION_DAYS = [1, 7, 30] as const;

/** День в виде YYYY-MM-DD по UTC — так же, как его отдаёт Postgres */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Через сколько дней после `day` наступит `offset` */
export function shiftDay(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return isoDay(d);
}

const share = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

/**
 * Собирает шаги воронки из сырых счётчиков.
 *
 * Считает доли от предыдущего шага, а не от первого: воронка показывает
 * именно провал между соседними шагами («из трёхсот завели персонаж
 * половина» — и видно, что половина).
 */
export function buildFunnelSteps(counts: FunnelCounts): FunnelStep[] {
  const steps: FunnelStep[] = [
    { step: 'started', titleRu: 'Зашли в игру', users: counts.started, fromPrevious: null, fromStart: null },
    { step: 'character', titleRu: 'Завели персонажа', users: counts.withCharacter, fromPrevious: null, fromStart: null },
  ];
  for (const level of FUNNEL_LEVELS) {
    steps.push({
      step: `level${level}`,
      titleRu: `Дошли до ${level} уровня`,
      users: counts.levels[level] ?? 0,
      fromPrevious: null,
      fromStart: null,
    });
  }
  // Доли считаем после того, как шаги собраны: предыдущий шаг всегда найден
  let prev = 0;
  for (const s of steps) {
    s.fromPrevious = s.step === 'started' ? null : share(s.users, prev);
    s.fromStart = share(s.users, counts.started);
    prev = s.users;
  }
  return steps;
}

/**
 * Когорты удержания с честными «неизвестно» вместо нулей.
 *
 * today — день, на который считаем. Когорта моложе N дней не может иметь
 * D N: возврата ещё не было, но «не было» здесь означает «ещё не могло
 * быть», а не «игрок не вернулся».
 */
export function buildRetention(rows: RetentionRow[], today: string, sessionStartSince: string): RetentionReport {
  const cohorts: RetentionCohort[] = rows.map(r => {
    const cohort = { day: r.day, users: r.users, full: r.day >= sessionStartSince } as RetentionCohort;
    for (const d of RETENTION_DAYS) {
      const observed = r.day >= sessionStartSince && shiftDay(r.day, d) <= today;
      cohort[`d${d}`] = observed ? share(Number((r as unknown as Record<string, number>)[`d${d}`]) ?? 0, r.users) : null;
    }
    return cohort;
  });

  // Итоги по всем когортам сразу считать нельзя: у части когорт D7 ещё
  // неизвестен, и усреднение выдало бы за ними настоящие нули. Поэтому итог
  // по дню N считаем только по когортам, которые этот день уже прожили.
  const totals = { users: 0, ...Object.fromEntries(RETENTION_DAYS.map(d => [`d${d}`, null as number | null])) } as RetentionReport['totals'];
  for (const c of cohorts) totals.users += c.users;
  for (const d of RETENTION_DAYS) {
    const mature = cohorts.filter(c => c[`d${d}`] !== null);
    if (!mature.length) continue;
    const users = mature.reduce((a, c) => a + c.users, 0);
    const kept = mature.reduce((a, c) => a + (c.users * (c[`d${d}`] as number)) / 100, 0);
    totals[`d${d}`] = users > 0 ? Math.round((kept / users) * 1000) / 10 : null;
  }

  return {
    from: rows.length ? rows[0].day : '',
    to: today,
    cohorts,
    totals,
    incompleteCohorts: cohorts.filter(c => RETENTION_DAYS.some(d => c[`d${d}`] === null)).length,
  };
}

export class PlayerFunnelService {
  private db = DatabaseService.getInstance();

  /**
   * Когорта = первый вход в окне. Активность на N-й день — любой вход
   * (session_start, player_login, guest_login): до появления session_start
   * вход по живой сессии не писался, и если считать только форму, старые
   * когорты выглядели бы мёртвыми.
   */
  async getRetention(cohortDays: number, today: Date, sessionStartSince: string): Promise<RetentionReport> {
    const to = isoDay(today);
    const from = shiftDay(to, -Math.max(0, cohortDays - 1));
    const rows = await this.db.query<RetentionRow>(
      `WITH first_day AS (
         SELECT user_id, MIN(DATE(timestamp)) AS day
         FROM analytics_events
         WHERE user_id IS NOT NULL
           AND event IN ('session_start','guest_login','player_login')
         GROUP BY user_id
       ),
       active AS (
         SELECT DISTINCT user_id, DATE(timestamp) AS day
         FROM analytics_events
         WHERE event IN ('session_start','guest_login','player_login')
       )
       SELECT to_char(f.day, 'YYYY-MM-DD') AS day,
              COUNT(*) AS users,
              COUNT(*) FILTER (WHERE a1.user_id IS NOT NULL) AS d1,
              COUNT(*) FILTER (WHERE a7.user_id IS NOT NULL) AS d7,
              COUNT(*) FILTER (WHERE a30.user_id IS NOT NULL) AS d30
       FROM first_day f
       LEFT JOIN active a1  ON a1.user_id  = f.user_id AND a1.day  = f.day + 1
       LEFT JOIN active a7  ON a7.user_id  = f.user_id AND a7.day  = f.day + 7
       LEFT JOIN active a30 ON a30.user_id = f.user_id AND a30.day = f.day + 30
       WHERE f.day BETWEEN $1 AND $2
       GROUP BY f.day
       ORDER BY f.day`,
      [from, to],
    );
    return buildRetention(rows as unknown as RetentionRow[], to, sessionStartSince);
  }

  /** Воронка: зашли → персонаж → уровни */
  async getFunnel(cohortDays: number, today: Date): Promise<{ windowDays: number; from: string; to: string; steps: FunnelStep[] }> {
    const to = isoDay(today);
    const from = shiftDay(to, -Math.max(0, cohortDays - 1));
    const row = await this.db.queryOne<{ started: string; with_character: string } & Record<string, string>>(
      `WITH first_seen AS (
         SELECT user_id
         FROM analytics_events
         WHERE user_id IS NOT NULL
           AND event IN ('session_start','guest_login','player_login')
           AND timestamp >= $1
         GROUP BY user_id
       )
       SELECT COUNT(DISTINCT f.user_id) AS started,
              COUNT(DISTINCT CASE WHEN e.event = 'character_created' THEN f.user_id END) AS with_character,
              ${FUNNEL_LEVELS.map(l =>
                `COUNT(DISTINCT CASE WHEN e.event = 'level_up'
                   AND e.properties ? 'to' AND (e.properties->>'to') ~ '^[0-9]+$'
                   AND (e.properties->>'to')::int >= ${l} THEN f.user_id END) AS level${l}`,
              ).join(',\n              ')}
       FROM first_seen f
       LEFT JOIN analytics_events e
         ON e.user_id = f.user_id AND e.timestamp >= $1`,
      [from],
    );

    const started = Number(row?.started ?? 0);
    const levels: Record<number, number> = {};
    for (const l of FUNNEL_LEVELS) levels[l] = Number((row as unknown as Record<string, string> | undefined)?.[`level${l}`] ?? 0);

    return {
      windowDays: cohortDays,
      from,
      to,
      steps: buildFunnelSteps({ started, withCharacter: Number(row?.with_character ?? 0), levels }),
    };
  }

  /** Активные игроки по дням — чтобы увидеть кривую, а не одно число */
  async getActiveSeries(days: number, today: Date): Promise<{ day: string; logins: number; sessions: number }[]> {
    const to = isoDay(today);
    const from = shiftDay(to, -Math.max(0, days - 1));
    return this.db.query<{ day: string; logins: number; sessions: number }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day,
              COALESCE(l.cnt, 0) AS logins,
              COALESCE(s.cnt, 0) AS sessions
       FROM generate_series($1::date, $2::date, '1 day') d
       LEFT JOIN (
         SELECT DATE(timestamp) AS day, COUNT(DISTINCT user_id) AS cnt
         FROM analytics_events WHERE event = 'player_login' GROUP BY 1
       ) l ON l.day = d
       LEFT JOIN (
         SELECT DATE(timestamp) AS day, COUNT(DISTINCT user_id) AS cnt
         FROM analytics_events WHERE event = 'session_start' GROUP BY 1
       ) s ON s.day = d
       ORDER BY d`,
      [from, to],
    );
  }
}

export const playerFunnel = new PlayerFunnelService();
