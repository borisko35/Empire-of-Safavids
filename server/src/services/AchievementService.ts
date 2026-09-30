// ============================================================
// Achievement Service — Empire of Safavids
// ============================================================

import { DatabaseService } from './DatabaseService';
import { POETRY_CHALLENGES } from '../systems/PoetryOfHafiz';
import { logger } from '../utils/logger';

export interface AchievementDef {
  id: string; title: string; title_ru: string;
  description: string; description_ru: string;
  category: string; icon: string;
  reward_gold: number; reward_experience: number;
  reward_title?: string; reward_item_id?: string;
  hidden: boolean;
  /**
   * Условие, по которому достижение выдаётся.
   *
   * ЗАЧЕМ ЭТО ПОЯВИЛОСЬ. Условий не было ни у одного из двадцати
   * достижений, а `checkAndUnlock` условие не проверял: он брал что
   * попросят и выдавал награду. Панель честно показывала «0 / 20» и
   * показывала бы вечно, потому что звать выдачу было неоткуда.
   *
   * ПОЧЕМУ СЧЁТЧИК, А НЕ ФЛАГ. Флаг «достижение выдано» ничего не
   * говорит о том, выполнено ли условие, и его пришлось бы ставить
   * вручную из кода события. Счётчик же даёт прогресс: игрок видит
   * «7 / 10», а не «не выполнено».
   *
   * НЕТ УСЛОВИЯ = ДОСТИЖЕНИЕ НЕ ВЫДАЁТСЯ. Так и должно быть: у
   * «Мастера Кузнеца» счётчика крафтов в базе нет, и выдать его
   * нечем. Такое достижение честно помечается как несчитанное, а не
   * выдаётся за выполненное.
   */
  /**
   * Условие выдачи.
   *
   * Два вида, а не один: счётчик копится событиями и лежит в
   * leaderboard, состояние пересчитывается из своей таблицы. Смешивать
   * их в одном поле означало бы, что любое условие можно случайно
   * измерить не тем способом.
   *
   * ПОЧЕМУ ОБЯЗАТЕЛЬНОЕ ПОЛЕ, А НЕ НЕОБЯЗАТЕЛЬНОЕ. Достижение без
   * условия выдать нечем, и checkAndUnlock отказывает. Такое достижение
   * честно остаётся недостижимым, и панель пишет «пока не считается».
   */
  condition?: { counter: AchievementCounter; need: number }
             | { state: AchievementState; need: number };
}

/**
 * Сколько стихотворений в игре вообще.
 *
 * Порог достижения «Поэт Шираза» берётся отсюда, а не пишется руками.
 * Написать «20» отдельно от числа стихов - значит через год получить
 * достижение, которое либо недостижимо, либо выдастся само, когда
 * стихотворений окажется меньше.
 */
export const POETRY_TOTAL = POETRY_CHALLENGES.length;

/**
 * Счётчики, на которые смотрят достижения.
 *
 * ЗАКРЫТЫЙ СПИСОК, А НЕ СТРОКА. Имя колонки приходит из кода, и если бы
 * оно подставлялось в SQL как есть, то и опечатка, и подстановка чужого
 * имени прошли бы мимо typecheck. Здесь ключ - единственный ключ, а
 * колонка берётся только из этого списка.
 */
export type AchievementCounter =
  | 'monsters_killed'
  | 'parries'
  | 'pvp_wins'
  | 'quests_completed'
  | 'poetry_completed'
  | 'chess_wins'
  | 'dungeons_cleared'
  | 'items_crafted'
  | 'trades_completed'
  | 'world_boss_kills';

/**
 * Условия, которые не счётчик, а состояние.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ СЧЁТЧИКОВ. Счётчик копится сложением в момент
 * события: убил монстра - плюс один, и число живёт в leaderboard. А
 * «есть друг» и «состоишь в гильдии» - не накопительные числа, а признак
 * текущего положения дел. Они не растут и не убывают при событии, их
 * надо пересчитывать. Считать их тем же счётчиком значило бы завести в
 * leaderboard колонку «друзей», которую кто-то должен был бы честно
 * уменьшать при удалении друга - а удаление друга происходит одним
 * DELETE, и минус в счётчике не был бы записан.
 *
 * ЧТО ТУТ НЕ МОЖЕТ СЛУЧИТЬСЯ. Состояние нельзя накрутить событием,
 * которого не было: оно читается из таблиц, где строки заводятся самими
 * этими событиями.
 */
export type AchievementState = 'has_friend' | 'in_guild';

/** Всё, чем измеряется выполнение условия. */
export type AchievementMeasure = AchievementCounter | AchievementState;

/**
 * Состояние -> запрос, который его считает. Больше ниоткуда.
 *
 * Имена таблиц и колонок здесь, а не в местах использования: подстановка
 * произвольного имени прошла бы мимо typecheck, а именно тут имя колонки
 * и должно быть написано один раз.
 *
 * Про has_friend. Друзья в базе привязаны к АККАУНТУ (users.id), а не к
 * персонажу, поэтому состояние достаёт владельца персонажа подзапросом.
 * И берутся только status = 'accepted': отправленное приглашение, на
 * которое ещё не ответили, другом не является.
 */
export const STATE_SOURCE: Record<AchievementState, string> = {
  has_friend: `SELECT count(*) FROM friends
                WHERE user_id = (SELECT user_id FROM characters WHERE id = $1)
                  AND status = 'accepted'`,
  in_guild: 'SELECT count(*) FROM guild_members WHERE character_id = $1',
};

/** Счётчик -> колонка таблицы leaderboard. Больше ниоткуда. */
export const COUNTER_COLUMN: Record<AchievementCounter, string> = {
  monsters_killed: 'monsters_killed',
  parries: 'parries',
  pvp_wins: 'pvp_wins',
  quests_completed: 'quests_completed',
  poetry_completed: 'poetry_completed',
  chess_wins: 'chess_wins',
  dungeons_cleared: 'dungeons_cleared',
  items_crafted: 'items_crafted',
  trades_completed: 'trades_completed',
  world_boss_kills: 'world_boss_kills',
};

/**
 * Выполнено ли условие.
 *
 * Чистая функция: ради неё написан тест, который перебирает границы.
 * Условие «меньше либо равно» вместо «меньше» или «строго больше»
 * не видно ни в описании достижения, ни в панели, а стоит одного
 * достижения на ровно нужном счётчике.
 *
 * Счётчики и состояния приходят в одном объекте: и то и другое - числа,
 * и isEarned не должна знать, откуда взялось число. Иначе проверка была бы
 * не чистой функцией, а половиной базы.
 */
export function isEarned(
  def: AchievementDef,
  measures: Partial<Record<AchievementMeasure, number>>,
): boolean {
  const условие = def.condition;
  if (!условие) return false;
  const ключ = 'counter' in условие ? условие.counter : условие.state;
  const current = Number(measures[ключ] ?? 0);
  return Number.isFinite(current) && current >= условие.need;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // ── БОЙ ──────────────────────────────────────────────
  // Условие есть только там, где счётчик действительно копится.
  // У достижений без строки condition счётчика в базе нет, и выдать их
  // нечем - см. условие в checkAndUnlock.
  { id: 'ach_first_blood', title: 'First Blood', title_ru: 'Первая Кровь',
    description: 'Kill your first monster', description_ru: 'Убить первого монстра',
    category: 'combat', icon: '⚔️', reward_gold: 50, reward_experience: 100, hidden: false,
    condition: { counter: 'monsters_killed', need: 1 } },
  { id: 'ach_monster_hunter_10', title: 'Monster Hunter', title_ru: 'Охотник на Монстров',
    description: 'Kill 10 monsters', description_ru: 'Убить 10 монстров',
    category: 'combat', icon: '🗡️', reward_gold: 100, reward_experience: 200, hidden: false,
    condition: { counter: 'monsters_killed', need: 10 } },
  { id: 'ach_monster_hunter_100', title: 'Monster Slayer', title_ru: 'Истребитель Монстров',
    description: 'Kill 100 monsters', description_ru: 'Убить 100 монстров',
    category: 'combat', icon: '💀', reward_gold: 500, reward_experience: 1000, reward_title: 'Истребитель', hidden: false,
    condition: { counter: 'monsters_killed', need: 100 } },
  { id: 'ach_monster_hunter_1000', title: 'Legendary Slayer', title_ru: 'Легендарный Истребитель',
    description: 'Kill 1000 monsters', description_ru: 'Убить 1000 монстров',
    category: 'combat', icon: '👑', reward_gold: 5000, reward_experience: 10000, reward_title: 'Легенда Боя', hidden: false,
    condition: { counter: 'monsters_killed', need: 1000 } },
  // Комбо и боссы: счётчиков нет. Пока их нет, выдать нечего, и
  // достижение остаётся недостижимым - честнее, чем выдать за 100 золота.
  // НЕ СЧИТАЕТСЯ. Цепочка ударов живёт в памяти (comboChains в
  // GameSocketHandler) и её длина - это МАКСИМУМ за окно, а не сумма.
  // Две серии по три удара дали бы сложением шесть, а «комбо из 5» - это
  // одна серия длиной пять. Счётчик-максимум в increment не умеет и был
  // бы отдельной сущностью со своим правилом записи: записи могли бы
  // расходиться, и тогда счётчик врал бы сам себе.
  { id: 'ach_combo_5', title: 'Combo Master', title_ru: 'Мастер Комбо',
    description: 'Land a 5-hit combo', description_ru: 'Нанести комбо из 5 ударов',
    category: 'combat', icon: '🔥', reward_gold: 100, reward_experience: 150, hidden: false },
  { id: 'ach_perfect_block', title: 'Perfect Block', title_ru: 'Идеальный Блок',
    description: 'Perform 10 perfect blocks', description_ru: 'Выполнить 10 идеальных блоков',
    category: 'combat', icon: '🛡️', reward_gold: 200, reward_experience: 300, hidden: false,
    condition: { counter: 'parries', need: 10 } },
  // РАНЬШЕ Я НАПИСАЛ ЗДЕСЬ, ЧТО СИСТЕМЫ НЕТ. ЭТО БЫЛО НЕПРАВДОЙ.
  // Поиск вёлся по двум файлам (data/dungeons.ts и systems/DungeonService.ts),
  // а вывод делался по всему проекту. На деле мировые боссы есть и работают:
  // WorldEventSystem создаётся в GameLoop, init/start/loadSchedule
  // вызываются, спавны Симурга и Рустама заданы в SpawnSystem, победы
  // пишутся в world_boss_kills (миграция 002, колонка character_id
  // добавлена в 041), зал славы их читает.
  //
  // Отсутствие счётчика не значит отсутствие боссов.
  { id: 'ach_boss_slayer', title: 'Boss Slayer', title_ru: 'Убийца Боссов',
    description: 'Kill your first world boss', description_ru: 'Убить первого мирового босса',
    category: 'combat', icon: '👑', reward_gold: 1000, reward_experience: 1000, reward_title: 'Охотник на Боссов', hidden: false,
    condition: { counter: 'world_boss_kills', need: 1 } },

  // ── ИССЛЕДОВАНИЕ ─────────────────────────────────────
  // Регионы, подземелья и друзья: счётчиков нет, выдать нечем.
  // ЛОВУШКА, КОТОРАЯ ЕЩЁ НЕ ЗАМКНУТА. Регион стоит по умолчанию ровно
  // в «tabriz» (миграция 001), поэтому проверка characters.region =
  // «tabriz» была бы верной с момента регистрации, и достижение
  // выдавалось бы бесплатно, никто никуда не сходив. Чтобы условие было
  // честным, нужен список посещений - отдельная таблица. Её нет.
  { id: 'ach_explorer_tabriz', title: 'Discoverer of Tabriz', title_ru: 'Первооткрыватель Тебриза',
    description: 'Visit Tabriz', description_ru: 'Посетить Тебриз',
    category: 'exploration', icon: '🗺️', reward_gold: 50, reward_experience: 50, hidden: false },
  // НЕ СЧИТАЕТСЯ. Нужен список посещённых регионов, а не текущий
  // регион: «посетить все семь» нельзя вывести из одного столбца, в
  // котором лежит только то, где персонаж сейчас.
  { id: 'ach_explorer_all', title: 'Master of Maps', title_ru: 'Повелитель Карт',
    description: 'Visit all 7 regions', description_ru: 'Посетить все 7 регионов',
    category: 'exploration', icon: '🌍', reward_gold: 1000, reward_experience: 2000, reward_title: 'Странник Миров', hidden: false },
  { id: 'ach_dungeon_first', title: 'Dungeon Delver', title_ru: 'Исследователь Подземелий',
    description: 'Complete your first dungeon', description_ru: 'Пройти первое подземелье',
    category: 'exploration', icon: '🏰', reward_gold: 200, reward_experience: 400, hidden: false,
    condition: { counter: 'dungeons_cleared', need: 1 } },

  // ── СОЦИАЛЬНОЕ ───────────────────────────────────────
  { id: 'ach_first_friend', title: 'Friendly', title_ru: 'Дружелюбный',
    description: 'Add your first friend', description_ru: 'Добавить первого друга',
    category: 'social', icon: '👥', reward_gold: 50, reward_experience: 50, hidden: false,
    condition: { state: 'has_friend', need: 1 } },
  { id: 'ach_guild_member', title: 'Guild Member', title_ru: 'Член Гильдии',
    description: 'Join a guild', description_ru: 'Вступить в гильдию',
    category: 'social', icon: '🏴', reward_gold: 100, reward_experience: 100, hidden: false,
    condition: { state: 'in_guild', need: 1 } },
  { id: 'ach_pvp_first', title: 'Gladiator', title_ru: 'Гладиатор',
    description: 'Win your first PvP match', description_ru: 'Выиграть первый PvP-бой',
    category: 'social', icon: '🏟️', reward_gold: 200, reward_experience: 300, hidden: false,
    condition: { counter: 'pvp_wins', need: 1 } },

  // ── КРАФТ / ТОРГОВЛЯ ─────────────────────────────────
  { id: 'ach_first_craft', title: 'Apprentice Crafter', title_ru: 'Ученик Кузнеца',
    description: 'Craft your first item', description_ru: 'Скрафтить первый предмет',
    category: 'crafting', icon: '🔨', reward_gold: 50, reward_experience: 50, hidden: false,
    condition: { counter: 'items_crafted', need: 1 } },
  { id: 'ach_craft_master', title: 'Master Crafter', title_ru: 'Мастер Крафта',
    description: 'Craft 50 items', description_ru: 'Скрафтить 50 предметов',
    category: 'crafting', icon: '⚒️', reward_gold: 500, reward_experience: 1000, reward_title: 'Мастер Ремесла', hidden: false,
    condition: { counter: 'items_crafted', need: 50 } },
  { id: 'ach_trader', title: 'Silk Road Trader', title_ru: 'Торговец Шёлкового Пути',
    description: 'Complete 10 trade contracts', description_ru: 'Выполнить 10 торговых контрактов',
    category: 'crafting', icon: '💰', reward_gold: 300, reward_experience: 500, hidden: false,
    // Число 10 взято из описания «выполнить 10 торговых контрактов».
    condition: { counter: 'trades_completed', need: 10 } },

  // ── КВЕСТЫ ───────────────────────────────────────────
  { id: 'ach_quest_10', title: 'Adventurer', title_ru: 'Авантюрист',
    description: 'Complete 10 quests', description_ru: 'Выполнить 10 квестов',
    category: 'questing', icon: '📜', reward_gold: 200, reward_experience: 500, hidden: false,
    condition: { counter: 'quests_completed', need: 10 } },
  { id: 'ach_quest_50', title: 'Hero of the Empire', title_ru: 'Герой Империи',
    description: 'Complete 50 quests', description_ru: 'Выполнить 50 квестов',
    category: 'questing', icon: '🏆', reward_gold: 1000, reward_experience: 3000, reward_title: 'Герой Империи', hidden: false,
    condition: { counter: 'quests_completed', need: 50 } },

  // ── СЕКРЕТНЫЕ ────────────────────────────────────────
  { id: 'ach_chess_master', title: 'Chess Master', title_ru: 'Шахматный Гений',
    description: 'Win 10 chess games', description_ru: 'Выиграть 10 шахматных партий',
    category: 'minigames', icon: '♟️', reward_gold: 500, reward_experience: 500, reward_title: 'Шахматный Гений', hidden: true,
    // Число 10 взято из описания, а не выдумано: «выиграть 10 шахматных
    // партий» было написано и раньше, но условия не было - пункт значился
    // как «пока не считается».
    condition: { counter: 'chess_wins', need: 10 } },
  { id: 'ach_poet', title: 'Poet of Shiraz', title_ru: 'Поэт Шираза',
    description: 'Complete all poetry challenges', description_ru: 'Выполнить все поэтические задания',
    category: 'minigames', icon: '📜', reward_gold: 1000, reward_experience: 1000, reward_title: 'Поэт Шираза', hidden: true,
    condition: { counter: 'poetry_completed', need: POETRY_TOTAL } },
  // НЕ ИЗМЕРИМО. В DungeonService нет ни счётчика смертей, ни поля в
  // сессии: подземелье просто закрывается. Условие потребовало бы начать
  // считать смерти в каждой сессии подземелья - это правка в системе
  // подземелий, а не достижение.
  { id: 'ach_no_death', title: 'Untouchable', title_ru: 'Неприкосновенный',
    description: 'Complete a dungeon without dying', description_ru: 'Пройти подземелье без смертей',
    category: 'combat', icon: '✨', reward_gold: 1000, reward_experience: 2000, reward_title: 'Неприкосновенный', hidden: true },
];

export class AchievementService {
  private db = DatabaseService.getInstance();

  async getUnlocked(charId: string): Promise<AchievementDef[]> {
    const rows = await this.db.query<{ achievement_id: string }>(
      'SELECT achievement_id FROM character_achievements WHERE character_id = $1',
      [charId]
    );
    const ids = new Set(rows.map(r => r.achievement_id));
    return ACHIEVEMENTS.filter(a => ids.has(a.id));
  }

  async getAll(): Promise<AchievementDef[]> {
    return ACHIEVEMENTS;
  }

  /** Уже выданные id. Отдельный метод, чтобы checkAll не тащил целые
   * определения ради Set из строк. */
  async getUnlockedIds(charId: string): Promise<string[]> {
    const rows = await this.db.query<{ achievement_id: string }>(
      'SELECT achievement_id FROM character_achievements WHERE character_id = $1',
      [charId],
    );
    return rows.map(r => r.achievement_id);
  }

  /**
   * Прочитать состояние персонажа для условий-состояний.
   *
   * Отдельно от getCounters, потому что это разные вопросы: счётчики
   * живут в одной строке leaderboard и читаются одним SELECT, а
   * состояния требуют по запросу на каждое.
   *
   * Отсутствующее состояние - это ноль, а не ошибка: у персонажа может
   * не быть ни друга, ни гильдии, и это нормальное положение дел, а не
   * сбой. Сбой базы здесь был бы поводом не выдать достижение, но
   * тишина в базе - повод не выдать.
   */
  async getStates(charId: string): Promise<Partial<Record<AchievementState, number>>> {
    const out: Partial<Record<AchievementState, number>> = {};
    for (const [state, sql] of Object.entries(STATE_SOURCE) as [AchievementState, string][]) {
      const row = await this.db.queryOne<{ n: number }>(sql, [charId]);
      out[state] = Number(row?.n ?? 0);
    }
    return out;
  }

  /**
   * Счётчики и состояния вместе - то, чем на самом деле измеряется
   * выполнение условия.
   */
  async getMeasures(charId: string): Promise<Partial<Record<AchievementMeasure, number>>> {
    const [counters, states] = await Promise.all([this.getCounters(charId), this.getStates(charId)]);
    return { ...counters, ...states };
  }

  /**
   * Прочитать счётчики персонажа.
   *
   * Счётчики живут в таблице leaderboard, где они копятся сложением в
   * момент события. Имена колонок берутся из закрытого COUNTER_COLUMN,
   * а не из данных запроса: иначе подстановка произвольного имени
   * прошла бы мимо typecheck.
   */
  async getCounters(charId: string): Promise<Partial<Record<AchievementCounter, number>>> {
    const cols = Object.values(COUNTER_COLUMN);
    const row = await this.db.queryOne<Record<string, string | number>>(
      `SELECT ${cols.join(', ')} FROM leaderboard WHERE character_id = $1`,
      [charId],
    );
    const out: Partial<Record<AchievementCounter, number>> = {};
    for (const key of Object.keys(COUNTER_COLUMN) as AchievementCounter[]) {
      // Отсутствующая строка leaderboard - это ноль, а не ошибка: строка
      // появляется при первом событии, а не при первом входе.
      out[key] = Number(row?.[COUNTER_COLUMN[key]] ?? 0);
    }
    return out;
  }

  /**
   * Выдать достижение, если условие выполнено.
   *
   * ГЛАВНОЕ ОТЛИЧИЕ ОТ БЫЛОГО. Метод больше не выдаёт что попросят: он
   * сверяется со счётчиком. Без этого любой вызов давал бы награду,
   * а награды у достижений - золото и опыт, то есть вызов был бы
   * способом напечатать себе денег.
   *
   * ПОЧЕМУ БЕЗ УСЛОВИЯ - ОТКАЗ. У двенадцати достижений счётчика в базе
   * нет: крафты, шахматы, стихи, подземелья, друзья, гильдии, регионы,
   * комбо, боссы. Выдать их нечем, а выдать «за компанию» - значит
   * раздать золото без повода. Такое достижение честно остаётся
   * недостижимым, и панель пишет «пока не считается».
   *
   * Возвращает true только если достижение выдано именно сейчас.
   * Повторный вызов вернёт false: награда не должна платиться дважды.
   */
  async checkAndUnlock(charId: string, achievementId: string): Promise<boolean> {
    const def = ACHIEVEMENTS.find(a => a.id === achievementId);
    if (!def) return false;
    if (!def.condition) return false;

    const existing = await this.db.queryOne(
      'SELECT 1 FROM character_achievements WHERE character_id = $1 AND achievement_id = $2',
      [charId, achievementId],
    );
    if (existing) return false;

    const measures = await this.getMeasures(charId);
    if (!isEarned(def, measures)) return false;

    await this.db.query(
      'INSERT INTO character_achievements (character_id, achievement_id) VALUES ($1, $2)',
      [charId, achievementId],
    );
    // Выдаём награды
    if (def.reward_gold > 0) {
      await this.db.query(
        'UPDATE characters SET gold = gold + $1 WHERE id = $2',
        [def.reward_gold, charId],
      );
    }
    if (def.reward_experience > 0) {
      await this.db.query(
        'UPDATE characters SET experience = experience + $1 WHERE id = $2',
        [def.reward_experience, charId],
      );
    }
    logger.info(`[Achievement] ${charId} unlocked: ${achievementId}`);
    return true;
  }

  /**
   * Проверить все достижения с условием.
   *
   * Зовётся после события, увеличившего счётчик. По одному звать
   * checkAndUnlock из места события нельзя: список условий разъехался бы
   * с местами событий, и достижение на 1000 убийств забыли бы
   * привязать, пока не сыграл бы тысячный монстр.
   *
   * Повторно выданное пропускается, поэтому звать после каждого убийства
   * безопасно: платится только за то, что выдано впервые.
   */
  async checkAll(charId: string): Promise<string[]> {
    const counters = await this.getCounters(charId);
    const unlockedIds = new Set(
      (await this.getUnlockedIds(charId)),
    );
    const granted: string[] = [];
    for (const def of ACHIEVEMENTS) {
      if (!def.condition) continue;
      if (unlockedIds.has(def.id)) continue;
      if (!isEarned(def, counters)) continue;
      if (await this.checkAndUnlock(charId, def.id)) granted.push(def.id);
    }
    return granted;
  }

  /**
   * `unlock` остаётся для вызовов из кода, но теперь означает ровно то же:
   * «проверь и выдай, если выполнено». Своего пути выдачи у него нет и
   * не было - выдать достижение без условия нечем.
   */
  async unlock(charId: string, achievementId: string): Promise<boolean> {
    return this.checkAndUnlock(charId, achievementId);
  }

  /**
   * Прогресс по достижению: сколько есть, сколько нужно.
   *
   * `counted: false` - условия нет, счётчика в базе нет. Панель обязана
   * сказать «пока не считается», а не «0 / 50»: ноль верен только когда
   * счётчик действительно сходится к нулю, и в этом случае он должен
   * расти. Настоящий ноль виден как «0 / 50» и через два убийства
   * становится «2 / 50». Ненастоящий ноль не двигается никогда, и рядом
   * с ним «50 крафтов» выглядит как «игрок не крафтил».
   */
  async getProgress(charId: string, achievementId: string): Promise<{
    unlocked: boolean;
    current: number | null;
    need: number | null;
    counted: boolean;
  }> {
    const def = ACHIEVEMENTS.find(a => a.id === achievementId);
    if (!def) return { unlocked: false, current: null, need: null, counted: false };
    const unlocked = !!(await this.db.queryOne(
      'SELECT 1 FROM character_achievements WHERE character_id = $1 AND achievement_id = $2',
      [charId, achievementId],
    ));
    if (!def.condition) return { unlocked, current: null, need: null, counted: false };
    // Счётчики и состояния в одном пространстве: панели всё равно, откуда
    // взялось число. Ключ берётся через 'counter' in условие, потому что
    // условие теперь двух видов, и прямое условие.counter на состоянии
    // не существует.
    const measures = await this.getMeasures(charId);
    const ключ = 'counter' in def.condition ? def.condition.counter : def.condition.state;
    return {
      unlocked,
      current: Number(measures[ключ] ?? 0),
      need: def.condition.need,
      counted: true,
    };
  }
}
