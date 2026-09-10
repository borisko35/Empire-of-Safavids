import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../utils/logger';
import { RedisService } from '../services/RedisService';
import { CharacterService } from '../services/CharacterService';
import { CombatService } from '../services/CombatService';
import { AntiCheatSystem } from '../systems/AntiCheatSystem';
import { KarmaSystem, PVP_ZONES } from '../systems/KarmaSystem';
import { GameLoop } from '../systems/GameLoop';
import { AIContext } from '../systems/AISystem';
import { Character, CombatAction, Region } from '../types/game.types';
import { SOCKET_EVENTS, SERVER_EVENTS, REDIS_CHANNELS, CHAT_LIMITS } from '../../../shared/constants';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  characterId?: string;
  region?: Region;
}

type ChatChannel = 'world' | 'region' | 'guild' | 'party';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class GameSocketHandler {
  private io: SocketIOServer;
  private redis = RedisService.getInstance();
  private characterService = new CharacterService();
  private combatService = new CombatService();
  private antiCheat = new AntiCheatSystem();
  private karmaSystem = new KarmaSystem();

  // Активные игроки: characterId -> сокет
  private activePlayers = new Map<string, AuthenticatedSocket>();
  // Кулдауны навыков: characterId -> (skillId -> готовность с epoch ms)
  private skillCooldowns = new Map<string, Map<string, number>>();
  // Троттлинг записи позиции в PostgreSQL: characterId -> последняя запись
  private lastPositionPersist = new Map<string, number>();

  constructor(io: SocketIOServer) {
    this.io = io;
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
  private async handleCombatAction(socket: AuthenticatedSocket, action: CombatAction): Promise<void> {
    if (!socket.characterId || !socket.region) return;
    if (!action.targetId) return;

    try {
      const attacker = await this.characterService.getCharacterById(socket.characterId);
      if (!attacker) return;

      // Частота боевых пакетов
      const rateCheck = this.antiCheat.validatePacketRate(attacker.id);
      if (!rateCheck.valid) {
        await this.punish(socket, 'packet_flood', rateCheck.reason ?? 'packet flood', 2);
        return;
      }

      // Проверка навыка и кулдауна
      const skill = action.skillId
        ? this.combatService.getSkill(attacker.class, action.skillId)
        : undefined;
      if (action.skillId && !skill) {
        socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { message: 'Unknown skill' });
        return;
      }
      if (skill && !this.checkCooldown(attacker.id, skill.id, skill.cooldown)) {
        socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { message: 'Skill is on cooldown', skillId: skill.id });
        return;
      }

      // Ресурсы: мана/стамина
      if (skill) {
        const ok = await this.characterService.spendResources(attacker.id, skill.manaCost, skill.staminaCost);
        if (!ok) {
          socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { message: 'Not enough mana or stamina', skillId: skill.id });
          return;
        }
      }

      // Цель — игрок? (id монстров не UUID — сразу ищем ИИ-контекст)
      if (UUID_RE.test(action.targetId)) {
        const target = await this.characterService.getCharacterById(action.targetId);
        if (target) {
          await this.combatPlayerVsPlayer(socket, attacker, target, action);
          return;
        }
      }

      // Цель — монстр?
      const monsterCtx = GameLoop.getInstance().getSpawnSystem().getAI().getContext(action.targetId);
      if (monsterCtx) {
        await this.combatPlayerVsMonster(socket, attacker, monsterCtx, action);
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
    action: CombatAction
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

    const result = this.combatService.calculateDamage(attacker, target, action);

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
    action: CombatAction
  ): Promise<void> {
    if (monsterCtx.state === 'dead') return;

    // Лечение монстра недопустимо
    if (action.skillId && this.combatService.isHealSkill(attacker.class, action.skillId)) {
      socket.emit(SOCKET_EVENTS.COMBAT_ERROR, { message: 'Cannot heal a monster' });
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

    const result = this.combatService.calculateDamage(attacker, monsterAsCharacter, action);
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
    });

    socket.to(`region:${socket.region}`).emit(SOCKET_EVENTS.COMBAT_VISUAL, {
      attackerId: attacker.id, targetId: monsterCtx.instanceId, actionType: action.actionType, skillId: action.skillId, position: action.position,
    });

    if (died) {
      // Начисляем награду убийце
      const reward = await this.characterService.addExperience(attacker.id, monsterCtx.definition.expReward);
      GameLoop.getInstance().getSpawnSystem().onInstanceDeath(monsterCtx.instanceId);

      await this.redis.publish(REDIS_CHANNELS.REGION_MONSTER_KILLED(attacker.region), {
        instanceId: monsterCtx.instanceId,
        monsterId: monsterCtx.definition.id,
        killerId: attacker.id,
        expReward: monsterCtx.definition.expReward,
        leveledUp: reward.leveledUp,
        newLevel: reward.newLevel,
      }).catch(() => {});
    }
  }

  /** Смерть игрока: респавн на стартовой точке региона + карма убийце */
  private async handlePlayerDeath(dead: Character, killer?: Character): Promise<void> {
    const deadSocket = this.activePlayers.get(dead.id);
    deadSocket?.emit(SOCKET_EVENTS.PLAYER_DIED, { killerId: killer?.id });

    const respawned = await this.characterService.respawn(dead.id);
    deadSocket?.emit(SOCKET_EVENTS.PLAYER_RESPAWNED, {
      hp: respawned.hp,
      maxHp: respawned.maxHp,
      position: { x: 0, y: 0, z: 0 },
      region: dead.region,
    });

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
    this.antiCheat.cleanup(socket.characterId);
    await this.redis.removePlayerFromRegion(socket.region, socket.characterId);

    socket.to(`region:${socket.region}`).emit(SOCKET_EVENTS.PLAYER_LEFT, {
      characterId: socket.characterId,
    });

    logger.info(`Player disconnected: ${socket.characterId}`);
  }
}
