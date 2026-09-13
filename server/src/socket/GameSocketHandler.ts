import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../utils/logger';
import { RedisService } from '../services/RedisService';
import { CharacterService } from '../services/CharacterService';
import { CombatService } from '../services/CombatService';
import { EquipmentCache } from '../services/EquipmentCache';
import { AntiCheatSystem } from '../systems/AntiCheatSystem';
import { KarmaSystem, PVP_ZONES } from '../systems/KarmaSystem';
import { QuestService } from '../services/QuestService';
import { GameLoop } from '../systems/GameLoop';
import { AIContext } from '../systems/AISystem';
import { DefenseStates } from '../systems/DefenseStates';
import { DungeonService } from '../systems/DungeonService';
import { WorldEventSystem } from '../systems/WorldEventSystem';
import { PartySystem } from '../systems/PartySystem';
import { LevelingSystem } from '../systems/LevelingSystem';
import { Character, CombatAction, Region } from '../types/game.types';
import { ITEMS_DATABASE } from '../data/items';
import { SOCKET_EVENTS, SERVER_EVENTS, REDIS_CHANNELS, CHAT_LIMITS } from '../../../shared/constants';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  characterId?: string;
  region?: Region;
}

type ChatChannel = 'world' | 'region' | 'guild' | 'party';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class GameSocketHandler {
  private static instance: GameSocketHandler | null = null;

  private io: SocketIOServer;
  private redis = RedisService.getInstance();
  private characterService = new CharacterService();
  private combatService = new CombatService();
  private antiCheat = new AntiCheatSystem();
  private karmaSystem = new KarmaSystem();
  private questService = new QuestService();
  private equipment = EquipmentCache.getInstance();
  private defenseStates = DefenseStates.getInstance();
  private dungeons = DungeonService.getInstance();
  private worldEvents = WorldEventSystem.getInstance();
  private partySystem = new PartySystem();

  // Активные игроки: characterId -> сокет
  private activePlayers = new Map<string, AuthenticatedSocket>();
  // Кулдауны навыков: characterId -> (skillId -> готовность с epoch ms)
  private skillCooldowns = new Map<string, Map<string, number>>();
  // Троттлинг записи позиции в PostgreSQL: characterId -> последняя запись
  private lastPositionPersist = new Map<string, number>();
  // Серия лёгких атак (комбо): characterId -> { count, lastAt }
  private comboChains = new Map<string, { count: number; lastAt: number }>();

  /** Широковещательное объявление мирового события (вызывается из GameLoop) */
  broadcastWorldEvent(payload: Record<string, unknown>): void {
    this.io.emit(SERVER_EVENTS.WORLD_EVENT, payload);
  }

  constructor(io: SocketIOServer) {
    this.io = io;
    GameSocketHandler.instance = this;
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
    const socket = this.activePlayers.get(characterId);
    if (socket) {
      socket.leave(`region:${oldRegion}`);
      socket.join(`region:${newRegion}`);
      socket.region = newRegion;
      socket.to(`region:${oldRegion}`).emit(SOCKET_EVENTS.PLAYER_LEFT, { characterId });
      // Позиция персонажа в новом регионе — текущая в мире (мир бесшовный)
      const character = await this.characterService.getCharacterById(characterId).catch(() => null);
      this.io.to(`region:${newRegion}`).emit(SOCKET_EVENTS.PLAYER_JOINED, {
        characterId,
        name: character?.name ?? '',
        class: character?.class ?? '',
        position: character?.position ?? { x: 0, y: 0, z: 0 },
      });
    }
    await this.redis.removePlayerFromRegion(oldRegion, characterId).catch(() => {});
    await this.redis.addPlayerToRegion(newRegion, characterId).catch(() => {});
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

      // Отключение
      socket.on('disconnect', async () => {
        await this.handleDisconnect(socket);
      });
    });

    // Регенерация ресурсов онлайн-игроков раз в 5 секунд (+ синк клиенту)
    this.regenTimer = setInterval(() => void this.regenTick(), 5000);
  }

  private regenTimer: NodeJS.Timeout | null = null;

  /** Медленная регенерация hp/маны/стамины онлайн-игроков + синк состояния */
  private async regenTick(): Promise<void> {
    for (const socket of this.activePlayers.values()) {
      if (!socket.characterId) continue;
      try {
        const res = await this.characterService.regenResources(socket.characterId);
        if (res) socket.emit(SERVER_EVENTS.RESOURCES, res);
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

    // Уведомления регионам
    for (const region of Object.values(Region)) {
      await this.redis.subscribe(REDIS_CHANNELS.REGION_NOTIFICATION(region), (msg) => {
        this.io.to(`region:${region}`).emit(SERVER_EVENTS.NOTIFICATION, msg);
      });

      // Спавн монстров и действия ИИ — клиентам региона
      await this.redis.subscribe(REDIS_CHANNELS.REGION_SPAWN(region), (msg) => {
        this.io.to(`region:${region}`).emit(SERVER_EVENTS.MONSTER_SPAWNED, msg);
      });
      await this.redis.subscribe(REDIS_CHANNELS.REGION_AI_ACTION(region), (msg) => {
        this.io.to(`region:${region}`).emit('monster:ai_action', msg);
      });
      await this.redis.subscribe(REDIS_CHANNELS.REGION_MONSTER_KILLED(region), (msg) => {
        this.io.to(`region:${region}`).emit(SERVER_EVENTS.MONSTER_KILLED, msg);
      });
      // Монстр ударил игрока: персональный COMBAT_HIT + визуал региону
      await this.redis.subscribe(REDIS_CHANNELS.REGION_MONSTER_HIT(region), (msg: Record<string, unknown>) => {
        const socket = this.activePlayers.get(String(msg.characterId));
        if (socket) {
          socket.emit(SOCKET_EVENTS.COMBAT_HIT, {
            attackerId: String(msg.instanceId),
            damage: Number(msg.damage),
            isDodged: false,
            isBlocked: false,
            hp: Number(msg.hp),
            maxHp: Number(msg.maxHp),
          });
        }
        this.io.to(`region:${region}`).emit(SOCKET_EVENTS.COMBAT_VISUAL, {
          attackerId: String(msg.instanceId),
          targetId: String(msg.characterId),
          actionType: 'attack',
        });
        if (msg.died) void this.handleDeathById(String(msg.characterId));
      });
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

      socket.userId = userId;
      socket.characterId = character.id;
      socket.region = character.region;

      // Присоединить к комнате региона
      socket.join(`region:${character.region}`);
      if (character.guildId) {
        socket.join(`guild:${character.guildId}`);
      }
      await this.redis.addPlayerToRegion(character.region, character.id);
      // Позиция в Redis сразу: иначе стоящий игрок невидим для ИИ,
      // пока клиент не пошлёт первый player:move
      await this.redis.setPlayerPosition(character.id, character.position).catch(() => {});
      this.activePlayers.set(character.id, socket);

      socket.emit(SOCKET_EVENTS.AUTH_SUCCESS, { character });

      // Снапшот активных монстров региона (заспавненных до входа игрока)
      const ai = GameLoop.getInstance().getSpawnSystem().getAI();
      for (const ctx of ai.getAllInstances()) {
        if (ctx.definition.region === character.region && ctx.state !== 'dead') {
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

      // Уведомить других игроков в регионе
      socket.to(`region:${character.region}`).emit(SOCKET_EVENTS.PLAYER_JOINED, {
        characterId: character.id,
        name: character.name,
        class: character.class,
        position: character.position,
      });

      logger.info(`Player authenticated: ${character.name} (${character.class}) in ${character.region}`);
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
      await this.punish(socket, 'speed_hack', moveCheck.reason ?? 'invalid movement', 2);
      socket.emit(SOCKET_EVENTS.MOVE_REJECTED, { reason: moveCheck.reason });
      return;
    }

    // Кэшировать позицию в Redis (быстро)
    await this.redis.setPlayerPosition(characterId, data.position);

    // В PostgreSQL пишем не чаще раза в 5 секунд (движение генерирует десятки пакетов/сек)
    const now = Date.now();
    if (now - (this.lastPositionPersist.get(characterId) ?? 0) > 5000) {
      this.lastPositionPersist.set(characterId, now);
      await this.characterService.updatePosition(characterId, data.position).catch(() => {});
    }

    // Транслировать другим игрокам в регионе
    socket.to(`region:${socket.region}`).emit(SOCKET_EVENTS.PLAYER_MOVED, {
      characterId,
      position: data.position,
      direction: data.direction,
      timestamp: now,
    });
  }

  // ============================================================
  // Бой: ресурсы, кулдауны, лечение, урон, смерть, карма
  // ============================================================

  /** Персонаж с учётом боевых бонусов экипировки (копия статов) */
  private async withEquipment(character: Character): Promise<Character> {
    const stats = await this.equipment.mergeInto(character);
    return { ...character, stats };
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
      socket.to(`region:${socket.region}`).emit(SOCKET_EVENTS.COMBAT_VISUAL, {
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
    result.damage = Math.floor(result.damage * defenseMult);

    if (result.isDodged) {
      socket.emit(SOCKET_EVENTS.COMBAT_RESULT, { attackerId: attacker.id, targetId: target.id, ...result });
      return;
    }

    // Анти-чит: слишком большой урон
    const damageCheck = this.antiCheat.validateDamage(
      attacker.id, result.damage, this.combatService.getBaseDamageFor(attacker)
    );
    if (!damageCheck.valid) {
      await this.antiCheat.recordViolation(attacker.id, 'damage_hack', damageCheck.reason ?? 'damage hack', 3);
      this.forceDisconnect(attacker.id, 'Анти-чит: damage hack');
      return;
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

    socket.to(`region:${socket.region}`).emit(SOCKET_EVENTS.COMBAT_VISUAL, {
      attackerId: attacker.id, targetId: target.id, actionType: action.actionType, skillId: action.skillId, position: action.position,
    });

    if (applied.died) {
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
    if (result.isDodged) {
      socket.emit(SOCKET_EVENTS.COMBAT_RESULT, { attackerId: attacker.id, targetId: monsterCtx.instanceId, ...result });
      return;
    }

    const damageCheck = this.antiCheat.validateDamage(
      attacker.id, result.damage, this.combatService.getBaseDamageFor(attacker)
    );
    if (!damageCheck.valid) {
      await this.antiCheat.recordViolation(attacker.id, 'damage_hack', damageCheck.reason ?? 'damage hack', 3);
      this.forceDisconnect(attacker.id, 'Анти-чит: damage hack');
      return;
    }

    const ai = GameLoop.getInstance().getSpawnSystem().getAI();
    const died = ai.takeDamage(monsterCtx.instanceId, result.damage, attacker.id);

    socket.emit(SOCKET_EVENTS.COMBAT_RESULT, {
      attackerId: attacker.id, targetId: monsterCtx.instanceId, ...result,
      targetHp: Math.max(0, monsterCtx.currentHp),
      targetMaxHp: monsterCtx.maxHp,
      comboFinisher: comboMult > 1,
    });

    socket.to(`region:${socket.region}`).emit(SOCKET_EVENTS.COMBAT_VISUAL, {
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
        await this.worldEvents.onBossDefeated(attacker.id).catch((e: unknown) => {
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
      }

      await this.redis.publish(REDIS_CHANNELS.REGION_MONSTER_KILLED(attacker.region), {
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
    const partyId = await this.redis.get(`player:party:${attacker.id}`);
    if (!partyId) return;

    const party = await this.partySystem.getPartyInfo(partyId);
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
    await this.redis.setPlayerPosition(dead.id, { x: 0, y: 0, z: 0 }).catch(() => {});
    deadSocket?.emit(SOCKET_EVENTS.PLAYER_RESPAWNED, {
      hp: respawned.hp,
      maxHp: respawned.maxHp,
      position: { x: 0, y: 0, z: 0 },
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
  private handleChatMessage(
    socket: AuthenticatedSocket,
    data: { message: string; channel: ChatChannel }
  ): void {
    if (!socket.characterId || !socket.region) return;

    const sanitized = data.message.slice(0, CHAT_LIMITS.MAX_MESSAGE_LENGTH).trim();
    if (!sanitized) return;

    const payload = {
      characterId: socket.characterId,
      message: sanitized,
      timestamp: Date.now(),
    };

    switch (data.channel) {
      case 'world':
        this.io.emit(SOCKET_EVENTS.CHAT_WORLD, payload);
        break;
      case 'region':
        this.io.to(`region:${socket.region}`).emit(SOCKET_EVENTS.CHAT_REGION, payload);
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
        void this.broadcastPartyChat(socket, payload);
        break;
      default:
        socket.emit(SOCKET_EVENTS.CHAT_REGION, payload);
    }
  }

  private async broadcastPartyChat(
    socket: AuthenticatedSocket,
    payload: { characterId: string; message: string; timestamp: number }
  ): Promise<void> {
    const partyId = await this.redis.get(`player:party:${socket.characterId}`);
    if (!partyId) {
      socket.emit('chat:error', { message: 'You are not in a party' });
      return;
    }
    this.io.to(`party:${partyId}`).emit(SOCKET_EVENTS.CHAT_PARTY, payload);
  }

  // ============================================================
  // Санкции и отключение
  // ============================================================
  private async punish(
    socket: AuthenticatedSocket,
    type: 'speed_hack' | 'packet_flood' | 'teleport',
    details: string,
    severity: 1 | 2 | 3
  ): Promise<void> {
    if (!socket.characterId) return;
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
    this.comboChains.delete(socket.characterId);
    this.defenseStates.cleanup(socket.characterId);
    this.antiCheat.cleanup(socket.characterId);
    await this.redis.removePlayerFromRegion(socket.region, socket.characterId);

    // Вышедший игрок пропадает из поля зрения монстров навсегда
    GameLoop.getInstance().getSpawnSystem().getAI().clearThreatAndReturn(socket.characterId);

    socket.to(`region:${socket.region}`).emit(SOCKET_EVENTS.PLAYER_LEFT, {
      characterId: socket.characterId,
    });

    logger.info(`Player disconnected: ${socket.characterId}`);
  }
}
