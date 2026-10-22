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
import { ROAD_PATHS, CITY, groundHeight } from './terrain';
import { spriteVisible } from './spriteClamp';
import { createPuffs, type Puffs } from './puffs';

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
function makePerson(robeColor: number, hat: 'turban' | 'cap' | 'none'): Walker {
  const g = new THREE.Group();
  const robe = new THREE.MeshStandardMaterial({ color: robeColor, roughness: 1 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.36, 1.0, 8), robe);
  body.position.y = 1.05;
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 7), M.skin);
  head.position.y = 1.72;
  head.castShadow = true;
  g.add(head);

  if (hat === 'turban') {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.16, 8), M.skin);
    t.position.y = 1.9;
    g.add(t);
  } else if (hat === 'cap') {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.24, 0.14, 8), M.dark);
    c.position.y = 1.88;
    g.add(c);
  }

  const legs: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.95, side * 0.13);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.95, 6), M.dark);
    leg.position.y = -0.47;
    leg.castShadow = true;
    pivot.add(leg);
    g.add(pivot);
    legs.push(pivot);
  }

  return { group: g, legs, t: 0, dir: 1, speed: WALKER_SPEED, phase: 0, lag: 0, len: 0, tMin: 0, tMax: 1 };
}

/** Верблюд с тюком. Ноги — четыре отдельные, чтобы шаг читался. */
/**
 * Телега с лошадью (§295).
 *
 * БЫЛО: по дорогам ездили люди и верблюды караванов — телег не было вовсе, и
 * груз в мире возили как-то незаметно.
 *
 * ТЕПЕРЬ: телега с дощатым кузовом и бортами, колёсами с ободом и спицами,
 * оглоблем и купцом на козлах; лошадь с капсульным телом, шеей, гривой и
 * хвостом. Колёса крутятся по дороге, лошадь шагает.
 */
function makeCart(robeColor: number): Walker & { колёса: THREE.Object3D[] } {
  const г = new THREE.Group();
  const колёса: THREE.Object3D[] = [];
  const дерево = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.95 });
  const деревоТ = new THREE.MeshStandardMaterial({ color: 0x6b4f31, roughness: 0.95 });

  // Кузов: настил и борта из досок.
  const кузов = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, 2.1), дерево);
  кузов.position.y = 0.78;
  г.add(кузов);
  for (const сторона of [-1, 1]) {
    const борт = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 2.1), дерево);
    борт.position.set(сторона * 0.62, 1.06, 0);
    г.add(борт);
  }
  const передок = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.55, 0.08), дерево);
  передок.position.set(0, 1.06, -1.02);
  г.add(передок);
  const задок = передок.clone();
  задок.position.z = 1.02;
  г.add(задок);

  // Колёса: обод, шесть спиц, ступица. Обод — тор, спицы — тонкие бруски.
  const колесо = (x: number, z: number, r: number) => {
    const вращение = new THREE.Group();
    вращение.position.set(x, r, z);
    const обод = new THREE.Mesh(new THREE.TorusGeometry(r, 0.055, 5, 16), деревоТ);
    обод.rotation.y = Math.PI / 2;
    вращение.add(обод);
    for (let i = 0; i < 6; i++) {
      const спица = new THREE.Mesh(new THREE.BoxGeometry(0.05, r * 1.8, 0.05), дерево);
      спица.rotation.x = (i / 6) * Math.PI;
      вращение.add(спица);
    }
    const ступица = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8), деревоТ);
    ступица.rotation.z = Math.PI / 2;
    вращение.add(ступица);
    г.add(вращение);
    колёса.push(вращение);
  };
  колесо(-0.72, -0.72, 0.52);
  колесо(0.72, -0.72, 0.52);
  колесо(-0.72, 0.72, 0.4);
  колесо(0.72, 0.72, 0.4);

  // Оглобель: два бруска от передка к лошади.
  for (const сторона of [-1, 1]) {
    const оглобель = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.5), деревоТ);
    оглобель.position.set(сторона * 0.34, 0.66, 1.55);
    г.add(оглобель);
  }
  // Козлы: сиденье купца.
  const козлы = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.1, 0.45), дерево);
  козлы.position.set(0, 0.98, -0.25);
  г.add(козлы);

  // КУПЕЦ на козлах.
  const купец = new THREE.Group();
  const халат = new THREE.MeshStandardMaterial({ color: robeColor, roughness: 1 });
  const корпус = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.85, 8), халат);
  корпус.position.y = 0.42;
  купец.add(корпус);
  const голова = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 7), M.skin);
  голова.position.y = 1.0;
  купец.add(голова);
  const тюрбан = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 8), M.skin);
  тюрбан.position.y = 1.14;
  купец.add(тюрбан);
  купец.position.set(0, 1.0, -0.25);
  г.add(купец);

  // ЛОШАДЬ перед оглоблем.
  const лошадь = new THREE.Group();
  const шерсть = new THREE.MeshStandardMaterial({ color: 0x5a4432, roughness: 0.95 });
  const телоЛ = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.05, 4, 12), шерсть);
  телоЛ.rotation.x = Math.PI / 2;
  телоЛ.position.y = 1.05;
  телоЛ.castShadow = true;
  лошадь.add(телоЛ);
  const шея = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.5, 3, 9), шерсть);
  шея.position.set(0, 1.42, 0.78);
  шея.rotation.x = 0.6;
  лошадь.add(шея);
  const головаЛ = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.3, 3, 9), шерсть);
  головаЛ.rotation.x = Math.PI / 2;
  головаЛ.position.set(0, 1.72, 1.08);
  лошадь.add(головаЛ);
  const мордаЛ = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.26, 7), шерсть);
  мордаЛ.rotation.x = Math.PI / 2;
  мордаЛ.position.set(0, 1.66, 1.36);
  лошадь.add(мордаЛ);
  // Грива и хвост.
  const грива = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.6), M.dark);
  грива.position.set(0, 1.62, 0.78);
  грива.rotation.x = 0.5;
  лошадь.add(грива);
  const хвост = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.11, 0.6, 6), M.dark);
  хвост.position.set(0, 1.05, -0.78);
  хвост.rotation.x = -0.6;
  лошадь.add(хвост);

  const ноги: THREE.Object3D[] = [];
  for (const x of [-0.26, 0.26]) {
    for (const z of [-0.62, 0.62]) {
      const пивот = new THREE.Group();
      пивот.position.set(x, 0.92, z);
      const нога = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.055, 0.86, 6), шерсть);
      нога.position.y = -0.43;
      нога.castShadow = true;
      const копыто = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.09, 6), M.dark);
      копыто.position.y = -0.87;
      пивот.add(нога, копыто);
      лошадь.add(пивот);
      ноги.push(пивот);
    }
  }
  лошадь.position.set(0, 0, 2.3);
  г.add(лошадь);

  return { group: г, legs: ноги, колёса, t: 0, dir: 1, speed: CARAVAN_SPEED * 0.8, phase: 0, lag: 0, len: 0, tMin: 0, tMax: 1 };
}

function makeCamel(packColor: THREE.Material): Walker {
  const g = new THREE.Group();

  // ТЕЛО: капсула вдоль Z (верблюд идёт по +Z), уже, чем в высоту (§294).
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.05, 4, 12), M.camel);
  body.rotation.x = Math.PI / 2;
  body.position.y = 1.35;
  body.scale.set(1, 1, 0.92);
  body.castShadow = true;
  g.add(body);

  // Горбы: два, над лопатками и над крестцом.
  for (const z of [-0.42, 0.32]) {
    const hump = new THREE.Mesh(new THREE.SphereGeometry(0.36, 9, 7), M.camelDark);
    hump.position.set(0, 1.82, z);
    hump.scale.set(1.05, 0.95, 1.25);
    hump.castShadow = true;
    g.add(hump);
  }

  // Шея и голова — капсулы, морда сужается к носу.
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.62, 3, 9), M.camel);
  neck.position.set(0, 1.86, 0.78);
  neck.rotation.x = 0.52;
  neck.castShadow = true;
  g.add(neck);
  const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.28, 3, 9), M.camelDark);
  head.rotation.x = Math.PI / 2;
  head.position.set(0, 2.2, 1.12);
  head.castShadow = true;
  g.add(head);
  const морда = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.3, 7), M.camel);
  морда.rotation.x = Math.PI / 2;
  морда.position.set(0, 2.12, 1.42);
  g.add(морда);
  for (const side of [-1, 1]) {
    const ухо = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 5), M.camelDark);
    ухо.position.set(side * 0.11, 2.33, 1.03);
    ухо.rotation.set(side * 0.3, 0, -0.2);
    g.add(ухо);
  }

  // СЕДЛО, ПОПОНА И ТЮКИ. Караван видно издалека именно по гружёным верблюдам.
  const попона = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.1, 1.35), M.camelDark);
  попона.position.set(0, 1.78, -0.05);
  g.add(попона);
  const седло = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.16, 0.5), M.wood);
  седло.position.set(0, 1.88, -0.05);
  g.add(седло);
  for (const side of [-1, 1]) {
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.78), packColor);
    pack.position.set(side * 0.6, 1.48, -0.05);
    pack.castShadow = true;
    g.add(pack);
    // Верёвка, стягивающая тюк: без неё тюк выглядит приклеенным.
    const верёвка = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.022, 4, 10), M.wood);
    верёвка.position.set(side * 0.6, 1.5, -0.05);
    верёвка.rotation.set(0, Math.PI / 2, 0);
    g.add(верёвка);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.44, 0.92), M.wood);
  top.position.set(0, 2.24, -0.32);
  top.castShadow = true;
  g.add(top);

  const legs: THREE.Object3D[] = [];
  for (const x of [-0.34, 0.34]) {
    for (const z of [-0.62, 0.62]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.95, z);
      // Нога сужается к копыту (§294): ровный цилиндр читался как палка.
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.065, 0.88, 6), M.camel);
      leg.position.y = -0.44;
      leg.castShadow = true;
      const копыто = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.09, 6), M.camelDark);
      копыто.position.y = -0.9;
      pivot.add(leg, копыто);
      g.add(pivot);
      legs.push(pivot);
    }
  }

  return { group: g, legs, t: 0, dir: 1, speed: CARAVAN_SPEED, phase: 0, lag: 0, len: 0, tMin: 0, tMax: 1 };
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

  const PACKS = [M.pack1, M.pack2, M.pack3];
  caravanRoads.forEach(({ road, range }, ci) => {
    // Колонна: замыкающий, верблюд, верблюд, замыкающий постом сзади.
    const column: Walker[] = [
      makePerson(0x6a5636, 'cap'),
      makeCamel(PACKS[ci % PACKS.length]),
      makeCamel(PACKS[(ci + 1) % PACKS.length]),
      makePerson(0x4c5a6a, 'turban'),
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
    фонарь.группа.position.set(0.34, 0.95, 0.22);
    глава.group.add(фонарь.группа);
    const свет = new THREE.PointLight(0xffa04a, 0, 18, 1.8);
    scene.add(свет);
    фонари.push({
      лидер: глава,
      свет,
      высота: 0.95 + фонарь.высота,
      локX: 0.34,
      локZ: 0.22,
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
    караваны.push({ верблюды: column.filter(w => w.legs.length === 4), пыль, таймер: 0 });
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
    const w = makePerson(0x3a3a42 + (i % 4) * 0x0a1410, i % 2 === 0 ? 'turban' : 'cap');
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
    const телега = makeCart(i === 0 ? 0x6a4a7a : 0x4a6a5a);
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

      // Шаг: ноги в противофазе, частота от скорости
      w.phase += dt * w.speed * 3.1;
      const swing = Math.sin(w.phase) * 0.55;
      for (let i = 0; i < w.legs.length; i++) {
        w.legs[i].rotation.x = (i % 2 === 0) ? swing : -swing;
      }
      // Колёса телеги (§295): крутятся по пройденному пути.
      if (w.колёса) {
        const оборот = (dt * w.speed) / 0.52;
        for (const к of w.колёса) к.rotation.x += оборот * w.dir;
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
