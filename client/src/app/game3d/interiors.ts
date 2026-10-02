// ============================================================
// Здания и интерьеры — Empire of Safavids
// ============================================================
// Шесть городских построек Исфахана: конюшня, казарма, мастерская,
// таверна, обсерватория, научный центр. Вход/выход — кликом по двери
// (та же механика, что и разговор с NPC: прицел + клик в радиусе 22).
//
// Интерьеры живут в «кармане» мира (2500+, 2500+): далеко за туманом,
// поэтому не конфликтуют с городом. Координаты комнат ДОЛЖНЫ совпадать
// с server/src/data/interiors.ts — сервер сам вычисляет точки
// телепорта и не верит клиентским координатам (защита от абьюза).

import * as THREE from 'three';
import { t } from '../i18n';
import { CITY, addCollider } from './terrain';
import { plasterTexture, stoneTexture, woodTexture } from './textures';

export type BuildingKind = 'stable' | 'barracks' | 'workshop' | 'tavern' | 'observatory' | 'science' | 'arena' | 'auction_house' | 'circus' | 'caravanserai';

export interface BuildingDef {
  id: string;
  kind: BuildingKind;
  nameKey: string;
  icon: string;
  /** Дверь снаружи (мировые координаты). */
  doorX: number;
  doorZ: number;
  /** Центр комнаты в кармане. */
  roomCx: number;
  roomCz: number;
  /** Точка выхода снаружи, высота пола. Точку входа присылает сервер в ack. */
  exitX: number;
  exitZ: number;
  floorY: number;
}

// Локальные позиции домов в Исфахане (относительно центра города)
// lx/lz - смещение двери от центра Исфахана. Необязательны, потому что
// дверь караван-сарая стоит в 470 единицах от столицы, и прибить её к
// городу нельзя. Для тех записей, где lx/lz заданы, поведение прежнее.
// dx/dz - абсолютные координаты двери, ex/ez - выхода.
const SPOTS: {
  id: string; kind: BuildingKind; nameKey: string; icon: string;
  lx?: number; lz?: number; dx?: number; dz?: number; ex?: number; ez?: number;
}[] = [
  { id: 'stable', kind: 'stable', nameKey: 'buildings.stable', icon: '🐴', lx: -18.6, lz: -69.5 },
  { id: 'barracks', kind: 'barracks', nameKey: 'buildings.barracks', icon: '🛡️', lx: 36.0, lz: -62.4 },
  { id: 'workshop', kind: 'workshop', nameKey: 'buildings.workshop', icon: '⚒️', lx: 67.7, lz: -24.6 },
  { id: 'tavern', kind: 'tavern', nameKey: 'buildings.tavern', icon: '🍺', lx: 67.7, lz: 24.6 },
  { id: 'observatory', kind: 'observatory', nameKey: 'buildings.observatory', icon: '🔭', lx: 24.6, lz: 67.7 },
  { id: 'science', kind: 'science', nameKey: 'buildings.science', icon: '⚗️', lx: -65.2, lz: 30.4 },
  { id: 'arena', kind: 'arena', nameKey: 'buildings.arena', icon: '⚔️', lx: -40.0, lz: -50.0 },
  { id: 'auction_house', kind: 'auction_house', nameKey: 'buildings.auction_house', icon: '🏛️', lx: 50.0, lz: 50.0 },
  { id: 'circus', kind: 'circus', nameKey: 'buildings.circus', icon: '🎪', lx: -55.0, lz: 45.0 },
  // ПОСЛЕДНЯЯ ЗАПИСЬ, И ЭТО ОБЯЗАТЕЛЬНО. Слот комнаты считается индексом
  // (POCKET_X + i * ROOM_DX), а на сервере зашит числом. Запись выше
  // сдвинет слоты всех, кто ниже, и комнаты разъедутся по координатам.
  { id: 'caravanserai', kind: 'caravanserai', nameKey: 'buildings.caravanserai', icon: '🐫', dx: 505, dz: 69, ex: 505, ez: 73 },
];

export const POCKET_X = 4000;
export const POCKET_Z = 4000;
const ROOM_DX = 44;
export const ROOM_W = 22;
export const ROOM_D = 16;
export const ROOM_WALL_H = 4.5;
export const ROOM_WALL_T = 0.6;
export const ROOM_DOOR_GAP = 3.2;
export const FLOOR_Y = 0.4;

/** Прямоугольник кармана: земля-плато и невидимый забор по периметру. */
/** Прямоугольник кармана: земля-плато и невидимый забор по периметру.
 *
 *  СТОИТ РЯДОМ С КОМНАТАМИ, А НЕ ТАМ, ГДЕ БЫЛ ИХ ПРЕЖНИЙ АДРЕС. Прямоугольник
 *  остался на 2470..2880 после того, как комнаты сдвинули на 1500 единиц на
 *  4000..4396 (чтобы они оказались за краем мира). Он и тогда лежал внутри
 *  мира, и после расширения мира попал в зону east_frontier_far.
 *
 *  Что из этого получалось, измерено по двум ветвям расчёта высоты:
 *    - невидимый забор POCKET_COLLIDERS посреди новой земли: коллайдер есть,
 *      стены нет, игрок упирается во что-то невидимое;
 *    - вне интерьера высота берётся как pocketY ?? groundHeight, а pocketY в
 *      этом прямоугольнике равен 0, то есть НЕ null, и подстановка не
 *      срабатывает - земля под ногами становится нулевой там, где настоящий
 *      рельеф лежит около 20..40 метров.
 *
 *  Границы: десять комнат стоят от 4000 до 4396 с шагом 44 при половине
 *  комнаты 16, то есть занимают 3984..4412 по горизонтали и 3992..4008 по
 *  вертикали. Отсюда 3960..4440 и 3960..4040 с запасом в 24 единицы.
 */
export const POCKET_RECT = { x0: 3960, x1: 4440, z0: 3960, z1: 4040 };
export const POCKET_GROUND_Y = 0;

/** Уровень земли кармана или null, если точка вне его. */
export function pocketGroundY(x: number, z: number): number | null {
  if (x < POCKET_RECT.x0 || x > POCKET_RECT.x1 || z < POCKET_RECT.z0 || z > POCKET_RECT.z1) return null;
  return POCKET_GROUND_Y;
}

/** Статичные коллайдеры кармана (периметр). Активны всегда — далеко от игры. */
export const POCKET_COLLIDERS: { x: number; z: number; r: number }[] = [];

/** Земля-плато под комнатами + забор по периметру, чтобы не уйти в пустоту. */
export function buildPocketGround(scene: THREE.Scene): void {
  const cx = (POCKET_RECT.x0 + POCKET_RECT.x1) / 2;
  const cz = (POCKET_RECT.z0 + POCKET_RECT.z1) / 2;
  const w = POCKET_RECT.x1 - POCKET_RECT.x0;
  const d = POCKET_RECT.z1 - POCKET_RECT.z0;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.5, d),
    new THREE.MeshStandardMaterial({ color: 0x8a7648, roughness: 1 }),
  );
  slab.position.set(cx, POCKET_GROUND_Y - 0.25, cz);
  slab.receiveShadow = true;
  scene.add(slab);
  // Дюны-маркер по углам, чтобы плато не выглядело стерильно
  const dune = new THREE.MeshStandardMaterial({ color: 0x9c8a5a, roughness: 1 });
  for (const [dx, dz, r] of [[-w / 2 + 12, -d / 2 + 8, 7], [w / 2 - 14, d / 2 - 9, 9], [30, d / 2 - 7, 6]] as const) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 7), dune);
    m.scale.y = 0.35;
    m.position.set(cx + dx, POCKET_GROUND_Y, cz + dz);
    scene.add(m);
  }
  // Невидимый забор по периметру
  const step = 2.5;
  for (let x = POCKET_RECT.x0; x <= POCKET_RECT.x1; x += step) {
    POCKET_COLLIDERS.push({ x, z: POCKET_RECT.z0, r: 1.5 }, { x, z: POCKET_RECT.z1, r: 1.5 });
  }
  for (let z = POCKET_RECT.z0; z <= POCKET_RECT.z1; z += step) {
    POCKET_COLLIDERS.push({ x: POCKET_RECT.x0, z, r: 1.5 }, { x: POCKET_RECT.x1, z, r: 1.5 });
  }
}

export const BUILDINGS: BuildingDef[] = SPOTS.map((s, i) => {
  const doorX = s.dx ?? CITY.x + (s.lx ?? 0), doorZ = s.dz ?? CITY.z + (s.lz ?? 0);
  const n = Math.hypot(s.lx ?? 0, s.lz ?? 0) || 1;
  const roomCx = POCKET_X + i * ROOM_DX;
  return {
    id: s.id,
    kind: s.kind,
    nameKey: s.nameKey,
    icon: s.icon,
    doorX,
    doorZ,
    roomCx,
    roomCz: POCKET_Z,
    exitX: s.ex ?? doorX + ((s.lx ?? 0) / n) * 4,
    exitZ: s.ez ?? doorZ + ((s.lz ?? 0) / n) * 4,
    floorY: FLOOR_Y,
  };
});

/** Коллайдеры активного интерьера (стены + мебель). Пусто, пока игрок снаружи. */
export const INTERIOR_COLLIDERS: { x: number; z: number; r: number }[] = [];

// ── Материалы ────────────────────────────────────────────────
const M = {
  wall: new THREE.MeshStandardMaterial({ color: 0xc9ab7c, roughness: 0.9, map: plasterTexture('#c9ab7c', 2) }),
  wallDark: new THREE.MeshStandardMaterial({ color: 0xa89061, roughness: 0.95 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 1, map: woodTexture(1) }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 0.95, map: stoneTexture(4) }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 1 }),
  teal: new THREE.MeshStandardMaterial({ color: 0x2e8b8b, roughness: 0.6 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xc9a84c, roughness: 0.35, metalness: 0.7 }),
  red: new THREE.MeshStandardMaterial({ color: 0x8b1a1a, roughness: 1 }),
  cream: new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.85 }),
  hay: new THREE.MeshStandardMaterial({ color: 0xd8b84a, roughness: 1 }),
  iron: new THREE.MeshStandardMaterial({ color: 0x6a6e78, roughness: 0.5, metalness: 0.6 }),
  fire: new THREE.MeshStandardMaterial({ color: 0xff8c30, emissive: 0xff6a10, emissiveIntensity: 1.8 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xffd980, emissive: 0xffa530, emissiveIntensity: 1.3 }),
  water: new THREE.MeshStandardMaterial({ color: 0x2f6f96, roughness: 0.2 }),
  purple: new THREE.MeshStandardMaterial({ color: 0x7a5fd0, roughness: 0.5 }),
  green: new THREE.MeshStandardMaterial({ color: 0x4a6a38, roughness: 1 }),
};

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rt: number, rb: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 10): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Табличка с названием над дверью. */
function signMesh(text: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a2018';
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#c9a84c';
  g.lineWidth = 4;
  g.strokeRect(3, 3, 250, 58);
  g.fillStyle = '#f5f0e8';
  g.font = 'bold 27px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 0.9),
    new THREE.MeshBasicMaterial({ map: tex }),
  );
  return m;
}

// ── Экстерьеры (дома в городе) ───────────────────────────────
export function buildTownBuildings(scene: THREE.Scene): THREE.Object3D[] {
  const clickTargets: THREE.Object3D[] = [];
  for (const s of SPOTS) {
    // Запись без lx/lz стоит не в столице, и типовой домик ей не нужен:
    // её собственное здание уже построено в мире. Иначе здесь получалось
    // бы CITY.x + undefined, то есть NaN, и домик уехал бы в никуда.
    if (s.lx === undefined || s.lz === undefined) continue;
    const wx = CITY.x + s.lx, wz = CITY.z + s.lz;
    const g = new THREE.Group();
    const faceRy = Math.atan2(-s.lx, -s.lz); // дверью к центру города

    const body = box(8, 4.6, 6, M.wall, 0, 2.3, 0);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.0, 2.8, 4), M.roof);
    roof.position.y = 6.0;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    const door = box(2.2, 3.4, 0.3, M.woodDark, 0, 1.7, 3.05);
    door.userData = { doorBuilding: s.id, doorAction: 'enter', doorName: t(s.nameKey) };
    const frame = box(2.8, 3.8, 0.2, M.gold, 0, 1.9, 3.0);
    const sign = signMesh(t(s.nameKey));
    sign.position.set(0, 4.0, 3.12);
    const lamp = box(0.5, 0.5, 0.5, M.lamp, 2.1, 3.1, 3.1);
    const win1 = box(1.4, 1.2, 0.2, M.teal, -2.9, 2.6, 3.05);
    const win2 = box(1.4, 1.2, 0.2, M.teal, 2.9, 1.2, 3.05);
    g.add(body, roof, frame, door, sign, lamp, win1, win2);
    g.position.set(wx, 0.4, wz);
    g.rotation.y = faceRy;
    scene.add(g);
    clickTargets.push(door);
    addCollider(wx, wz, 5);
  }
  return clickTargets;
}

// ── Мебель по типам ──────────────────────────────────────────
function brazier(parent: THREE.Group, x: number, z: number, baseY: number): void {
  parent.add(cyl(0.5, 0.35, 1.1, M.iron, x, baseY + 0.55, z, 8));
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 6), M.fire);
  fire.position.set(x, baseY + 1.6, z);
  parent.add(fire);
}

function furnishStable(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  for (const sx of [-6, 0, 6]) {
    g.add(box(0.3, 1.6, 5, M.wood, cx + sx - 2.4, FLOOR_Y + 0.8, cz - 3));
    g.add(box(0.3, 1.6, 5, M.wood, cx + sx + 2.4, FLOOR_Y + 0.8, cz - 3));
    cols.push({ x: cx + sx, z: cz - 3, r: 2.6 });
  }
  for (const [hx, hz] of [[-7, 4], [-5.4, 4], [6, 4.4], [7, -4.4]] as const) {
    g.add(box(1.4, 1.0, 1.0, M.hay, cx + hx, FLOOR_Y + 0.5, cz + hz));
  }
  cols.push({ x: cx - 6.2, z: cz + 4, r: 1.6 }, { x: cx + 6.5, z: cz + 0, r: 1.6 });
  g.add(box(3.2, 0.9, 1.2, M.woodDark, cx + 5, FLOOR_Y + 0.45, cz - 5.5));
  g.add(box(2.8, 0.2, 0.9, M.water, cx + 5, FLOOR_Y + 0.95, cz - 5.5));
  cols.push({ x: cx + 5, z: cz - 5.5, r: 1.9 });
  return cols;
}

// Караван-сарай: не типовая конюшня, а помещение под караван-сарай -
// стойла для верблюдов вдоль западной стены, две комнаты купцов с
// коврами на востоке и ряд складских ниш с тюками вдоль северной.
// Разделение сделано перегородками: одна большая коробка читалась бы
// как склад, а здесь три разных помещения.
function furnishCaravanserai(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // Стойла: три перегородки поперёк, между ними проходы.
  for (const sy of [-4.5, 0.5, 5.5]) {
    g.add(box(0.3, 2.2, 3.4, M.wood, cx - 7, FLOOR_Y + 1.1, cz + sy));
    g.add(box(0.3, 2.2, 3.4, M.wood, cx - 7, FLOOR_Y + 1.1, cz + sy + 1.9));
    cols.push({ x: cx - 7, z: cz + sy, r: 1.4 });
    g.add(box(2.6, 0.5, 1.6, M.hay, cx - 5.2, FLOOR_Y + 0.25, cz + sy + 0.9));
  }
  cols.push({ x: cx - 6, z: cz - 5, r: 2.6 }, { x: cx - 6, z: cz + 1, r: 2.6 }, { x: cx - 6, z: cz + 6, r: 2.6 });
  // Комнаты купцов: ковёр, низкий стол, светильник у каждого места.
  for (const [sx, sz] of [[4.5, -4], [8, 4]] as const) {
    // Перегородка между комнатами и общая стена отсекают их от прохода.
    g.add(box(0.3, 3.2, 6.4, M.wall, cx + 2.2, FLOOR_Y + 1.6, cz + sz));
    g.add(box(0.3, 3.2, 6.4, M.wall, cx + sx, FLOOR_Y + 1.6, cz + sz > 0 ? 7.2 : -7.2));
    g.add(box(4.6, 0.06, 5.4, M.purple, cx + sx + 1.4, FLOOR_Y + 0.03, cz + sz));
    g.add(box(2.2, 0.5, 1.2, M.woodDark, cx + sx + 1.4, FLOOR_Y + 0.25, cz + sz));
    g.add(cyl(0.22, 0.3, 0.6, M.gold, cx + sx, FLOOR_Y + 0.3, cz + sz + 1.6));
    cols.push({ x: cx + sx + 1.4, z: cz + sz, r: 1.7 });
  }
  // Складские ниши: полки с тюками вдоль северной стены.
  for (let i = 0; i < 3; i++) {
    const nx = cx - 5 + i * 5;
    g.add(box(3.6, 0.24, 1.8, M.wood, nx, FLOOR_Y + 0.12, cz - 6.4));
    g.add(box(3.6, 0.24, 1.8, M.wood, nx, FLOOR_Y + 1.5, cz - 6.4));
    g.add(box(1.6, 1.1, 1.2, M.hay, nx, FLOOR_Y + 0.67, cz - 6.4));
    g.add(box(1.2, 0.9, 1.0, M.woodDark, nx + 1.1, FLOOR_Y + 1.99, cz - 6.4));
    cols.push({ x: nx, z: cz - 6.4, r: 1.5 });
  }
  return cols;
}

function furnishBarracks(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  for (const bx of [-5.5, 5.5]) {
    g.add(box(2.4, 0.5, 5.5, M.woodDark, cx + bx, FLOOR_Y + 0.5, cz - 2));
    g.add(box(2.2, 0.35, 5.2, M.cream, cx + bx, FLOOR_Y + 0.9, cz - 2));
    g.add(box(2.4, 0.5, 5.5, M.woodDark, cx + bx, FLOOR_Y + 1.9, cz - 2));
    g.add(box(2.2, 0.35, 5.2, M.cream, cx + bx, FLOOR_Y + 2.3, cz - 2));
    cols.push({ x: cx + bx, z: cz - 2, r: 3.1 });
  }
  g.add(box(0.3, 2.6, 0.3, M.woodDark, cx - 2, FLOOR_Y + 1.3, cz - 5.5));
  g.add(box(0.3, 2.6, 0.3, M.woodDark, cx + 2, FLOOR_Y + 1.3, cz - 5.5));
  g.add(box(4.6, 0.25, 0.25, M.woodDark, cx, FLOOR_Y + 2.4, cz - 5.5));
  for (const sx of [-1.2, 0, 1.2]) {
    const sword = box(0.16, 2.2, 0.16, M.iron, cx + sx, FLOOR_Y + 1.4, cz - 5.4);
    sword.rotation.z = sx * 0.12;
    g.add(sword);
  }
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.15, 12), M.red);
  shield.position.set(cx, FLOOR_Y + 1.5, cz - 5.15);
  shield.rotation.x = Math.PI / 2;
  g.add(shield);
  cols.push({ x: cx, z: cz - 5.5, r: 2.4 });
  g.add(cyl(0.12, 0.12, 4.4, M.woodDark, cx - 8, FLOOR_Y + 2.2, cz + 5));
  g.add(box(1.6, 2.4, 0.1, M.red, cx - 8, FLOOR_Y + 2.6, cz + 5));
  cols.push({ x: cx - 8, z: cz + 5, r: 0.8 });
  return cols;
}

function furnishWorkshop(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  g.add(box(1.6, 0.7, 1.6, M.iron, cx, FLOOR_Y + 0.35, cz - 2));
  g.add(box(2.2, 0.5, 1.0, M.dark, cx, FLOOR_Y + 0.95, cz - 2));
  cols.push({ x: cx, z: cz - 2, r: 1.7 });
  g.add(box(4.4, 0.3, 1.6, M.wood, cx - 5, FLOOR_Y + 1.0, cz + 1));
  for (const [lx, lz] of [[-6.8, 0.4], [-3.2, 0.4], [-6.8, 1.6], [-3.2, 1.6]] as const) {
    g.add(box(0.25, 1.0, 0.25, M.woodDark, cx + lx, FLOOR_Y + 0.5, cz + lz));
  }
  cols.push({ x: cx - 5, z: cz + 1, r: 2.6 });
  for (const [bx, bz] of [[5, -4], [6.4, -3.2], [5.6, 3.8]] as const) {
    g.add(cyl(0.9, 1.0, 1.8, M.wood, cx + bx, FLOOR_Y + 0.9, cz + bz, 10));
    cols.push({ x: cx + bx, z: cz + bz, r: 1.3 });
  }
  g.add(box(3.4, 2.2, 0.25, M.woodDark, cx + 7.5, FLOOR_Y + 1.1, cz + 3));
  for (let i = 0; i < 4; i++) {
    const tool = box(0.14, 1.1, 0.14, i % 2 ? M.iron : M.gold, cx + 6.4 + i * 0.7, FLOOR_Y + 1.2, cz + 3.15);
    tool.rotation.z = 0.15;
    g.add(tool);
  }
  return cols;
}

function furnishTavern(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  g.add(box(7, 1.1, 1.4, M.woodDark, cx - 4, FLOOR_Y + 0.55, cz - 5.5));
  cols.push({ x: cx - 4, z: cz - 5.5, r: 3.8 });
  for (const [tx, tz] of [[-2, 1], [4, 2.5]] as const) {
    g.add(cyl(1.3, 1.3, 0.18, M.wood, cx + tx, FLOOR_Y + 1.0, cz + tz, 12));
    g.add(cyl(0.18, 0.24, 1.0, M.woodDark, cx + tx, FLOOR_Y + 0.5, cz + tz, 8));
    cols.push({ x: cx + tx, z: cz + tz, r: 1.6 });
    for (const [ox, oz] of [[-1.9, 0.4], [1.9, -0.4]] as const) {
      g.add(cyl(0.42, 0.42, 0.55, M.woodDark, cx + tx + ox, FLOOR_Y + 0.28, cz + tz + oz, 8));
    }
    g.add(cyl(0.12, 0.1, 0.28, M.gold, cx + tx + 0.4, FLOOR_Y + 1.22, cz + tz - 0.2, 6));
  }
  g.add(box(2.6, 2.2, 0.8, M.stone, cx + 8, FLOOR_Y + 1.1, cz - 5.2));
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 6), M.fire);
  flame.position.set(cx + 8, FLOOR_Y + 1.4, cz - 4.6);
  g.add(flame);
  g.add(box(2.6, 0.5, 1.4, M.woodDark, cx + 8, FLOOR_Y + 2.5, cz - 5.2));
  cols.push({ x: cx + 8, z: cz - 5.2, r: 1.8 });
  return cols;
}

function furnishObservatory(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  g.add(cyl(6.5, 7, 0.5, M.stone, cx, FLOOR_Y + 0.25, cz, 20));
  for (const a of [0.6, 2.2, 3.8, 5.4]) {
    const px = cx + Math.cos(a) * 8.4, pz = cz + Math.sin(a) * 8.4;
    g.add(cyl(0.5, 0.6, 4.6, M.wall, px, FLOOR_Y + 2.3, pz, 8));
    cols.push({ x: px, z: pz, r: 0.9 });
  }
  const tilt = 0.6;
  const tube = cyl(0.45, 0.6, 5.2, M.gold, cx, FLOOR_Y + 2.6, cz, 12);
  tube.rotation.x = Math.PI / 2 - tilt;
  tube.position.y = FLOOR_Y + 2.9;
  g.add(tube);
  for (const a of [0, 2.1, 4.2]) {
    const leg = cyl(0.09, 0.09, 2.4, M.woodDark, cx + Math.cos(a) * 0.9, FLOOR_Y + 1.2, cz + Math.sin(a) * 0.9, 6);
    leg.rotation.z = Math.cos(a) * 0.35;
    leg.rotation.x = -Math.sin(a) * 0.35;
    g.add(leg);
  }
  cols.push({ x: cx, z: cz, r: 1.6 });
  g.add(box(2.2, 0.15, 1.4, M.woodDark, cx - 5.5, FLOOR_Y + 1.0, cz + 3.5));
  g.add(box(2.0, 0.06, 1.2, M.cream, cx - 5.5, FLOOR_Y + 1.12, cz + 3.5));
  for (let i = 0; i < 7; i++) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 4), M.dark);
    dot.position.set(cx - 6.3 + (i * 37 % 16) / 10, FLOOR_Y + 1.16, cz + 3.1 + (i * 53 % 8) / 10);
    g.add(dot);
  }
  cols.push({ x: cx - 5.5, z: cz + 3.5, r: 1.5 });
  return cols;
}

function furnishScience(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  const bookCols = [M.red, M.teal, M.green, M.gold, M.purple];
  for (const sx of [-6.5, 6.5]) {
    g.add(box(4.4, 3.6, 1.0, M.woodDark, cx + sx, FLOOR_Y + 1.8, cz - 5.5));
    for (let shelf = 0; shelf < 3; shelf++) {
      const sy = FLOOR_Y + 0.8 + shelf * 1.1;
      for (let b = 0; b < 9; b++) {
        g.add(box(0.32, 0.85, 0.7, bookCols[(b + shelf) % bookCols.length], cx + sx - 1.8 + b * 0.44, sy + 0.42, cz - 5.5));
      }
    }
    cols.push({ x: cx + sx, z: cz - 5.5, r: 2.6 });
  }
  g.add(box(3.6, 0.25, 1.6, M.wood, cx, FLOOR_Y + 1.0, cz + 1));
  for (const [lx, lz] of [[-1.5, 0.5], [1.5, 0.5], [-1.5, -0.5], [1.5, -0.5]] as const) {
    g.add(box(0.22, 1.0, 0.22, M.woodDark, cx + lx, FLOOR_Y + 0.5, cz + 1 + lz));
  }
  const flaskCols = [M.teal, M.purple, M.gold];
  for (let i = 0; i < 3; i++) {
    const flask = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), flaskCols[i]);
    flask.position.set(cx - 1 + i, FLOOR_Y + 1.35, cz + 1 + (i % 2) * 0.4);
    g.add(flask);
  }
  cols.push({ x: cx, z: cz + 1, r: 2.2 });
  g.add(cyl(0.15, 0.25, 1.4, M.woodDark, cx + 5.5, FLOOR_Y + 0.7, cz + 4.5, 8));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.09, 8, 24), M.gold);
  ring.position.set(cx + 5.5, FLOOR_Y + 2.0, cz + 4.5);
  ring.rotation.y = 0.5;
  g.add(ring);
  cols.push({ x: cx + 5.5, z: cz + 4.5, r: 0.9 });
  return cols;
}

// ── Арена-колизей ────────────────────────────────────────────
function furnishArena(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // Арена — песчаный круг
  const arenaFloor = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 0.3, 24), M.hay);
  arenaFloor.position.set(cx, FLOOR_Y + 0.15, cz);
  arenaFloor.receiveShadow = true;
  g.add(arenaFloor);
  // Трибуны по кругу
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
    const tx = cx + Math.cos(a) * 9, tz = cz + Math.sin(a) * 9;
    g.add(box(3.5, 2.0, 1.2, M.stone, tx, FLOOR_Y + 1.0, tz, a));
    cols.push({ x: tx, z: tz, r: 2.2 });
    // Зрители на трибунах
    for (let i = 0; i < 3; i++) {
      const person = cyl(0.3, 0.3, 1.0, [M.red, M.teal, M.gold, M.purple, M.green][i % 5],
        tx + Math.cos(a) * (1.0 + i * 0.6), FLOOR_Y + 1.3, tz + Math.sin(a) * (1.0 + i * 0.6), 6);
      g.add(person);
    }
  }
  // Врата для гладиаторов
  g.add(box(0.5, 3.5, 3.0, M.woodDark, cx - 9.5, FLOOR_Y + 1.75, cz));
  g.add(box(3.0, 0.5, 3.0, M.woodDark, cx - 8.2, FLOOR_Y + 3.5, cz));
  cols.push({ x: cx - 9.5, z: cz, r: 2.0 });
  // Судейский постамент
  g.add(cyl(1.0, 1.2, 1.5, M.gold, cx + 7, FLOOR_Y + 0.75, cz - 7, 8));
  cols.push({ x: cx + 7, z: cz - 7, r: 1.4 });
  return cols;
}

// ── Аукционный дом ──────────────────────────────────────────
function furnishAuctionHouse(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // Центральный стол аукциониста
  g.add(box(4.0, 1.2, 2.0, M.woodDark, cx, FLOOR_Y + 0.6, cz - 4));
  cols.push({ x: cx, z: cz - 4, r: 2.6 });
  g.add(box(4.2, 0.15, 2.2, M.gold, cx, FLOOR_Y + 1.28, cz - 4));
  // Лоты на столе
  for (let i = 0; i < 4; i++) {
    const item = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.5 + Math.random() * 0.5, 0.6),
      [M.gold, M.iron, M.purple, M.teal][i]
    );
    item.position.set(cx - 1.2 + i * 0.8, FLOOR_Y + 1.55, cz - 4);
    g.add(item);
  }
  // Зрительские места
  for (const [ax, az] of [[-5, 2], [5, 2], [-5, -2], [5, -2]] as const) {
    g.add(box(2.5, 0.5, 2.5, M.wood, cx + ax, FLOOR_Y + 0.25, cz + az));
    cols.push({ x: cx + ax, z: cz + az, r: 1.6 });
  }
  // Стеллажи с лотами
  for (const sx of [-7, 7]) {
    g.add(box(0.4, 3.0, 5.0, M.woodDark, cx + sx, FLOOR_Y + 1.5, cz));
    for (let shelf = 0; shelf < 3; shelf++) {
      const sy = FLOOR_Y + 0.6 + shelf * 0.9;
      g.add(box(3.2, 0.1, 4.4, M.wood, cx + sx + (sx > 0 ? -1.5 : 1.5), sy, cz));
      // Предметы на полке
      for (let j = 0; j < 3; j++) {
        const item = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.4 + Math.random() * 0.4, 0.5),
          [M.gold, M.iron, M.purple, M.red][j]
        );
        item.position.set(cx + sx + (sx > 0 ? -1.5 : 1.5), sy + 0.3, cz - 1.2 + j * 1.2);
        g.add(item);
      }
    }
    cols.push({ x: cx + sx, z: cz, r: 2.2 });
  }
  return cols;
}

// ── Цирк ────────────────────────────────────────────────────
function furnishCircus(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // Центральная арена цирка
  const ringFloor = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.25, 20), M.hay);
  ringFloor.position.set(cx, FLOOR_Y + 0.12, cz);
  ringFloor.receiveShadow = true;
  g.add(ringFloor);
  // Канат для акробатов
  g.add(cyl(0.05, 0.05, 8, M.woodDark, cx, FLOOR_Y + 3.5, cz - 3, 6));
  g.add(cyl(0.05, 0.05, 8, M.woodDark, cx, FLOOR_Y + 3.5, cz + 3, 6));
  g.add(box(0.1, 0.1, 8, M.gold, cx - 4, FLOOR_Y + 3.5, cz, 0));
  g.add(box(0.1, 0.1, 8, M.gold, cx + 4, FLOOR_Y + 3.5, cz, 0));
  // Трибуны
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
    const tx = cx + Math.cos(a) * 7, tz = cz + Math.sin(a) * 7;
    g.add(box(2.8, 1.5, 1.0, M.red, tx, FLOOR_Y + 0.75, tz, a));
    cols.push({ x: tx, z: tz, r: 1.6 });
  }
  // Клоун и животные
  const clown = cyl(0.4, 0.5, 0.9, M.gold, cx + 2, FLOOR_Y + 0.45, cz + 1, 8);
  g.add(clown);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 8), M.red);
  hat.position.set(cx + 2, FLOOR_Y + 1.15, cz + 1);
  g.add(hat);
  cols.push({ x: cx + 2, z: cz + 1, r: 0.7 });
  // Собака-дрессировщик
  const dog = box(0.8, 0.5, 0.5, M.cream, cx - 2, FLOOR_Y + 0.25, cz - 1);
  g.add(dog);
  cols.push({ x: cx - 2, z: cz - 1, r: 0.7 });
  // Лабиринт для мышей
  g.add(box(3.0, 1.8, 3.0, M.wood, cx, FLOOR_Y + 0.9, cz + 4));
  g.add(box(2.8, 0.1, 2.8, M.hay, cx, FLOOR_Y + 1.85, cz + 4));
  cols.push({ x: cx, z: cz + 4, r: 1.8 });
  return cols;
}

// ── Комнаты ──────────────────────────────────────────────────
interface Room {
  def: BuildingDef;
  group: THREE.Group;
  /** Статичные круги комнаты (стены + мебель) — копируются при входе. */
  colliders: { x: number; z: number; r: number }[];
  exitDoor: THREE.Object3D;
}

function buildRoom(scene: THREE.Scene, def: BuildingDef): Room {
  const g = new THREE.Group();
  const cx = def.roomCx, cz = def.roomCz;
  const hw = ROOM_W / 2, hd = ROOM_D / 2;

  const floor = box(ROOM_W, 0.4, ROOM_D, M.stone, cx, FLOOR_Y - 0.2, cz);
  floor.receiveShadow = true;
  g.add(floor);
  const rugColor = def.kind === 'tavern' ? M.red : def.kind === 'science' ? M.purple : M.teal;
  g.add(box(ROOM_W * 0.4, 0.06, ROOM_D * 0.4, rugColor, cx, FLOOR_Y + 0.03, cz));

  const colliders: { x: number; z: number; r: number }[] = [];
  const wallRun = (
    x0: number, z0: number, x1: number, z1: number,
    mat: THREE.Material, h: number, t: number,
  ) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const wall = box(len, h, t, mat, (x0 + x1) / 2, FLOOR_Y + h / 2, (z0 + z1) / 2, -Math.atan2(z1 - z0, x1 - x0));
    g.add(wall);
    const n = Math.max(2, Math.ceil(len / 1.7));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      colliders.push({ x: x0 + (x1 - x0) * k, z: z0 + (z1 - z0) * k, r: 1.0 });
    }
  };

  // Север, запад, восток — целиком; юг — две части с проёмом двери.
  wallRun(cx - hw, cz - hd, cx + hw, cz - hd, M.wall, ROOM_WALL_H, ROOM_WALL_T);
  wallRun(cx - hw, cz - hd, cx - hw, cz + hd, M.wall, ROOM_WALL_H, ROOM_WALL_T);
  wallRun(cx + hw, cz - hd, cx + hw, cz + hd, M.wall, ROOM_WALL_H, ROOM_WALL_T);
  const gap = ROOM_DOOR_GAP / 2;
  wallRun(cx - hw, cz + hd, cx - gap, cz + hd, M.wall, ROOM_WALL_H, ROOM_WALL_T);
  wallRun(cx + gap, cz + hd, cx + hw, cz + hd, M.wall, ROOM_WALL_H, ROOM_WALL_T);
  // Перемычка над проёмом
  g.add(box(ROOM_DOOR_GAP + 1.2, ROOM_WALL_H - 3.4, ROOM_WALL_T, M.wall, cx, FLOOR_Y + 3.4 + (ROOM_WALL_H - 3.4) / 2, cz + hd));

  // Дверь выхода (клик = выйти). Круг в проёме не даёт выйти пешком —
  // только кликом: иначе игрок окажется в пустоте кармана.
  const exitDoor = box(2.4, 3.2, 0.25, M.woodDark, cx, FLOOR_Y + 1.6, cz + hd);
  exitDoor.userData = { doorBuilding: def.id, doorAction: 'exit', doorName: t(def.nameKey) };
  g.add(exitDoor);
  colliders.push({ x: cx, z: cz + hd, r: 1.4 });
  const exitSign = signMesh(t('buildings.exit'));
  exitSign.position.set(cx, FLOOR_Y + 3.9, cz + hd - 0.4);
  exitSign.rotation.y = Math.PI;
  g.add(exitSign);

  // Мебель по типу
  const furn = {
    stable: furnishStable,
    barracks: furnishBarracks,
    workshop: furnishWorkshop,
    tavern: furnishTavern,
    observatory: furnishObservatory,
    science: furnishScience,
    arena: furnishArena,
    auction_house: furnishAuctionHouse,
    circus: furnishCircus,
  caravanserai: furnishCaravanserai,
  }[def.kind] ?? furnishScience;
  for (const c of furn(g, cx, cz)) colliders.push(c);

  // Жаровни у стен
  brazier(g, cx - hw + 1.6, cz - hd + 1.6, FLOOR_Y);
  brazier(g, cx + hw - 1.6, cz - hd + 1.6, FLOOR_Y);
  colliders.push(
    { x: cx - hw + 1.6, z: cz - hd + 1.6, r: 0.9 },
    { x: cx + hw - 1.6, z: cz - hd + 1.6, r: 0.9 },
  );

  scene.add(g);
  return { def, group: g, colliders, exitDoor };
}

// ── Хендл ────────────────────────────────────────────────────
export interface InteriorsHandle {
  /** Все кликабельные двери (снаружи + выходы внутри). */
  clickTargets: THREE.Object3D[];
  def(id: string): BuildingDef | null;
  enter(id: string): BuildingDef | null;
  exit(): BuildingDef | null;
  isInside(): boolean;
  insideId(): string | null;
  insideDef(): BuildingDef | null;
  floorY(): number;
  dispose(): void;
}

export function createInteriors(scene: THREE.Scene): InteriorsHandle {
  const clickTargets: THREE.Object3D[] = [];
  const rooms = new Map<string, Room>();
  for (const def of BUILDINGS) {
    const room = buildRoom(scene, def);
    rooms.set(def.id, room);
    clickTargets.push(room.exitDoor);
  }
  // Двери экстерьеров добавляются через buildTownBuildings (возвращает свои цели).
  let inside: BuildingDef | null = null;

  return {
    clickTargets,
    def(id: string): BuildingDef | null {
      return rooms.get(id)?.def ?? null;
    },
    enter(id: string): BuildingDef | null {
      const room = rooms.get(id);
      if (!room) return null;
      inside = room.def;
      INTERIOR_COLLIDERS.length = 0;
      for (const c of room.colliders) INTERIOR_COLLIDERS.push({ ...c });
      return room.def;
    },
    exit(): BuildingDef | null {
      const was = inside;
      inside = null;
      INTERIOR_COLLIDERS.length = 0;
      return was;
    },
    isInside(): boolean {
      return inside !== null;
    },
    insideId(): string | null {
      return inside?.id ?? null;
    },
    insideDef(): BuildingDef | null {
      return inside;
    },
    floorY(): number {
      return FLOOR_Y;
    },
    dispose(): void {
      for (const room of rooms.values()) {
        room.group.traverse(o => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            const m = o.material as THREE.Material | THREE.Material[];
            if (Array.isArray(m)) m.forEach(x => x.dispose());
            else m.dispose();
          }
        });
        scene.remove(room.group);
      }
      INTERIOR_COLLIDERS.length = 0;
    },
  };
}
