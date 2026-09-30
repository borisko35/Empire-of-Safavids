import { DatabaseService } from './DatabaseService';
import { GUILD_MISSIONS, type GuildMission } from '../data/guilds';
import { logger } from '../utils/logger';
import {
  allDone, blockReason, findMission, isOpen, needMembers, nextAvailable,
} from '../systems/GuildMissionRules';

/** Одна строка ответа: что гильдия видит в панели заданий. */
export interface MissionView {
  id: string;
  name: string;
  nameRu: string;
  description: string;
  objectives: { index: number; type: string; target: string; required: number; progress: number }[];
  rewards: { guildExp: number; gold: number; memberExp: number };
  cooldown: number;
  minMembers: number;
  /** Сколько участников нужно и сколько есть. Игроку это видно сразу. */
  needMembers: number;
  haveMembers: number;
  /** Состояние: 'open' | 'active' | 'done' | 'claimed'. */
  state: 'open' | 'active' | 'done' | 'claimed';
  /** Почему нельзя взять. Пустая строка - можно. */
  blockedBy: string;
  /** Когда откроется снова, если задание на откате. */
  availableAt: string | null;
}

interface MissionRow {
  mission_id: string;
  status: 'active' | 'claimed';
  available_at: Date | string | null;
  started_at: Date | string;
  row_id: string;
}

interface ProgressRow {
  objective_index: number;
  progress: number;
}

/**
 * Гильдейские задания.
 *
 * ГЛАВНОЕ ПРАВИЛО: награда выдаётся РОВНО ОДИН РАЗ. Держит это база, а не
 * порядок операций. Списание и перевод статуса идут одной транзакцией, и
 * строка уже claimed не подходит под UPDATE ... WHERE status = 'active',
 * то есть второй претендент на награду получает ноль строк и уходит ни с
 * чем. Порядок операций без транзакции не защищал бы - он делал потерю
 * гарантированной.
 */
export class GuildMissionService {
  private db = DatabaseService.getInstance();

  /**
   * Список заданий для панели. Все три состояния считаются на сервере:
   * клиент не решает, открыто задание или нет.
   */
  async list(guildId: string): Promise<MissionView[]> {
    const guild = await this.db.queryOne<{ max_members: number }>(
      'SELECT max_members FROM guilds WHERE id = $1', [guildId],
    );
    const maxMembers = guild?.max_members ?? 0;

    const участников = await this.db.queryOne<{ n: number }>(
      // Псевдоним n обязателен: getStates и этот код читают row.n, а
      // COUNT(*) без имени отдаётся как count, и число становилось бы
      // undefined - то есть «участников 0», и ни одно задание не открылось бы.
      'SELECT COUNT(*)::int AS n FROM guild_members WHERE guild_id = $1', [guildId],
    );
    const have = участников?.n ?? 0;

    const строки = await this.db.query<MissionRow>(
      `SELECT mission_id, status, available_at, started_at, id::text AS row_id
         FROM guild_missions WHERE guild_id = $1`, [guildId],
    );

    const поМиссии = new Map<string, MissionRow>();
    for (const с of строки) поМиссии.set(с.mission_id, с);

    const прогрессПоСтроке = new Map<string, Map<number, number>>();
    if (строки.length > 0) {
      const ids = строки.map(с => с.row_id);
      const п = await this.db.query<ProgressRow & { mission_row: string }>(
        `SELECT mission_row::text AS mission_row, objective_index, progress
           FROM guild_mission_progress WHERE mission_row = ANY($1::uuid[])`, [ids],
      );
      for (const с of п) {
        let карта = прогрессПоСтроке.get(с.mission_row);
        if (!карта) { карта = new Map(); прогрессПоСтроке.set(с.mission_row, карта); }
        // Строки с NULL character_id - общий прогресс гильдии. Он идёт в
        // ту же сумму: цель «собрать 500 шёлка» измеряется объёмом, а не
        // тем, кто именно собрал.
        карта.set(с.objective_index,
          (карта.get(с.objective_index) ?? 0) + Number(с.progress ?? 0));
      }
    }

    return GUILD_MISSIONS.map(миссия => this.собрать(
      миссия, поМиссии.get(миссия.id), have, maxMembers, прогрессПоСтроке,
    ));
  }

  private собрать(
    миссия: GuildMission,
    строка: MissionRow | undefined,
    have: number,
    maxMembers: number,
    прогрессПоСтроке: Map<string, Map<number, number>>,
  ): MissionView {
    const прогресс = строка ? (прогрессПоСтроке.get(строка.row_id) ?? new Map()) : new Map();
    const ужеЕсть = строка?.status === 'active';
    const готов = allDone(миссия, прогресс);
    const availableAt = строка?.available_at
      ? new Date(строка.available_at).toISOString() : null;

    let state: MissionView['state'];
    if (строка?.status === 'claimed') state = 'claimed';
    else if (ужеЕсть) state = готов ? 'done' : 'active';
    else if (isOpen(availableAt) && have >= needMembers(миссия, maxMembers)) state = 'open';
    else state = 'open';

    return {
      id: миссия.id,
      name: миссия.name,
      nameRu: миссия.nameRu,
      description: миссия.description,
      objectives: миссия.objectives.map((ц, i) => ({
        index: i,
        type: ц.type,
        target: ц.target,
        required: Number(ц.required) || 0,
        progress: прогресс.get(i) ?? 0,
      })),
      rewards: миссия.rewards,
      cooldown: миссия.cooldown,
      needMembers: needMembers(миссия, maxMembers),
      minMembers: миссия.minMembers,
      haveMembers: have,
      state,
      blockedBy: ужеЕсть
        ? 'MISSION_ALREADY_ACTIVE'
        : blockReason(миссия, have, maxMembers, availableAt, false),
      availableAt,
    };
  }

  /**
   * Взять задание.
   *
   * Отказов четыре, и каждый с кодом: задание не найдено, не хватает
   * участников, откат, уже взято. Без кодов игрок видел бы одну надпись
   * «недоступно» на четыре разные причины.
   */
  async start(guildId: string, missionId: string, actorId: string): Promise<{ ok: boolean; code: string }> {
    const миссия = findMission(missionId);
    if (!миссия) return { ok: false, code: 'MISSION_UNKNOWN' };

    const guild = await this.db.queryOne<{ max_members: number }>(
      'SELECT max_members FROM guilds WHERE id = $1', [guildId],
    );
    if (!guild) return { ok: false, code: 'GUILD_NOT_FOUND' };

    const участников = await this.db.queryOne<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM guild_members WHERE guild_id = $1', [guildId],
    );
    const have = участников?.n ?? 0;

    const строка = await this.db.queryOne<MissionRow>(
      `SELECT mission_id, status, available_at, started_at, id::text AS row_id
         FROM guild_missions WHERE guild_id = $1 AND mission_id = $2`, [guildId, missionId],
    );

    if (строка?.status === 'active') return { ok: false, code: 'MISSION_ALREADY_ACTIVE' };
    if (строка && !isOpen(строка.available_at)) {
      return { ok: false, code: 'MISSION_ON_COOLDOWN' };
    }
    if (have < needMembers(миссия, guild.max_members)) {
      return { ok: false, code: 'MISSION_NEEDS_MEMBERS' };
    }

    // Строка заведения переносится ВМЕСТЕ с прогрессом: без этого
    // повторное взятие после отката продолжило бы с прошлого прогресса, и
    // 90 убийств из прошлой попытки засчитались бы сразу.
    await this.db.query(
      `INSERT INTO guild_missions (guild_id, mission_id, status, started_by)
       VALUES ($1, $2, 'active', $3)
       ON CONFLICT (guild_id, mission_id) DO UPDATE
         SET status = 'active', started_at = NOW(), started_by = $3,
             completed_at = NULL, available_at = NULL`,
      [guildId, missionId, actorId],
    );
    const свежая = await this.db.queryOne<{ row_id: string }>(
      'SELECT id::text AS row_id FROM guild_missions WHERE guild_id = $1 AND mission_id = $2',
      [guildId, missionId],
    );
    if (свежая?.row_id) {
      await this.db.query('DELETE FROM guild_mission_progress WHERE mission_row = $1', [свежая.row_id]);
    }
    logger.info(`[GuildMissions] ${guildId} взяла ${missionId}`);
    return { ok: true, code: '' };
  }

  /**
   * Отметить прогресс. Вызывается из горячих точек: убийство монстра,
   * получение предмета, прохождение подземелья.
   *
   * Ошибка НЕ поднимается и зовётся без await на местах вызова: горячая
   * точка не должна вставать из-за гильдейского задания. Потеря одной
   * отметки не ломает игру, падение тика - ломает.
   */
  async addProgress(
    guildId: string, missionId: string, objectiveIndex: number,
    amount: number, characterId: string | null,
  ): Promise<void> {
    const добавить = Number(amount);
    if (!Number.isFinite(добавить) || добавить <= 0) return;
    const миссия = findMission(missionId);
    if (!миссия) return;
    const цель = миссия.objectives[objectiveIndex];
    if (!цель) return;

    try {
      const строка = await this.db.queryOne<{ row_id: string }>(
        `SELECT id::text AS row_id FROM guild_missions
          WHERE guild_id = $1 AND mission_id = $2 AND status = 'active'`,
        [guildId, missionId],
      );
      if (!строка?.row_id) return;

      // Прогресс не копится выше нужного: иначе игрок, убивший 300
      // разбойников до конца задания, при следующем взятии сразу получил
      // бы «выполнено» - а задание с обещанием 100 убийств.
      await this.db.query(
        `INSERT INTO guild_mission_progress
           (mission_row, objective_index, character_id, progress)
         VALUES ($1, $2, $3, LEAST($4::int, $5::int))
         ON CONFLICT (mission_row, objective_index,
                      COALESCE(character_id, '00000000-0000-0000-0000-000000000000'::uuid))
         DO UPDATE SET progress = LEAST(
           guild_mission_progress.progress + $4::int, $5::int), updated_at = NOW()`,
        [строка.row_id, objectiveIndex, characterId, Math.floor(добавить), Number(цель.required) || 0],
      );
    } catch (e) {
      // Печатается не только message: у ошибки Postgres смысл в code
      // (42804 - несовпадение типа), и по одному тексту причина не читалась.
      const ошибка = e as { message?: string; code?: string };
      logger.warn('[GuildMissions] прогресс не записан:',
        `${ошибка.code ?? 'без кода'} ${ошибка.message ?? 'без сообщения'}`);
    }
  }

  /**
   * Мосты из горячих точек.
   *
   * Каждый сначала спрашивает у базы активное задание, у которого есть
   * цель нужного типа, и только потом пишет. Это дешевле, чем искать
   * активное задание вслепую: у most guilds его просто нет, и на
   * каждом убийстве монстра не происходит даже записи.
   *
   * Ошибка ловится внутри addProgress и пишется в журнал. Вызывающий код
   * зовёт эти мосты через void и не ждёт: горячая точка не должна
   * вставать из-за гильдейского задания.
   */
  async onKill(characterId: string, monsterId: string): Promise<void> {
    await this.отметитьГде(characterId, 'kill', monsterId, 1);
  }

  async onItemGained(characterId: string, itemId: string, qty: number): Promise<void> {
    await this.отметитьГде(characterId, 'collect', itemId, qty);
  }

  async onDungeonCompleted(characterId: string, dungeonId: string): Promise<void> {
    await this.отметитьГде(characterId, 'dungeon', dungeonId, 1);
  }

  /**
   * Отметить прогресс по всем активным заданиям гильдии, у которых есть
   * цель нужного типа с такой целью.
   *
   * Цели-«убить» и цели-«пройти» пишутся на персонажа (важно, кто именно),
   * а цель-«собрать» - на гильдию (важно количество, а не автор).
   */
  private async отметитьГде(
    characterId: string, type: string, target: string, amount: number,
  ): Promise<void> {
    try {
      const гильдия = await this.db.queryOne<{ guild_id: string }>(
        'SELECT guild_id::text AS guild_id FROM guild_members WHERE character_id = $1', [characterId],
      );
      if (!гильдия?.guild_id) return;

      const строки = await this.db.query<{ mission_id: string; row_id: string }>(
        `SELECT m.mission_id, m.id::text AS row_id
           FROM guild_missions m
          WHERE m.guild_id = $1 AND m.status = 'active'`, [гильдия.guild_id],
      );

      for (const с of строки) {
        const миссия = findMission(с.mission_id);
        if (!миссия) continue;
        миссия.objectives.forEach((цель, index) => {
          if (цель.type !== type || цель.target !== target) return;
          // Сбор - общий счётчик гильдии: 500 шёлка это 500 шёлка, и делить
          // их между участниками незачем. Остальные цели - личные.
          const кому = type === 'collect' ? null : characterId;
          void this.addProgress(гильдия.guild_id, с.mission_id, index, amount, кому);
        });
      }
    } catch (e) {
      logger.warn('[GuildMissions] отметка не записана:', (e as Error).message);
    }
  }

  /**
   * Забрать награду.
   *
   * Повторный забор невозможен: UPDATE ... WHERE status = 'active' не
   * найдёт строку. Проверка allDone идёт ДО транзакции, и это осознанно:
   * решение «выполнено ли» читает базу, а транзакция защищает выдачу.
   * Гонка (два игрока жмут одновременно) закрыта условием UPDATE.
   */
  async claim(guildId: string, missionId: string, actorId: string): Promise<{
    ok: boolean; code: string; rewards: { guildExp: number; gold: number; memberExp: number } | null;
  }> {
    const миссия = findMission(missionId);
    if (!миссия) return { ok: false, code: 'MISSION_UNKNOWN', rewards: null };

    const строка = await this.db.queryOne<MissionRow>(
      `SELECT mission_id, status, available_at, started_at, id::text AS row_id
         FROM guild_missions WHERE guild_id = $1 AND mission_id = $2`, [guildId, missionId],
    );
    if (!строка) return { ok: false, code: 'MISSION_NOT_ACTIVE', rewards: null };
    if (строка.status === 'claimed') return { ok: false, code: 'MISSION_ALREADY_CLAIMED', rewards: null };

    const п = await this.db.query<ProgressRow>(
      `SELECT objective_index, progress FROM guild_mission_progress WHERE mission_row = $1`,
      [строка.row_id],
    );
    const прогресс = new Map<number, number>();
    for (const с of п) {
      прогресс.set(с.objective_index, (прогресс.get(с.objective_index) ?? 0) + Number(с.progress ?? 0));
    }
    if (!allDone(миссия, прогресс)) {
      return { ok: false, code: 'MISSION_NOT_DONE', rewards: null };
    }

    const { guildExp, gold, memberExp } = миссия.rewards;
    try {
      await this.db.transaction(async (client) => {
        // Условие status = 'active' - и есть защита от двойной выдачи.
        const перевод = await client.query(
          `UPDATE guild_missions
              SET status = 'claimed', completed_at = NOW(), claimed_by = $2,
                  available_at = $3
            WHERE id = $1 AND status = 'active'`,
          [строка.row_id, actorId, nextAvailable(миссия.cooldown)],
        );
        if (перевод.rowCount === 0) {
          throw new Error('MISSION_ALREADY_CLAIMED');
        }
        await client.query(
          'UPDATE guilds SET experience = experience + $2, gold = gold + $3 WHERE id = $1',
          [guildId, Number(guildExp) || 0, Number(gold) || 0],
        );
      });
    } catch (e) {
      const сообщение = (e as Error).message;
      if (сообщение === 'MISSION_ALREADY_CLAIMED') {
        return { ok: false, code: 'MISSION_ALREADY_CLAIMED', rewards: null };
      }
      logger.error('[GuildMissions] награда не выдана:', сообщение);
      return { ok: false, code: 'MISSION_CLAIM_FAILED', rewards: null };
    }

    logger.info(`[GuildMissions] ${guildId} забрала ${missionId} (${actorId})`);
    return { ok: true, code: '', rewards: { guildExp, gold, memberExp } };
  }
}

export const guildMissionService = new GuildMissionService();
