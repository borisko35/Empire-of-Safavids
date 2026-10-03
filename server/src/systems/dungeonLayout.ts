import { ROOM_HALF } from '../data/interiors';
import type { DungeonDefinition, DungeonRoom } from '../data/dungeons';

/**
 * Раскладка монстров подземелья по залу.
 *
 * ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ МОДУЛЬ, А НЕ СТРОКА В СЕРВИСЕ. Позиции в данных
 * локальны к своей комнате: у каждой комнаты своя точка отсчёта, и в комнате
 * «Тронный Зал» босс стоит в z = 30. Я свёл все комнаты подземелья в одну
 * систему координат — и из этого вышло, что у дворца размах по x равен 40
 * при ширине зала 32: часть монстров оказывалась за стеной, то есть
 * недоступной и невидимой. Сдвигом самой точки входа это не лечится: замах
 * больше зала.
 *
 * ПРАВИЛО РАСКЛАДКИ, ВСЁ ИЗ ДАННЫХ И ФОРМУЛЫ:
 *   1. зал делится на зоны по числу комнат, комната 0 — ближе к двери;
 *   2. позиции комнаты сохраняются как есть, только центр комнаты сдвигается
 *      на центр её зоны — так раскладка авторская и ни одна монстра не
 *      переставляется вручную;
 *   3. всё, что не влезло в зал, обрезается по краю: точки входа не должны
 *      выпускать монстров сквозь стену, и это правило верно для любого
 *      подземелья, включая те, которых ещё нет.
 */
export const ROOM_MARGIN = 1;

export interface PlannedMonster {
  monsterId: string;
  /** Номер комнаты в данных, чтобы сервис знал, где босс. */
  roomIndex: number;
  x: number;
  y: number;
  z: number;
}

export interface PlannedRoom {
  index: number;
  /** Центр зоны комнаты по z: где стоят монстры этой комнаты. */
  zoneZ: number;
  monsters: PlannedMonster[];
}

function clamp(value: number, низ: number, верх: number): number {
  return Math.max(низ, Math.min(верх, value));
}

/**
 * Сдвиг зоны комнаты по z.
 *
 * Комната 0 — входная, и она ближе к двери, а дверь в конце зала с большим z.
 * Чем больше комнат, тем уже зона; нижняя граница защищает зал от подземелья
 * с десятком комнат, где иначе зоны станут в две монстра длиной.
 */
export function zoneShift(roomIndex: number, roomCount: number): number {
  const count = Math.max(1, roomCount);
  // Одна граница: зал делится между комнатами.
  //
  // Вторая граница («самая дальняя зона должна остаться внутри зала») тут была
  // и оказалась мёртвым кодом: сравнение для 2…40 комнат показало, что
  // граница по краю ни разу не меньше границы по глубине, а при одной комнате
  // обе дают ноль. Оставлена та, что влияет на результат; проверка требует
  // самую дальнюю зону оставаться в зале для 1…40 комнат.
  const band = Math.floor((ROOM_HALF * 2 - 2) / count);
  return ((count - 1) / 2 - roomIndex) * band;
}

/**
 * Центр позиций комнаты.
 *
 * Считается по данным, а не задаётся руками: если завтра в комнату добавят
 * монстра с другой позицией, центр поедет сам.
 */
export function roomCentre(room: DungeonRoom): { x: number; z: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const group of room.monsters) {
    for (const pos of group.positions) {
      if (pos.x < minX) minX = pos.x;
      if (pos.x > maxX) maxX = pos.x;
      if (pos.z < minZ) minZ = pos.z;
      if (pos.z > maxZ) maxZ = pos.z;
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, z: 0 };
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
}

/**
 * Опорная точка комнаты: то, что встаёт в центр зоны.
 *
 * Для обычной комнаты это середина её позиций. Для боссовой — позиция самого
 * босса, и это не украшение: комнату рисуют вокруг босса (трон, алтарь, тронный
 * зал), и если босс окажется у края своей зоны, трон окажется в стороне от
 * него. Я ставил трон по геометрии, а босса — по данным, и они расходились.
 */
export function roomAnchor(room: DungeonRoom): { x: number; z: number } {
  if (room.isBossRoom && room.bossId) {
    const позицииБосса = room.monsters
      .filter((группа) => группа.monsterId === room.bossId)
      .flatMap((группа) => группа.positions);
    if (позицииБосса.length) {
      const xs = позицииБосса.map((п) => п.x);
      const zs = позицииБосса.map((п) => п.z);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
    }
  }
  return roomCentre(room);
}

/**
 * Разложить все комнаты подземелья по залу.
 *
 * Точка входа подземелья — центр его зала: монстры берутся от неё.
 */
export function planDungeonRooms(def: DungeonDefinition): PlannedRoom[] {
  const count = def.rooms.length;
  const minX = def.entryX - ROOM_HALF + ROOM_MARGIN;
  const maxX = def.entryX + ROOM_HALF - ROOM_MARGIN;
  const minZ = def.entryZ - ROOM_HALF + ROOM_MARGIN;
  const maxZ = def.entryZ + ROOM_HALF - ROOM_MARGIN;
  return def.rooms.map((room, index) => {
    const zoneZ = def.entryZ + zoneShift(index, count);
    const anchor = roomAnchor(room);
    // Сдвиг считается ОТНОСИТЕЛЬНО точки входа. Если сложить entryX ещё раз в
    // спавне, монстры уедут на удвоенную координату, и кламп схлопнет их всех
    // в один угол зала — так и вышло при первой сборке, и поймал это замер.
    const shiftX = -anchor.x;
    const shiftZ = zoneZ - anchor.z - def.entryZ;
    const monsters: PlannedMonster[] = [];
    for (const group of room.monsters) {
      for (const pos of group.positions) {
        monsters.push({
          monsterId: group.monsterId,
          roomIndex: index,
          x: clamp(def.entryX + shiftX + pos.x, minX, maxX),
          y: pos.y,
          z: clamp(def.entryZ + shiftZ + pos.z, minZ, maxZ),
        });
      }
    }
    const заняты = new Set<string>();
    for (const монстр of monsters) {
      const исходныйX = монстр.x;
      let попытка = 0;
      // Обрезка по стену может свести двух монстров в одну точку: у паши в
      // данных позиции от −20 до +20, а зал шириной 32, и крайние вставали
      // друг на друга. Стоящие друг на друге монстры не бьются по отдельности.
      while (заняты.has(`${монстр.x}:${монстр.z}`) && попытка < 60) {
        попытка++;
        const знак = попытка % 2 === 1 ? 1 : -1;
        const смещение = знак * (Math.ceil(попытка / 2) * 0.9);
        монстр.x = clamp(исходныйX + смещение, minX, maxX);
      }
      заняты.add(`${монстр.x}:${монстр.z}`);
    }
    return { index, zoneZ, monsters };
  });
}