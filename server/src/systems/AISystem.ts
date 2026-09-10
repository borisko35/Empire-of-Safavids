// ============================================================
// AI System — Поведение монстров — Empire of Safavids
// ============================================================

import { Vector3 } from '../types/game.types';
import { MonsterDefinition } from '../data/monsters';
import { logger } from '../utils/logger';

export type AIState =
  | 'idle'       // Стоит на месте
  | 'patrol'     // Патрулирует
  | 'chase'      // Преследует цель
  | 'attack'     // Атакует
  | 'retreat'    // Отступает (низкий HP)
  | 'call_help'  // Зовёт помощь
  | 'dead';

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
  lastTickAt?: number;                    // для расчёта dt серверного движения
}

export interface AIAction {
  type: 'move' | 'attack' | 'skill' | 'idle' | 'call_help' | 'flee';
  targetId?: string;
  skillId?: string;
  destination?: Vector3;
}

export class AISystem {
  private contexts = new Map<string, AIContext>();

  // ============================================================
  // Создание экземпляра монстра
  // ============================================================
  spawnMonster(definition: MonsterDefinition, position: Vector3): AIContext {
    const instanceId = `${definition.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Генерируем точки патруля вокруг спавна
    const patrolPoints = this.generatePatrolPoints(position, 15, 4);

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
    };

    this.contexts.set(instanceId, ctx);
    logger.debug(`[AI] Spawned ${definition.nameRu} (${instanceId}) at ${JSON.stringify(position)}`);
    return ctx;
  }

  // ============================================================
  // Главный тик ИИ (200мс)
  // ============================================================
  tick(instanceId: string, nearbyPlayers: { id: string; position: Vector3; hp: number }[]): AIAction {
    const ctx = this.contexts.get(instanceId);
    if (!ctx || ctx.state === 'dead') return { type: 'idle' };

    const now = Date.now();
    const hpPercent = ctx.currentHp / ctx.maxHp;

    // Обновляем аггро по ближайшим игрокам
    for (const player of nearbyPlayers) {
      const dist = this.distance(ctx.position, player.position);
      if (dist <= ctx.definition.aggroRange && !ctx.aggroTable.has(player.id)) {
        ctx.aggroTable.set(player.id, 0);
      }
    }

    // Смена состояния
    const newState = this.evaluateState(ctx, hpPercent, nearbyPlayers);
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
        ctx.position.x += (dx / dist) * step;
        ctx.position.z += (dz / dist) * step;
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
    players: { id: string; position: Vector3 }[]
  ): AIState {
    // Отступление при низком HP (только для обычных монстров)
    if (hpPercent < 0.15 && ctx.definition.type === 'normal') return 'retreat';

    // Зов помощи при 30% HP
    if (hpPercent < 0.30 && ctx.definition.type !== 'world_boss') return 'call_help';

    // Есть цель в аггро-таблице
    if (ctx.aggroTable.size > 0) {
      const topTarget = this.getTopThreatTarget(ctx);
      const player = players.find(p => p.id === topTarget);
      if (player) {
        const dist = this.distance(ctx.position, player.position);
        ctx.targetId = topTarget;
        ctx.targetPosition = player.position;
        return dist <= ctx.definition.attackRange ? 'attack' : 'chase';
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
    players: { id: string; position: Vector3; hp: number }[],
    now: number
  ): AIAction {
    switch (ctx.state) {
      case 'idle':
        return { type: 'idle' };

      case 'patrol': {
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
        // Выбираем навык для использования
        const skill = this.selectSkill(ctx, now);
        if (skill) {
          ctx.lastAttackTime[skill.id] = now;
          return { type: 'skill', targetId: ctx.targetId ?? undefined, skillId: skill.id };
        }
        // Базовая атака
        return { type: 'attack', targetId: ctx.targetId ?? undefined };
      }

      case 'retreat': {
        // Бежим от цели
        const fleeDir = ctx.targetPosition
          ? this.fleeDirection(ctx.position, ctx.targetPosition)
          : ctx.spawnPoint;
        return { type: 'flee', destination: fleeDir };
      }

      case 'call_help':
        return { type: 'call_help' };

      default:
        return { type: 'idle' };
    }
  }

  // ============================================================
  // Выбор навыка
  // ============================================================
  private selectSkill(ctx: AIContext, now: number) {
    const available = ctx.definition.skills.filter(skill => {
      const lastUsed = ctx.lastAttackTime[skill.id] ?? 0;
      return now - lastUsed >= skill.cooldown * 1000;
    });
    if (available.length === 0) return null;
    // Случайный выбор с весом по урону
    return available.sort((a, b) => b.damage - a.damage)[0];
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
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      return {
        x: center.x + Math.cos(angle) * radius * (0.5 + Math.random() * 0.5),
        y: center.y,
        z: center.z + Math.sin(angle) * radius * (0.5 + Math.random() * 0.5),
      };
    });
  }

  getContext(instanceId: string): AIContext | undefined {
    return this.contexts.get(instanceId);
  }

  getAllInstances(): AIContext[] {
    return Array.from(this.contexts.values());
  }
}
