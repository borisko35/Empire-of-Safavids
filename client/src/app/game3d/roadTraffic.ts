// ============================================================
// Дорожное движение: караваны и случайные путники с квестами
// ============================================================
import { camelTexture, camelNormalTexture, skinTexture, skinNormalTexture, clothTexture, darkStoneTexture, darkStoneNormalTexture, goldTexture, goldNormalTexture } from './textures';
//
// ЗАЧЕМ. Горожане живут в городе и никуда не идут — это правильно, но из-за
// этого за пределами города было пусто: поле, по которому шёл игрок, не
// содержало вообще никого. Три статичных верблюда в buildRoads не считали:
// они стояли в точках 0.2, 0.45 и 0.7 пути и не двигались никогда.
//
// Что здесь: караваны, которые идут по дороге туда-обратно, и путники,
// которые бредут по дороге пешком. Путники с пометкой «дают задание»
// кликабельны и открывают панель задач — так же, как городские NPC с
// флагом quest.
//
// Дорожное полотно рисует terrain.ts. Данные о дорогах общие (ROAD_PATHS),
// чтобы движение шло ровно по нарисованной дороге, а не рядом с ней.

import * as THREE from 'three';
import { ROAD_PATHS, CITY, groundHeight, loadDecorModel } from './terrain';
import { spriteVisible } from './spriteClamp';
import { createPuffs, type Puffs } from './puffs';
import { собратьЗверя } from './animalModels';
import { loadCharacterModel, loadAnimationClip } from './characterModels';
import { подогнать, безМёртвыхДорожек } from './realRig';
import { clone as копияСкелета } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface RoadTrafficHandle {
  /**
   * px/pz — позиция игрока. Нужна, чтобы не рисовать то, чего не видно:
   * дороги длинные, а караваны и путники на них всегда идут.
   *
   * night — 0 днём, 1 ночью: по нему горят фонари караванов (§254).
   */
  update(dt: number, now: number, px: number, pz: number, night?: number): void;
  /** Кликабельные путники: у них userData.npcPanel и userData.npcName */
  clickTargets: THREE.Object3D[];
  dispose(): void;
}

/** Дальше которой движение перестаёт рисоваться. */
const VISIBLE_DIST = 460;

/** Скорость каравана, м/с. Верблюд с грузом идёт медленнее пешехода. */
const CARAVAN_SPEED = 1.7;
/** Скорость путника, м/с. */
const WALKER_SPEED = 1.35;

const M = {
  camel: new THREE.MeshStandardMaterial({ color: 0xc0a074, roughness: 1, map: camelTexture('#c0a074', 2), normalMap: camelNormalTexture(2), normalScale: new THREE.Vector2(0.5, 0.5) }),
  camelDark: new THREE.MeshStandardMaterial({ color: 0x9a7d54, roughness: 1, map: camelTexture('#9a7d54', 2), normalMap: camelNormalTexture(2), normalScale: new THREE.Vector2(0.5, 0.5) }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 1 }),
  pack1: new THREE.MeshStandardMaterial({ color: 0x2e8b8b, roughness: 1, map: clothTexture('#2e8b8b', 4) }),
  pack2: new THREE.MeshStandardMaterial({ color: 0x8b1a1a, roughness: 1, map: clothTexture('#8b1a1a', 4) }),
  pack3: new THREE.MeshStandardMaterial({ color: 0x7a5fd0, roughness: 1, map: clothTexture('#7a5fd0', 4) }),
  skin: new THREE.MeshStandardMaterial({ color: 0xe4b284, roughness: 0.9, map: skinTexture('#e4b284', 2), normalMap: skinNormalTexture(2), normalScale: new THREE.Vector2(0.3, 0.3) }),
  robe: [
    new THREE.MeshStandardMaterial({ color: 0x6a5636, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x4c5a6a, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x6a4a5a, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x5a6a4a, roughness: 1 }),
  ],
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1, map: darkStoneTexture('#2a2018', 2), normalMap: darkStoneNormalTexture(2), normalScale: new THREE.Vector2(0.3, 0.3) }),
  gold: new THREE.MeshStandardMaterial({ color: 0xc9a84c, roughness: 0.4, metalness: 0.5, map: goldTexture('#c9a84c', 2), normalMap: goldNormalTexture(2), normalScale: new THREE.Vector2(0.4, 0.4) }),
  // Огонь в фонаре каравана (§254): тот же, что у городских фонарей.
  fire: new THREE.MeshStandardMaterial({ color: 0xffcf8a, roughness: 0.4, emissive: 0xffa04a, emissiveIntensity: 1.6 }),
};

/**
 * Фонарь в руке у головы каравана (§254).
 *
 * БЫЛО: караваны ходили по дорогам и ночью, и в темноте читались чёрными
 * силуэтами — дорога была пуста. ТЕПЕРЬ: у головы колонны фонарь, который
 * светит и на дорогу, и на сами верблюды.
 *
 * Возвращает и фонарь, и точку огня в мировых координатах — источник света
 * создаёт createRoadTraffic, потому что он должен двигаться вместе с караваном.
 */
function makeLantern(): { группа: THREE.Group; высота: number } {
  const группа = new THREE.Group();
  const коробка = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.2), M.gold);
  коробка.position.y = 0.13;
  const огонь = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), M.fire);
  огонь.position.y = 0.13;
  const колпак = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.1, 6), M.gold);
  колпак.position.y = 0.31;
  группа.add(коробка, огонь, колпак);
  return { группа, высота: 0.13 };
}

/** Одна дорога: у неё есть настоящая длина в метрах. */
type RoadDef = (typeof ROAD_PATHS)[number];

/** Длина дороги в метрах — в неё и переводится скорость шага. */
function roadLength(road: RoadDef): number {
  return Math.max(1, Math.hypot(road.to.x - road.from.x, road.to.z - road.from.z));
}

/**
 * Участок дороги ВНЕ города, либо null, если дорога целиком в городе.
 *
 * Дороги идут от центра города к воротам и дальше, поэтому участок вне
 * стен — это хвост дороги. Считаем перебором точек и берём самый длинный
 * непрерывный кусок: дорога может входить в город и выходить из него
 * дважды, и брать «первую точку снаружи» тогда нельзя.
 *
 * Запас от стен — 12 м: у самой стены верблюд с тюками висел бы на
 * кровле башни.
 */
const OUTSIDE_MARGIN = 12;
function outsideCityRange(road: RoadDef): { t0: number; t1: number } | null {
  const STEPS = 240;
  const out: boolean[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const x = road.from.x + (road.to.x - road.from.x) * t;
    const z = road.from.z + (road.to.z - road.from.z) * t;
    out.push(Math.hypot(x - CITY.x, z - CITY.z) > CITY.radius + OUTSIDE_MARGIN);
  }
  let best = { len: 0, t0: 0, t1: 0 };
  let start = -1;
  for (let i = 0; i <= STEPS; i++) {
    if (out[i] && start < 0) start = i;
    const closed = !out[i] || i === STEPS;
    if (start >= 0 && closed) {
      const len = i - start;
      if (len > best.len) best = { len, t0: start / STEPS, t1: i / STEPS };
      start = -1;
    }
  }
  // Короче 30 м дороги — не дорога для каравана, и точка может оказаться
  // вплотную к стене
  if (best.len === 0 || (best.t1 - best.t0) < 0.05) return null;
  return { t0: best.t0, t1: best.t1 };
}

/** Точка на дороге: t = 0 — начало, t = 1 — конец. */
function pointOn(path: { from: { x: number; z: number }; to: { x: number; z: number } }, t: number): { x: number; z: number; y: number; angle: number } {
  const { from, to } = path;
  const x = from.x + (to.x - from.x) * t;
  const z = from.z + (to.z - from.z) * t;
  return { x, z, y: groundHeight(x, z), angle: Math.atan2(to.x - from.x, to.z - from.z) };
}

/** Кто-то, кто идёт по дороге: свой t, скорость и фазa шага. */
interface Walker {
  group: THREE.Group;
  legs: THREE.Object3D[];
  /** Миксер ригованной модели (путник, лошадь): тикается на каждый кадр. */
  зверь?: THREE.AnimationMixer | null;
  /** Модель внутри группы: для качания корпуса на ходу. */
  модель?: THREE.Object3D | null;
  /** Качать корпус на ходу (верблюд, телега — статичные модели). */
  качание?: boolean;
  /** Копытное: из-под него идёт пыль каравана. */
  копытный?: boolean;
  /** Колёса телеги (§295): крутятся по дороге, а не стоят. */
  колёса?: THREE.Object3D[];
  /** 0..1 — где он на дороге. Уходит за 1 и начинает с 0, либо наоборот. */
  t: number;
  dir: 1 | -1;
  speed: number;
  phase: number;
  /** Насколько отстаёт от ведущего по t, чтобы шли колонной, а не стеной. */
  lag: number;
  /**
   * Длина дороги В МЕТРАХ.
   *
   * ТУТ БЫЛО ПРОПИСАНО «/ 12» — то есть «t от 0 до 1 за 12/speed секунд».
   * Для верблюда со скоростью 1,7 это 7 секунд на всю дорогу, а дорога от
   * города до караван-сарая — сотни метров. Итог: караваны и путники неслись
   * мимо со скоростью под 60 м/с, и игрок видел, как они пролетают.
   *
   * Теперь t раскладывается на настоящую длину дороги, и скорость в
   * CARAVAN_SPEED / WALKER_SPEED — это ровно метры в секунду.
   */
  len: number;
  /**
   * Свой участок дороги: откуда до куда ему можно идти.
   *
   * ТУТ БЫЛО НИЧЕГО: путник отыгрывал всю дорогу от 0 до 1. А дороги
   * начинаются В ЦЕНТРЕ ГОРОДА (ROAD_PATHS: from = CITY), и город
   * занимает круг радиусом 116 м. То есть караван с верблюдами и путник
   * шли через городскую площадь, между домами и лотками. Игрок написал:
   * «Верблюды оказались в городе».
   *
   * Теперь участок задаётся outsideCityRange: та часть дороги, что вне
   * стен. Заодно исчезает и вторая ошибка той же строки — откат на
   * [-0.05, 1.05] уводил путника за конец дороги, где полотна нет.
   */
  tMin: number;
  tMax: number;
  /**
   * Дорога, по которой он идёт.
   *
   * ТУТ БЫЛО НЕ ПОЛЕ, А ПРИВЕДЕНИЕ ТИПА: путь писали как
   * `travellers.push(w as Walker & { road: RoadDef })`. Приведение типа —
   * это только подсказка компилятору, на рантайме в объекте ничего не
   * появляется. Итог: w.road === undefined у всех, а цикл обновления
   * начинается с `if (!road) continue` — то есть пропускает каждого.
   *
   * ЧТО ВИДЕЛ ИГРОК. Шесть верблюдов и двенадцать людей стояли в мировом
   * начале координат (0,0) и не двигались ни на шаг. (0,0) — это 43 м от
   * центра Исфахана при радиусе стен 116 м, то есть ровно посреди города.
   * Отсюда «Верблюды оказались в городе». Путники с заданиями, на которых
   * можно кликнуть и получить задание, не работали по той же причине:
   * позиция фигурки никогда не выставлялась, стояла в нуле.
   */
  road?: RoadDef;
}

/**
 * Один человек. Примитивы, как у горожан: у них нет текстур, зато дешево и
 * выглядит уместно рядом с остальным миром.
 */
/**
 * Дорожный путник (§296).
 *
 * БЫЛО: тело — цилиндр, голова — шар, шапка — цилиндр, ноги — цилиндры, и
 * **рук не было вовсе**. Человек без рук читался как столб с шаром наверху.
 *
 * ТЕПЕРЬ: халат-капсула с плечами и перевязью, руки в рукавах (качаются в
 * противофазе с ногами), голова с бородой и носом, тюрбан намотан, а шапка —
 * купол с козырьком.
 */
/**
 * Дорожный путник (§327): настоящая ригованная модель горожанина с клипом
 * ходьбы.
 *
 * БЫЛО: халат-капсула с бородой из примитивов и руками, качающимися синусом.
 * ТЕПЕРЬ: citizen/citizen2/citizen3 — те же модели, что живут в столице,
 * с настоящей походкой из клипа. Ряса и тюрбан ушли вместе с процедурной
 * сборкой: различие путников — в трёх моделях, которые чередуются по номеру.
 *
 * Группа возвращается сразу, модель доезжает по сети: caраван собирается,
 * даже пока файл ещё едет (тот же контракт, что у placeDecor).
 */
function makePerson(idx: number): Walker {
  const g = new THREE.Group();
  const w: Walker = {
    group: g, legs: [], t: 0, dir: 1, speed: WALKER_SPEED,
    phase: Math.random() * 10, lag: 0, len: 0, tMin: 0, tMax: 1,
  };
  void собратьПутника(idx).then((собранный) => {
    if (!собранный) {
      console.warn('[traffic] модель путника не доехала — идёт невидимым');
      return;
    }
    g.add(собранный.модель);
    w.зверь = собранный.миксер;
    w.модель = собранный.модель;
  });
  return w;
}

const ПУТНИКИ_МОДЕЛИ = ['citizen', 'citizen2', 'citizen3'] as const;

/** Собрать одного путника: подгонка, чистка дорожек, клон скелета, миксер. */
async function собратьПутника(
  idx: number, клипКлюч: 'walk' | 'sitIdle' = 'walk',
): Promise<{ модель: THREE.Group; миксер: THREE.AnimationMixer | null } | null> {
  const имя = ПУТНИКИ_МОДЕЛИ[idx % ПУТНИКИ_МОДЕЛИ.length];
  const сцена = await loadCharacterModel(имя);
  if (!сцена) return null;
  const fitted = подогнать(сцена, имя);
  const клип = await loadAnimationClip(клипКлюч);
  if (!клип) return { модель: копияСкелета(fitted) as THREE.Group, миксер: null };
  const чистый = безМёртвыхДорожек(клип, fitted, имя);
  const модель = копияСкелета(fitted) as THREE.Group;
  const миксер = new THREE.AnimationMixer(модель);
  миксер.clipAction(чистый).play();
  return { модель, миксер };
}

/**
 * Телега (§327): готовая модель medieval-cart-lite и настоящая лошадь
 * в оглобле.
 *
 * БЫЛО: кузов из ящиков, колёса с спицами из торусов и лошадь из капсул.
 * ТЕПЕРЬ: телега — GLB (та же, что у рынка), лошадь — ригованная модель с
 * клипом шага. Колёса у готовой телеги не крутятся: они часть меша, и
 * разбирать модель ради вращения — дороже, чем потеря вращения.
 */
function makeCart(idx: number): Walker {
  const g = new THREE.Group();
  const w: Walker = {
    group: g, legs: [], t: 0, dir: 1, speed: CARAVAN_SPEED,
    phase: Math.random() * 10, lag: 0, len: 0, tMin: 0, tMax: 1, качание: true,
  };
  void loadDecorModel('decor/medieval-cart-lite.glb').then((телега) => {
    if (!телега) { console.warn('[traffic] модель телеги не доехала'); return; }
    const вещь = телега.clone();
    вещь.scale.setScalar(1); // масштаб рынка: модель в метрах
    вещь.traverse((o) => {
      const м = o as THREE.Mesh;
      if (м.isMesh) { м.castShadow = true; м.receiveShadow = true; }
    });
    g.add(вещь);
    w.модель = вещь;
  });
  // Лошадь впереди, в оглобле: ригованная модель, клип шага играет на ходу.
  void собратьЗверя('horse', 2.4).then((зверь) => {
    if (!зверь) { console.warn('[traffic] лошадь телеги не доехала'); return; }
    зверь.group.position.set(0, 0, 2.6);
    g.add(зверь.group);
    w.зверь = зверь.mixer;
  });
  // Возница на козлах: клип сидения, иначе он бы застыл в позе привязки.
  void собратьПутника(idx, 'sitIdle').then((собранный) => {
    if (!собранный) return;
    собранный.модель.position.set(0, 0.95, 0.9);
    g.add(собранный.модель);
    if (собранный.миксер) { w.зверь = собранный.миксер; }
  });
  return w;
}

/**
 * Караванный верблюд (§327): статичная готовая модель.
 *
 * БЫЛО: тело-капсула с двумя шарами-горбами и ногами из цилиндров. ТЕПЕРЬ:
 * модель дромадера (Google Poly, CC-BY). Модель без рига: на ходу корпус
 * качается целиком (качание), ноги не машут — на походке каравана это
 * читается, шаг вёрстовых верблюдов и так медленный.
 */
function makeCamel(): Walker {
  const g = new THREE.Group();
  const w: Walker = {
    group: g, legs: [], t: 0, dir: 1, speed: CARAVAN_SPEED,
    phase: Math.random() * 10, lag: 0, len: 0, tMin: 0, tMax: 1,
    качание: true, копытный: true,
  };
  void собратьЗверя('camel', 2.9).then((зверь) => {
    if (!зверь) { console.warn('[traffic] верблюд не доехал'); return; }
    g.add(зверь.group);
    w.модель = зверь.group;
  });
  return w;
}

/** Жёлтый восклицательный знак над тем, кто даёт задание. */
function questMarker(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = '#f4d26c';
  g.strokeStyle = '#2a2018';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(32, 6); g.lineTo(44, 24); g.lineTo(20, 24); g.closePath();
  g.fill(); g.stroke();
  g.beginPath();
  g.arc(32, 36, 5, 0, Math.PI * 2);
  g.fill(); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(WALKER_MARKER_SIZE, WALKER_MARKER_SIZE, 1);
  sp.position.y = 2.35;
  return sp;
}

/** Высота метки путника в мировых единицах. Держится в одном числе с scale.set выше. */
const WALKER_MARKER_SIZE = 0.5;

/** Имена путников. Тот, кто даёт задание, должен звучать как человек. */
const WALKER_NAMES = [
  'Караванщик Мамед', 'Странник Расул', 'Купец Али', 'Путница Назар',
  'Обозник Джафар', 'Нищий Ибрагим', 'Торговец Фатали', 'Послушник Абдул',
];

export function createRoadTraffic(scene: THREE.Scene): RoadTrafficHandle {
  const group = new THREE.Group();
  scene.add(group);
  const clickTargets: THREE.Object3D[] = [];

  const travellers: Walker[] = [];
  const caravanPaths: typeof ROAD_PATHS = [];
  // Фонари караванов (§254): у каждой колонны один, у головы.
  const фонари: {
    лидер: Walker;
    свет: THREE.PointLight;
    высота: number;
    локX: number;
    локZ: number;
  }[] = [];
  // Пыль из-под копыт (§255): караван шёл по песку и не поднимал пыли.
  const караваны: { верблюды: Walker[]; пыль: Puffs; таймер: number }[] = [];

  // ── Караваны ───────────────────────────────────────────────
  // Идут по дальним дорогам, чтобы не резать игроку путь в город. Три штуки
  // с разными стартовыми точками — иначе они слипаются в одну колонну.
  // Дорога берётся, только если у неё есть кусок вне стен. Дорога от города
  // к точке возрождения (ROAD_PATHS[0]) целиком внутри города — 43 м при
  // радиусе стен 116 м, — и каравану на ней делать нечего.
  const caravanRoads = [ROAD_PATHS[3], ROAD_PATHS[1], ROAD_PATHS[2]]
    .filter(Boolean)
    .map(road => ({ road, range: outsideCityRange(road) }))
    .filter((x): x is { road: RoadDef; range: { t0: number; t1: number } } => x.range !== null);
  for (const { road } of caravanRoads) caravanPaths.push(road);

  caravanRoads.forEach(({ road, range }, ci) => {
    // Колонна: замыкающий, верблюд, верблюд, замыкающий постом сзади.
    const column: Walker[] = [
      makePerson(ci * 4 + 0),
      makeCamel(),
      makeCamel(),
      makePerson(ci * 4 + 1),
    ];
    // Отставание по t: метры вдоль дороги между соседями
    const lags = [0, -0.018, -0.036, -0.054];
    column.forEach((w, i) => {
      // Старт — на своём участке, а не в 15% пути от центра города
      const span = range.t1 - range.t0;
      w.tMin = range.t0;
      w.tMax = range.t1;
      w.t = range.t0 + span * ((0.15 + ci * 0.3) % 1);
      w.dir = ci % 2 === 0 ? 1 : -1;
      // Отставание не должно выкидывать замыкающего за стену города
      w.lag = Math.max(lags[i], -span * 0.1);
      // Сзади идёт замыкающий, поэтому у него знак минус: он позади
      group.add(w.group);
      w.len = roadLength(road);
      w.road = road;
      travellers.push(w);
    });
    // Фонарь у головы колонны (§254) и источник света при нём.
    const глава = column[0];
    const фонарь = makeLantern();
    фонарь.группа.position.set(0.5, 1.15, 0.34);
    глава.group.add(фонарь.группа);
    const свет = new THREE.PointLight(0xffa04a, 0, 18, 1.8);
    scene.add(свет);
    фонари.push({
      лидер: глава,
      свет,
      высота: 0.95 + фонарь.высота,
      локX: 0.5,
      локZ: 0.34,
    });
    // Пыль из-под копыт (§255): клуб поднимается там, где верблюд ступил.
    const пыль = createPuffs(scene, {
      количество: 16,
      цвет: 0xd9c69e,
      размер: 0.5,
      рост: 1.9,
      жизнь: 1.5,
      подъём: 0.45,
      разброс: 0.4,
      непрозрачность: 0.4,
    });
    караваны.push({ верблюды: column.filter(w => w.копытный), пыль, таймер: 0 });
  });

  // ── Путники с заданиями ────────────────────────────────────
  // Шестеро. Двое из них дают задание — на них можно кликнуть, и откроется
  // панель задач, ровно как у городских NPC с флагом quest.
  const WALKERS_PER_ROAD = 3;
  // ТУТ БЫЛО ROAD_PATHS[i % ROAD_PATHS.length] и w.t = (i * 0.17) % 1.
  // Первая дорога идёт от центра города к точке возрождения и целиком лежит
  // внутри стен (43 м при радиусе 116), а t = 0 — это ровно площадь. Путники
  // стояли посреди Исфахана, и город выглядел так, будто по нему идёт
  // случайный поток. Теперь дорога отбирается с участком вне стен.
  const walkerRoads = ROAD_PATHS
    .map(road => ({ road, range: outsideCityRange(road) }))
    .filter((x): x is { road: RoadDef; range: { t0: number; t1: number } } => x.range !== null);
  const WALKER_COUNT = WALKERS_PER_ROAD * 2;
  for (let i = 0; i < WALKER_COUNT && walkerRoads.length > 0; i++) {
    const { road, range } = walkerRoads[i % walkerRoads.length];
    const hasQuest = i % 3 === 0;
    const name = WALKER_NAMES[i % WALKER_NAMES.length];
    const w = makePerson(8 + i);
    const span = range.t1 - range.t0;
    w.tMin = range.t0;
    w.tMax = range.t1;
    w.t = range.t0 + span * ((i * 0.37) % 1);
    w.dir = i % 2 === 0 ? 1 : -1;
    w.speed = WALKER_SPEED * (0.85 + (i % 3) * 0.12);

    if (hasQuest) {
      const marker = questMarker();
      w.group.add(marker);
      w.group.userData.npcPanel = 'panel-quests';
      w.group.userData.npcName = name;
      w.group.userData.npcId = `road_wanderer_${i}`;
      clickTargets.push(w.group);
    }
    group.add(w.group);
    w.len = roadLength(road);
    w.road = road;
    travellers.push(w);
  }

  // ── Телеги с лошадьми (§295) ───────────────────────────────────
  //
  // По дорогам ездили только люди и верблюды караванов: телег не было
  // вовсе, и груз в мире возили как-то незаметно. Две телеги на дорогах —
  // кузов, колёса со спицами, оглобель, купец на козлах и лошадь в оглобле.
  for (let i = 0; i < 2 && walkerRoads.length > 0; i++) {
    const { road, range } = walkerRoads[(i + 1) % walkerRoads.length];
    const телега = makeCart(12 + i);
    телега.tMin = range.t0;
    телега.tMax = range.t1;
    const span = range.t1 - range.t0;
    телега.t = range.t0 + span * (0.35 + i * 0.25);
    телега.dir = i % 2 === 0 ? 1 : -1;
    телега.len = roadLength(road);
    телега.road = road;
    group.add(телега.group);
    travellers.push(телега);
  }

  function update(dt: number, now: number, px: number,pz: number, night = 0): void {
    // Фонари караванов (§254): едут вместе с колонной и горят по ночному
    // правилу — днём тише, ночью в полную силу. Вдали гаснут: каравана не
    // видно, а источник в сцене всё равно стоит кадру.
    for (const ф of фонари) {
      const p = ф.лидер.group.position;
      if (Math.hypot(p.x - px, p.z - pz) > VISIBLE_DIST) {
        ф.свет.intensity = 0;
        continue;
      }
      const a = ф.лидер.group.rotation.y;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      ф.свет.position.set(
        p.x + ф.локX * ca + ф.локZ * sa,
        p.y + ф.высота,
        p.z - ф.локX * sa + ф.локZ * ca,
      );
      ф.свет.intensity = 1.6 * (0.35 + night * 0.65);
    }
    // Пыль из-под копыт (§255): клуб там, где верблюд ступил, и он уходит
    // сам через полторы секунды.
    for (const к of караваны) {
      к.таймер += dt;
      if (к.таймер >= 0.4) {
        к.таймер = 0;
        for (const в of к.верблюды) {
          const p = в.group.position;
          if (Math.hypot(p.x - px, p.z - pz) > VISIBLE_DIST) continue;
          к.пыль.всплеск(p.x, p.y + 0.12, p.z);
        }
      }
      к.пыль.update(dt);
    }
    for (const w of travellers) {
      const road = w.road;
      if (!road) continue;

      // Идём вперёд. Отставание держит колонну: у каждого своё t, но оно
      // сдвинуто на lag, поэтому задние идут ровно позади передних.
      w.t += (w.dir * w.speed * dt) / w.len;
      if (w.t > w.tMax) { w.t = w.tMax; w.dir = -1; }
      if (w.t < w.tMin) { w.t = w.tMin; w.dir = 1; }

      const along = THREE.MathUtils.clamp(w.t + w.lag, w.tMin, w.tMax);
      const p = pointOn(road, along);
      w.group.position.set(p.x, p.y, p.z);
      w.group.rotation.y = w.dir > 0 ? p.angle : p.angle + Math.PI;

      // Не рисуем то, чего не видно. Проверка дешёвая, а дороги длинные.
      // Именно `!==`, а не `===`: при `===` присваивание происходило ровно
      // тогда, когда видимость УЖЕ была правильной, то есть строка ничего
      // не меняла. Караваны за пределами видимости никогда не скрывались и
      // целиком продолжали трансформироваться и уходить в отрисовку.
      const far = Math.hypot(p.x - px, p.z - pz) > VISIBLE_DIST;
      if (w.group.visible !== !far) w.group.visible = !far;
      if (far) continue;

      // Ригованный путник или лошадь: клип шага тикается сам.
      if (w.зверь) w.зверь.update(dt);
      // Статичная модель (верблюд, телега): корпус покачивается на ходу.
      if (w.качание && w.модель) {
        w.phase += dt * w.speed * 3.1;
        w.модель.position.y = Math.abs(Math.sin(w.phase)) * 0.07;
        w.модель.rotation.z = Math.sin(w.phase * 0.5) * 0.03;
      }
      // Метка над головой чуть покачивается, чтобы её было видно издалека
      const marker = w.group.children.find(c => c instanceof THREE.Sprite);
      if (marker) {
        marker.position.y = 2.35 + Math.sin(now / 320) * 0.06;
        // Метка — спрайт мирового размера, а такие растут при приближении
        // без предела. Строки выше гасят группу вдали (там метка мелкая и
        // нужна), но в упор она как раз разрасталась: путник, к которому
        // подошли вплотную, получал метку на треть экрана поверх дороги.
        marker.visible = spriteVisible(WALKER_MARKER_SIZE, Math.hypot(p.x - px, p.z - pz));
      }
    }
  }

  function dispose(): void {
    for (const к of караваны) к.пыль.dispose();
    group.traverse(o => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        const g = o.geometry;
        g?.dispose?.();
        const m = o.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach(x => x.dispose?.());
        else m?.dispose?.();
      }
    });
    scene.remove(group);
  }

  return { update, clickTargets, dispose };
}
