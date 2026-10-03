// ============================================================
// AI System — Поведение монстров — Empire of Safavids
// ============================================================

import { Vector3 } from '../types/game.types';
import { MonsterDefinition } from '../data/monsters';
import { logger } from '../utils/logger';
import { isDeepWater } from '../utils/spawn';

export type AIState =
  | 'idle'       // Стоит на месте
  | 'patrol'     // Патрулирует
  | 'chase'      // Преследует цель
  | 'attack'     // Атакует
  | 'retreat'    // Отступает (низкий HP)
  | 'call_help'  // Зовёт помощь
  | 'dead';

/** Игрок, видимый ИИ: позиция, здоровье и признак «сидит в лодке» */
export interface TargetPlayer {
  id: string;
  position: Vector3;
  hp: number;
  /** В лодке: подводные существа игнорируют таких (см. tick) */
  inBoat?: boolean;
  /**
   * Карма враждебна: «красный» и «изгой» пахнут кровью, и монстр замечает их
   * дальше, чем мирных. Признак считается из кармы в GameLoop по таблице
   * последствий KARMA_PENALTIES — здесь он уже готовым флагом.
   */
  npcHostile?: boolean;
}

export interface AIContext {
  monsterId: string;
  instanceId: string;       // уникальный ID экземпляра
  definition: MonsterDefinition;
  position: Vector3;
  spawnPoint: Vector3;
  currentHp: number;
  maxHp: number;
  state: AIState;
  targetId: string | null;
  targetPosition: Vector3 | null;
  patrolPoints: Vector3[];
  patrolIndex: number;
  lastAttackTime: Record<string, number>; // skillId -> timestamp
  aggroTable: Map<string, number>;        // characterId -> threat
  lastStateChange: number;
  /** Игровой сервер (шард), в котором живёт экземпляр */
  shardId: string;
  lastTickAt?: number;                    // для расчёта dt серверного движения
}

export interface AIAction {
  type: 'move' | 'attack' | 'skill' | 'idle' | 'call_help' | 'flee';
  targetId?: string;
  skillId?: string;
  destination?: Vector3;
}

/**
 * Во сколько раз монстр замечает враждебного игрока дальше мирного.
 *
 * Два, а не полтора: при aggroRange 18-20 в мире это 36-40 единиц против
 * 18-20. Разница заметна, но не превращает лес в место, где на красного
 * бегут со всего региона. Проверяется числом в karmaNpcHostile.test.ts.
 */
export const NPC_HUNT_RANGE_MULTIPLIER = 2;

export class AISystem {
  private contexts = new Map<string, AIContext>();

  // ============================================================
  // Создание экземпляра монстра
  // ============================================================
  spawnMonster(definition: MonsterDefinition, position: Vector3, shardId = "isfahan"): AIContext {
    const instanceId = `${definition.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Генерируем точки патруля вокруг спавна
    const patrolPoints = definition.aquatic
      ? this.generateWaterPatrolPoints(position, 25, 4)
      : this.generatePatrolPoints(position, 15, 4);

    const ctx: AIContext = {
      monsterId: definition.id,
      instanceId,
      definition,
      position: { ...position },
      spawnPoint: { ...position },
      currentHp: definition.hp,
      maxHp: definition.hp,
      state: 'patrol',
      targetId: null,
      targetPosition: null,
      patrolPoints,
      patrolIndex: 0,
      lastAttackTime: {},
      aggroTable: new Map(),
      lastStateChange: Date.now(),
      shardId,
    };

    this.contexts.set(instanceId, ctx);
    logger.debug(`[AI] Spawned ${definition.nameRu} (${instanceId}) at ${JSON.stringify(position)}`);
    return ctx;
  }

  // ============================================================
  // Главный тик ИИ (200мс)
  // ============================================================
  tick(instanceId: string, nearbyPlayers: TargetPlayer[]): AIAction {
    const ctx = this.contexts.get(instanceId);
    if (!ctx || ctx.state === 'dead') return { type: 'idle' };

    const now = Date.now();
    const hpPercent = ctx.currentHp / ctx.maxHp;
    const aquatic = ctx.definition.aquatic === true;

    // Подводное существо охотится только на того, кто в воде. Стоящий на
    // берегу для него невидим, а уехавший на лодке — в безопасности:
    // иначе покупка лодки ничего не давала бы в самом опасном месте.
    if (aquatic) {
      for (const [id] of ctx.aggroTable) {
        const p = nearbyPlayers.find(x => x.id === id);
        if (!p || !isDeepWater(p.position.x, p.position.z) || p.inBoat) {
          ctx.aggroTable.delete(id);
        }
      }
    }

    // Обновляем аггро по ближайшим игрокам
    for (const player of nearbyPlayers) {
      if (aquatic && (!isDeepWater(player.position.x, player.position.z) || player.inBoat)) continue;
      const dist = this.distance(ctx.position, player.position);
      // Живое последствие кармы: враждебного замечают издалека.
      const дальность = player.npcHostile
        ? ctx.definition.aggroRange * NPC_HUNT_RANGE_MULTIPLIER
        : ctx.definition.aggroRange;
      if (dist <= дальность && !ctx.aggroTable.has(player.id)) {
        ctx.aggroTable.set(player.id, 0);
      }
    }

    // Смена состояния
    const newState = this.evaluateState(ctx, hpPercent, nearbyPlayers, now);
    if (newState !== ctx.state) {
      ctx.state = newState;
      ctx.lastStateChange = now;
    }

    const action = this.executeState(ctx, nearbyPlayers, now);

    // Серверное движение: монстр реально приближается к цели.
    // Без этого позиция ИИ остаётся на спавне, и проверки дальности
    // атаки никогда не проходят (монстр «догоняет» только на клиентах).
    if (action.destination) {
      const dt = Math.min(3, (now - (ctx.lastTickAt ?? now)) / 1000);
      const dx = action.destination.x - ctx.position.x;
      const dz = action.destination.z - ctx.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.4) {
        const step = Math.min(dist, ctx.definition.moveSpeed * dt);
        const nx = ctx.position.x + (dx / dist) * step;
        const nz = ctx.position.z + (dz / dist) * step;
        // Сухопутный монстр не лезет в глубокую воду: если шаг уводит
        // в озеро, а сами мы ещё на суше — стоим у кромки. Если уже
        // в воде (например, загнали) — даём выбраться.
        // Подводное — наоборот: не вылезает на берег, а если всё же
        // оказалось на суше (вытащило течением, спавн сухопутный) —
        // возвращается в воду, иначе оно «зависало» бы на берегу.
        if (aquatic) {
          if (isDeepWater(nx, nz)) {
            ctx.position.x = nx;
            ctx.position.z = nz;
          } else if (!isDeepWater(ctx.position.x, ctx.position.z)) {
            ctx.position.x = ctx.spawnPoint.x;
            ctx.position.z = ctx.spawnPoint.z;
          }
        } else if (!isDeepWater(nx, nz) || isDeepWater(ctx.position.x, ctx.position.z)) {
          ctx.position.x = nx;
          ctx.position.z = nz;
        }
      }
    }
    ctx.lastTickAt = now;

    return action;
  }

  // ============================================================
  // Оценка состояния
  // ============================================================
  private evaluateState(
    ctx: AIContext,
    hpPercent: number,
    players: TargetPlayer[],
    // Время нужно ради готовности навыков: состояние боя начинается на
    // расстоянии того из них, что сейчас не на перезарядке.
    now: number
  ): AIState {
    const aquatic = ctx.definition.aquatic === true;
    // Подводное существо не отступает на сушу: там ему некуда деваться
    if (hpPercent < 0.15 && ctx.definition.type === 'normal' && !aquatic) return 'retreat';

    // Зов помощи при 30% HP
    if (hpPercent < 0.30 && ctx.definition.type !== 'world_boss' && !aquatic) return 'call_help';

    // Есть цель в аггро-таблице
    if (ctx.aggroTable.size > 0) {
      const topTarget = this.getTopThreatTarget(ctx);
      const player = players.find(p => p.id === topTarget);
      if (player) {
        const dist = this.distance(ctx.position, player.position);
        ctx.targetId = topTarget;
        ctx.targetPosition = player.position;
        // Бой начинается на расстоянии самого дальнего ГОТОВОГО навыка, а не
        // его полной дальности: как только способность ушла на перезарядку,
        // монстр должен сближаться. Раньше здесь стоял только attackRange (2 у
        // всех монстров), и дальности навыков в данных не значили ничего:
        // «Петля» с 8 метров и «Буря Горизонта» с 12 срабатывали вплотную.
        const дистанцияБоя = Math.max(ctx.definition.attackRange, this.maxSkillRange(ctx, now));
        return dist <= дистанцияБоя ? 'attack' : 'chase';
      }
    }

    // Возвращаемся на патруль, если ушли далеко
    const distFromSpawn = this.distance(ctx.position, ctx.spawnPoint);
    if (distFromSpawn > ctx.definition.aggroRange * 2) {
      ctx.targetId = null;
      ctx.aggroTable.clear();
      return 'patrol';
    }

    return ctx.patrolPoints.length > 0 ? 'patrol' : 'idle';
  }

  // ============================================================
  // Выполнение состояния
  // ============================================================
  private executeState(
    ctx: AIContext,
    _players: TargetPlayer[],
    now: number
  ): AIAction {
    switch (ctx.state) {
      case 'idle':
        return { type: 'idle' };

      case 'patrol': {
        if (ctx.patrolPoints.length === 0) return { type: 'idle' };
        const target = ctx.patrolPoints[ctx.patrolIndex];
        if (this.distance(ctx.position, target) < 1.5) {
          ctx.patrolIndex = (ctx.patrolIndex + 1) % ctx.patrolPoints.length;
        }
        return { type: 'move', destination: target };
      }

      case 'chase':
        return ctx.targetPosition
          ? { type: 'move', destination: ctx.targetPosition }
          : { type: 'idle' };

      case 'attack': {
        // Цель нужна для расстояния: навык выбирается под дистанцию, а не
        // «какой сильнее».
        const игрок = _players.find(p => p.id === ctx.targetId);
        const дистанция = игрок
          ? this.distance(ctx.position, игрок.position)
          : ctx.definition.attackRange;
        const skill = this.selectSkill(ctx, now, дистанция);
        if (skill) {
          ctx.lastAttackTime[skill.id] = now;
          return { type: 'skill', targetId: ctx.targetId ?? undefined, skillId: skill.id };
        }
        // Базовая атака — только вплотную. Если не достаёт ничем, монстр
        // сближается, а не бьёт через полкарты: иначе «Петля» на перезарядке
        // превращалась бы в удар кулаком с двенадцати метров.
        if (дистанция <= ctx.definition.attackRange) {
          return { type: 'attack', targetId: ctx.targetId ?? undefined };
        }
        return ctx.targetPosition
          ? { type: 'move', destination: ctx.targetPosition }
          : { type: 'idle' };
      }

      case 'retreat': {
        // Бежим от цели
        const fleeDir = ctx.targetPosition
          ? this.fleeDirection(ctx.position, ctx.targetPosition)
          : ctx.spawnPoint;
        return { type: 'flee', destination: fleeDir };
      }

      case 'call_help':
        // Звать помощь, но не стоять столбом: отходим к спавну. Раньше у
        // этого состояния не было destination, монстр замирал на месте
        // до самого боя — в том числе посреди воды.
        return { type: 'call_help', destination: ctx.spawnPoint };

      default:
        return { type: 'idle' };
    }
  }

  // ============================================================
  // Выбор навыка
  // ============================================================
  private selectSkill(ctx: AIContext, now: number, расстояние: number) {
    // Монстр без навыков — законное состояние: запасной удар для такого
    // монстра собирается отдельно, и раньше выбор навыков просто не
    // выполнялся. Читаем список один раз и подстраховываемся пустым.
    const available = (ctx.definition.skills ?? []).filter(skill => {
      const lastUsed = ctx.lastAttackTime[skill.id] ?? 0;
      if (now - lastUsed < skill.cooldown * 1000) return false;
      // Навык, который не достаёт до цели, не применяется: монстр не бьёт
      // «Петлёй» через полкарты, он подходит ближе.
      return расстояние <= skill.range;
    });
    if (available.length === 0) return null;
    if (available.length === 1) return available[0];

    // Случайный выбор с весом по урону — ровно то, что обещал комментарий до
    // него: код брал самый сильный из готовых, и разнообразия не было вовсе.
    //
    // Вес не меньше единицы: у части способностей урон равен нулю (клич, рык,
    // призыв), и при весе ровно по урону они выпадали бы с вероятностью ноль, то
    // есть поле снова стало бы мёртвым. Рык весит 1 и выпадает редко.
    let суммаВесов = 0;
    for (const skill of available) суммаВесов += this.весНавыка(skill);
    let roll = Math.random() * суммаВесов;
    for (const skill of available) {
      roll -= this.весНавыка(skill);
      if (roll <= 0) return skill;
    }
    // Сумма весов и roll одного порядка, но из-за округления дробей кубик мог
    // не выпасть ни на одном: тогда берётся первый готовый.
    return available[0];
  }

  /**
   * Вес способности при случайном выборе: урон, но не меньше единицы.
   *
   * Единица нужна способностям без урона (клич, рык, призыв): при весе ноль они
   * не выпадали бы никогда, и данные снова были бы мёртвыми.
   */
  private весНавыка(skill: { damage: number }): number {
    return Math.max(1, Number(skill.damage) || 0);
  }

  /**
   * Дальность самого далёкого навыка, который сейчас не на перезарядке.
   *
   * Если готовых навыков нет, возвращается ноль — и монстр идёт вплотную,
   потому что иначе с навыком на перезарядке он бил бы издалека.
   */
  private maxSkillRange(ctx: AIContext, now: number): number {
    let дальность = 0;
    // Пустой список — не ошибка: у монстра просто нет способностей, и он
    // дерётся вплотную базовой атакой.
    for (const skill of ctx.definition.skills ?? []) {
      const lastUsed = ctx.lastAttackTime[skill.id] ?? 0;
      if (now - lastUsed >= skill.cooldown * 1000 && skill.range > дальность) {
        дальность = skill.range;
      }
    }
    return дальность;
  }

  // ============================================================
  // Вспомогательные методы
  // ============================================================
  addThreat(instanceId: string, characterId: string, amount: number): void {
    const ctx = this.contexts.get(instanceId);
    if (!ctx) return;
    const current = ctx.aggroTable.get(characterId) ?? 0;
    ctx.aggroTable.set(characterId, current + amount);
  }

  /**
   * Игрок умер или вышел: монстры забывают его и возвращаются на спавн.
   * Без этого аггро висит вечно, и ИИ добивает игрока после каждого
   * респавна (death-loop), в том числе уже офлайн.
   */
  clearThreatAndReturn(characterId: string): void {
    for (const ctx of this.contexts.values()) {
      if (!ctx.aggroTable.has(characterId)) continue;
      ctx.aggroTable.delete(characterId);
      if (ctx.targetId === characterId) {
        ctx.targetId = null;
        ctx.targetPosition = null;
      }
      if (ctx.aggroTable.size === 0) {
        ctx.position = { ...ctx.spawnPoint };
        ctx.state = 'patrol';
      }
    }
  }

  takeDamage(instanceId: string, damage: number, attackerId: string): boolean {
    const ctx = this.contexts.get(instanceId);
    if (!ctx || ctx.state === 'dead') return false;
    ctx.currentHp = Math.max(0, ctx.currentHp - damage);
    this.addThreat(instanceId, attackerId, damage);
    if (ctx.currentHp === 0) {
      ctx.state = 'dead';
      this.contexts.delete(instanceId);
      return true; // монстр погиб
    }
    return false;
  }

  private getTopThreatTarget(ctx: AIContext): string {
    let top = '';
    let maxThreat = -1;
    for (const [id, threat] of ctx.aggroTable) {
      if (threat > maxThreat) { maxThreat = threat; top = id; }
    }
    return top;
  }

  private distance(a: Vector3, b: Vector3): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
  }

  private fleeDirection(from: Vector3, threat: Vector3): Vector3 {
    const dx = from.x - threat.x;
    const dz = from.z - threat.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    return { x: from.x + (dx / len) * 20, y: from.y, z: from.z + (dz / len) * 20 };
  }

  private generatePatrolPoints(center: Vector3, radius: number, count: number): Vector3[] {
    // Точки патруля — только на суше. Иначе разбойник выбирал маршрут
    // через озеро, уходил в воду и там замирал.
    const points: Vector3[] = [];
    for (let i = 0; points.length < count && i < count * 10; i++) {
      const angle = (points.length / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.9;
      const r = radius * (0.5 + Math.random() * 0.5);
      const p = {
        x: center.x + Math.cos(angle) * r,
        y: center.y,
        z: center.z + Math.sin(angle) * r,
      };
      if (isDeepWater(p.x, p.z)) continue;
      points.push(p);
    }
    return points;
  }

  /**
   * Точки патруля подводного существа — только в глубокой воде.
   * Обратная задача generatePatrolPoints: там точки ищутся на суше,
   * потому что сухопутный монстр не умеет плавать.
   */
  private generateWaterPatrolPoints(center: Vector3, radius: number, count: number): Vector3[] {
    const points: Vector3[] = [];
    for (let i = 0; points.length < count && i < count * 20; i++) {
      const angle = (points.length / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.9;
      const r = radius * (0.4 + Math.random() * 0.6);
      const p = {
        x: center.x + Math.cos(angle) * r,
        y: center.y,
        z: center.z + Math.sin(angle) * r,
      };
      if (!isDeepWater(p.x, p.z)) continue;
      points.push(p);
    }
    // Если вокруг спавна мелко (озеро небольшое), патрулируем хотя бы
    // вокруг самой точки — иначе существо стояло бы столбом
    return points.length ? points : [{ ...center }];
  }

  getContext(instanceId: string): AIContext | undefined {
    return this.contexts.get(instanceId);
  }

  /** Убрать инстанс монстра из мира (деспавн данжевых монстров) */
  removeInstance(instanceId: string): void {
    this.contexts.delete(instanceId);
  }

  getAllInstances(): AIContext[] {
    return Array.from(this.contexts.values());
  }
}
