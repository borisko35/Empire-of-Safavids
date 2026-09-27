// ============================================================
// Точки спавна и проверка воды (сервер) — Empire of Safavids
// ============================================================
// Водные контуры — зеркало client/src/app/game3d/terrain.ts
// (LAKE, POND, RIVER_A, RIVER_B, BRIDGES). При изменении террейна
// клиента обновить и здесь: иначе спасение из воды и санитизация
// позиций при входе будут работать по устаревшим данным.

import { getRegionSpawn } from '../../../shared/constants';

const LAKE = { x: -420, z: -160, r: 170 };
const POND = { x: 620, z: 300, r: 70 };

const RIVER_A: { x: number; z: number }[] = [
  { x: -350, z: -575 }, { x: -368, z: -470 }, { x: -398, z: -310 }, { x: -412, z: -220 },
];
const RIVER_B: { x: number; z: number }[] = [
  { x: -300, z: 20 }, { x: -140, z: 120 }, { x: 120, z: 200 }, { x: 380, z: 270 }, { x: 540, z: 292 },
];

const BRIDGES: { x: number; z: number; dx: number; dz: number; length: number; width: number }[] = [
  { x: -100, z: 130, dx: 0.85, dz: 0.53, length: 18, width: 4.5 },
  { x: -405, z: -230, dx: 0.2, dz: -0.98, length: 16, width: 4 },
  { x: 320, z: 255, dx: 0.96, dz: 0.29, length: 14, width: 4 },
];

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 === 0 ? 0 : ((px - ax) * abx + (pz - az) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t, cz = az + abz * t;
  return Math.hypot(px - cx, pz - cz);
}

function onBridge(x: number, z: number): boolean {
  for (const b of BRIDGES) {
    const lx = (x - b.x) * b.dx + (z - b.z) * b.dz;
    const lz = -(x - b.x) * b.dz + (z - b.z) * b.dx;
    if (Math.abs(lx) < b.length / 2 && Math.abs(lz) < b.width / 2) return true;
  }
  return false;
}

/** Глубокая вода (место, где персонаж будет плавать, а не стоять) */
export function isDeepWater(x: number, z: number): boolean {
  if (onBridge(x, z)) return false;
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r - 5) return true;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r - 5) return true;
  for (const river of [RIVER_A, RIVER_B]) {
    for (let i = 0; i < river.length - 1; i++) {
      if (distToSegment(x, z, river[i].x, river[i].z, river[i + 1].x, river[i + 1].z) < 4) return true;
    }
  }
  return false;
}

/**
 * Есть ли здесь вода вообще — включая мелководье у берега.
 * Рыбалка с берега возможна только там, где вода ещё не кончилась.
 */
export function isWater(x: number, z: number): boolean {
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r) return true;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r) return true;
  for (const river of [RIVER_A, RIVER_B]) {
    for (let i = 0; i < river.length - 1; i++) {
      if (distToSegment(x, z, river[i].x, river[i].z, river[i + 1].x, river[i + 1].z) < 6) return true;
    }
  }
  return false;
}

/**
 * Можно ли здесь поставить лодку на воду. Мосты — суша: лодка под
 * мостом не пройдёт, а игрок с лодкой на мосту — абсурд.
 */
export function canFloatAt(x: number, z: number): boolean {
  if (onBridge(x, z)) return false;
  return isWater(x, z);
}

export { getRegionSpawn };
