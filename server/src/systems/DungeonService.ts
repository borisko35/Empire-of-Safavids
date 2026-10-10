// ============================================================
// Инстансы подземелий — Empire of Safavids
// ============================================================
// Сессия данжа: монстры данжа спавнятся через ИИ-систему в области
// данжа своего региона, права урона и прогресс — только у участников
// сессии. Убийство всех боссов завершает данж с наградой; выход
// убирает монстров из мира. Состояние в памяти: сессии переживают
// только текущий процесс сервера (транзиентный геймплей).

import {
  DUNGEONS_DATABASE,
  DungeonDefinition,
  rollBonusItems,
  difficultyScaling,
} from '../data/dungeons';
import { MONSTERS_DATABASE } from '../data/monsters';
import { AISystem } from './AISystem';
import { CharacterService } from '../services/CharacterService';
import { DatabaseService } from '../services/DatabaseService';
import { grantReputation } from './ReputationGrants';
import { planDungeonRooms, clampToRoom } from './dungeonLayout';
import { Region } from '../types/game.types';
import { logger } from '../utils/logger';
// Счётчик пройденных подземелий для достижения. Общая таблица
// leaderboard - там же убийства, парирования, стихи и шахматы.
import { LeaderboardService } from '../services/LeaderboardService';
import { DebuffService } from '../services/DebuffService';
import type { DebuffPlan } from './MonsterEffects';
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
  /**
   * Виды боссов, для которых обязательный экземпляр уже выбран.
   *
   * Нужно, чтобы комната с несколькими боссами получила ровно ОДНО условие, а не
   * по условию на каждого: у крепости джиннов два, у гробницы убийц три. Решение
   * владельца — «хватает одного».
   */
  bossTaken: Set<string>;
  /** Открытые сундуки захода: повторное вскрытие не даёт добычу. */
  openedChests: Set<string>;
  /**
   * Сундуки захода в мировых координатах.
   *
   * Заводятся из chestPositions комнат при спавне захода, как монстры, и
   * проходят ту же обрезку по стене. Значит сундук не встанет в стену.
   */
  chests: { id: string; x: number; z: number }[];
  killedBossIds: Set<string>;
  /**
   * Убитые боссы по ИДЕНТИФИКАТОРУ ОПРЕДЕЛЕНИЯ (monsterId), не по экземпляру.
   *
   * Только этот набор переживает перезапуск сервера. Идентификатор
   * экземпляра (`killedBossIds`) создаётся заново при каждом спавне, и
   * сохранённый после перезапуска не совпал бы с новым. Босс из этого
   * набора при восстановлении не спавнится вовсе — иначе он воскреснет.
   */
  killedBossDefs: Set<string>;
  startedAt: number;
  /**
   * Когда заход истекает по timeLimit. Миллисекунды, 0 — лимита нет.
   *
   * ЧТО ЗДЕСЬ БЫЛО. Поле `timeLimit` стояло в описании всех семи данжей
   * (45, 60, 90, 120 минут) и не читалось нигде: таймера захода в проекте
   * не было вообще. Игрок входил «на 45 минут» и играл сколько угодно, и
   * никто ему об этом не говорил.
   *
   * Ставится при входе и при восстановлении после перезапуска: у
   * восстановленного захода остаток должен считаться от его же времени
   * старта, а не от момента восстановления — иначе перезапуск продлевал
   * подземелье на полный срок.
   */
  expiresAt: number;
  /**
   * Сложность захода. Раньше бралась первая буква массива `difficulties` и
   * больше нигде не участвовала: монстры спавнились одинаковыми, награда
   * одинаковой. Теперь по ней масштабируются и монстры, и добыча.
   */
  difficulty: string;
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

/** Результат вскрытия сундука. */
export interface ChestOpenResult {
  ok: boolean;
  /** Код отказа, когда ok === false: не в подземелье, далеко, уже вскрыт. */
  code?: 'not_in_dungeon' | 'too_far' | 'already_opened' | 'no_such_chest';
  gold: number;
  experience: number;
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
  /**
   * Что досталось КАЖДОМУ участнику.
   *
   * Добавлено потому, что уведомление о завершении получал только тот, кто
   * добил босса: остальные золото и предметы получали, а экран не открывался
   * ни разу. Теперь событие уходит каждому, и у каждого - своя доля: при
   * трёх участниках и трёх предметах видно «тебе достался вот этот», а не
   * «вот эти три на всех».
   */
  shares: { characterId: string; gold: number; experience: number; items: string[] }[];
  /**
   * Отказ из-за нехватки бойцов в рейде. Заполняется вместе с нулевой
   * наградой: заход не засчитан, но и не потерян.
   */
  code?: 'raid_under_min_players';
  /** Сколько бойцов требуется рейдом (minPlayers). */
  minPlayers?: number;
  /** Сколько их фактически было в заходе. */
  have?: number;
}

/** Приглашение в заход: живёт 60 секунд и одноразовое. */
export interface DungeonRunInvite {
  inviteId: string;
  sessionId: string;
  inviterId: string;
  inviteeCharacterId: string;
  expiresAt: number;
}

/**
 * Радиус вскрытия сундука.
 *
 * Сундук в зале — вещь, до которой доходят пешком. Дыры в этом месте быть
 * не должно: иначе сундук открывается из другого конца карты, потому что
 * вход в подземелье держится на памяти сервера, а не на координатах.
 */
const CHEST_OPEN_RADIUS = 3;

/**
 * Золото и опыт из сундука — по подземелью, из данных.
 *
 * Числа взяты из наград подземелья и уменьшены: сундук должен быть
 * дополнением к босгу, а не заменой ему. Формула считается от наград
 * подземелья, поэтому при пересмотре наград меняется и сундук.
 */
function chestGold(dungeonId: string): number {
  const def = DUNGEONS_DATABASE[dungeonId];
  if (!def) return 0;
  const середина = (def.rewards.gold.min + def.rewards.gold.max) / 2;
  return Math.round(середина * CHEST_GOLD_SHARE);
}

function chestExperience(dungeonId: string): number {
  const def = DUNGEONS_DATABASE[dungeonId];
  if (!def) return 0;
  return Math.round(def.rewards.experience * CHEST_EXP_SHARE);
}

/** Доля наград захода, которую даёт один сундук. */
const CHEST_GOLD_SHARE = 0.1;
/** Доля опыта захода, которую даёт один сундук. */
const CHEST_EXP_SHARE = 0.15;

export class DungeonService {

  private static instance: DungeonService;
  private sessions = new Map<string, DungeonSession>();
  // Приглашения в заход. Живут 60 секунд и одноразовые.
  private invites = new Map<string, DungeonRunInvite>();  private monsterToSession = new Map<string, string>();
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
  async enter(characterId: string, dungeonId: string, difficulty?: string): Promise<
    { ok: true; session: DungeonSession; attemptsLeft: number } | { ok: false; code: string }
  > {
    const def: DungeonDefinition | undefined = DUNGEONS_DATABASE[dungeonId];
    if (!def) return { ok: false, code: 'dungeon_not_found' };

    // Сложность выбирает игрок, но не всякая: объявленный у данжа список —
    // это и есть его правила. 'normal' берётся, когда игрок ничего не прислал
    // или прислал ерунду: отказ здесь был бы хуже, чем обычный заход, потому
    // что непонятно, что именно игрок сделал не так.
    const сложность =
      difficulty && (def.difficulties as string[]).includes(difficulty)
        ? difficulty
        : def.difficulties[0];

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
      bossTaken: new Set(),
      openedChests: new Set(),
      chests: [],
      killedBossIds: new Set(),
      // Новый заход: убитых боссов ещё нет. Заполняется по мере убийства и
      // переживает перезапуск — в отличие от killedBossIds.
      killedBossDefs: new Set(),
      startedAt: Date.now(),
      // Лимит захода начинает идти от входа, а не от первого тика таймера.
      expiresAt: DungeonService.expiresAtFrom(Date.now(), def.timeLimit),
      difficulty: сложность,
    deaths: new Map(),
    };

    this.spawnSessionMonsters(session, def);
    this.spawnSessionChests(session, def);

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
    const сложность = difficultyScaling(session.difficulty);
    for (const planned of planDungeonRooms(def)) {
      const room = def.rooms[planned.index];
      for (const monster of planned.monsters) {
        const базовый = MONSTERS_DATABASE[monster.monsterId];
        if (!базовый) continue;
        // Босс, убитый ДО перезапуска, не воскресает: ни экземпляра, ни
        // условия захода. Спавн здесь идёт и при первом входе, и при
        // восстановлении — набор killedBossDefs пуст при первом входе и
        // содержит убитых при восстановлении, так что одна функция годится
        // на оба случая.
        if (
          room.isBossRoom &&
          room.bossId === monster.monsterId &&
          session.killedBossDefs.has(room.bossId)
        ) {
          continue;
        }
        // Раскладку считает dungeonLayout: позиции в данных локальны к своей
        // комнате, и свод всех комнат в одну точку выносил часть монстров за
        // стену зала. Здесь берём уже готовые координаты.
        //
        // Копия определения, а не сам объект: масштабирование применяется к
        // ЗАХОДУ, а монстр в базе один на всех. Если бы мы меняли hp на
        // месте, то после hard-захода в normal умерший монстр остался бы с
        // тройным здоровьем до перезагрузки процесса.
        const monsterDef: typeof базовый = {
          ...базовый,
          hp: Math.round(базовый.hp * сложность.hp),
          strength: Math.round(базовый.strength * сложность.damage),
          agility: Math.round(базовый.agility * сложность.damage),
        };
        const ctx = this.ai.spawnMonster(
          monsterDef,
          { x: monster.x, y: monster.y, z: monster.z },
          session.shardId,
        );
        session.monsterIds.add(ctx.instanceId);
        this.monsterToSession.set(ctx.instanceId, session.id);
        // Обязателен ОДИН босс на комнату: решение владельца «хватает одного».
        // У крепости джиннов два, у гробницы убийц три — остальные экземпляры
        // остаются помехой и в условие захода не входят. Берётся ПЕРВЫЙ спавн
        // боссовой комнаты: порядок групп в данных не меняется от захода к
        // заходу, значит условие одинаково для всех, а не «кто добежал».
        if (
          room.isBossRoom &&
          room.bossId === monster.monsterId &&
          !session.bossTaken.has(room.bossId)
        ) {
          session.bossTaken.add(room.bossId);
          session.requiredBossIds.add(ctx.instanceId);
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
  /**
   * Завести сундуки захода.
   *
   * Координаты берутся из данных комнаты и проходят ту же обрезку по стене,
   * что и монстры: сундук не должен оказаться в стене или на месте босса.
   *
   * Число сверяется с treasureChests: если координат столько же, сундуки
   * встанут ровно там, где нарисованы. Расхождение — ошибка данных, и она
   * пишется в лог, а не молча исправляется.
   */
  private spawnSessionChests(session: DungeonSession, def: DungeonDefinition): void {
    let номер = 0;
    for (const план of planDungeonRooms(def)) {
      const комната = def.rooms[план.index];
      const позиции = комната.chestPositions ?? [];
      if (позиции.length !== комната.treasureChests) {
        logger.warn(
          `[Dungeon] ${def.id} / ${комната.id}: сундуков в данных ` +
            `${комната.treasureChests}, координат ${позиции.length}`
        );
      }
      for (const позиция of позиции) {
        номер++;
        session.chests.push({
          id: `${session.id}_ch_${номер}`,
          x: clampToRoom(def.entryX + позиция.x, def.entryX),
          z: clampToRoom(def.entryZ + позиция.z, def.entryZ),
        });
      }
    }
  }

  /**
   * Вскрыть сундук захода.
   *
   * Добыча идёт тому, кто открыл: решение владельца — сундук даёт золото и
   * опыт, и вскрывает один игрок. Раздача на весь заход остаётся за босгом.
   *
   * Четыре отказа, и каждый на своём месте: не свой заход, слишком далеко,
   * уже вскрыт, такого сундука нет. Повторное вскрытие сверяется с
   * openedChests, а не с наградой: иначе второй клиент вскрыл бы тот же
   * сундук повторно и получил бы добычу дважды.
   */
  async openChest(
    characterId: string,
    chestId: string,
    позиция: { x: number; z: number }
  ): Promise<ChestOpenResult> {
    const sessionId = this.characterToSession.get(characterId);
    if (!sessionId) return { ok: false, code: 'not_in_dungeon', gold: 0, experience: 0 };
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, code: 'not_in_dungeon', gold: 0, experience: 0 };

    const сундук = session.chests.find((с) => с.id === chestId);
    if (!сундук) return { ok: false, code: 'no_such_chest', gold: 0, experience: 0 };

    // Дистанция вскрытия. Без неё сундук открывается из любой точки мира:
    // вход в подземелье держится на памяти сервера, а не на координатах.
    const расстояние = Math.hypot(сундук.x - позиция.x, сундук.z - позиция.z);
    if (расстояние > CHEST_OPEN_RADIUS) {
      return { ok: false, code: 'too_far', gold: 0, experience: 0 };
    }

    if (session.openedChests.has(chestId)) {
      return { ok: false, code: 'already_opened', gold: 0, experience: 0 };
    }

    const def = DUNGEONS_DATABASE[session.dungeonId];
    const золото = chestGold(def.id);
    const опыт = chestExperience(def.id);

    // ПРИЗНАК В БАЗЕ, А НЕ ТОЛЬКО В ПАМЯТИ. Одной проверки в памяти
    // не хватало: сервер перезапускается на каждой выкатке, а
    // restoreActiveSessions собирал сессию с пустым openedChests и заново
    // создавал все сундуки. Вскрытый сундук становился невскрытым, и
    // золото с опытом платились повторно — сколько угодно раз.
    //
    // UPDATE с условием «ещё не вскрыт» отдаёт строку только одному
    // победителю: две вкладки или два запроса не заплатят дважды. Ровно
    // тот же приём, что у claimLoot, и по той же причине — SELECT и
    // последующая запись проигрывают гонку.
    const занял = await this.db
      .query<{ id: string }>(
        `UPDATE dungeon_sessions
            SET opened_chests = opened_chests || to_jsonb($2::text)
          WHERE id = $1 AND NOT (opened_chests ? $2)
        RETURNING id`,
        [session.id, chestId]
      )
      .then((строки) => строки.length > 0)
      .catch((e: unknown) => {
        logger.warn('[Dungeon] не удалось отметить сундук в базе:', (e as Error).message);
        // База недоступна — платить нельзя: повторная выплата после
        // восстановления захода была бы гарантированной. Отказ честнее.
        return false;
      });
    if (!занял) return { ok: false, code: 'already_opened', gold: 0, experience: 0 };
    session.openedChests.add(chestId);

    await this.characters.addGoldReward(characterId, золото).catch(() => {});
    await this.characters.addExperience(characterId, опыт).catch(() => {});

    return { ok: true, gold: золото, experience: опыт };
  }

  /** Сундуки захода персонажа: клиент рисует их по этому списку. */
  listChests(characterId: string): { id: string; x: number; z: number; opened: boolean }[] {
    const sessionId = this.characterToSession.get(characterId);
    if (!sessionId) return [];
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.chests.map((с) => ({
      id: с.id,
      x: с.x,
      z: с.z,
      opened: session.openedChests.has(с.id),
    }));
  }

  private async persistSession(session: DungeonSession): Promise<void> {
    // Размер берётся из данных подземелья, а не из вписанного значения.
    // Раньше здесь стояло 5: у гробницы, где в данных maxPlayers 20, в базу
    // всё равно писалось 5, и любое чтение этой колонки показывало неверный
    // размер захода.
    //
    // Сложность, наоборот, раньше писалась первая из объявленных, потому что
    // выбора сложности в игре не было: hard/heroic/mythic стояли в данных и
    // нигде не участвовали. Теперь сложность выбирает игрок (enter принимает
    // её третьим аргументом), и в базу пишется именно та, по которой идут
    // монстры и начисляется добыча.
    const def = DUNGEONS_DATABASE[session.dungeonId];
    const размер = def?.maxPlayers ?? 5;
    await this.db.query(
      `INSERT INTO dungeon_sessions (id, dungeon_id, difficulty, leader_id, max_size, started_at, status)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), 'active')
       ON CONFLICT (id) DO NOTHING`,
      [session.id, session.dungeonId, session.difficulty, session.leaderId, размер, session.startedAt]
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
      opened_chests: string[] | null; killed_boss_ids: string[] | null; difficulty: string | null;
    }>(
      `SELECT s.id, s.dungeon_id, s.leader_id, s.started_at,
              COALESCE(s.opened_chests, '[]'::jsonb)   AS opened_chests,
              COALESCE(s.killed_boss_ids, '[]'::jsonb) AS killed_boss_ids,
              s.difficulty
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
        bossTaken: new Set(),
        // Убитые боссы хранятся по ОПРЕДЕЛЕНИЮ (monsterId), а не по
        // instanceId: идентификатор экземпляра меняется при каждом спавне,
        // и после перезапуска сохранённые instanceId не совпали бы с новыми.
        // Тогда восстановленный заход с убитым боссом никогда не завершился
        // бы: условие «все обязательные боссы убиты» проверяет новые
        // идентификаторы по старому списку.
        //
        // Побочный и нужный эффект: босс из этого списка при восстановлении
        // не спавнится вообще. Воскресший босс — это второй заход того же
        // боя и вторая добыча с него.
        killedBossDefs: new Set(row.killed_boss_ids ?? []),
        openedChests: new Set(row.opened_chests ?? []),
        chests: [],
        killedBossIds: new Set(),
        startedAt: new Date(row.started_at).getTime(),
      // От времени старта, а не от момента восстановления: перезапуск не
      // имеет права продлить подземелье на полный срок.
      expiresAt: DungeonService.expiresAtFrom(new Date(row.started_at).getTime(), def.timeLimit),
      // Сложность из базы, а не первая из списка: заход heroic, переживший
      // перезапуск, обязан остаться heroic, иначе перезапуск тихо понижал
      // сложность до normal.
      difficulty: row.difficulty ?? def.difficulties[0],
      // Смерти ДО перезапуска читаются из таблицы. Раньше здесь стояло
      // «смерти восстановить нельзя, это дыра»: память умирала вместе с
      // сервером, и заход, в котором игрок умер до рестарта,
      // засчитывался как безсмертный.
      deaths: await this.loadDeaths(row.id),
      };
      session.members.add(row.leader_id);
      this.spawnSessionMonsters(session, def);
    this.spawnSessionChests(session, def);

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
    // Срок захода истёк, а тик таймера ещё не успел закрыть сессию. Без
    // этой проверки вход в последние секунды проходил бы успешно, и игрок
    // оказывался внутри захода, который вот-вот закроется под ним.
    if (session.expiresAt > 0 && session.expiresAt <= Date.now()) {
      return { ok: false, code: 'dungeon_time_expired' };
    }
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
  /**
   * Рекорды по данжу: самое быстрое прохождение и первые пять по времени.
   *
   * Таблица dungeon_history писалась с миграции 010 и годами только
   * пополнялась: во всём сервере было одно обращение — вставка. Рекорды
   * показывать было нечем. Запрос идёт по индексу (dungeon_id, result).
   *
   * Порядок однозначен: время, затем дата, затем имя. Без последнего
   * одинаковые результаты прыгали бы между собой при каждом запросе.
   *
   * Проходы без времени отбрасываются: незавершённый заход рекордом не
   * является, а «0 секунд» обошёл бы любой нормальный результат.
   */
  async dungeonRecords(dungeonId: string, сколько = 5): Promise<
    {
      // Имя берётся из characters.name: колонки name_ru у персонажа нет,
      // такая колонка есть только у питомцев.
      name: string;
      durationSec: number;
      completedAt: string;
      bossesKilled: number;
    }[]
  > {
    const строки = await this.db
      .query<{ name: string; duration_sec: number; completed_at: Date; bosses_killed: number }>(
        `SELECT c.name, h.duration_sec, h.completed_at, h.bosses_killed
           FROM dungeon_history h
           JOIN characters c ON c.id = h.character_id
          WHERE h.dungeon_id = $1
            AND h.result = 'completed'
            AND h.duration_sec IS NOT NULL
            AND h.duration_sec > 0
          ORDER BY h.duration_sec ASC, h.completed_at ASC, c.name ASC
          LIMIT $2`,
        [dungeonId, сколько]
      )
      .catch((e: unknown) => {
        logger.warn('[Dungeon] не удалось прочитать рекорды: ' + (e as Error).message);
        return [] as { name: string; duration_sec: number; completed_at: Date; bosses_killed: number }[];
      });
    return строки.map((с) => ({
      name: с.name,
      durationSec: Number(с.duration_sec),
      completedAt: new Date(с.completed_at).toISOString(),
      bossesKilled: Number(с.bosses_killed),
    }));
  }

  /**
   * Пригласить друга в заход. Возвращает идентификатор приглашения.
   *
   * Персонаж ищется по userId друга и только в регионе захода: персонажей у
   * пользователя может быть несколько, и «первый» мог бы оказаться не тем.
   *
   * Приглашение живёт 60 секунд: за это время заход закрывается, и принявший
   * присоединился бы к пустой сессии или к чужой.
   */
  async inviteToRun(
    inviterId: string,
    inviteeId: string,
  ): Promise<{ ok: true; inviteId: string; inviteeCharacterId: string } | { ok: false; code: string }> {
    const sessionId = this.characterToSession.get(inviterId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session || session.completedAt) return { ok: false, code: 'dungeon_not_in_run' };
    if (session.leaderId !== inviterId) return { ok: false, code: 'dungeon_not_leader' };
    if (session.members.size >= (DUNGEONS_DATABASE[session.dungeonId]?.maxPlayers || 1)) {
      return { ok: false, code: 'dungeon_full' };
    }

    // Кого приглашаем: персонажа из списка игроков региона или друга по
    // userId. Список региона отдаёт characterId, поэтому сначала ищем по id
    // персонажа и только потом по userId - иначе пригласить можно было бы
    // только друзей, а это и было ограничением: заход рассчитан на 8-20
    // человек, а набирать пришлосьсь из списка друзей.
    // Регион проверяется в обоих случаях: игрок из другого региона в заход
    // не попадёт, даже если его туда позвали.
    const персонаж =
      (await this.db
        .queryOne<{ id: string }>(
          `SELECT id FROM characters WHERE id = $1 AND region = $2 LIMIT 1`,
          [inviteeId, session.region],
        )
        .catch(() => null)) ??
      (await this.db
        .queryOne<{ id: string }>(
          `SELECT id FROM characters WHERE user_id = $1 AND region = $2 LIMIT 1`,
          [inviteeId, session.region],
        )
        .catch((e: unknown) => {
          logger.warn('[Dungeon] не удалось найти персонажа приглашённого:', (e as Error).message);
          return null;
        }));
    if (!персонаж) return { ok: false, code: 'dungeon_invitee_not_here' };
    if (session.members.has(персонаж.id)) return { ok: false, code: 'dungeon_already_in_run' };

    const inviteId = uuidv4();
    this.invites.set(inviteId, {
      inviteId,
      sessionId: session.id,
      inviterId,
      inviteeCharacterId: персонаж.id,
      expiresAt: Date.now() + 60 * 1000,
    });
    return { ok: true, inviteId, inviteeCharacterId: персонаж.id };
  }

  /**
   * Ответ на приглашение. При согласии приглашённый входит в заход.
   *
   * Приглашение одноразовое: после ответа оно удаляется, и повторно принять
   * его нельзя. Иначе один клик по старой кнопке втянул бы в уже закрытый заход.
   */
  async answerInvite(
    characterId: string,
    inviteId: string,
    accept: boolean,
  ): Promise<{ ok: true; joined: boolean } | { ok: false; code: string }> {
    const invite = this.invites.get(inviteId);
    if (!invite) return { ok: false, code: 'dungeon_invite_unknown' };
    if (invite.inviteeCharacterId !== characterId) {
      return { ok: false, code: 'dungeon_invite_not_yours' };
    }
    this.invites.delete(inviteId);
    if (Date.now() > invite.expiresAt) return { ok: false, code: 'dungeon_invite_expired' };
    if (!accept) return { ok: true, joined: false };

    const result = await this.join(characterId, invite.sessionId);
    if (!result.ok) return { ok: false, code: result.code };
    return { ok: true, joined: true };
  }

  /** Отозвать приглашение: заход закрылся, друг ушёл, срок вышел. */
  dropInvites(sessionId: string): void {
    for (const [inviteId, invite] of this.invites) {
      if (invite.sessionId === sessionId) this.invites.delete(inviteId);
    }
  }

  /** Заодно и приглашения, срок которых вышел: иначе память растёт вечно. */
  dropExpiredInvites(now: number = Date.now()): number {
    let снято = 0;
    for (const [inviteId, invite] of this.invites) {
      if (now > invite.expiresAt) {
        this.invites.delete(inviteId);
        снято++;
      }
    }
    return снято;
  }

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

  /**
   * Проклятие Шеиха: страх всем, кто выходит из захода.
   *
   * Вид fear уже был в системе эффектов, но ни на что не влиял: монстры его
   * навешивали, а код проверял только stun, slow, bleed и poison. Без этой
   * функции «проклятие» было бы иконкой.
   *
   * Срок — 5 минут. Ровно столько, чтобы страх ощущался, и мало настолько,
   * чтобы заход можно было повторить: у гробницы один вход в сутки, и
   * наказание в четверть суток делало бы её непроходимой.
   *
   * Повторный навес не кладёт вторую строку, а продлевает срок: ключ таблицы
   * (персонаж, вид эффекта), ровно как у удара монстра.
   */
  private async curseSheikhRun(участники: Iterable<string>, sessionId: string): Promise<void> {
    const план: DebuffPlan = {
      debuffId: 'sheikh_curse',
      kind: 'fear',
      durationMs: 5 * 60 * 1000,
      magnitude: 0,
      tickDamage: 0,
      tickMs: 0,
    };
    const debuffs = new DebuffService();
    for (const characterId of участники) {
      await debuffs
        .apply(characterId, план, `dungeon:${sessionId}`)
        .catch((e: unknown) => {
          logger.warn('[Dungeon] не удалось наложить проклятие:', (e as Error).message);
        });
    }
  }

  // Приглашения снимаются вместе с заходом: приглашённый не должен ждать
  // минуту и потом присоединиться к закрытой сессии.
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
    // Проклятие Шеиха на выходе — и при досрочном уходе тоже: владелец
    // выбрал «все участники захода», а не «те, кто дошёл до босса».
    // Состав снимается ДО удаления человека из members.
    const заходПроклятия = this.characterToSession.get(characterId);
    if (заходПроклятия) {
      const сессия = this.sessions.get(заходПроклятия);
      if (сессия && !сессия.completedAt) {
      if (сессия) this.dropInvites(сессия.id);
        await this.curseSheikhRun([...сессия.members], сессия.id);
      }
    }
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

  /**
   * Заход по идентификатору.
   *
   * Нужен рейдам: рейд в Redis хранит sessionId, и список открытых рейдов
   * обязан знать, жива ли сессия. Без этой проверки в списке оставались бы
   * рейды, чей заход давно закрыт, и кнопка «вступить» вела бы в никуда.
   *
   * Отдаём и завершённые: вызывающий сам решает, годятся ли они. Скрывать
   * completedAt от читателя — значит прятать признак, по которому решают.
   */
  getSession(sessionId: string): DungeonSession | undefined {
    return this.sessions.get(sessionId);
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
      await this.recordBossKilled(session, instanceId);

      if ([...session.requiredBossIds].every(id => session.killedBossIds.has(id))) {
        return this.complete(session, killerId);
      }
    }
    return null;
  }

  /**
   * Отметить босса убитым в базе — по идентификатору ОПРЕДЕЛЕНИЯ.
   *
   * Зачем в базе. Сервер перезапускается на каждой выкатке, а состав захода
   * собирается заново из данных. Без этой записи убитый босс воскресал бы и
   * убивался повторно, а заход, где его уже убили, никогда бы не сошёлся.
   *
   * Почему определение, а не экземпляр: instanceId создаётся заново при
   * каждом спавне, и записанный до перезапуска не совпал бы с новым.
   *
   * UPDATE идемпотентен: повторная запись того же босса ничего не меняет,
   * поэтому повторный вызов безопасен.
   */
  private async recordBossKilled(session: DungeonSession, instanceId: string): Promise<void> {
    const monsterId = this.ai.getContext(instanceId)?.monsterId;
    if (!monsterId || session.killedBossDefs.has(monsterId)) return;
    session.killedBossDefs.add(monsterId);
    await this.db
      .query(
        `UPDATE dungeon_sessions
            SET killed_boss_ids = killed_boss_ids || to_jsonb($2::text)
          WHERE id = $1`,
        [session.id, monsterId]
      )
      .catch((e: unknown) => {
        logger.warn('[Dungeon] не удалось отметить босса в базе:', (e as Error).message);
      });
  }

  private async complete(session: DungeonSession, killerId: string): Promise<DungeonCompleteInfo> {
    session.completedAt = Date.now();
    const def = DUNGEONS_DATABASE[session.dungeonId];
    const множитель = difficultyScaling(session.difficulty).reward;

    // МИНИМУМ БОЙЦОВ ДЛЯ РЕЙДА.
    //
    // Поле minPlayers стояло в данных всех шести подземелий и не читалось
    // нигде. Проверять его у всех нельзя: у караван-сарая заявлено 5, у
    // гробницы 3, и жёсткий минимум сделал бы одиночную игру невозможной.
    // Поэтому правило действует ТОЛЬКО у рейдов - там, где заявлено
    // `isRaid` (Багдадская цитадель: 10 из 20).
    //
    // Проверка стоит здесь, а не во входе: рейд и собирают, открывая сбор и
    // набирая людей. Запретить вход одному значило бы запретить открыть сбор
    // вообще - то есть сделать рейд недостижимым. Недостижимым он становится
    // на завершении: штурм меньшим составом не засчитывается.
    if (def.isRaid && session.members.size < def.minPlayers) {
      session.completedAt = undefined;
      return {
        participants: 0,
        goldEach: 0,
        sessionId: session.id,
        dungeonId: def.id,
        dungeonNameRu: def.nameRu,
        experience: 0,
        gold: 0,
        items: [],
        code: 'raid_under_min_players',
        minPlayers: def.minPlayers,
        have: session.members.size,
        shares: [],
      };
    }

    const gold = Math.round(
      (def.rewards.gold.min + Math.floor(Math.random() * (def.rewards.gold.max - def.rewards.gold.min + 1))) * множитель
    );

    // Добыча делится на весь заход и выдаётся один раз. Порядок обхода
    // members — это порядок входа: на нём стоит остаток золота лидеру и
    // очередь предметов.
    const участники = [...session.members];
    const народу = Math.max(1, участники.length);
    const каждому = Math.floor(gold / народу);
    const остаток = gold - каждому * народу;

    // Бонусная добыча. Поле bonusItems было объявлено у всех пяти подземелий
    // (тринадцать записей, шансы от 0.001 до 0.4) и не читалось никогда:
    // выдавались только гарантированные предметы, а обещанное в данных не
    // выпадало ни разу. Бросок делается один на заход, и выпавшее идёт в
    // общий круг раздачи - одинокий игрок забирает всё, а группа делит так же,
    // как гарантированные предметы.
    const бонус = rollBonusItems(def.rewards.bonusItems, Math.random);
    const добыча = [...def.rewards.guaranteedItems, ...бонус];

    // Предметы идут по кругу участников: каждый достаётся ровно один раз.
    // Формула «предмет i достаётся участнику i» отдавала бы лишние
    // предметы НИКОМУ — при двух людях и трёх предметах третий исчезал бы.
    // По кругу он достаётся лидеру, и ни одна добыча не пропадает.
    const получили = участники.map((characterId, порядок) => ({
      characterId,
      experience: Math.round(def.rewards.experience * множитель),
      // Остаток от деления золота — лидеру захода, он первый во входе.
      gold: каждому + (порядок === 0 ? остаток : 0),
      items: добыча.filter((_, i) => i % народу === порядок),
    }));

    // Проклятие Шеиха: страх всем участникам захода. Навешивается после
    // раздачи и независимо от неё: добычу можно получить один раз, а страх
    // должен достаться каждому, кто был в заходе.
    await this.curseSheikhRun(участники, session.id);
    // Приглашения снимаются вместе с заходом: приглашённый не должен ждать
    // минуту и потом присоединиться к закрытой сессии.
    this.dropInvites(session.id);
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
      experience: Math.round(def.rewards.experience * множитель),
      gold,
      // Именно выданное, а не объявленное в данных: экран захода не имеет
      // права показывать предмет, который не достался никому.
      items: добыча,
      participants: участники.length,
      goldEach: каждому,
      // Доля каждого участника - то же, что ушло на сервер, а не пересчёт
      // заново: показываем игроку ровно то, что он получил.
      shares: получили.map((доля) => ({
        characterId: доля.characterId,
        gold: доля.gold,
        experience: доля.experience,
        items: доля.items,
      })),
    };
    logger.info(`[Dungeon] ${def.nameRu} completed by ${killerId} (+${Math.round(def.rewards.experience * множитель)}xp, +${gold}g)`);
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
  /**
   * Когда заход истекает. Ноль, если лимита нет.
   *
   * Минуты в данных, миллисекунды здесь. Ноль означает «без срока», а не
   * «истёк сейчас»: сравнение с нулём иначе закрыло бы заход мгновенно.
   */
  private static expiresAtFrom(startedAt: number, timeLimitMinutes: number): number {
    return timeLimitMinutes > 0 ? startedAt + timeLimitMinutes * 60_000 : 0;
  }

  /** Сколько секунд осталось заходу. 0 — срок вышел или его не было. */
  timeLeftSec(session: DungeonSession): number {
    if (!session.expiresAt) return 0;
    return Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000));
  }

  /**
   * Закрыть заходы, у которых вышел срок. Возвращает число закрытых.
   *
   * Заход закрывается как `abandoned`: награды не выдаётся, попытка не
   * тратится повторно (она уже списана при входе), участники просто
   * оказываются снаружи. Об этом им сообщается — молча закрывать заход
   * хуже, чем не закрывать вовсе: игрок не понимает, что произошло.
   *
   * Отдельная функция, а не проверка при входе: заход может простаивать,
   * и без обхода по тику он висел бы в памяти до перезапуска сервера.
   */
  async expireOverdueSessions(): Promise<number> {
    const теперь = Date.now();
    const просроченные = [...this.sessions.values()].filter(
      (сессия) => !сессия.completedAt && сессия.expiresAt > 0 && сессия.expiresAt <= теперь
    );
    for (const session of просроченные) {
      session.completedAt = теперь;
      await this.closeSessionInDb(session.id, 'abandoned');
      logger.info(
        `[Dungeon] заход ${session.id} (${session.dungeonId}) закрыт по сроку ` +
          `(${session.members.size} участников)`
      );
      this.disposeSession(session);
    }
    if (просроченные.length) {
      logger.info(`[Dungeon] закрыто по сроку заходов: ${просроченные.length}`);
    }
    return просроченные.length;
  }

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
