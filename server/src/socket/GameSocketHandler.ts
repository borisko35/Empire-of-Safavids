import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../utils/logger';
import { RedisService } from '../services/RedisService';
import { DatabaseService } from '../services/DatabaseService';
import { CharacterService } from '../services/CharacterService';
// Навыки гильдии: бонус к золоту с монстра считается здесь, на месте
// выпадения, потому что золото начисляется в трёх разных системах - боёв,
// подземелиях и рыбалке, - и каждая считает своё.
import { GuildService } from '../services/GuildService';
import { LeaderboardService } from '../services/LeaderboardService';
import { AchievementService } from '../services/AchievementService';
import { DebuffService } from '../services/DebuffService';
import { CombatService } from '../services/CombatService';
import { EquipmentCache, DEFAULT_WEAPON, type WeaponProfile } from '../services/EquipmentCache';
import { getBuffService } from '../services/BuffService';
import { AntiCheatSystem } from '../systems/AntiCheatSystem';
import { KarmaSystem, PVP_ZONES, karmaDeathDrop } from '../systems/KarmaSystem';
import { QuestService } from '../services/QuestService';
import { DailyTaskService } from '../services/DailyTaskService';
import { PvPService } from '../services/PvPService';
import { FACTION_NAMES_RU } from '../services/ReputationService';
import { grantReputation } from '../systems/ReputationGrants';
import { MountSystem } from '../systems/MountSystem';
import { MOUNT_ANTICHEAT_CAP_FLOOR } from '../systems/AntiCheatSystem';
import { pvpArena } from '../systems/PvpArenaService';
import { initPvpArena, announceArenaEnd } from '../systems/PvpArenaFlow';
import { GameLoop } from '../systems/GameLoop';
import { AIContext } from '../systems/AISystem';
import { DefenseStates } from '../systems/DefenseStates';
import { StealthStates } from '../systems/StealthStates';
import { skillsService } from '../services/SkillsService';
import { professionBonuses } from '../systems/ProfessionBonuses';
import { professionOf } from '../services/ProfessionService';
import { STANCES, isCombatStance, type CombatStance } from '../systems/CombatStance';
import { DungeonService } from '../systems/DungeonService';
import { WorldEventSystem } from '../systems/WorldEventSystem';
import { SiegeSystem } from '../systems/SiegeSystem';
import { TerritoryBonuses } from '../systems/TerritoryBonuses';
import { PartySystem } from '../systems/PartySystem';
import { ShardLease } from '../systems/ShardLease';
import { LevelingSystem } from '../systems/LevelingSystem';
import { ChatModerationService } from '../services/ChatModerationService';
import { analytics } from '../services/AnalyticsService';
import { combatLog, buildCombatLogEntry } from '../services/CombatLogService';
import { Character, CombatAction, Region } from '../types/game.types';
import type { AISystem } from '../systems/AISystem';
import { ITEMS_DATABASE } from '../data/items';
import { getInterior, canEnter, isInsideRoom, INTERIORS } from '../data/interiors';
import {
  SOCKET_EVENTS, SERVER_EVENTS, REDIS_CHANNELS, CHAT_LIMITS, GAME_SERVERS, getRegionSpawn,
  DEATH, RESPAWN_TYPES, RESPAWN_REJECT, spotRespawnCost, type RespawnType, STAMINA,
} from '../../../shared/constants';
// Шаг 1 стелса: правило обнаружения живёт в shared/, чтобы клиент считал
// то же самое. Расхождение двух копий уже стоило бага с дверями.
import {
  spottedBy, GUARD_POSTS, nightFactor,
  canPickpocket, distanceSq, PICKPOCKET_TARGETS, THEFT_REACH, THEFT_GOLD,
  fortEntrance, checkEntrance,
  canTakeDocument, DOCUMENT_ITEM_ID, DOCUMENT_SPOTS, DOCUMENT_REACH,
} from '../../../shared/stealth';
// Погода берётся из того же источника, что и время суток, которое сервер и
// так рассылает игрокам (WORLD_TIME), - чтобы клиент и правило считали одно
// и то же. WEATHER_EFFECTS - справочник модификаторов, из него берётся
// visibilityMod.
import { WEATHER_EFFECTS } from '../systems/WorldTimeSystem';
import { isDeepWater } from '../utils/spawn';
import { guildMissionService } from '../services/GuildMissionService';

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
  /** Кэш текущей зоны персонажа (для проверки смены зоны при движении) */
  zoneCache?: Map<string, string | null>;
}

type ChatChannel = 'world' | 'region' | 'guild' | 'party';

/** Состояние смерти: точка, где умер, и страховочный таймер сервера */
interface DeadState {
  /** Где именно погиб (живая позиция из Redis, в БД она отстаёт до 5 сек) */
  position: { x: number; y: number; z: number };
  /** Страховочный таймер автореспавна; см. armAutoRespawn */
  timer?: ReturnType<typeof setTimeout>;
  /**
   * Респавн уже выполняется. Два запроса подряд (клик по кнопке плюс
   * таймер, или просто два пакета от читера) проходят проверку
   * «игрок мёртв» почти одновременно, и без этого флага оплаченный
   * респавн на месте списывал бы 5% золота дважды.
   */
  busy: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Минимальный интервал между обычными ударами, сек*1000.
 *
 * Откат держался только на клиенте (0.45 с), а сервер проверял лишь частоту
 * пакетов (30/с). То есть правкой клиента можно было бить по 30 раз в
 * секунду. Здесь 380 мс: чуть меньше клиентских 450, чтобы у честного игрока
 * с дрожащим соединением удар не отбрасывался, но и поток ударов не проходил.
 */
/** Стамина за рывок. Вынесена константой: её читает и щит, и рывок, и она
 * должна быть одна на оба, иначе щит и рывок разойдутся по цене. */
const DODGE_STAMINA_COST = 15;

// Страховка от испорченных данных оружия, а не игровое ограничение:
// с настоящими данными самый быстрый замах — это 0.36 с у оружия, умноженные
// на 0.8 у «Шахского щита», то есть 288 мс. Раньше здесь стояло жёсткое 380,
// и оно срезало всё, что предмет обещал.
const MIN_ATTACK_INTERVAL_MS = 150;

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
  /**
   * Достижения проверяются из боя, а не из панели: панель может и не быть
   * открыта, а десятое парирование происходит в бою. Отдельный экземпляр,
   * не синглтон из маршрутов, потому что у сервиса своё подключение к базе.
   */
  private achievements = new AchievementService();
  /**
   * Эффекты монстров. Нужны в бою: оглушение закрывает удары, замедление
   * тянет откат. Отдельный экземпляр по той же причине, что у достижений: у
   * сервиса своё подключение к базе.
   */
  private debuffs = new DebuffService();
  private combatService = new CombatService();
  private antiCheat = new AntiCheatSystem();
  /**
   * id поста стража, который заметил игрока; null - не заметил.
   *
   * Нужен не для самого обнаружения (оно считается из позиции), а чтобы
   * не слать событие на каждом пакете движения: пакеты идут десятками в
   * секунду. Ключ - characterId, значение - id поста, а не флаг: один игрок
   * может выйти из-под одного стража и тут же попасть в поле зрения другого,
   * и это смена состояния, о которой клиент должен узнать.
   */
  private spottedGuards = new Map<string, string | null>();

  /**
   * Где игрок и присел ли он сейчас.
   *
   * Нужно шагу 3 (кража кошелька): попытка приходит отдельным событием и не
   * приносит позицию - иначе игрок сказал бы серверу «я в 4 единицах от
   * торговца», находясь в порту. Позиция и приседание берутся из уже проверенного
   * античитом пакета движения, а не из нового недоверенного поля.
   *
   * Теперь это общий StealthStates, а не приватная карта: приседание нужно ещё
   * и тику стражи в GameLoop, а удар стража должен приходить по времени, а не по
   * пакетам движения - у стоящего игрока их нет.
   */
  private stealthStates = StealthStates.getInstance();
  private karmaSystem = new KarmaSystem();
  private questService = new QuestService();
  private equipment = EquipmentCache.getInstance();
  private buffs = getBuffService();
  private defenseStates = DefenseStates.getInstance();
  private dungeons = DungeonService.getInstance();
  private worldEvents = WorldEventSystem.getInstance();
  private dailyTasks = new DailyTaskService();
  private partySystem = new PartySystem();
  /** Аренда шардов: чей спавн и чей бой. Один экземпляр на процесс. */
  private аренда = new ShardLease();
  private mounts = new MountSystem();
  private chatModeration = ChatModerationService.getInstance();

  // Активные игроки: characterId -> сокет
  private activePlayers = new Map<string, AuthenticatedSocket>();
  /**
   * Мёртвые игроки: characterId -> состояние смерти.
   * Пока запись есть, персонаж не может двигаться, бить и получать урон,
   * а респавн происходит только по решению игрока или по таймеру.
   */
  private deadPlayers = new Map<string, DeadState>();
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
  /**
   * Порог достижения «Мастер Комбо».
   *
   * Объявлен один раз и используется и в записи, и в условии достижения.
   * Раньше порог был написан только в описании достижения («комбо из 5
   * ударов»), а кода, который его проверял, не существовало. Две цифры в
   * двух местах - это ровно то, из-за чего описание перестаёт совпадать с
   * выдачей.
   */
  static readonly COMBO_THRESHOLD = 5;

  private comboChains = new Map<string, { count: number; lastAt: number }>();
  // Время последнего принятого обычного удара: characterId -> epoch ms.
  // Откат держал только клиент, поэтому правкой клиента можно было слать
  // по 30 ударов в секунду - лимит пакетов (30/с) это пропускал.
  private lastAttackAt = new Map<string, number>();
  /**
   * Позиция игрока на прошлом тике регенерации и время: по ним считается,
   * бежал ли он, чтобы выносливость за бег нельзя было получить бесплатно.
   */
  private lastRegenPos = new Map<string, { x: number; z: number; at: number }>();
  // Скакун: characterId -> { mountId, speed } — последняя известная серверу
  // скорость. Кэш, а не источник истины: истина в character_mounts, но
  // античит спрашивает скорость на каждом пакете движения (десятки в
  // секунду), а ходить в базу так часто нельзя
  private mountSpeeds = new Map<string, { mountId: string; speed: number }>();
  // Откуда отсчитывать путь для опыта скакуна: characterId -> позиция
  private mountExpAt = new Map<string, { x: number; z: number }>();
  // Игроки, вошедшие в игру внутри здания: им прощается первый пакет
  // движения. Одноразовая отсрочка, снимается при первом же движении
  private insideSpawnGrace = new Set<string>();

  /** Широковещательное объявление мирового события — только шарду события */
  broadcastWorldEvent(payload: Record<string, unknown>): void {
    const room = payload.shardId ? `shard:${String(payload.shardId)}` : undefined;
    if (room) this.io.to(room).emit(SERVER_EVENTS.WORLD_EVENT, payload);
    else this.io.emit(SERVER_EVENTS.WORLD_EVENT, payload);
  }

  /**
   * Сколько игроков сейчас в игре.
   *
   * Единственный способ узнать это снаружи: карта подключённых сокетов
   * приватная, а владельцу это число нужно постоянно - ради него и
   * затевался мониторинг. Считается в момент обращения к /metrics, а не
   * на каждом входе и выходе: счётчик, который надо поддерживать вручную,
   * разъезжается при первом же переподключении сокета.
   */
  getOnlineCount(): number {
    return this.activePlayers.size;
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

    // Живая доставка уведомлений.
    //
    // ЧТО БЫЛО. NotificationService писал строку в таблицу notifications и
    // публиковал в Redis-канал player:notification. На этот канал НИКТО не
    // подписывался: комментарий в сервисе обещал, что «GameSocketHandler
    // пересылает конкретному сокету», но подписки не было. Уведомления до
    // игрока не доходили вовсе — ни тостом, ни чем-либо.
    void this.redis.subscribe('player:notification', (message) => {
      const characterId = String(message.characterId ?? '');
      if (!characterId) return;
      this.activePlayers.get(characterId)?.emit(SERVER_EVENTS.NOTIFICATION, {
        type: message.type,
        titleRu: message.titleRu,
        bodyRu: message.bodyRu,
        data: message.data,
      });
    }).catch((e) => logger.error('[Notification] subscribe failed:', e));
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

      // Смена боевой стойки
      socket.on(SOCKET_EVENTS.COMBAT_STANCE, async (data: { stance?: string }) => {
        await this.handleStanceChange(socket, data);
      });

      // Включение активного навыка профессии (Зикр, Тадж)
      socket.on(SOCKET_EVENTS.SKILL_ACTIVATE, async (data: { skillId?: string }) => {
        await this.handleSkillActivate(socket, data);
      });

      // Решение после смерти: возродиться в городе или на месте.
      // Раньше сервер воскрешал мгновенно и такого события не слушал —
      // клиентский deathScreen отправлял 'respawn' в пустоту.
      socket.on(SOCKET_EVENTS.RESPAWN, async (data: { type?: string }) => {
        await this.handleRespawn(socket, data);
      });

      // Чат
      socket.on(SOCKET_EVENTS.CHAT_MESSAGE, (data: { message: string; channel: ChatChannel }) => {
        // Обработчик асинхронный (проверка мьюта ходит в базу/Redis), поэтому
        // ошибку глушим здесь: необработанный reject в обработчике сокета
        // роняет соединение игрока
        this.handleChatMessage(socket, data).catch(() => {});
      });

      // Интерьеры: вход/выход из зданий (с серверной проверкой координат).
      // Клиент телепортируется ТОЛЬКО по ack — иначе первый же пакет
      // движения из кармана прилетает раньше сброса трекинга и даёт кик.
      socket.on(SOCKET_EVENTS.INTERIOR_ENTER, async (
        data: { buildingId: string; entrance?: string },
        ack?: (res: { ok: boolean; target?: { x: number; y: number; z: number }; reason?: string; deny?: string }) => void,
      ) => {
        // ВХОД. Поле entrance необязательное: старый клиент его не шлёт,
        // и для него остаётся обычный вход через ворота.
        await this.handleInteriorEnter(socket, data?.buildingId, data?.entrance, ack);
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

      // Шаг 3 стелса: попытка кражи кошелька.
      socket.on(SOCKET_EVENTS.STEAL_ATTEMPT, () => {
        void this.handleSteal(socket).catch(() => {});
      });
      // Шаг 3 стелса, часть вторая: тайные документы со стола смотровой.
      socket.on(SOCKET_EVENTS.DOCUMENT_ATTEMPT, () => {
        void this.handleDocument(socket).catch(() => {});
      });
    });

    // Регенерация ресурсов онлайн-игроков раз в 5 секунд (+ синк клиенту)
    void setInterval(() => { this.regenTick().catch(() => {}); }, 5000);
  }

  /**
   * Попытка кражи кошелька.
   *
   * Правило целиком в shared/stealth.ts (canPickpocket), потому что клиент
   * должен понимать то же самое: иначе игрок присел бы за спиной торговца,
   * увидел бы отказ и не смог бы объяснить почему.
   *
   * ПОЧЕМУ КООРДИНАТЫ БЕРУТСЯ ИЗ КЕША, А НЕ ИЗ СОБЫТИЯ. Событие кражи не
   * приносит позицию: иначе игрок прислал бы «я в 4 единицах от торговца»,
   * находясь в порту. Точка берётся из stealthState, который наполняется
   * пакетом движения, уже проверенным античитом на превышение скорости.
   */
  /**
   * Попытка забрать тайные документы со стола смотровой.
   *
   * Повторяет структуру handleSteal, потому что задача та же самая: действие
   * без предмета в руке, координаты из проверенного кеша, отказ с причиной.
   * Разница одна: награда не золото, а предмет в инвентарь.
   */
  private async handleDocument(socket: AuthenticatedSocket): Promise<void> {
    const characterId = socket.characterId;
    if (!characterId) return;

    // Без пакета движения сервер не знает, где игрок. Молча не выходим:
    // игрок должен понимать, почему попытка не сработала.
    const где = this.stealthStates.get(characterId);
    if (!где) {
      socket.emit(SOCKET_EVENTS.DOCUMENT_RESULT, { ok: false, reason: 'unknown' });
      return;
    }

    const игрок = { x: где.x, z: где.z };

    // Ближайший стол в пределах вытянутой руки. Проверяем расстояние ДО
    // правила, чтобы отличить «далеко» от «не присел»: игроку это разные
    // ошибки, и он должен знать, какую исправлять.
    let стол: (typeof DOCUMENT_SPOTS)[number] | null = null;
    for (const s of DOCUMENT_SPOTS) {
      if (distanceSq(игрок, s) <= DOCUMENT_REACH * DOCUMENT_REACH) {
        стол = s;
        break;
      }
    }

    if (!стол) {
      socket.emit(SOCKET_EVENTS.DOCUMENT_RESULT, { ok: false, reason: 'far' });
      return;
    }

    // «Уже брал» - это инвентарь, а не новая колонка. Считаем один раз:
    // метод hodit v bazu.
    const количества = await this.characterService
      .getItemQuantities(characterId)
      .catch(() => ({}) as Record<string, number>);
    const ужеЕсть = (количества[DOCUMENT_ITEM_ID] ?? 0) > 0;

    const отказ = canTakeDocument(игрок, стол, {
      crouch: где.crouch,
      spotted: this.spottedGuards.get(characterId) != null,
      alreadyHas: ужеЕсть,
    });
    if (отказ) {
      socket.emit(SOCKET_EVENTS.DOCUMENT_RESULT, {
        ok: false,
        reason: отказ,
        spotId: стол.id,
        nameRu: стол.nameRu,
      });
      return;
    }

    // Predmet poivaetsya cherez addItems - on zhe edinyy metod dobchi, kotoryy
    // soobshchayet o predmetah zadaniyam i ne obhodit ih storony.
    await this.characterService.addItems(characterId, [{ itemId: DOCUMENT_ITEM_ID, qty: 1 }]);

    socket.emit(SOCKET_EVENTS.DOCUMENT_RESULT, {
      ok: true,
      itemId: DOCUMENT_ITEM_ID,
      spotId: стол.id,
      nameRu: стол.nameRu,
    });
  }
  private async handleSteal(socket: AuthenticatedSocket): Promise<void> {
    const characterId = socket.characterId;
    if (!characterId) return;

    // Без пакета движения сервер не знает, где игрок. Молча не выходим:
    // клиент должен понимать, почему попытка не сработала.
    const где = this.stealthStates.get(characterId);
    if (!где) {
      socket.emit(SOCKET_EVENTS.STEAL_RESULT, { ok: false, reason: 'unknown' });
      return;
    }

    const время = GameLoop.getInstance().getWorldTime();
    const ctx = {
      crouch: где.crouch,
      night: nightFactor(время.timeOfDay),
      visibility: WEATHER_EFFECTS[время.weather]?.visibilityMod ?? 1,
    };
    const вор = { x: где.x, z: где.z };

    // Цель - ближайшая, до которой можно дотянуться руками. Проверяем
    // расстояние ДО правила, чтобы отличить «далеко» от «заметили»: игроку
    // это разные ошибки, и он должен знать, какую исправлять.
    let цель: (typeof PICKPOCKET_TARGETS)[number] | null = null;
    for (const t of PICKPOCKET_TARGETS) {
      if (distanceSq(вор, t) <= THEFT_REACH * THEFT_REACH) {
        цель = t;
        break;
      }
    }

    if (!цель) {
      socket.emit(SOCKET_EVENTS.STEAL_RESULT, { ok: false, reason: 'far' });
      return;
    }

    // Дотянулись, но не вышло: либо заметили, либо не присел.
    if (!canPickpocket(вор, цель, ctx)) {
      socket.emit(SOCKET_EVENTS.STEAL_RESULT, {
        ok: false,
        reason: где.crouch ? 'seen' : 'too_loud',
        targetId: цель.id,
        nameRu: цель.nameRu,
      });
      return;
    }

    // Именно addGoldReward, а не addGold. В этом файле прямая награда запрещена:
    // addGold не учитывает сезонный множитель, и игрок, крадущий кошелёк в
    // сезон ивента, получил бы меньше, чем за любую другую награду. Правило
    // держит проверка «все источники золотой награды переведены на новый
    // метод», и первая версия шага 3 её на себе и упала.
    const всего = await this.characterService.addGoldReward(characterId, THEFT_GOLD);
    socket.emit(SOCKET_EVENTS.STEAL_RESULT, {
      ok: true,
      gold: THEFT_GOLD,
      total: всего,
      targetId: цель.id,
      nameRu: цель.nameRu,
    });
    socket.emit(SERVER_EVENTS.RESOURCES, { gold: всего });
  }

  /**
   * Бежал ли игрок между прошлым и этим тиком регенерации.
   *
   * Сравнивается средняя скорость, а не отдельный шаг: окно пять секунд, шагов
   * за него десятки, и одна покачивающаяся пара соседних точек ничего бы не
   * сказала. Порог стоит между ходьбой и бегом (STAMINA.SPRINT_SPEED_MIN),
   * поэтому обычный шаг бегом не считается, а езда верхом обрабатывается
   * отдельно и пока не тратит выносливость.
   *
   * Первый тик после входа ответа не даёт: сравнивать не с чем, и платить за
   * бег, которого ещё не было, нечестно.
   */
  private бежалЗаОкно(
    characterId: string,
    pos: { x: number; z: number } | null,
    inWater: boolean
  ): boolean {
    if (!pos || inWater) {
      this.lastRegenPos.delete(characterId);
      return false;
    }
    const теперь = Date.now();
    const прошлая = this.lastRegenPos.get(characterId);
    this.lastRegenPos.set(characterId, { x: pos.x, z: pos.z, at: теперь });
    if (!прошлая) return false;
    const секунды = (теперь - прошлая.at) / 1000;
    if (секунды <= 0) return false;
    const расстояние = Math.hypot(pos.x - прошлая.x, pos.z - прошлая.z);
    return расстояние / секунды > STAMINA.SPRINT_SPEED_MIN;
  }

  /** Медленная регенерация hp/маны/стамины онлайн-игроков + синк состояния */
  private async regenTick(): Promise<void> {
    for (const socket of this.activePlayers.values()) {
      if (!socket.characterId) continue;
      // Мёртвым регенерация не идёт. Иначе hp > 0 появлялся бы у трупа
      // уже через 5 секунд после смерти: игрок мог выйти, перезайти и
      // оказаться живым бесплатно, а «респавн на месте за золото» терял
      // смысл — деньги можно было не платить, просто переподключившись.
      if (this.deadPlayers.has(socket.characterId)) continue;
      try {
        // Вода определяется по последней известной серверу позиции —
        // клиенту нельзя просто сказать «я в воде», чтобы не тратить стамину
        const pos = await this.redis.getPlayerPosition(socket.characterId).catch(() => null) as
          { x: number; z: number } | null;
        const inWater = !!pos && isDeepWater(pos.x, pos.z);
        // Бежал ли игрок в это окно: скорость между прошлым тиком и этим.
        const бежал = this.бежалЗаОкно(socket.characterId, pos, inWater);
        const res = await this.characterService.regenResources(socket.characterId, inWater, бежал);
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
          // Время в игре. Тик регенерации идёт ровно раз в 5 секунд по
          // каждому онлайн-игроку, так что счётчик копится без погрешности.
          //
          // Через increment, а не updateStats: там col = col + n. В updateStats
          // было бы col = n, и пятью секундами позже тик затирал бы всё
          // накопленное нулём — именно поэтому счётчики и не пускали в
          // updateStats (deadCodeFindings.test.ts). Запрет был по сути
          // прав, но указывал на разделение методов, а не на отказ от счётчиков.
          await this.leaderboardService.increment(socket.characterId, { playtimeSeconds: 5 })
            .catch((error) => logger.debug('Leaderboard playtime skipped:', error));
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
              // Удар стража. Без этих трёх полей клиент показал бы только
              // число урона: игрок не понял бы, кто ударил и почему у него
              // уехала карма. Само событие приходит тем же каналом, что и
              // удар монстра - отдельный канал ради одного поля заставил бы
              // подписываться на вторую ветку в двух местах.
              guardStrike: Boolean(msg.guardStrike),
              guardName: msg.guardName ? String(msg.guardName) : '',
              karmaDelta: Number(msg.karmaDelta ?? 0),
            });
          }
          this.io.to(room).emit(SOCKET_EVENTS.COMBAT_VISUAL, {
            attackerId: String(msg.instanceId),
            targetId: String(msg.characterId),
            actionType: 'attack',
          });
          if (msg.died) this.handleDeathById(String(msg.characterId)).catch(() => {});
        });
        // Урон со временем и остаток эффектов. Персональный пакет: игроку
        // нужны его собственные иконки и его собственное здоровье, а
        // соседям по региону - ничего. В комнату региона это не шлём.
        await this.redis.subscribe(REDIS_CHANNELS.REGION_DEBUFF_TICK(shardId, region), (msg: Record<string, unknown>) => {
          const socket = this.activePlayers.get(String(msg.characterId));
          if (!socket) return;
          socket.emit(SOCKET_EVENTS.DEBUFF_TICK, {
            damage: Number(msg.damage ?? 0),
            hp: Number(msg.hp ?? 0),
            maxHp: Number(msg.maxHp ?? 0),
            debuffs: (Array.isArray(msg.debuffs) ? msg.debuffs : []) as unknown[],
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

    // ── Партия ──────────────────────────────────────────────────
    // Состав партии меняется, и участник должен узнать об этом сразу,
    // а не после того, как сам откроет панель. Сообщение несёт список
    // characterId, поэтому рассылаем по сокетам участников.
    const переслатьУчастникам = async (
      канал: string,
      событие: string,
      поле: (msg: Record<string, unknown>) => string[],
    ) => {
      await this.redis.subscribe(канал, (msg: Record<string, unknown>) => {
        const участники = поле(msg);
        if (участники.length === 0) {
          logger.warn(`[Socket] ${канал}: событие без участников, пересылать некому`, msg);
          return;
        }
        for (const characterId of участники) {
          this.activePlayers.get(characterId)?.emit(событие, msg);
        }
      });
    };
    // party:updated несёт состав, остальные события - нет. Для них берём
    // состав из Redis: без него участник, который вышел, не узнает,
    // что вышел, а оставшиеся - что он ушёл.
    const составПартии = async (partyId: string): Promise<string[]> => {
      const сырое = await this.redis.get(`party:${partyId}`).catch(() => null);
      if (!сырое) return [];
      try {
        const party = JSON.parse(сырое) as { members?: { characterId?: string }[] };
        return (party.members ?? []).map((m) => String(m.characterId)).filter(Boolean);
      } catch (e) {
        logger.warn('[Socket] состав партии не разобран:', e);
        return [];
      }
    };
    await переслатьУчастникам(REDIS_CHANNELS.PARTY_UPDATED, SOCKET_EVENTS.PARTY_UPDATED,
      (msg) => (Array.isArray(msg.members) ? (msg.members as { characterId: string }[]).map((m) => String(m.characterId)) : []));
    for (const [канал, событие] of [
      [REDIS_CHANNELS.PARTY_MEMBER_JOINED, SOCKET_EVENTS.PARTY_MEMBER_JOINED],
      [REDIS_CHANNELS.PARTY_MEMBER_LEFT, SOCKET_EVENTS.PARTY_MEMBER_LEFT],
    ] as const) {
      await this.redis.subscribe(канал, (msg: Record<string, unknown>) => {
        void составПартии(String(msg.partyId)).then((состав) => {
          for (const characterId of состав) {
            this.activePlayers.get(characterId)?.emit(событие, msg);
          }
        });
      });
    }
    // Расформирование: партия уже удалена из Redis, поэтому состав
    // взять неоткуда - но его присылает сам PartyService? Нет: удалено
    // раньше публикации. Значит состав нужно было сохранить ДО delete.
    await this.redis.subscribe(REDIS_CHANNELS.PARTY_DISBANDED, (msg: Record<string, unknown>) => {
      const участники = Array.isArray(msg.members) ? (msg.members as { characterId: string }[]).map((m) => String(m.characterId)) : [];
      for (const characterId of участники) {
        this.activePlayers.get(characterId)?.emit(SOCKET_EVENTS.PARTY_DISBANDED, msg);
      }
    });

    // Смена скакуна подписывается при аутентификации: канал персональный
    // (в имени есть id персонажа), и на старте сервера ещё неизвестно,
    // кто подключится. См. handleAuth.

    // ── Аукцион, баунти, глобальные объявления ──────────────────
    // Новый лот видят все: цены на аукционе меняются, и игрок, который
    // смотрит рынок, должен узнать о лоте сразу.
    await this.redis.subscribe(REDIS_CHANNELS.AUCTION_NEW_LISTING, (msg) => {
      this.io.emit(SOCKET_EVENTS.AUCTION_NEW_LISTING, msg);
    });
    // Объявление всем игрокам (используется осадами территорий гильдий).
    await this.redis.subscribe(REDIS_CHANNELS.GLOBAL_NOTIFICATION, (msg) => {
      this.io.emit(SERVER_EVENTS.NOTIFICATION, msg);
    });
    // Баунти висит на конкретном игроке - сообщаем ему и только ему.
    await this.redis.subscribe(REDIS_CHANNELS.BOUNTY_PLACED, (msg) => {
      const socket = this.activePlayers.get(String(msg.targetId));
      if (socket) socket.emit(SOCKET_EVENTS.BOUNTY_PLACED, msg);
    });

    // ── Действия администратора ──────────────────────────────────
    // Кик приходит по userId, а не по characterId: у пользователя может
    // быть несколько персонажей, и закрыть надо все их сокеты. Тот же
    // обход, что и в handleLogout для auth:logout.
    await this.redis.subscribe(REDIS_CHANNELS.ADMIN_KICK_USER, (msg: Record<string, unknown>) => {
      const userId = String(msg.userId);
      const reason = `Администратор: ${String(msg.reason ?? 'kick')}`;
      for (const socket of [...this.activePlayers.values()]) {
        if (socket.userId !== userId) continue;
        socket.emit(SERVER_EVENTS.FORCE_DISCONNECT, { reason });
        socket.disconnect(true);
        this.activePlayers.delete(String(socket.characterId));
      }
    });
    await this.redis.subscribe(REDIS_CHANNELS.ADMIN_MUTE, (msg) => {
      const socket = this.activePlayers.get(String(msg.characterId));
      if (socket) socket.emit(SOCKET_EVENTS.ADMIN_MUTE, msg);
    });
    // Телепорт и выдача предмета - игрок должен увидеть следствие,
    // иначе он стоит в другом месте и не понимает почему.
    await this.redis.subscribe(REDIS_CHANNELS.ADMIN_TELEPORT, (msg) => {
      const socket = this.activePlayers.get(String(msg.characterId));
      if (socket) socket.emit(SOCKET_EVENTS.ADMIN_TELEPORT, msg);
    });
    await this.redis.subscribe(REDIS_CHANNELS.ADMIN_GIVE_ITEM, (msg) => {
      const socket = this.activePlayers.get(String(msg.characterId));
      if (socket) socket.emit(SOCKET_EVENTS.ADMIN_GIVE_ITEM, msg);
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

      // Подстраховка от «мёртвого» входа. Штатно такого быть не может:
      // состояние смерти всегда снимается респавном или таймером. Но если
      // сервер упал/перезапустился между смертью и респавном, в БД остался
      // hp = 0, и игрок зашёл бы в мир трупом без единого шанса выйти.
      if (character.hp <= 0) {
        const revived = await this.characterService.respawn(character.id).catch(() => null);
        if (revived?.ok) {
          character.position = revived.position;
          character.hp = revived.hp;
          character.maxHp = revived.maxHp;
          logger.info(`Player revived on login: ${character.id} (${character.region})`);
        }
      }

      socket.userId = userId;
      socket.characterId = character.id;
      socket.region = character.region;
      socket.zoneCache = new Map();
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
      // Активировать шард: заселить монстрами, если он ещё пуст.
      //
      // Аренда теперь параметром: шард активируется только у хозяина. Без
      // неё два инстанса заселяли бы каждый шард вдвое — двойная толпа, из
      // которой бьётся только своя. Если шард чужой, вернётся false, и
      // процесс просто не держит его бой.
      await GameLoop.getInstance().getSpawnSystem().activateShard(shardId, this.аренда);
      await this.redis.addPlayerToRegion(shardId, character.region, character.id).catch(() => {});
      // Позиция в Redis сразу: иначе стоящий игрок невидим для ИИ,
      // пока клиент не пошлёт первый player:move
      await this.redis.setPlayerPosition(character.id, character.position).catch(() => {});
      this.activePlayers.set(character.id, socket);
      // Канал смены скакуна персональный (в имени есть id персонажа),
      // поэтому подписаться можно только зная, кто подключился. Раньше
      // MountSystem публиковал в него, а подписчика не было вовсе: смена
      // скакуна доходила до клиента лишь после перечитывания панели.
      // Повторный вход подписывает ещё раз на тот же канал - Redis
      // отдаст сообщение обоим, но это один и тот же сокет, так что
      // игрок увидит событие ровно один раз.
      void this.redis.subscribe(REDIS_CHANNELS.PLAYER_MOUNT(character.id), (mount: Record<string, unknown>) => {
        this.activePlayers.get(character.id)?.emit(SOCKET_EVENTS.PLAYER_MOUNT, mount);
      }).catch((e) => logger.warn('[Socket] подписка на канал скакуна не удалась:', e));
      // Базовая точка античита = точка спавна: первый пакет движения
      // после входа не должен считаться телепортом от старой позиции
      this.antiCheat.resetPosition(character.id, character.position);
      // Если игрок вошёл в игру внутри здания, первый пакет движения
      // прощаем. Причина конкретная: комнаты интерьеров лежат ЗА границей
      // мира (комната у тракта около x=2500 при WORLD_HALF = 1200), и клиент
      // на первом кадре клампит позицию к границе, если не восстановил
      // режим «внутри». Сервер видит скачок больше тысячи метров, считает его
      // телепортом и кикает. Пять таких переподключений за сутки — и
      // AutoCheatSystem вешает перманентный бан за «читерство».
      //
      // Клиент это уже чинит (enterBuildingLocalAt при входе в мир), но старый
      // бандл в кэше браузера ещё неделю будет жить, а бан необратим.
      if (Object.values(INTERIORS).some(d => isInsideRoom(d, character.position.x, character.position.z))) {
        this.insideSpawnGrace.add(character.id);
      }

      socket.emit(SOCKET_EVENTS.AUTH_SUCCESS, { character });
      // Игрок реально вошёл в мир. До этого события в аналитику попадали
      // только входы через форму, а токен живёт 30 дней: заход на второй
      // день не писал НИЧЕГО, и удержание по таким данным было нулём у
      // всех, кто не перезаходил с логина. Отмечаем здесь — после того, как
      // клиенту ушёл AUTH_SUCCESS, то есть вход состоялся.
      analytics.track(
        'session_start',
        { region: character.region, serverId: character.serverId, level: character.level },
        userId,
        character.id,
      );

      // Игрок реально вошёл в мир. До этого события в аналитику попадали
      // только входы через форму, а токен живёт 30 дней: заход на второй
      // день не писал НИЧЕГО, и удержание по таким данным было нулём у
      // всех, кто не перезаходил с логина. Отмечаем здесь — после того, как
      // клиенту ушёл AUTH_SUCCESS, то есть вход состоялся.

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
    data: { position: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number }; crouch?: boolean }
  ): Promise<void> {
    if (!socket.characterId || !socket.region) return;
    const characterId = socket.characterId;

    // Частота пакетов. Считаем ДО проверки смерти: ограничение пакетов
    // должно работать и для мёртвого, иначе флуд в состоянии смерти
    // проходил бы без санкций.
    const rateCheck = this.antiCheat.validatePacketRate(characterId);
    if (!rateCheck.valid) {
      await this.punish(socket, 'packet_flood', rateCheck.reason ?? 'packet flood', 2);
      return;
    }

    // Мёртвый не ходит. Пакеты просто игнорируются: ни позиция в Redis,
    // ни запись в БД, ни трансляция соседям, ни проверка античита движения
    // (она бы сравнивала движение с местом смерти и ругалась на скорость).
    if (this.deadPlayers.has(characterId)) return;

    // Скорость / телепорт
    //
    // Предел берётся из активного скакуна. Пока скорость кэширована, берём
    // её из памяти: в базу за скоростью не ходят на каждом пакете (их
    // десятки в секунду). Кэш пуст при первом движении после входа — тогда
    // читаем один раз, не дожидаясь: первый пакет всё равно медленный.
    if (!this.mountSpeeds.has(characterId)) void this.refreshMountSpeed(characterId);
    const mountSpeed = this.mountSpeeds.get(characterId)?.speed ?? 0;
    const moveCheck = this.antiCheat.validateMovement(
      characterId, data.position, Date.now(), MOUNT_ANTICHEAT_CAP_FLOOR + mountSpeed
    );
    if (!moveCheck.valid) {
      // Амнистия переходов у дверей и внутри комнат: легальный вход/выход
      // (включая старые клиенты без ack и граничные случаи) никогда не кикает.
      // Позиция принимается, трекинг сбрасывается — как travel/respawn.
      const px = data.position.x, pz = data.position.z;
      const legal = Object.values(INTERIORS).some(
        (d) => isInsideRoom(d, px, pz) || Math.hypot(px - d.doorX, pz - d.doorZ) <= 30
      );
      // Вход в игру внутри здания: прощаем ОДИН пакет и снимаем отсрочку.
      // Игрок оказывается у границы мира не по своей воле, и наказывать его
      // за переподключение нельзя — иначе пять переподключений дают бан
      if (legal || this.insideSpawnGrace.delete(characterId)) {
        this.antiCheat.resetPosition(characterId, data.position);
      } else {
        await this.punish(socket, 'speed_hack', moveCheck.reason ?? 'invalid movement', 2);
        socket.emit(SOCKET_EVENTS.MOVE_REJECTED, { reason: moveCheck.reason });
        return;
      }
    }

    // Кэшировать позицию в Redis (быстро)
    await this.redis.setPlayerPosition(characterId, data.position).catch(() => {});
    // ...и рядом в памяти: из неё считается досягаемость удара. Позиция из
    // Redis была бы точнее, но extra-запрос на каждый удар - лишняя
    // нагрузка; Redis-версия используется только для цели, у которой
    // своего кеша в памяти нет.
    this.defenseStates.setPosition(characterId, data.position);

    // Шаг 1 стелса: обнаружение. Считается здесь, потому что здесь сервер
    // впервые узнаёт, где находится игрок, - раньше позиция нигде не была.
    // Правило в shared/stealth.ts, чтобы клиент считал то же самое.
    // Сообщаем только о смене состояния: пакеты движения идут десятками в
    // секунду, и без проверки «а было ли уже» клиент получал бы спам.
    // Шаг 2 стелса: считаем не только обнаружение, но и скрытность.
    //
    // Погода берётся из WorldTimeSystem, а не из пакета игрока: игрок может
    // прислать что угодно, а погода у него одна на весь мир. Время суток
    // тоже своё - timeOfDay сервера. Фактор ночи считает nightFactor() из
    // shared, тем же кодом, что и клиент, иначе стороны разошлись бы, как
    // разошлись двери.
    //
    // visibilityMod берётся из WEATHER_EFFECTS: это поле было объявлено и
    // не читалось (weatherEffects.test.ts так и писал). Песчаная буря
    // сокращает обзор стража с 20 до 6 единиц - ровно то, что просил
    // владелец: «пыльная буря ухудшает обзор, но скрывает игрока в стелсе».
    const время = GameLoop.getInstance().getWorldTime();
    const заметил = spottedBy(data.position, GUARD_POSTS, {
      crouch: data.crouch === true,
      night: nightFactor(время.timeOfDay),
      visibility: WEATHER_EFFECTS[время.weather]?.visibilityMod ?? 1,
    }, Date.now());
    const былЗамечен = this.spottedGuards.get(characterId) ?? null;
    // Шаг 3: запоминаем, где игрок и присел ли он, по тому же пакету, который
    // уже прошёл античит. Событие кражи координат не приносит.
    this.stealthStates.set(characterId, {
      x: data.position.x,
      z: data.position.z,
      crouch: data.crouch === true,
    });
    if (заметил?.id !== былЗамечен) {
      this.spottedGuards.set(characterId, заметил?.id ?? null);
      if (заметил) {
        socket.emit(SERVER_EVENTS.GUARD_SPOTTED, {
          postId: заметил.id,
          nameRu: заметил.nameRu,
        });
      }
    }

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
      // Активный скакун мог смениться (игрок нажал «Верхом» в конюшне), а
      // предел скорости у античита обязан это увидеть
      await this.refreshMountSpeed(characterId);
      // Опыт скакуну за пройденный путь
      await this.grantMountExperience(characterId, data.position);

      // Проверка зоны: если игрок пересёк границу зоны, обновляем и уведомляем
      const { getZoneAt } = await import('../../../shared/constants');
      const newZone = getZoneAt(data.position.x, data.position.z);
      const currentZone = socket.zoneCache?.get(characterId) ?? null;
      if (newZone?.id !== currentZone) {
        socket.zoneCache?.set(characterId, newZone?.id ?? null);
        await this.characterService.updateZone(characterId, newZone?.id ?? null).catch(() => {});
        socket.emit(SERVER_EVENTS.ZONE_CHANGED, { zone: newZone ?? null });
      }
    }

    // Транслировать другим игрокам в регионе
    socket.to(`shard:${socket.shardId}:region:${socket.region}`).emit(SOCKET_EVENTS.PLAYER_MOVED, {
      characterId,
      position: data.position,
      direction: data.direction,
      timestamp: now,
    });
  }

  /**
   * Перечитать активного скакуна и обновить кэш скорости.
   *
   * Кэш, а не истина: истина в character_mounts, но античит спрашивает
   * скорость на каждом пакете движения, а ходить в базу десятки раз в
   * секунду нельзя. Обновляется раз в 5 секунд (в том же блоке, что и запись
   * позиции) и при первом движении после входа.
   */
  private async refreshMountSpeed(characterId: string): Promise<void> {
    try {
      const active = await this.mounts.getActiveMount(characterId);
      if (active) {
        this.mountSpeeds.set(characterId, { mountId: active.mount.mountId, speed: active.speed });
      } else {
        this.mountSpeeds.set(characterId, { mountId: '', speed: 0 });
      }
    } catch {
      // База недоступна — едем с пешим пределом. Лучше рискнуть киком на
      // ездоке, чем обрушить движение всем
      this.mountSpeeds.set(characterId, { mountId: '', speed: 0 });
    }
  }

  /**
   * Опыт активному скакуну за пройденный путь.
   *
   * Раньше addMountExperience не вызывался нигде, поэтому уровень скакуна
   * всегда оставался первым, а getMountSpeed — мёртвым кодом: скорость
   * зависела только от baseSpeed и никогда не росла.
   *
   * Отсчёт идёт от прошлой точки замера, а не от позиции входа в игру: иначе
   * первое сохранение после долгого отсутствия засчитало бы путь, который
   * игрок прошёл вчера. Точка замера ставится в этом же методе, поэтому
   * повторный вызов в ту же секунду пути не начислит.
   */
  private async grantMountExperience(characterId: string, pos: { x: number; z: number }): Promise<void> {
    const mount = this.mountSpeeds.get(characterId);
    if (!mount?.mountId) return;   // пешком — опыта скакуну не идёт
    const last = this.mountExpAt.get(characterId);
    this.mountExpAt.set(characterId, { x: pos.x, z: pos.z });
    if (!last) return;    // первый замер: базы для пути ещё нет

    const meters = Math.hypot(pos.x - last.x, pos.z - last.z);
    // Скорость ~7 м/с, опыт 1 за 10 м: десятый уровень — около 40 км пути,
    // то есть полтора-два часа верховой езды за игру
    const exp = Math.floor(meters / 10);
    if (exp <= 0) return;
    try {
      const res = await this.mounts.addMountExperience(characterId, mount.mountId, exp);
      if (res.leveledUp) {
        // Скорость выросла — обновляем и кэш, и игрока: иначе езда была бы
        // быстрее прежней, а предел античита остался бы старым
        await this.refreshMountSpeed(characterId);
        this.activePlayers.get(characterId)?.emit(SERVER_EVENTS.NOTIFICATION, {
          type: 'mount_level',
          titleRu: 'Скакун окреп',
          bodyRu: `Уровень ${res.newLevel}`,
        });
      }
    } catch { /* скакун мог быть удалён или снят — это не повод ронять игру */ }
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
   *
   * Рывок откатывается: иначе игрок, дергая кнопку, держал бы неуязвимость
   * непрерывно - стамина успевает восстановиться между нажатиями.
   */
  private async handleDefensiveAction(socket: AuthenticatedSocket, action: CombatAction): Promise<void> {
    if (!socket.characterId) return;
    const character = await this.characterService.getCharacterById(socket.characterId);
    if (!character) return;

    const isDodge = action.actionType === 'dodge';

    // Резерв рывка ставится до любого await. Если поставить его после
    // списания стамины, два быстрых пакета оба пройдут проверку отката (между
    // проверкой и активацией есть await), оба спишут стамину, а второй
    // вернёт false - и игрок потеряет ресурсы за отклонённое действие.
    if (isDodge && !this.defenseStates.activateDodge(character.id)) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'dodge_cooldown' });
      return;
    }

    // Резерв щита — тоже до списания стамины, как у рывка: проверка отката
    // и резерв в одном вызове, иначе спам ПКМ списывал бы стамину за каждый
    // отклонённый щит. Отклонённый щит не тратит стамину вовсе.
    if (!isDodge && !this.defenseStates.activateBlock(character.id)) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'block_cooldown' });
      return;
    }

    // Стоимость щита зависит от стойки: у «Шахского щита» он почти бесплатный,
    // у «Танца серпа» дорогой. Раньше стоимость была одна на всех, то есть
    // обещание «оборонительный стиль» было бы пустым словом.
    const stance = await this.getStance(character.id);
    const staminaCost = isDodge ? DODGE_STAMINA_COST : STANCES[stance].blockStamina;
    const ok = await this.characterService.spendResources(character.id, 0, staminaCost);
    if (!ok) {
      // Резерв не состоялся из-за стамины - откатываем, иначе игрок
      // ждал бы отката за действие, которого не было.
      if (isDodge) this.defenseStates.clearDodge(character.id);
      else this.defenseStates.clearBlock(character.id);
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'not_enough_stamina' });
      return;
    }

    socket.emit(SERVER_EVENTS.COMBAT_BLOCKED, {
      actionType: action.actionType,
      characterId: character.id,
    });
  }

  /**
   * Множитель серии лёгких атак: каждый третий удар серии бьёт в 1.5×.
   *
   * Стоимость серии меняется стойкой: у «Танца серпа» третий удар бьёт в 2.25
   * (1.5 серии × 1.5 стойки) — это и есть смысл агрессивного стиля.
   */
  private comboMultiplier(characterId: string, action: CombatAction, comboScale = 1): number {
    if (action.actionType !== 'attack' || action.skillId) return 1;
    const now = Date.now();
    const chain = this.comboChains.get(characterId);
    if (!chain || now - chain.lastAt > 4000) {
      this.comboChains.set(characterId, { count: 1, lastAt: now });
      return 1;
    }
    chain.count++;
    chain.lastAt = now;

    // Отметка достижения «комбо из 5». Пишется РОВНО ОДИН РАЗ на цепочку -
    // в момент пересечения порога, - а не на каждый удар.
    //
    // Почему так: comboMultiplier зовётся на каждом ударе, и запись в базу на
    // каждом ударе сделала бы самый горячий путь игры самым тяжёлым. Письмо
    // при chain.count === 5 даёт одну запись на серию, а GREATEST в базе не
    // даёт рекорду ни упасть, ни сложиться.
    //
    // Ошибка не роняет удар: игрок бьёт, а запись - его достижение.
    // Незаписанное достижение лучше, чем не нанесённый удар.
    if (chain.count === GameSocketHandler.COMBO_THRESHOLD) {
      void this.leaderboardService
        .recordCombo(characterId, chain.count)
        .catch(err => logger.error('[Combo] рекорд не записан:', (err as Error).message));
    }

    return chain.count % 3 === 0 ? 1.5 * comboScale : 1;
  }

  /**
   * Стойка персонажа.
   *
   * Читается из базы. Неизвестное значение и ошибка базы дают обычный бой,
   * а не падение боевого пути: стойка не должна быть причиной, по которой
   * не работает удар.
   */
  private async getStance(characterId: string): Promise<CombatStance> {
    const row = await this.characterService.getStance(characterId).catch(() => 'balanced' as CombatStance);
    return isCombatStance(row) ? row : 'balanced';
  }

  /**
   * Включение активного навыка профессии.
   *
   * Проверяется всё, из-за чего навык не должен включиться: навык выучен,
   * активный, откал прошёл, хватает маны и выносливости, эффект
   * существует. Пропуск любой проверки означал бы либо бесплатный откат,
   * либо эффект без выученного навыка.
   *
   * Откал живёт в памяти вместе с кулдаунами классовых навыков:
   * он не должен переживать перезаход, иначе перезаход обнулял бы его,
   * и игрок мог бы включать Тадж без предела.
   */
  private async handleSkillActivate(socket: AuthenticatedSocket, data: { skillId?: string }): Promise<void> {
    if (!socket.characterId) return;
    const skillId = String(data?.skillId ?? '');
    if (!skillId) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'unknown_skill' });
      return;
    }

    const skill = await skillsService.getActiveSkill(socket.characterId, skillId);
    if (!skill) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'unknown_skill', skillId });
      return;
    }
    if (!skill.active?.buff) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'skill_not_active' });
      return;
    }
    // Обе траты одним вызовом: раздельные списывания означали бы, что при
    // нехватке маны выносливость уже потрачена, а навык не включился.
    const paid = await this.characterService.spendResources(
      socket.characterId, skill.manaCost, skill.staminaCost
    );
    if (!paid) {
      // Не различаем, чего именно не хватило: клиент покажет обе полоски,
      // и игрок увидит, где не хватило, без лишнего вопроса.
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'not_enough_mana' });
      return;
    }
    if (skill.cooldown > 0 && !this.checkCooldown(socket.characterId, skill.id, skill.cooldown)) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'skill_cooldown', skillId: skill.id });
      return;
    }

    const buff = await this.buffs.grant(socket.characterId, skill.active.buff);
    if (!buff) {
      // Эффекта нет в каталоге: ресурсы уже потрачены, а навык не дал
      // ничего. Возврат обязателен, иначе игрок терял бы ресурсы за
      // несуществующий эффект.
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'skill_no_effect' });
      return;
    }
    // Отдельного события о баффах в проекте нет: плашки обновляет клиент
    // по таймеру через /api/characters/:id/buffs. Отправка несуществующего
    // события выглядела бы как «мы обновили игрока», а игрок бы ждал.
    socket.emit(SOCKET_EVENTS.COMBAT_RESULT, { skillActivated: true, skillId: skill.id, buff });
  }

  /**
   * Смена боевой стойки.
   *
   * Смена мгновенная, но не бесплатная: конная стрельба требует скакуна, и
   * без него запрос отклоняется с кодом, а стойка остаётся прежней. Иначе
   * игрок выбрал бы «конную стрельбу» пешком и просто получил бы дальний бой.
   *
   * Ответ всегда содержит фактически применённую стойку: если просили
   * неизвестную, придёт balanced, и клиент покажет честное значение.
   */
  private async handleStanceChange(socket: AuthenticatedSocket, data: { stance?: string }): Promise<void> {
    if (!socket.characterId) return;
    const requested = data?.stance ?? 'balanced';
    if (!isCombatStance(requested)) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'unknown_stance' });
      socket.emit(SOCKET_EVENTS.COMBAT_STANCE, { stance: await this.getStance(socket.characterId) });
      return;
    }
    if (STANCES[requested].requiresMount) {
      const mount = await this.mounts.getActiveMount(socket.characterId).catch(() => null);
      if (!mount) {
        socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'stance_needs_mount' });
        socket.emit(SOCKET_EVENTS.COMBAT_STANCE, { stance: await this.getStance(socket.characterId) });
        return;
      }
    }
    const applied = await this.characterService.setStance(socket.characterId, requested);
    socket.emit(SOCKET_EVENTS.COMBAT_STANCE, { stance: applied });
  }

  /**
   * Опыт навыка и профессии за нанесённый урон.
   *
   * Здесь только вызов: правила начисления живут в SkillsService, где
   * известно, какие навыки у персонажа выучены, и где их можно проверить
   * без поднятия сервера. Раньше единственным источником опыта был
   * маршрут, где клиент сам присылал сумму, и проверки владельца не было.
   *
   * void, а не await: опыт не должен задерживать удар. Ошибка глотается
   * здесь - отсутствие таблиц не должно ронять бой.
   */
  private grantCombatProgress(characterId: string, action: CombatAction, damage: number): void {
    if (!Number.isFinite(damage) || damage <= 0) return;
    void skillsService.gainProgressForHit(
      characterId,
      action.actionType === 'attack' ? action.skillId ?? null : null,
      damage
    ).catch((err: Error) => {
      logger.warn(`[Skills] progress failed for ${characterId}: ${err.message}`);
    });
  }

  private async handleCombatAction(socket: AuthenticatedSocket, action: CombatAction): Promise<void> {
    if (!socket.characterId || !socket.region) return;
    // Мёртвый не бьёт: ни во что, ни по кому. Без проверки можно было бы
    // держать боевые пакеты в очереди и применить их сразу после респавна.
    if (this.deadPlayers.has(socket.characterId)) return;

    // Оглушение. Монстры с эффектом stun объявляли его в данных с самого
    // начала, и не читался ни один: удары с оглушением ничем не
    // отличались от обычных. Теперь оглушённый не может бить, уклоняться
    // и ставить щит - ровно то, что обещает название эффекта.
    //
    // Проверка до всего остального, включая проверку частоты пакетов:
    // иначе игрок под оглушением мог бы слать боевые пакеты и получать
    // отказ по частоте - ошибку про спам вместо ошибки про оглушение.
    // Проклятие Шеиха: в страхе нельзя бить и колдовать, но можно
    // защищаться и бежать. Иначе игрок в страхе был бы беспомощен, и это
    // уже не наказание.
    const вСтрахе = await this.debuffs.isAfraid(socket.characterId).catch(() => false);
    if (
      вСтрахе &&
      action.actionType !== 'dodge' &&
      action.actionType !== 'block'
    ) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'afraid' });
      return;
    }
    const оглушён = await this.debuffs.isStunned(socket.characterId).catch(() => false);
    if (оглушён) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'stunned' });
      return;
    }

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
        socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'unknown_skill' });
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
          socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'skill_cooldown', skillId: skill.id });
          return;
        }
      }

      // Ресурсы: мана/стамина
      if (skill) {
        const ok = await this.characterService.spendResources(attacker.id, skill.manaCost, skill.staminaCost);
        if (!ok) {
          socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'not_enough_mana', skillId: skill.id });
          return;
        }
      }

      // Оружие в руках задаёт силу и досягаемость удара. Раньше его не было в
      // бою вообще: урон считался только из характеристик, поэтому шамшир,
      // сабля и лук били одинаково.
      const weapon = await this.equipment.getWeapon(attacker.id);

      // Стойка определяет урон, скорость и досягаемость. Конная стрельба
      // пешком недоступна: без проверки скакуна это был бы просто «дальний
      // бой», доступный каждому.
      const stanceId = await this.getStance(attacker.id);
      const stance = STANCES[stanceId];
      if (stance.requiresMount) {
        const mount = await this.mounts.getActiveMount(attacker.id).catch(() => null);
        if (!mount) {
          socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'stance_needs_mount' });
          return;
        }
      }

      // Откат обычной атаки считается здесь, а не в начале обработчика:
      // раньше он был жёстким (380 мс для всех), потому что оружие и стойка
      // ещё не были прочитаны. Теперь откату есть из чего считаться.
      //
      // Откат — это время одного замаха: weapon.speed из данных предмета,
      // умноженное на скорость стойки. Раньше speed предмета и attackSpeed
      // стойки не участвовали в бою вообще: любое оружие било одинаково, а
      // «Серповая пляска» с обещанными +30 % не давала ничего.
      //
      // Замедление от эффекта монстра растягивает откат, как и раньше.
      // Ошибка базы читается как «не замедлён»: пропустить один удар
      // игроку честнее, чем заблокировать бой из-за сбоя чтения.
      if (action.actionType === 'attack' && !action.skillId) {
        // Откат — это время одного замаха: weapon.speed из данных предмета, делённое
        // на скорость стойки. Именно ДЕЛЕНИЕ: attackSpeed — множитель СКОРОСТИ
        // (1.3 у «Серповой пляски» — «урон и скорость выше», 0.8 у «Шахского
        // щита» — «замах медленный»), поэтому умножение времени на него
        // перевернуло бы стойки наоборот: агрессивная стала бы самой медленной.
        const замедление = Math.max(0.2, Math.min(1, await this.debuffs.speedMultiplier(attacker.id).catch(() => 1)));
        const замах = ((weapon?.speed ?? DEFAULT_WEAPON.speed) * 1000) / stance.attackSpeed;
        const откат = Math.round(Math.max(MIN_ATTACK_INTERVAL_MS, замах) / замедление);
        const last = this.lastAttackAt.get(attacker.id) ?? 0;
        if (Date.now() - last < откат) {
          socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'attack_too_fast' });
          return;
        }
        this.lastAttackAt.set(attacker.id, Date.now());
      }

      // Бонус профессии «Воин» или «Лучник» на урон. Раньше обещание
      // «увеличивает урон на 15%» висело в панели и не было связано ни с
      // одной строкой расчёта. Множитель входит в тот же продукт, что и
      // стойка, и оба проверяются числами.
      const prof = await professionOf(attacker.id);
      const profDamage = professionBonuses(prof?.id ?? null, prof?.level ?? 0).damage;
      // Пассивные навыки: Аламы удлиняют удар и прибавляют урона.
      // Считаются здесь, а не внутри расчёта, чтобы обе ветви боя брали
      // одно и то же.
      const passives = await skillsService.getPassiveMultipliers(attacker.id);
      const totalDamageScale = stance.damage * profDamage * passives.damage;
      const totalReach = stance.reach * passives.reach;

      // Досягаемость. Проверяем по серверным позициям, а не по присланным
      // клиентом: иначе правкой клиента можно бить через полкарты, указав
      // свою позицию рядом с жертвой. Монстры - по позиции из ИИ.
      const reach = (weapon?.range ?? DEFAULT_WEAPON.range) * totalReach;
      const isBasic = action.actionType === 'attack' && !action.skillId;
      if (isBasic) {
        let targetPos: { x: number; y: number; z: number } | null = null;
        if (UUID_RE.test(action.targetId)) {
          targetPos = await this.redis.getPlayerPosition(action.targetId) as { x: number; y: number; z: number } | null;
        } else {
          const ctx = GameLoop.getInstance().getSpawnSystem().getAI().getContext(action.targetId);
          if (ctx) targetPos = { x: ctx.position.x, y: ctx.position.y, z: ctx.position.z };
        }
        if (!this.defenseStates.canReach(attacker.id, reach, targetPos)) {
          socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'out_of_reach' });
          return;
        }
      }

      const comboMult = this.comboMultiplier(attacker.id, action, stance.combo);

      // Цель — игрок? (id монстров не UUID — сразу ищем ИИ-контекст)
      if (UUID_RE.test(action.targetId)) {
        const targetRow = await this.characterService.getCharacterById(action.targetId);
        if (targetRow) {
          const target = await this.withEquipment(targetRow);
          await this.combatPlayerVsPlayer(socket, attacker, target, action, comboMult, weapon, totalDamageScale);
          return;
        }
      }

      // Цель — монстр?
      const monsterCtx = GameLoop.getInstance().getSpawnSystem().getAI().getContext(action.targetId);
      if (monsterCtx) {
        await this.combatPlayerVsMonster(socket, attacker, monsterCtx, action, comboMult, totalDamageScale);
        return;
      }

      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'target_not_found', targetId: action.targetId });
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
    comboMult = 1,
    weapon: WeaponProfile | null = null,
    // Стойка и профессия вместе: продукт считается в handleCombatAction,
    // где известны обе, и сюда приходит уже готовым. Отдельный множитель
    // профессии означал бы, что о нём забывают в одной из двух ветвей боя.
    damageScale = 1,
  ): Promise<void> {
    // Мёртвая цель не принимает урон. Без проверки добавленный по сети удар
    // снова «убивал» бы труп, заново ставил состояние смерти и перезапускал
    // таймер автореспавна — игрок, зашедший на PvP, мог бесконечно
    // продлевать себе смерть.
    if (this.deadPlayers.has(target.id)) return;

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

    // Стойка цели определяет, насколько её щит держит. Без этого «Шахский щит»
    // и «Танец серпа» держали бы урон одинаково, то есть выбор стойки ничего
    // бы не значил в защите.
    const targetStance = STANCES[await this.getStance(target.id)];

    // Парирование: удар в первые миллисекунды щита гасится полностью, а
    // часть урона возвращается атакующему. Проверяется по времени начала
    // блока, отдельного действия нет.
    const reflect = this.defenseStates.getParryReflect(target.id);
    if (reflect > 0) {
      const raw = this.combatService.calculateDamage(attacker, target, action, comboMult);
      const returned = Math.max(1, Math.floor(raw.damage * reflect));
      const appliedToAttacker = await this.characterService.applyDamage(attacker.id, returned);
      socket.emit(SOCKET_EVENTS.COMBAT_RESULT, {
        attackerId: attacker.id, targetId: target.id, damage: 0,
        isCritical: false, isBlocked: true, isDodged: false, isParried: true, reflected: returned,
      });
      this.activePlayers.get(target.id)?.emit(SOCKET_EVENTS.COMBAT_RESULT, {
        attackerId: attacker.id, targetId: target.id, damage: 0,
        isCritical: false, isBlocked: true, isDodged: false, isParried: true, reflected: returned,
      });
      // Отражённый урон идёт и в журнал: парирование - такой же бой, как и
      // остальные удары, и прятать его от статистики неправильно.
      // void, а не await, как и остальные записи: журнал не должен
      // задерживать ответ по удару.
      void combatLog.record(buildCombatLogEntry({
        attackerId: attacker.id,
        target: { kind: 'player', id: target.id, name: target.name },
        skillId: action.skillId,
        damage: 0,
        isCritical: false,
        region: socket.region ?? 'unknown',
      }));
      // Парирование засчитывается защитнику: это его достижение, а не
      // атакующего. Отсюда и достижение «Идеальный Блок», и счётчик,
      // на который оно смотрит.
      //
      // void, а не await: счётчик и проверка достижений - награда за бой,
      // а не условие боя. Если база мигнёт, игрок не должен за это
      // расплачиваться самим парированием.
      void this.leaderboardService
        .increment(target.id, { parries: 1 })
        .then(() => this.achievements.checkAll(target.id))
        .catch((e: unknown) => logger.warn('[Combat] счётчик парирований:', (e as Error).message));
      void appliedToAttacker;
      return;
    }

    // Активная защита цели поглощает/отменяет удар
    const defenseMult = this.defenseStates.getIncomingMultiplier(target.id, Date.now(), targetStance.blockReduction);
    if (defenseMult === 0) {
      socket.emit(SOCKET_EVENTS.COMBAT_RESULT, {
        attackerId: attacker.id, targetId: target.id, damage: 0, isCritical: false, isBlocked: false, isDodged: true,
      });
      return;
    }

    const result = this.combatService.calculateDamage(attacker, target, action, comboMult, weapon, damageScale);
    // Временный бонус «+5% к урону» (кебаб). Множитель, а не стат:
    // бонус не должен попадать в панель характеристик и не трогать броню.
    const dmgBuff = await this.buffs.getDamageMultiplier(attacker.id);
    // Тадж дервиша: корона прикрывает своим кругом, поэтому входящий урон
    // уменьшается. Множитель защиты входит в ту же цепочку, что и блок,
    // иначе корона и щит считались бы вопреки друг другу.
    const takenMult = await this.buffs.getDamageTakenMultiplier(target.id);
    result.damage = Math.floor(result.damage * defenseMult * dmgBuff * takenMult);

    if (result.isDodged) {
      socket.emit(SOCKET_EVENTS.COMBAT_RESULT, { attackerId: attacker.id, targetId: target.id, ...result });
      return;
    }

    // Анти-чит: слишком большой урон
    // База анти-чита — ТА ЖЕ формула, что и сам урон, вместе с оружием.
    // Раньше база бралась без оружия, а урон считался с ним: у клинка Шаха
    // (1.25) и у захвата «Орлиный взор» (8) отношение урона к базе доходило
    // до 21 при пороге 15 — и один законный крит объявлялся подделкой урона с
    // мерой 3, то есть перманентным баном.
    const damageCheck = this.antiCheat.validateDamage(
      attacker.id,
      result.damage,
      this.combatService.getBaseDamageForAnticheat(attacker, action, weapon, comboMult, damageScale)
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

    // Опыт за настоящий удар. Начисляется здесь, а не по запросу клиента:
    // единственным путём начисления был маршрут, где игрок сам присылал
    // сумму, и проверки владельца не было вовсе.
    this.grantCombatProgress(attacker.id, action, result.damage);

    // Журнал боёв. Каждый удар между игроками пишется целиком: это и есть
    // материал для разбора споров «он меня убил нечестно». Раньше таблица
    // combat_logs существовала со всей схемой, но не записывал никто -
    // вопрос «что было в бою» был не на что.
    //
    // void, а не await: запись не должна задерживать удар. Сама запись
    // ошибки глотает внутри (сервис), так что необработанного отказа здесь
    // не бывает.
    void combatLog.record(buildCombatLogEntry({
      attackerId: attacker.id,
      target: { kind: 'player', id: target.id, name: target.name },
      skillId: action.skillId,
      damage: result.damage,
      isCritical: result.isCritical,
      region: socket.region ?? 'unknown',
    }));

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

  /**
   * «Монстр как виртуальный персонаж» для общей формулы расчёта урона.
   *
   * Отдельный метод не для красоты: главная цель и цели площади считаются по
   * одному и тому же правилу, и две копии одной формулы рано или поздно
   * разошлись бы в защите или характеристиках.
   */
  private monsterAsCharacter(monsterCtx: AIContext): Character {
    return {
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
  }

  /**
   * Кого ещё накрывает удар по площади, кроме выбранной цели.
   *
   * Радиус считается вокруг цели — так написано в данных и так решил владелец.
   * Отбор: живые монстры того же шарда, без подземельных, к которым у игрока нет
   * доступа (иначе «Дождь Стрел» бил бы по чужой сессии). Порядок — по
   * расстоянию: ближние приходят первыми, и при обрезании по числу целей страдает
   * дальний край, а не ближний.
   */
  private aoeTargetsFor(
    attacker: Character,
    action: CombatAction,
    центр: AIContext,
    ai: AISystem
  ): AIContext[] {
    if (!action.skillId) return [];
    const навык = this.combatService.getSkill(attacker.class, action.skillId);
    if (!навык?.aoe || !навык.aoeRadius) return [];

    const найденные: { ctx: AIContext; расстояние: number }[] = [];
    for (const ctx of ai.getAllInstances()) {
      if (ctx.instanceId === центр.instanceId) continue;
      if (ctx.state === 'dead') continue;
      if (ctx.shardId !== центр.shardId) continue;
      const сессия = this.dungeons.getSessionByMonster(ctx.instanceId);
      if (сессия && !сессия.members.has(attacker.id)) continue;
      const расстояние = Math.hypot(
        ctx.position.x - центр.position.x,
        ctx.position.z - центр.position.z,
      );
      if (расстояние > навык.aoeRadius) continue;
      найденные.push({ ctx, расстояние });
    }
    найденные.sort((a, b) => a.расстояние - b.расстояние);
    return найденные.map((запись) => запись.ctx);
  }
  /** PvE: урон по монстру через ИИ-контекст, награды при смерти */
  private async combatPlayerVsMonster(
    socket: AuthenticatedSocket,
    attacker: Character,
    monsterCtx: AIContext,
    action: CombatAction,
    comboMult = 1,
    // Тот же совмещённый множитель, что и в PvP: стойка и профессия
    // складываются в один продукт, иначе одна из ветвей боя считала бы урон
    // по своим правилам.
    damageScale = 1
  ): Promise<void> {
    if (monsterCtx.state === 'dead') return;

    // Лечение монстра недопустимо
    if (action.skillId && this.combatService.isHealSkill(attacker.class, action.skillId)) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'target_not_found' });
      return;
    }

    // Монстр принадлежит другому серверу — атаковать нельзя
    if (monsterCtx.shardId !== socket.shardId) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'wrong_shard' });
      return;
    }

    // Монстры данжа бьют только участники его сессии
    const dungeonSession = this.dungeons.getSessionByMonster(monsterCtx.instanceId);
    if (dungeonSession && !dungeonSession.members.has(attacker.id)) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { code: 'not_in_group' });
      return;
    }

    // Монстр как «виртуальный персонаж» для общей формулы расчёта урона.
    const monsterAsCharacter = this.monsterAsCharacter(monsterCtx);

    // Оружие и стойка передаются так же, как в PvP: без этого «Танец серпа» и
    // «Шахский щит» влияли бы на PvP, но не на PvE, то есть стойка работала бы
    // только в одной из двух боевых ситуаций.
    const weapon = await this.equipment.getWeapon(attacker.id);
    const result = this.combatService.calculateDamage(attacker, monsterAsCharacter, action, comboMult, weapon, damageScale);
    // Тот же бонус «+5% к урону», что и в PvP-ударе
    const dmgBuff = await this.buffs.getDamageMultiplier(attacker.id);
    result.damage = Math.floor(result.damage * dmgBuff);
    if (result.isDodged) {
      socket.emit(SOCKET_EVENTS.COMBAT_RESULT, { attackerId: attacker.id, targetId: monsterCtx.instanceId, ...result });
      return;
    }

    // База анти-чита — ТА ЖЕ формула, что и сам урон, вместе с оружием.
    // Раньше база бралась без оружия, а урон считался с ним: у клинка Шаха
    // (1.25) и у захвата «Орлиный взор» (8) отношение урона к базе доходило
    // до 21 при пороге 15 — и один законный крит объявлялся подделкой урона с
    // мерой 3, то есть перманентным баном.
    const damageCheck = this.antiCheat.validateDamage(
      attacker.id,
      result.damage,
      this.combatService.getBaseDamageForAnticheat(attacker, action, weapon, comboMult, damageScale)
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

    // Удар по площади. Раньше поля aoe и aoeRadius были в данных и не читались
    // никем: «Дождь Стрел» с радиусом 6, «Гнев Шаха» с 5, «Экстаз Света» с 15 и
    // остальные били ровно одного врага, а ману и перезарядку тратили как за
    // площадь. Радиус считается вокруг цели; в PvP по площади не бьёт никто,
    // кроме выбранной цели, — так решил владелец.
    //
    // Урон каждой цели площади считается против ЕЁ собственной защиты, поэтому
    // считаем через тот же calculateDamage отдельно на каждого.
    const задетые = this.aoeTargetsFor(attacker, action, monsterCtx, ai);
    let уронПоПлощади = 0;
    for (const цель of задетые) {
      const уронЦели = this.combatService.calculateDamage(
        attacker,
        this.monsterAsCharacter(цель),
        action,
        comboMult,
        weapon,
        damageScale,
      ).damage;
      уронПоПлощади += уронЦели;
      const добитый = ai.takeDamage(цель.instanceId, уронЦели, attacker.id);
      // Отдельный пакет на каждую цель: клиент рисует цифру урона по
      // идентификатору, поэтому площадь видна без единой правки на клиенте.
      socket.emit(SOCKET_EVENTS.COMBAT_RESULT, {
        attackerId: attacker.id,
        targetId: цель.instanceId,
        damage: уронЦели,
        isCritical: false,
        isBlocked: false,
        isDodged: false,
        targetHp: Math.max(0, цель.currentHp),
        targetMaxHp: цель.maxHp,
      });
      if (добитый) await this.rewardMonsterKill(socket, attacker, цель);
    }

    // Опыт навыков и профессии — по всему нанесённому урону, включая площадь:
    // игрок действительно ударил столько, сколько увидел на экране.
    this.grantCombatProgress(attacker.id, action, result.damage + уронПоПлощади);

    // Журнал боёв по монстрам. Обычный мусор не пишется - решение принимает
    // buildCombatLogEntry, он же возвращает null, если писать нечего.
    void combatLog.record(buildCombatLogEntry({
      attackerId: attacker.id,
      target: {
        kind: 'monster',
        // У монстра нет своего UUID: идентификатор инстанса такой
        // (mob_bandit_scout_1756500000000_a3f9x), поэтому в колонку
        // target_id он бы и не поместился
        instanceId: monsterCtx.instanceId,
        name: monsterCtx.definition.nameRu,
        monsterType: monsterCtx.definition.type,
      },
      skillId: action.skillId,
      damage: result.damage,
      isCritical: result.isCritical,
      region: socket.region ?? 'unknown',
    }));

    socket.emit(SOCKET_EVENTS.COMBAT_RESULT, {
      attackerId: attacker.id, targetId: monsterCtx.instanceId, ...result,
      targetHp: Math.max(0, monsterCtx.currentHp),
      targetMaxHp: monsterCtx.maxHp,
      comboFinisher: comboMult > 1,
    });

    socket.to(`shard:${socket.shardId}:region:${socket.region}`).emit(SOCKET_EVENTS.COMBAT_VISUAL, {
      attackerId: attacker.id, targetId: monsterCtx.instanceId, actionType: action.actionType, skillId: action.skillId, position: action.position,
    });

    if (died) await this.rewardMonsterKill(socket, attacker, monsterCtx);
  }


  /**
   * Награда за убийство монстра.
   *
   * Отдельный метод не для красоты: удар по площади может убить несколько
   * монстров сразу, и копия этого блока рядом с шагом площади рано или поздно
   * разошлась бы с оригиналом — опыт, лут, квесты, задания дня и осада в разных
   местах.
   */
  private async rewardMonsterKill(
    socket: AuthenticatedSocket,
    attacker: Character,
    monsterCtx: AIContext
  ): Promise<void> {
    // `def` уже объявляется в перенесённом теле: раньше скрипт добавлял своё
    // объявление, и компилятор ругался на повтор.
// Начисляем награду убийце: опыт, золото и лут из таблицы монстра
    const def = monsterCtx.definition;
    // Бонус территории: +10% опыта владельцу за владение ею в этом
    // регионе. До этого бонусы из TerritoryDefinition.bonuses были
    // объявлены у всех четырёх территорий и не читались никем.
    //
    // Порядок тот же, что у навыка гильдии по золоту: множитель
    // применяется ДО округления. Округлив базовое число, а потом умножив,
    // потеряли бы весь бонус на мелком опыте.
    //
    // Отказ здесь не глотаем: бонусВида обязан бросить на неизвестном виде,
    // потому что молчаливый ноль - это опечатка в данных, которая выглядит
    // как «бонуса нет».
    let опытБазовый = def.expReward;
    try {
      const бонусы = await TerritoryBonuses.getInstance().бонусыИгрока(attacker.id, attacker.region);
      опытБазовый = Math.floor(опытБазовый * бонусы.exp);
    } catch (e) {
      logger.error(`[TerritoryBonuses] бонус не применён, опыт базовый: ${(e as Error).message}`);
    }
    const reward = await this.characterService.addExperience(attacker.id, опытБазовый);

    // Репутация за убийство. Раньше не начислялась: addReputation был
    // написан и не вызывался. Повышение ранга показываем игроку — иначе
    // единственным признаком того, что репутация растёт, было бы число,
    // которое игрок и не смотрел бы.
    // Счётчик убийств для вкладки рейтинга «Убийства». Раньше она
    // показывала 0 у всех: колонка monsters_killed была в схеме с самого
    // начала, и её не писал никто. Через increment, потому что тик
    // регенерации раз в 5 секунд перезаписывает строку рейтинга целиком.
    void this.leaderboardService.increment(attacker.id, { monstersKilled: 1 })
      // Счётчик накопился - проверяем достижения. Именно здесь, а не в
      // панели: «Первая Кровь» выдаётся за первое убийство, а панель
      // могли и не открыть. Цепочкой, потому что счётчик копится
      // сложением и на момент проверки уже должен лежать в базе.
      .then(() => this.achievements.checkAll(attacker.id))
      .catch((error) => logger.debug('Leaderboard kills skipped:', error));
    void grantReputation(attacker.id, 'monsterKill', (faction, rankRu) => {
      socket.emit(SERVER_EVENTS.NOTIFICATION, {
        type: 'rank_up',
        titleRu: 'Новый ранг',
        bodyRu: `${FACTION_NAMES_RU[faction] ?? faction}: ${rankRu}`,
      });
    });

    const золотоБазовое = def.goldReward.min + Math.floor(Math.random() * (def.goldReward.max - def.goldReward.min + 1));
    // Навык гильдии «Удача Торговца»: +3% к золоту с монстров за уровень.
    // До этого навык был объявлен в data/guilds.ts и не существовал.
    //
    // Порядок важен: множитель применяется ДО округления вниз. Если бы
    // округлили базовое число, а потом умножили, бонус в 3% на мелких
    // монетах терялся бы целиком, и игрок заплатил бы за навык в пустоту.
    let золото = золотоБазовое;
    try {
      const бонусы = await new GuildService().getBonuses(attacker.id);
      золото = Math.floor(золотоБазовое * бонусы.gold);
    } catch {
      золото = золотоБазовое;
    }
    const gold = золото;
    await this.characterService.addGoldReward(attacker.id, gold).catch(() => {});

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
      // Уведомление о завершении - ВСЕМ участникам захода, а не только тому,
      // кто добил босса. Раньше событие уходило в сокет убийцы, и остальные
      // участники получали опыт, золото и предметы молча: экран не открывался
      // ни разу, и непонятно было, куда делась добыча.
      //
      // Каждому уходит его доля: при трёх участниках и трёх предметах видно
      // «тебе достался вот этот», а не «вот эти три на всех». Общая сумма и
      // весь список предметов тоже остаются - по ним виден итог захода.
      for (const доля of dungeonDone.shares) {
        const сокетУчастника = this.activePlayers.get(доля.characterId);
        if (!сокетУчастника) continue;
        сокетУчастника.emit(SERVER_EVENTS.DUNGEON_COMPLETED, {
          ...dungeonDone,
          gold: доля.gold,
          items: доля.items,
        });
      }
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

    // Прогресс гильдейских заданий. void, а не await: это горячая точка
    // (каждый удар каждого игрока), и ожидание запроса в базу за
    // гильдией поставило бы бой на паузу. Ошибка внутри onKill ловится
    // и пишется в журнал сама.
    void guildMissionService.onKill(attacker.id, def.id);
    // Осада территории гильдии: урон крепости от убийств в её регионе.
    // void и без await - по той же причине, что и у заданий гильдии выше:
    // это горячая точка (каждый удар каждого игрока), и ожидание запроса в
    // базу поставило бы бой на паузу. Если осады в регионе нет, система
    // возвращается сразу, не обращаясь к базе.
    void SiegeSystem.getInstance().нанестиУрон(attacker.id, attacker.region)
      .catch((e: unknown) => {
        logger.debug('Siege damage failed:', e);
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

  /**
   * Смерть игрока.
   *
   * Раньше здесь СРАЗУ стоял респавн на стартовой точке региона, и игрок
   * не вил ничего, кроме мелькнувшей надписи. Теперь смерть — состояние:
   * сервер запоминает точку, где погиб, и ждёт решения игрока (город или
   * место за золото) либо срабатывает страховочный таймер.
   */
  /**
   * Потерять золото при смерти по карме.
   *
   * Расчёт вынесен в чистую функцию karmaDeathDrop, здесь только списание.
   * Ошибка списания не должна помешать смерти оформиться: игрок и так мёртв,
   * и молча проглоченная ошибка оставила бы его без экрана смерти.
   */
  private async applyKarmaDeathDrop(dead: Character): Promise<{ dropped: number }> {
    // Карма читается из базы, а не берётся из персонажа: в типе Character
    // такого поля нет, и молчаливый ноль превращал бы штраф в ноль.
    const карма = await this.karmaSystem.getKarma(dead.id).catch(() => 0);
    const штраф = karmaDeathDrop(карма, Number(dead.gold ?? 0), Math.random());
    if (штраф.dropped <= 0) return { dropped: 0 };
    try {
      const остаток = await this.characterService.spendGold(dead.id, штраф.dropped);
      dead.gold = остаток;
      return { dropped: штраф.dropped };
    } catch {
      // Золота не хватило (или запись не прошла): потери нет, и это не ошибка.
      return { dropped: 0 };
    }
  }
  private async handlePlayerDeath(dead: Character, killer?: Character): Promise<void> {
    // Повторная смерть (два урона в одном кадре, добивание трупа) —
    // состояние уже есть, второй таймер только запутал бы логику
    if (this.deadPlayers.has(dead.id)) return;

    const deadSocket = this.activePlayers.get(dead.id);

    // Точка смерти — живая позиция из Redis: в БД она записывается раз
    // в 5 секунд, и «респавн на месте» уводил бы игрока на пару метров
    // в сторону от того места, где он реально упал.
    const live = await this.redis.getPlayerPosition(dead.id).catch(() => null) as
      { x?: number; z?: number } | null;
    const position = {
      x: Number.isFinite(live?.x) ? Number(live?.x) : dead.position?.x ?? 0,
      y: 0,
      z: Number.isFinite(live?.z) ? Number(live?.z) : dead.position?.z ?? 0,
    };

    // Страховочный таймер (почему он на сервере — в armAutoRespawn).
    // Снимается в clearDeadState на ЛЮБОМ респавне, поэтому повторно
    // он уже не сработает.
    this.deadPlayers.set(dead.id, { position, busy: false });
    this.armAutoRespawn(dead.id);

    // Потеря золота по карме: таблица последствий KARMA_PENALTIES была
    // объявлена и не читалась нигде. Теперь dropChanceOnDeath работает, и
    // игрок видит сумму в окне смерти — последствие должно быть заметным,
    // иначе это просто число в базе.
    const потеря = await this.applyKarmaDeathDrop(dead).catch(() => ({ dropped: 0 }));

    deadSocket?.emit(SOCKET_EVENTS.PLAYER_DIED, {
      killerId: killer?.id,
      killerName: killer?.name ?? null,
      // Сколько золота забрала карма: клиент показывает это в окне смерти.
      karmaDropGold: потеря.dropped,
      respawnInSec: DEATH.AUTO_RESPAWN_SEC,
      gold: dead.gold,
      spotCostGold: spotRespawnCost(dead.gold),
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

      // НАГРАДА ЗА ГОЛОВУ.
      //
      // Поставить её было можно только мёртвым кодом: placeBounty не вызывался
      // ни разу, а получить было нельзя вообще — колонки claimed_at и
      // claimer_id в таблице bounties не заполнялись никем. Ставка на голову
      // существовала как обрывок между таблицей и слушателем клиента.
      //
      // Выплата идёт в любом случае — и в PvP-зоне, и в безопасной. В
      // безопасной убийство карается кармой, но награда всё равно полагается:
      // за опасную работу платят отдельно от того, карает её кто-то или нет.
      const выплата = await this.karmaSystem.claimBounties(killer.id, dead.id);
      if (выплата > 0) {
        // Событие уходит убийце, если он на этом же сервере. Таймаут не
        // вариант: игрок остался бы без записи, что ему заплатили.
        this.activePlayers.get(killer.id)?.emit(SOCKET_EVENTS.BOUNTY_CLAIMED, {
          targetId: dead.id,
          amount: выплата,
        });
      }
    }

    logger.info(`Player died: ${dead.name}${killer ? ` (killed by ${killer.name})` : ''}`);
  }

  // ============================================================
  // Возрождение: решение игрока или страховочный таймер
  // ============================================================

  /**
   * Снять состояние смерти и её таймер.
   * Вызывается при ЛЮБОМ респавне (решение игрока, таймер, вход с hp=0),
   * поэтому запись не может «залипнуть» и сработать повторно.
   */
  private clearDeadState(characterId: string): void {
    const dead = this.deadPlayers.get(characterId);
    if (!dead) return;
    if (dead.timer) clearTimeout(dead.timer);
    this.deadPlayers.delete(characterId);
  }

  /**
   * Взвести (или перевзвести) страховочный таймер автореспавна.
   *
   * ПОЧЕМУ ТАЙМЕР НА СЕРВЕРЕ, А НЕ ТОЛЬКО НА КЛИЕНТЕ:
   *  1) обрыв связи, закрытая вкладка, перезагрузка страницы — клиент
   *     просто не пришлёт 'respawn', и персонаж остался бы мёртвым навсегда;
   *  2) клиентскому таймеру нельзя доверять: его можно не дослать, страницу
   *     можно перезагрузить, скрипт — не выполнить вовсе;
   *  3) сервер всё равно обязан привести персонажа в валидное состояние,
   *     даже если клиента больше нет.
   * Перевзводится вместо того, чтобы сгорать: если в момент срабатывания
   * шёл чужой респавн (или БД ошиблась), страховка обязана выстрелить
   * позже, а не потеряться.
   */
  private armAutoRespawn(characterId: string): void {
    const dead = this.deadPlayers.get(characterId);
    if (!dead) return;
    if (dead.timer) clearTimeout(dead.timer);
    dead.timer = setTimeout(() => {
      this.completeRespawn(characterId, RESPAWN_TYPES.CITY, 'auto').catch((error: unknown) => {
        logger.error('Auto respawn failed:', error);
        this.armAutoRespawn(characterId);
      });
    }, DEATH.AUTO_RESPAWN_SEC * 1000);
  }

  /**
   * Запрос «respawn» от клиента: { type: 'city' | 'spot' }.
   * Всё остальное сервер решает сам (цену, точку, куда попасть).
   */
  private async handleRespawn(socket: AuthenticatedSocket, data: { type?: string }): Promise<void> {
    if (!socket.characterId) {
      socket.emit(SERVER_EVENTS.RESPAWN_ERROR, { reason: RESPAWN_REJECT.NOT_AUTH });
      return;
    }
    const type = data?.type;
    // Строка из сокета — не доверенный ввод: посторонние значения
    // приводим к отказу, а не к респавну по умолчанию
    if (type !== RESPAWN_TYPES.CITY && type !== RESPAWN_TYPES.SPOT) {
      socket.emit(SERVER_EVENTS.RESPAWN_ERROR, { reason: RESPAWN_REJECT.INVALID_TYPE });
      return;
    }
    if (!this.deadPlayers.has(socket.characterId)) {
      // Уже жив: респавн не нужен, экран смерти можно закрывать
      socket.emit(SERVER_EVENTS.RESPAWN_ERROR, { reason: RESPAWN_REJECT.NOT_DEAD });
      return;
    }
    await this.completeRespawn(socket.characterId, type, 'player');
  }

  /**
   * Собственно возрождение. Точка входа одна и для решения игрока, и для
   * страховочного таймера: значит, состояние смерти снимается одинаково,
   * а второй респавн невозможен (состояния уже нет).
   */
  private async completeRespawn(characterId: string, type: RespawnType, source: 'player' | 'auto'): Promise<void> {
    const dead = this.deadPlayers.get(characterId);
    if (!dead) return;
    if (dead.busy) {
      // Респавн идёт прямо сейчас (клик по кнопке плюс сработавший
      // таймер). Если он удастся — состояние снимет он; если откажет,
      // страховка обязана выстрелить позже, поэтому перевзводим таймер
      this.armAutoRespawn(characterId);
      return;
    }
    // Проверка и установка флага без await между ними: второй запрос,
    // пришедший в том же тике, честно игнорируется
    dead.busy = true;

    const character = await this.characterService.getCharacterById(characterId).catch(() => null);
    if (!character) {
      // Персонажа больше нет — состояние смерти незачем держать
      this.clearDeadState(characterId);
      return;
    }

    let goldCost = 0;
    let spot: { x: number; z: number } | undefined;
    if (type === RESPAWN_TYPES.SPOT) {
      // В глубокой воде воскреснуть нельзя: игрок появился бы там, где
      // не тонет, но и выбраться без стамины не мог. Отказ с причиной
      // лучше молчаливого переноса в город — кнопка обещала место.
      if (isDeepWater(dead.position.x, dead.position.z)) {
        dead.busy = false;
        this.activePlayers.get(characterId)?.emit(SERVER_EVENTS.RESPAWN_ERROR, {
          reason: RESPAWN_REJECT.SPOT_BLOCKED,
        });
        return;
      }
      goldCost = spotRespawnCost(character.gold);
      spot = { x: dead.position.x, z: dead.position.z };
    }

    // Проверка баланса и списание — в одном UPDATE (CharacterService.respawn).
    // Денег не хватило: НИКАКОГО респавна, экран смерти остаётся, игрок
    // может выбрать город. Отдать ему бесплатное место «на месте» — значит
    // продавать респавн за 5% золота, не списывая их.
    const result = await this.characterService
      .respawn(characterId, { spot, goldCost })
      .catch((error: unknown) => {
        logger.error('Respawn failed:', error);
        return null;
      });
    if (!result) {
      // Запрос не прошёл. Снимаем флаг занятости И ПЕРЕЗВОДИМ ТАЙМЕР.
      //
      // ТУТ БЫЛА ДЫРА, ИЗ-ЗА КОТОРОЙ ИГРОК ОСТАВАЛСЯ МЁРТВЫМ НАВСЕГДА.
      // Рассуждение было такое: мол, таймер авто-возрождения ещё висит и
      // подстрахует. Но когда completeRespawn вызывает сам таймер, таймер к
      // этому моменту УЖЕ ИЗРАСХОДОВАН — он и привёл нас сюда. Значит, если
      // база кратко ответила ошибкой в момент авто-возрождения, повтора не
      // было: запись оставалась в deadPlayers, флаг снимался, и всё. Персонаж
      // мёртв, кнопки не помогают, таймера нет. Единственный выход —
      // перезайти, и это ровно та поломка, ради которой страховка и делалась.
      //
      // База может кратко отвалиться хоть на одну секунду, и это не должно
      // навсегда оставлять игрока на экране смерти.
      dead.busy = false;
      this.armAutoRespawn(characterId);
      this.activePlayers.get(characterId)?.emit(SERVER_EVENTS.RESPAWN_ERROR, {
        reason: RESPAWN_REJECT.NOT_DEAD,
      });
      return;
    }
    if (!result.ok) {
      if (result.reason === 'no_gold') {
        dead.busy = false;
        this.activePlayers.get(characterId)?.emit(SERVER_EVENTS.RESPAWN_ERROR, {
          reason: RESPAWN_REJECT.NO_GOLD,
          cost: goldCost,
          gold: character.gold,
        });
        return;
      }
      this.clearDeadState(characterId);
      return;
    }

    // Всё прошло: снимаем таймер (повторно он уже не сработает)
    this.clearDeadState(characterId);

    // Синк позиции в Redis: клиент телепортируется, и ИИ должен видеть
    // игрока там же, а не на месте смерти
    await this.redis.setPlayerPosition(characterId, result.position).catch(() => {});
    // Сбросить базовую точку античита на точку респавна — иначе первое
    // движение после возрождения выглядит как телепорт/speed_hack
    this.antiCheat.resetPosition(characterId, result.position);
    this.activePlayers.get(characterId)?.emit(SOCKET_EVENTS.PLAYER_RESPAWNED, {
      hp: result.hp,
      maxHp: result.maxHp,
      position: result.position,
      region: character.region,
      gold: result.gold,
      cost: goldCost,
      type,
      source,
    });

    logger.info(`Player respawned: ${character.name} (${type}, ${source}, cost ${goldCost})`);
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

  private async handleChatMessage(
    socket: AuthenticatedSocket,
    data: { message: string; channel: ChatChannel }
  ): Promise<void> {
    if (!socket.characterId || !socket.region) return;

    const sanitized = data.message.slice(0, CHAT_LIMITS.MAX_MESSAGE_LENGTH).trim();
    if (!sanitized) return;

    // Модерация: мьют и фильтр слов.
    //
    // ТУТ БЫЛА ДЫРА. AdminService.muteCharacter писал строку в character_mutes
    // и публиковал событие в Redis — а читать эту таблицу не был НИКТО.
    // Администратор мутил игрока, видел «успешно» в панели, и тот продолжал
    // писать в чат. Мьют был нарисован, но не существовал.
    const verdict = await this.chatModeration.screen(socket.characterId, sanitized)
      .catch(() => ({ action: 'allow' as const }));
    if (verdict.action === 'mute') {
      socket.emit('chat:error', {
        code: 'CHAT_MUTED',
        until: verdict.until.toISOString(),
      });
      return;
    }
    const outgoing = verdict.action === 'filter' ? verdict.text : sanitized;
    if (!outgoing.trim()) return;

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
      message: outgoing,
      timestamp: Date.now(),
    };

    // Отправителю говорим, что его сообщение изменили: иначе он увидит в
    // чате сообщение с цензурой и не поймёт, что произошло
    if (verdict.action === 'filter') {
      socket.emit('chat:error', { code: 'CHAT_FILTERED' });
    }

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
  /**
   * Вход в здание с проверкой правила входа.
   *
   * Обычный вход идёт безусловно - так работал всегда. Разделение на входы
   * касается только крепости: у неё три двери, и каждая требует своего.
   * Поле entrance необязательное специально: клиент в кэше браузера ещё
   * неделю будет старый, и он должен продолжать входить через ворота, а не
   * получать отказ по незнакомой причине.
   */
  private async handleInteriorEnter(
    socket: AuthenticatedSocket,
    buildingId: string | undefined,
    entranceId: string | undefined,
    ack?: (res: { ok: boolean; target?: { x: number; y: number; z: number }; reason?: string; deny?: string }) => void,
  ): Promise<void> {
    if (!buildingId || buildingId !== 'fortress' || !entranceId) {
      // handleInterior сам разбирается с отсутствующим id и ответит отказом,
      // поэтому здесь достаточно пустой строки вместо undefined.
      await this.handleInterior(socket, buildingId ?? '', 'enter', ack);
      return;
    }

    const вход = fortEntrance(entranceId);
    if (!вход) {
      ack?.({ ok: false, reason: 'unknown_entrance', deny: 'unknown' });
      return;
    }

    const characterId = socket.characterId;
    if (!characterId) {
      ack?.({ ok: false, reason: 'no_character' });
      return;
    }

    // Состояние для правила берём из проверенного античитом пакета движения.
    const где = this.stealthStates.get(characterId);
    // Золото берём из существующего getCharacterById: отдельного getGold в
    // проекте нет, а Character уже несёт поле gold.
    const золото = (await this.characterService.getCharacterById(characterId).catch(() => null))?.gold ?? 0;
    const отказ = checkEntrance(вход, {
      crouch: где?.crouch === true,
      spotted: где ? this.spottedGuards.get(characterId) != null : false,
      gold: золото,
    });
    if (отказ) {
      ack?.({ ok: false, reason: 'entrance_denied', deny: отказ });
      return;
    }

    // Рычаг оплачивается ЗДЕСЬ и только здесь: проверка прошла, значит золота
    // хватает. spendGold сам откатывает при нехватке (WHERE gold >= amount),
    // в отличие от addGold с отрицательным числом, который даёт ноль.
    if (вход.cost > 0) {
      const осталось = await this.characterService.spendGold(characterId, вход.cost).catch(() => 0);
      if (осталось <= 0 && золото >= вход.cost) {
        ack?.({ ok: false, reason: 'gold_spend_failed', deny: 'no_gold' });
        return;
      }
      socket.emit(SERVER_EVENTS.RESOURCES, { gold: осталось });
    }

    await this.handleInterior(socket, buildingId, 'enter', ack);
  }
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
    // Кэши скакуна: иначе после выхода и возврата игрок поехал бы со
    // старой скоростью, пока не обновится
    this.mountSpeeds.delete(socket.characterId);
    this.mountExpAt.delete(socket.characterId);
    // Отсрочка первого пакета — на одну сессию. Без удаления игрок,
    // вошедший в здании, получил бы её снова при следующем входе
    this.insideSpawnGrace.delete(socket.characterId);
    // Задержки чата тоже: иначе карта росла бы на каждого зашедшего игрока
    // и держала в памяти его id до перезапуска сервера
    this.chatLastSent.delete(socket.characterId);
    // Скрытность: без этого карта помнила бы каждого зашедшего игрока до
    // перезапуска. И то, кого страж уже заметил, - иначе вернувшийся игрок
    // считал бы себя заметным, пока не пришлёт следующий пакет движения.
    this.stealthStates.cleanup(socket.characterId);
    this.spottedGuards.delete(socket.characterId);
    this.defenseStates.cleanup(socket.characterId);
    this.antiCheat.cleanup(socket.characterId);
    // Состояние смерти здесь НЕ снимаем: страховочный таймер обязан
    // доработать и записать респавн в БД сам — иначе вышедший посреди
    // смерти вернулся бы в трупе (hp = 0) и не смог бы ничего сделать.
    // Успел переподключиться до таймера — респавн уйдёт в его новый сокет.
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
