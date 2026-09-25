// ============================================================
// Реестр интерьеров — Empire of Safavids (серверная копия)
// ============================================================
// Координаты ДОЛЖНЫ совпадать с client/src/app/game3d/interiors.ts.
// Сервер никому не верит на слово: точки входа/выхода вычисляет сам,
// от клиента принимает только buildingId. Это закрывает телепорт-абьюз
// через канал интерьеров.

export interface InteriorDef {
  id: string;
  /** Центр комнаты (клиент телепортируется в spawn, сервер проверяет bounds). */
  roomCx: number;
  roomCz: number;
  roomHalf: number;
  /** Точка появления внутри. */
  spawnX: number;
  spawnZ: number;
  /** Дверь снаружи: вход разрешён, только если игрок рядом. */
  doorX: number;
  doorZ: number;
  /** Точка выхода снаружи. */
  exitX: number;
  exitZ: number;
}

const ROOM_CZ = 2500;
const ROOM_HALF = 16;

export const INTERIORS: Record<string, InteriorDef> = {
  stable: {
    id: 'stable', roomCx: 2500, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 2500, spawnZ: 2505.5, doorX: 15.4, doorZ: -43.6, exitX: 14.4, exitZ: -47.5,
  },
  barracks: {
    id: 'barracks', roomCx: 2544, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 2544, spawnZ: 2505.5, doorX: 70.0, doorZ: -36.4, exitX: 72.0, exitZ: -39.9,
  },
  workshop: {
    id: 'workshop', roomCx: 2588, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 2588, spawnZ: 2505.5, doorX: 101.7, doorZ: 1.4, exitX: 105.5, exitZ: 0.0,
  },
  tavern: {
    id: 'tavern', roomCx: 2632, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 2632, spawnZ: 2505.5, doorX: 101.7, doorZ: 50.6, exitX: 105.5, exitZ: 52.0,
  },
  observatory: {
    id: 'observatory', roomCx: 2676, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 2676, spawnZ: 2505.5, doorX: 58.6, doorZ: 93.7, exitX: 60.0, exitZ: 97.5,
  },
  science: {
    id: 'science', roomCx: 2720, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 2720, spawnZ: 2505.5, doorX: -31.2, doorZ: 56.4, exitX: -34.8, exitZ: 58.1,
  },
  // ── Новая инфраструктура ─────────────────────────────────────
  arena: {
    id: 'arena', roomCx: 2764, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 2764, spawnZ: 2505.5, doorX: -60.0, doorZ: -40.0, exitX: -62.0, exitZ: -44.0,
  },
  auction_house: {
    id: 'auction_house', roomCx: 2808, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 2808, spawnZ: 2505.5, doorX: -100.0, doorZ: 10.0, exitX: -102.0, exitZ: 6.0,
  },
  circus: {
    id: 'circus', roomCx: 2852, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 2852, spawnZ: 2505.5, doorX: -50.0, doorZ: 50.0, exitX: -52.0, exitZ: 46.0,
  },
};

export function getInterior(id: string): InteriorDef | undefined {
  return INTERIORS[id];
}

/** Игрок достаточно близко к двери, чтобы войти. */
export function canEnter(def: InteriorDef, x: number, z: number): boolean {
  return Math.hypot(x - def.doorX, z - def.doorZ) <= 26;
}

/** Игрок внутри комнаты (для выхода). */
export function isInsideRoom(def: InteriorDef, x: number, z: number): boolean {
  return Math.abs(x - def.roomCx) <= def.roomHalf && Math.abs(z - def.roomCz) <= def.roomHalf;
}
