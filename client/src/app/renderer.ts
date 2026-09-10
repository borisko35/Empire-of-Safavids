// ============================================================
// Canvas-рендер мира — Empire of Safavids
// ============================================================
// Тайлы 32px, масштаб 2 (пиксель-арт без сглаживания), 1 юнит = 48px.

import { MonsterEntity, PlayerEntity, World, tileHash } from './entities';
import { monsterBase, spr, walkFrame } from './sprites';

const GROUND_PX = 512;    // размер бесшовной текстуры земли (device px)
const DECOR_CELL = 180;   // клетка размещения декора (device px)
const SPRITE_BASE = 64;   // размер спрайта (64x64, рисованный стиль)
const ENTITY_SCALE = 1.5; // спрайт 64px -> 96px на экране
const UNIT = 24;          // экранных пикселей (buffer) в 1 игровом юните

interface Camera { x: number; y: number }

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private cam: Camera = { x: 0, y: 0 };

  constructor(private canvas: HTMLCanvasElement, private world: World) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.canvas.width = window.innerWidth * devicePixelRatio;
    this.canvas.height = window.innerHeight * devicePixelRatio;
  }

  /** Экран -> мир (юниты), для кликов по целям */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const { x, y } = this.toCanvasPx(sx, sy);
    const { x: wx, y: wy } = this.worldToScreen(0, 0);
    return { x: (x - wx) / UNIT, y: (y - wy) / UNIT };
  }

  private toCanvasPx(sx: number, sy: number): { x: number; y: number } {
    return { x: sx * devicePixelRatio, y: sy * devicePixelRatio };
  }

  follow(x: number, y: number): void {
    this.cam.x = x;
    this.cam.y = y;
  }

  draw(timeMs: number, me: PlayerEntity | null, night: number): void {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(0, 0, W, H);

    // Левый верхний видимый «мировой пиксель» (камера — центр экрана)
    const camPxX = this.cam.x * UNIT - W / 2;
    const camPxY = this.cam.y * UNIT - H / 2;

    // ── Земля: бесшовная нарисованная текстура (без квадратной сетки) ──
    const groundImg = spr('ground');
    if (groundImg) {
      const ox = ((camPxX % GROUND_PX) + GROUND_PX) % GROUND_PX;
      const oy = ((camPxY % GROUND_PX) + GROUND_PX) % GROUND_PX;
      for (let y = oy - GROUND_PX; y < H; y += GROUND_PX) {
        for (let x = ox - GROUND_PX; x < W; x += GROUND_PX) {
          ctx.drawImage(groundImg, x, y, GROUND_PX, GROUND_PX);
        }
      }
    }

    // ── Декор: камни, кусты, трава (детерминированно по клеткам) ──
    const cx0 = Math.floor(camPxX / DECOR_CELL), cy0 = Math.floor(camPxY / DECOR_CELL);
    const ncx = Math.ceil(W / DECOR_CELL) + 1, ncy = Math.ceil(H / DECOR_CELL) + 1;
    for (let cy = cy0; cy < cy0 + ncy; cy++) {
      for (let cx = cx0; cx < cx0 + ncx; cx++) {
        const h = tileHash(cx, cy);
        if (h > 0.42) continue;
        const name = h < 0.1 ? 'decor_rock' : h < 0.26 ? 'decor_bush' : 'decor_grass';
        const img = spr(name);
        if (!img) continue;
        const ox2 = tileHash(cx + 91, cy) * DECOR_CELL * 0.72;
        const oy2 = tileHash(cx, cy + 17) * DECOR_CELL * 0.72;
        const size = SPRITE_BASE * 0.9 * devicePixelRatio;
        const x = cx * DECOR_CELL + ox2 - camPxX;
        const y = cy * DECOR_CELL + oy2 - camPxY;
        ctx.globalAlpha = 0.92;
        ctx.drawImage(img, x - size / 2, y - size * 0.78, size, size);
        ctx.globalAlpha = 1;
      }
    }

    // ── Сущности, отсортированные по Y (глубина) ───────────────
    interface Drawable { y: number; draw: () => void }
    const list: Drawable[] = [];

    for (const p of this.world.players.values()) {
      list.push({ y: p.pos.z, draw: () => this.drawPlayer(p, me?.id === p.id, timeMs) });
    }
    for (const m of this.world.monsters.values()) {
      list.push({ y: m.pos.z, draw: () => this.drawMonster(m, timeMs) });
    }
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();

    // ── Эффекты боя ─────────────────────────────────────────────
    this.drawEffects(timeMs);

    // ── Плавающий текст ─────────────────────────────────────────
    ctx.textAlign = 'center';
    for (const f of this.world.floaters) {
      const age = (timeMs - f.born) / 1100;
      const sx = (f.x - this.cam.x) * UNIT + W / 2;
      const sy = (f.y - this.cam.y) * UNIT + H / 2;
      ctx.globalAlpha = 1 - age;
      ctx.font = `${f.crit ? 26 : 17 * devicePixelRatio}px Georgia, serif`;
      ctx.fillStyle = '#000';
      ctx.fillText(f.text, sx + 1, sy + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, sx, sy);
      ctx.globalAlpha = 1;
    }

    // ── Ночная дымка (из world:time; 0 — день, 1 — глухая ночь) ─
    if (night > 0) {
      ctx.fillStyle = `rgba(8, 14, 30, ${0.32 * night})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  private worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.cam.x) * UNIT + this.canvas.width / 2,
      y: (wy - this.cam.y) * UNIT + this.canvas.height / 2,
    };
  }

  private drawSpriteAt(base: string, moving: boolean, timeMs: number, seed: number, sx: number, sy: number, flipped: boolean): void {
    const ctx = this.ctx;
    const img = walkFrame(base, moving, timeMs, seed);
    if (!img) return;
    const size = SPRITE_BASE * ENTITY_SCALE * devicePixelRatio;
    const x = sx - size / 2, y = sy - size * 0.9;
    // Мягкая тень под сущностью
    ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, size * 0.26, size * 0.085, 0, 0, Math.PI * 2);
    ctx.fill();
    if (flipped) {
      ctx.save();
      ctx.translate(x + size, y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, size, size);
      ctx.restore();
    } else {
      ctx.drawImage(img, x, y, size, size);
    }
  }

  private drawNameTag(name: string, sx: number, sy: number, color: string): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.font = `${13.5 * devicePixelRatio}px 'Segoe UI', sans-serif`;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillText(name, sx + 1, sy + 1);
    ctx.fillStyle = color;
    ctx.fillText(name, sx, sy);
  }

  private hpBar(sx: number, sy: number, width: number, hp: number, maxHp: number, color: string): void {
    const ctx = this.ctx;
    const h = 4 * devicePixelRatio;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(sx - width / 2, sy, width, h);
    ctx.fillStyle = color;
    ctx.fillRect(sx - width / 2 + 1, sy + 1, (width - 2) * Math.max(0, Math.min(1, hp / maxHp)), h - 2);
  }

  private drawPlayer(p: PlayerEntity, isMe: boolean, timeMs: number): void {
    const { x: sx, y: sy } = this.worldToScreen(p.pos.x, p.pos.z);
    const size = SPRITE_BASE * ENTITY_SCALE * devicePixelRatio;
    this.drawSpriteAt(`char_${p.charClass}`, p.moving, timeMs, p.seed, sx, sy, p.flipped);
    // Подсветка себя
    if (isMe) {
      const ctx = this.ctx;
      ctx.strokeStyle = 'rgba(244, 210, 108, 0.85)';
      ctx.lineWidth = 2.5 * devicePixelRatio;
      ctx.beginPath();
      ctx.ellipse(sx, sy, size * 0.24, size * 0.09, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.drawNameTag(p.name + (isMe ? ' ★' : ''), sx, sy - size * 1.02, isMe ? '#F4D26C' : '#cfe3f0');
  }

  private drawMonster(m: MonsterEntity, timeMs: number): void {
    const ctx = this.ctx;
    const { x: sx, y: sy } = this.worldToScreen(m.pos.x, m.pos.z);
    const sizeMult = m.type === 'world_boss' ? 1.8 : m.type === 'boss' ? 1.5 : m.type === 'elite' ? 1.18 : 1;
    const size = SPRITE_BASE * ENTITY_SCALE * devicePixelRatio * sizeMult;

    if (m.deadAt) {
      // Анимация смерти: растворение
      const age = (timeMs - m.deadAt) / 900;
      if (age < 1) {
        ctx.globalAlpha = 1 - age;
        const img = spr(`${monsterBase(m.monsterId)}_0`);
        if (img) ctx.drawImage(img, sx - size / 2, sy - size * 0.78 + age * 12 * devicePixelRatio, size, size);
        ctx.globalAlpha = 1;
      }
      return;
    }

    this.drawSpriteAt(monsterBase(m.monsterId), true, timeMs, m.seed, sx, sy, false);

    // Выделение цели
    if (this.world.targetId === m.instanceId) {
      ctx.strokeStyle = '#BA2A37';
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 16 * devicePixelRatio, 7 * devicePixelRatio, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    this.hpBar(sx, sy - size * 0.86, size * 0.7, m.hp, m.maxHp, '#BA2A37');
    this.drawNameTag(m.nameRu, sx, sy - size * 0.86 - 6 * devicePixelRatio, '#e8b6ae');
  }

  private drawEffects(timeMs: number): void {
    const ctx = this.ctx;
    for (const e of this.world.effects) {
      const age = (timeMs - e.born) / 320;
      const a = this.worldToScreen(e.x1, e.y1);
      const b = this.worldToScreen(e.x2, e.y2);
      ctx.globalAlpha = 1 - age;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = (e.kind === 'heal' ? 3 : 2.5) * devicePixelRatio;
      if (e.kind === 'heal') {
        ctx.beginPath();
        ctx.arc(a.x, a.y - 26 * devicePixelRatio, (10 + age * 14) * devicePixelRatio, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Дуга удара от атакующего к цели
        ctx.beginPath();
        ctx.moveTo(a.x, a.y - 26 * devicePixelRatio);
        ctx.lineTo(b.x, b.y - 26 * devicePixelRatio);
        ctx.stroke();
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.arc(b.x, b.y - 26 * devicePixelRatio, (4 + age * 6) * devicePixelRatio, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
}

export { UNIT };
