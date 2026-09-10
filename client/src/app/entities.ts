// ============================================================
// Сущности мира — Empire of Safavids
// ============================================================

import { Vec3 } from './state';

export interface PlayerEntity {
  id: string;
  name: string;
  charClass: string;
  pos: Vec3;          // отображаемая (интерполированная) позиция
  target: Vec3;       // последняя позиция с сервера
  moving: boolean;
  seed: number;
  flipped: boolean;
  isSelf?: boolean;   // своего игрока не интерполируем — им управляем напрямую
}

export interface MonsterEntity {
  instanceId: string;
  monsterId: string;
  nameRu: string;
  type: string;
  pos: Vec3;
  target: Vec3;
  speed: number;      // скорость интерполяции (юнитов/сек)
  hp: number;
  maxHp: number;
  deadAt: number;     // время смерти (для анимации), 0 — жив
  seed: number;
}

export interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  born: number;
  crit: boolean;
}

export interface Effect {
  x1: number; y1: number; x2: number; y2: number;
  kind: 'slash' | 'heal' | 'hit';
  born: number;
  color: string;
}

/** Детерминированный псевдослучайный хэш для декора тайлов */
export function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

export class World {
  players = new Map<string, PlayerEntity>();
  monsters = new Map<string, MonsterEntity>();
  floaters: Floater[] = [];
  effects: Effect[] = [];
  /** Стрельба/удары, цели которых не найдены, всё равно рисуются по координатам */
  targetId: string | null = null;

  addFloater(x: number, y: number, text: string, color: string, crit = false): void {
    this.floaters.push({ x, y, text, color, born: performance.now(), crit });
    if (this.floaters.length > 60) this.floaters.shift();
  }

  addEffect(kind: Effect['kind'], x1: number, y1: number, x2: number, y2: number, color = '#F4D26C'): void {
    this.effects.push({ kind, x1, y1, x2, y2, born: performance.now(), color });
    if (this.effects.length > 40) this.effects.shift();
  }

  update(dt: number): void {
    const now = performance.now();
    const lerp = (pos: Vec3, target: Vec3, speed: number) => {
      const dx = target.x - pos.x, dz = target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) { pos.x = target.x; pos.z = target.z; return false; }
      const step = Math.min(dist, speed * dt);
      pos.x += (dx / dist) * step;
      pos.z += (dz / dist) * step;
      return true;
    };

    for (const p of this.players.values()) {
      if (p.isSelf) { p.moving = false; continue; }
      p.moving = lerp(p.pos, p.target, 6);
      if (p.target.x !== p.pos.x) p.flipped = p.target.x < p.pos.x;
    }
    for (const m of this.monsters.values()) {
      if (m.deadAt) continue;
      m.pos.y = m.target.y;
      lerp(m.pos, m.target, m.speed);
    }

    this.floaters = this.floaters.filter((f) => now - f.born < 1100);
    this.floaters.forEach((f, i) => { f.y -= dt * (1.6 + i * 0); });
    this.effects = this.effects.filter((e) => now - e.born < 320);
  }
}
