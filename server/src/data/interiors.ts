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

// Комнаты стоят ЗА краем мира, и это требование, а не украшение.
//
// Мир вырос: WORLD_HALF 1200 -> 3175, и карман, который раньше лежал за
// краем (2500..2852), оказался внутри него. Там есть рельеф, зоны и спавны
// монстров, и комната стояла бы посреди поля, а игрок, вошедший в здание на
// улице, попадал бы в ту же точку, что и открытая земля вокруг. Сдвиг на
// 1500 вернул комнаты далеко за край (4000..4352) и за кламп игрока
// (WORLD_HALF - 30). Проверка «комнаты интерьеров действительно за границей
// мира» это требование сторожит - и сработала, когда край разошёлся с миром.
const ROOM_CZ = 4000;
const ROOM_HALF = 16;

export const INTERIORS: Record<string, InteriorDef> = {
  stable: {
    id: 'stable', roomCx: 4000, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 4000, spawnZ: 4005.5, doorX: 15.4, doorZ: -43.6, exitX: 14.4, exitZ: -47.5,
  },
  barracks: {
    id: 'barracks', roomCx: 4044, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 4044, spawnZ: 4005.5, doorX: 70.0, doorZ: -36.4, exitX: 72.0, exitZ: -39.9,
  },
  workshop: {
    id: 'workshop', roomCx: 4088, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 4088, spawnZ: 4005.5, doorX: 101.7, doorZ: 1.4, exitX: 105.5, exitZ: 0.0,
  },
  tavern: {
    id: 'tavern', roomCx: 4132, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 4132, spawnZ: 4005.5, doorX: 101.7, doorZ: 50.6, exitX: 105.5, exitZ: 52.0,
  },
  observatory: {
    id: 'observatory', roomCx: 4176, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 4176, spawnZ: 4005.5, doorX: 58.6, doorZ: 93.7, exitX: 60.0, exitZ: 97.5,
  },
  science: {
    id: 'science', roomCx: 4220, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 4220, spawnZ: 4005.5, doorX: -31.2, doorZ: 56.4, exitX: -34.8, exitZ: 58.1,
  },
  // ── Новая инфраструктура ─────────────────────────────────────
  arena: {
    id: 'arena', roomCx: 4264, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 4264, spawnZ: 4005.5, doorX: -6, doorZ: -24, exitX: -8.5, exitZ: -27.1,
  },
  auction_house: {
    id: 'auction_house', roomCx: 4308, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 4308, spawnZ: 4005.5, doorX: 84, doorZ: 76, exitX: 86.8, exitZ: 78.8,
  },
  circus: {
    id: 'circus', roomCx: 4352, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 4352, spawnZ: 4005.5, doorX: -21, doorZ: 71, exitX: -24.1, exitZ: 73.5,
  },
  // Караван-сарай на дороге Исфахан-Караван-сарай, (505, 55). Дверь у
  // ворот: ворота стоят на z + 14, то есть (505, 69). Слот 4396 =
  // 4000 + 9*44, и он обязан быть ПОСЛЕДНИМ: клиент считает слот
  // индексом в массиве, а здесь число. Вставка в середину разъедет
  // все последующие комнаты, и это молча.
  caravanserai: {
    id: 'caravanserai', roomCx: 4396, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 4396, spawnZ: 4005.5, doorX: 505, doorZ: 69, exitX: 505, exitZ: 73,
  },
  // Крепость на перевале. Одиннадцатая запись: слот 10 = 4000 + 10 * 44 = 4440.
  // Запись ТОЛЬКО после караван-сарая: номер слота на сервере совпадает с
  // индексом в SPOTS на клиенте, и вставка выше сдвинула бы номера.
  //
  // Дверь промерена по водяной маске: FORT (-320,-705) на склоне, вода на
  // юге (waterMask 0.68), на (-320,-677) сухо (0.000). Не на глаз.
  fortress: {
    id: 'fortress', roomCx: 4440, roomCz: ROOM_CZ, roomHalf: ROOM_HALF,
    spawnX: 4440, spawnZ: 4005.5, doorX: -320, doorZ: -677, exitX: -320, exitZ: -673,
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
