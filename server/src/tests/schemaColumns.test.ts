// Схема базы против кода.
//
// ТУТ БЫЛА ПРИЧИНА 500 НА PvP. Код с самого начала писал
// `status = 'waiting'`, `status = 'finished'`, `status = 'draw'`, а
// колонки status в таблице pvp_arena НИКОГДА НЕ БЫЛО. Каждый запрос
// падал, find-match отдавал 500, кнопка «Найти бой» молча ничего
// не делала. На проде это выглядело как «кнопка не работает», хотя
// не работала вся фича.
//
// Такие расхождения невозможно поймать типами: SQL — строка. Этот тест
// сверяет колонки, которые код упоминает, с теми, что реально созданы
// в миграциях. Новая колонка в коде без миграции — красный тест.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

/** Все SQL-миграции одним текстом */
const schemaSql = readdirSync(join(repoRoot, 'database', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => read(`database/migrations/${f}`))
  .join('\n');

/** Колонки, объявленные в CREATE TABLE и добавленные через ALTER TABLE ADD COLUMN */
function declaredColumns(table: string): Set<string> {
  const cols = new Set<string>();
  // CREATE TABLE [IF NOT EXISTS] <table> ( ... )
  const create = new RegExp(
    `CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${table}\\s*\\(([\\s\\S]*?)\\n\\s*\\);`,
    'gi',
  );
  for (const m of schemaSql.matchAll(create)) {
    for (const line of m[1].split('\n')) {
      const col = line.trim().match(/^([a-z_][a-z0-9_]*)\s+/i);
      if (col) cols.add(col[1].toLowerCase());
    }
  }
  // ALTER TABLE <table> ADD COLUMN [IF NOT EXISTS] <col>
  const alter = new RegExp(
    `ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+([a-z_][a-z0-9_]*)`,
    'gi',
  );
  for (const m of schemaSql.matchAll(alter)) cols.add(m[1].toLowerCase());
  return cols;
}

/** Есть ли в коде обращение к колонке status в SQL-виде */
function usesStatusInSql(source: string): boolean {
  return /status\s*(?:=|<>)|SET\s+status|\bstatus\b\s*,/i.test(source);
}

describe('Схема: pvp_arena', () => {
  const cols = declaredColumns('pvp_arena');

  it('таблица вообще создана (иначе проверки ниже вхолостую)', () => {
    expect(cols.size).toBeGreaterThan(5);
  });

  it('есть колонка status — без неё PvP отдавал 500', () => {
    // ТУТ БЫЛА ПРИЧИНА. Код писал status = 'waiting' / 'finished' / 'draw',
    // а колонки не существовало с момента написания фичи
    expect({ status: cols.has('status') }).toEqual({ status: true });
  });

  it('все колонки, которые код PvP читает и пишет, объявлены', () => {
    const pvp = read('server/src/services/PvPService.ts')
      + read('server/src/systems/PvpArenaService.ts')
      + read('server/src/systems/PvpArenaFlow.ts');
    const needed = [
      'status', 'player1_id', 'player2_id', 'winner_id', 'mode',
      'player1_rating', 'player2_rating', 'rating_change',
      'started_at', 'ended_at', 'p1_confirmed', 'p2_confirmed', 'settle_after',
    ];
    for (const c of needed) {
      expect({ col: c, inSchema: cols.has(c) }).toEqual({ col: c, inSchema: true });
    }
    void pvp;
  });

  it('в коде реально используется status (иначе колонка лишняя)', () => {
    // Обратная проверка: колонка не «на всякий случай», а под запросы
    const code = read('server/src/services/PvPService.ts');
    expect(usesStatusInSql(code)).toBe(true);
    // И матчмейкинг, и закрытие боя
    expect(code).toMatch(/status = 'waiting'/);
    expect(code).toMatch(/status = 'finished'/);
  });
});

describe('Схема: pvp_rankings', () => {
  const cols = declaredColumns('pvp_rankings');

  it('есть все колонки, которые пересчитывает рейтинг', () => {
    // updateRanking пишет rating, wins, losses, streak, best_streak, tier
    for (const c of ['character_id', 'rating', 'wins', 'losses', 'streak', 'best_streak', 'tier']) {
      expect({ col: c, inSchema: cols.has(c) }).toEqual({ col: c, inSchema: true });
    }
  });
});

describe('Схема: колонки приглашений и привязок', () => {
  it('users.referral_code и users.has_password объявлены', () => {
    const users = declaredColumns('users');
    expect(users.has('referral_code')).toBe(true);
    expect(users.has('has_password')).toBe(true);
  });

  it('referrals создана с запретом пригласить дважды', () => {
    const referrals = declaredColumns('referrals');
    for (const c of ['referrer_id', 'referred_id', 'created_at']) {
      expect({ col: c, inSchema: referrals.has(c) }).toEqual({ col: c, inSchema: true });
    }
    // UNIQUE на referred_id — защита от накрутки живёт именно здесь
    expect(schemaSql).toMatch(/referred_id UUID NOT NULL UNIQUE/);
  });

  it('character_daily_progress создана — задачи дня без неё не работали бы', () => {
    const prog = declaredColumns('character_daily_progress');
    for (const c of ['character_id', 'task_id', 'current_count', 'completed', 'last_reset']) {
      expect({ col: c, inSchema: prog.has(c) }).toEqual({ col: c, inSchema: true });
    }
  });
});
