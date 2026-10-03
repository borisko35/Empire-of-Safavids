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
  /** Подводное существо: рисуется на поверхности воды, а не под ней */
  aquatic?: boolean;
  /** Насколько тело поднято над водой (крупные — выше) */
  aquaticSize?: number;
  pos: Vec3;
  target: Vec3;

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

/**
 * Время сглаживания чужих тел, секунды.
 *
 * Чем меньше, тем точнее идёт объект за настоящей позицией и тем заметнее
 * дёргается на пакетах. 0.1 с даёт отставание примерно в шестую долю пути:
 * на скакуне (16 ед/с) это около 1.6 метра позади, что глазом не читается.
 */
const СГЛАЖИВАНИЕ_С = 0.1;

/**
 * Разрыв, который закрывается сразу: телепорт, воскрешение, появление из-за
 * края карты. Сглаживать такое бессмысленно — объект долго летел бы через
 * полкарты к своей настоящей позиции.
 */
const ЩЕЛЧОК_М = 6;

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
    // Сглаживание по времени, а НЕ ограничение скорости.
    //
    // Раньше чужие игроки догоняли настоящую позицию со скоростью 6 ед/с, а все
    // монстры — со вбитыми 3.5, при том что серверные скорости доходят до 8, а
    // скакун разгоняется до 16. При движении цели разрыв только накапливался:
    // объект уезжал дальше, чем клиент мог догнать.
    //
    // Здесь за кадр берётся доля расстояния до цели, независимо от её скорости,
    // поэтому отставание у движущегося объекта постоянное и небольшое, а большой
    // разрыв (телепорт, воскрешение, появление из-за края) закрывается сразу.
    const доля = 1 - Math.exp(-dt / СГЛАЖИВАНИЕ_С);
    const lerp = (pos: Vec3, target: Vec3) => {
      const dx = target.x - pos.x, dz = target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.02) { pos.x = target.x; pos.z = target.z; return false; }
      if (dist > ЩЕЛЧОК_М) { pos.x = target.x; pos.z = target.z; return true; }
      pos.x += dx * доля;
      pos.z += dz * доля;
      return true;
    };

    for (const p of this.players.values()) {
      if (p.isSelf) { p.moving = false; continue; }
      // Предела скорости здесь больше нет: чужие игроки едут так же быстро,
      // как едут на самом деле.
      p.moving = lerp(p.pos, p.target);
      if (p.target.x !== p.pos.x) p.flipped = p.target.x < p.pos.x;
    }
    for (const m of this.monsters.values()) {
      if (m.deadAt) continue;
      m.pos.y = m.target.y;
      lerp(m.pos, m.target);
    }

    this.floaters = this.floaters.filter((f) => now - f.born < 1100);
    this.floaters.forEach((f, i) => { f.y -= dt * (1.6 + i * 0); });
    this.effects = this.effects.filter((e) => now - e.born < 320);
  }
}
