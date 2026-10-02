// ============================================================
// Инстансы подземелий — Empire of Safavids
// ============================================================
// Сессия данжа: монстры данжа спавнятся через ИИ-систему в области
// данжа своего региона, права урона и прогресс — только у участников
// сессии. Убийство всех боссов завершает данж с наградой; выход
// убирает монстров из мира. Состояние в памяти: сессии переживают
// только текущий процесс сервера (транзиентный геймплей).

import { DUNGEONS_DATABASE, DungeonDefinition } from '../data/dungeons';
import { MONSTERS_DATABASE } from '../data/monsters';
import { AISystem } from './AISystem';
import { CharacterService } from '../services/CharacterService';
import { DatabaseService } from '../services/DatabaseService';
import { grantReputation } from './ReputationGrants';
import { Region } from '../types/game.types';
import { logger } from '../utils/logger';
// Счётчик пройденных подземелий для достижения. Общая таблица
// leaderboard - там же убийства, парирования, стихи и шахматы.
import { LeaderboardService } from '../services/LeaderboardService';
import { v4 as uuidv4 } from 'uuid';
import { guildMissionService } from '../services/GuildMissionService';

/**
 * Сколько раз в день персонаж может войти в данж.
 *
 * Считается ПРОВЕДЁННЫЙ заход, а не удачный: зашёл и вышел, не убив никого,
 * — попытка израсходована, потому что время и монстры уже потрачены. Иначе
 * лимит обходился бы заходом-выходом, и толку от него не было бы.
 *
 * Три попытки на данж в сутки на персонажа. Ограничение не на аккаунт:
 * один игрок с тремя персонажами получает девять, и это осознанно — иначе
 * вторая покупка персонажа становилась бы наказанием за игру.
 * Правится одной строкой, если понадобится иное число.
 */
const DUNGEON_ATTEMPTS_PER_DAY = 3;

/**
 * Дневной лимит попыток для конкретного данжа.
 *
 * Общее число остаётся значением по умолчанию. Исключения — в описании
 * данжа, а не здесь.
 */
function attemptsLimit(dungeonId: string): number {
  return DUNGEONS_DATABASE[dungeonId]?.attemptsPerDay ?? DUNGEON_ATTEMPTS_PER_DAY;
}

export interface DungeonSession {
  id: string;
  dungeonId: string;
  region: Region;
  shardId: string;
  leaderId: string;
  members: Set<string>;
  monsterIds: Set<string>;
  requiredBossIds: Set<string>;
  killedBossIds: Set<string>;
  startedAt: number;
  completedAt?: number;
  // Смерти участников ЗА ЭТУ СЕССИЮ. Нужны для достижения «пройти без
  // смертей», у которого не было условия.
  //
  // Считается в памяти и НЕ сохраняется: сессия живёт, пока идёт заход.
  // Держать смерти в базе незачем - начисление происходит в момент
  // прохождения, и там же сессия закрывается.
  //
  // Ключ - characterId, значение - сколько раз умер. Map, а не Set:
  // «умер ли» недостаточно, потому что после поднятия можно умереть
  // снова, и заход, где умер дважды, не должен считаться безсмертным так
  // же, как заход, где умер один раз. Раз заход засчитывается целиком,
  // достаточно сравнения с нулём - но хранить сам факт надо точно.
  deaths: Map<string, number>;
}

export interface DungeonCompleteInfo {
  // Сколько человек разделило добычу и сколько золота досталось каждому.
  // gold в отчёте остаётся общей суммой захода: клиент показывает
  // итог захода, а «свой кусок» показывает этим числом.
  participants: number;
  goldEach: number;
  sessionId: string;
  dungeonId: string;
  dungeonNameRu: string;
  experience: number;
  gold: number;
  items: string[];
}

export class DungeonService {
  private static instance: DungeonService;
  private sessions = new Map<string, DungeonSession>();
  private monsterToSession = new Map<string, string>();
  private characterToSession = new Map<string, string>();
  private db = DatabaseService.getInstance();
  private ai = new AISystem(); // заглушка: заменяется при init
  private characters = new CharacterService();

  static getInstance(): DungeonService {
    if (!DungeonService.instance) {
      DungeonService.instance = new DungeonService();
    }
    return DungeonService.instance;
  }

  /** Привязать к ИИ-системе игрового цикла (вызывается из GameLoop.init) */
  attachAI(ai: AISystem): void {
    this.ai = ai;
  }

  /**
   * Войти в данж (создать сессию). Монстры спавнятся в области данжа;
   * клиенты участников получают их через обычный канал спавна региона.
   */
  async enter(characterId: string, dungeonId: string): Promise<
    { ok: true; session: DungeonSession; attemptsLeft: number } | { ok: false; code: string }
  > {
    const def: DungeonDefinition | undefined = DUNGEONS_DATABASE[dungeonId];
    if (!def) return { ok: false, code: 'dungeon_not_found' };

    const existingId = this.characterToSession.get(characterId);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing && !existing.completedAt) return { ok: false, code: 'dungeon_already_inside' };
    }

    // Списание попытки — до любой работы: если лимит исчерпан, не должен
    // ни читаться персонаж, ни создаваться сессия в памяти
    if (await this.attemptsLeft(characterId, dungeonId) <= 0) {
      return { ok: false, code: 'dungeon_attempts_exhausted' };
    }

    const character = await this.characters.getCharacterById(characterId);
    if (!character) return { ok: false, code: 'character_not_found' };
    if (character.level < def.minLevel || character.level > def.maxLevel) {
      return { ok: false, code: 'dungeon_level_range' };
    }
    if (character.region !== def.region) {
      return { ok: false, code: 'dungeon_wrong_region' };
    }

    // Идентификатор сессии — UUID, а не строка вида dg_1756_abc123.
    //
    // ЧТО БЫЛО. Идентификатор собирался из времени и случайных символов, а
    // колонка dungeon_sessions.id объявлена как UUID со ссылкой на
    // characters(id). Такое значение в колонку UUID не пишется: Postgres
    // отвергал бы его. То есть сессия не могла оказаться в базе в принципе,
    // и перезапуск сервера стирал все заходы молча — без ошибки, без записи
    // в лог. Пять таблиц dungeon_* существовали, но не наполнялись.
    // Списываем здесь, а не в самом начале: уровень, регион и «уже внутри»
    // — отказы, за которые попытку списывать нечестно. Игрок не получил
    // ни монстра, ни минуты захода
    if (!(await this.spendAttempt(characterId, dungeonId))) {
      return { ok: false, code: 'dungeon_attempts_exhausted' };
    }
    const session: DungeonSession = {
      id: uuidv4(),
      dungeonId,
      region: def.region,
      shardId: character.serverId ?? 'isfahan',
      leaderId: characterId,
      members: new Set([characterId]),
      monsterIds: new Set(),
      requiredBossIds: new Set(),
      killedBossIds: new Set(),
      startedAt: Date.now(),
    deaths: new Map(),
    };

    this.spawnSessionMonsters(session, def);

    this.sessions.set(session.id, session);
    this.characterToSession.set(characterId, session.id);
    // Запись в базу. Ошибка здесь не должна отменять вход: игрок уже
    // внутри, монстры уже заспавнены. Но молча проглатывать нельзя — иначе
    // останется ровно то же, что было: потерянный заход без следа.
    await this.persistSession(session).catch((e) =>
      logger.warn(`[Dungeon] не удалось записать сессию ${session.id}: ${e}`));
    logger.info(`[Dungeon] ${def.nameRu} started by ${character.name} (${session.monsterIds.size} monsters)`);
    // Остаток спрашиваем заново после списания, а не запоминаем до него:
    // вход в данж — редкое действие, лишний запрос ничего не стоит, зато
    // число не может разойтись с тем, что реально лежит в базе
    return { ok: true, session, attemptsLeft: await this.attemptsLeft(characterId, dungeonId) };
  }

  /**
   * Заспавнить монстров захода.
   *
   * Один код на два случая: новый заход (enter) и восстановление после
   * перезапуска. Если бы списки монстров и боссов набирались в двух местах,
   * то одна из копий рано или поздно разошлась бы с другой, и восстановленный
   * заход считался бы выигранным тем, чего на самом деле не было убито.
   */
  private spawnSessionMonsters(session: DungeonSession, def: DungeonDefinition): void {
    for (const room of def.rooms) {
      for (const group of room.monsters) {
        for (const pos of group.positions) {
          const monsterDef = MONSTERS_DATABASE[group.monsterId];
          if (!monsterDef) continue;
          const ctx = this.ai.spawnMonster(monsterDef, pos, session.shardId);
          session.monsterIds.add(ctx.instanceId);
          this.monsterToSession.set(ctx.instanceId, session.id);
          if (room.isBossRoom && room.bossId === group.monsterId) {
            session.requiredBossIds.add(ctx.instanceId);
          }
        }
      }
    }
  }

  /**
   * Записать сессию и её участников в базу.
   *
   * dungeon_sessions и dungeon_members созданы миграцией 010 и с тех пор
   * пустые. Монстры намеренно не сохраняются: их состав выводится из
   * DUNGEONS_DATABASE при восстановлении, а идентификаторы экземпляров
   * всё равно меняются при каждом спавне.
   */
  private async persistSession(session: DungeonSession): Promise<void> {
    await this.db.query(
      `INSERT INTO dungeon_sessions (id, dungeon_id, difficulty, leader_id, max_size, started_at, status)
       VALUES ($1, $2, 'normal', $3, 5, to_timestamp($4 / 1000.0), 'active')
       ON CONFLICT (id) DO NOTHING`,
      [session.id, session.dungeonId, session.leaderId, session.startedAt]
    );
    for (const memberId of session.members) {
      await this.db.query(
        `INSERT INTO dungeon_members (session_id, character_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id, character_id) DO NOTHING`,
        [session.id, memberId, memberId === session.leaderId ? 'leader' : 'member']
      );
    }
  }

  /**
   * Закрыть сессию в базе: простав��ить статус и время завершения.
   *
   * abandoned — игрок вышел сам, completed — заход доведён до конца.
   */
  private async closeSessionInDb(sessionId: string, status: 'completed' | 'abandoned'): Promise<void> {
    await this.db.query(
      `UPDATE dungeon_sessions
       SET status = $2, completed_at = NOW()
       WHERE id = $1 AND status = 'active'`,
      [sessionId, status]
    ).catch((e) => logger.warn(`[Dungeon] не удалось закрыть сессию ${sessionId}: ${e}`));

    // Прогресс гильдейских заданий - ТОЛЬКО при completed. abandoned
    // означает, что игрок вышел сам, и засчитывать такой заход было бы
    // выполнением задания десятью выходами из подземелья.
    if (status === 'completed') {
      const сессия = await this.db.queryOne<{ dungeon_id: string; leader_id: string }>(
        'SELECT dungeon_id, leader_id FROM dungeon_sessions WHERE id = $1', [sessionId],
      ).catch(() => null);
      if (сессия?.leader_id) {
        void guildMissionService.onDungeonCompleted(сессия.leader_id, сессия.dungeon_id);
      }
    }
  }

  /**
   * Вернуть из базы заходы, которые остались активными после перезапуска.
   *
   * ЧТО ЭТО ДЕЛАЕТ. Сервер поднимается, читает незакрытые сессии и снова
   * спавнит их монстров. Игрок, зашедший в данж перед рестартом, возвращается
   * в тот же заход, а не начинает заново. Без этого перезапуск обслуживания
   * стирал прогресс всех, кто в этот момент был внутри.
   *
   * Вызывается один раз при старте сервера, до приёма соединений.
   */
  async restoreActiveSessions(): Promise<number> {
    const rows = await this.db.query<{
      id: string; dungeon_id: string; leader_id: string; started_at: Date;
    }>(
      `SELECT s.id, s.dungeon_id, s.leader_id, s.started_at
       FROM dungeon_sessions s
       WHERE s.status = 'active'`
    ).catch((e) => {
      logger.warn(`[Dungeon] не удалось прочитать активные сессии: ${e}`);
      return [];
    });
    if (!rows.length) return 0;

    let restored = 0;
    for (const row of rows) {
      const def = DUNGEONS_DATABASE[row.dungeon_id];
      if (!def) {
        // Данж в коде удалили, а сессия осталась. Закрываем, чтобы не висела
        // вечно и не занимала место в восстановлении при следующем старте
        await this.closeSessionInDb(row.id, 'abandoned');
        continue;
      }
      const leader = await this.characters.getCharacterById(row.leader_id).catch(() => null);
      if (!leader) {
        await this.closeSessionInDb(row.id, 'abandoned');
        continue;
      }

      const members = await this.db.query<{ character_id: string }>(
        'SELECT character_id FROM dungeon_members WHERE session_id = $1',
        [row.id]
      ).catch(() => []);

      const session: DungeonSession = {
        id: row.id,
        dungeonId: row.dungeon_id,
        region: def.region,
        shardId: leader.serverId ?? 'isfahan',
        leaderId: row.leader_id,
        members: new Set(members.map(m => m.character_id)),
        monsterIds: new Set(),
        requiredBossIds: new Set(),
        killedBossIds: new Set(),
        startedAt: new Date(row.started_at).getTime(),
      // Смерти ДО перезапуска читаются из таблицы. Раньше здесь стояло
      // «смерти восстановить нельзя, это дыра»: память умирала вместе с
      // сервером, и заход, в котором игрок умер до рестарта,
      // засчитывался как безсмертный.
      deaths: await this.loadDeaths(row.id),
      };
      session.members.add(row.leader_id);
      this.spawnSessionMonsters(session, def);

      this.sessions.set(session.id, session);
      for (const memberId of session.members) this.characterToSession.set(memberId, session.id);
      restored++;
    }
    if (restored) logger.info(`[Dungeon] восстановлено активных заходов: ${restored}`);
    return restored;
  }

/**
 * Сколько попыток сегодня осталось у персонажа в этом данже.
 *
 * reset_date пришлось бы сравнивать в коде, и тогда смена суток зависела бы
 * от часового пояса сервера: игрок в другом поясе увидел бы «попытки
 * кончились» до полуночи. День считает база — CURRENT_DATE в Postgres
 * один на всех.
 */
  async attemptsLeft(characterId: string, dungeonId: string): Promise<number> {
    // Ошибку запроса НЕ глотаем. queryOne возвращает null, когда строки
    // просто нет - это честный «попыток не использовано». Ошибку он
    // БРОСАЕТ, и раньше catch превращал её в то же самое число свободных
    // попыток: игрок видел «осталось 3», нажимал «Войти» и получал 500.
    // «Не знаю, сколько попыток» и «попыток не было» - разные вещи.
    //
    // Причина логируется и поднимается дальше: отказ придёт на настоящей
    // причине, а не на выдуманной.
    const row = await this.db.queryOne<{ attempts: number }>(
      `SELECT attempts FROM dungeon_attempts
       WHERE character_id = $1 AND dungeon_id = $2 AND reset_date = CURRENT_DATE`,
      [characterId, dungeonId]
    ).catch((e: unknown) => {
      logger.error('[Dungeon] не удалось прочитать число попыток:', (e as Error).message);
      throw new Error('DUNGEON_ATTEMPTS_UNREADABLE');
    });
    return Math.max(0, attemptsLimit(dungeonId) - (Number(row?.attempts) || 0));
  }

  /**
   * Списать попытку. Возвращает false, если дневной лимит исчерпан.
   *
   * UPDATE с условием attempts < лимит, а не SELECT с последующим UPDATE:
   * две одновременные попытки входа (двойной клик, две вкладки) иначе обе
   * прочитали бы «осталось 1» и обе прошли бы. Postgres же обновляет строку
   * один раз: вторая попытка увидит attempts уже 3 и вернёт ноль строк.
   */
   // reset_date ЗДЕСЬ ПОД ТАБЛИЦЕЙ, А НЕ ГОЛОЕ ИМЯ. В ветке
   // ON CONFLICT DO UPDATE голое reset_date неоднозначно, и Postgres
   // отвечал "column reference \"reset_date\" is ambiguous" - то есть
   // вход в любое подземелье падал с 500. Попытки не списывались, и
   // подземелье не открывалось вовсе: счётчик прохождений не мог
   // вырасти. Живой прогон нашёл это за минуту, чтение кода - нет.
  private async spendAttempt(characterId: string, dungeonId: string): Promise<boolean> {
    const res = await this.db.query<{ attempts: number }>(
      `INSERT INTO dungeon_attempts (character_id, dungeon_id, attempts, reset_date)
       VALUES ($1, $2, 1, CURRENT_DATE)
       ON CONFLICT (character_id, dungeon_id) DO UPDATE
         SET attempts = dungeon_attempts.attempts + 1
       WHERE dungeon_attempts.reset_date = CURRENT_DATE AND dungeon_attempts.attempts < $3
       RETURNING attempts`,
      [characterId, dungeonId, attemptsLimit(dungeonId)]
    );
    return res.length > 0;
  }

  /**
   * Присоединиться к чужому заходу.
   *
   * ДО ЧЕГО ЭТО БЫЛО. Присоединения не существовало вовсе: members
   * пополнялся только создателем, а из базы возвращался только лидер.
   * То есть minPlayers и maxPlayers в описании данжа были надписью, и
   * зайти можно было только в одиночку. Из-за этого и «лут один на
   * группу» было негде делить: делить было некому.
   *
   * Порядок входа сохраняется: members — это Set, и join добавляет в
   * конец. На этом стоит раздача добычи по очереди.
   */
  async join(characterId: string, sessionId: string): Promise<
    { ok: true; session: DungeonSession; attemptsLeft: number } | { ok: false; code: string }
  > {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, code: 'dungeon_session_not_found' };
    if (session.completedAt) return { ok: false, code: 'dungeon_session_closed' };
    if (session.members.has(characterId)) return { ok: false, code: 'dungeon_already_in_session' };

    const def = DUNGEONS_DATABASE[session.dungeonId];
    if (!def) return { ok: false, code: 'dungeon_not_found' };

    const existingId = this.characterToSession.get(characterId);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing && !existing.completedAt) return { ok: false, code: 'dungeon_already_inside' };
    }

    // Размер группы. Именно эта цифра была недостижимой:
    // maxPlayers: 8 у гробницы не означал ничего.
    if (session.members.size >= def.maxPlayers) return { ok: false, code: 'dungeon_full' };

    if (await this.attemptsLeft(characterId, def.id) <= 0) {
      return { ok: false, code: 'dungeon_attempts_exhausted' };
    }

    const character = await this.characters.getCharacterById(characterId);
    if (!character) return { ok: false, code: 'character_not_found' };
    if (character.level < def.minLevel || character.level > def.maxLevel) {
      return { ok: false, code: 'dungeon_level_range' };
    }
    if (character.region !== def.region) return { ok: false, code: 'dungeon_wrong_region' };

    // Шард. Монстры спавнятся в шарде лидера, и клиент видит только свой
    // шард: без этой проверки человек вошёл бы в пустой заход и решил бы,
    // что данж сломан.
    const shard = character.serverId ?? 'isfahan';
    if (shard !== session.shardId) return { ok: false, code: 'dungeon_wrong_shard' };

    // Попытка списывается здесь, а не в самом начале: отказ по размеру,
    // уровню или шарду игрок ничего не получил.
    if (!(await this.spendAttempt(characterId, def.id))) {
      return { ok: false, code: 'dungeon_attempts_exhausted' };
    }

    session.members.add(characterId);
    this.characterToSession.set(characterId, session.id);
    await this.db
      .query(
        `INSERT INTO dungeon_members (session_id, character_id, role)
         VALUES ($1, $2, 'member')`,
        [session.id, characterId]
      )
      .catch((e: unknown) => {
        logger.warn('[Dungeon] не удалось записать участника в dungeon_members:', (e as Error).message);
      });
    logger.info(`[Dungeon] ${characterId} присоединился к заходу ${session.id} ` +
      `(${session.members.size}/${def.maxPlayers})`);
    return { ok: true, session, attemptsLeft: await this.attemptsLeft(characterId, def.id) };
  }
  /**
   * Забрать право на раздачу добычи. Возвращает false, если уже выдавали.
   *
   * UPDATE с условием «признак ещё пуст», а не SELECT и потом UPDATE:
   * две одновременные победы над боссом обе прочитали бы «пусто» и обе
   * раздали бы добычу. Postgres обновляет строку один раз: второй вызов
   * увидит признак уже проставленным и вернёт ноль строк.
   */

  /**
   * Открытые заходы по данжу. Для кнопки «вступить».
   *
   * Отдаём только то, что нужно для выбора: сколько человек и сколько мест
   * осталось. Лидер и состав группы не отдаются — это лишние данные, и без них
   * кнопка работает.
   *
   * Заходы берутся из памяти, а не из базы: в базе остались бы и завершённые,
   * и кнопка предлагала бы войти в закрытый заход.
   */
  listOpenSessions(dungeonId: string): { sessionId: string; members: number; maxPlayers: number }[] {
    const def = DUNGEONS_DATABASE[dungeonId];
    if (!def) return [];
    return [...this.sessions.values()]
      .filter((сессия) => сессия.dungeonId === dungeonId && !сессия.completedAt)
      .map((сессия) => ({
        sessionId: сессия.id,
        members: сессия.members.size,
        maxPlayers: def.maxPlayers,
      }));
  }

  private async claimLoot(sessionId: string): Promise<boolean> {
    const res = await this.db.query<{ id: string }>(
      `UPDATE dungeon_sessions
          SET loot_claimed_at = NOW()
        WHERE id = $1 AND loot_claimed_at IS NULL
        RETURNING id`,
      [sessionId]
    );
    return res.length > 0;
  }
  /** Выйти из данжа: монстры сессии убираются из мира */
  async leave(characterId: string): Promise<boolean> {
    const sessionId = this.characterToSession.get(characterId);
    if (!sessionId) return false;
    this.characterToSession.delete(characterId);

    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.members.delete(characterId);

    if (session.members.size === 0 && !session.completedAt) {
      // Последний участник вышел — заход брошен. Без этой записи сессия
      // осталась бы в базе со статусом active и вернулась бы при следующем
      // перезапуске сервера как живая, хотя монстров давно нет
      await this.closeSessionInDb(session.id, 'abandoned');
      this.disposeSession(session);
    }
    return true;
  }

  getSessionByMonster(instanceId: string): DungeonSession | undefined {
    const sessionId = this.monsterToSession.get(instanceId);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  isMember(characterId: string, session: DungeonSession): boolean {
    return session.members.has(characterId);
  }

  getSessionForCharacter(characterId: string): DungeonSession | undefined {
    const sessionId = this.characterToSession.get(characterId);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  /** Убийство монстра данжа: прогресс боссов, завершение с наградой */
  async onMonsterKilled(instanceId: string, killerId: string): Promise<DungeonCompleteInfo | null> {
    const session = this.getSessionByMonster(instanceId);
    if (!session || session.completedAt) return null;

    this.monsterToSession.delete(instanceId);
    session.monsterIds.delete(instanceId);

    if (session.requiredBossIds.has(instanceId)) {
      session.killedBossIds.add(instanceId);

      if ([...session.requiredBossIds].every(id => session.killedBossIds.has(id))) {
        return this.complete(session, killerId);
      }
    }
    return null;
  }

  private async complete(session: DungeonSession, killerId: string): Promise<DungeonCompleteInfo> {
    session.completedAt = Date.now();
    const def = DUNGEONS_DATABASE[session.dungeonId];
    const gold = def.rewards.gold.min + Math.floor(Math.random() * (def.rewards.gold.max - def.rewards.gold.min + 1));

    // Добыча делится на весь заход и выдаётся один раз. Порядок обхода
    // members — это порядок входа: на нём стоит остаток золота лидеру и
    // очередь предметов.
    const участники = [...session.members];
    const народу = Math.max(1, участники.length);
    const каждому = Math.floor(gold / народу);
    const остаток = gold - каждому * народу;

    // Предметы идут по кругу участников: каждый достаётся ровно один раз.
    // Формула «предмет i достаётся участнику i» отдавала бы лишние
    // предметы НИКОМУ — при двух людях и трёх предметах третий исчезал бы.
    // По кругу он достаётся лидеру, и ни одна добыча не пропадает.
    const получили = участники.map((characterId, порядок) => ({
      characterId,
      experience: def.rewards.experience,
      // Остаток от деления золота — лидеру захода, он первый во входе.
      gold: каждому + (порядок === 0 ? остаток : 0),
      items: def.rewards.guaranteedItems.filter((_, i) => i % народу === порядок),
    }));

    if (await this.claimLoot(session.id)) {
      for (const доля of получили) {
        await this.characters
          .addExperience(доля.characterId, доля.experience)
          .catch(() => {});
        await this.characters.addGoldReward(доля.characterId, доля.gold).catch(() => {});
        for (const itemId of доля.items) {
          await this.characters.addItems(доля.characterId, [{ itemId, qty: 1 }]).catch(() => {});
        }
      }
    }

    const info: DungeonCompleteInfo = {
      sessionId: session.id,
      dungeonId: session.dungeonId,
      dungeonNameRu: def.nameRu,
      experience: def.rewards.experience,
      gold,
      items: def.rewards.guaranteedItems,
      participants: участники.length,
      goldEach: каждому,
    };
    logger.info(`[Dungeon] ${def.nameRu} completed by ${killerId} (+${def.rewards.experience}xp, +${gold}g)`);
    // Репутация за данж — заметный поступок, а не рядовой бой
    void grantReputation(killerId, 'dungeonClear');

    // История прохождений. Таблица создана миграцией 010 и с тех пор пуста:
    // без неё нельзя ни показать игроку «сколько данжей ты прошёл», ни
    // понять, какие из них никто не проходил (на таких стоит переписать
    // награду — обычно они слишком жёсткие или слишком щедрые).
    const durationSec = Math.max(0, Math.round((session.completedAt - session.startedAt) / 1000));
    const totalMonsters = session.requiredBossIds.size + session.monsterIds.size;
    await this.db.query(
      `INSERT INTO dungeon_history
         (character_id, dungeon_id, difficulty, result, monsters_killed, bosses_killed, duration_sec)
       VALUES ($1, $2, 'normal', 'completed', $3, $4, $5)`,
      [killerId, session.dungeonId, totalMonsters, session.killedBossIds.size, durationSec]
    ).catch((e) => logger.warn(`[Dungeon] не удалось записать историю: ${e}`));
    await this.closeSessionInDb(session.id, 'completed');

    // Счётчик достижения «пройти первое подземелье». Раньше он не
    // существовал, и достижение значилось «пока не считается», хотя
    // подземелья в игре работают.
    //
    // ПОСЛЕ closeSessionInDb, А НЕ ДО НЕЁ. Если запись подземелья не
    // прошла, подземелье не засчитано, и расти счётчику не от чего.
    //
    // Ошибка не поднимается: награда и опыт уже выданы, и ронять
    // прохождение из-за счётчика - значит отнять у игрока то, что он
    // честно заработал.
    await new LeaderboardService().increment(killerId, { dungeonsCleared: 1 })
      .catch((e) => logger.warn(`[Dungeon] счётчик прохождений не вырос: ${e}`));

    // Счётчик достижения «пройти подземелье без единой смерти».
    //
    // Кому засчитывается. Тому же, кому и прохождение, - killerId. Не
    // всем участникам сессии: сейчас за прохождение получают только его,
    // и выдавать достижение остальным значило бы раздать награду за то,
    // чего они не делали. Политика наград не меняется молча.
    //
    // Сколько прибавляется. Ровно единица за заход, а не по числу
    // смертей. Счётчик показывает, сколько раз игрок обошёлся без
    // потерь, и прибавление «по одной смерти» означало бы, что десять
    // заходов с одной смертью дают десять - то есть ровно то, чего
    // достижение обещает не считать.
    //
    // ПОСЛЕ closeSessionInDb, как и dungeons_cleared: без записи
    // подземелья расти нечему.
    const смертей = session.deaths.get(killerId) ?? 0;
    if (смертей === 0) {
      await new LeaderboardService().increment(killerId, { dungeonsNoDeath: 1 })
        .catch((e) => logger.warn(`[Dungeon] счётчик заходов без смертей не вырос: ${e}`));
    }

    this.disposeSession(session);
    return info;
  }

  /**
   * Отметить смерть персонажа в текущей сессии подземелья.
   *
   * Зовётся из боевого тика на каждой смерти. Поэтому возвращает Promise
   * и НИЧЕГО не ждёт: тик не должен вставать из-за счётчика. Отметка
   * переживает отсутствие сессии - просто ничего не делает.
   *
   * Вне подземелья и после его закрытия тоже ничего не делает: смерть на
   * поле не отменяет «прошёл без смертей» в подземелье.
   */
  recordDeath(characterId: string): void {
    const sessionId = this.characterToSession.get(characterId);
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.deaths.set(characterId, (session.deaths.get(characterId) ?? 0) + 1);

    // Продолжение счётчика в базу - чтобы смерть пережила перезапуск.
    //
    // Без этого память обнулялась вместе с сервером, и заход, в котором
    // игрок умер ДО рестарта, засчитывался как безсмертный: достижение
    // выдавалось за то, чего не было.
    //
    // Ошибка НЕ поднимается: recordDeath зовётся из боевого тика, и
    // исключение здесь означало бы, что тик встал из-за счётчика
    // достижения. Пишем в журнал и идём дальше - незаписанная смерть
    // лучше остановленного боя у всех.
    void this.db.query(
      `INSERT INTO dungeon_deaths (session_id, character_id, deaths, updated_at)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (session_id, character_id) DO UPDATE
         SET deaths = dungeon_deaths.deaths + 1, updated_at = NOW()`,
      [sessionId, characterId],
    ).catch((e: unknown) => {
      logger.error('[Dungeon] смерть не записана в базу:', (e as Error).message);
    });
  }

  /**
   * Прочитать смерти участников сессии из базы.
   *
   * Нужна для восстановления после перезапуска: без неё сессия начинала
   * считать с нуля, и заход, в котором игрок умер ДО рестарта, выглядел
   * безсмертным.
   *
   * Ошибка чтения возвращает пустую карту, а не выдуманные нули: пустая
   * карта означает «смертей не нашли», и это честно для сессии, в которой
   * никто не умер. Если база недоступна, это уже видно по другим
   * запросам восстановления, и молчаливый ноль здесь был бы враньём.
   */
  private async loadDeaths(sessionId: string): Promise<Map<string, number>> {
    const карта = new Map<string, number>();
    const строки = await this.db.query<{ character_id: string; deaths: number }>(
      'SELECT character_id, deaths FROM dungeon_deaths WHERE session_id = $1',
      [sessionId],
    ).catch((e: unknown) => {
      logger.error('[Dungeon] смерти сессии не прочитаны:', (e as Error).message);
      return [] as { character_id: string; deaths: number }[];
    });
    for (const строка of строки) {
      карта.set(строка.character_id, Number(строка.deaths) || 0);
    }
    return карта;
  }

  /** Сколько раз персонаж умер за эту сессию. */
  deathsInSession(characterId: string): number {
    const sessionId = this.characterToSession.get(characterId);
    if (!sessionId) return 0;
    return this.sessions.get(sessionId)?.deaths.get(characterId) ?? 0;
  }

  /** Убрать монстры сессии из мира и забыть сессию */
  private disposeSession(session: DungeonSession): void {
    for (const instanceId of session.monsterIds) {
      this.ai.removeInstance(instanceId);
      this.monsterToSession.delete(instanceId);
    }
    for (const member of session.members) {
      if (this.characterToSession.get(member) === session.id) {
        this.characterToSession.delete(member);
      }
    }
    this.sessions.delete(session.id);
  }
}
