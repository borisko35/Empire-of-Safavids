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
import type { DestructibleKind } from './destructible';
import { createDestructibleCrate, createDestructibleBarrel, createDestructibleVase } from './destructible';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// Столы с документами берём из правила: сервер проверяет по тем же
// координатам, иначе игрок увидит одно, а проверят другое.
import { DOCUMENT_SPOTS } from '../../../../shared/stealth';
import { t } from '../i18n';
import { CITY, addCollider, windowPane, decorВещь } from './terrain';
import { createCrate, createOilJug, createAwning, registerInteractive, InteractiveKind } from './interactive';
// Модели закрыты входом: заголовок ставится при создании загрузчика
// (см. modelAccess.ts).
import { сВходом } from './modelAccess';
import { декодерDraco } from './draco';
import { plasterTexture, stoneTexture, woodTexture, roofTileTexture, roofTileNormalTexture, hayTexture, hayNormalTexture, ironTexture, ironNormalTexture, woodDarkTexture, woodDarkNormalTexture, wallDarkTexture, wallDarkNormalTexture, clothTexture, waterNormalTexture, foliageTexture, foliageNormalTexture } from './textures';
import { STELE, inscriptionFor, steleMesh } from './inscriptions';
// Фигура стража внутри крепости. Без неё пост в правиле остался бы невидимым
// глазом: игрок не понял бы, откуда его заметили. Импорт добавлен вместе с
// постом в shared/stealth.ts, а не отдельно от него.
import { buildHumanoid, HumanoidCfg, ПРЕДМЕТ } from './rig';
// Настоящие модели стражей: общий загрузчик realRig и клонирование скелета.
import { загрузитьСцену, загрузитьКлип, подогнать, безМёртвыхДорожек } from './realRig';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
// Фигура стража внутри крепости. Без неё пост в правиле был бы невидимым глазом:
// игрок не понимает, откуда его заметили. Импорт добавлен вместе с постом,
// а не отдельно.

// ── Стражи на настоящих моделях ─────────────────────────────
//
// Процедурный страж ставится сразу: коллайдер и вид появляются синхронно.
// Настоящая модель едет следом и подменяет процедурную, когда доедет; нет
// файла — стоит процедурная фигура, игра не падает. Миксеры собираются в
// общий список: кадр двигает их world3d рядом с миксерами коров
// (updateCows) — отдельного цикла у интерьеров нет.
const СТРАЖИ_МИКСЕРЫ: THREE.AnimationMixer[] = [];

export function обновитьСтражей(dt: number): void {
  for (const м of СТРАЖИ_МИКСЕРЫ) м.update(dt);
}

/**
 * Ставит стража на пост: процедурная фигура сразу, настоящая модель — когда
 * приедет. y передаёт вызывающий: крепостной страж стоит на каменном
 * помосте (FLOOR_Y + 0.7), дворцовый — на полу (FLOOR_Y): одна формула на
 * оба поста ставила дворцового в воздух.
 */
function поставитьСтражаНаПост(
  g: THREE.Group,
  x: number,
  y: number,
  z: number,
  вид: HumanoidCfg,
): void {
  const rig = buildHumanoid(вид);
  rig.group.position.set(x, y, z);
  g.add(rig.group);
  void (async () => {
    const [scene, idle] = await Promise.all([
      загрузитьСцену('guard-qizilbash'),
      загрузитьКлип('standing-idle'),
    ]);
    if (!scene || !idle) return;
    try {
      const подогнанная = подогнать(scene, 'guard-qizilbash');
      const clone = cloneSkeleton(подогнанная) as THREE.Group;
      clone.position.set(x, y, z);
      const mixer = new THREE.AnimationMixer(clone);
      const чистый = безМёртвыхДорожек(idle, clone, 'guard-qizilbash');
      mixer.clipAction(чистый).reset().setLoop(THREE.LoopRepeat, Infinity).play();
      СТРАЖИ_МИКСЕРЫ.push(mixer);
      rig.group.visible = false;
      g.add(clone);
    } catch (e) {
      console.warn('[interior] guard model failed', e);
    }
  })();
}

export type BuildingKind = 'stable' | 'barracks' | 'workshop' | 'tavern' | 'observatory' | 'science' | 'arena' | 'auction_house' | 'circus' | 'caravanserai' | 'fortress' | 'palace' | 'mosque' | 'weaver' | 'customs' | 'shrine' | 'tomb' | 'hanza' | 'catacombs' | 'palace_dungeon' | 'khorasan_caves' | 'caucasus_fort' | 'baghdad_citadel' | 'simurgh_temple';

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
  // Крепость на перевале. ТОЛЬКО ПОСЛЕ караван-сарая: слот комнаты
  // считается индексом (POCKET_X + i * ROOM_DX), а на сервере зашит
  // числом. Вставка выше сдвинет слоты всех, кто ниже, и комнаты
  // разъедутся по координатам.
  //
  // Дверь промерена: FORT (-320,-705) на склоне, вода на юге (waterMask
  // 0.68), на (-320,-677) сухо (0.000). Выход - 4 единицы от центра, как
  // у караван-сарая (505,69 -> 505,73). До других дверей 750+ единиц.
  { id: 'fortress', kind: 'fortress', nameKey: 'buildings.fortress', icon: '🏰', dx: -320, dz: -677, ex: -320, ez: -673 },
    // Дворец. В мире стоит восточнее города, дальше любой другой постройки.
    // Слот 11, и он последний: комнаты дальше не строятся.
  { id: 'palace', kind: 'palace', nameKey: 'buildings.palace', icon: '👑', dx: 620, dz: -300, ex: 620, ez: -296 },
  // Мечеть. Ставится севернее города, ближе всех прочих сухих точек:
  { id: 'mosque', kind: 'mosque', nameKey: 'buildings.mosque', icon: '🕌', dx: -20, dz: -480, ex: -20, ez: -476 },
  // Ткацкая с кладовой: восточнее дворца, там, где сухо по замеру.
  { id: 'weaver', kind: 'weaver', nameKey: 'buildings.weaver', icon: '🧵', dx: 820, dz: -260, ex: 820, ez: -256 },
  // Таможенный двор. Западнее города: проверяет идущих снаружи внутрь.
  { id: 'customs', kind: 'customs', nameKey: 'buildings.customs', icon: '⚖️', dx: -900, dz: 800, ex: -900, ez: 804 },
  // Зороастрийское святилище. Юго-восток карты, дальше всех построек.
  { id: 'shrine', kind: 'shrine', nameKey: 'buildings.shrine', icon: '🔥', dx: 1200, dz: 1200, ex: 1200, ez: 1204 },
  // Гробница Шеиха. Юго-восток, дальше святилища: своё место, не чужой зал.
  { id: 'tomb', kind: 'tomb', nameKey: 'buildings.tomb', icon: '⚰️', dx: 1400, dz: 1400, ex: 1400, ez: 1404 },
  // Ханжа: «Рассказ через детали». Северо-восток от святилища.
  { id: 'hanza', kind: 'hanza', nameKey: 'buildings.hanza', icon: '📜', dx: 1600, dz: 1000, ex: 1600, ez: 1004 },
  // Катакомбы Тебриза: первое подземелье с геометрией. Вход снаружи —
  // это дверь в мире, а комната стоит в кармане рядом.
  { id: 'catacombs', kind: 'catacombs', nameKey: 'buildings.catacombs', icon: '🕳', dx: -520, dz: -340, ex: -520, ez: -336 },
  // Дворец Сорока Колонн как подземелье: сад с янычарами и тронный зал.
  { id: 'palace_dungeon', kind: 'palace_dungeon', nameKey: 'buildings.palace_dungeon', icon: '🏛', dx: -160, dz: 240, ex: -160, ez: 244 },
  // Пещеры Хорасана: вход в пещеру и зал вечного огня с арззангом.
  { id: 'khorasan_caves', kind: 'khorasan_caves', nameKey: 'buildings.khorasan_caves', icon: '🕯', dx: 780, dz: -620, ex: 780, ez: -616 },
  // Крепость Кавказа: ворота, стена и башня бури с джиннами.
  { id: 'caucasus_fort', kind: 'caucasus_fort', nameKey: 'buildings.caucasus_fort', icon: '🛡', dx: -880, dz: 520, ex: -880, ez: 524 },
  // Багдадская цитадель: рейд на двадцать человек. ПОСЛЕДНЯЯ ЗАПИСЬ, и
  // это обязательно: слот комнаты считается индексом (POCKET_X + i * ROOM_DX),
  // а на сервере зашит числом (4968 = 4000 + 22*44). Вставка выше сдвинет
  // слоты всех, кто ниже, и комнаты разъедутся по координатам.
  //
  // Дверь снаружи (200, −392) — рядом со спавном паши в мире (200, −380):
  // точка не выдумана, босс на ней уже стоит.
  { id: 'baghdad_citadel', kind: 'baghdad_citadel', nameKey: 'buildings.baghdad_citadel', icon: '🏰', dx: 200, dz: -392, ex: 200, ez: -388 },
  // Храм Симурга: рейд на двадцать человек. ПОСЛЕДНЯЯ ЗАПИСЬ, и это
  // обязательно: слот комнаты считается индексом, а на сервере зашит числом
  // (5012 = 4000 + 23*44). Вставка выше сдвинет слоты всех, кто ниже.
  //
  // Дверь (0, 1412) — земля под гнездом Симурга: сам босс висит в воздухе на
  // y=100, и вход на его точке спавна увёл бы игрока в небо.
  { id: 'simurgh_temple', kind: 'simurgh_temple', nameKey: 'buildings.simurgh_temple', icon: '🕌', dx: 0, dz: 1412, ex: 0, ez: 1416 },
];

export const POCKET_X = 4000;
export const POCKET_Z = 4000;
const ROOM_DX = 44;
export const ROOM_W = 22;
export const ROOM_D = 16;
/**
 * Размер зала подземелий: 32x32, половина 16.
 *
 * Совпадает с серверной ROOM_HALF = 16 (server/src/data/interiors.ts):
 * сервер раскладывает монстров и сундуки по залу 32, и клиент обязан
 * строить тот же зал, иначе мебель встаёт за стеной. Комнаты зданий
 * остаются 22x16 — их обстановка влезает.
 */
export const DUNGEON_W = 32;
export const DUNGEON_D = 32;
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
 *
 *  ПРАВИЛО РАСШИРЕНИЯ. Прямоугольник - единственный источник: плита земли,
 *  функция уровня и коллайдеры периметра строятся из него по циклу (строки
 *  ниже). Поэтому расширять надо только это число, и стена посреди мира не
 *  появится. Именно так и было сломано в прошлый раз: когда карман стоял на
 *  2470..2880, он налезал на новую дальнюю землю, и посреди мира стоял
 *  невидимый забор, а под ногами была нулевая земля.
 *
 *  Одиннадцатая комната (крепость) ставится на 4440 и занимает 4424..4456.
 *  Для неё x1 поднят с 4440 до 4484: иначе комната вылезла бы за границу.
 *  Новый запас справа - 28 единиц, слева по-прежнему 24.
 */
// Правая граница — центр ПОСЛЕДНЕЙ комнаты, не её край. Так было и при
// караван-сарае, и при крепости: полоса от края комнаты до центра
// следующей нужна, чтобы промежуток между комнатами тоже был землёй.
//
// ДВАДЦАТЬ ВТОРАЯ КОМНАТА, СЛОТ 22, ЦЕНТР 4968. Граница поднята с 4968
// до 5012: комната слота 22 занимает 4952..4984, и при прежней границе
// она вылезала бы за неё на 16 единиц. Сдвиг ровно на шаг комнаты (44).
export const POCKET_RECT = { x0: 3960, x1: 5056, z0: 3960, z1: 4040 };
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

function furnishFortress(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
    const cols: { x: number; z: number; r: number }[] = [];
    // ── Казармы: два ряда нар под низкой крышей, посередине проход ──
    for (const sx of [-7.5, 7.5]) {
      for (const sz of [-5.5, -1.5, 2.5]) {
        g.add(box(3.4, 0.22, 1.5, M.wood, cx + sx, FLOOR_Y + 0.11, cz + sz));
        g.add(box(0.5, 0.9, 1.2, M.hay, cx + sx - (sx > 0 ? 1.5 : -1.5), FLOOR_Y + 0.55, cz + sz));
      }
      cols.push({ x: cx + sx, z: cz - 1.5, r: 2.4 });
    }
    // ── Арсенал: стойки с копьями у северной стены ──
    for (let i = 0; i < 3; i++) {
      const ax = cx - 5 + i * 5;
      g.add(box(0.3, 1.6, 3.2, M.woodDark, ax - 1.4, FLOOR_Y + 0.8, cz - 6.6));
      g.add(box(0.3, 1.6, 3.2, M.woodDark, ax + 1.4, FLOOR_Y + 0.8, cz - 6.6));
      // Копья стоят в стойке пучком: древко тонкое, наконечник золотой.
      g.add(cyl(0.08, 2.4, 0.08, M.woodDark, ax, FLOOR_Y + 1.2, cz - 6.6));
      g.add(cyl(0.12, 0.3, 0.12, M.gold, ax, FLOOR_Y + 2.5, cz - 6.6));
      cols.push({ x: ax, z: cz - 6.6, r: 1.6 });
    }
    // ── Темница: три клетки с решётками, отгороженные от коридора ──
    for (let i = 0; i < 3; i++) {
      const kx = cx - 6 + i * 4;
      // Решётка: четыре вертикальных прута и два поперечных.
      for (let b = 0; b < 4; b++) {
        g.add(box(0.16, 2.6, 0.16, M.dark, kx - 1.1 + b * 0.73, FLOOR_Y + 1.3, cz + 6.4));
      }
      g.add(box(2.4, 0.16, 0.16, M.dark, kx, FLOOR_Y + 2.4, cz + 6.4));
      g.add(box(2.4, 0.16, 0.16, M.dark, kx, FLOOR_Y + 0.3, cz + 6.4));
      // Солома на полу клетки и узкое окошко в перегородке.
      g.add(box(2.2, 0.08, 2.2, M.hay, kx, FLOOR_Y + 0.04, cz + 7.4));
      cols.push({ x: kx, z: cz + 6.9, r: 1.5 });
    }
    // ── Смотровая площадка: каменный помост в углу, смотровая башня ──
    g.add(box(3.6, 0.7, 3.6, M.stone, cx - 8.2, FLOOR_Y + 0.35, cz + 5.6));
    g.add(cyl(0.28, 3.4, 0.28, M.stone, cx - 8.2, FLOOR_Y + 1.7, cz + 5.6));
    cols.push({ x: cx - 8.2, z: cz + 5.6, r: 1.9 });
    // ── Страж на смотровой площадке ──
    // Фигура видимая, и её координата - ровно та, что в правиле стелса:
    // cx - 8, cz + 6. Проверка fortressWatch.test.ts считает ту же формулу
    // и сравнивает с постом, поэтому страж не может «отойти» от своего места
    // молча. В латах он не смотрит на точку схода - взгляд у постов круговой,
    // направление заведено только для торговца.
    // Смотровая площадка на FLOOR_Y + 0.7 — страж стоит на ней, а не в воздухе.
    поставитьСтражаНаПост(g, cx - 8, FLOOR_Y + 0.7, cz + 6, { robe: 0x6e4a20, robeDark: 0x4a3115, hat: 'helmet', hatColor: 0x8a7a5a, weapon: 'sword', shield: true, scale: 1.04 });
    cols.push({ x: cx - 8, z: cz + 6, r: 1.1 });
    return cols;
  }
    


// Дворец Сорока Колонн: тронный зал.
//
// Имя дворца обещает колонны, и здесь их двадцать: десять у дальней стены,
// десять вдоль боковых. Считать двадцать можно прямо на экране — это дешевле,
// чем спорить с текстом описания.
//
// Что ещё просили в тронном зале: ковёр, трон, столы по сторонам и стеллажи с
// книгами (библиотека из списка владельца). Всё в одной комнате: в модели
// интерьеров переходов между комнатами нет, и делать четыре комнаты из одной
// означало бы выдумать систему, которой нет.
const THRONE_MODEL = 'decor/throne.glb';
let throneCache: Promise<THREE.Group | null> | null = null;

/** Готовая модель трона с текстурой. Кеш общий: трон в зале один. */
function loadThroneModel(): Promise<THREE.Group | null> {
  if (throneCache) return throneCache;
  throneCache = new Promise<THREE.Group | null>((готово) => {
    try {
      const l = сВходом(new GLTFLoader());
      l.setDRACOLoader(декодерDraco());
      l.load(
        `/game/models/${THRONE_MODEL}`,
        (gltf) => готово((gltf.scene as THREE.Group) ?? null),
        undefined,
        () => готово(null),
      );
    } catch {
      готово(null);
    }
  });
  return throneCache;
}

// Зал таверны — glb-диорама вместо процедурной коробки: пол, стены, стойка,
// столы, сцена и верхняя галерея. Пол модели на 0.40 = FLOOR_Y, начало модели —
// центр зала, разворота нет. Текстуры свои (16 webp), материалы переведены с
// unlit на lit — иначе зал не брал бы свет жаровен и светился ночью.
const TAVERN_ROOM_MODEL = 'decor/tavern-room.glb';
let tavernRoomCache: Promise<THREE.Group | null> | null = null;

/** Диорама зала таверны с текстурами. Кеш общий: зал в кармане один. */
function loadTavernRoomModel(): Promise<THREE.Group | null> {
  if (tavernRoomCache) return tavernRoomCache;
  tavernRoomCache = new Promise<THREE.Group | null>((готово) => {
    try {
      const l = сВходом(new GLTFLoader());
      l.setDRACOLoader(декодерDraco());
      l.load(
        `/game/models/${TAVERN_ROOM_MODEL}`,
        (gltf) => готово((gltf.scene as THREE.Group) ?? null),
        undefined,
        () => готово(null),
      );
    } catch {
      готово(null);
    }
  });
  return tavernRoomCache;
}

// Комод-консоль зала: резное красное дерево с родными PBR-текстурами.
const DRAWER_MODEL = 'decor/drawer.glb';
let drawerCache: Promise<THREE.Group | null> | null = null;

/** Комод зала таверны. Кеш общий: комод в зале один. */
function loadDrawerModel(): Promise<THREE.Group | null> {
  if (drawerCache) return drawerCache;
  drawerCache = new Promise<THREE.Group | null>((готово) => {
    try {
      const l = сВходом(new GLTFLoader());
      l.setDRACOLoader(декодерDraco());
      l.load(
        `/game/models/${DRAWER_MODEL}`,
        (gltf) => готово((gltf.scene as THREE.Group) ?? null),
        undefined,
        () => готово(null),
      );
    } catch {
      готово(null);
    }
  });
  return drawerCache;
}
function furnishPalace(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // ── Колонны: два ряда по десять ──
  // Ряды идут по диагонали зала и целиком внутри комнаты (z от −7 до +6.5
  // при стене на ±8). Раньше шаг был 2.05 от −9: последняя пара вставала на
  // +9.45, то есть ЗА южной стеной, и её не было видно — а описание обещает
  // двадцать сосчитанных колонн. Их по-прежнему двадцать: 10 × 2 стороны.
  for (let i = 0; i < 10; i++) {
    for (const side of [-1, 1]) {
      const px = cx + side * (2.2 + i * 0.75);
      const pz = cz - 7 + i * 1.5;
      // Колонна — готовая модель (Quaternius), база и капитель в ней же.
      // БЫЛО: цилиндр с золотой шайбой наверху.
      decorВещь(g, 'column-round-2', px, pz, { размер: 4.6, y: FLOOR_Y, ry: side * 0.4 + i * 0.3 });
      cols.push({ x: px, z: pz, r: 0.7 });
    }
  }
  // ── Трон у северной стены, на ковре ──
  // Трон напротив двери (юг): входящий видит его сразу, а не за спиной.
  g.add(box(9, 0.06, 7, M.woodDark, cx, FLOOR_Y + 0.03, cz - 4.5));
  g.add(box(9, 0.06, 7, M.red, cx, FLOOR_Y + 0.05, cz - 4.5));
  // Сам трон — готовая модель с текстурой (красная кожа, золото, камень),
  // а не коробки. Рендер в Blender подтвердил: смотрит в +Z, то есть ровно
  // на дверь, доворот не нужен. Грузится асинхронно: нет файла — стоит
  // пустой ковёр, игра не падает.
  void loadThroneModel().then((модель) => {
    if (!модель) return;
    const трон = модель.clone();
    трон.position.set(cx, FLOOR_Y, cz - 8);
    трон.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    g.add(трон);
  });
  cols.push({ x: cx, z: cz - 8, r: 1.4 });
  // ── Столы по сторонам ──
  for (const side of [-1, 1]) {
    // Стол — готовая модель (Quaternius). БЫЛО: доска на двух цилиндрах.
    decorВещь(g, 'table-round-large', cx + side * 8.2, cz + 1, {
      размер: 2.2, по: 'horizontal', y: FLOOR_Y, ry: side * 0.5,
    });
    cols.push({ x: cx + side * 8.2, z: cz + 1, r: 1.3 });
  }
  // ── Стеллажи с книгами у боковых стен ──
  for (const side of [-1, 1]) {
    const px = cx + side * 9.6;
    // Стеллаж — готовый шкаф с книгами (Quaternius), длинной стеной вдоль зала.
    // БЫЛО: коробка с тремя полками и двумя брусками «книг».
    decorВещь(g, 'bookshelf', px, cz + 3, {
      размер: 2.2, по: 'horizontal', y: FLOOR_Y, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2,
    });
    cols.push({ x: px, z: cz + 3, r: 1.5 });
  }
  // ── Жаровни у входа ──
  // Стоят по бокам двери внутри зала. Раньше были на cz + 8.4, то есть за
  // южной стеной (стена на +8): их не было видно, как и последнюю пару колонн.
  brazier(g, cx - 2.5, cz + 6.9, FLOOR_Y);
  brazier(g, cx + 2.5, cz + 6.9, FLOOR_Y);
  // ── Страж тронного зала ──
  // Фигура видимая, и её координата — ровно та, что в правиле стелса:
  // cx - 8, cz + 6 = (4476, 4006). Проверка сверяет ту же формулу.
  // Копья у гвардейца нет в наборе оружия (sword, staff, bow, dagger, rapier,
  // none), поэтому страж вооружён саблей — как и страж крепости. Выдумывать
  // «копьё» ради одного дворца значит расширять общий перечень из-за детали.
  // Дворцовый страж стоит на полу тронного зала: прежняя формула держала
  // FLOOR_Y + 0.7 от крепостного помоста, и фигура висела над ковром.
  поставитьСтражаНаПост(g, cx - 8, FLOOR_Y, cz + 6, { robe: 0x2f3f6e, robeDark: 0x1e2946, hat: 'helmet', hatColor: 0xb08d3a, weapon: 'sword', shield: true, scale: 1.06 });
  cols.push({ x: cx - 8, z: cz + 6, r: 1.1 });
  return cols;
}

// Мечеть и медресе: молитвенный зал, галерея, комнаты учеников.
//
// Что просили: михраб и купол снаружи (купол уже стоит на площади), внутри —
// молитвенный зал, галереи, комнаты учеников, библиотека. Всё в одной
// комнате: в модели интерьеров переходов между комнатами нет.
function furnishMosque(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // ── Михраб в глубине: ниша в северной стене, смотрит на Мекку ──
  g.add(box(3.2, 3.4, 0.5, M.gold, cx, FLOOR_Y + 1.7, cz - 10.2));
  g.add(box(2.2, 2.4, 0.3, M.dark, cx, FLOOR_Y + 1.2, cz - 9.9));
  cols.push({ x: cx, z: cz - 9.6, r: 1.5 });
  // ── Ковёр перед михрабом ──
  g.add(box(7, 0.05, 9, M.red, cx, FLOOR_Y + 0.03, cz - 4));
  // ── Галерея: два ряда колонн вдоль боков ──
  for (let i = 0; i < 7; i++) {
    for (const side of [-1, 1]) {
      const px = cx + side * 7.2;
      const pz = cz - 8 + i * 2.4;
      g.add(cyl(0.24, 4.2, 0.24, M.stone, px, FLOOR_Y + 2.1, pz));
      g.add(box(0.7, 0.24, 0.7, M.gold, px, FLOOR_Y + 4.1, pz));
      cols.push({ x: px, z: pz, r: 0.6 });
    }
  }
  // ── Комнаты учеников: низкие столы и скамейки у дальней стены ──
  // Стол низкий и без стульев: ученики сидят на ковре, как в медресе,
  // и комната выглядит учебной, а не столовой.
  for (let i = 0; i < 3; i++) {
    const px = cx - 5.4 + i * 5.4;
    g.add(box(3.6, 0.14, 1.3, M.wood, px, FLOOR_Y + 0.4, cz + 6.2));
    g.add(box(3.4, 0.1, 0.9, M.hay, px, FLOOR_Y + 0.18, cz + 7.4));
    cols.push({ x: px, z: cz + 6.8, r: 1.5 });
  }
  // ── Библиотека: стеллажи с сурами у боковых стен ──
  for (const side of [-1, 1]) {
    const px = cx + side * 9.8;
    g.add(box(0.9, 2.8, 6, M.woodDark, px, FLOOR_Y + 1.4, cz + 3));
    for (let s = 0; s < 3; s++) {
      g.add(box(0.8, 0.1, 5.6, M.wood, px, FLOOR_Y + 0.6 + s * 0.9, cz + 3));
      g.add(box(0.7, 0.42, 2.8, M.hay, px, FLOOR_Y + 0.86 + s * 0.9, cz + 2.1));
      g.add(box(0.7, 0.34, 2.1, M.wood, px, FLOOR_Y + 0.8 + s * 0.9, cz + 4.6));
    }
    cols.push({ x: px, z: cz + 3, r: 1.4 });
  }
  // ── Жаровни у входа ──
  brazier(g, cx - 9.6, cz + 9.4, FLOOR_Y);
  brazier(g, cx + 9.6, cz + 9.4, FLOOR_Y);
  return cols;
}

// Ткацкая и кладовая: станки, рулоны ткани, мешки и полки.
//
// Кузница деревни — это workshop, она уже построена. Здесь вторая часть:
// ткацкая и кладовая рядом, потому что ткань снимают со станка и сразу
// убирают в мешки на полки. Одна комната — как и все прочие.
function furnishWeaver(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // ── Станки у дальней стены: рама, основание, вал и нити основы ──
  for (let i = 0; i < 3; i++) {
    const px = cx - 6 + i * 6;
    g.add(box(3.2, 0.24, 1.2, M.woodDark, px, FLOOR_Y + 0.12, cz - 7));
    // Вертикальные стойки рамы.
    for (const sx of [-1.4, 1.4]) {
      g.add(box(0.18, 2.6, 0.18, M.wood, px + sx, FLOOR_Y + 1.4, cz - 7));
    }
    // Верхний вал и натянутые нити: нити тонкие и светлые.
    g.add(cyl(0.14, 3.2, 0.14, M.woodDark, px, FLOOR_Y + 2.5, cz - 7, 8));
    g.add(box(3, 2.2, 0.05, M.hay, px, FLOOR_Y + 1.5, cz - 7));
    // Готовый кусок ткани свисает с вала.
    g.add(box(2.6, 1.2, 0.08, M.red, px, FLOOR_Y + 1.2, cz - 6.4));
    cols.push({ x: px, z: cz - 7, r: 2.1 });
  }
  // ── Стеллаж с рулонами ткани у боковой стены ──
  g.add(box(1.2, 3, 7, M.woodDark, cx - 9.8, FLOOR_Y + 1.5, cz + 1));
  for (let s = 0; s < 3; s++) {
    g.add(box(1.1, 0.12, 6.4, M.wood, cx - 9.8, FLOOR_Y + 0.7 + s * 1.1, cz + 1));
    // Рулоны лежат вдоль полки — видно их торцами.
    for (let r = 0; r < 3; r++) {
      const roll = cyl(0.34, 1.9, 0.34, r % 2 ? M.red : M.gold, cx - 9.8, FLOOR_Y + 1.1 + s * 1.1, cz - 1.2 + r * 2.2, 8);
      roll.rotation.x = Math.PI / 2;
      g.add(roll);
    }
  }
  cols.push({ x: cx - 9.8, z: cz + 1, r: 1.6 });
  // ── Кладовая: мешки и корзины у порога ──
  // Ближе к двери: занятого снегут первым, и видно от входа.
  for (const [mx, mz] of [[7.2, 6.5], [8.8, 5.2], [6.4, 8.2], [9.6, 7.4]] as const) {
    g.add(box(1.2, 1.1, 1.0, M.hay, cx + mx, FLOOR_Y + 0.55, cz + mz));
    cols.push({ x: cx + mx, z: cz + mz, r: 0.8 });
  }
  // ── Рабочий стол с ножницами и мотками ──
  g.add(box(4, 0.16, 1.6, M.wood, cx + 3, FLOOR_Y + 0.9, cz + 1));
  for (const sx of [-1.6, 1.6]) {
    g.add(box(0.2, 0.9, 0.2, M.woodDark, cx + 3 + sx, FLOOR_Y + 0.45, cz + 1));
  }
  for (let i = 0; i < 4; i++) {
    const mot = cyl(0.22, 0.22, 0.3, i % 2 ? M.gold : M.red, cx + 1.4 + i * 0.9, FLOOR_Y + 1.08, cz + 1, 8);
    mot.rotation.z = Math.PI / 2;
    g.add(mot);
  }
  cols.push({ x: cx + 3, z: cz + 1, r: 2.2 });
  // ТКАЧ у среднего станка: корзина с пряжей в руке.
  мастер(g, cx, cz, 0, -5.6, Math.PI, {
    robe: 0x6a3a72, robeDark: 0x4a284f, hat: 'none', hatColor: 0x3a2038,
    weapon: 'none', предмет: ПРЕДМЕТ.корзина, scale: 1.02,
  });
  return cols;
}

// Таможенный двор: стойка досмотра, шлагбаум, весы, конфискат, архив.
//
// Что просили: вышки, шлагбаум, навесы; комната стражника, склад
// конфиската, архив. Здесь всё, кроме вышек — они снаружи, как и у
// крепости. Одна комната: переходов между комнатами в модели нет.
function furnishCustoms(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // ── Шлагбаум поперёк прохода: столб с перекладиной ──
  // Стоит у северной стены: въезд, откуда игрок входит.
  g.add(cyl(0.3, 3.4, 0.3, M.woodDark, cx - 3.4, FLOOR_Y + 1.7, cz - 9));
  g.add(box(6.8, 0.24, 0.24, M.red, cx, FLOOR_Y + 3.2, cz - 9));
  cols.push({ x: cx - 3.4, z: cz - 9, r: 0.9 });
  // ── Стойка досмотра: стол с разборчивым ящиком и весами ──
  g.add(box(3.4, 0.16, 1.4, M.woodDark, cx - 2.2, FLOOR_Y + 0.9, cz - 3.4));
  for (const lx of [-1.5, 1.5]) {
    g.add(box(0.18, 0.9, 0.18, M.woodDark, cx - 2.2 + lx, FLOOR_Y + 0.45, cz - 3.4));
  }
  g.add(box(1, 0.3, 0.7, M.dark, cx - 2.2, FLOOR_Y + 1.13, cz - 3.4));
  // Весы: чаша на столбе. Именно веса, а не гиря: караул взвешивает.
  g.add(cyl(0.08, 0.9, 0.08, M.gold, cx - 3.6, FLOOR_Y + 1.45, cz - 3.2, 8));
  g.add(box(1.2, 0.1, 0.1, M.gold, cx - 3.6, FLOOR_Y + 1.85, cz - 3.2));
  g.add(box(0.7, 0.14, 0.7, M.gold, cx - 4.1, FLOOR_Y + 1.5, cz - 3.2));
  cols.push({ x: cx - 2.2, z: cz - 3.4, r: 1.8 });
  // ── Стол стражника у восточной стены: книга, перо, фонарь ──
  g.add(box(2.6, 0.14, 1.1, M.wood, cx + 7.4, FLOOR_Y + 0.9, cz - 2));
  for (const lz of [-0.8, 0.8]) {
    g.add(box(0.16, 0.9, 0.16, M.woodDark, cx + 7.4, FLOOR_Y + 0.45, cz - 2 + lz));
  }
  g.add(box(0.7, 0.08, 0.5, M.hay, cx + 7.1, FLOOR_Y + 1.01, cz - 2));
  g.add(cyl(0.06, 0.5, 0.06, M.gold, cx + 7.9, FLOOR_Y + 1.24, cz - 2, 8));
  cols.push({ x: cx + 7.4, z: cz - 2, r: 1.5 });
  // ── Навес над стойкой: четыре столба и крыша ──
  // Без навеса караул стоит под открытым небом, а дождь срывает досмотр.
  for (const px of [-5.4, 1]) {
    for (const pz of [-6.4, -0.6]) {
      g.add(cyl(0.16, 3, 0.16, M.wood, cx + px, FLOOR_Y + 1.5, cz + pz, 8));
    }
  }
  g.add(box(7.6, 0.2, 6.4, M.woodDark, cx - 2.2, FLOOR_Y + 3.1, cz - 3.5));
  // ── Склад конфиската у дальней стены: ящики и бочки под пломбой ──
  for (const [bx, bz] of [[-6, 6], [-3.6, 6.6], [-6, 8.4], [-3.6, 9], [-1.2, 6.4], [-1.2, 8.8]] as const) {
    g.add(box(1.8, 1.2, 1.4, M.wood, cx + bx, FLOOR_Y + 0.6, cz + bz));
    // Пломба: тонкая доска поперёк ящика.
    g.add(box(1.9, 0.1, 0.2, M.gold, cx + bx, FLOOR_Y + 1.05, cz + bz));
  }
  cols.push({ x: cx - 3.6, z: cz + 7.5, r: 2.6 });
  for (const [kx, kz] of [[2, 6.6], [4.4, 8.4]] as const) {
    g.add(cyl(0.8, 0.9, 1.4, M.woodDark, cx + kx, FLOOR_Y + 0.7, cz + kz, 10));
    cols.push({ x: cx + kx, z: cz + kz, r: 0.9 });
  }
  // ── Архив у западной стены: стеллажи со свитками ──
  // Свитки, а не книги: в архиве таможни лежат списки и квитанции.
  g.add(box(1.1, 3.2, 7, M.woodDark, cx - 9.8, FLOOR_Y + 1.6, cz + 2));
  for (let s = 0; s < 3; s++) {
    g.add(box(1, 0.12, 6.4, M.wood, cx - 9.8, FLOOR_Y + 0.7 + s * 1.1, cz + 2));
    for (let r = 0; r < 4; r++) {
      const sv = cyl(0.16, 1.2, 0.16, M.hay, cx - 9.8, FLOOR_Y + 0.9 + s * 1.1, cz - 0.6 + r * 1.7, 8);
      sv.rotation.z = Math.PI / 2;
      g.add(sv);
    }
  }
  cols.push({ x: cx - 9.8, z: cz + 2, r: 1.5 });
  return cols;
}

// Зороастрийское святилище: проломы в стенах, обломки, рельефы с фресками,
// алтарь с огнём.
//
// Что просили: полуразрушенные стены, рельефы; ниши, фрески; ловушки,
// артефакты, проклятые предметы. Здесь первое: стены с проломами, обломки
// у основания, четыре рельефа и ниши с фресками. Ловушки и проклятия — это
// механика, а не мебель, и их здесь нет.
function furnishShrine(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // ── Обломки у основания: провалившиеся куски стены ──
  // Лежат куском, а не ровным рядом: стена рушилась сверху.
  for (const [rx, rz, rot] of [[-7, -7, 0.4], [-5.6, -8.2, 1.1], [6.8, -6.4, 0.7], [8, -8, 2.1], [-8.2, 4, 0.2]] as const) {
    const r = box(2.2, 0.9, 1.6, M.stone, cx + rx, FLOOR_Y + 0.45, cz + rz);
    r.rotation.y = rot;
    g.add(r);
  }
  // ── Полуразрушенная стена с проломом у входа ──
  // Пролом шире ворот: войти можно, но стена всё равно читается как стена.
  g.add(box(7, 3.2, 0.7, M.stone, cx - 7, FLOOR_Y + 1.6, cz - 10.2));
  g.add(box(4.4, 2.2, 0.7, M.stone, cx + 7.8, FLOOR_Y + 1.1, cz - 10.2));
  cols.push({ x: cx - 7, z: cz - 10.2, r: 1.8 });
  cols.push({ x: cx + 7.8, z: cz - 10.2, r: 1.8 });
  // ── Рельефы с фресками в нишах боковых стен ──
  // Ниша, рельеф, рамка: рельеф светлее стены, иначе его не разглядеть.
  for (const side of [-1, 1]) {
    const px = cx + side * 9.9;
    g.add(box(0.6, 3.6, 3.2, M.dark, px, FLOOR_Y + 1.8, cz - 2));
    g.add(box(0.35, 2.6, 2.2, M.gold, px, FLOOR_Y + 1.8, cz - 2));
    g.add(box(0.8, 4, 0.8, M.stone, px, FLOOR_Y + 2, cz - 3.9));
    g.add(box(0.8, 4, 0.8, M.stone, px, FLOOR_Y + 2, cz - 0.1));
    cols.push({ x: px, z: cz - 2, r: 1.5 });
  }
  // ── Алтарь с огнём в глубине ──
  // Огонь обязателен: зороастрийский культ держится на священном пламени,
  // и алтарь без огня — просто камень.
  g.add(box(4.4, 1.2, 2.2, M.stone, cx, FLOOR_Y + 0.6, cz - 7));
  g.add(box(3.4, 0.2, 1.4, M.gold, cx, FLOOR_Y + 1.3, cz - 7));
  g.add(cyl(0.5, 0.9, 0.5, M.gold, cx, FLOOR_Y + 1.75, cz - 7, 10));
  // Пламя: два конуса, малый в большом.
  g.add(cyl(0.75, 1.3, 0.75, M.red, cx, FLOOR_Y + 2.35, cz - 7, 8));
  g.add(cyl(0.45, 1.9, 0.45, M.gold, cx, FLOOR_Y + 2.6, cz - 7, 8));
  cols.push({ x: cx, z: cz - 7, r: 2.2 });
  // ── Артефакты на постаментах: то, что сохранилось ──
  for (const side of [-1, 1]) {
    const px = cx + side * 4.6;
    g.add(box(1.1, 1.1, 1.1, M.stone, px, FLOOR_Y + 0.55, cz - 4.4));
    g.add(box(0.5, 0.6, 0.5, M.gold, px, FLOOR_Y + 1.4, cz - 4.4));
    cols.push({ x: px, z: cz - 4.4, r: 0.9 });
  }
  // ── Заросли: трава пролзла через руины ──
  for (const [gx, gz] of [[-4, 2], [3.4, 4.4], [-6, 7.4], [5.4, 1.6]] as const) {
    g.add(box(0.5, 0.7, 0.5, M.hay, cx + gx, FLOOR_Y + 0.35, cz + gz));
  }
  return cols;
}

// Гробница Шеиха: лестница вниз, зал с саркофагом, ниши, светильники.
//
// Что просили: гробница Имамзаде. Механик из этого («один вход за попытку,
// проклятия, лут один на группу, таблица рекордов») в проекте нет, и здесь
// только место. Мебель замкнута на саркофаг: он окружён решёткой и стоит
// на постаменте — добыча видна, но не валяется на полу.
function furnishTomb(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // ── Саркофаг в центре зала, на постаменте ──
  g.add(box(5.4, 0.5, 2.8, M.stone, cx, FLOOR_Y + 0.25, cz - 3));
  g.add(box(2.8, 1.1, 1.3, M.stone, cx, FLOOR_Y + 1.05, cz - 3));
  // Крышка сдвинута на четверть: видно, что саркофаг вскрывали.
  g.add(box(1.1, 0.22, 1.4, M.stone, cx + 1.5, FLOOR_Y + 1.65, cz - 3));
  cols.push({ x: cx, z: cz - 3, r: 2.4 });
  // ── Решётка вокруг саркофага ──
  // Забрать что-то из гробницы нельзя, не сломав её: правило механики будет
  // отдельным шагом, а сейчас решётка держит форму честной.
  for (let i = 0; i < 7; i++) {
    const bx = cx - 3.2 + i * 1.05;
    g.add(box(0.12, 2.6, 0.12, M.iron, bx, FLOOR_Y + 1.3, cz - 5.4));
  }
  g.add(box(7.2, 0.16, 0.16, M.iron, cx, FLOOR_Y + 2.6, cz - 5.4));
  for (let i = 0; i < 5; i++) {
    g.add(box(0.12, 2.6, 0.12, M.iron, cx - 3.4, FLOOR_Y + 1.3, cz - 5.2 + i * 1.1));
    g.add(box(0.12, 2.6, 0.12, M.iron, cx + 3.4, FLOOR_Y + 1.3, cz - 5.2 + i * 1.1));
  }
  cols.push({ x: cx, z: cz - 5.4, r: 1.6 });
  // ── Лестница вниз у входа: ступени уходят в пол ──
  for (let i = 0; i < 5; i++) {
    g.add(box(3.2, 0.16, 0.5, M.stone, cx, FLOOR_Y + 0.08 - i * 0.16, cz + 8.2 + i * 0.5));
  }
  cols.push({ x: cx, z: cz + 8.4, r: 1.7 });
  // ── Ниши со свитками по боковым стенам ──
  for (const side of [-1, 1]) {
    const px = cx + side * 9.8;
    g.add(box(0.7, 2.4, 2, M.dark, px, FLOOR_Y + 1.2, cz + 1.4));
    for (let r = 0; r < 2; r++) {
      const sv = cyl(0.15, 1, 0.15, M.hay, px, FLOOR_Y + 1 + r * 0.7, cz + 1.4, 8);
      sv.rotation.x = Math.PI / 2;
      g.add(sv);
    }
    g.add(box(0.9, 3, 0.9, M.stone, px, FLOOR_Y + 1.5, cz + 2.7));
    cols.push({ x: px, z: cz + 1.4, r: 1.5 });
  }
  // ── Потускневшие светильники на стойках ──
  // Не жаровни: в гробнице огонь открытым не уместен, тут холодный камень
  // и редкий огонёк. Отличие от жаровни видно и глазом, и проверкой.
  for (const side of [-1, 1]) {
    const px = cx + side * 5.2;
    g.add(cyl(0.14, 2.2, 0.14, M.iron, px, FLOOR_Y + 1.1, cz - 7.6, 8));
    g.add(cyl(0.3, 0.5, 0.3, M.gold, px, FLOOR_Y + 2.4, cz - 7.6, 8));
    cols.push({ x: px, z: cz - 7.6, r: 0.9 });
  }
  // ── Сундуки гробницы: по данным 10 (2 + 3 + 5) ──
  // Решение владельца: сундуки в гробнице нужны. Раньше здесь стояла пустая
  // строка с рассуждением, что добыча из гробницы - отдельная механика, и
  // данных не было ни одной: объявлено было десять, а нарисовано ноль, и в
  // игре игрок не находил ничего.
  //
  // Решётка над саркофагом остаётся: она закрывает САРКОФАГ, а сундуки стоят
  // по залу. То есть саркофаг по-прежнему не вскрыть, но забрать добычу можно -
  // ровно как решил владелец.
  //
  // Порядок точек совпадает с порядком комнат в данных (лестница, зал
  // саркофагов, святилище): проверка сверяет нарисованное с данными по номерам.
  // Расставлены в сторонах от саркофага, решётки и лестницы, и не ближе двух
  // единиц к монстрам - иначе игрок подойдёт к сундуку прямо в врага.
  const местаСундуков: [number, number][] = [
    [cx + 6.4, cz + 7.4],
    [cx - 6.4, cz + 7.4],
    [cx + 4.4, cz - 1.4],
    [cx - 4.4, cz - 1.4],
    [cx, cz + 2.4],
    [cx - 9.4, cz - 2.4],
    [cx + 9.4, cz - 2.4],
    [cx - 3.4, cz - 9.4],
    [cx + 3.4, cz - 9.4],
    [cx, cz - 11.4],
  ];
  for (const [px, pz] of местаСундуков) {
    g.add(box(1.1, 0.8, 0.8, M.wood, px, FLOOR_Y + 0.4, pz));
    cols.push({ x: px, z: pz, r: 1 });
  }
  return cols;
}

// Ханжа: «Рассказ через детали». Столы со свитками, стеллажи, надписи,
// письма, сломанные весы, следы копыт.
//
// Что просили: надписи на персидском, письма, сломанные весы, следы копыт.
// Здесь построено МЕСТО и детали в нём. ПРАВИЛА ОСМОТРА НЕТ — оно
// требует системы улик (сбор, вывод, связь с NPC), и это следующий шаг.
// Мебель замкнута на весы и надписи: это и есть улики, по которым
// «рассказывают детали».
function furnishHanza(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // ── Столы со свитками: читают, разбирают письма ──
  for (const side of [-1, 1]) {
    const px = cx + side * 7.5;
    // Стол — готовая модель (Quaternius); свитки на нём остаются своими —
    // это предмет истории: их разбирают, они лежат именно здесь.
    decorВещь(g, 'table-round-small', px, cz + 3.5, {
      размер: 1.9, по: 'horizontal', y: FLOOR_Y, ry: side * 0.7,
    });
    for (let i = 0; i < 2; i++) {
      const свиток = cyl(0.12, 0.9, 0.12, M.hay, px - 0.5 + i * 1, FLOOR_Y + 0.85, cz + 3.5, 8);
      свиток.rotation.x = Math.PI / 2;
      g.add(свиток);
    }
    cols.push({ x: px, z: cz + 3.5, r: 1.7 });
  }
  // ── Стеллажи со свитками в два яруса ──
  for (const side of [-1, 1]) {
    const px = cx + side * 10.4;
    g.add(box(0.5, 2.6, 3.2, M.wood, px, FLOOR_Y + 1.3, cz - 1));
    for (const y of [0.8, 1.7]) {
      for (let i = 0; i < 3; i++) {
        const свиток = cyl(0.11, 1.1, 0.11, M.hay, px - 0.28, FLOOR_Y + y, cz - 2.2 + i * 1.1, 8);
        свиток.rotation.x = Math.PI / 2;
        g.add(свиток);
      }
    }
    cols.push({ x: px, z: cz - 1, r: 1.9 });
  }
  // ── Надписи на персидском: плиты на стене, разной высоты ──
  // Разная высота и наклон — читается как надписи, а не как обои.
  for (let i = 0; i < 6; i++) {
    const bx = cx - 6.5 + i * 2.6;
    const высота = 1.9 + (i % 3) * 0.55;
    const плита = box(1.9, высота, 0.14, M.stone, bx, FLOOR_Y + высота / 2, cz - 8.4);
    плита.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.04;
    g.add(плита);
  }
  cols.push({ x: cx, z: cz - 8.4, r: 2.2 });
  // ── Сломанные весы: чаша, стрелка и гиря на полу ──
  // Разбиты: чаша лежит на боку, стрелка упала отдельно. Именно сломанные
  // весы — улика, а не часть обстановки.
  const чаша = cyl(1.1, 0.3, 1.1, M.gold, cx - 2.6, FLOOR_Y + 0.3, cz + 0.4, 10);
  чаша.rotation.z = Math.PI / 2;
  чаша.rotation.x = 0.4;
  g.add(чаша);
  g.add(cyl(0.14, 1.2, 0.14, M.iron, cx - 1.2, FLOOR_Y + 0.1, cz + 1.3, 8));
  g.add(box(1.4, 0.08, 0.22, M.gold, cx - 1.4, FLOOR_Y + 0.08, cz + 1.9));
  g.add(box(0.5, 0.5, 0.5, M.gold, cx - 3.8, FLOOR_Y + 0.25, cz + 1.6));
  g.add(box(0.4, 0.4, 0.4, M.gold, cx - 3.2, FLOOR_Y + 0.2, cz + 2.1));
  cols.push({ x: cx - 2.6, z: cz + 0.9, r: 2 });
  // ── Следы копыт: отпечатки в пыли, ведут к выходу ──
  // Раскладываются по дуге, а не по прямой: след ведёт к двери.
  for (let i = 0; i < 7; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    g.add(
      box(0.34, 0.05, 0.5, M.cream, cx + side * (2.2 + i * 0.3), FLOOR_Y + 0.03, cz + 4.4 + i * 1.15)
    );
  }
  // ── Лампада: в ханже читают при свете ──
  for (const side of [-1, 1]) {
    const px = cx + side * 4.4;
    g.add(cyl(0.12, 1.9, 0.12, M.gold, px, FLOOR_Y + 0.95, cz - 5.6, 8));
    g.add(cyl(0.34, 0.44, 0.34, M.gold, px, FLOOR_Y + 2.06, cz - 5.6, 8));
    cols.push({ x: px, z: cz - 5.6, r: 0.9 });
  }
  // ── Ящик с письмами ──
  g.add(box(1.3, 0.8, 0.9, M.wood, cx + 5.2, FLOOR_Y + 0.4, cz - 6.2));
  cols.push({ x: cx + 5.2, z: cz - 6.2, r: 1.1 });
  return cols;
}

// Катакомбы Тебриза: первое подземелье, где комнаты данных разложены по
// одной геометрии. Переходов между комнатами в проекте нет, и заводить их
// ради одного подземелья — работа вдвое больше.
//
// Что просили: входной зал, казармы разбойников, тронный зал Рустама.
// Трон у дальней стены, потому что босс стоит в (0, 0) — в центре.
function furnishCatacombs(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // ── Зона 1. Входной зал: арка входа и спуск вниз ──
  // Игрок сюда попадает: спавн у дальнего края, вход позади.
  for (const side of [-1, 1]) {
    g.add(box(1.1, 3.6, 1.1, M.stone, cx + side * 3.6, FLOOR_Y + 1.8, cz + 14.2));
    g.add(box(4.4, 0.7, 1.1, M.stone, cx, FLOOR_Y + 3.3, cz + 14.2));
  }
  for (let i = 0; i < 4; i++) {
    g.add(box(3.4, 0.16, 0.5, M.stone, cx, FLOOR_Y + 0.08 - i * 0.16, cz + 9.5 + i * 0.5));
  }
  cols.push({ x: cx, z: cz + 10, r: 1.7 });
  // Сундук входного зала: по данным treasureChests: 1
  g.add(box(1.1, 0.8, 0.8, M.wood, cx - 4.6, FLOOR_Y + 0.4, cz + 12.4));
  cols.push({ x: cx - 4.6, z: cz + 12.4, r: 1 });
  // ── Зона 2. Казармы: нар двух рядов ──
  for (const side of [-1, 1]) {
    for (let ряд = 0; ряд < 2; ряд++) {
      const px = cx + side * (6.5 + ряд * 3);
      for (let i = 0; i < 3; i++) {
        g.add(box(1.5, 0.5, 3, M.wood, px, FLOOR_Y + 0.25, cz + 5.5 - i * 3.4));
        g.add(box(0.5, 0.2, 0.6, M.hay, px, FLOOR_Y + 0.6, cz + 6.4 - i * 3.4));
      }
      cols.push({ x: px, z: cz + 5.5 - ряд * 1.2, r: 1.6 });
    }
  }
  // Стол с добычей посередине казарм
  g.add(box(2.4, 0.16, 1.3, M.wood, cx, FLOOR_Y + 0.9, cz + 5.4));
  g.add(box(0.2, 0.9, 0.2, M.woodDark, cx - 1, FLOOR_Y + 0.45, cz + 5.4));
  g.add(box(0.2, 0.9, 0.2, M.woodDark, cx + 1, FLOOR_Y + 0.45, cz + 5.4));
  cols.push({ x: cx, z: cz + 5.4, r: 1.5 });
  // Сундуки казарм: по данным 2
  g.add(box(1.1, 0.8, 0.8, M.wood, cx + 3.2, FLOOR_Y + 0.4, cz + 7.6));
  g.add(box(1.1, 0.8, 0.8, M.wood, cx - 3.2, FLOOR_Y + 0.4, cz + 2.6));
  cols.push({ x: cx + 3.2, z: cz + 7.6, r: 1 });
  cols.push({ x: cx - 3.2, z: cz + 2.6, r: 1 });
  // ── Зона 3. Тронный зал Рустама ──
  // Зона босса по раскладке (systems/dungeonLayout): третья комната получает
  // z = −10, и Рустам встаёт в её середину — опорной точкой боссовой комнаты
  // служит сам босс. Трон стоит у дальней стены, в трёх шагах перед ним.
  // Раньше трон был в (0, −12) и босс появлялся в (0, 0), то есть в середине
  // зала, в полутора шагах от трона: трон был поставлен по данным о позиции,
  // а босс — по геометрии, и они не сошлись.
  g.add(box(3.6, 0.5, 1.6, M.stone, cx, FLOOR_Y + 0.25, cz - 14));
  g.add(box(2.6, 1.6, 1.2, M.stone, cx, FLOOR_Y + 1.3, cz - 14.4));
  g.add(box(2.2, 0.24, 0.7, M.red, cx, FLOOR_Y + 2.2, cz - 14.4));
  cols.push({ x: cx, z: cz - 14, r: 2.2 });
  // Колонны по бокам зала: держат потолок и читаются как зал, а не как зал
  // без опоры.
  for (const side of [-1, 1]) {
    for (const dz of [-13, -8]) {
      const px = cx + side * 9.5;
      g.add(cyl(0.7, 4.4, 0.7, M.stone, px, FLOOR_Y + 2.2, cz + dz, 10));
      g.add(box(1.6, 0.4, 1.6, M.stone, px, FLOOR_Y + 4.5, cz + dz));
      cols.push({ x: px, z: cz + dz, r: 1 });
    }
  }
  // Алтарь у входа в тронный зал
  g.add(box(1.6, 1.1, 1, M.stone, cx - 5.4, FLOOR_Y + 0.55, cz - 5.4));
  cols.push({ x: cx - 5.4, z: cz - 5.4, r: 1.2 });
  // Сундуки тронного зала: по данным 3
  g.add(box(1.1, 0.8, 0.8, M.wood, cx - 6.4, FLOOR_Y + 0.4, cz - 11.4));
  g.add(box(1.1, 0.8, 0.8, M.wood, cx + 6.4, FLOOR_Y + 0.4, cz - 11.4));
  g.add(box(1.1, 0.8, 0.8, M.wood, cx, FLOOR_Y + 0.4, cz - 6.4));
  cols.push({ x: cx - 6.4, z: cz - 11.4, r: 1 });
  cols.push({ x: cx + 6.4, z: cz - 11.4, r: 1 });
  cols.push({ x: cx, z: cz - 6.4, r: 1 });
  // ── Факелы в каждой зоне: подземелье освещается по частям ──
  for (const [px, pz] of [
    [cx - 5.4, cz + 11.6],
    [cx + 5.4, cz + 3.6],
    [cx - 11.4, cz - 6.4],
    [cx + 11.4, cz - 6.4],
  ] as [number, number][]) {
    g.add(cyl(0.12, 1.8, 0.12, M.iron, px, FLOOR_Y + 0.9, pz, 8));
    g.add(cyl(0.28, 0.4, 0.28, M.fire, px, FLOOR_Y + 1.9, pz, 8));
    cols.push({ x: px, z: pz, r: 0.7 });
  }
  return cols;
}

// Дворец Сорока Колонн как подземелье: Дворцовый Сад и Тронный Зал.
//
// Что просили: сад с янычарами и тронный зал паши. В отличие от катакомб,
// босс здесь стоит не в центре, а у дальнего края (z = 30 в данных), поэтому
// трон сдвинут вбок, а не стоит перед боссом.
function furnishPalaceDungeon(
  g: THREE.Group,
  cx: number,
  cz: number,
): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // ── Зона 1. Дворцовый Сад: шесть янычаров, два сундука ──
  // Сад у входа: увитый плющ, фонтан посередине, клумбы по краям.
  const фонтан = cyl(1.9, 0.6, 1.9, M.stone, cx, FLOOR_Y + 0.3, cz + 8);
  g.add(фонтан);
  g.add(cyl(1.4, 0.1, 1.4, M.water, cx, FLOOR_Y + 0.58, cz + 8, 12));
  cols.push({ x: cx, z: cz + 8, r: 2 });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const px = cx + side * (8.5 + i * 0.4);
      const pz = cz + 4.5 + i * 4;
      g.add(box(1.6, 0.5, 1.6, M.stone, px, FLOOR_Y + 0.25, pz));
      g.add(cyl(0.5, 1.4, 0.5, M.green, px, FLOOR_Y + 1.1, pz, 8));
      cols.push({ x: px, z: pz, r: 1.1 });
    }
  }
  // Сундуки сада: по данным 2
  g.add(box(1.1, 0.8, 0.8, M.wood, cx - 4.4, FLOOR_Y + 0.4, cz + 11.4));
  g.add(box(1.1, 0.8, 0.8, M.wood, cx + 4.4, FLOOR_Y + 0.4, cz + 11.4));
  cols.push({ x: cx - 4.4, z: cz + 11.4, r: 1 });
  cols.push({ x: cx + 4.4, z: cz + 11.4, r: 1 });
  // ── Зона 2. Тронный Зал: паша в (−7.5), трон у дальней стены ──
  // Тронная зона измерена по раскладке (systems/dungeonLayout): комната 0 (сад)
  // получает z = +7.5, комната 1 (тронный зал) — z = −7.5, и паша встаёт ровно
  // в середину своей зоны, потому что опорной точкой боссовой комнаты служит
  // сам босс. Значит трон ставится у дальней стены, а паша — перед ним.
  //
  // Раньше я поставил трон у дверей (z = +12) по догадке, что паша «стоит
  // почти у дальней стены» — его позиция z = 30 локальна его комнате, и после
  // раскладки он оказался в середине зала. Трон и босс разошлись.
  g.add(box(3.4, 0.5, 1.5, M.stone, cx - 6.4, FLOOR_Y + 0.25, cz - 13));
  g.add(box(2.5, 1.5, 1.1, M.stone, cx - 6.4, FLOOR_Y + 1.25, cz - 13.4));
  g.add(box(2.1, 0.22, 0.6, M.teal, cx - 6.4, FLOOR_Y + 2.1, cz - 13.4));
  cols.push({ x: cx - 6.4, z: cz - 13, r: 2 });
  // Колонны: дворец сорока колонн, и по залу должно стоять два ряда
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const px = cx + side * 9.6;
      const pz = cz - 4.5 - i * 4.5;
      g.add(cyl(0.6, 4.2, 0.6, M.cream, px, FLOOR_Y + 2.1, pz, 10));
      g.add(box(1.4, 0.36, 1.4, M.stone, px, FLOOR_Y + 4.3, pz));
      cols.push({ x: px, z: pz, r: 0.9 });
    }
  }
  // Кафедра у дальней стены, как раз напротив трона
  g.add(box(2.2, 1.2, 1.2, M.woodDark, cx + 6.4, FLOOR_Y + 0.6, cz - 13.4));
  cols.push({ x: cx + 6.4, z: cz - 13.4, r: 1.2 });
  // Сундуки тронного зала: по данным 5
  const местаСундуков: [number, number][] = [
    [cx - 3.6, cz - 10.4],
    [cx + 3.6, cz - 10.4],
    [cx - 3.6, cz - 15],
    [cx + 3.6, cz - 15],
    [cx, cz - 15],
    // Шестой — в тайнике (см. ниже): позиция обязана совпадать с данными
    // комнаты один в один, иначе сундук нарисуется не там, где вскроется.
    [cx + 14.5, cz - 13.5],
  ];
  for (const [px, pz] of местаСундуков) {
    g.add(box(1.1, 0.8, 0.8, M.wood, px, FLOOR_Y + 0.4, pz));
    cols.push({ x: px, z: pz, r: 1 });
  }
  // ── Тайный коридор: ложная стена, гобелен и тайник ──
  //
  // Просили тайные коридоры дворца. Это узкий проход между ложной стеной
  // и восточной стеной зала: вход с севера, в глубине — тайник с сундуком
  // (шестой в данных комнаты). Механика та же, что у остальных сундуков, —
  // вскрытие через заход, золото и опыт, — поэтому тайник работает, а не
  // стоит мебелью. Стражей в проходе нет: янычары держат середину зала.
  //
  // Координаты комнатные (от cx, cz). Зал подземелий 32x32, стены на ±16:
  // проход x 13..16 и сундук (14.5, −13.5) внутри. В комнате 22x16 здесь была
  // бы стена — тайник построен под большой зал. Северо-восточный светильник
  // (11.4, −9.4) оставлен на месте: от входа в проход (x 13..15.5) до него 2.6,
  // протиснуться можно, а столпотворения нет.
  const тайникСтенаX = 13;
  const тайникЮг = -15, тайникСевер = -11;
  // Ширина входа 2.5: персонаж (радиус 1) проходит, шеренгой не пройти.
  const тайникПроход = 2.5;
  g.add(box(0.6, 3, тайникСевер - тайникЮг, M.wallDark, cx + тайникСтенаX, FLOOR_Y + 1.5, cz + (тайникЮг + тайникСевер) / 2));
  cols.push({ x: cx + тайникСтенаX, z: cz - 14.5, r: 1 });
  cols.push({ x: cx + тайникСтенаX, z: cz - 12.5, r: 1 });
  cols.push({ x: cx + тайникСтенаX, z: cz - 10.5, r: 1 });
  // Приоткрытый гобелен на входе: метка тайника. Коллайдера нет — это ткань,
  // сквозь неё протискиваются, а не обходят.
  const гобелен = box(0.15, 2.6, тайникПроход, M.teal, cx + тайникСтенаX, FLOOR_Y + 1.3, cz + тайникСевер + тайникПроход / 2);
  гобелен.rotation.y = 0.18;
  g.add(гобелен);
  // Светильники в обоих залах
  for (const [px, pz] of [
    [cx - 11.4, cz + 9.4],
    [cx + 11.4, cz + 9.4],
    [cx - 11.4, cz - 9.4],
    [cx + 11.4, cz - 9.4],
  ] as [number, number][]) {
    g.add(cyl(0.12, 2.1, 0.12, M.iron, px, FLOOR_Y + 1.05, pz, 8));
    g.add(cyl(0.3, 0.42, 0.3, M.gold, px, FLOOR_Y + 2.2, pz, 8));
    cols.push({ x: px, z: pz, r: 0.7 });
  }
  return cols;
}

// Пещеры Хорасана: вход в пещеру и зал вечного огня.
//
// Зоны из замера: входная комната получает z = +7.5, огненный зал — z = −7.5.
// Арззанг в данных стоит в z = 25…40, а он и есть опорная точка боссовой
// комнаты, поэтому после раскладки он оказывается у дальней стены (z = −15).
// Значит алтарь огня ставится у стены, а не в середине зала.
function furnishKhorasanCaves(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // ── Зона 1. Вход в Пещеру: три монстра, два сундука ──
  // Свод из сталактитов, узкий проход вниз, вода на дне.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const px = cx + side * (5 + i * 3.5);
      const pz = cz + 5.5 - i * 2.5;
      g.add(cyl(0.5, 3.2 - i * 0.6, 0.5, M.stone, px, FLOOR_Y + (3.2 - i * 0.6) / 2, pz, 8));
      cols.push({ x: px, z: pz, r: 0.8 });
    }
  }
  // Лужа на дне пещеры: видно, что вода тут стоит.
  g.add(box(5.4, 0.1, 3.4, M.water, cx - 2.4, FLOOR_Y + 0.05, cz + 9.4));
  cols.push({ x: cx - 2.4, z: cz + 9.4, r: 2 });
  // Ступени вниз: в пещеру спускаются, а не входят с улицы.
  for (let i = 0; i < 4; i++) {
    g.add(box(3, 0.18, 0.5, M.stone, cx + 4.4, FLOOR_Y + 0.09 - i * 0.18, cz + 12.4 - i * 0.5));
  }
  cols.push({ x: cx + 4.4, z: cz + 12.4, r: 1.5 });
  // Сундуки входа: по данным 2
  g.add(box(1.1, 0.8, 0.8, M.wood, cx - 7.4, FLOOR_Y + 0.4, cz + 12.4));
  g.add(box(1.1, 0.8, 0.8, M.wood, cx + 8.4, FLOOR_Y + 0.4, cz + 6.4));
  cols.push({ x: cx - 7.4, z: cz + 12.4, r: 1 });
  cols.push({ x: cx + 8.4, z: cz + 6.4, r: 1 });
  // ── Зона 2. Зал Вечного Огня: семь монстров, шесть сундуков ──
  // Алтарь В СЕРЕДИНЕ ЗОНЫ (z = −7.5), а не у дальней стены.
  // Причина: опорная точка боссовой комнаты — сам босс, поэтому босс всегда
  // встаёт в середину зоны. Арззанг встаёт в (0, −7.5); алтарь в −13 был
  // в шести единицах позади него. Я ставил алтарь по своему замеру по
  // тексту данных, где ошибочно сдвинул босса ещё раз.
  g.add(box(3.4, 0.6, 2.2, M.stone, cx, FLOOR_Y + 0.3, cz - 7.5));
  g.add(box(2.4, 1.4, 1.6, M.stone, cx, FLOOR_Y + 1.3, cz - 7.5));
  // Огонь в жаровне на алтаре: зал назван вечным огнём, огонь и должен гореть.
  g.add(cyl(0.7, 0.4, 0.7, M.fire, cx, FLOOR_Y + 2.2, cz - 7.5, 10));
  cols.push({ x: cx, z: cz - 7.5, r: 2.2 });
  // Сталактиты по бокам зала: пещера читается сводом, а не комнатой.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const px = cx + side * (8.5 + i * 0.6);
      const pz = cz - 4 - i * 4;
      const h = 2.6 + (i % 2) * 0.8;
      g.add(cyl(0.45, h, 0.45, M.stone, px, FLOOR_Y + h / 2, pz, 8));
      cols.push({ x: px, z: pz, r: 0.7 });
    }
  }
  // Жаровни по краям зала: свет по всему залу, а не в одном углу.
  for (const [px, pz] of [
    [cx - 11.4, cz - 2.4],
    [cx + 11.4, cz - 2.4],
    [cx - 11.4, cz - 10.4],
    [cx + 11.4, cz - 10.4],
  ] as [number, number][]) {
    g.add(cyl(0.5, 0.9, 0.5, M.iron, px, FLOOR_Y + 0.45, pz, 8));
    g.add(cyl(0.28, 0.36, 0.28, M.fire, px, FLOOR_Y + 1.05, pz, 8));
    cols.push({ x: px, z: pz, r: 0.8 });
  }
  // Сундуки огненного зала: по данным 6
  const местаСундуков: [number, number][] = [
    [cx - 4.6, cz - 2.4],
    [cx + 4.6, cz - 2.4],
    [cx - 7.4, cz - 3.4],
    [cx + 7.4, cz - 3.4],
    [cx - 3.6, cz - 12.4],
    [cx + 3.6, cz - 12.4],
  ];
  for (const [px, pz] of местаСундуков) {
    g.add(box(1.1, 0.8, 0.8, M.wood, px, FLOOR_Y + 0.4, pz));
    cols.push({ x: px, z: pz, r: 1 });
  }
  return cols;
}

// Крепость Кавказа: ворота крепости, стена и башня бури.
//
// Зоны из замера: ворота z = +10, стена z = 0, башня бури z = −10.
// Джиннов двое (mob_storm_djinn, count 2) и их позиции z = 10 и 22, а
// опорной точкой боссовой комнаты служит босс: центр 16 → после сдвига они
// стоят в z = −16 и −4. Значит башня глубокая, и оба джинна у её дальней
// стены, а не один в центре.
function furnishCaucasusFort(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // ── Зона 1. Ворота крепости: семь монстров, один сундук ──
  // Арка ворот, кованые решётки, два сторожевых поста у входа.
  for (const side of [-1, 1]) {
    g.add(box(1.4, 4.6, 1.4, M.stone, cx + side * 3.6, FLOOR_Y + 2.3, cz + 14));
  }
  g.add(box(8.6, 1.2, 1.4, M.stone, cx, FLOOR_Y + 4.4, cz + 14));
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      g.add(box(0.16, 2.6, 0.16, M.iron, cx + side * (1 + i * 0.9), FLOOR_Y + 1.3, cz + 13.4));
    }
    cols.push({ x: cx + side * 2.4, z: cz + 13.4, r: 1.2 });
  }
  // Сторожевые посты с факелами по краям ворот.
  for (const side of [-1, 1]) {
    const px = cx + side * 9.4;
    g.add(cyl(0.16, 2.2, 0.16, M.iron, px, FLOOR_Y + 1.1, cz + 11.4, 8));
    g.add(cyl(0.3, 0.42, 0.3, M.fire, px, FLOOR_Y + 2.35, cz + 11.4, 8));
    cols.push({ x: px, z: cz + 11.4, r: 0.8 });
  }
  // Сундук ворот: по данным 1
  g.add(box(1.1, 0.8, 0.8, M.wood, cx, FLOOR_Y + 0.4, cz + 6.4));
  cols.push({ x: cx, z: cz + 6.4, r: 1 });
  // ── Зона 2. Стена: пять монстров, два сундука ──
  // Ступенчатый парапет с зубцами: стена читается стеной, а не полкой.
  for (let i = 0; i < 3; i++) {
    g.add(box(14 - i * 1.4, 0.7, 1.2, M.stone, cx, FLOOR_Y + 0.35 + i * 0.7, cz + 2.5 - i * 1.6));
  }
  for (let i = 0; i < 7; i++) {
    const bx = cx - 5.4 + i * 1.8;
    g.add(box(0.8, 0.7, 0.8, M.stone, bx, FLOOR_Y + 2.6, cz + 2.5));
  }
  cols.push({ x: cx, z: cz + 2.5, r: 2 });
  // Козырёк над стеной: укрытие для тех, кто за ней стоит.
  g.add(box(3.4, 0.3, 1.8, M.stone, cx - 8.4, FLOOR_Y + 2.2, cz - 1.4));
  g.add(box(0.3, 2.2, 0.3, M.woodDark, cx - 8.4, FLOOR_Y + 1.1, cz - 1.4));
  cols.push({ x: cx - 8.4, z: cz - 1.4, r: 1 });
  // Сундуки стены: по данным 2
  g.add(box(1.1, 0.8, 0.8, M.wood, cx + 8.4, FLOOR_Y + 0.4, cz - 4.4));
  g.add(box(1.1, 0.8, 0.8, M.wood, cx + 8.4, FLOOR_Y + 0.4, cz - 8.4));
  cols.push({ x: cx + 8.4, z: cz - 4.4, r: 1 });
  cols.push({ x: cx + 8.4, z: cz - 8.4, r: 1 });
  // ── Зона 3. Башня бури: два джинна у дальней стены, четыре сундука ──
  // Площадка башни во всю глубину зоны: джинны стоят в z = −16 и −4, то есть
  // вразнобой, и одна точка была бы ровно посередине между ними.
  // Площадка по глубине двоих джиннов: от −15 до −4, середина −9.5.
  g.add(box(12.4, 0.4, 12.4, M.stone, cx, FLOOR_Y + 0.2, cz - 9.5));
  // Молния и кольца — ПОД САМИМИ ДЖИННАМИ, а не по всей площадке.
  // Замер: джинны встают в (0, −15) и (0, −4) — на одной оси, расстояние 11.
  // Молния в третьей точке была бы ни под кем.
  for (const dz of [-15, -4]) {
    g.add(box(0.3, 3.4, 0.3, M.gold, cx, FLOOR_Y + 1.9, cz + dz, 8));
    g.add(cyl(1.1, 0.14, 1.1, M.gold, cx, FLOOR_Y + 0.5, cz + dz, 12));
    cols.push({ x: cx, z: cz + dz, r: 1.4 });
  }
  // Сундуки башни: по данным 4
  const местаСундуков: [number, number][] = [
    [cx - 5.4, cz - 13.4],
    [cx + 5.4, cz - 13.4],
    [cx - 5.4, cz - 5.6],
    [cx + 5.4, cz - 5.6],
  ];
  for (const [px, pz] of местаСундуков) {
    g.add(box(1.1, 0.8, 0.8, M.wood, px, FLOOR_Y + 0.4, pz));
    cols.push({ x: px, z: pz, r: 1 });
  }
  return cols;
}

// ── БАГДАДСКАЯ ЦИТАДЕЛЬ: рейд на двадцать человек ──────────────────
//
// Четыре зоны, и каждая читается как часть обороны: ворота, двор,
// караульная, зал везиря. Рейд отличается от обычного данжа не разме��ом
// зала (зал тот же, 32×32), а числом ярусов и тем, что финал — не одна
// комната, а четвёртая, до которой надо дойти.
//
// ЗОНЫ СЧИТАЕТ сервер (dungeonLayout.zoneShift): для четырёх комнат
// +10.5, +3.5, −3.5, −10.5. Обещания ниже совпадают с данными в
// dungeons.ts, а сундуки нарисованы ТЕМ ЖЕ координатами, что в
// chestPositions: вскрытие идёт по координатам, а рисуется по ним же,
// и расхождение означало бы сундук в воздухе.
function furnishBaghdadCitadel(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];
  // ── Зона 1. Ворота (+10.5): девять монстров, два сундука ──
  // Портал-арка шире ворот крепости: рейд входит двадцатью людьми, и
  // узкий проход превращался бы в очередь на первом же повороте.
  for (const side of [-1, 1]) {
    g.add(box(1.8, 6.2, 1.8, M.stone, cx + side * 5.2, FLOOR_Y + 3.1, cz + 14));
  }
  g.add(box(12.4, 1.6, 1.8, M.stone, cx, FLOOR_Y + 6, cz + 14));
  // Зубцы по краю ворот: силуэт читается как крепость, а не как проём.
  for (let i = 0; i < 5; i++) {
    g.add(box(0.9, 0.9, 0.9, M.stone, cx - 4.4 + i * 2.2, FLOOR_Y + 7.2, cz + 14));
  }
  for (const side of [-1, 1]) {
    cols.push({ x: cx + side * 3.4, z: cz + 13.4, r: 1.4 });
  }
  // Факелы по сторонам въезда.
  for (const side of [-1, 1]) {
    const px = cx + side * 9.4;
    g.add(cyl(0.16, 2.6, 0.16, M.iron, px, FLOOR_Y + 1.3, cz + 11.4, 8));
    g.add(cyl(0.34, 0.46, 0.34, M.fire, px, FLOOR_Y + 2.8, cz + 11.4, 8));
    cols.push({ x: px, z: cz + 11.4, r: 0.8 });
  }
  // Сундуки ворот: по данным (−8.4, 8.4) и (8.4, 8.4)
  for (const [px, pz] of [[cx - 8.4, cz + 8.4], [cx + 8.4, cz + 8.4]] as [number, number][]) {
    g.add(box(1.1, 0.8, 0.8, M.wood, px, FLOOR_Y + 0.4, pz));
    cols.push({ x: px, z: pz, r: 1 });
  }
  // ── Зона 2. Внутренний двор (+3.5): восемь монстров, три сундука ──
  // Колоннада по четырём углам двора: двадцать человек должны найти, где
  // драться, а не слипаться в одной точке у портала.
  for (const side of [-1, 1]) {
    for (const dz of [0.4, 7.4]) {
      g.add(cyl(0.5, 0.7, 3.4, M.stone, cx + side * 10.4, FLOOR_Y + 1.7, cz + dz, 10));
      cols.push({ x: cx + side * 10.4, z: cz + dz, r: 0.9 });
    }
  }
  // Фонтан в середине двора: точка интереса, вокруг которой бой расходится.
  g.add(cyl(2.6, 0.6, 0.5, M.stone, cx, FLOOR_Y + 0.25, cz + 3.4, 16));
  g.add(cyl(0.3, 0.4, 1.4, M.stone, cx, FLOOR_Y + 1.1, cz + 3.4, 8));
  g.add(cyl(1.2, 1.4, 0.24, M.gold, cx, FLOOR_Y + 1.9, cz + 3.4, 12));
  cols.push({ x: cx, z: cz + 3.4, r: 2.8 });
  // Сундуки двора: по данным (−9.4, 1.4), (9.4, 1.4), (0, 6.4)
  for (const [px, pz] of [[cx - 9.4, cz + 1.4], [cx + 9.4, cz + 1.4], [cx, cz + 6.4]] as [number, number][]) {
    g.add(box(1.1, 0.8, 0.8, M.wood, px, FLOOR_Y + 0.4, pz));
    cols.push({ x: px, z: pz, r: 1 });
  }
  // ── Зона 3. Караульная и оружейная (−3.5): двенадцать монстров, три сундука ──
  // Ряд козлов для оружия вдоль дальней стены: караульная читается как
  // оружейная, а не как пустой зал с сундуками.
  for (let i = 0; i < 4; i++) {
    const px = cx - 9.4 + i * 6.2;
    g.add(box(3.4, 0.22, 0.5, M.woodDark, px, FLOOR_Y + 0.9, cz - 9.4));
    for (let k = 0; k < 3; k++) {
      g.add(box(0.12, 1.5, 0.12, M.iron, px - 1 + k, FLOOR_Y + 1.75, cz - 9.4));
    }
  }
  cols.push({ x: cx, z: cz - 9.4, r: 1.2 });
  // Стойки с копьями у боковых стен.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      g.add(box(0.12, 2.2, 0.12, M.woodDark, cx + side * 13.4, FLOOR_Y + 1.1, cz - 6.4 + i * 2.2));
    }
    cols.push({ x: cx + side * 13.4, z: cz - 4.4, r: 0.9 });
  }
  // Сундуки караульной: по данным (−8.4, −1.6), (8.4, −1.6), (0, −6.6)
  for (const [px, pz] of [[cx - 8.4, cz - 1.6], [cx + 8.4, cz - 1.6], [cx, cz - 6.6]] as [number, number][]) {
    g.add(box(1.1, 0.8, 0.8, M.wood, px, FLOOR_Y + 0.4, pz));
    cols.push({ x: px, z: pz, r: 1 });
  }
  // ── Зона 4. Зал великого везиря (−10.5): везирь с почётной стражей ──
  // Подиум везиря у дальней стены: босс стоит на возвышении, а не в зале
  // наравне с рядовыми — иначе «зал везиря» и «двор» неразличимы.
  g.add(box(8.4, 0.6, 4.4, M.stone, cx, FLOOR_Y + 0.3, cz - 15.4));
  g.add(box(6.4, 2.2, 1.4, M.gold, cx, FLOOR_Y + 1.4, cz - 16.4));
  // Тронный балдахин на четырёх столбах: силуэт зала читается с порога.
  for (const side of [-1, 1]) {
    g.add(cyl(0.22, 0.3, 3.4, M.gold, cx + side * 3.2, FLOOR_Y + 1.7, cz - 13.4));
    g.add(cyl(0.22, 0.3, 3.4, M.gold, cx + side * 3.2, FLOOR_Y + 1.7, cz - 17.4));
  }
  g.add(box(7.6, 0.3, 4.8, M.red, cx, FLOOR_Y + 3.5, cz - 15.4));
  cols.push({ x: cx, z: cz - 15.4, r: 2.2 });
  // Ковёр зала: тёмный прямоугольник под боссом, чтобы зона читалась отворотом.
  g.add(box(11.4, 0.04, 8.4, M.red, cx, FLOOR_Y + 0.05, cz - 12.4));
  // Сундуки зала: по данным (±6.4, −4.4) и (±6.4, −11.4)
  for (const [px, pz] of [
    [cx - 6.4, cz - 4.4], [cx + 6.4, cz - 4.4],
    [cx - 6.4, cz - 11.4], [cx + 6.4, cz - 11.4],
  ] as [number, number][]) {
    g.add(box(1.1, 0.8, 0.8, M.wood, px, FLOOR_Y + 0.4, pz));
    cols.push({ x: px, z: pz, r: 1 });
  }
  return cols;
}

// ── ХРАМ СИМУРГА: рейд на двадцать человек ───────────────────────
//
// Четыре зоны, как у цитадели, но святилище читается иначе: врата под аркой,
// зал огненных дивов с жаровнями, гнездо бури с вихрем, трон Симурга на
// подиуме. Святилище — не крепость: купол над аркой вместо перемычки, а
// гнездо-подиум вместо трона.
//
// Зоны считает сервер (dungeonLayout.zoneShift): для четырёх комнат
// +10.5, +3.5, −3.5, −10.5. Сундуки нарисованы ТЕМИ ЖЕ координатами, что в
// chestPositions: вскрытие идёт по данным, а рисуется по ним же, и
// расхождение означало бы сундук в воздухе.
function furnishSimurghTemple(g: THREE.Group, cx: number, cz: number): { x: number; z: number; r: number }[] {
  const cols: { x: number; z: number; r: number }[] = [];

  // ── Зона 1. Врата храма (+10.5) ──
  // Арка с куполом: у святилища она выше крепостных ворот и без решётки —
  // в храм входят, а не осаждают.
  for (const side of [-1, 1]) {
    g.add(box(1.6, 6.6, 1.6, M.stone, cx + side * 5.6, FLOOR_Y + 3.3, cz + 14));
    cols.push({ x: cx + side * 5.6, z: cz + 14, r: 1.3 });
  }
  g.add(box(12.8, 1.4, 1.6, M.stone, cx, FLOOR_Y + 6.6, cz + 14));
  // Купол над аркой: три сужающихся кольца.
  for (let i = 0; i < 3; i++) {
    const к = 1 - i * 0.28;
    g.add(cyl(3.4 * к, 3.4 * Math.max(0.15, к * 0.7), 0.9, M.stone, cx, FLOOR_Y + 7.6 + i * 0.9, cz + 14, 12));
  }
  // Факелы по сторонам входа — выше, чем у цитадели: храм выше крепости.
  for (const side of [-1, 1]) {
    const px = cx + side * 9.6;
    g.add(cyl(0.18, 2.8, 0.18, M.iron, px, FLOOR_Y + 1.4, cz + 11.4, 8));
    g.add(cyl(0.36, 0.5, 0.36, M.fire, px, FLOOR_Y + 3.0, cz + 11.4, 8));
    cols.push({ x: px, z: cz + 11.4, r: 0.8 });
  }
  // Сундуки врат: по данным (−8.4, 8.4) и (8.4, 8.4)
  for (const [px, pz] of [[cx - 8.4, cz + 8.4], [cx + 8.4, cz + 8.4]] as [number, number][]) {
    g.add(box(1.1, 0.8, 0.8, M.wood, px, FLOOR_Y + 0.4, pz));
    cols.push({ x: px, z: pz, r: 1 });
  }

  // ── Зона 2. Зал огненных дивов (+3.5) ──
  // Колонны с чашами огня по кругу: в зале стоят дивы, и огонь здесь уместен.
  for (const side of [-1, 1]) {
    for (const dz of [0.4, 7.4]) {
      g.add(cyl(0.55, 0.7, 3.6, M.stone, cx + side * 10.6, FLOOR_Y + 1.8, cz + dz, 10));
      g.add(cyl(0.5, 0.24, 0.3, M.fire, cx + side * 10.6, FLOOR_Y + 3.8, cz + dz, 8));
      cols.push({ x: cx + side * 10.6, z: cz + dz, r: 0.9 });
    }
  }
  // Купель в середине зала: точка, вокруг которой бой расходится.
  g.add(cyl(2.4, 0.6, 0.5, M.stone, cx, FLOOR_Y + 0.25, cz + 3.4, 16));
  g.add(cyl(0.28, 0.4, 1.6, M.stone, cx, FLOOR_Y + 1.0, cz + 3.4, 8));
  cols.push({ x: cx, z: cz + 3.4, r: 2.6 });
  // Сундуки зала: по данным (−9.4, 1.4), (9.4, 1.4), (0, 6.4)
  for (const [px, pz] of [[cx - 9.4, cz + 1.4], [cx + 9.4, cz + 1.4], [cx, cz + 6.4]] as [number, number][]) {
    g.add(box(1.1, 0.8, 0.8, M.wood, px, FLOOR_Y + 0.4, pz));
    cols.push({ x: px, z: pz, r: 1 });
  }

  // ── Зона 3. Гнездо бури (−3.5) ──
  // Вихрь: три кольца клиньев на разной высоте. Читается как буря, стоящая
  // в зале, — а не как набор палок.
  for (let i = 0; i < 3; i++) {
    const углы = 5;
    for (let a = 0; a < углы; a++) {
      const угол = (a / углы) * Math.PI * 2 + i * 0.7;
      const r = 1.6 + i * 1.1;
      g.add(box(1.5, 0.24, 0.24, M.iron,
        cx + Math.cos(угол) * r, FLOOR_Y + 1.4 + i * 1.5, cz + Math.sin(угол) * r));
    }
    cols.push({ x: cx, z: cz, r: 3.4 });
  }
  // Стойки с копьями у боковых стен — как в караульной цитадели.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      g.add(box(0.12, 2.2, 0.12, M.woodDark, cx + side * 13.4, FLOOR_Y + 1.1, cz - 6.4 + i * 2.2));
    }
    cols.push({ x: cx + side * 13.4, z: cz - 4.4, r: 0.9 });
  }
  // Сундуки гнезда: по данным (−8.4, −1.6), (8.4, −1.6), (0, −6.6)
  for (const [px, pz] of [[cx - 8.4, cz - 1.6], [cx + 8.4, cz - 1.6], [cx, cz - 6.6]] as [number, number][]) {
    g.add(box(1.1, 0.8, 0.8, M.wood, px, FLOOR_Y + 0.4, pz));
    cols.push({ x: px, z: pz, r: 1 });
  }

  // ── Зона 4. Трон Симурга (−10.5) ──
  // Гнездо-подиум у дальней стены, а не трон: Симург птица, и сидит она в
  // гнезде. Кольцо из веток плюс чаша.
  for (let i = 0; i < 8; i++) {
    const угол = (i / 8) * Math.PI * 2;
    g.add(box(1.6, 0.5, 1.6, M.woodDark,
      cx + Math.cos(угол) * 3.6, FLOOR_Y + 0.35, cz - 15.4 + Math.sin(угол) * 3.6));
  }
  g.add(cyl(4.0, 0.4, 0.7, M.wood, cx, FLOOR_Y + 0.7, cz - 15.4, 12));
  // Перья Симурга на подиуме: метка босса, читаемая с порога.
  for (const side of [-1, 1]) {
    g.add(box(0.16, 2.2, 0.16, M.gold, cx + side * 2.0, FLOOR_Y + 1.5, cz - 15.4));
    g.add(box(0.5, 0.7, 0.16, M.gold, cx + side * 2.0, FLOOR_Y + 2.6, cz - 15.4));
  }
  cols.push({ x: cx, z: cz - 15.4, r: 4.4 });
  // Ковёр зала — тёмный прямоугольник под боссом.
  g.add(box(12.4, 0.04, 9.4, M.red, cx, FLOOR_Y + 0.05, cz - 12.4));
  // Сундуки трона: по данным (±6.4, −4.4) и (±6.4, −11.4)
  for (const [px, pz] of [
    [cx - 6.4, cz - 4.4], [cx + 6.4, cz - 4.4],
    [cx - 6.4, cz - 11.4], [cx + 6.4, cz - 11.4],
  ] as [number, number][]) {
    g.add(box(1.1, 0.8, 0.8, M.wood, px, FLOOR_Y + 0.4, pz));
    cols.push({ x: px, z: pz, r: 1 });
  }
  return cols;
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
export const M = {
  wall: new THREE.MeshStandardMaterial({ color: 0xc9ab7c, roughness: 0.9, map: plasterTexture('#c9ab7c', 2) }),
  wallDark: new THREE.MeshStandardMaterial({ color: 0xa89061, roughness: 0.95, map: wallDarkTexture('#a89061', 2), normalMap: wallDarkNormalTexture(2), normalScale: new THREE.Vector2(0.4, 0.4) }),
  roof: new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.9, map: roofTileTexture('#8a6a42', 2), normalMap: roofTileNormalTexture(2), normalScale: new THREE.Vector2(0.8, 0.8) }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 1, map: woodTexture(1) }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.9, map: woodDarkTexture('#5a4630', 2), normalMap: woodDarkNormalTexture(2), normalScale: new THREE.Vector2(0.7, 0.7) }),
  stone: new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 0.95, map: stoneTexture(4) }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 1 }),
  teal: new THREE.MeshStandardMaterial({ color: 0x2e8b8b, roughness: 0.6, map: clothTexture('#2e8b8b', 4) }),
  gold: new THREE.MeshStandardMaterial({ color: 0xc9a84c, roughness: 0.35, metalness: 0.7 }),
  red: new THREE.MeshStandardMaterial({ color: 0x8b1a1a, roughness: 1, map: clothTexture('#8b1a1a', 4) }),
  cream: new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.85, map: clothTexture('#e8e0d0', 4) }),
  hay: new THREE.MeshStandardMaterial({ color: 0xd8b84a, roughness: 0.9, map: hayTexture('#d8b84a', 2), normalMap: hayNormalTexture(2), normalScale: new THREE.Vector2(0.6, 0.6) }),
  iron: new THREE.MeshStandardMaterial({ color: 0x6a6e78, roughness: 0.5, metalness: 0.6, map: ironTexture('#6a6e78', 2), normalMap: ironNormalTexture(2), normalScale: new THREE.Vector2(0.5, 0.5) }),
  fire: new THREE.MeshStandardMaterial({ color: 0xff8c30, emissive: 0xff6a10, emissiveIntensity: 1.8 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xffd980, emissive: 0xffa530, emissiveIntensity: 1.3 }),
  water: new THREE.MeshStandardMaterial({ color: 0x2f6f96, roughness: 0.2, map: waterNormalTexture(4) }),
  purple: new THREE.MeshStandardMaterial({ color: 0x7a5fd0, roughness: 0.5, map: clothTexture('#7a5fd0', 4) }),
  green: new THREE.MeshStandardMaterial({ color: 0x4a6a38, roughness: 1, map: foliageTexture('#4a6a38', 3), normalMap: foliageNormalTexture(3), normalScale: new THREE.Vector2(0.7, 0.7) }),
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

/**
 * Лестница в интерьере (§324): две тетивы и перекладины.
 * groupId в userData несёт ladderTop - до какой высоты (в мировых координатах)
 * ведёт подъем; world3d по нему заканчивает технику и ставит игрока на плату.
 */
function createInteriorLadder(x: number, baseY: number, z: number, h: number, ry = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  g.rotation.y = ry;
  for (const бок of [-0.34, 0.34]) {
    g.add(box(0.09, h, 0.09, M.woodDark, бок, h / 2, 0));
  }
  const перекладин = Math.max(1, Math.round(h / 0.38) - 1);
  for (let i = 1; i <= перекладин; i++) {
    g.add(box(0.6, 0.07, 0.07, M.wood, 0, (h * i) / (перекладин + 1), 0));
  }
  g.userData = { ladderHeight: h, ladderTop: baseY + h };
  return g;
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
    // Стела с персидской надписью. Её габариты и положение заданы в
    // inscriptions.ts и подобраны под этот фасад: верх ниже подоконника
    // окна слева, сама она левее двери.
    const ins = inscriptionFor(s.id);
    if (ins) {
      const stele = steleMesh(ins);

      stele.position.set(STELE.offsetX, STELE.offsetY, STELE.offsetZ);
      g.add(stele);
    }
    const lamp = box(0.5, 0.5, 0.5, M.lamp, 2.1, 3.1, 3.1);
    // ОКНА — ОБЩИЕ С ГОРОДОМ (§233). Раньше здесь стояли плоские бирюзовые
    // плашки 1.4 x 1.2: они читались как наклейки, а не как окна, и дом был
    // голой коробкой с двумя пятнами. Теперь это те же окна, что в домах
    // Исфахана и на четырёх местах (§222, §224): стекло, рама, перекладина и
    // стойка.
    const win1 = windowPane(-2.9, 2.6, 3.02, 0, 1.4, 1.2);
    const win2 = windowPane(2.9, 1.2, 3.02, 0, 1.4, 1.2);
    // Пояс под кровлей: без него стена в четыре с половиной метра — просто
    // коробка, и дом не отличается от сарая.
    const пояс = box(8.2, 0.2, 6.2, M.wallDark, 0, 4.2, 0);
    // ── Крыльцо и забор (§238) ──
    //
    // Дома кварталов стояли прямо на мостовой: ни ступеньки, ни забора, ни
    // двора. Крыльцо со ступенькой отделяет вход от улицы, а забор по бокам
    // фасада очерчивает двор — без него дом стоит на площади как ящик.
    const крыльцо = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.22, 1.2), M.stone);
    крыльцо.position.set(0, 0.11, 3.5);
    крыльцо.castShadow = true;
    крыльцо.receiveShadow = true;
    const ступенька = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 0.5), M.stone);
    ступенька.position.set(0, 0.06, 4.25);
    ступенька.receiveShadow = true;
    g.add(body, roof, frame, door, sign, lamp, win1, win2, пояс, крыльцо, ступенька);
    // Забор по бокам фасада: два столба и рейка между ними.
    for (const s of [-1, 1] as const) {
      const столб = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.0, 0.26), M.woodDark);
      столб.position.set(s * 3.5, 0.5, 6.1);
      столб.castShadow = true;
      const рейка = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 3.0), M.woodDark);
      рейка.position.set(s * 3.5, 0.62, 4.5);
      рейка.castShadow = true;
      g.add(столб, рейка);
    }
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

// Мастер в интерьере (§316).
//
// ЧТО БЫЛО. Интерьеры были обставлены, но пусты: станок стоял без ткача,
// наковальня без кузнеца, конюшня без конюха. Мастерская читалась как витрина
// после ухода мастера, а не как место, где идёт работа.
//
// ЧТО ТЕПЕРЬ. В четырёх интерьерах стоят люди, у каждого своё дело и своя
// поза: кузнец бьёт по наковальне, ткач стоит у станка, конюх таскает воду,
// астроном смотрит на карту, исследователь — на колбы.
//
// Человек смотрит в +Z (нос и глаза вынесены вперёд), поэтому поворот задаётся
// прямо: -π/2 — влево, π — в спину у стены.
function мастер(
  g: THREE.Group,
  cx: number,
  cz: number,
  x: number,
  z: number,
  поворот: number,
  cfg: HumanoidCfg,
): void {
  const фигура = buildHumanoid(cfg);
  фигура.group.position.set(cx + x, FLOOR_Y, cz + z);
  фигура.group.rotation.y = поворот;
  g.add(фигура.group);
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
  // КОНЮХ: вёдра на коромысле у стойла — лошадей поят и кормят.
  мастер(g, cx, cz, -3.4, 2.2, -Math.PI / 2, {
    robe: 0x4a5a3a, robeDark: 0x33422a, hat: 'cap', hatColor: 0x2b3320,
    weapon: 'none', предмет: ПРЕДМЕТ.вёдра, scale: 1.03,
  });
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
  // ГОРН у дальней стены: каменная очаговая с раскалённым зевом.
  g.add(box(1.8, 1.2, 1.4, M.stone, cx - 7.5, FLOOR_Y + 0.6, cz - 5.5));
  g.add(box(0.9, 0.5, 0.3, M.gold, cx - 7.5, FLOOR_Y + 0.55, cz - 4.9));
  cols.push({ x: cx - 7.5, z: cz - 5.5, r: 1.3 });
  // КУЗНЕЦ у наковальни: молот в руке, фартук — кожа.
  мастер(g, cx, cz, 1.5, -1.8, -Math.PI / 2, {
    robe: 0x5a3b22, robeDark: 0x3c2716, hat: 'cap', hatColor: 0x2f2117,
    weapon: 'none', предмет: ПРЕДМЕТ.молот, scale: 1.05,
  });
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
  // АСТРОНОМ у стола с картой: смотрит на небесный чертеж.
  мастер(g, cx, cz, -5.4, 2.0, 0, {
    robe: 0x2f3f6e, robeDark: 0x1e2946, hat: 'turban', hatColor: 0xb08d3a,
    weapon: 'none', scale: 1.03,
  });
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
  // ИССЛЕДОВАТЕЛЬ у стола с колбами: смотрит на опыты.
  мастер(g, cx, cz, -2.2, 2.6, Math.PI / 2, {
    robe: 0x8a5a2b, robeDark: 0x5e3a1c, hat: 'hood', hatColor: 0x3a2a1c,
    weapon: 'none', scale: 1.02,
  });
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
  /** Двери выхода. У крепости их три, у остальных зданий одна. */
  exitDoors: THREE.Object3D[];
  /** Столы с документами: по ним кликают так же, как по двери. */
  documentTargets: THREE.Object3D[];
  /** Интерактивные объекты: ящики, кувшины, навесы. */
  interactiveTargets: THREE.Object3D[];
  /** Подъемные лестницы: можно лазить вверх-вниз. */
  climbTargets: THREE.Object3D[];
  /** Разрушаемые объекты: ящики, бочки, вазы, мебель, окна. */
  destructibleTargets: THREE.Object3D[];
  /** Мезонины: площадки, на которые ведут лестницы. y = верхняя поверхность. */
  platforms: PlatformBox[];
}

/** Площадка мезонина: AABB по мировым XZ, y - верхняя поверхность. */
export interface PlatformBox {
  x: number;
  z: number;
  w: number;
  d: number;
  y: number;
}

/** План мезонина: смещения от центра комнаты, ry - куда смотрит лестница. */
interface MezzaninePlan {
  px: number;
  pz: number;
  w: number;
  d: number;
  /** Высота подъема: и высота лестницы, и верх платформы над полом. */
  h: number;
  lx: number;
  lz: number;
  ry: number;
}

// Мезонины по комнатам. Лестница прислонена к стене и стоит ПОД платформой:
// сход с вершины происходит ровно на плату, без полушага в пустоту.
// Свободные северные (казарма, конюшня, катакомбы) и южные (крепость) полосы
// сняты с обстановки: стойки мезонина не врезаются в мебель.
// Крепость: арсенал занимает север (cx-6..cx+6), клетки темницы - юг до cx+3;
// свободный юго-восток вмещает платформу 5 м. Лестница на lx=4.8, а не по
// центру плиты (6.5): южная стена несёт три проёма (x=-7, 0, +7, шириной
// 3.2 м), и лестница с телом шириной 0.68 в проёме x=+7 (5.4..8.6) закрыла
// бы сам выход. Порог сторожа - 2.0 м от центра проёма.
const VERTICAL_MAP: Record<string, MezzaninePlan[] | undefined> = {
  stable: [{ px: 6.5, pz: -6.5, w: 5, d: 2.5, h: 2.6, lx: 6.5, lz: -7.45, ry: 0 }],
  barracks: [{ px: 6.2, pz: -6.5, w: 5, d: 2.5, h: 2.6, lx: 6.2, lz: -7.45, ry: 0 }],
  catacombs: [{ px: 13.2, pz: -12.2, w: 4.8, d: 2.6, h: 2.6, lx: 15.45, lz: -12.2, ry: Math.PI / 2 }],
  fortress: [{ px: 6.5, pz: 6.55, w: 5, d: 2.4, h: 2.6, lx: 4.8, lz: 7.45, ry: Math.PI }],
};

// Разрушаемый декор по комнатам (§323): что и сколько поставить.
// Ваза разбивается с одного удара, ящик держит два (HP 50 при уроне 25),
// бочка взрывается при сломе — но поджога механикой мира она еще не
// достигает: поджог приходит из клиентского клика позже.
const DESTRUCTIBLE_MAP: Record<string, { kind: DestructibleKind; count: number }[] | undefined> = {
  stable: [{ kind: 'crate', count: 2 }],
  barracks: [{ kind: 'barrel', count: 2 }],
  catacombs: [{ kind: 'crate', count: 3 }, { kind: 'barrel', count: 1 }],
  fortress: [{ kind: 'crate', count: 1 }, { kind: 'barrel', count: 1 }],
  hanza: [{ kind: 'crate', count: 2 }, { kind: 'barrel', count: 2 }],
  khorasan_caves: [{ kind: 'barrel', count: 1 }],
  caucasus_fort: [{ kind: 'crate', count: 2 }],
  baghdad_citadel: [{ kind: 'barrel', count: 2 }],
  palace: [{ kind: 'vase', count: 2 }],
  auction_house: [{ kind: 'vase', count: 2 }],
  shrine: [{ kind: 'vase', count: 1 }],
  simurgh_temple: [{ kind: 'vase', count: 1 }],
};

// ── Зал таверны из диорамы ────────────────────────────────────
// Габариты модели 30.92 x 16.34 x 58.77, пол на 0.40, стены до ±15.5/±29.4.
// Кругов 148, r = 0.9 через ~1.5 м: замерены по геометрии сеткой 0.5 м в поясе
// тела 0.6…2.6 м над полом. Проёмы арок открыты — их верх выше пояса.
// Спавн (-8, +6) и четыре жаровни стоят на открытом полу: ближайший круг не
// ближе 2.3 м (проверено тем же замером). Дверь выхода — в южной стене зала,
// у устья коридора (-1, -16): там стена, игрок выходит только кликом.
const TAVERN_EXIT: [number, number] = [-1, -16];
const TAVERN_BRAZIERS: [number, number][] = [[-12, 4], [-10, -2], [-4, -8], [-2, -10]];
const TAVERN_COLLIDERS: [number, number][] = [
  [-25.25, -3.48], [-25.25, -1.98], [-25.25, -0.48], [-25.25, +1.02],
  [-25.25, +2.52], [-25.25, +4.02], [-25.25, +5.52], [-25.25, +7.02],
  [-25.25, +8.52], [-23.75, -3.48], [-23.75, -1.98], [-23.75, +9.02],
  [-22.25, -3.48], [-22.25, -1.98], [-22.25, +3.02], [-22.25, +4.52],
  [-22.25, +9.02], [-20.75, -3.48], [-20.75, -1.98], [-20.75, +3.02],
  [-20.75, +4.52], [-20.75, +9.02], [-19.75, -0.48], [-19.25, -3.48],
  [-19.25, -1.98], [-19.25, +9.02], [-18.25, -0.48], [-17.75, -3.48],
  [-17.75, -1.98], [-17.75, +8.02], [-16.75, -0.48], [-16.25, -7.48],
  [-16.25, -5.98], [-16.25, -4.48], [-16.25, -2.98], [-16.25, +8.02],
  [-14.75, -7.48], [-14.75, -5.98], [-14.75, -4.48], [-14.75, -2.98],
  [-14.75, +8.02], [-13.25, -7.48], [-13.25, -5.98], [-13.25, -4.48],
  [-13.25, -2.98], [-13.25, +8.02], [-11.75, -7.48], [-11.75, -5.98],
  [-11.75, -4.48], [-11.75, +8.02], [-11.75, +10.52], [-11.75, +12.02],
  [-11.75, +13.52], [-11.75, +15.02], [-11.75, +16.52], [-10.25, -7.98],
  [-10.25, +10.52], [-10.25, +17.52], [-9.75, -15.98], [-9.75, -14.48],
  [-9.75, -12.98], [-9.75, -11.48], [-9.75, -9.98], [-8.75, -8.48],
  [-8.75, +17.52], [-8.25, -15.98], [-8.25, -10.98], [-8.25, +10.52],
  [-7.25, -8.48], [-7.25, +17.52], [-6.75, -15.98], [-6.75, +10.52],
  [-5.75, +3.52], [-5.75, +8.52], [-5.75, +17.52], [-5.25, -15.98],
  [-5.25, +5.02], [-5.25, +10.52], [-4.75, +12.02], [-4.75, +13.52],
  [-4.75, +15.02], [-4.25, -25.48], [-4.25, -23.98], [-4.25, -22.48],
  [-4.25, -20.98], [-4.25, -19.48], [-4.25, -17.98], [-4.25, +3.02],
  [-4.25, +9.02], [-3.75, -16.48], [-3.75, +4.52], [-2.75, -25.48],
  [-2.75, +9.02], [-2.25, -16.48], [-2.25, -7.48], [-2.25, -5.98],
  [-2.25, -4.48], [-2.25, -2.98], [-2.25, -1.48], [-2.25, +0.02],
  [-2.25, +1.52], [-1.75, +6.02], [-1.75, +7.52], [-1.25, -25.48],
  [-1.25, +9.02], [-0.75, -16.48], [-0.75, -7.98], [-0.75, -6.48],
  [-0.75, -4.98], [-0.75, -3.48], [-0.75, -1.98], [-0.75, -0.48],
  [-0.75, +1.02], [-0.25, +2.52], [-0.25, +4.02], [-0.25, +6.02],
  [-0.25, +7.52], [0.25, -25.48], [0.25, -10.48], [0.25, +9.02],
  [0.75, -23.98], [0.75, -22.48], [0.75, -20.98], [0.75, -19.48],
  [0.75, -17.98], [0.75, -16.48], [0.75, -8.98], [0.75, -7.48],
  [0.75, -5.98], [0.75, -3.48], [0.75, +0.02], [1.25, -14.98],
  [1.25, -13.48], [1.25, -11.98], [1.25, -1.98], [1.25, +1.52],
  [1.25, +3.02], [1.25, +4.52], [1.25, +6.02], [1.25, +7.52],
  [2.25, -3.48], [2.25, -0.48], [2.75, -1.98], [3.75, -3.48],
  [3.75, -0.48], [5.25, -3.48], [5.25, -1.98], [5.25, -0.48],
];

function buildTavernRoom(scene: THREE.Scene, def: BuildingDef): Room {
  const g = new THREE.Group();
  const cx = def.roomCx, cz = def.roomCz;
  const colliders: { x: number; z: number; r: number }[] = [];
  for (const [lx, lz] of TAVERN_COLLIDERS) colliders.push({ x: cx + lx, z: cz + lz, r: 0.9 });
  for (const [lx, lz] of TAVERN_BRAZIERS) {
    brazier(g, cx + lx, cz + lz, FLOOR_Y);
    colliders.push({ x: cx + lx, z: cz + lz, r: 0.9 });
  }
  // Дверь выхода (клик = выйти). Стоит в стене — пешком не выйти, как и у
  // остальных: круг в проёме держит игрока, выход только кликом.
  const d = box(2.4, 3.2, 0.25, M.woodDark, cx + TAVERN_EXIT[0], FLOOR_Y + 1.6, cz + TAVERN_EXIT[1]);
  d.userData = {
    doorBuilding: def.id,
    doorAction: 'exit',
    doorName: t(def.nameKey),
    entranceId: '',
  };
  g.add(d);
  const exitDoors = [d];
  colliders.push({ x: cx + TAVERN_EXIT[0], z: cz + TAVERN_EXIT[1], r: 1.4 });
  const exitSign = signMesh(t('buildings.exit'));
  exitSign.position.set(cx + TAVERN_EXIT[0], FLOOR_Y + 3.9, cz + TAVERN_EXIT[1] + 0.4);
  exitSign.rotation.y = Math.PI;
  g.add(exitSign);
  // Диорама доезжает асинхронно, коллайдеры уже стоят: иначе в окно загрузки
  // сквозь стены проходят, а потом стены «появляются» вокруг игрока.
  void loadTavernRoomModel().then((модель) => {
    if (!модель) return;
    const зал = модель.clone();
    зал.position.set(cx, 0, cz);
    зал.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    g.add(зал);
  });
  // Комод-консоль у стойки: дверцы (-Z) смотрят на запад, к стойке. Масштаб
  // 0.2 даёт 0.83 x 1.03 x 1.39. Место (-6.5, -5) и подход с запада проверены
  // открытым полом сеткой 1 м; два круга r = 0.55 закрывают корпус.
  void loadDrawerModel().then((модель) => {
    if (!модель) return;
    const комод = модель.clone();
    комод.position.set(cx - 6.5, FLOOR_Y, cz - 5);
    комод.rotation.y = -Math.PI / 2;
    комод.scale.setScalar(0.2);
    комод.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    g.add(комод);
  });
  colliders.push(
    { x: cx - 6.85, z: cz - 5, r: 0.55 },
    { x: cx - 6.15, z: cz - 5, r: 0.55 },
  );
  // Столов с документами у таверны нет (только тронный зал) — цикл общий,
  // чтобы будущий стол встал сам, без новой ветки.
  const documentTargets: THREE.Object3D[] = [];
  for (const place of DOCUMENT_SPOTS) {
    if (place.buildingId !== def.id) continue;
    g.add(box(2.2, 0.16, 1.4, M.woodDark, place.x, FLOOR_Y + 0.92, place.z));
    g.add(box(0.22, 0.9, 0.22, M.wood, place.x - 0.9, FLOOR_Y + 0.46, place.z - 0.5));
    g.add(box(0.22, 0.9, 0.22, M.wood, place.x + 0.9, FLOOR_Y + 0.46, place.z - 0.5));
    g.add(box(0.22, 0.9, 0.22, M.wood, place.x - 0.9, FLOOR_Y + 0.46, place.z + 0.5));
    g.add(box(0.22, 0.9, 0.22, M.wood, place.x + 0.9, FLOOR_Y + 0.46, place.z + 0.5));
    const list = box(0.7, 0.08, 0.5, M.hay, place.x, FLOOR_Y + 1.04, place.z);
    list.rotation.y = 0.4;
    g.add(list);
    const hit = box(2.4, 1.3, 1.6, M.woodDark, place.x, FLOOR_Y + 0.65, place.z);
    hit.userData = { documentSpot: place.id, documentName: place.nameRu };
    g.add(hit);
    documentTargets.push(hit);
    colliders.push({ x: place.x, z: place.z, r: 1.2 });
  }
  const interactiveTargets: THREE.Object3D[] = [];
  const climbTargets: THREE.Object3D[] = [];
  const destructibleTargets: THREE.Object3D[] = [];
  // Таверна - диорама: планировка замером модели, мезонин в ней не заводится,
  // пока не начерчен на реальную модель.
  const platforms: PlatformBox[] = [];
  scene.add(g);
  return { def, group: g, colliders, exitDoors, documentTargets, interactiveTargets, climbTargets, destructibleTargets, platforms };
}

function buildRoom(scene: THREE.Scene, def: BuildingDef): Room {
  // Таверна живёт в диораме, а не в процедурной коробке 22x16: стены, мебель
  // и свет — из модели, планировка — замером, а не коробками.
  if (def.kind === 'tavern') return buildTavernRoom(scene, def);
  const g = new THREE.Group();
  const cx = def.roomCx, cz = def.roomCz;
  // Залы подземелий — 32x32, комнаты зданий — 22x16.
  //
  // Сервер считает все залы половиной 16 (ROOM_HALF), а мебель подземелий
  // нарисована под неё: трон дворца стоит на cz − 13, сундуки — на cz − 15.
  // В комнате 22x16 (стены на ±11/±8) всё это оказывалось ЗА стеной:
  // трон не видно, сундуки не достать. Залы выросли до серверных 32,
  // комнаты зданий остались 22x16 — их обстановка влезает (дворец правился
  // отдельно, см. furnishPalace).
  const dungeonKinds = new Set(['catacombs', 'palace_dungeon', 'khorasan_caves', 'caucasus_fort']);
  const ширина = dungeonKinds.has(def.kind) ? DUNGEON_W : ROOM_W;
  const глубина = dungeonKinds.has(def.kind) ? DUNGEON_D : ROOM_D;
  const hw = ширина / 2, hd = глубина / 2;

  const floor = box(ширина, 0.4, глубина, M.stone, cx, FLOOR_Y - 0.2, cz);
  floor.receiveShadow = true;
  g.add(floor);
  const rugColor = def.kind === 'science' ? M.purple : M.teal;
  g.add(box(ширина * 0.4, 0.06, глубина * 0.4, rugColor, cx, FLOOR_Y + 0.03, cz));

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
  // ТРИ ДВЕРИ У КРЕПОСТИ, ОДНА У ВСЕХ ОСТАЛЬНЫХ. Проёмы перечислены явно,
  // чтобы у десяти других зданий поведение осталось прежним: сдвиг стены у
  // них изменил бы комнаты, которые уже работают и уже проверены.
  // Смещения -7, 0, +7 те же, что в FORT_ENTRANCES (shared/stealth.ts);
  // fortressDoor.test.ts сверяет, что числа не разошлись.
  const проемы: number[] = def.id === 'fortress' ? [-7, 0, 7] : [0];
  // Участки стены: от левого края до первого проёма, между проёмами, до правого.
  let край = -hw;
  for (const s of проемы) {
    const g2 = s - gap;
    if (g2 > край) wallRun(cx + край, cz + hd, cx + g2, cz + hd, M.wall, ROOM_WALL_H, ROOM_WALL_T);
    край = s + gap;
  }
  if (край < hw) wallRun(cx + край, cz + hd, cx + hw, cz + hd, M.wall, ROOM_WALL_H, ROOM_WALL_T);
  // Перемычка над каждым проёмом.
  //
  // Высота проёма — 3.4 м (таков дверной щит: `box(3.2, 3.4, 0.5)` с центром
  // на FLOOR_Y + 1.7), стена — ROOM_WALL_H = 4.5. Значит перемычка должна
  // закрывать ровно полосу 3.4…4.5, а `box()` берёт координату ЦЕНТРА, то
  // есть ставить её на FLOOR_Y + 3.4 + (4.5 − 3.4) / 2.
  //
  // Раньше в цикле стоял центр FLOOR_Y + 3.4 — на полкорпуса ниже: перемычка
  // на 0.55 м врезалась в дверной проём и не доходила до верха стены, то
  // есть проём оказывался ниже низким, а сверху оставалась щель. У проёмов
  // по центру (их большинство) щель всё же закрывала вторая, отдельная
  // перемычка ниже по коду — из-за неё дефект не был виден, а у боковых
  // проёмов крепости (их три: −7, 0, +7) щель оставалась настоящей.
  const ЛЕНА_ПРОЁМА = 3.4;
  const лента = ROOM_WALL_H - ЛЕНА_ПРОЁМА;
  for (const s of проемы) {
    g.add(box(ROOM_DOOR_GAP + 1.2, лента, ROOM_WALL_T, M.wall, cx + s, FLOOR_Y + ЛЕНА_ПРОЁМА + лента / 2, cz + hd));
  }

  // Дверь выхода (клик = выйти). Круг в проёме не даёт выйти пешком —
  // только кликом: иначе игрок окажется в пустоте кармана.
  // ── Двери: у крепости три, у остальных одна ──
  // entranceId едет в запрос входа. Без него сервер не знает, через какую
  // дверь вошёл игрок, и правила (присед, золото) не к чему привязать - три
  // двери были бы декорацией.
  const номераВходов: string[] = def.id === 'fortress' ? ['gate', 'gap', 'lever'] : [''];
  const exitDoors: THREE.Object3D[] = [];
  for (let i = 0; i < проемы.length; i++) {
    const d = box(2.4, 3.2, 0.25, M.woodDark, cx + проемы[i], FLOOR_Y + 1.6, cz + hd);
    d.userData = {
      doorBuilding: def.id,
      doorAction: 'exit',
      doorName: t(def.nameKey),
      entranceId: номераВходов[i] ?? '',
    };
    g.add(d);
    exitDoors.push(d);
  }
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
    observatory: furnishObservatory,
    science: furnishScience,
    arena: furnishArena,
    auction_house: furnishAuctionHouse,
    circus: furnishCircus,
caravanserai: furnishCaravanserai,
    fortress: furnishFortress,
    palace: furnishPalace,
    mosque: furnishMosque,
    weaver: furnishWeaver,
    customs: furnishCustoms,
    shrine: furnishShrine,
    tomb: furnishTomb,
    hanza: furnishHanza,
    catacombs: furnishCatacombs,
    palace_dungeon: furnishPalaceDungeon,
    khorasan_caves: furnishKhorasanCaves,
    caucasus_fort: furnishCaucasusFort,
    baghdad_citadel: furnishBaghdadCitadel,
    simurgh_temple: furnishSimurghTemple,
  }[def.kind] ?? furnishScience;
  for (const c of furn(g, cx, cz)) colliders.push(c);

  // Жаровни у стен
  brazier(g, cx - hw + 1.6, cz - hd + 1.6, FLOOR_Y);
  brazier(g, cx + hw - 1.6, cz - hd + 1.6, FLOOR_Y);
  colliders.push(
    { x: cx - hw + 1.6, z: cz - hd + 1.6, r: 0.9 },
    { x: cx + hw - 1.6, z: cz - hd + 1.6, r: 0.9 },
  );

  // ── Интерактивные объекты (ящики, кувшины, навесы) ─────────────
  // Размещаем по типу здания: конюшня/казарма/мастерская/таверна/форт/подземелья.
  const interactiveTargets: THREE.Object3D[] = [];
  {
    // Карта типа здания -> {kind, count}
    const interactiveMap: Record<string, { kind: InteractiveKind; count: number }> = {
      stable:      { kind: 'crate',      count: 3 },
      barracks:    { kind: 'crate',      count: 4 },
      workshop:    { kind: 'oil_jug',    count: 2 },
      tavern:      { kind: 'crate',      count: 2 },
      fortress:    { kind: 'awning',     count: 2 },
      caravanserai:{ kind: 'crate',      count: 3 },
      catacombs:   { kind: 'crate',      count: 2 },
      palace_dungeon:{ kind: 'crate',    count: 2 },
      khorasan_caves: { kind: 'oil_jug', count: 2 },
      caucasus_fort:  { kind: 'awning',  count: 2 },
      baghdad_citadel:{ kind: 'crate',   count: 2 },
      simurgh_temple: { kind: 'oil_jug', count: 1 },
    };
    const entry = interactiveMap[def.kind as string];
    if (entry) {
      const { kind, count } = entry;
      for (let i = 0; i < count; i++) {
        // Детерминированное размещение по хэшу от id + i
        let seed = def.id.length * 7919 + i * 1103515245 + 12345;
        const rnd = (): number => {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          return seed / 0x7fffffff;
        };
        // Размещаем в пределах комнаты (22x16, стены на ±11/±8)
        const margin = 2.5;
        const x = cx + (rnd() - 0.5) * (22 - margin * 2);
        const z = cz + (rnd() - 0.5) * (16 - margin * 2);
        const ry = rnd() * Math.PI * 2;
        let obj: THREE.Object3D;
        switch (kind) {
          case 'crate':
            obj = createCrate(x, FLOOR_Y + 0.4, z, 0.7, 0.7, 0.7, ry);
            break;
          case 'oil_jug':
            obj = createOilJug(x, FLOOR_Y, z, ry);
            break;
          case 'awning':
            obj = createAwning(x, FLOOR_Y, z, 3.5, 2, ry);
            break;
        }
        if (obj) {
          registerInteractive(obj, kind);
          g.add(obj);
          interactiveTargets.push(obj);
          // Коллайдер для физики
          const r = kind === 'awning' ? 2.0 : 0.6;
          colliders.push({ x, z, r });
        }
      }
    }
  }

  // ── Разрушаемый декор (§323): ящики, бочки, вазы с HP ──────────
  // Размещение детерминированное, как у интерактивных §320: при
  // перезагрузке объекты стоят на тех же местах. Southern полоса у
  // двери отрезана: ящик в проёме запер бы дверь.
  const destructibleTargets: THREE.Object3D[] = [];
  for (const план of DESTRUCTIBLE_MAP[def.kind as string] ?? []) {
    for (let i = 0; i < план.count; i++) {
      let seed = def.id.length * 7919 + i * 1103515245 + план.kind.length * 12011 + 31337;
      const rnd = (): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      const margin = 3;
      const x = cx + (rnd() - 0.5) * (ширина - margin * 2);
      // От южной стены отступ сверху: дверь - yверх комнаты (cz + hd),
      // полоса 3 м перед ней свободна.
      const z = cz + (rnd() - 0.5) * (глубина - margin * 2 - 3);
      const ry = rnd() * Math.PI * 2;
      let obj: THREE.Object3D | null = null;
      if (план.kind === 'crate') obj = createDestructibleCrate(x, FLOOR_Y + 0.38, z, 0.75, 0.75, 0.75, ry);
      else if (план.kind === 'barrel') obj = createDestructibleBarrel(x, FLOOR_Y, z, ry);
      else if (план.kind === 'vase') obj = createDestructibleVase(x, FLOOR_Y, z, ry);
      if (obj) {
        g.add(obj);
        destructibleTargets.push(obj);
        colliders.push({ x, z, r: план.kind === 'vase' ? 0.4 : 0.6 });
      }
    }
  }

  // ── Мезонин (§324): платформа, на которую ведёт лестница ───────
  // Лестница прислонена к стене и стоит ПОД платформой: сход с вершины
  // приходит ровно на плату, а не в полушаге от края. Стойки у свободных
  // краёв: у стены платформа держится сама, дальше - на опорах с пола.
  const climbTargets: THREE.Object3D[] = [];
  const platforms: PlatformBox[] = [];
  for (const план of VERTICAL_MAP[def.kind as string] ?? []) {
    const top = FLOOR_Y + план.h;
    const плита = box(план.w, 0.22, план.d, M.woodDark, cx + план.px, top - 0.11, cz + план.pz);
    плита.receiveShadow = true;
    плита.castShadow = true;
    g.add(плита);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const постX = cx + план.px + sx * (план.w / 2 - 0.12);
      const постZ = cz + план.pz + sz * (план.d / 2 - 0.12);
      g.add(box(0.18, план.h, 0.18, M.wood, постX, FLOOR_Y + план.h / 2, постZ));
      colliders.push({ x: постX, z: постZ, r: 0.22 });
    }
    const лестница = createInteriorLadder(cx + план.lx, FLOOR_Y, cz + план.lz, план.h, план.ry);
    g.add(лестница);
    climbTargets.push(лестница);
    colliders.push({ x: cx + план.lx, z: cz + план.lz, r: 0.42 });
    platforms.push({ x: cx + план.px, z: cz + план.pz, w: план.w, d: план.d, y: top });
  }

  // ── Стол с тайными документами ──
  const documentTargets: THREE.Object3D[] = [];
  for (const place of DOCUMENT_SPOTS) {
    if (place.buildingId !== def.id) continue;
    g.add(box(2.2, 0.16, 1.4, M.woodDark, place.x, FLOOR_Y + 0.92, place.z));
    g.add(box(0.22, 0.9, 0.22, M.wood, place.x - 0.9, FLOOR_Y + 0.46, place.z - 0.5));
    g.add(box(0.22, 0.9, 0.22, M.wood, place.x + 0.9, FLOOR_Y + 0.46, place.z - 0.5));
    g.add(box(0.22, 0.9, 0.22, M.wood, place.x - 0.9, FLOOR_Y + 0.46, place.z + 0.5));
    g.add(box(0.22, 0.9, 0.22, M.wood, place.x + 0.9, FLOOR_Y + 0.46, place.z + 0.5));
    // Свиток на столе - vidno, chto zdes chto-to lezhit, inache stol pustoy.
    const list = box(0.7, 0.08, 0.5, M.hay, place.x, FLOOR_Y + 1.04, place.z);
    list.rotation.y = 0.4;
    g.add(list);
    // Кликабельная цель - stol celikom, a ne svitok: po melkomu celitcaku
    // misset klik tselkom svitku.
    const hit = box(2.4, 1.3, 1.6, M.woodDark, place.x, FLOOR_Y + 0.65, place.z);
    hit.userData = { documentSpot: place.id, documentName: place.nameRu };
    g.add(hit);
    documentTargets.push(hit);
    // Стол - настоящая мебель: он занимает место, в которое нельзя встать.
    colliders.push({ x: place.x, z: place.z, r: 1.2 });
  }

  scene.add(g);
  return { def, group: g, colliders, exitDoors, documentTargets, interactiveTargets, climbTargets, destructibleTargets, platforms };
}

// ── Хендл ────────────────────────────────────────────────────
export interface InteriorsHandle {
  /** Все кликабельные двери (снаружи + выходы внутри). */
  clickTargets: THREE.Object3D[];
  /** Комнаты по id здания. */
  rooms: Map<string, Room>;
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
    clickTargets.push(...room.exitDoors);
    clickTargets.push(...room.documentTargets);
    clickTargets.push(...room.interactiveTargets);
  }
  // Двери экстерьеров добавляются через buildTownBuildings (возвращает свои цели).
  let inside: BuildingDef | null = null;

  return {
    clickTargets,
    rooms,
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

