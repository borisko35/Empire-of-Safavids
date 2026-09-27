import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../utils/logger';
import { RedisService } from '../services/RedisService';
import { DatabaseService } from '../services/DatabaseService';
import { CharacterService } from '../services/CharacterService';
import { LeaderboardService } from '../services/LeaderboardService';
import { CombatService } from '../services/CombatService';
import { EquipmentCache } from '../services/EquipmentCache';
import { getBuffService } from '../services/BuffService';
import { AntiCheatSystem } from '../systems/AntiCheatSystem';
import { KarmaSystem, PVP_ZONES } from '../systems/KarmaSystem';
import { QuestService } from '../services/QuestService';
import { DailyTaskService } from '../services/DailyTaskService';
import { PvPService } from '../services/PvPService';
import { pvpArena } from '../systems/PvpArenaService';
import { initPvpArena, announceArenaEnd } from '../systems/PvpArenaFlow';
import { GameLoop } from '../systems/GameLoop';
import { AIContext } from '../systems/AISystem';
import { DefenseStates } from '../systems/DefenseStates';
import { DungeonService } from '../systems/DungeonService';
import { WorldEventSystem } from '../systems/WorldEventSystem';
import { PartySystem } from '../systems/PartySystem';
import { LevelingSystem } from '../systems/LevelingSystem';
import { Character, CombatAction, Region } from '../types/game.types';
import { ITEMS_DATABASE } from '../data/items';
import { getInterior, canEnter, isInsideRoom, INTERIORS } from '../data/interiors';
import { SOCKET_EVENTS, SERVER_EVENTS, REDIS_CHANNELS, CHAT_LIMITS, GAME_SERVERS, getRegionSpawn } from '../../../shared/constants';
import { isDeepWater } from '../utils/spawn';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  characterId?: string;
  region?: Region;
  /** Имя персонажа для чата (кэшируется при AUTH). */
  senderName?: string;
  /** Роль для бейджа в чате: owner/admin/moderator (кэшируется при AUTH). */
  senderRole?: 'owner' | 'admin' | 'moderator' | null;
  /** Игровой сервер (шард) персонажа */
  shardId?: string;
}

type ChatChannel = 'world' | 'region' | 'guild' | 'party';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class GameSocketHandler {
  private static instance: GameSocketHandler | null = null;

  private io: SocketIOServer;
  private redis = RedisService.getInstance();
  private characterService = new CharacterService();
  /**
   * Рейтинг игроков.
   *
   * Нужен ради одной строки в regenTick: без неё таблица leaderboard
   * оставалась пустой, и «Топ-10 игроков» на главной странице сайта всегда
   * показывал «пока нет данных».
   */
  private leaderboardService = new LeaderboardService();
  private combatService = new CombatService();
  private antiCheat = new AntiCheatSystem();
  private karmaSystem = new KarmaSystem();
  private questService = new QuestService();
  private equipment = EquipmentCache.getInstance();
  private buffs = getBuffService();
  private defenseStates = DefenseStates.getInstance();
  private dungeons = DungeonService.getInstance();
  private worldEvents = WorldEventSystem.getInstance();
  private dailyTasks = new DailyTaskService();
  private partySystem = new PartySystem();

  // Активные игроки: characterId -> сокет
  private activePlayers = new Map<string, AuthenticatedSocket>();
  /** Таймер арены: следит за временем боя */
  private arenaTimer?: NodeJS.Timeout;

  /** Остановить таймер при остановке сервера */
  stopArenaTimer(): void {
    if (this.arenaTimer) clearInterval(this.arenaTimer);
  }
  // Кулдауны навыков: characterId -> (skillId -> готовность с epoch ms)
  private skillCooldowns = new Map<string, Map<string, number>>();
  // Троттлинг записи позиции в PostgreSQL: characterId -> последняя запись
  private lastPositionPersist = new Map<string, number>();
  private lastQuestEval = new Map<string, number>();
  // Серия лёгких атак (комбо): characterId -> { count, lastAt }
  private comboChains = new Map<string, { count: number; lastAt: number }>();

  /** Широковещательное объявление мирового события — только шарду события */
  broadcastWorldEvent(payload: Record<string, unknown>): void {
    const room = payload.shardId ? `shard:${String(payload.shardId)}` : undefined;
    if (room) this.io.to(room).emit(SERVER_EVENTS.WORLD_EVENT, payload);
    else this.io.emit(SERVER_EVENTS.WORLD_EVENT, payload);
  }

  constructor(io: SocketIOServer) {
    this.io = io;
    GameSocketHandler.instance = this;
    // PvP-арена поднимается из REST-маршрута find-match, а сокет игрока
    // есть только здесь. Поэтому отдаём наружу способ отправить событие
    // конкретному игроку, а сам сокет об арене не знает.
    initPvpArena(
      (characterId, event, payload) => {
        this.activePlayers.get(characterId)?.emit(event, payload);
      },
      new PvPService(),
    );
    // Таймер боя: без него бой длился бы, пока соперник не выйдет,
    // и «победа по времени» (у кого больше HP) никогда не срабатывала бы
    this.arenaTimer = setInterval(() => {
      const ended = pvpArena.checkTimeout();
      if (ended) announceArenaEnd(ended.matchId, ended.winnerId, 'time');
    }, 1000);
  }

  /** Доступ из REST-роутов (например, travel): текущий обработчик сокетов */
  static getInstance(): GameSocketHandler | null {
    return GameSocketHandler.instance;
  }

  /**
   * Переместить онлайн-игрока в новый регион: комнаты сокета + членство в Redis.
   * Вызывается REST-эндпоинтом /api/world/travel после смены региона в БД.
   */
  async movePlayerRegion(characterId: string, oldRegion: Region, newRegion: Region): Promise<void> {
    const socket = this.activePlayers.get(characterId) as (AuthenticatedSocket & { shardId?: string }) | undefined;
    const shardId = socket?.shardId ?? 'isfahan';
    if (socket) {
      socket.leave(`shard:${shardId}:region:${oldRegion}`);
      socket.join(`shard:${shardId}:region:${newRegion}`);
      socket.region = newRegion;
      socket.to(`shard:${shardId}:region:${oldRegion}`).emit(SOCKET_EVENTS.PLAYER_LEFT, { characterId });
      // Позиция персонажа в новом регионе — текущая в мире (мир бесшовный)
      const character = await this.characterService.getCharacterById(characterId).catch(() => null);
      this.io.to(`shard:${shardId}:region:${newRegion}`).emit(SOCKET_EVENTS.PLAYER_JOINED, {
        characterId,
        name: character?.name ?? '',
        class: character?.class ?? '',
        position: character?.position ?? { x: 0, y: 0, z: 0 },
      });
    }
    await this.redis.removePlayerFromRegion(shardId, oldRegion, characterId).catch(() => {});
    await this.redis.addPlayerToRegion(shardId, newRegion, characterId).catch(() => {});
    // После travel-телепорта сбросить базовую точку античита
    const movedChar = await this.characterService.getCharacterById(characterId).catch(() => null);
    if (movedChar) this.antiCheat.resetPosition(characterId, movedChar.position);
  }

  initialize(): void {
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      logger.info(`Player connected: ${socket.id}`);

      // Аутентификация
      socket.on(SOCKET_EVENTS.AUTH, async (data: { token: string; characterId: string }) => {
        await this.handleAuth(socket, data);
      });

      // Движение персонажа
      socket.on(SOCKET_EVENTS.PLAYER_MOVE, async (data: {
        position: { x: number; y: number; z: number };
        direction: { x: number; y: number; z: number };
      }) => {
        await this.handlePlayerMove(socket, data);
      });

      // Боевые действия
      socket.on(SOCKET_EVENTS.COMBAT_ACTION, async (action: CombatAction) => {
        await this.handleCombatAction(socket, action);
      });

      // Чат
      socket.on(SOCKET_EVENTS.CHAT_MESSAGE, (data: { message: string; channel: ChatChannel }) => {
        this.handleChatMessage(socket, data);
      });

      // Интерьеры: вход/выход из зданий (с серверной проверкой координат).
      // Клиент телепортируется ТОЛЬКО по ack — иначе первый же пакет
      // движения из кармана прилетает раньше сброса трекинга и даёт кик.
      socket.on(SOCKET_EVENTS.INTERIOR_ENTER, async (
        data: { buildingId: string },
        ack?: (res: { ok: boolean; target?: { x: number; y: number; z: number }; reason?: string }) => void,
      ) => {
        await this.handleInterior(socket, data?.buildingId, 'enter', ack);
      });
      socket.on(SOCKET_EVENTS.INTERIOR_EXIT, async (
        data: { buildingId: string },
        ack?: (res: { ok: boolean; target?: { x: number; y: number; z: number }; reason?: string }) => void,
      ) => {
        await this.handleInterior(socket, data?.buildingId, 'exit', ack);
      });

      // Отключение
      socket.on('disconnect', async () => {
        await this.handleDisconnect(socket);
      });
    });

    // Регенерация ресурсов онлайн-игроков раз в 5 секунд (+ синк клиенту)
    void setInterval(() => { this.regenTick().catch(() => {}); }, 5000);
  }

  /** Медленная регенерация hp/маны/стамины онлайн-игроков + синк состояния */
  private async regenTick(): Promise<void> {
    for (const socket of this.activePlayers.values()) {
      if (!socket.characterId) continue;
      try {
        // Вода определяется по последней известной серверу позиции —
        // клиенту нельзя просто сказать «я в воде», чтобы не тратить стамину
        const pos = await this.redis.getPlayerPosition(socket.characterId).catch(() => null) as
          { x: number; z: number } | null;
        const inWater = !!pos && isDeepWater(pos.x, pos.z);
        const res = await this.characterService.regenResources(socket.characterId, inWater);
        if (res) socket.emit(SERVER_EVENTS.RESOURCES, res);
        // ТУТ БЫЛА ПУСТАЯ ТАБЛИЦА РЕЙТИНГА. LeaderboardService.updateStats
        // не вызывался НИ ОТКУДА: единственный INSERT INTO leaderboard во
        // всём сервере так и не выполнялся. При этом таблица создана, индексы
        // на неё есть, маршрут /api/leaderboard/:type работает, и на главной
        // странице сайта висел «Топ-10 игроков», который всегда показывал «пока
        // нет данных». Игрок заходил, качался — и попадать в рейтинг было
        // некуда.
        //
        // Здесь самое честное место для вызова: тик идёт раз в 5 секунд по
        // каждому онлайн-игроку и уже возвращает уровень и опыт. Синхронизация
        // получается инкрементальной и самовосстанавливающейся: новый игрок
        // появляется в рейтинге через несколько секунд после входа, без
        // отдельного задания и без обхода всей таблицы.
        //
        // Передаём ТОЛЬКО то, что известно и совпадает со схемой leaderboard.
        // Убийства, квесты и PvP считаются в других местах и сюда не
        // подставляются: иначе затирали бы настоящие значения нулями.
        if (res) {
          await this.leaderboardService.updateStats(socket.characterId, {
            level: res.level,
            experience: res.experience,
          }).catch((error) => logger.debug('Leaderboard sync skipped:', error));
        }
      } catch (error) {
        logger.debug('Regen tick skipped:', error);
      }
    }
  }

  // ============================================================
  // Подписчики Redis pub/sub (раньше события публиковались в пустоту)
  // ============================================================
  async subscribeToRedisEvents(): Promise<void> {
    // Персональные уведомления (NotificationService пишет в общий канал)
    await this.redis.subscribe(REDIS_CHANNELS.PLAYER_NOTIFICATION, (msg) => {
      const socket = this.activePlayers.get(String(msg.characterId));
      if (socket) socket.emit(SERVER_EVENTS.NOTIFICATION, msg);
    });

    // Уведомления регионам, спавн и ИИ — игрокам шарда в регионе.
    // Регионы изолированы по шардам: 8 серверов × 7 регионов.
    for (const shardId of GAME_SERVERS.map(s => s.id)) {
      for (const region of Object.values(Region)) {
        const room = `shard:${shardId}:region:${region}`;
        await this.redis.subscribe(REDIS_CHANNELS.REGION_NOTIFICATION(shardId, region), (msg) => {
          this.io.to(room).emit(SERVER_EVENTS.NOTIFICATION, msg);
        });
        await this.redis.subscribe(REDIS_CHANNELS.REGION_SPAWN(shardId, region), (msg) => {
          this.io.to(room).emit(SERVER_EVENTS.MONSTER_SPAWNED, msg);
        });
        await this.redis.subscribe(REDIS_CHANNELS.REGION_AI_ACTION(shardId, region), (msg) => {
          this.io.to(room).emit('monster:ai_action', msg);
        });
        await this.redis.subscribe(REDIS_CHANNELS.REGION_MONSTER_KILLED(shardId, region), (msg) => {
          this.io.to(room).emit(SERVER_EVENTS.MONSTER_KILLED, msg);
        });
        // Монстр ударил игрока: персональный COMBAT_HIT + визуал региону
        await this.redis.subscribe(REDIS_CHANNELS.REGION_MONSTER_HIT(shardId, region), (msg: Record<string, unknown>) => {
          const socket = this.activePlayers.get(String(msg.characterId));
          if (socket) {
            socket.emit(SOCKET_EVENTS.COMBAT_HIT, {
              attackerId: String(msg.instanceId),
              damage: Number(msg.damage),
              isDodged: Boolean(msg.isDodged),
              isBlocked: Boolean(msg.isBlocked),
              hp: Number(msg.hp),
              maxHp: Number(msg.maxHp),
            });
          }
          this.io.to(room).emit(SOCKET_EVENTS.COMBAT_VISUAL, {
            attackerId: String(msg.instanceId),
            targetId: String(msg.characterId),
            actionType: 'attack',
          });
          if (msg.died) this.handleDeathById(String(msg.characterId)).catch(() => {});
        });
      }
    }

    // Санкции анти-чита: кик/бан активной сессии
    const handleSanction = (msg: Record<string, unknown>) => {
      this.forceDisconnect(String(msg.characterId), `Анти-чит: ${String(msg.reason ?? 'violation')}`);
    };
    await this.redis.subscribe(REDIS_CHANNELS.ANTI_CHEAT_KICK, handleSanction);
    await this.redis.subscribe(REDIS_CHANNELS.ANTI_CHEAT_BAN, handleSanction);

    // Выход (в т.ч. logout-all): разрываем активные сокеты пользователя
    const handleLogout = async (msg: Record<string, unknown>) => {
      const userId = String(msg.userId);
      for (const socket of this.activePlayers.values()) {
        if (socket.userId === userId) {
          socket.emit(SERVER_EVENTS.FORCE_DISCONNECT, { reason: 'session_revoked' });
          socket.disconnect(true);
        }
      }
    };
    await this.redis.subscribe(REDIS_CHANNELS.AUTH_LOGOUT, handleLogout);
    await this.redis.subscribe(REDIS_CHANNELS.AUTH_LOGOUT_ALL, handleLogout);

    // Игровое время (день/ночь/погода) всем клиентам
    await this.redis.subscribe(REDIS_CHANNELS.WORLD_TIME_UPDATE, (msg) => {
      this.io.emit(SERVER_EVENTS.WORLD_TIME, msg);
    });

    // Изменение кармы конкретному игроку
    await this.redis.subscribe(REDIS_CHANNELS.PLAYER_KARMA_CHANGED, (msg) => {
      const socket = this.activePlayers.get(String(msg.characterId));
      if (socket) socket.emit(SERVER_EVENTS.KARMA_CHANGED, msg);
    });

    logger.info('[Socket] Redis pub/sub subscribers registered');
  }

  // ============================================================
  // Аутентификация
  // ============================================================
  private async handleAuth(socket: AuthenticatedSocket, data: { token: string; characterId: string }): Promise<void> {
    try {
      const userId = await this.redis.getSession(data.token);
      if (!userId) {
        socket.emit(SOCKET_EVENTS.AUTH_ERROR, { message: 'Invalid session' });
        return;
      }

      const character = await this.characterService.getCharacterById(data.characterId);
      if (!character || character.userId !== userId) {
        socket.emit(SOCKET_EVENTS.AUTH_ERROR, { message: 'Character not found' });
        return;
      }

      // Спасение из воды: если сохранённая позиция оказалась в озере/реке
      // (отключился во время плавания), вернуть на стартовую точку региона,
      // иначе игрок каждый вход появляется в воде без возможности выйти
      if (character.position && isDeepWater(character.position.x, character.position.z)) {
        const spawn = getRegionSpawn(character.region);
        character.position = { x: spawn.x, y: 0, z: spawn.z };
        await this.characterService.updatePosition(character.id, character.position).catch(() => {});
        logger.info(`Player rescued from water to region spawn: ${character.id} (${character.region})`);
      }

      socket.userId = userId;
      socket.characterId = character.id;
      socket.region = character.region;
      socket.senderName = character.name;
      // Роль для бейджа в чате: один запрос при входе, дальше из кэша сокета.
      try {
        const adminRow = await DatabaseService.getInstance().queryOne<{
          is_admin: boolean; admin_role: string | null;
        }>('SELECT is_admin, admin_role FROM users WHERE id = $1', [userId]);
        socket.senderRole = !adminRow?.is_admin
          ? null
          : adminRow.admin_role === 'owner'
            ? 'owner'
            : adminRow.admin_role === 'gm'
              ? 'moderator'
              : 'admin';
      } catch {
        socket.senderRole = null;
      }
      // Шард из привязки персонажа (по умолчанию — Исфахан для старых персонажей)
      (socket as AuthenticatedSocket & { shardId?: string }).shardId =
        character.serverId && GAME_SERVERS.some(s => s.id === character.serverId)
          ? character.serverId
          : 'isfahan';
      const shardId = (socket as AuthenticatedSocket & { shardId?: string }).shardId!;

      // Присоединить к комнатам шарда и региона
      socket.join(`shard:${shardId}`);
      socket.join(`shard:${shardId}:region:${character.region}`);
      if (character.guildId) {
        socket.join(`guild:${character.guildId}`);
      }
      // Активировать шард: заселить монстрами, если он ещё пуст
      GameLoop.getInstance().getSpawnSystem().activateShard(shardId);
      await this.redis.addPlayerToRegion(shardId, character.region, character.id).catch(() => {});
      // Позиция в Redis сразу: иначе стоящий игрок невидим для ИИ,
      // пока клиент не пошлёт первый player:move
      await this.redis.setPlayerPosition(character.id, character.position).catch(() => {});
      this.activePlayers.set(character.id, socket);
      // Базовая точка античита = точка спавна: первый пакет движения
      // после входа не должен считаться телепортом от старой позиции
      this.antiCheat.resetPosition(character.id, character.position);

      socket.emit(SOCKET_EVENTS.AUTH_SUCCESS, { character });

      // Время и погода сразу при входе. Раньше они приходили только общим
      // вещанием раз в минуту, поэтому игрок до минуты видел «ясно» и бурю,
      // которая шла прямо в момент входа. То же самое касалось реконнекта.
      socket.emit(SERVER_EVENTS.WORLD_TIME, GameLoop.getInstance().getWorldTime());

      // Снапшот активных монстров этого шарда в регионе (заспавненных до входа)
      const ai = GameLoop.getInstance().getSpawnSystem().getAI();
      for (const ctx of ai.getAllInstances()) {
        if (ctx.shardId === shardId && ctx.definition.region === character.region && ctx.state !== 'dead') {
          socket.emit(SERVER_EVENTS.MONSTER_SPAWNED, {
            instanceId: ctx.instanceId,
            monsterId: ctx.definition.id,
            nameRu: ctx.definition.nameRu,
            position: ctx.position,
            hp: ctx.currentHp,
            maxHp: ctx.maxHp,
            type: ctx.definition.type,
          });
        }
      }

      // Уведомить других игроков шарда в регионе
      socket.to(`shard:${shardId}:region:${character.region}`).emit(SOCKET_EVENTS.PLAYER_JOINED, {
        characterId: character.id,
        name: character.name,
        class: character.class,
        position: character.position,
      });

      logger.info(`Player authenticated: ${character.name} (${character.class}) on ${shardId} in ${character.region}`);
    } catch (error) {
      logger.error('Auth error:', error);
      socket.emit(SOCKET_EVENTS.AUTH_ERROR, { message: 'Authentication failed' });
    }
  }

  // ============================================================
  // Движение (с проверкой анти-чита)
  // ============================================================
  private async handlePlayerMove(
    socket: AuthenticatedSocket,
    data: { position: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } }
  ): Promise<void> {
    if (!socket.characterId || !socket.region) return;
    const characterId = socket.characterId;

    // Частота пакетов
    const rateCheck = this.antiCheat.validatePacketRate(characterId);
    if (!rateCheck.valid) {
      await this.punish(socket, 'packet_flood', rateCheck.reason ?? 'packet flood', 2);
      return;
    }

    // Скорость / телепорт
    const moveCheck = this.antiCheat.validateMovement(characterId, data.position);
    if (!moveCheck.valid) {
      // Амнистия переходов у дверей и внутри комнат: легальный вход/выход
      // (включая старые клиенты без ack и граничные случаи) никогда не кикает.
      // Позиция принимается, трекинг сбрасывается — как travel/respawn.
      const px = data.position.x, pz = data.position.z;
      const legal = Object.values(INTERIORS).some(
        (d) => isInsideRoom(d, px, pz) || Math.hypot(px - d.doorX, pz - d.doorZ) <= 30
      );
      if (legal) {
        this.antiCheat.resetPosition(characterId, data.position);
      } else {
        await this.punish(socket, 'speed_hack', moveCheck.reason ?? 'invalid movement', 2);
        socket.emit(SOCKET_EVENTS.MOVE_REJECTED, { reason: moveCheck.reason });
        return;
      }
    }

    // Кэшировать позицию в Redis (быстро)
    await this.redis.setPlayerPosition(characterId, data.position).catch(() => {});

    // В PostgreSQL пишем не чаще раза в 5 секунд (движение генерирует десятки пакетов/сек)
    const now = Date.now();
    if (now - (this.lastPositionPersist.get(characterId) ?? 0) > 5000) {
      this.lastPositionPersist.set(characterId, now);
      await this.characterService.updatePosition(characterId, data.position).catch(() => {});
      // Заодно проверяем квесты (collect/kill-смешанные): движение = активность
      const done = await this.questService.evaluateQuests(characterId).catch(() => []);
      if (done.length) {
        socket.emit(SERVER_EVENTS.QUEST_COMPLETED, { quests: done });
      }
      this.lastQuestEval.set(characterId, now);
    }

    // Транслировать другим игрокам в регионе
    socket.to(`shard:${socket.shardId}:region:${socket.region}`).emit(SOCKET_EVENTS.PLAYER_MOVED, {
      characterId,
      position: data.position,
      direction: data.direction,
      timestamp: now,
    });
  }

  // ============================================================
  // Бой: ресурсы, кулдауны, лечение, урон, смерть, карма
  // ============================================================

  /**
   * Персонаж с учётом боевых бонусов экипировки И временных эффектов
   * (миграция 030). Порядок важен: сначала снаряжение, потом бонусы —
   * оба считаются от базовых статов.
   */
  private async withEquipment(character: Character): Promise<Character> {
    const stats = await this.equipment.mergeInto(character);
    const withGear = { ...character, stats };
    const withBuffs = await this.buffs.mergeInto(withGear);
    return { ...withGear, stats: withBuffs };
  }

  /**
   * Активная защита: dodge (1.5с неуязвимости) и block (2с −60% урона).
   * Тратят стамину, цели не требуют; состояние читает боевой цикл.
   */
  private async handleDefensiveAction(socket: AuthenticatedSocket, action: CombatAction): Promise<void> {
    if (!socket.characterId) return;
    const character = await this.characterService.getCharacterById(socket.characterId);
    if (!character) return;

    const staminaCost = action.actionType === 'dodge' ? 15 : 10;
    const ok = await this.characterService.spendResources(character.id, 0, staminaCost);
    if (!ok) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { message: 'Not enough stamina' });
      return;
    }

    if (action.actionType === 'dodge') this.defenseStates.activateDodge(character.id);
    else this.defenseStates.activateBlock(character.id);

    socket.emit(SERVER_EVENTS.COMBAT_BLOCKED, {
      actionType: action.actionType,
      characterId: character.id,
    });
  }

  /** Множитель серии лёгких атак: каждый третий удар серии бьёт в 1.5× */
  private comboMultiplier(characterId: string, action: CombatAction): number {
    if (action.actionType !== 'attack' || action.skillId) return 1;
    const now = Date.now();
    const chain = this.comboChains.get(characterId);
    if (!chain || now - chain.lastAt > 4000) {
      this.comboChains.set(characterId, { count: 1, lastAt: now });
      return 1;
    }
    chain.count++;
    chain.lastAt = now;
    return chain.count % 3 === 0 ? 1.5 : 1;
  }

  private async handleCombatAction(socket: AuthenticatedSocket, action: CombatAction): Promise<void> {
    if (!socket.characterId || !socket.region) return;

    // Защитные действия выполняются без цели
    if (action.actionType === 'dodge' || action.actionType === 'block') {
      await this.handleDefensiveAction(socket, action);
      return;
    }
    if (!action.targetId) return;

    try {
      const attacker = await this.withEquipment(
        await this.characterService.getCharacterById(socket.characterId).then(c => c!)
      ).catch(() => null);
      if (!attacker) return;

      // Частота боевых пакетов
      const rateCheck = this.antiCheat.validatePacketRate(attacker.id);
      if (!rateCheck.valid) {
        await this.punish(socket, 'packet_flood', rateCheck.reason ?? 'packet flood', 2);
        return;
      }

      // Проверка навыка, уровня разблокировки и кулдауна
      const skill = action.skillId
        ? this.combatService.getSkill(attacker.class, action.skillId)
        : undefined;
      if (action.skillId && !skill) {
        socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { message: 'Unknown skill' });
        return;
      }
      if (skill) {
        const unlockLevel = LevelingSystem.getSkillUnlockLevel(attacker.class, skill.id);
        if (attacker.level < unlockLevel) {
          socket.emit(SOCKET_EVENTS.COMBAT_ERROR, {
            message: `Skill unlocks at level ${unlockLevel}`,
            skillId: skill.id,
          });
          return;
        }
        if (!this.checkCooldown(attacker.id, skill.id, skill.cooldown)) {
          socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { message: 'Skill is on cooldown', skillId: skill.id });
          return;
        }
      }

      // Ресурсы: мана/стамина
      if (skill) {
        const ok = await this.characterService.spendResources(attacker.id, skill.manaCost, skill.staminaCost);
        if (!ok) {
          socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { message: 'Not enough mana or stamina', skillId: skill.id });
          return;
        }
      }

      const comboMult = this.comboMultiplier(attacker.id, action);

      // Цель — игрок? (id монстров не UUID — сразу ищем ИИ-контекст)
      if (UUID_RE.test(action.targetId)) {
        const targetRow = await this.characterService.getCharacterById(action.targetId);
        if (targetRow) {
          const target = await this.withEquipment(targetRow);
          await this.combatPlayerVsPlayer(socket, attacker, target, action, comboMult);
          return;
        }
      }

      // Цель — монстр?
      const monsterCtx = GameLoop.getInstance().getSpawnSystem().getAI().getContext(action.targetId);
      if (monsterCtx) {
        await this.combatPlayerVsMonster(socket, attacker, monsterCtx, action, comboMult);
        return;
      }

      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { message: 'Target not found', targetId: action.targetId });
    } catch (error) {
      logger.error('Combat action error:', error);
    }
  }

  /** PvP: расчёт урона/лечения с записью HP в БД, смерть и карма */
  private async combatPlayerVsPlayer(
    socket: AuthenticatedSocket,
    attacker: Character,
    target: Character,
    action: CombatAction,
    comboMult = 1
  ): Promise<void> {
    // Лечащий навык: восстанавливает HP цели (масштаб от интеллекта мистика)
    if (action.skillId && this.combatService.isHealSkill(attacker.class, action.skillId)) {
      const healAmount = Math.round(
        (attacker.stats.intelligence * 2 + attacker.stats.agility) *
        Math.abs(this.combatService.getSkill(attacker.class, action.skillId)!.damageMultiplier)
      );
      const healed = await this.characterService.applyHeal(target.id, healAmount);

      const healPayload = { healerId: attacker.id, targetId: target.id, heal: healAmount, hp: healed.hp, maxHp: healed.maxHp };
      socket.emit(SOCKET_EVENTS.COMBAT_HEAL, healPayload);
      this.activePlayers.get(target.id)?.emit(SOCKET_EVENTS.COMBAT_HEAL, healPayload);
      socket.to(`shard:${socket.shardId}:region:${socket.region}`).emit(SOCKET_EVENTS.COMBAT_VISUAL, {
        attackerId: attacker.id, targetId: target.id, actionType: action.actionType, skillId: action.skillId, position: action.position,
      });
      return;
    }

    // Активная защита цели поглощает/отменяет удар
    const defenseMult = this.defenseStates.getIncomingMultiplier(target.id);
    if (defenseMult === 0) {
      socket.emit(SOCKET_EVENTS.COMBAT_RESULT, {
        attackerId: attacker.id, targetId: target.id, damage: 0, isCritical: false, isBlocked: false, isDodged: true,
      });
      return;
    }

    const result = this.combatService.calculateDamage(attacker, target, action, comboMult);
    // Временный бонус «+5% к урону» (кебаб). Множитель, а не стат:
    // бонус не должен попадать в панель характеристик и не трогать броню.
    const dmgBuff = await this.buffs.getDamageMultiplier(attacker.id);
    result.damage = Math.floor(result.damage * defenseMult * dmgBuff);

    if (result.isDodged) {
      socket.emit(SOCKET_EVENTS.COMBAT_RESULT, { attackerId: attacker.id, targetId: target.id, ...result });
      return;
    }

    // Анти-чит: слишком большой урон
    const damageCheck = this.antiCheat.validateDamage(
      attacker.id, result.damage, this.combatService.getBaseDamageFor(attacker)
    );
    if (!damageCheck.valid) {
      if (this.isStaff(socket)) {
        logger.info(`[AntiCheat] skip damage check for staff (${socket.senderRole})`);
      } else {
        await this.antiCheat.recordViolation(attacker.id, 'damage_hack', damageCheck.reason ?? 'damage hack', 3);
        this.forceDisconnect(attacker.id, 'Анти-чит: damage hack');
        return;
      }
    }

    // Применяем урон к цели (персистентно)
    const applied = await this.characterService.applyDamage(target.id, result.damage);

    socket.emit(SOCKET_EVENTS.COMBAT_RESULT, {
      attackerId: attacker.id, targetId: target.id, ...result, targetHp: applied.hp, targetMaxHp: applied.maxHp,
    });

    const targetSocket = this.activePlayers.get(target.id);
    targetSocket?.emit(SOCKET_EVENTS.COMBAT_HIT, {
      attackerId: attacker.id, ...result, hp: applied.hp, maxHp: applied.maxHp,
    });

    socket.to(`shard:${socket.shardId}:region:${socket.region}`).emit(SOCKET_EVENTS.COMBAT_VISUAL, {
      attackerId: attacker.id, targetId: target.id, actionType: action.actionType, skillId: action.skillId, position: action.position,
    });

    if (applied.died) {
      // Если бой идёт на арене — это нокаут, а не смерть в мире.
      // Иначе проигравший остался бы лежать и не мог бы выйти из города.
      const arena = pvpArena.arenaOf(target.id);
      if (arena && !arena.ended) {
        pvpArena.knockout(target.id);
        announceArenaEnd(arena.matchId, arena.winnerId, 'hp');
        // Здоровье возвращаем: следов боя не остаётся
        await this.characterService
          .restoreHp(target.id)
          .catch((e: unknown) => { logger.debug('restoreHp failed:', e); });
        return;
      }
      await this.handlePlayerDeath(target, attacker);
    }
  }

  /** PvE: урон по монстру через ИИ-контекст, награды при смерти */
  private async combatPlayerVsMonster(
    socket: AuthenticatedSocket,
    attacker: Character,
    monsterCtx: AIContext,
    action: CombatAction,
    comboMult = 1
  ): Promise<void> {
    if (monsterCtx.state === 'dead') return;

    // Лечение монстра недопустимо
    if (action.skillId && this.combatService.isHealSkill(attacker.class, action.skillId)) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { message: 'Cannot heal a monster' });
      return;
    }

    // Монстр принадлежит другому серверу — атаковать нельзя
    if (monsterCtx.shardId !== socket.shardId) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { message: 'Target is on another game server' });
      return;
    }

    // Монстры данжа бьют только участники его сессии
    const dungeonSession = this.dungeons.getSessionByMonster(monsterCtx.instanceId);
    if (dungeonSession && !dungeonSession.members.has(attacker.id)) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { message: 'You are not in this dungeon group' });
      return;
    }

    // Монстр как «виртуальный персонаж» для общей формулы расчёта урона
    const monsterAsCharacter = {
      id: monsterCtx.instanceId,
      userId: '',
      name: monsterCtx.definition.nameRu,
      class: undefined,
      level: monsterCtx.definition.level,
      stats: {
        strength: monsterCtx.definition.strength,
        agility: monsterCtx.definition.agility,
        intelligence: monsterCtx.definition.intelligence,
        endurance: Math.round(monsterCtx.definition.defense / 1.5),
        charisma: 0,
      },
      hp: monsterCtx.currentHp,
      maxHp: monsterCtx.maxHp,
    } as unknown as Character;

    const result = this.combatService.calculateDamage(attacker, monsterAsCharacter, action, comboMult);
    // Тот же бонус «+5% к урону», что и в PvP-ударе
    const dmgBuff = await this.buffs.getDamageMultiplier(attacker.id);
    result.damage = Math.floor(result.damage * dmgBuff);
    if (result.isDodged) {
      socket.emit(SOCKET_EVENTS.COMBAT_RESULT, { attackerId: attacker.id, targetId: monsterCtx.instanceId, ...result });
      return;
    }

    const damageCheck = this.antiCheat.validateDamage(
      attacker.id, result.damage, this.combatService.getBaseDamageFor(attacker)
    );
    if (!damageCheck.valid) {
      if (this.isStaff(socket)) {
        logger.info(`[AntiCheat] skip damage check for staff (${socket.senderRole})`);
      } else {
        await this.antiCheat.recordViolation(attacker.id, 'damage_hack', damageCheck.reason ?? 'damage hack', 3);
        this.forceDisconnect(attacker.id, 'Анти-чит: damage hack');
        return;
      }
    }

    const ai = GameLoop.getInstance().getSpawnSystem().getAI();
    const died = ai.takeDamage(monsterCtx.instanceId, result.damage, attacker.id);

    socket.emit(SOCKET_EVENTS.COMBAT_RESULT, {
      attackerId: attacker.id, targetId: monsterCtx.instanceId, ...result,
      targetHp: Math.max(0, monsterCtx.currentHp),
      targetMaxHp: monsterCtx.maxHp,
      comboFinisher: comboMult > 1,
    });

    socket.to(`shard:${socket.shardId}:region:${socket.region}`).emit(SOCKET_EVENTS.COMBAT_VISUAL, {
      attackerId: attacker.id, targetId: monsterCtx.instanceId, actionType: action.actionType, skillId: action.skillId, position: action.position,
    });

    if (died) {
      // Начисляем награду убийце: опыт, золото и лут из таблицы монстра
      const def = monsterCtx.definition;
      const reward = await this.characterService.addExperience(attacker.id, def.expReward);

      const gold = def.goldReward.min + Math.floor(Math.random() * (def.goldReward.max - def.goldReward.min + 1));
      await this.characterService.addGold(attacker.id, gold).catch(() => {});

      const loot: { itemId: string; nameRu: string; qty: number }[] = [];
      for (const entry of def.lootTable) {
        if (Math.random() >= entry.chance) continue;
        const qty = entry.minQty + Math.floor(Math.random() * (entry.maxQty - entry.minQty + 1));
        await this.characterService.addItems(attacker.id, [{ itemId: entry.itemId, qty }]).catch(() => {});
        loot.push({ itemId: entry.itemId, nameRu: ITEMS_DATABASE[entry.itemId]?.nameRu ?? entry.itemId, qty });
      }

      // Партия: союзники в том же регионе получают 50% опыта
      await this.sharePartyExperience(attacker, def.expReward).catch((e: unknown) => {
        logger.debug('Party XP share failed:', e);
      });

      GameLoop.getInstance().getSpawnSystem().onInstanceDeath(monsterCtx.instanceId);

      // Мировой босс события: объявление победы + награда
      if (this.worldEvents.isActiveBoss(monsterCtx.instanceId)) {
        await this.worldEvents.onBossDefeated(monsterCtx.instanceId, attacker.id).catch((e: unknown) => {
          logger.error('World event reward failed:', e);
        });
      }

      // Данж: прогресс боссов, завершение с наградой
      const dungeonDone = await this.dungeons.onMonsterKilled(monsterCtx.instanceId, attacker.id).catch((e: unknown) => {
        logger.debug('Dungeon progress failed:', e);
        return null;
      });
      if (dungeonDone) {
        socket.emit(SERVER_EVENTS.DUNGEON_COMPLETED, dungeonDone);
        // Задачи дня: «Рейд в Подземелье». Раньше она висела вечно 0/2 —
        // updateProgress не вызывался НИ РАЗУ
        await this.dailyTasks.updateProgress(attacker.id, 'dungeon', 'any').catch((e: unknown) => {
          logger.debug('Daily task (dungeon) failed:', e);
        });
      }

      // Прогресс квестов: kill-цели + завершение смешанных квестов
      const completedQuests = await this.questService.recordKill(attacker.id, def.id).catch((e: unknown) => {
        logger.debug('Quest recordKill failed:', e);
        return [];
      });
      const evaluated = await this.questService.evaluateQuests(attacker.id).catch((e: unknown) => {
        logger.debug('Quest evaluate failed:', e);
        return [];
      });
      const allCompleted = [...completedQuests, ...evaluated.filter(e => !completedQuests.some(c => c.questId === e.questId))];
      if (allCompleted.length) {
        socket.emit(SERVER_EVENTS.QUEST_COMPLETED, { quests: allCompleted });
        // Задачи дня: «Марафон Квестов». За один раз могло закрыться
        // несколько квестов, поэтому прибавляем сразу amount
        await this.dailyTasks
          .updateProgress(attacker.id, 'quest_complete', 'any', allCompleted.length)
          .catch((e: unknown) => {
            logger.debug('Daily task (quest) failed:', e);
          });
      }

      // Задачи дня за убийства. Тип монстра известен точно:
      // 'normal' | 'elite' | 'boss' | 'world_boss'
      for (const [taskType, target] of [
        ['kill', 'any'],
        ['kill_elite', 'elite'],
        ['kill_boss', 'world_boss'],
      ] as const) {
        // Задача «убить элитных» не должна считать обычных, и наоборот
        if (taskType === 'kill_elite' && def.type !== 'elite') continue;
        if (taskType === 'kill_boss' && def.type !== 'world_boss') continue;
        const done = await this.dailyTasks.updateProgress(attacker.id, taskType, target).catch((e: unknown) => {
          logger.debug(`Daily task (${taskType}) failed:`, e);
          return null;
        });
        if (done?.taskCompleted) {
          socket.emit(SERVER_EVENTS.DAILY_TASK_COMPLETED, {
            taskId: done.taskId, gold: done.gold, experience: done.experience, item: done.item,
          });
        }
      }

      await this.redis.publish(REDIS_CHANNELS.REGION_MONSTER_KILLED(attacker.serverId ?? 'isfahan', attacker.region), {
        instanceId: monsterCtx.instanceId,
        monsterId: def.id,
        killerId: attacker.id,
        expReward: def.expReward,
        gold,
        loot,
        leveledUp: reward.leveledUp,
        newLevel: reward.newLevel,
      }).catch(() => {});
    }
  }

  /** Опыт членам партии в том же регионе: 50% от награды за убийство */
  private async sharePartyExperience(attacker: Character, expReward: number): Promise<void> {
    if (expReward <= 0) return;
    const partyId = await this.redis.get(`player:party:${attacker.id}`).catch(() => null);
    if (!partyId) return;

    const party = await this.partySystem.getPartyInfo(partyId).catch(() => null);
    if (!party) return;

    for (const member of party.members) {
      if (member.characterId === attacker.id) continue;
      const memberChar = await this.characterService.getCharacterById(member.characterId).catch(() => null);
      if (!memberChar || memberChar.region !== attacker.region) continue;
      await this.characterService.addExperience(member.characterId, Math.floor(expReward * 0.5)).catch(() => {});
    }
  }

  /** Смерть персонажа по id (например, от удара монстра) */
  private async handleDeathById(characterId: string): Promise<void> {
    const dead = await this.characterService.getCharacterById(characterId);
    if (!dead || dead.hp > 0) return;
    await this.handlePlayerDeath(dead, undefined);
  }

  /** Смерть игрока: респавн на стартовой точке региона + карма убийце */
  private async handlePlayerDeath(dead: Character, killer?: Character): Promise<void> {
    const deadSocket = this.activePlayers.get(dead.id);
    deadSocket?.emit(SOCKET_EVENTS.PLAYER_DIED, { killerId: killer?.id });

    const respawned = await this.characterService.respawn(dead.id);
    // Синк позиции в Redis: клиент телепортируется на стартовую точку,
    // и ИИ должен видеть игрока там же, а не на месте смерти
    await this.redis.setPlayerPosition(dead.id, respawned.position).catch(() => {});
    // Сбросить базовую точку античита на точку респавна — иначе первое
    // движение после возрождения выглядит как телепорт/speed_hack
    this.antiCheat.resetPosition(dead.id, respawned.position);
    deadSocket?.emit(SOCKET_EVENTS.PLAYER_RESPAWNED, {
      hp: respawned.hp,
      maxHp: respawned.maxHp,
      position: respawned.position,
      region: dead.region,
    });

    // Монстры забывают погибшего и возвращаются на спавн — иначе
    // аггро висит вечно и добивает игрока после каждого респавна
    GameLoop.getInstance().getSpawnSystem().getAI().clearThreatAndReturn(dead.id);

    // Карма: в безопасных зонах убийство мирного игрока карается,
    // в PvP-зонах — честная победа
    if (killer && killer.id !== dead.id) {
      const zone = PVP_ZONES[killer.region];
      const eventType = zone?.karmaOnKill ? 'pk_kill' : 'pvp_kill';
      await this.karmaSystem.applyKarmaEvent(killer.id, eventType, killer.region).catch(() => {});
    }

    logger.info(`Player died: ${dead.name}${killer ? ` (killed by ${killer.name})` : ''}`);
  }

  // ============================================================
  // Кулдауны
  // ============================================================
  private checkCooldown(characterId: string, skillId: string, cooldownSec: number): boolean {
    let map = this.skillCooldowns.get(characterId);
    if (!map) {
      map = new Map();
      this.skillCooldowns.set(characterId, map);
    }
    const now = Date.now();
    const readyAt = map.get(skillId) ?? 0;
    if (now < readyAt) return false;
    map.set(skillId, now + cooldownSec * 1000);
    return true;
  }

  // ============================================================
  // Чат (world / region / guild / party)
  // ============================================================
  /**
   * Когда игрок последний раз написал в каждый канал.
   *
   * ТУТ БЫЛА ДЫРА. Задержки CHAT_LIMITS были объявлены, но не применялись
   * нигде: обработчик только резал длину сообщения. Ограничения на частоту
   * не существовало вовсе, и один клиент мог забить мировой чат со скоростью
   * отправки кадров — остальные игроки не могли ничего написать в принципе.
   *
   * Отдельно на канал, а не общий счётчик: иначе переход из региона в мир
   * съедал бы паузу, и игрок решил бы, что игра зависла. И отдельно на
   * персонажа, а не на соединение: у игрока может быть открыто несколько
   * вкладок, и закрытие лишней не должно выглядеть как наказание.
   */
  private chatLastSent = new Map<string, Partial<Record<ChatChannel, number>>>();

  /** Задержка для канала. Гильдейский и групповой идут по общей ветке. */
  private chatCooldownFor(channel: ChatChannel): number {
    if (channel === 'world') return CHAT_LIMITS.WORLD_CHAT_COOLDOWN_MS;
    if (channel === 'region') return CHAT_LIMITS.REGION_CHAT_COOLDOWN_MS;
    return CHAT_LIMITS.GUILD_CHAT_COOLDOWN_MS;
  }

  private handleChatMessage(
    socket: AuthenticatedSocket,
    data: { message: string; channel: ChatChannel }
  ): void {
    if (!socket.characterId || !socket.region) return;

    const sanitized = data.message.slice(0, CHAT_LIMITS.MAX_MESSAGE_LENGTH).trim();
    if (!sanitized) return;

    // Проверка задержки. Молча проглатывать нельзя: игрок решил бы, что его
    // сообщения не доходят, и просто перестал бы писать. Поэтому при отказе
    // отправляем chat:error с временем ожидания — клиент умеет это показывать
    const cooldown = this.chatCooldownFor(data.channel);
    if (cooldown > 0) {
      const now = Date.now();
      const marks = this.chatLastSent.get(socket.characterId) ?? {};
      const lastAt = marks[data.channel] ?? 0;
      const waitMs = lastAt + cooldown - now;
      if (waitMs > 0) {
        // Код, а не готовый текст: перевод живёт на клиенте, иначе игрок
        // увидел бы служебное слово. Клиент сам подставит время ожидания
        socket.emit('chat:error', { code: 'CHAT_COOLDOWN', waitMs });
        return;
      }
      marks[data.channel] = now;
      this.chatLastSent.set(socket.characterId, marks);
    }

    const payload = {
      characterId: socket.characterId,
      name: socket.senderName ?? null,
      role: socket.senderRole ?? null,
      message: sanitized,
      timestamp: Date.now(),
    };

    switch (data.channel) {
      case 'world':
        this.io.to(`shard:${socket.shardId}`).emit(SOCKET_EVENTS.CHAT_WORLD, payload);
        break;
      case 'region':
        this.io.to(`shard:${socket.shardId}:region:${socket.region}`).emit(SOCKET_EVENTS.CHAT_REGION, payload);
        break;
      case 'guild': {
        const guildRoom = Array.from(socket.rooms).find(r => r.startsWith('guild:'));
        if (guildRoom) {
          this.io.to(guildRoom).emit(SOCKET_EVENTS.CHAT_GUILD, payload);
        } else {
          socket.emit('chat:error', { message: 'You are not in a guild' });
        }
        break;
      }
      case 'party':
        this.broadcastPartyChat(socket, payload).catch(() => {});
        break;
      default:
        socket.emit(SOCKET_EVENTS.CHAT_REGION, payload);
    }
  }

  /**
   * Вход/выход из зданий. Сервер сам вычисляет обе точки телепорта:
   * свежая позиция берётся из Redis (пакеты движения идут каждые ~100мс),
   * запасной вариант — персистнутая позиция из БД.
   * Легитимный телепорт сбрасывает античит-трекинг (как travel/respawn),
   * итог возвращается через ack — клиент двигается только после него.
   */
  private async handleInterior(
    socket: AuthenticatedSocket,
    buildingId: string,
    kind: 'enter' | 'exit',
    ack?: (res: { ok: boolean; target?: { x: number; y: number; z: number }; reason?: string }) => void,
  ): Promise<void> {
    const fail = (reason: string): void => {
      socket.emit(SOCKET_EVENTS.MOVE_REJECTED, { reason });
      ack?.({ ok: false, reason });
    };
    if (!socket.characterId) {
      fail('Not authenticated');
      return;
    }
    const def = getInterior(String(buildingId ?? ''));
    if (!def) {
      fail('Unknown building');
      return;
    }

    let px: number | null = null;
    let pz: number | null = null;
    const live = await this.redis.getPlayerPosition(socket.characterId).catch(() => null) as {
      x?: unknown; z?: unknown;
    } | null;
    if (typeof live?.x === 'number' && Number.isFinite(live.x) && typeof live?.z === 'number' && Number.isFinite(live.z)) {
      px = live.x;
      pz = live.z;
    } else {
      const character = await this.characterService.getCharacterById(socket.characterId).catch(() => null);
      if (!character?.position) {
        fail('Character not found');
        return;
      }
      px = character.position.x;
      pz = character.position.z;
    }

    let target: { x: number; y: number; z: number };
    if (kind === 'enter') {
      if (!canEnter(def, px, pz)) {
        fail('Too far from the door');
        return;
      }
      target = { x: def.spawnX, y: 0.4, z: def.spawnZ };
    } else {
      if (!isInsideRoom(def, px, pz)) {
        fail('Not inside');
        return;
      }
      target = { x: def.exitX, y: 0.4, z: def.exitZ };
    }

    await this.characterService.updatePosition(socket.characterId, target).catch(() => {});
    await this.redis.setPlayerPosition(socket.characterId, target).catch(() => {});
    this.antiCheat.resetPosition(socket.characterId, target);
    logger.info(`[Interior] ${kind} ${def.id} by ${socket.characterId}`);
    ack?.({ ok: true, target });
  }

  private async broadcastPartyChat(    socket: AuthenticatedSocket,
    payload: { characterId: string; message: string; timestamp: number }
  ): Promise<void> {
    const partyId = await this.redis.get(`player:party:${socket.characterId}`).catch(() => null);
    if (!partyId) {
      socket.emit('chat:error', { message: 'You are not in a party' });
      return;
    }
    this.io.to(`party:${partyId}`).emit(SOCKET_EVENTS.CHAT_PARTY, payload);
  }

  // ============================================================
  // Санкции и отключение
  // ============================================================
  /** Разработчик и администрация вне античита: только лог, без санкций */
  private isStaff(socket: AuthenticatedSocket): boolean {
    return socket.senderRole === 'owner'
      || socket.senderRole === 'admin'
      || socket.senderRole === 'moderator';
  }

  private async punish(
    socket: AuthenticatedSocket,
    type: 'speed_hack' | 'packet_flood' | 'teleport',
    details: string,
    severity: 1 | 2 | 3
  ): Promise<void> {
    if (!socket.characterId) return;
    if (this.isStaff(socket)) {
      logger.info(`[AntiCheat] skip for staff (${socket.senderRole}): ${type} | ${details}`);
      return;
    }
    try {
      const result = await this.antiCheat.recordViolation(socket.characterId, type, details, severity);
      if (result.action === 'kick' || result.action === 'ban') {
        this.forceDisconnect(socket.characterId, `Анти-чит: ${details}`);
      }
    } catch (error) {
      logger.error('AntiCheat punish error:', error);
    }
  }

  private forceDisconnect(characterId: string, reason: string): void {
    const socket = this.activePlayers.get(characterId);
    if (!socket) return;
    socket.emit(SERVER_EVENTS.FORCE_DISCONNECT, { reason });
    socket.disconnect(true);
    this.activePlayers.delete(characterId);
  }

  private async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    if (!socket.characterId || !socket.region) return;

    this.activePlayers.delete(socket.characterId);
    this.skillCooldowns.delete(socket.characterId);
    this.lastPositionPersist.delete(socket.characterId);
    this.lastQuestEval.delete(socket.characterId);
    this.comboChains.delete(socket.characterId);
    // Задержки чата тоже: иначе карта росла бы на каждого зашедшего игрока
    // и держала в памяти его id до перезапуска сервера
    this.chatLastSent.delete(socket.characterId);
    this.defenseStates.cleanup(socket.characterId);
    this.antiCheat.cleanup(socket.characterId);
    const shardId = socket.shardId ?? 'isfahan';
    await this.redis.removePlayerFromRegion(shardId, socket.region, socket.characterId).catch(() => {});
    // Шард опустел — выгрузить его монстров
    const online = await this.redis.getShardOnline(shardId).catch(() => 1);
    if (online === 0) {
      GameLoop.getInstance().getSpawnSystem().deactivateShard(shardId);
    }

    // Вышедший игрок пропадает из поля зрения монстров навсегда
    GameLoop.getInstance().getSpawnSystem().getAI().clearThreatAndReturn(socket.characterId);

    socket.to(`shard:${socket.shardId}:region:${socket.region}`).emit(SOCKET_EVENTS.PLAYER_LEFT, {
      characterId: socket.characterId,
    });

    logger.info(`Player disconnected: ${socket.characterId}`);
  }
}
