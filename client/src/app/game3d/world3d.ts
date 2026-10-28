// ============================================================
// World3D — 3D-движок игры — Empire of Safavids
// ============================================================
// Сцена Three.js: рельеф, город, лагерь, растительность; камера от
// третьего лица с орбитой 360° и зумом (pointer lock); физика
// персонажа (бег/прыжок/присед/блок); прицеливание лучом; боевые
// эффекты и плавающий урон. Сетевые данные читает из entities.World.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { DeferredPass } from './deferred/deferredPass';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SSRPass } from 'three/examples/jsm/postprocessing/SSRPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { t } from '../i18n';
import { World, PlayerEntity } from '../entities';
import { STANCES, getStance } from '../stance';
import { buildPlayerRig, buildMonsterRig, Rig, type DodgeDirection } from './rig';
import { loadRealPlayerRig, CLASS_WEAPON, ростПозы } from './realRig';
import { loadRealMonsterRig, preloadModels } from './characterModels';
import { обновитьСтражей } from './interiors';
import {
  groundHeight, buildTerrain, buildScatter, buildCity, buildCamp, buildWater, buildSettlements, buildRoads,
  buildRegionTowns, buildAqueduct, buildTradeTent, buildVillageForge, buildRuinGate,
  buildSignposts, buildGameTable, buildCows, updateCows, buildBazaarStatue,
buildCaravanseraiTorches, buildVillageSwords, buildBazaarChests,
  buildPassageTorches, ФОНАРИ_ГРОБНИЦЫ,
  ТОРЧ_СВЕТ_ЦВЕТ, ТОРЧ_СВЕТ_ЯРКОСТЬ, ТОРЧ_СВЕТ_ДАЛЬНОСТЬ, buildMosqueCourtyard,
  buildFortBastions, buildRuinChapel, buildRuinCourt, buildOaks,
  buildRuinBridge, buildPassRocks, buildDesertTower,
  buildVillageArchway, buildChurchDoorway, buildOnionDomeTower, buildGallows,
  buildMarketCart, buildGallowsPalisade, buildPortRoadBarricade, buildCaravanseraiWindmill,
  buildMillPlough, buildVillageGrindstone,
  bridgeAt, waterSurfaceY, WORLD_HALF, CITY, CAMP, LAKE, COLLIDERS, FAUNA_COLLIDERS, CIV_COLLIDERS,
} from './terrain';
import { waterMaterials, followSeaToCamera, качающиеся, setGroundState, setSnowOnSurfaces, setPuddles, дымныеТрубы, лодкиУПира, чайкиНаПричале, hash2, огниФонарей } from './terrain';
import { createSky, SkyHandle, SKY_RADIUS } from './sky';
import { createPuffs, type Puffs } from './puffs';
import { createDustDevils, type DustDevilsHandle } from './dustDevil';
import { createMirage, type MirageHandle } from './mirage';
import { createRoadDust, type RoadDustHandle } from './roadDust';
import { createRoadWater, type RoadWaterHandle } from './roadWater';
import { createCaravanTracks, type CaravanTracksHandle } from './caravanTracks';
import { createBirds, type BirdsHandle } from './birds';
import { createGlints, type GlintsHandle } from './wetGlints';
import { createRipples, type RipplesHandle } from './boatRipples';
import { createPuddleRipples, type PuddleRipplesHandle } from './puddleRipples';
import { SkyEnvironment, type SkyState } from './skyEnvironment';
import { createFauna, FaunaHandle } from './fauna';
import { тикатьЗверей } from './animalModels';
import { createNpcs, NpcsHandle } from './npc';
import { createCivilians, CiviliansHandle } from './civilians';
import { createTownfolk, TownfolkHandle } from './townfolk';
import { createRoadTraffic, RoadTrafficHandle } from './roadTraffic';
import { createWeather, WeatherHandle, type WeatherKind } from './weather';
import { buildTownBuildings, createInteriors, InteriorsHandle, INTERIOR_COLLIDERS, POCKET_COLLIDERS, buildPocketGround, pocketGroundY, BUILDINGS, M } from './interiors';
import { DestructibleData, damageDestructible, applyDestructibleVisuals, createBreakEffect } from './destructible';
import { setTextureAnisotropy } from './textures';
import { setSurfaceAnisotropy } from './surfaces';
import { createNavigator, NavigatorHandle, NavTarget } from './navigator';
import { chopFor } from './waterWaves';
import { audio } from '../audio';
import { session } from '../state';
import { getSettings, graphicsProfile, type GraphicsLevel } from '../settings';
import { chatVisible } from '../hud';

export interface World3DCallbacks {
  onAttack: () => void;
  onTarget: (name: string, hp: number, maxHp: number) => void;
  onTargetCleared: () => void;
  /** Клик по NPC: открыть связанную панель */
  onNpc?: (panel: string, nameRu: string, npcId: string) => void;
  /** Клик по двери здания: войти/выйти (мир уже телепортирован, нужен только тост). */
  onDoor?: (action: 'enter' | 'exit', buildingId: string, nameRu: string, entranceId?: string) => void;
  /** Клик по интерактивному объекту: ящик, кувшин, навес. */
  onInteractive?: (kind: string, state: string, obj: THREE.Object3D) => void;
}

/** Экипировка своего персонажа, видимая на 3D-аватаре */
export interface LocalGear {
  /** Оружие надето — в руке видно клинок */
  weapon: boolean;
  /** Цвет груди по редкости доспеха; null — брони нет */
  armorColor: number | null;
  /**
   * Время одного замаха в секундах — из данных предмета.
   *
   * null или отсутствует — оружия нет либо экипировка ещё не пришла, тогда
   * берётся DEFAULT_WEAPON.speed (0.45).
   */
  swingSeconds?: number | null;
}

/**
 * Замах пустых рук: ровно то, что стоит в данных как DEFAULT_WEAPON.speed.
 * Раньше эта цифра была вбита в замах дважды и не имела ничего общего с
 * предметами: смена оружия на быстрое ничего не ускоряла.
 */
const ЗАМАХ_ПУСТЫМИ_РУКАМИ = 0.45;

const GRAVITY = 20;
const JUMP_V = 7.6;
const WALK_SPEED = 4.2;
const RUN_SPEED = 7.6;
const CROUCH_SPEED = 2.2;
/** Во сколько раз бег верхом быстрее шага верхом */
const MOUNT_SPRINT_MULT = 1.4;
const PLAYER_R = 1.0;   // радиус персонажа для столкновений
const CAMERA_R = 0.35;  // камера может прижиматься к стене ближе, чем персонаж
// ── Камера и стены (§369) ──
/** Шаг сэмплирования луча «игрок → камера». ВЫБОР: меньше диаметра камеры
 *  (2 * CAMERA_R = 0.7), чтобы стена не проскочила между пробами. */
const CAMERA_SAMPLE_STEP = 0.4;
/** С какой дистанции начинаем луч: ближе — камера внутри персонажа. */
const CAMERA_SAMPLE_MIN = 1.2;
/** Потолок дистанции в интерьерах. ВЫБОР: комната шириной 22 м, и камера
 *  на 7.5 м в ней всегда упирается в дальнюю стену — теснее виднее. */
const CAMERA_INDOOR_MAX = 5;
/** Скорость сглаживания (в секунду, экспоненциально). ВЫБОР: камера
 *  успевает уйти от стены за долю секунды и так же спокойно возвращается. */
const CAMERA_PULL_RATE = 10;
/**
 * Скорость доворота персонажа в направлении движения, доля пути к цели за секунду.
 *
 * Стоит 10, а не 1: мгновенный доворот читается как рывок, особенно когда камера
 * крутится мышью. За 0,1 с персонаж проходит 63 % угла, за 0,3 с - 95 %.
 */
const FACE_TURN_RATE = 10;
/**
 * Крен камеры: скорость наклона в секунду и предел, рад.
 *
 * Предел 0,6 радиана - это 34 градуса. Дальше горизонт уезжает так, что «вперёд» на
 * экране перестаёт быть «вперёд», и управление становится неудобным. 34 градуса дают
 * заметный наклон и оставляют направление шага читаемым.
 */
const ROLL_RATE = 1.1;
const ROLL_LIMIT = 0.6;
/**
 * Окно связки ударов, мс. Повторный клик внутри окна — вторая стадия
 * (обратный замах), клик позже — связка начинается заново с первой.
 *
 * 2000, а не 4000 как серверная цепочка: сервер считает серию для урона по
 * своим часам и своему окну, а это окно — про ритм замахов на экране.
 * Окно обязано быть шире самого долгого замаха, иначе вторую стадию
 * нельзя было бы выбить в принципе.
 */
const COMBO_WINDOW_MS = 2000;

/**
 * Как часто искать в сцене материалы, появившиеся после прошивки G-buffer, с.
 *
 * Мир прошивается один раз после постройки, но игрок, монстры, лошади и
 * караваны приходят в сцену моделями — в любой момент. Прошивка нового
 * материала — это обход сцены и компиляция шейдера, поэтому каждый кадр её
 * делать нельзя, а раз в две секунды она не видна: AO на пришедшем монстре
 * появляется на секунду позже, и это не замечается.
 */
const ПЕРИОД_ПРОШИВКИ = 2;
/** Клавиши, двойное нажатие которых означает рывок: WASD плюс стрелки */
const DOUBLE_TAP_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
const DODGE_SPEED = 15.0;    // скорость рывка, юниты/сек
const DODGE_TIME_MS = 220;   // сколько длится сам рывок, мс

// ── Вода ──
// Глубина считается от НАСТОЯЩЕГО дна (ландшафт) до поверхности воды,
// а не по маске waterMask: маска лишь говорит «здесь вода», но не насколько.
// Именно глубина решает, бродит персонаж или плывёт.
const WADE_MIN_DEPTH = 0.15;  // от этой глубины ноги уже в воде
const SWIM_MIN_DEPTH = 1.2;   // глубже — плавание, мельче — брод по дну
const SWIM_FEET = 1.2;        // во время плавания ноги на столько ниже поверхности
const SWIM_SPEED = 2.0;       // обычное плавание (быстрее идти, чем бродить)
const SWIM_SPRINT = 3.2;      // плавание с усилием
const WADE_MULT = 0.75;       // замедление в броду по воде

interface BoundRig {
  rig: Rig;
  kind: 'player' | 'monster';
  /**
   * Настоящая модель уже запрошена и подставлена (или попытка закончилась).
   *
   * Ставится один раз на риг: без этой отметки каждый кадр снова спрашивал бы
   * файл из сети, а кеш загрузчика всё равно отдал бы то же самое.
   */
  realModelTried?: boolean;
  /** Монстр оказался в глубокой воде и плывёт (поза и анимация) */
  monsterSwim?: boolean;
  /** Подводное существо: рисуется на поверхности, а не под ней */
  aquatic?: boolean;
  /** Насколько тело поднято над водой (спина торчит) */
  aquaticLift?: number;
}

/**
 * Куда дует ветер, в радианах (§258). Зелень наклоняется по этому вектору.
 * Одно направление на весь мир: ветер в мире один, а не свой в каждом кусте.
 */
const НАПРАВЛЕНИЕ_ВЕТРА = 0.7;

/**
 * Сила ветра по погоде (§281).
 *
 * В мире ветер один, но зелень его чувствует по-разному: в буре ветку рвёт,
 * в штиль она еле шевелится. Числа — по ощущению, а не по measurement: важно,
 * чтобы разница читалась, а не была точной.
 */
export function ветерСилы(weather: string): number {
  switch (weather) {
    case 'storm': return 2.3;
    case 'sandstorm': return 1.7;
    case 'wind': return 1.5;
    case 'rain': return 1.15;
    case 'cloudy': return 0.85;
    case 'snow': return 0.5;
    case 'fog': return 0.4;
    default: return 0.7;
  }
}

export class World3D {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  /** Композитор для SSAO + SSR + Bloom. Без них сцена выглядит плоской. */
  private composer!: EffectComposer;
  private deferred!: DeferredPass;
  private ssrPass!: SSRPass;
  private bloomPass!: UnrealBloomPass;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private torches: { light: THREE.PointLight; base: number; phase: number }[] = [];
  /**
   * Источники, которые горят постоянно: свет в проёмах и фонари.
   *
   * Отдельным списком от torches, потому что уличный факел днём горит в
   * четверть силы (0.35 + night * 0.65), а в проёме и под фонарём темно
   * всегда: солнце туда не доходит.
   */
  private lamps: { light: THREE.PointLight; base: number }[] = [];
  private flames: THREE.Mesh[] = [];
  /** Дым над большими огнями (§255): костёр в лагере и факелы караван-сарая. */
  private дым: { дым: Puffs; x: number; y: number; z: number; таймер: number }[] = [];
  /** Пыльные вихри в пустыне (§257). */
  private вихри!: DustDevilsHandle;
  /** Отблески фонарей на мокрой земле (§276). */
  private отблески!: GlintsHandle;
  /** Рябь от лодок у причала (§280). */
  private рябь!: RipplesHandle;
  /** Рябь от дождя в лужах (§285). */
  private рябьЛуж!: PuddleRipplesHandle;
  /** Марево над горизонтом в жару (§265). */
  private марево!: MirageHandle;
  /** Пыль над дорогой в жару (§268). */
  private пыльДороги!: RoadDustHandle;
  /** Вода в колеях дороги и лужи в пригороде (§269). */
  private водаДороги!: RoadWaterHandle;
  /** Следы караванов на дороге (§270). */
  private следыКараванов!: CaravanTracksHandle;
  /** Дым из печных труб города (§266). */
  private дымТруб!: Puffs;
  /** Тень от костра в лагере (§267). */
  private теньКостра!: THREE.SpotLight;
  /** Когда в следующий раз пойдёт клуб из трубы. */
  private дымТрубТаймер = 0;
  /** Птицы над пустыней и городом (§259). */
  private птицы!: BirdsHandle;
  /** Насколько земля мокрая, 0..1 (§261). */
  private мокрота = 0;
  /** Насколько земля заснежена, 0..1 (§262). */
  private снег = 0;
  /** Насколько земля запылена бурей, 0..1 (§283). */
  private пыль = 0;
  private sky!: SkyHandle;
  /** Текущая погода (для env-интенсивности). */
  private currentWeather: WeatherKind = 'clear';
  /**
   * HDRI-окружение: карта неба, из которой считается свет.
   *
   * Живёт рядом со sky, а не внутри него, потому что небо отвечает за картинку
   * (солнце, луна, звёзды, облака, цвет тумана), а окружение — за освещение.
   * Смешали бы — и правка неба тащила бы за собой пересборку карты на GPU.
   */
  private env!: SkyEnvironment;
  private fauna!: FaunaHandle;
  private npcs!: NpcsHandle;
  private civilians!: CiviliansHandle;
  private townfolk!: TownfolkHandle;
  /** Смесители коров: список пуст, пока модель не приехала. */
  private cowMixers: THREE.AnimationMixer[] = [];
  private roadTraffic!: RoadTrafficHandle;
  private weather!: WeatherHandle;
  private interiors!: InteriorsHandle;
  private doorTargets: THREE.Object3D[] = [];
  private interactiveTargets: THREE.Object3D[] = [];
  private climbTargets: THREE.Object3D[] = [];
  private destructibleTargets: THREE.Object3D[] = [];
  /** Лестница, на которой сейчас стоим (§324). null - не лезем. */
  private climb: THREE.Object3D | null = null;
  private navigator!: NavigatorHandle;
  private clockHour = 12;          // игровые сутки: 0–23
  private lastInCity = false;
  /** Накопитель времени до следующего поиска новых материалов для G-buffer. */
  private patchTimer = 0;
  /** О непрошитых материалах предупреждаем один раз, а не каждые две секунды. */
  private patchWarned = false;
  /** Общее время воды для всех тел: секунды с запуска мира. */
  private waterTime = 0;

  private container!: HTMLElement;
  private fxLayer!: HTMLElement;
  private crosshair!: HTMLElement;
  private entities: World | null = null;
  private me: PlayerEntity | null = null;
  private rigs = new Map<string, BoundRig>();

  // Камера
  private yaw = Math.PI;          // куда смотрит камера
  private pitch = 0.34;
  /** Желаемая дистанция (колесо мыши, настройки) */
  private dist = 7.5;
  /**
   * Фактическая дистанция камеры (§369): сглаженно догоняет разрешённую.
   * Желаемая и фактическая раздельны, чтобы стена не дёргала камеру кадром —
   * она лишь ограничивает цель, а камера доезжает плавно.
   */
  private distCurrent = 7.5;
/**
 * Крен камеры, радианы. Положительный — горизонт уходит влево.
 *
 * Отдельное поле, а не часть yaw, именно чтобы крен не влиял на движение:
 * шаг читается по this.yaw, и наклонённый горизонт не должен его переписывать.
 */
private roll = 0;
  private locked = false;

  // Физика игрока
  private vy = 0;
  private grounded = true;
  private crouch = false;
  private block = false;
  private swimming = false;
  /** Высота ног локального игрока с предыдущего кадра (физика, а не ландшафт) */
  private feetY = Number.NaN;
  private keys = new Set<string>();
  /** Хватает ли стамины на бег/усиленное плавание — решает world.ts по полоске */
  private sprintAllowed = true;
  /** Скорость в воде и экономия стамины — из экипировки (сапоги, плащ) */
  private waterSpeedBonus = 0;
  private swimStaminaSave = 0;
  /** Лодка: id активной и её бонусы к воде */
  private boatId: string | null = null;
  private boatWaterSpeed = 0;
  private boatStaminaSave = 0;
  /** Скорость в воде на лодке, м/с */
  private boatSwimSpeed = 0;
  /**
   * Активный скакун: его скорость шагом, м/с. 0 — пешком.
   *
   * Скорость Скакуна ЗАМЕНЯет пешую, а не прибавляется. Числа в таблице
   * скакунов (3.5–12 м/с) меньше бега пешком (7.6), так что «скорость +
   * бонус» означало бы, что дорогой Симург едет медленнее, чем бег без
   * него. Шагом едем на полной скорости скакуна, бегом — в 1.4 раза быстрее.
   */
  private mountSpeed = 0;
  /**
   * Множитель погоды на скорость суши, присылает сервер в world:time.
   *
   * Значение — WEATHER_EFFECTS[weather].speedMod того же пакета: в песчаную
   * бурю 0.6, в бурю 0.7, в снег 0.8, в дождь 0.9. Считать его на клиенте
   * по своей копии справочника значило бы рано или поздно разъехаться с
   * сервером. Медленным погода делает только сушу: у воды своя физика
   * (брод, сапоги, лодка), рывок — фиксированный манёвр со своей
   * проверенной математикой, присед — «крадусь тихо». Античиту ничего не
   * нужно: погода замедляет, потолок скорости не растёт.
   */
  private speedMod = 1;
  /**
   * Экипировка своего персонажа для рига; null — сервер ещё не ответил.
   *
   * armorColor — цвет груди по редкости доспеха, чтобы смена брони была видна
   * не только в панели.
   */
  private localGear: LocalGear | null = null;
  /** Сколько секунд осталось показывать «выдохся» после конца стамины */
  private exhaustedFlash = 0;
  private stepTimer = 0;
  private attackCd = 0;
  /**
   * Стадия связки ударов: 1 — прямой замах, 2 — обратный. Переключается
   * повторным кликом в окне COMBO_WINDOW_MS. Третьей стадии у кликов нет:
   * завершающая атака — это клик плюс навык, поэтому дальше счётчик
   * чередуется, пока окно не выйдет.
   */
  private comboStage: 1 | 2 = 1;
  private lastSwingAt = 0;
  /** Стадия текущего замаха: ставится в tryAttack, читается кадром ниже. */
  private attackStage: 1 | 2 = 1;
  /**
   * Крючок «игрок замахнулся». Ставится слоем приложения (см. world.ts) —
   * туториалу нужно знать о замахе, а заводить зависимость от интерфейса
   * внутрь 3D-слоя нельзя.
   */
  private onAttack: (() => void) | null = null;
  /**
   * Крючок «игрок осмотрелся». Камеру крутит движение мыши при захвате
   * указателя, а не правая кнопка (она — блок), поэтому шаг туториала
   * засчитываем именно здесь. Иначе игрок крутил бы мышью и не видел бы
   * реакции, а текст шага обещал правую кнопку, которая тут ни при чём.
   */
  private onCamera: (() => void) | null = null;
  private onBlock: (() => void) | null = null;
  private onDodge: (() => void) | null = null;
  /**
   * Двойные нажатия клавиш направления: клавиша -> время последнего нажатия.
   * По нему ловится рывок. Пустой набор означает «двойного нажатия не было».
   */
  private lastTap = new Map<string, number>();
  /** Два нажатия этой клавиши за меньше, чем столько, считаются рывком */
  private static readonly DOUBLE_TAP_MS = 260;
  /**
   * Рывок: точка старта, момент старта и единичное направление.
   *
   * Движение считается аналитически (смещение = v*t минус v*t²/2), а не
   * складыванием шагов по кадрам: складывание давало 2.26 метра на 30 кадрах
   * и 1.75 на 144, то есть на слабом компьютере игрока кидало вдвое дальше.
   */
  private dodgeStartAt = 0;
  private dodgeT = 0;
  private dodgeOx = 0;
  private dodgeOz = 0;
  private dodgeDx = 0;
  private dodgeDz = 0;
  private dodgeUntil = 0;

  // Служебное
  private raf = 0;
  private lastFx = { floater: 0, effect: 0 };
  private targetRing!: THREE.Mesh;
  private targetRingTarget: string | null = null;
  private targetNameEl!: HTMLElement;
  private wasNight = false;
  private lastDir: { x: number; y: number; z: number } = { x: 0, y: 0, z: 1 };
  private callbacks: World3DCallbacks | null = null;
  private debugColliders!: THREE.Group;
  private wasInWater = false;
  private splashMesh!: THREE.Mesh;
  private bubbleTimer = 0;
  /** Следит за размером контейнера: полный экран и режим «с рамкой»
   *  меняют размер без события resize окна */
  private ro: ResizeObserver | null = null;

  get isLocked() { return this.locked; }

  /** Плывёт ли игрок — расход выносливости и звуки воды зависят от этого */
  get isSwimming() { return this.swimming; }

  /** На чём игрок: null — на берегу, иначе id активной лодки */
  get activeBoatId(): string | null { return this.boatId; }

  /**
   * Лодка: снимает замедление воды, добавляет скорость и экономит
   * выносливость. Заменяет сапоги, пока игрок в лодке, — берётся лучший
   * из двух бонусов, а не сумма (иначе лодка дала бы больше единицы).
   */
  setBoat(boatId: string | null, waterSpeed: number, staminaSave: number, swimSpeed = 0): void {
    this.boatId = boatId;
    this.boatWaterSpeed = boatId ? Math.max(0, Math.min(1, waterSpeed)) : 0;
    this.boatStaminaSave = boatId ? Math.max(0, Math.min(0.9, staminaSave)) : 0;
    this.boatSwimSpeed = boatId ? Math.max(0, swimSpeed) : 0;
  }

  /**
   * Скорость активного скакуна (шагом), 0 — игрок пешком.
   *
   * Число присылает сервер вместе со списком скакунов: считать скорость на
   * клиенте нельзя, там своя копия таблицы, которая разошлась с серверной.
   * Предел скорости у античита тоже считает сервер — из character_mounts.
   */
  setMountSpeed(speed: number): void {
    this.mountSpeed = Number.isFinite(speed) && speed > 0 ? speed : 0;
  }

  /** Хватает ли выносливости на бег (и на усиленное плавание) */
  setSprintAllowed(v: boolean): void {    // Момент, когда силы кончились, — один раз подсказываем игроку
    if (this.sprintAllowed && !v) this.exhaustedFlash = 0.4;
    this.sprintAllowed = v;
  }

  /**
   * Множитель погоды на скорость суши. Приходит с сервера в world:time.
   * Мусор и ускорение отсекаются: погода умеет только мешать идти, fastest
   * погода — ясная (1.0).
   */
  setSpeedMod(speedMod: number): void {
    this.speedMod = Number.isFinite(speedMod) && speedMod > 0
      ? Math.min(1, Math.max(0.3, speedMod))
      : 1;
  }

  /** Экономия выносливости при плавании: сапоги/плащ или лодка */
  get waterStaminaSave(): number {
    return Math.max(this.swimStaminaSave, this.boatStaminaSave);
  }

  /** True один раз, только что выносливость закончилась */
  get exhaustedNow(): boolean {
    if (this.exhaustedFlash <= 0) return false;
    this.exhaustedFlash = 0;
    return true;
  }

  /**
   * Бонусы «для воды» из экипировки (сапоги/плащ): 0 — вода тормозит как
   * обычно, 1 — вода не мешает вовсе; stamina — экономия расхода.
   */
  setWaterBonus(waterSpeed: number, staminaSave: number): void {
    this.waterSpeedBonus = Math.max(0, Math.min(1, waterSpeed));
    this.swimStaminaSave = Math.max(0, Math.min(0.75, staminaSave));
  }

  /** Последнее направление движения в мировых координатах (для пакетов player:move) */
  get moveDir() { return this.lastDir; }

  /**
   * Присел ли персонаж сейчас.
   *
   * Нужен наружу, чтобы сказать серверу в пакете движения. Приседание само по
   * себе было чисто клиентским: скорость, анимация и камера на нём менялись
   * (CROUCH_SPEED = 2.2), но сервер о нём не знал - а значит, не мог никого
   * не заметить. Шаг 2 стелса: правило скрытности живёт в shared/stealth.ts,
   * и без этого геттера сервер получил бы только координаты и считал бы,
   * что игрок стоит.
   *
   * Значение читается из того же поля, что идёт в анимацию, - расхождение
   * между «анимацией присела» и «серверу сказали о приседе» невозможно по
   * построению.
   */
  get crouching() { return this.crouch; }

  /** Шаг 3 стелса: игрок нажал F. Флаг ставится нажатием и снимается чтением. */
  private stealRequested = false;
  // Zapros na stol s dokumentami. Odnokratnyy i sbрасыvaetsya chteniyem,
  // rovno kak flag krazhi: inache uderzhanie klavishi slalo by zaprosy
  // kazhdyy kadr.
  private documentRequested = false;

  /**
   * Забрать запрос на кражу.
   *
   * Возвращает true ровно один раз на нажатие. Если бы возвращал флаг без
   * сброса, удержание F слало бы запросы каждый кадр, и сервер получал бы
   * сотни попыток в секунду от одного нажатия.
   */
  /**
   * Zabrat li zapros na dokumenty. Flag sbрасыvaetsya chteniyem.
   */
  consumeDocumentRequest(): boolean {
    const byl = this.documentRequested;
    this.documentRequested = false;
    return byl;
  }
  consumeStealRequest(): boolean {
    const был = this.stealRequested;
    this.stealRequested = false;
    return был;
  }

  /**
   * Экипировка своего персонажа для 3D-рига.
   *
   * ЧТО БЫЛО. Вид оружия и щита выводился из класса, а не из того, что надето:
   * суфий с купленным мечом ходил без меча, кызылбаш без оружия — с мечом.
   * Слот щита в игре вообще нет (weapon, armor, accessory), поэтому щит
   * остаётся классовым: это не забытый код, а решение.
   */
  setLocalGear(gear: LocalGear | null): void {
    // null — «экипировка ещё не пришла», и риг показывает классовый вид.
    // Объект с weapon: false — «пришла, оружия нет», и меч убирается
    this.localGear = gear;
  }

  /**
   * Бежит ли игрок прямо сейчас.
   *
   * Повторяет те же условия, что и выбор скорости в кадре: без Shift, без
   * «присесть» и без воды бега нет, а при нулевой выносливости бег
   * выключен. Иначе полоса убывала бы, когда игрок стоит, и не убывала бы,
   * когда он действительно бежит.
   */
  isSprinting(): boolean {
    if (!this.sprintAllowed || !this.me || this.crouch || this.swimming) return false;
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Время замаха в секундах: из данных оружия, делённое на скорость стойки. */
  private swingSeconds(): number {
    const оружие = this.localGear?.swingSeconds ?? ЗАМАХ_ПУСТЫМИ_РУКАМИ;
    // Деление, а не умножение: attackSpeed — множитель скорости. У «Серповой
    // пляски» он 1.3 («урон и скорость выше»), значит замах короче.
    return оружие / (STANCES[getStance()].attackSpeed || 1);
  }

  /**
   * Кому SSR вообще положен: собирает отражающие объекты готовой сцены.
   *
   * ПОЧЕМУ НЕ ВСЁ. Пока в `selects` стояло null, отражение брала ВСЯ сцена
   * целиком, и мир становился зеркальным: земля отражала дома, стены — друг
   * друга, персонаж сам себя. Комментарий над созданием пасса обещал «вода,
   * мокрый камень, металл, стекло», то есть горстку объектов, а получилась
   * зеркальная комната. Это не вкус: three прямо пишет, что null означает
   * всю сцену (SSRPass.js:151).
   *
   * КРИТЕРИЙ. Металл по metalness — то, что физически обязано отражать.
   * Земля, песок, камень, дерево и шкура персонажа имеют metalness 0 и в
   * список не попадают: они матовые, отражение им не полагается.
   *
   * В список не попадает и вода: у неё собственный шейдер с преломлением и
   * отражениями (§208). Второй проход поверх шейдера не нужен, а раньше он
   * ещё и дублировал работу.
   *
   * Пустой массив — честный случай: отражать нечего, SSR не рисует ничего.
   */
  private collectSsrReflectors(): void {
    const отражающие: THREE.Mesh[] = [];
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
      const материалы = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!материалы.length) return;
      const металл = материалы.some((m) => (m as THREE.MeshStandardMaterial).metalness >= 0.3);
      if (металл) отражающие.push(mesh);
    });
    this.ssrPass.selects = отражающие;
  }

  /**
   * Прошить материалы мира в G-buffer: нормали с картами нормалей, альбедо,
   * шероховатость и свечение.
   *
   * ЗАЧЕМ ПОСЛЕ ПОСТРОЙКИ, А НЕ В ПРОХОДЕ. Проход создаётся в начале сборки
   * мира, когда сцена пуста: отчёт той прошивки — «0 из 0», и у всего мира
   * каналы оставались пустыми. Внешне это почти не видно, поэтому жило долго:
   * AO умножал свет по нулевой нормали, а экранные отражения не знали, что
   * отражать. Проверено на живом мире: 1119 материалов, прошито 0.
   *
   * ПОЧЕМУ ПОВТОРЯЕТСЯ. Модели приходят позже постройки: персонаж игрока,
   * монстры, лошади, караваны. Прошивка нового материала компилирует шейдер,
   * поэтому поиск идёт раз в ПЕРИОД_ПРОШИВКИ секунд, а не в каждом кадре.
   */
  private patchWorldMaterials(первый: boolean): void {
    const отчёт = this.deferred.patch(this.scene);
    if (!отчёт.мимо.length) return;
    if (!первый && this.patchWarned) return;
    this.patchWarned = true;
    // Транслитерация, а не русский: клиент не переводит строки, и проверка
    // i18n ловит хардкод. Сообщение служебное, его видит только владелец в
    // консоли при сборке мира.
    console.warn(
      `Otlozhennyy G-buffer: ${отчёт.прошито} iz ${отчёт.всего} materialov. `
      + `Bez kanalov ostalis: ${отчёт.мимо.join(', ')}`,
    );
  }

  // ── Инициализация ────────────────────────────────────────────
  init(container: HTMLElement, callbacks: World3DCallbacks): void {
    this.container = container;
    this.callbacks = callbacks;

    // Чистим коллайдеры ПЕРЕД постройкой мира.
    //
    // COLLIDERS и POCKET_COLLIDERS живут на уровне модуля, а `init()`
    // вызывается при каждом входе в мир (смерть → экран потери связи →
    // выбор персонажа → снова вход). Обнулять их было негде: единственная
    // чистка стояла внутри `buildCity`, и та делала не обнуление, а
    // копирование: она снимала весь накопленный список как «коллайдеры
    // ландшафта», строила город и возвращала список обратно целиком —
    // вместе с коллайдерами города от ПРЕДЫДУЩЕГО мира. Итог: каждый
    // повторный вход примерно удваивал список.
    //
    // Список не только рос, но и проверялся в каждом кадре по три прохода
    // (`resolveCircleList`), а горожане перебирали его для каждого
    // кандидата ещё и в шести проходах. Рост списка бьёт по кадру прямо
    // пропорционально, и на «return to character select» игрок
    // постепенно получает всё более тяжёлую физику.
    COLLIDERS.length = 0;
    POCKET_COLLIDERS.length = 0;
    INTERIOR_COLLIDERS.length = 0;
    FAUNA_COLLIDERS.length = 0;
    CIV_COLLIDERS.length = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    // МЯГКИЕ ТЕНИ. Тут была моя ошибка, и она стоила лишнего выката.
    //
    // Я прочитал в three.core.js строку `const PCFSoftShadowMap = 2`, решил,
    // что тип жив, и заменил им PCFShadowMap. Константа действительно
    // осталась — а РЕАЛИЗАЦИИ за ней больше нет. three.module.js прямо
    // предупреждает при установке типа:
    //   if (this.type === PCFSoftShadowMap) {
    //     warn('WebGLShadowMap: PCFSoftShadowMap has been removed.
    //           Using PCFShadowMap instead.');
    // То есть игра тихо работала на PCFShadowMap и писала предупреждение в
    // консоль, а исходный комментарий проекта «мягкие тени вырезаны» был
    // ПРАВ. Я отменил верное утверждение по более слабой проверке.
    //
    // Что осталось на самом деле: VSMShadowMap. Он жив (SHADOWMAP_TYPE_VSM,
    // отдельные ветки для точечных источников) и единственный даёт мягкую
    // кромку — через shadow.radius и blurSamples. Проверка, которая стоит
    // рядом, теперь смотрит не на объявление константы, а на то, ругается ли
    // three на выбранный тип.
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    // ТОНАЛЬНАЯ КРИВАЯ. Без неё рендер отдавал кадр как есть (NoToneMapping
    // — значение по умолчанию), и всё, что ярче единицы, срезалось в чистое
    // белое: солнечные блики на металле, факелы, небо в зените. Белое пятно
    // вместо градации — самая заметная «нереалистичность» кадра, потому что
    // ни одна камера так не снимает.
    //
    // AgX — та же кривая, что в Blender с 4.0: кино-кривая с плексом
    // (плечом) в светах. Местами она намеренно уводит насыщенность в белое,
    // как плёнка, поэтому белый металл на солнце выглядит металлом, а не
    // лампочкой.
    //
    // Экспозиция 1.4 — компенсация: кривая затемняет середину примерно на
    // столько же. Без компенсации весь мир стал бы серым. Точное число
    // подбирается глазами; если мир покажется тёмным — здесь один множитель.
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    // Анизотропия по возможностям железа, а не зашитая четвёрка. Землю
    // видно почти вдоль, и с 4 она превращается в мыльную муть там, куда
    // игрок смотрит. Ставим ДО buildTerrain: текстуры создаются там и
    // берут это значение при создании.
    setTextureAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    // §317: то же для настоящих PBR-поверхностей (surfaces.ts). Модуль
    // держит свои текстуры отдельно от процедурных.
    setSurfaceAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    this.renderer.domElement.className = 'gl-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xb9c4c9, 60, 420);

    this.camera = new THREE.PerspectiveCamera(62, container.clientWidth / container.clientHeight, 0.1, 1600);

    // ОТЛОЖЕННЫЙ ПРОХОД вместо RenderPass + SSAOPass.
    //
    // SSAOPass рисовал сцену ВТОРОЙ раз подменным MeshNormalMaterial ради
    // нормалей и глубины, и нормали у него были геометрическими: карты
    // нормалей он не видел, и AO легло мимо текстуры рельефа. Теперь
    // нормали берутся из G-buffer настоящие, вторая отрисовка не нужна, а AO
    // умножает только свет неба, а не готовый цвет (иначе затемнялось и
    // солнце, и картинка в тенях уходила в грязь).
    //
    // Освещение осталось forward: переписать PBR three вместе с VSM-тенями
    // и IBL по PMREM-карте неба - пятьсот строк GLSL вслепую. Об этом в
    // deferred/deferredPass.ts.
    this.deferred = new DeferredPass(
      this.scene, this.camera, container.clientWidth, container.clientHeight,
    );
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(this.deferred);
    // Прошивка здесь НЕ делается: сцена на этот момент пуста, и отчёт был бы
    // «0 из 0». Мир прошивается ниже, после постройки, — см. patchWorldMaterials.
    // SSR: screen-space reflections для воды, мокрого камня, металла, стекла.
    //
    // `selects: null` — это НЕ «для всех, кто блестит», это «для всей
    // сцены». Так и написано в самой библиотеке, SSRPass.js:151:
    //   "Which 3D objects should be affected by SSR.
    //    If not set, the ENTIRE SCENE is affected."
    //
    // Список отражающих подставляет collectSsrReflectors() ниже, после
    // постройки мира: список собирается обходом готовой сцены. Вода сюда
    // не попадает — у неё собственный шейдер с отражениями (§208), второй
    // проход поверх только мешал бы.
    this.ssrPass = new SSRPass({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      width: container.clientWidth,
      height: container.clientHeight,
      selects: [],
      isBouncing: false,
      groundReflector: null,
    });
    this.ssrPass.opacity = 0.85;
    this.ssrPass.maxDistance = 100;
    this.ssrPass.thickness = 0.5;
    this.composer.addPass(this.ssrPass);
    // Bloom: свечение ярких источников (факелы, окна, магия, солнце).
    // Порог = 0.85: только пиксели ярче 0.85 (после тонального отображения) светятся.
    // Сила = 0.6, радиус = 0.6, порог = 0.85.
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.6, // strength
      0.6, // radius
      0.85 // threshold
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // Свет
    this.hemi = new THREE.HemisphereLight(0xbfd6e4, 0x6b5a42, 0.75);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe8c0, 1.5);
    this.sun.position.set(60, 90, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 260;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46;
    this.sun.shadow.bias = -0.0004;
    // Радиус размытия — только для VSM. Именно он даёт мягкую кромку:
    // PCF берёт жёсткую выборку, а VSM размывает по площади.
    // Влияет на круглое освещение и на карту теней, но не на главный кадр.
    this.sun.shadow.radius = 3;
    this.sun.shadow.blurSamples = 12;
    this.scene.add(this.sun, this.sun.target);

    // ПЕРСОНАЖИ — ВПЕРЁД ДЕКОРА (§343).
    //
    // Мир строит сотни моделей декора (террейн, флора, дома), и браузер
    // держит шесть соединений на хост. Персонажные GLB весят 0.6–1.2 МБ и,
    // стоя в общей очереди последними, приезжали через десятки секунд после
    // домов — или не приезжали вовсе: замер §342 показал ВСЕ персонажные
    // модели в таймауте при уже стоящих горожанах. Из-за этого торговец в
    // центре площади стоял процедурным конусом (§341).
    //
    // Теперь их загрузка начинается до постройки мира: те же шесть
    // соединений занимают сначала люди, а декор доезжает следом. Игрок
    // видит живой город сразу, а дробности декора подождут.
    preloadModels(['guard', 'merchant', 'citizen', 'citizen2', 'citizen3', 'crier', 'scholar', 'archer', 'warrior']);

    // Мир
    buildTerrain(this.scene);
    buildScatter(this.scene);
    buildRoads(this.scene);
    const city = buildCity(this.scene);
    for (const [i, l] of (city.userData.lights as { x: number; z: number }[]).entries()) {
      const light = new THREE.PointLight(0xffa04a, 0, 20, 1.8);
      light.position.set(l.x, (l as { y?: number }).y ?? groundHeight(l.x, l.z) + 5.2, l.z);
      this.scene.add(light);
      // ФАЗА У КАЖДОГО ФАКЕЛА СВОЯ.
      //
      // Раньше фаза считалась как `base * 7`, а у всех городских факелов `base`
      // одинаковый, то есть они мигали синхронно — два десятка огней в одном
      // городе пульсировали в такт. У двух факелов у ворот это читалось бы
      // особенно заметно: они стоят рядом и смотрели бы в унисон.
      this.torches.push({ light, base: 1.6, phase: i * 2.4 });
    }
    for (const d of buildTownBuildings(this.scene)) this.doorTargets.push(d);
    buildCamp(this.scene);
    buildWater(this.scene);
    // Поселения: порт, караван-сарай, деревня, форт.
    const огниПоселений = buildSettlements(this.scene);
    // Свет в поселениях (§251): маяк, маячок, фонарь у поленницы и фонари у
    // ворот форта горели нарисованными шарами, а источников не было — ночью
    // порт, деревня и форт стояли чёрными силуэтами.
    for (const [i, огонь] of огниПоселений.entries()) {
      const light = new THREE.PointLight(0xffa04a, 0, 20, 1.8);
      light.position.set(огонь.x, огонь.y, огонь.z);
      this.scene.add(light);
      this.torches.push({ light, base: 1.6, phase: i * 2.4 + 1.3 });
    }
    // Города регионов: поселения в шести регионах, где их не было.
    // Стоят на своих якорях, поэтому игрок, выбравший регион, возрождается
    // у ворот города, а не в пустом поле.
    const огниГородов = buildRegionTowns(this.scene);
    // Фонари городов регионов (§250): города стояли в темноте — дома и стены
    // есть, а света нет. Источники создаются здесь, как и городские фонари,
    // и горят по ночному правилу: днём тише, ночью в полную силу.
    for (const [i, огонь] of огниГородов.entries()) {
      const light = new THREE.PointLight(0xffa04a, 0, 20, 1.8);
      light.position.set(огонь.x, огонь.y, огонь.z);
      this.scene.add(light);
      this.torches.push({ light, base: 1.6, phase: i * 2.4 + 0.7 });
    }
    // Указатели сбоку от дорог: «здесь начинается путь к порту».
    buildSignposts(this.scene);
    // Стол с доской во дворе караван-сарая: караван ждёт утра, люди играют.
    buildGameTable(this.scene);
    // Коровы на выпасе в лесной деревне.
    this.cowMixers = buildCows(this.scene);
    // Статуя у базарного квартала: видно с улицы, не занимает место торговле.
    buildBazaarStatue(this.scene);
    // Два факела у ворот караван-сарая: игрок проходит между ними внутрь.
    // Решение владельца — свет от них оранжевый и яркий, поэтому источники
    // создаются здесь, а не остаются на откуп городским фонарям.
    for (const [i, огонь] of buildCaravanseraiTorches(this.scene).entries()) {
      const light = new THREE.PointLight(
        ТОРЧ_СВЕТ_ЦВЕТ,
        0,
        ТОРЧ_СВЕТ_ДАЛЬНОСТЬ,
        1.8,
      );
      light.position.set(огонь.x, огонь.y, огонь.z);
      this.scene.add(light);
      // Фаза своя у каждого: два факела в двух шагах друг от друга, мигающие
      // в такт, читаются как одна лампа, а не как два огня.
      this.torches.push({ light, base: ТОРЧ_СВЕТ_ЯРКОСТЬ, phase: 1.1 + i * 3.7 });
      // Дым над факелом (§255): огонь без дыма читается как нарисованный.
      this.дым.push({
        дым: createPuffs(this.scene, {
          количество: 12,
          цвет: 0x82796f,
          размер: 0.5,
          рост: 2.4,
          жизнь: 3.2,
          подъём: 1.0,
          разброс: 0.22,
          непрозрачность: 0.46,
          затухание: 0.8,
        }),
        x: огонь.x,
        y: огонь.y + 0.2,
        z: огонь.z,
        таймер: 0,
      });
    }
    // Факелы в проёмах (21 октября 2026, §226): ворота дворца и вход в
    // гробницу читались чёрными провалами. Свет в проёме нужен и ДНЁМ —
    // проход закрыт от солнца, — поэтому эти источники не гаснут, как
    // уличные факелы, а горят постоянно.
    for (const огонь of buildPassageTorches(this.scene)) {
      const light = new THREE.PointLight(
        ТОРЧ_СВЕТ_ЦВЕТ,
        0,
        ТОРЧ_СВЕТ_ДАЛЬНОСТЬ,
        1.8,
      );
      light.position.set(огонь.x, огонь.y, огонь.z);
      this.scene.add(light);
      // Ярче уличного факела вдвое: проход закрыт от солнца, и при городской
      // яркости он оставался чёрным провалом даже с двумя огнями.
      this.lamps.push({ light, base: ТОРЧ_СВЕТ_ЯРКОСТЬ * 2 });
    }
    // Фонари гробницы: золотые фонари на столбах стояли, а света не давали.
    for (const фонарь of ФОНАРИ_ГРОБНИЦЫ) {
      const light = new THREE.PointLight(0xffb45a, 0, 16, 1.8);
      light.position.set(фонарь.x, фонарь.y, фонарь.z);
      this.scene.add(light);
      this.lamps.push({ light, base: 2.6 });
    }
    // Два меча у кузницы деревни, воткнутые остриём в землю.
    buildVillageSwords(this.scene);
    // Два сундука у шатра в базарном квартале.
    buildBazaarChests(this.scene);
    // Двор мечети с куполом и минаретом: первое здание из шести, которому
    // владелец велел достроить экстерьер.
    // Фонари у входа в мечетный двор (§252): были столб с чашей и шар огня —
    // без стекла и без источника света. Теперь общий фонарь и свой свет.
    const огниДвора = buildMosqueCourtyard(this.scene);
    for (const [i, огонь] of огниДвора.entries()) {
      const light = new THREE.PointLight(0xffa04a, 0, 20, 1.8);
      light.position.set(огонь.x, огонь.y, огонь.z);
      this.scene.add(light);
      this.torches.push({ light, base: 1.6, phase: i * 2.4 + 2.1 });
    }
    // Акведук деревни: разрушенная аркада к востоку от неё.
    buildAqueduct(this.scene);
    // Шатёр в базарном квартале и кузница в деревне.
    buildTradeTent(this.scene);
    buildVillageForge(this.scene);
    // Руина ворот поперёк южной дороги, не доходя городских ворот.
    buildRuinGate(this.scene);
    // Бастионы по бокам ворот горной крепости.
    buildFortBastions(this.scene);
    // Руины: капелла у Месопотамии и двор у святилища.
    buildRuinChapel(this.scene);
    buildRuinCourt(this.scene);
    // Каменная арка у деревни и церковный проём в Кавказе.
    buildVillageArchway(this.scene);
    buildChurchDoorway(this.scene);
    // Купольная башня к востоку от мечети.
    buildOnionDomeTower(this.scene);
    // Гибельный эшафот за городской стеной, у дороги на порт.
    buildGallows(this.scene);
    // Телега на рынке, частокол у эшафота, баррикада на дороге к порту,
    // мельница у караван-сарая: четыре модели, доведённые руками.
    buildMarketCart(this.scene);
    buildGallowsPalisade(this.scene);
    buildPortRoadBarricade(this.scene);
    buildCaravanseraiWindmill(this.scene);
    // Плуг у мельницы: фермерская связка караван-сарая.
    buildMillPlough(this.scene);
    // Точило у кузницы деревни.
    buildVillageGrindstone(this.scene);
    // Дубы у лесной деревни.
    buildOaks(this.scene);
    // Рухнувший мост у реки и скалы перевала.
    buildRuinBridge(this.scene);
    buildPassRocks(this.scene);
    // Сторожевая башня на дальней восточной дороге.
    buildDesertTower(this.scene);
    const flame = this.scene.getObjectByName('campfire-flame');
    if (flame) {
      this.flames.push(flame as THREE.Mesh);
      const fireLight = new THREE.PointLight(0xff7a20, 0, 26, 1.6);
      fireLight.position.set(CAMP.x, groundHeight(CAMP.x, CAMP.z) + 1.6, CAMP.z);
      this.scene.add(fireLight);
      // Свет самого костра стал тише: главную работу по освещению теперь
      // делает направленный источник с тенью (§267).
      this.torches.push({ light: fireLight, base: 1.8, phase: 5.5 });
      // ТЕНЬ ОТ КОСТРА (§267). У всех шестидесяти девяти источников света
      // теней нет, и ночью огонь не отбрасывает ни одной: самый заметный
      // недосчёт света в мире.
      //
      // Тень от точечного источника — это куб: шесть проходов рендера на
      // каждый источник, а источников десятки. Поэтому тень отбрасывает ОДИН
      // источник: направленный конус над костром в лагере. Он светит вниз,
      // как и должен светить огонь, и даёт тень от палаток и людей.
      //
      // Остальные источники теней не имеют — так и остаётся: честно и
      // в рамках кадра.
      const теньКостра = new THREE.SpotLight(0xff7a20, 0, 26, 1.15, 0.55, 1.6);
      теньКостра.position.set(CAMP.x, groundHeight(CAMP.x, CAMP.z) + 1.5, CAMP.z);
      теньКостра.castShadow = true;
      теньКостра.shadow.mapSize.set(1024, 1024);
      теньКостра.shadow.camera.near = 0.4;
      теньКостра.shadow.camera.far = 26;
      теньКостра.shadow.bias = -0.002;
      теньКостра.target.position.set(CAMP.x, groundHeight(CAMP.x, CAMP.z), CAMP.z);
      this.scene.add(теньКостра, теньКостра.target);
      this.теньКостра = теньКостра;
      // Дым над костром (§255): огонь без дыма читается как нарисованный.
      this.дым.push({
        дым: createPuffs(this.scene, {
          количество: 20,
          цвет: 0x82796f,
          размер: 1.2,
          рост: 3.8,
          жизнь: 4.4,
          подъём: 1.3,
          разброс: 0.3,
          непрозрачность: 0.6,
          затухание: 0.8,
        }),
        x: CAMP.x,
        y: groundHeight(CAMP.x, CAMP.z) + 1.4,
        z: CAMP.z,
        таймер: 0,
      });
    }

    // Небо, фауна и NPC города
    this.sky = createSky(this.scene);
    // чтобы первый кадр не показал мир без освещения.
    this.env = new SkyEnvironment(this.scene, this.renderer);
    this.fauna = createFauna(this.scene);
    this.npcs = createNpcs(this.scene);
    this.civilians = createCivilians(this.scene);
    // Жители трёх региональных городов на настоящих моделях.
    this.townfolk = createTownfolk(this.scene);
    this.roadTraffic = createRoadTraffic(this.scene);
    // Пыльные вихри в пустыне (§257): ветер поднимает песок сам по себе.
    this.вихри = createDustDevils(this.scene);
    // Отблески фонарей на мокрой земле (§276).
    this.отблески = createGlints(this.scene);
    // Рябь от лодок у причала (§280).
    this.рябь = createRipples(this.scene);
    // Рябь от дождя в лужах (§285): вода в луже не зеркало, а живая поверхность.
    this.рябьЛуж = createPuddleRipples(this.scene);
    // Марево над горизонтом в жару (§265).
    this.марево = createMirage(this.scene);
    // Пыль над дорогой в жару (§268).
    this.пыльДороги = createRoadDust(this.scene);
    // Вода в колеях дороги и лужи в пригороде (§269).
    this.водаДороги = createRoadWater(this.scene);
    // Следы караванов на дороге (§270).
    this.следыКараванов = createCaravanTracks(this.scene);
    // Дым из печных труб (§266): город из жары выглядел выключенным.
    this.дымТруб = createPuffs(this.scene, {
      количество: 16,
      цвет: 0x8f8880,
      размер: 0.8,
      рост: 2.4,
      жизнь: 4.2,
      подъём: 1.1,
      разброс: 0.35,
      непрозрачность: 0.3,
      затухание: 0.9,
    });
    // Птицы над пустыней и городом (§259): небо не должно быть пустым.
    this.птицы = createBirds(this.scene);
    this.weather = createWeather(this.scene, audio);
    this.interiors = createInteriors(this.scene);
    for (const d of this.interiors.clickTargets) this.doorTargets.push(d);
    // Интерьерные цели (интерактивы, разрушаемое, лестницы) больше не
    // собираются здесь одним залпом: их держит refreshInteriorTargets()
    // и обновляет на каждом входе/выходе из здания.
    buildPocketGround(this.scene);
    this.navigator = createNavigator(this.scene);
    // SSR включаем только там, где отражение и правда нужно. Время вызова
    // не случайно: список отражающих собирается обходом готовой сцены.
    this.collectSsrReflectors();
    // И только теперь прошиваем G-buffer: до этого места сцены ещё нет.
    this.patchWorldMaterials(true);

    // DEBUG: визуализация коллайдеров (нажмите Z для включения/выключения)
    console.log(`[Collision] Total colliders: ${COLLIDERS.length}`);
    this.debugColliders = new THREE.Group();
    this.debugColliders.visible = false;
    const debugMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, transparent: true, opacity: 0.35 });
    for (const c of COLLIDERS) {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, 4, 12), debugMat);
      cyl.position.set(c.x, groundHeight(c.x, c.z) + 2, c.z);
      this.debugColliders.add(cyl);
    }
    this.scene.add(this.debugColliders);

    // Кольцо цели
    this.targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.72, 28),
      new THREE.MeshBasicMaterial({ color: 0xba2a37, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.visible = false;
    this.scene.add(this.targetRing);

    // Кольцо всплеска при входе в воду
    this.splashMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 1.8, 20),
      new THREE.MeshBasicMaterial({ color: 0xaaddee, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    this.splashMesh.rotation.x = -Math.PI / 2;
    this.splashMesh.visible = false;
    this.scene.add(this.splashMesh);

    // FX-слой и прицел
    this.fxLayer = document.createElement('div');
    this.fxLayer.className = 'fx-layer';
    container.appendChild(this.fxLayer);
    this.crosshair = document.createElement('div');
    this.crosshair.className = 'crosshair hidden';
    container.appendChild(this.crosshair);
    this.targetNameEl = document.createElement('div');
    this.targetNameEl.className = 'target-name';
    container.appendChild(this.targetNameEl);

    // События
    window.addEventListener('resize', this.onResize);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    // Размер контейнера меняется и без resize окна: полный экран и
    // экранный режим «с рамкой» уменьшают игровую область по-своему.
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(container);

    // Качество графики — из сохранённых настроек
    this.setGraphics(getSettings().graphics);
  }

  /**
   * Применить уровень графики: разрешение кадра, тени, дальность
   * прорисовки, плотность частиц погоды. Вызывается при входе в мир
   * и на лету из панели настроек.
   */
  setGraphics(level: GraphicsLevel, fogOn = getSettings().fog): void {
    if (!this.renderer || !this.scene || !this.sun || !this.camera) return;
    const p = graphicsProfile(level);

    // Разрешение кадра: <1 — сжатый кадр (быстро), >1 — суперсэмплинг (красиво)
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(2.5, p.pixelScale * (devicePixelRatio || 1))));

    // Тени: смена режима требует пересборки материалов
    const shadowsChanged = this.renderer.shadowMap.enabled !== p.shadows;
    this.renderer.shadowMap.enabled = p.shadows;
    this.sun.castShadow = p.shadows;
    // Тени выключены - самый дешёвый тип. Иначе шейдеры продолжают считать
    // размытие вхолостую: свет тень не бросает, а платим за неё.
    const нужныйТип = p.shadows ? THREE.VSMShadowMap : THREE.BasicShadowMap;
    if (this.renderer.shadowMap.type !== нужныйТип) this.renderer.shadowMap.type = нужныйТип;
    if (shadowsChanged) {
      this.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => { m.needsUpdate = true; });
        else if (mat) mat.needsUpdate = true;
      });
    }
    if (this.sun.shadow.mapSize.x !== p.shadowMapSize) {
      this.sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }

    // SSAO: теперь его считает отложенный проход по G-buffer, а не SSAOPass
    // вторым рендером сцены. Выключается тем же флагом профиля.
    this.deferred?.setAoSettings({ intensity: p.ssao ? undefined : 0 });
    // SSR: screen-space reflections. Включаем/выключаем через enabled у пасса.
    if (this.ssrPass) this.ssrPass.enabled = p.ssr;
    // Bloom: свечение ярких источников.
    if (this.bloomPass) this.bloomPass.enabled = p.bloom;

    // Дальность прорисовки. Туманом ведает погода и хранит своё «домашнее»
    // значение far — меняем его же, иначе смена погоды всё откатит.
    const fog = this.scene.fog as THREE.Fog | null;
    const fogFar = fogOn ? p.fogFar : p.fogFar * 4; // туман выключен — просто очень далеко
    if (fog) fog.far = fogFar;
    // Небо — сфера радиусом SKY_RADIUS вокруг игрока. Дальняя плоскость
    // камеры всегда должна быть больше неё, иначе часть неба отсекается
    // и на том месте видно чёрный купол (background у сцены пустой).
    // Дальняя плоскость держится ради звёзд и светил (они на SKY_RADIUS), а
    // не ради неба: небо теперь фон сцены, фон не геометрия и плоскостью не
    // отсекается. Если бы купол вернулся, требование «дальше SKY_RADIUS»
    // пришлось бы вернуть вместе с ним.
    this.camera.far = Math.max(SKY_RADIUS * 1.15, fogFar + 750);
    this.camera.updateProjectionMatrix();
    this.weather?.setQuality(fogFar, p.weather);

    this.onResize();
  }

  /** Привязать сетевые сущности и своего игрока */
  attach(entities: World, me: PlayerEntity): void {
    this.entities = entities;
    this.me = me;
  }

  /** Поза камеры — для e2e-хука window.__eos */
  getCameraPose(): { yaw: number; pitch: number; dist: number } {
    return { yaw: this.yaw, pitch: this.pitch, dist: this.dist };
  }

  /**
   * Стадия активной связки: 0 — окна нет, связки нет. Читает useSkill:
   * навык в окне после клика — это завершающая атака связки.
   */
  getComboStage(): 0 | 1 | 2 {
    if (performance.now() - this.lastSwingAt > COMBO_WINDOW_MS) return 0;
    return this.comboStage;
  }

  /** Навык-финишер закрывает связку: окно не висит за эффектом навыка. */
  resetCombo(): void {
    this.lastSwingAt = 0;
  }

  /**
   * Замах финишера: обратный, как второй удар, плюс эффект навыка поверх.
   * Отдельного клипа финишера в проекте нет, и обратный замах плюс вспышка
   * навыка читаются как завершение связки.
   */
  playFinisherSwing(): void {
    this.attackAnim = true;
    this.attackStage = 2;
  }

  setCameraPose(yaw: number, pitch: number, dist?: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
    if (dist != null) this.dist = Math.min(15, Math.max(3.2, dist));
  }

  /** Цель стрелки-навигатора над игроком */
  setNavTarget(target: NavTarget | null): void {
    this.navigator?.setTarget(target);
  }

  /** Построенный маршрут навигатора (для мини-карты) */
  getNavRoute(): { x: number; z: number }[] {
    return this.navigator?.getRoute() ?? [];
  }

  /** Игровой час (0–23) от world:time — ведёт солнце/луну/звёзды */
  setClock(hour: number): void {
    if (Number.isFinite(hour)) this.clockHour = ((hour % 24) + 24) % 24;
  }

  /** Атака лучом из центра экрана без мыши (тот же путь, что у ЛКМ) */
  attackFromCamera(): void {
    this.tryAttack();
  }

  /** Подписка на замах — вызывается из слоя приложения */
  setOnAttack(cb: (() => void) | null): void {
    this.onAttack = cb;
  }

  /** Подписка на поворот камеры — вызывается из слоя приложения */
  setOnCamera(cb: (() => void) | null): void {
    this.onCamera = cb;
  }

  /** Блок (ПКМ) — раньше менял только позу, сервер о защите не узнавал */
  setOnBlock(cb: (() => void) | null): void {
    this.onBlock = cb;
  }

  /** Уклонение (двойное нажатие клавиши направления) */
  setOnDodge(cb: (() => void) | null): void {
    this.onDodge = cb;
  }

  // ── События ввода ────────────────────────────────────────────
  private onResize = () => {
    if (!this.container) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    // SSAO + SSR + Bloom требуют обновления размера при изменении окна
    this.composer.setSize(this.container.clientWidth, this.container.clientHeight);
    // Отложенный проход держит свои цели: без этого G-buffer остаётся
    // прежнего размера, а AO читается по неверным экранным координатам.
    this.deferred?.setSize(this.container.clientWidth, this.container.clientHeight);
    this.ssrPass.setSize(this.container.clientWidth, this.container.clientHeight);
    this.bloomPass.setSize(this.container.clientWidth, this.container.clientHeight);
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.locked) {
      this.renderer.domElement.requestPointerLock();
      return;
    }
    if (e.button === 0) this.tryAttack();
    if (e.button === 2) {
      this.block = true;
      // Сообщаем серверу. Раньше ПКМ менял только позу на экране: сервер о
      // блоке не узнавал, и весь механический блок был недостижим из игры.
      this.onBlock?.();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 2) this.block = false;
  };

  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.renderer.domElement;
    this.crosshair.classList.toggle('hidden', !this.locked);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    // Шаг туториала «камера»: настоящий поворот камеры, а не дрожание мыши
    if (Math.abs(e.movementX) > 3 || Math.abs(e.movementY) > 3) this.onCamera?.();
    this.yaw -= e.movementX * 0.0026;
    this.pitch = Math.min(1.25, Math.max(-0.5, this.pitch + e.movementY * 0.0022));
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.locked) return;
    e.preventDefault();
    this.dist = Math.min(15, Math.max(3.2, this.dist + e.deltaY * 0.008));
  };

  /** Пока открыт чат или фокус в поле ввода — движение и прыжок отключены */
  private isTyping(): boolean {
    const el = document.activeElement;
    return chatVisible()
      || el instanceof HTMLInputElement
      || el instanceof HTMLTextAreaElement
      || el instanceof HTMLSelectElement;
  }

  /**
   * Рывок по двойному нажатию клавиши направления.
   *
   * Клавиши: W A S D и стрелки. Повтор клавиши (keydown при удержании) отсекается
   * выше - в keys она уже есть, - поэтому двойным нажатием считаются именно
   * два осознанных нажатия, а не удержание.
   */
  private maybeDodge(code: string): void {
    if (!DOUBLE_TAP_KEYS.has(code)) return;
    const now = Date.now();
    const last = this.lastTap.get(code) ?? 0;
    this.lastTap.set(code, now);
    if (now - last < World3D.DOUBLE_TAP_MS) {
      // Второе нажатие сбрасываем, иначе третий раз подряд (удержание
      // с перебоем) рывнул бы снова через одну пару нажатий.
      this.lastTap.delete(code);
      this.onDodge?.();
      this.applyDodgeImpulse();
    }
  }

  /**
   * Рывок в ту же сторону, куда смотрит персонаж.
   *
   * Сервер неуязвимость включает сам (с откатом и тратой стамины), а рывок
   * здесь — видимое перемещение. Без него персонаж на 1.5 секунды становился
   * бы неуязвимым, стоя на месте, и это выглядело бы как зависание.
   *
   * Скорость рывка не должна ломать античит скорости на сервере: она выше
   * бега (7.6), но сервер считает скорость по среднему за интервал, а рывок
   * длится доли секунды и гасится сразу.
   */
  private applyDodgeImpulse(): void {
    const ix = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
      - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const iz = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0)
      - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    // Анимация уклонения начинается здесь же, до поворота на угол камеры:
    // сторона читается прямо из нажатых клавиш, без обратной тригонометрии,
    // а по диагонали берётся та ось, где нажатие сильнее.
    if (this.me) {
      let сторона: DodgeDirection = 'back';
      if (Math.abs(ix) >= Math.abs(iz) && ix !== 0) {
        сторона = ix < 0 ? 'left' : 'right';
      } else if (iz !== 0) {
        сторона = iz < 0 ? 'back' : 'forward';
      }
      this.rigs.get(this.me.id)?.rig.triggerDodge?.(сторона);
    }
    // Без направляющей клавиши — в ту сторону, куда повёрнут персонаж
    const dx = ix !== 0 || iz !== 0 ? ix : Math.sin(this.yaw);
    const dz = ix !== 0 || iz !== 0 ? iz : Math.cos(this.yaw);
    const len = Math.hypot(dx, dz) || 1;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Тот же поворот, что и у ходьбы: ix/iz задаются в осях камеры.
    // Раньше тут стояло «+=», то есть два рывка подряд складывали скорость:
    // второй удар уносил вдвое дальше первого.
    this.dodgeDx = (dx / len) * cos - (dz / len) * sin;
    this.dodgeDz = -(dx / len) * sin - (dz / len) * cos;
    // Точка старта берётся у живого игрока: без него (выгрузка сцены) рывок
    // считать не от чего, и проверка бежит дальше с нулевым смещением.
    if (this.me) {
      this.dodgeOx = this.me.pos.x;
      this.dodgeOz = this.me.pos.z;
    }
    this.dodgeStartAt = Date.now();
    this.dodgeT = 0;
    this.dodgeUntil = this.dodgeStartAt + DODGE_TIME_MS;
    audio.whoosh();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTyping()) return;
    if (this.keys.has(e.code)) return;
    this.keys.add(e.code);
    this.maybeDodge(e.code);
    // Шаг 3 стелса: F - попытка кражи кошелька. Здесь только флаг: сокет в
    // этом классе недоступен, поэтому запрос уходит из world.ts в игровом
    // цикле. Флаг одноразовый и сбрасывается чтением - иначе удержание F
    // слало бы по попытке в секунду.
    if (e.code === 'KeyF') {
      e.preventDefault();
      this.stealRequested = true;
    }
    // Dokumenty: E. Klavisha otdelnaya ot F namЕРenno - oba deystviya
    // primenyayutsya k raznym tselyam, i odno nazhatie ne dolzhno delat oba.
    if (e.code === 'KeyE') {
      e.preventDefault();
      this.documentRequested = true;
    }
    if (e.code === 'Space' && this.me && this.grounded) {
      e.preventDefault();
      this.vy = JUMP_V;
      this.grounded = false;
      audio.jump();
    }
    // DEBUG: переключение визуализации коллайдеров
    if (e.code === 'KeyZ') {
      this.debugColliders.visible = !this.debugColliders.visible;
      console.log(`[Collision] Debug colliders: ${this.debugColliders.visible ? 'ON' : 'OFF'} (${COLLIDERS.length} total)`);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  private onBlur = () => {
    this.keys.clear();
    this.block = false;
  };

  // ── Атака и прицеливание ─────────────────────────────────────

  /**
   * Захват цели: конус прицеливания от камеры (~12°) + запас по близости.
   * Работает надёжнее луча по мешам: не зависит от высоты прицела.
   */
  private acquireTarget(): string | null {
    if (!this.entities || !this.me) return null;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const camPos = this.camera.position;
    let best: string | null = null;
    let bestDot = 0.978; // ~12°
    for (const [id, m] of this.entities.monsters) {
      if (m.deadAt) continue;
      const y = groundHeight(m.pos.x, m.pos.z) + 1.1;
      const to = new THREE.Vector3(m.pos.x - camPos.x, y - camPos.y, m.pos.z - camPos.z);
      const dist = to.length();
      if (dist > 26) continue;
      to.normalize();
      const dot = to.dot(forward);
      if (dot > bestDot) { bestDot = dot; best = id; }
    }
    if (best) return best;
    // Фолбэк: ближайший монстр вплотную к игроку (замах «наугад»)
    let nearest: string | null = null;
    let nearestD = 3.4;
    for (const [id, m] of this.entities.monsters) {
      if (m.deadAt) continue;
      const d = Math.hypot(m.pos.x - this.me.pos.x, m.pos.z - this.me.pos.z);
      if (d < nearestD) { nearestD = d; nearest = id; }
    }
    return nearest;
  }

  private tryAttack(): void {
    if (this.attackCd > 0) return;
    // Замах по данным оружия и стойки. Сервер считает откат так же, поэтому
    // клиент не отклоняет законный темп и не спамит отказом «слишком быстро».
    this.attackCd = this.swingSeconds();

    // Стадии связки: первый клик — прямой замах, повторный клик в окне —
    // обратный. Третий клик подряд связку не продолжает: завершающая атака —
    // это клик плюс навык (см. useSkill), поэтому счётчик чередуется 1, 2,
    // 1, 2, пока окно не выйдет и связка не начнётся заново с первой.
    const now = performance.now();
    this.comboStage = now - this.lastSwingAt < COMBO_WINDOW_MS && this.comboStage === 1 ? 2 : 1;
    this.lastSwingAt = now;

    // Крючок для слоя приложения (туториал засчитывает замах).
    // Вызывается ДО проверки цели: игрок замахнулся — шаг засчитан, даже если
    // рядом никого не было. Прямая зависимость от tutorial.ts здесь была бы
    // нарушением слоёв: 3D-слой ничего не должен знать про интерфейс.
    this.onAttack?.();

    // Клик по NPC открывает связанную панель (приоритет над боем)
    // Сначала клик по NPC открывает панель, затем — дверь здания.
    if (this.pickNpc()) return;

    if (this.pickDoor()) return;

    if (this.pickInteractive()) return;

    if (this.pickDestructible()) return;

    // Мягкое прицеливание: конус от камеры, затем близость
    const id = this.acquireTarget();
    if (id && this.entities) {
      this.entities.targetId = id;
      const m = this.entities.monsters.get(id);
      if (m) this.callbacks?.onTarget(m.nameRu, m.hp, m.maxHp);
    }
    // Замах всегда (отклик на клик); пакет атаки уходит только при цели
    this.attackAnim = true;
    this.attackStage = this.comboStage;
    audio.whoosh();
    if (this.entities?.targetId) this.callbacks?.onAttack();
  }

  /** Луч из центра экрана по NPC; при попадании — открыть панель */
  private pickNpc(): boolean {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    // Путники на дорогах кликабельны наравне с городскими NPC: те же
    // userData, тот же обработчик, та же панель задач. Без них «случайные
    // НПС с квестами» были бы просто фигурками, к которым не подойти.
    const hits = ray.intersectObjects(
      [...this.npcs.clickTargets, ...this.roadTraffic.clickTargets], true);
    // Невидимые фигуры не кликабельны: луч three.js не смотрит на visible,
    // и ночной патруль днём перехватывал бы клик, стоя перед видимым NPC.
    const видимые = hits.filter((h) => {
      for (let o: THREE.Object3D | null = h.object; o; o = o.parent) {
        if (!o.visible) return false;
      }
      return true;
    });
    if (!видимые.length || видимые[0].distance > 22) return false;
    const panel = видимые[0].object.userData.npcPanel as string | undefined;
    const name = видимые[0].object.userData.npcName as string | undefined;
    const npcId = видимые[0].object.userData.npcId as string | undefined;
    if (!panel) return false;
    this.callbacks?.onNpc?.(panel, name ?? '', npcId ?? '');
    return true;
  }

  /** Клик по интерактивному объекту: ящик, кувшин, навес. */
  private pickInteractive(): boolean {
    if (!this.me || !this.interactiveTargets.length) return false;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = ray.intersectObjects(this.interactiveTargets, true);
    if (!hits.length || hits[0].distance > 22) return false;
    const obj = hits[0].object;
    const ud = obj.userData as { interactiveKind?: string; interactiveState?: string };
    if (!ud.interactiveKind) return false;
    const objPos = obj.getWorldPosition(new THREE.Vector3());
    const dx = this.me.pos.x - objPos.x;
    const dz = this.me.pos.z - objPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 3.5) return false;

    // Геймплейные механики интерактивных объектов
    this.handleInteractiveMechanic(obj, ud);

    this.callbacks?.onInteractive?.(ud.interactiveKind, ud.interactiveState ?? 'intact', obj);
    return true;
  }

  /** Клик по разрушаемому декору: ящик, бочка, ваза, мебель, окно. */
  private pickDestructible(): boolean {
    if (!this.me || !this.destructibleTargets.length) return false;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = ray.intersectObjects(this.destructibleTargets, true);
    if (!hits.length || hits[0].distance > 22) return false;
    // userData лежит на ГРУППЕ разрушаемого объекта, а hits[0].object это
    // mesh-потомок (крышка бочки, планка ящика). Поднимаемся от потомка к
    // предку, который несёт деструкторное userData: раньше проверка стояла
    // у hit-объекта напрямую, и все клики по разрушаемому молча глотались.
    let target: THREE.Object3D | null = hits[0].object;
    while (target && !(target.userData as DestructibleData)?.kind) {
      target = target.parent;
    }
    if (!target) return false;
    const obj = target;
    const ud = obj.userData as DestructibleData;
    const objPos = obj.getWorldPosition(new THREE.Vector3());
    const dx = this.me.pos.x - objPos.x;
    const dz = this.me.pos.z - objPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 3.5) return false;

    // Нанести урон разрушаемому объекту
    const { broken, newState } = damageDestructible(obj, 25, 'physical');
    if (newState !== 'intact') {
      applyDestructibleVisuals(obj);
    }
    if (broken) {
      // Эффект разрушения
      const breakEffect = createBreakEffect(obj, obj.getWorldPosition(new THREE.Vector3()));
      this.scene.add(breakEffect);
      // Удалить через 3 сек
      setTimeout(() => {
        this.scene.remove(breakEffect);
        breakEffect.traverse(child => {
          const mesh = child as THREE.Mesh;
          mesh.geometry?.dispose();
          const mat = mesh.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach(m => m.dispose());
          else mat?.dispose();
        });
      }, 3000);
    }
    // Уведомить UI
    this.callbacks?.onInteractive?.(ud.kind, newState, obj);
    return true;
  }

  private handleInteractiveMechanic(obj: THREE.Object3D, ud: { interactiveKind?: string; interactiveState?: string }): void {
    const kind = ud.interactiveKind;
    const state = ud.interactiveState ?? 'intact';
    if (state !== 'intact') return; // уже сломано/горит/обрушилось

    if (kind === 'crate') {
      // Толкание ящика: сдвигаем в направлении взгляда игрока
      this.pushCrate(obj);
    } else if (kind === 'oil_jug') {
      // Поджог кувшина: если у игрока есть огненный навык/предмет — поджигаем
      this.igniteOilJug(obj);
    } else if (kind === 'awning') {
      // Обрушение навеса: если удар достаточно сильный — рушится
      this.collapseAwning(obj);
    }
  }

  /** Толкнуть ящик в направлении взгляда игрока. */
  private pushCrate(obj: THREE.Object3D): void {
    const pushDist = 1.2; // метров за клик
    const yaw = this.yaw;
    const newX = obj.position.x + Math.sin(yaw) * pushDist;
    const newZ = obj.position.z + Math.cos(yaw) * pushDist;
    // Проверка коллизий: не толкать сквозь стены
    if (!this.checkCrateCollision(newX, newZ, obj)) {
      obj.position.x = newX;
      obj.position.z = newZ;
      // Обновить коллайдеры в COLLIDERS
      this.updateCrateCollider(obj, newX, newZ);
    }
  }

  /** Проверить, не всталкивает ли ящик в стену/объект. */
  private checkCrateCollision(x: number, z: number, ignoreObj: THREE.Object3D): boolean {
    const crateR = 0.6;
    for (const c of COLLIDERS) {
      // игнорировать собственный коллайдер
      if (Math.abs(c.x - ignoreObj.position.x) < 0.1 && Math.abs(c.z - ignoreObj.position.z) < 0.1) continue;
      if (Math.hypot(x - c.x, z - c.z) < crateR + c.r) return true;
    }
    return false;
  }

  /** Обновить позицию коллайдера ящика. */
  private updateCrateCollider(obj: THREE.Object3D, x: number, z: number): void {
    for (const c of COLLIDERS) {
      if (Math.abs(c.x - obj.position.x) < 0.1 && Math.abs(c.z - obj.position.z) < 0.1) {
        c.x = x; c.z = z; break;
      }
    }
  }

  /** Поджечь кувшин с маслом. */
  private igniteOilJug(obj: THREE.Object3D): void {
    // Проверка: есть ли у игрока огненный навык/предмет (упрощённо: всегда поджигаем при клике)
    obj.userData.state = 'burning';
    // Визуал горения: добавить пламя/дым
    this.addBurningEffect(obj);
    // Через burnTime секунд — превратить в сгоревшее
    const burnTime = (obj.userData as any).burnTime ?? 10;
    setTimeout(() => {
      obj.userData.state = 'broken';
      this.removeBurningEffect(obj);
      this.addBrokenEffect(obj);
    }, burnTime * 1000);
  }

  /** Добавить эффект горения к кувшину. */
  private addBurningEffect(obj: THREE.Object3D): void {
    const fire = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.8, 8),
      M.fire
    );
    fire.position.y = 1.2;
    fire.userData = { isBurningEffect: true };
    obj.add(fire);
    // Дым: простой материал вместо M.smoke (нет в M)
    const smokeMat = new THREE.MeshStandardMaterial({
      color: 0x444444, transparent: true, opacity: 0.6, depthWrite: false
    });
    const smoke = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.4, 1.5, 8),
      smokeMat
    );
    smoke.position.y = 2.0;
    smoke.userData = { isBurningEffect: true };
    obj.add(smoke);
    // Сохранить материал для dispose
    (smoke as any)._smokeMat = smokeMat;
  }

  /** Убрать эффект горения. */
  private removeBurningEffect(obj: THREE.Object3D): void {
    obj.traverse(child => {
      if ((child as THREE.Mesh).userData?.isBurningEffect) {
        obj.remove(child);
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) {
          mat.forEach(m => m.dispose());
        } else if (mat) {
          mat.dispose();
        }
        // Удалить кастомный материал дыма
        const smokeMat = (mesh as any)._smokeMat;
        if (smokeMat) smokeMat.dispose();
      }
    });
  }

  /** Добавить эффект сгоревшего кувшина. */
  private addBrokenEffect(obj: THREE.Object3D): void {
    // Можно добавить обугленный вид или оставить как есть
    obj.traverse(child => {
      if (child instanceof THREE.Mesh && child.material) {
        (child.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
      }
    });
  }

  /** Обрушить навес. */
  private collapseAwning(obj: THREE.Object3D): void {
    obj.userData.state = 'collapsed';
    // Анимация обрушения: наклонить стойки и уронить крышу
    this.animateAwningCollapse(obj);
  }

  /** Анимация обрушения навеса. */
  private animateAwningCollapse(obj: THREE.Object3D): void {
    const posts: THREE.Mesh[] = [];
    const roofRef: { current: THREE.Mesh | null } = { current: null };
    obj.traverse(child => {
      if (child instanceof THREE.Mesh) {
        const geo = child.geometry as THREE.BufferGeometry;
        if (geo && geo.type === 'CylinderGeometry') posts.push(child);
        else if (geo && geo.type === 'BoxGeometry' && child.position.y > 2) roofRef.current = child;
      }
    });
    // Наклонить стойки
    posts.forEach((post, i) => {
      const targetRot = (i % 2 === 0) ? -0.8 : 0.8;
      // Простая анимация без tween: сразу наклоняем
      post.rotation.x = targetRot;
      post.position.y *= 0.5;
    });
    // Уронить крышу
    const roof = roofRef.current;
    if (roof) {
      roof.position.y = 0.8;
      roof.rotation.x = 0.3;
      roof.rotation.z = 0.2;
    }
  }

  /** Клик по двери здания: только детект. Телепорт — лишь после ACK
   *  сервера (иначе первый пакет из кармана опередит сброс трекинга
   *  и античит кикнет за спидхак). */
  private pickDoor(): boolean {
    if (!this.me || !this.doorTargets.length) return false;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = ray.intersectObjects(this.doorTargets, false);
    if (!hits.length || hits[0].distance > 22) return false;
    const ud = hits[0].object.userData as { doorBuilding?: string; doorAction?: string; doorName?: string; entranceId?: string; documentSpot?: string; documentName?: string };
    // Стол с документами проверяется ДО двери: у него нет doorBuilding, и без
    // этой ветки клик по столу просто ничего не делал бы.
    if (ud.documentSpot) {
      this.documentRequested = true;
      return true;
    }
    if (!ud.doorBuilding || (ud.doorAction !== 'enter' && ud.doorAction !== 'exit')) return false;
    this.callbacks?.onDoor?.(ud.doorAction, ud.doorBuilding, ud.doorName ?? ud.doorBuilding, ud.entranceId);
    return true;
  }

  /** Телепорт внутрь в точку от сервера (вызывать только по ack). */
  /**
   * Собрать интерьерные цели текущей комнаты заново. Раньше списки
   * заполнялись один раз на init (§320): при выходе из здания они
   * очищались и больше не возвращались - второй визит терял кликабельность
   * ящиков, а вместе с ними и лестниц. Теперь источник истины - комнатные
   * массивы, и цели пересобираются на каждом входе/выходе.
   */
  private refreshInteriorTargets(): void {
    this.interactiveTargets.length = 0;
    this.climbTargets.length = 0;
    this.destructibleTargets.length = 0;
    if (!this.interiors.isInside()) return;
    const room = this.interiors.rooms.get(String(this.interiors.insideId() ?? ''));
    if (!room) return;
    this.interactiveTargets.push(...room.interactiveTargets);
    this.climbTargets.push(...room.climbTargets);
    this.destructibleTargets.push(...room.destructibleTargets);
  }

  /**
   * Верхняя поверхность мезонина под ногами (§324), или null.
   * feetY отсекает платформу, до которой далеко снизу: подпрыгнув с
   * пола (1.44 м) до платы 2.6 м не долетаешь, ходить ПОД платформой
   * можно свободно, а вот падение на плиту и шаг по ней засчитываются.
   */
  private platformTopAt(x: number, z: number, feetY: number): number | null {
    if (!this.interiors.isInside()) return null;
    const room = this.interiors.rooms.get(String(this.interiors.insideId() ?? ''));
    if (!room || !room.platforms.length) return null;
    let верх: number | null = null;
    for (const p of room.platforms) {
      if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2 &&
          feetY > p.y - 0.55) {
        верх = верх !== null ? Math.max(верх, p.y) : p.y;
      }
    }
    return верх;
  }

  enterBuildingAt(id: string, target: { x: number; y: number; z: number }): boolean {
    if (!this.me) return false;
    const def = this.interiors.def(id);
    if (!def) return false;
    this.interiors.enter(id);
    this.refreshInteriorTargets();
    this.weather?.setInside(true);
    this.me.pos.x = target.x;
    this.me.pos.y = target.y;
    this.me.pos.z = target.z;
    this.me.target = { ...this.me.pos };
    this.vy = 0;
    this.grounded = true;
    this.swimming = false;
    return true;
  }

  /** Телепорт наружу в точку от сервера (вызывать только по ack). */
  exitBuildingAt(target: { x: number; y: number; z: number }): boolean {
    if (!this.me || !this.interiors.isInside()) return false;
    const def = this.interiors.insideDef();
    if (!def) return false;
    this.interiors.exit();
    this.weather?.setInside(false);
    this.refreshInteriorTargets();
    this.climb = null;
    this.me.pos.x = target.x;
    this.me.pos.y = target.y;
    this.me.pos.z = target.z;
    this.me.target = { ...this.me.pos };
    this.vy = 0;
    this.grounded = true;
    this.swimming = false;
    return true;
  }

  /** Локальный выход без сервера: резиновая лента при отклонении движения. */  exitBuildingLocal(): boolean {
    if (!this.me || !this.interiors.isInside()) return false;
    const def = this.interiors.insideDef();
    if (!def) return false;
    this.interiors.exit();
    // Восстановить погоду при выходе локально (без сервера)
    if (!this.interiors.isInside()) this.weather?.setInside(false);
    this.refreshInteriorTargets();
    this.climb = null;
    this.me.pos.x = def.exitX;
    this.me.pos.z = def.exitZ;
    this.me.pos.y = groundHeight(def.exitX, def.exitZ);
    this.me.target = { ...this.me.pos };
    this.vy = 0;
    this.grounded = true;
    this.swimming = false;
    return true;
  }

  /** Погода от сервера (world:time): дождь, гроза, песчаная буря. */
  setWeather(w: string): void {
    this.weather?.setWeather(w);
    this.currentWeather = (w || 'clear') as WeatherKind;
    // Тучи тоже должны знать о погоде: раньше небо вообще не получало
    // код погоды, поэтому в дождь и бурю облака оставались белыми
    this.sky?.setWeather((w || 'clear') as WeatherKind);
  }

  isInsideBuilding(): boolean {
    return this.interiors.isInside();
  }

  /** Восстановить состояние «внутри» по позиции спавна (вход в мир в кармане).
   *  Без телепорта и без сокета: сервер уже сбросил трекинг при AUTH.
   *  Без этого первый шаг в комнате упирался в кламп границ и давал кик. */
  enterBuildingLocalAt(x: number, z: number): string | null {
    if (!this.me) return null;
    const def = BUILDINGS.find((b) =>
      Math.abs(x - b.roomCx) <= 16 && Math.abs(z - b.roomCz) <= 16) ?? null;
    if (!def) return null;
    this.interiors.enter(def.id);
    this.refreshInteriorTargets();
    return t(def.nameKey);
  }

  /**
   * Подменяет процедурный риг игрока настоящей моделью, когда она дошла.
   *
   * Порядок важен: сначала показывается процедурный силуэт, и только потом он
   * меняется на модель. Обратный порядок означал бы пустоту на месте игрока всё то
   * время, пока идёт загрузка файла. Подмена сохраняет позицию, поворот и
   * видимость, а надетое снаряжение переносится на новый риг: слоты те же.
   */
  private upgradeToRealModel(id: string, charClass: string): void {
    const b = this.rigs.get(id);
    if (!b || b.realModelTried) return;
    b.realModelTried = true;
    void loadRealPlayerRig(charClass).then((real) => {
      const cur = this.rigs.get(id);
      if (!real || !cur || cur.kind !== 'player') {
        // Модель не пришла: остаёмся на палочках, и отметку сбрасываем, чтобы
        // попытка могла повториться — например, после смены класса.
        if (cur && !real) cur.realModelTried = false;
        // ЗАМЕР. Молчаливый отказ — половина диагностики: по экрану не видно,
        // рисуется процедурный силуэт или настоящая модель. Одна строка в
        // консоль отвечает на вопрос, который иначе приходится решать по
        // догадкам (см. §139-142).
        console.info(`[rig] player ${id}: real model NOT applied - procedural silhouette shown`);
        return;
      }
      const прежний = cur.rig;
      real.group.position.copy(прежний.group.position);
      real.group.rotation.copy(прежний.group.rotation);
      real.group.visible = прежний.group.visible;
      real.group.userData.playerId = id;
      прежний.group.removeFromParent();
      прежний.dispose();
      this.scene.add(real.group);
      cur.rig = real;
      // Второй замер: не «модель пришла», а КАКОГО РАЗМЕРА она встала.
      //
      // Число после add — уже с учётом всех обёрток, масштабов подгонки и
      // поворота, то есть ровно то, что видно на экране.
      //
      // Взято НЕ через Box3.setFromObject(): тот берёт geometry.boundingBox,
      // то есть позу покоя, и отдаёт число, не похожее ни на что видимое.
      // Именно этим замером пять гипотез подряд доказывали, что фигура рисуется
      // неправильно, и трижды предлагали чинить не то. Здесь — настоящий рост
      // в позе, тем же способом, что и в подгонке.
      console.info(
        `[rig] player ${id}: real model applied, ` +
          `height=${ростПозы(real.group).toFixed(4)} ` +
          `groupScale=${real.group.scale.x.toFixed(4)} ` +
          `sceneChildren=${real.group.children.length}`,
      );
      if (id === this.me?.id) {
        // Вид оружия — по классу (посох мистика — настоящей моделью, остальные
        // процедурные). Ставится до equipWeapon: иначе построится меч.
        real.setWeaponKind(CLASS_WEAPON[charClass] ?? 'sword');
        if (this.localGear) {
          real.equipWeapon(this.localGear.weapon);
          real.setArmorTint(this.localGear.armorColor);
        } else {
          // Мистик с видимым посохом: прятали процедурный, настоящий показывают.
          real.equipWeapon(true);
        }
        real.equipShield(charClass === 'qizilbash');
      }
    });
  }

  // ── Синхронизация ригов ──────────────────────────────────────
  private syncRigs(): void {
    if (!this.entities) return;
    const seen = new Set<string>();

    for (const [id, p] of this.entities.players) {
      seen.add(id);
      let b = this.rigs.get(id);
      if (!b) {
        b = { rig: buildPlayerRig(p.charClass), kind: 'player' };
        b.rig.group.userData.playerId = id;
        this.scene.add(b.rig.group);
        this.rigs.set(id, b);
        // Настоящая модель подставляется позже и только своему игроку: остальным
        // игрокам она пока не нужна, а толпе тем более.
        if (id === this.me?.id) this.upgradeToRealModel(id, p.charClass);
      }
      // Свой персонаж: вид — из надетого, а не из класса. Применяем на каждом
      // проходе, а не только при создании рига: игрок надевает и снимает
      // вещи на ходу, и без этого риг обновлялся бы только при входе в игру
      if (id === this.me?.id) {
        // Вид оружия — по классу, как при создании рига выше.
        b.rig.setWeaponKind?.(CLASS_WEAPON[p.charClass] ?? 'sword');
        if (this.localGear) {
          b.rig.equipWeapon(this.localGear.weapon);
          b.rig.setArmorTint(this.localGear.armorColor);
        } else {
          // Экипировка ещё не пришла с сервера: показываем то, что даёт класс
          b.rig.equipWeapon(true);
        }
        // Щит классовый: слота щита в игре нет (weapon, armor, accessory)
        b.rig.equipShield(p.charClass === 'qizilbash');
      }
      // Высота тела — из логической позиции (мосты, плавание, интерьеры),
      // а не из ландшафта: иначе тело «улетает» на горы в кармане
      // и «тонет» на дне в воде.
      // Для локального игрока берём this.feetY — результат физики текущего
      // кадра (плавание держит на поверхности, внутри здания — пол комнаты).
      // Для остальных — позицию, пришедшую по сокету.
      const py = id === this.me?.id
        ? (Number.isFinite(this.feetY) ? this.feetY : groundHeight(p.pos.x, p.pos.z))
        : (Number.isFinite(p.pos.y) ? p.pos.y : groundHeight(p.pos.x, p.pos.z));
      b.rig.group.position.set(p.pos.x, py, p.pos.z);
    }

    for (const [id, m] of this.entities.monsters) {
      seen.add(id);
      let b = this.rigs.get(id);
      if (!b) {
        b = { rig: buildMonsterRig(m.monsterId), kind: 'monster' };
        b.rig.group.userData.monsterId = id;
        this.scene.add(b.rig.group);
        this.rigs.set(id, b);
        // Процедурный риг стоит сразу, настоящая модель едет следом: пришла —
        // подменяем, нет — остаётся процедурная. То же, что upgradeToRealModel
        // у игрока, только по реестру монстров.
        this.upgradeMonsterToRealModel(id, m.monsterId, b);
      }
      // Подводное ли? Флаг и высоту над водой шлёт сервер при спавне —
      // список существ меняется, клиенту о нём знать не нужно.
      if (m.aquatic) {
        b.aquatic = true;
        b.aquaticLift = m.aquaticSize ?? 0.25;
      }
      // Живой монстр не уходит под воду: раньше тело ставилось прямо на дно
      // (у озера оно на 3.2 м ниже поверхности) и разбойник «тонул», оставаясь
      // под водой. Теперь на глубине он держится у поверхности и плывёт,
      // на мелководье идёт по дну — так же, как уже сделано для фауны.
      const gy = groundHeight(m.pos.x, m.pos.z);
      const surf = waterSurfaceY(m.pos.x, m.pos.z);
      const mDepth = !m.deadAt && surf !== null ? surf - gy : 0;
      const swimM = mDepth > SWIM_MIN_DEPTH;
      b.monsterSwim = swimM;
      // Подводное существо торчит из воды, а не висит под ней: игрок должен
      // видеть, что в озере что-то есть, и подплывать к нему на осознанном
      // риске. Спина над водой — как у настоящей рыбы.
      const aquaticM = b.aquatic === true;
      const y = swimM && surf !== null
        ? (aquaticM ? surf + (b.aquaticLift ?? 0) : surf - SWIM_FEET)
        : gy;
      b.rig.group.position.set(m.pos.x, y, m.pos.z);
      // Поворот к направлению движения
      const dx = m.target.x - m.pos.x, dz = m.target.z - m.pos.z;
      if (Math.hypot(dx, dz) > 0.1) {
        const want = Math.atan2(dx, dz);
        b.rig.group.rotation.y += shortestAngle(want - b.rig.group.rotation.y) * 0.12;
      }
    }

    // Удалённые сущности
    for (const [id, b] of this.rigs) {
      if (!seen.has(id)) {
        this.scene.remove(b.rig.group);
        b.rig.dispose();
        this.rigs.delete(id);
      }
    }
  }

  /**
   * Подменяет процедурный риг монстра настоящей моделью, когда та доехала.
   *
   * Синхронизация остаётся синхронной: ждать модель в проходе кадра нельзя —
   * риг появлялся бы кадрами позже и мог задвоиться. Пока файл едет, монстр
   * ходит на процедурной сборке; после подмены анимации (шаг, бег, смерть)
   * ведёт уже RealRig с тем же интерфейсом. Оружие у модели ставится
   * процедурным — тем же, что носил риг.
   */
  private upgradeMonsterToRealModel(id: string, monsterId: string, b: BoundRig): void {
    b.realModelTried = true;
    void loadRealMonsterRig(monsterId).then((real) => {
      // Монстр мог умереть и вычиститься, пока модель грузилась: тогда
      // подменять нечего, новый риг (если появился) уже запросит своё.
      if (!real || this.rigs.get(id) !== b) return;
      real.group.userData.monsterId = id;
      real.equipWeapon(true);
      const parent = b.rig.group.parent;
      b.rig.dispose();
      if (parent) parent.add(real.group);
      b.rig = real;
    });
  }

  // ── FX: плавающий урон и эффекты из entities.World ──────────
  private syncFx(now: number): void {
    if (!this.entities) return;
    // Новые флоатеры -> DOM-элементы, проецируемые из 3D.
    // Сверяемся по порядковому номеру (f.seq), а не по индексу в массиве:
    // массив укорачивается с начала, индекс бы намертво «залипал» за длиной
    // и цифры урона пропадали бы через пару секунд боя.
    const fl = this.entities.floaters;
    for (const f of fl) {
      if (f.seq <= this.lastFx.floater) continue;
      this.lastFx.floater = f.seq;
      const el = document.createElement('div');
      el.className = 'floater3d' + (f.crit ? ' crit' : '');
      el.textContent = f.text;
      el.style.color = f.color;
      el.dataset.born = String(f.born);
      el.dataset.x = String(f.x);
      el.dataset.z = String(f.y); // 2D-конвенция: floater.y хранит координату z
      this.fxLayer.appendChild(el);
      setTimeout(() => el.remove(), 1150);
    }

    // Новые эффекты -> частицы (2D-конвенция: y хранит координату z)
    const ef = this.entities.effects;
    for (const e of ef) {
      if (e.seq <= this.lastFx.effect) continue;
      this.lastFx.effect = e.seq;
      if (e.kind === 'heal') this.burst(e.x2, e.y2, 0x6ecf7a, 10);
      else this.burst(e.x2, e.y2, e.kind === 'slash' ? 0xf4d26c : 0xe07a4a, 8);
    }

    // Позиции флоатеров
    for (const el of Array.from(this.fxLayer.children) as HTMLElement[]) {
      const age = (now - Number(el.dataset.born)) / 1100;
      const x = Number(el.dataset.x), z = Number(el.dataset.z);
      const p = new THREE.Vector3(x, groundHeight(x, z) + 2.1 + age * 1.1, z).project(this.camera);
      el.style.transform = `translate(-50%,-50%) translate(${(p.x * 0.5 + 0.5) * this.container.clientWidth}px, ${(-p.y * 0.5 + 0.5) * this.container.clientHeight}px)`;
      el.style.opacity = String(1 - age);
    }
  }

  private burst(x: number, z: number, color: number, count: number): void {
    const y = groundHeight(x, z) + 1.3;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const geo = new THREE.SphereGeometry(0.09, 6, 6);
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(geo, mat.clone());
      p.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2), 2 + Math.random() * 2.5, Math.sin(a) * (1 + Math.random() * 2));
      this.scene.add(p);
      const start = performance.now();
      const tick = () => {
        const t = (performance.now() - start) / 420;
        if (t >= 1) { this.scene.remove(p); return; }
        v.y -= 9 * 0.016;
        p.position.addScaledVector(v, 0.016);
        (p.material as THREE.MeshBasicMaterial).opacity = 1 - t;
        requestAnimationFrame(tick);
      };
      tick();
    }
  }

  /** Пузырёк при плавании: маленькая полупрозрачная сфера, всплывает и исчезает */
  private spawnBubble(x: number, y: number, z: number): void {
    const geo = new THREE.SphereGeometry(0.06 + Math.random() * 0.06, 6, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xccddff, transparent: true, opacity: 0.5 });
    const b = new THREE.Mesh(geo, mat);
    b.position.set(x + (Math.random() - 0.5) * 0.8, y - 0.2, z + (Math.random() - 0.5) * 0.8);
    this.scene.add(b);
    const start = performance.now();
    const vy = 1.5 + Math.random();
    const vx = (Math.random() - 0.5) * 0.4;
    const vz = (Math.random() - 0.5) * 0.4;
    const tick = () => {
      const t = (performance.now() - start) / 900;
      if (t >= 1) { this.scene.remove(b); b.geometry.dispose(); return; }
      b.position.x += vx * 0.016;
      b.position.y += vy * 0.016;
      b.position.z += vz * 0.016;
      b.scale.setScalar(1 + t * 0.5);
      mat.opacity = 0.5 * (1 - t);
      requestAnimationFrame(tick);
    };
    tick();
  }

  /** Выталкивает точку из цилиндрических коллайдеров построек (проходы — для углов) */
  /**
   * Проверка точки на «внутри препятствия» для луча камеры (§369).
   *
   * Только статичные стены: звери и горожане движутся, и камера, дёргающаяся
   * от каждого прохожего, была бы хуже стены. КРУГЛЫЕ коллайдеры — стены
   * вертикальны, луч в горизонтальной плоскости честен.
   */
  private камераЗакрыта(x: number, z: number): boolean {
    const списки = [COLLIDERS, INTERIOR_COLLIDERS, POCKET_COLLIDERS];
    for (const список of списки) {
      for (const c of список) {
        const dx = x - c.x, dz = z - c.z;
        if (dx * dx + dz * dz < (c.r + CAMERA_R) * (c.r + CAMERA_R)) return true;
      }
    }
    return false;
  }

  /**
   * Наибольшая дистанция камеры, на которую ничего не загораживает (§369).
   *
   * Луч от игрока к желаемой точке, сэмплирование с шагом
   * CAMERA_SAMPLE_STEP. Быстрый путь: желаемая точка свободна — луч не идёт
   * вовсе (за городом это каждый кадр).
   */
  private разрешённаяДистанция(игрок: { x: number; z: number }, желаемая: number): number {
    const inside = this.interiors.isInside();
    const потолок = inside ? Math.min(желаемая, CAMERA_INDOOR_MAX) : желаемая;
    const dirX = Math.sin(this.yaw) * Math.cos(this.pitch);
    const dirZ = Math.cos(this.yaw) * Math.cos(this.pitch);
    if (!this.камераЗакрыта(игрок.x + dirX * потолок, игрок.z + dirZ * потолок)) {
      return потолок;
    }
    for (let d = потолок - CAMERA_SAMPLE_STEP; d >= CAMERA_SAMPLE_MIN; d -= CAMERA_SAMPLE_STEP) {
      if (!this.камераЗакрыта(игрок.x + dirX * d, игрок.z + dirZ * d)) {
        return d;
      }
    }
    return CAMERA_SAMPLE_MIN;
  }

  private resolveCollisions(p: { x: number; z: number }, radius: number): void {
    this.resolveCircleList(p, radius, COLLIDERS);
    this.resolveCircleList(p, radius, FAUNA_COLLIDERS);
    // Коллайдеры интерьера живут в кармане мира — снаружи список пуст.
    this.resolveCircleList(p, radius, INTERIOR_COLLIDERS);
    // Забор кармана держит игрока на плато, даже если он как-то вышел из комнаты.
    this.resolveCircleList(p, radius, POCKET_COLLIDERS);
    // Горожане: сквозь них не пройти.
    this.resolveCircleList(p, radius, CIV_COLLIDERS);
  }

  private resolveCircleList(
    p: { x: number; z: number }, radius: number, list: { x: number; z: number; r: number }[],
  ): void {
    if (!list.length) return;
    for (let pass = 0; pass < 3; pass++) {
      let pushed = false;
      for (const c of list) {
        const dx = p.x - c.x, dz = p.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + radius;
        if (d < min) {
          if (d > 1e-4) {
            p.x = c.x + (dx / d) * min;
            p.z = c.z + (dz / d) * min;
          } else {
            p.x = c.x + min; // ровно в центре — толкаем на восток
          }
          pushed = true;
        }
      }
      if (!pushed) break;
    }
  }

  // ── Главный апдейт ───────────────────────────────────────────
  update(dt: number, now: number, night: number): void {
    if (!this.entities || !this.me) return;
    if ((night >= 1) !== this.wasNight) {
      this.wasNight = night >= 1;
      audio.setNight(this.wasNight);
    }
    const me = this.me;

    if (this.exhaustedFlash > 0) this.exhaustedFlash -= dt;

    // ── Ввод движения (относительно камеры) ──
    let ix = 0, iz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iz -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
    // Мёртвый не ходит. Экран смерти закрывает обзор, но клавиши под
    // рукой остаются: без этой заглушки персонаж уезжал из-под оверлея,
    // и при респавне на месте было видно рывок обратно.
    if (session.dead) { ix = 0; iz = 0; }
    if (this.keys.has('KeyQ')) this.yaw += dt * 2.2;
    if (this.keys.has('KeyE')) this.yaw -= dt * 2.2;
    // Крен камеры: поворот вокруг её собственной оси, то есть наклон горизонта.
    // X и V: Z занят показом коллайдеров, Q и E заняты облетом.
    //
    // Крен НЕ двигает персонажа: шаг читается по this.yaw, а крен живёт в своём поле.
    // Это не украшение, а требование - если бы крен попал в yaw, то при наклонённом
    // экране кнопки стали бы вести себя «неправильно», и это уже было бы настоящей
    // поломкой, а не неудобством.
    if (this.keys.has('KeyX')) this.roll -= dt * ROLL_RATE;
    if (this.keys.has('KeyV')) this.roll += dt * ROLL_RATE;
    this.roll = Math.min(ROLL_LIMIT, Math.max(-ROLL_LIMIT, this.roll));
    this.crouch = !session.dead && (this.keys.has('KeyC') || this.keys.has('ControlLeft'));

    // ── Лестницы (§324): удержание W рядом с лестницей в интерьере ──
    // цепляет к ней. Дальше движение вертикальное: W вверх, S вниз.
    // Сход - на платформе или на полу; лестница не сходит с уступа
    // сама, чтобы случайное нажатие не сорвало игрока с высоты.
    if (!this.climb && !session.dead && this.interiors.isInside() &&
        (this.keys.has('KeyW') || this.keys.has('ArrowUp'))) {
      let ближайшая: THREE.Object3D | null = null;
      let дальность = 1.4;
      const позы = new THREE.Vector3();
      for (const цель of this.climbTargets) {
        цель.getWorldPosition(позы);
        const d = Math.hypot(позы.x - me.pos.x, позы.z - me.pos.z);
        if (d < дальность) { дальность = d; ближайшая = цель; }
      }
      const вершина = (ближайшая?.userData as { ladderTop?: number } | undefined)?.ladderTop ?? 0;
      // Вверх лезем с пола или с середины подъёма; на уровне вершины
      // хватание уже не нужно - там стоят ноги, ходьба и так работает.
      if (ближайшая && вершина > me.pos.y + 0.1) {
        this.climb = ближайшая;
        this.vy = 0;
        this.grounded = false;
      }
    }
    // На лестнице XZ заморожены: единственное движение - вертикальное
    // (обрабатывается в блоке «Вертикаль» ниже по this.keys, поэтому
    // обнуление ввода его не задевает).
    if (this.climb) { ix = 0; iz = 0; }

    const len = Math.hypot(ix, iz);
    const onBridge = bridgeAt(me.pos.x, me.pos.z);
    const surfaceY = waterSurfaceY(me.pos.x, me.pos.z);
    // Реальная глубина = поверхность воды − дно под ногами.
    // Раньше здесь стояла маска waterMask > 0.3, из-за чего во всей мягкой
    // прибрежной зоне включался «брод» с невидимым полом у поверхности —
    // персонаж ходил ПО воде. Теперь: мелко — идём по настоящему дну
    // (вода по пояс), глубоко — плывём, тело погружено, голова над водой.
    const bedY = this.interiors.isInside() ? Number.NaN : groundHeight(me.pos.x, me.pos.z);
    const depth = (surfaceY !== null && onBridge === null && !Number.isNaN(bedY))
      ? Math.max(0, surfaceY - bedY)
      : 0;
    this.swimming = depth > SWIM_MIN_DEPTH;
    const wading = depth > WADE_MIN_DEPTH && !this.swimming;
    // Усиленный бег/плытьё — только если хватает выносливости
    const shifting = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && this.sprintAllowed;
    // Снаряжение для воды снимает замедление: сапоги/плащ уменьшают
    // множитель брода и прибавляют скорость плавания. Лодка даёт свой
    // бонус — берётся лучший из двух, а не сумма (иначе лодка дала бы
    // больше 1 и вода перестала бы тормозить совсем при любом снаряжении)
    const waterBonus = Math.max(this.waterSpeedBonus, this.boatWaterSpeed);
    const wadeMult = WADE_MULT + (1 - WADE_MULT) * waterBonus;
    const swimSpeed = SWIM_SPEED + (WALK_SPEED - SWIM_SPEED) * waterBonus;
    const swimSprint = SWIM_SPRINT + (RUN_SPEED - SWIM_SPRINT) * waterBonus;
    const boatSpeed = this.boatId ? this.boatSwimSpeed : 0;
    // Скакун меняет скорость на суше: шагом — его полная, бегом — в 1.4 раза
    // больше. В воде скакун не помогает (там лодка и сапоги), иначе конь
    // ускорял бы ещё и плавление.
    // Приседание всегда оставляет пешую скорость: это «крадусь тихо», и
    // верхом красться бессмысленно.
    // Погода тормозит сушу целиком — шаг, бег и скакуна: в песчаную бурю
    // против ветра не скачут. Рывок и вода погоду не читают (см. speedMod).
    const landWalk = (this.mountSpeed > 0 ? this.mountSpeed : WALK_SPEED) * this.speedMod;
    const landRun = (this.mountSpeed > 0 ? this.mountSpeed * MOUNT_SPRINT_MULT : RUN_SPEED) * this.speedMod;
    const speed = (this.swimming
      ? (shifting ? Math.max(swimSprint, boatSpeed * 1.25) : Math.max(swimSpeed, boatSpeed))
      : this.crouch ? CROUCH_SPEED : shifting ? landRun : landWalk)
      * (wading ? wadeMult : 1);
    // Направление камеры в мире (нужно и для поворота рига ниже)
    // Пока идёт рывок, ходьба не применяется: рывок идёт отдельным
    // перемещением, а не добавкой к бегу. Иначе пик скорости становится
    // DODGE_SPEED + RUN_SPEED = 22.6 при пределе анти-чита 15.6, и честный
    // рывок объявляется читерством. Проверяется числами в dodgeFeel.test.ts.
    const бежитРывок = Date.now() < this.dodgeUntil && (this.dodgeDx !== 0 || this.dodgeDz !== 0);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    if (len > 0 && !бежитРывок) {
      ix /= len; iz /= len;
      const wx = ix * cos - iz * sin;
      const wz = -ix * sin - iz * cos;
      me.pos.x += wx * speed * dt;
      me.pos.z += wz * speed * dt;
      this.lastDir = { x: wx, y: 0, z: wz };
      // Границы мира
      // Границы мира — только снаружи: карман интерьеров вне этих пределов,
      // внутри комнаты игрока держат стены-коллайдеры.
      if (!this.interiors.isInside()) {
        me.pos.x = Math.min(WORLD_HALF - 30, Math.max(-WORLD_HALF + 30, me.pos.x));
        me.pos.z = Math.min(WORLD_HALF - 30, Math.max(-WORLD_HALF + 30, me.pos.z));
      }
      me.flipped = false;
    }

    // ── Рывок ──
    // Скорость гаснет линейно до конца рывка. Рывок применяется и без
    // нажатых клавиш, поэтому движение считается не «ходьба плюс рывок»,
    // а отдельным смещением поверх.
    if (бежитРывок) {
      // Путь рывка по прошедшей доле времени: p(t) = v*T*(t - t²/2).
      // За кадр берётся РАЗНОСТЬ пути, а не прибавление шага, поэтому длина
      // одинакова при 30 и при 144 кадрах: ровно v*T/2 = 1.65 метра.
      const t = Math.min(1, Math.max(0, (Date.now() - this.dodgeStartAt) / DODGE_TIME_MS));
      const путь = (доля: number): number =>
        DODGE_SPEED * (DODGE_TIME_MS / 1000) * (доля - (доля * доля) / 2);
      const смещение = путь(t) - путь(this.dodgeT);
      this.dodgeT = t;
      me.pos.x = this.dodgeOx + this.dodgeDx * смещение;
      me.pos.z = this.dodgeOz + this.dodgeDz * смещение;
      if (!this.interiors.isInside()) {
        me.pos.x = Math.min(WORLD_HALF - 30, Math.max(-WORLD_HALF + 30, me.pos.x));
        me.pos.z = Math.min(WORLD_HALF - 30, Math.max(-WORLD_HALF + 30, me.pos.z));
      }
      // Для анимации нужна мгновенная скорость — производная пути: v*(1 - t).
      const скорость = DODGE_SPEED * (1 - t);
      this.lastDir = {
        x: this.dodgeDx * скорость,
        y: 0,
        z: this.dodgeDz * скорость,
      };
    }

    // Столкновения с постройками — каждый кадр (в т.ч. если затолкало в стену)
    this.resolveCollisions(me.pos, PLAYER_R);

    // ── Вертикаль: прыжок / плавание / мост / земля ──
    // Внутри здания пол — пол комнаты; в кармане вне комнат — плато.
    const pocketY = pocketGroundY(me.pos.x, me.pos.z);
    // Мезонин (§324): верхняя площадка под ногами, если ступни у неё или
    // чуть ниже (падение на плиту). null - игрок под платформой и ходит
    // по полу комнаты.
    const платформа = this.platformTopAt(me.pos.x, me.pos.z, me.pos.y);
    const groundY = this.interiors.isInside()
      ? this.interiors.floorY()
      : pocketY ?? groundHeight(me.pos.x, me.pos.z);
    // Платформа засчитывается, только пока она действительно выше пола
    // комнаты: иначе она «пересекла» бы пол.
    const подНогами = платформа !== null && this.interiors.isInside() && платформа > groundY
      ? платформа
      : groundY;
    const bridgeY = bridgeAt(me.pos.x, me.pos.z);
    // Невидимый пол у поверхности (wadeFloor) убран: в мелкой воде ступни
    // стоят на НАСТОЯЩЕМ дне, и игрок реально идёт по пояс в воде, а не
    // «гуляет» по поверхности.
    const effectiveGroundY = bridgeY !== null ? bridgeY : подНогами;
    if (this.climb) {
      // ── Лазание по лестнице (§324) ──
      // XZ заморожены (ввод обнулён выше), двигается только высота:
      // W вверх, S вниз. Space игнорируется сам собой: прыжок требует
      // grounded, а на лестнице он снят. Вершина лестницы = верхняя
      // поверхность платы мезонина (ladderTop из userData), поэтому сход
      // сверху ставит игрока ровно на плату, без полушага в пустоту.
      if (session.dead) {
        // Мёртвый не держится за лестницу: отпускаем и даём упасть.
        this.climb = null;
        this.grounded = false;
      } else {
        const верх = (this.climb.userData as { ladderTop?: number }).ladderTop ?? me.pos.y;
        let скорость = 0;
        if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) скорость = 2.8;
        else if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) скорость = -3.2;
        me.pos.y += скорость * dt;
        this.lastDir = { x: 0, y: 0, z: 0 };
        if (me.pos.y >= верх) {
          me.pos.y = верх;
          this.vy = 0;
          this.grounded = true;
          this.climb = null;
          audio.footstep(false);
        } else if (me.pos.y <= this.interiors.floorY()) {
          // Сошел до самого пола комнаты: лестница начинается с полу.
          me.pos.y = this.interiors.floorY();
          this.vy = 0;
          this.grounded = true;
          this.climb = null;
          audio.footstep(false);
        }
      }
    } else if (this.swimming) {
      // ... поверхность локального водоёма, а не всегда озера
      const swimLevel = surfaceY ?? LAKE.level;
      // Тело погружено: ноги под водой, голова над поверхностью.
      const floatY = swimLevel - SWIM_FEET;
      me.pos.y += (floatY - me.pos.y) * Math.min(1, dt * 4);
      this.vy *= 0.85; // гашение вертикальной скорости
      // Прыжок в воде = всплытие вверх
      if (this.keys.has('Space')) {
        this.vy = 3.5;
      }
      me.pos.y += this.vy * dt;
      // Не выше поверхности (иначе снова «ходим по воде») и не ниже дна:
      const lo = Math.max(effectiveGroundY + 0.2, swimLevel - 1.9);
      const hi = swimLevel - 0.7;
      me.pos.y = Math.min(Math.max(me.pos.y, lo), hi);
      this.grounded = false;
    } else if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      me.pos.y += this.vy * dt;
      if (me.pos.y <= effectiveGroundY) {
        me.pos.y = effectiveGroundY;
        this.vy = 0;
        this.grounded = true;
        audio.footstep(true);
      }
    } else if (me.pos.y > effectiveGroundY + 0.45) {
      // Шаг с края мезонина/моста: опоры под ногами больше нет, и вместо
      // мгновенного телепорта на землю ниже игрок уходит в падение.
      // Порог 0.45 перекликается с допуском ступеней: обычный рельеф
      // в этот предел не попадает, а падение с платы 2.6 м - да.
      this.grounded = false;
    } else {
      me.pos.y = effectiveGroundY;
      // Шаги: по мелкой воде — журчание, по земле — обычный шаг
      if (len > 0) {
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) {
          this.stepTimer = speed > 6 ? 0.26 : 0.38;
          if (wading) audio.waterStep();
          else audio.footstep(speed > 6);
        }
      }
    }
    me.moving = len > 0;
    // Высота тела для рига: физика (мост/вода/пол комнаты), не ландшафт
    this.feetY = me.pos.y;

    // ── Водные эффекты: всплеск + пузырьки ──
    const inWater = wading || this.swimming;
    if (inWater && !this.wasInWater) {
      // Вошли в воду — всплеск на поверхности того водоёма, где стоим
      this.splashMesh.visible = true;
      this.splashMesh.position.set(me.pos.x, (surfaceY ?? LAKE.level) + 0.1, me.pos.z);
      (this.splashMesh.material as THREE.MeshBasicMaterial).opacity = 0.7;
      this.splashMesh.scale.set(1, 1, 1);
      audio.splash();
    } else if (this.swimming) {
      // Пузырьки: каждые 0.4с при движении
      if (me.moving) {
        this.bubbleTimer -= dt;
        if (this.bubbleTimer <= 0) {
          this.bubbleTimer = 0.4;
          this.spawnBubble(me.pos.x, me.pos.y, me.pos.z);
        }
      }
    }
    // Анимация всплеска
    if (this.splashMesh.visible) {
      const mat = this.splashMesh.material as THREE.MeshBasicMaterial;
      mat.opacity -= dt * 1.2;
      this.splashMesh.scale.x += dt * 3;
      this.splashMesh.scale.z += dt * 3;
      if (mat.opacity <= 0) { this.splashMesh.visible = false; }
    }
    this.wasInWater = inWater;

    // ── Риги ──
    this.syncRigs();
    for (const [id, b] of this.rigs) {
      const isMe = id === me.id;
      let moving = false, spd = 0, dead = false;
      if (b.kind === 'player') {
        const p = this.entities.players.get(id)!;
        moving = p.moving; spd = p.moving ? 5.5 : 0;
        // Труп рисуется по состоянию из state, а не по классу оверлея:
        // экран смерти строит deathScreen, и 3D-слой не должен знать,
        // как он выглядит в DOM
        if (isMe) dead = session.dead;
      } else {
        const m = this.entities.monsters.get(id)!;
        moving = !m.deadAt && Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z) > 0.15;
        spd = moving ? 3.4 : 0;
        dead = m.deadAt > 0;
        if (this.targetRingTarget === id && !dead) {
          // Кольцо цели — над поверхностью воды, если монстр в воде,
          // иначе прямо под ногами (иначе кольцо уйдёт на дно вместе с ним)
          const rs = waterSurfaceY(m.pos.x, m.pos.z);
          this.targetRing.position.set(
            m.pos.x,
            rs !== null ? rs + 0.06 : b.rig.group.position.y + 0.06,
            m.pos.z,
          );
          this.targetRing.rotation.z = now / 900;
          // Имя цели над кольцом, проецируемое на экран
          const p = new THREE.Vector3(m.pos.x, m.pos.y + 2.6, m.pos.z).project(this.camera);
          const name = (m as any).nameRu ?? (m as any).name ?? '';
          this.targetNameEl.textContent = name;
          this.targetNameEl.style.display = '';
          this.targetNameEl.style.transform = `translate(-50%,-50%) translate(${(p.x * 0.5 + 0.5) * this.container.clientWidth}px, ${(-p.y * 0.5 + 0.5) * this.container.clientHeight}px)`;
          this.targetNameEl.style.opacity = String(Math.max(0, 1 - (p.z < -1 || p.z > 1 ? 1 : 0)));
        }
      }
// Персонаж развёрнут по направлению движения, а не лицом к камере.
//
// Возвращено по решению владельца: когда корпус всегда смотрит в камеру, шаг вперёд
// выглядит шагом назад, а поворот мыши раскручивает персонажа на месте. По этому же
// направлению считается и рывок, поэтому доворот должен совпадать с ним.
if (isMe && moving) {
  // ix и iz приходят в осях камеры, поэтому в мир их надо повернуть на yaw.
  // Направление то же, что у ходьбы и у рывка, - иначе персонаж побежит не туда.
  const dx = ix, dz = iz;
  const want = Math.atan2(dx * cos - dz * sin, -(dx * sin + dz * cos));
  b.rig.group.rotation.y +=
    shortestAngle(want - b.rig.group.rotation.y) * Math.min(1, dt * FACE_TURN_RATE);
}
      const mSwim = b.kind === 'monster' && (b.monsterSwim === true);
      b.rig.update(dt, {
        moving,
        speed: spd,
        grounded: b.kind === 'monster' ? !mSwim : this.grounded,
        crouch: isMe && this.crouch,
        block: isMe && this.block,
        dead,
        swimming: b.kind === 'monster' ? mSwim : (isMe && this.swimming),
      });
      if (b.kind === 'player' && isMe && this.attackAnim) b.rig.triggerAttack(this.attackStage);
    }
    this.attackAnim = false;

    // ── FX, кольцо цели ──
    this.syncFx(now);
    if (this.entities.targetId && this.targetRingTarget !== this.entities.targetId) {
      const m = this.entities.monsters.get(this.entities.targetId);
      this.targetRing.visible = !!m;
      this.targetRingTarget = m ? this.entities.targetId : null;
    } else if (!this.entities.targetId) {
      this.targetRing.visible = false;
      this.targetRingTarget = null;
      this.targetNameEl.style.display = 'none';
    }

    // ── Камера ──
    const swimCamOffset = this.swimming ? 0.4 : 0;
    const swimLevel = waterSurfaceY(me.pos.x, me.pos.z) ?? LAKE.level;
    const targetY = this.swimming
      ? me.pos.y + 1.15                       // взгляд — на торс пловца, не над головой
      : me.pos.y + 1.55 + (this.crouch ? -0.4 : 0);
    // Стена ограничивает ЦЕЛЬ, камера доезжает плавно (§369): без этого
    // упор в стену дёргал бы камеру кадром, а исчезновение стены —
    // выстреливал бы её обратно на полную дистанцию.
    const разрешено = this.разрешённаяДистанция(me.pos, this.dist);
    const скорость = 1 - Math.exp(-CAMERA_PULL_RATE * dt);
    this.distCurrent += (разрешено - this.distCurrent) * скорость;
    const camY = me.pos.y + 1.55 + swimCamOffset + Math.sin(this.pitch) * this.distCurrent;
    const camX = me.pos.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.distCurrent;
    const camZ = me.pos.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.distCurrent;
    // Страховка после сглаживания: коллайдеры — последняя инстанция, если
    // сэмплы всё же пропустили что-то между пробами.
    const cam = { x: camX, z: camZ };
    this.resolveCollisions(cam, CAMERA_R);
    const camGround = this.interiors.isInside()
      ? this.interiors.floorY()
      : pocketGroundY(cam.x, cam.z) ?? groundHeight(cam.x, cam.z);
    // Камера не ныряет: держим её над поверхностью воды в точке её стояния
    const camSurface = waterSurfaceY(cam.x, cam.z);
    const minY = Math.max(
      camGround + 0.5,
      camSurface !== null ? camSurface + 0.45 : -Infinity,
      this.swimming ? swimLevel + 0.6 : -Infinity,
    );
    this.camera.position.set(cam.x, Math.max(camY, minY), cam.z);
    this.camera.lookAt(me.pos.x, targetY, me.pos.z);
    // Крен поверх наведения. lookAt всегда ставит камеру ровно по горизонтали, поэтому
    // наклон горизонта возможен только после него, поворотом вокруг собственной оси
    // камеры. Порядок важен: наклон до lookAt стёрся бы наведением.
    if (this.roll !== 0) this.camera.rotateZ(this.roll);

    // ── Свет и время суток ──
    const dayI = 1 - night;
    this.sky.update(dt, now, this.clockHour / 24, { x: me.pos.x, z: me.pos.z });
    this.fauna.update(dt, now);
    // Звери вне фауны (вол у склада, лошадь конюшни): их миксеры тикают здесь.
    тикатьЗверей(dt);
    this.npcs.update(dt, now, this.camera.position, night);
    // Позиция игрока нужна горожанам, чтобы они его обходили, а не шли сквозь него.
    // night — тот же фактор, что у sky и roadTraffic: к ночи город расходится
    // по домам (§351).
    this.civilians.update(dt, now, me.pos.x, me.pos.z, night);
    // Смесители жителей: без update они стоят столбом, а сцена формально жива.
    this.townfolk.update(dt, me.pos.x, me.pos.z);
    updateCows(this.cowMixers, dt);
    // Стражи интерьеров на настоящих моделях: их миксеры живут в interiors,
    // кадр двигает их отсюда — тем же способом, что и коров.
    обновитьСтражей(dt);
    this.roadTraffic.update(dt, now, me.pos.x, me.pos.z, night);
    this.navigator.update(now, { x: me.pos.x, z: me.pos.z });

    // Солнце/луна по дуге: источник света следует за светилом.
    // Тучи гасят свет: в грозу мир не должен светиться как в полдень.
    const sunDir = this.sky.sunDirection;

    const useMoon = sunDir.y < 0.05;
    const lightDir = useMoon ? sunDir.clone().multiplyScalar(-1) : sunDir;

    // Марево в жару (§265): над горизонтом в полдень в ясную погоду. В пасмурок
    // и в дождь марева нет, ночью — тоже.
    //
    // Погода проверяется не по «ясно», а по «не жарко»: в мире чаще всего
    // стоит 'cloudy', и при нём марево должно быть — облака гасят солнце, но
    // не жар. Гасит его уже пасмурность неба.
    const неЖарко = this.currentWeather === 'rain' || this.currentWeather === 'storm'
      || this.currentWeather === 'snow' || this.currentWeather === 'sandstorm'
      || this.currentWeather === 'fog';
    const жар = неЖарко
      ? 0
      : Math.max(0, Math.min(1, (sunDir.y - 0.12) / 0.45)) * (1 - night) * (1 - this.sky.overcast);
    this.марево.update(dt, now, me.pos.x, me.pos.z, жар);
    // Пыль над дорогой (§268): она стоит только над полотном, а не над всей
    // пустыней, и появляется в тот же жар, что и марево.
    this.пыльДороги.update(dt, now, me.pos.x, me.pos.z, жар);
    // Дым из труб (§266): клуб из случайной трубы, и не чаще раза в полсекунды.
    if (дымныеТрубы.length) {
      this.дымТрубТаймер += dt;
      if (this.дымТрубТаймер >= 0.5) {
        this.дымТрубТаймер = 0;
        const труба = дымныеТрубы[Math.floor(Math.random() * дымныеТрубы.length)];
        // Дым из дальней трубы не видно: он ушёл бы в туман, а стоил бы кадр.
        if (Math.hypot(труба.x - me.pos.x, труба.z - me.pos.z) < 90) {
          this.дымТруб.всплеск(труба.x, труба.y, труба.z);
        }
      }
    }
    this.дымТруб.update(dt);
    // Тень от костра (§267): тень считается только рядом с костром — вдали
    // огонь всё равно не виден, а проход рендера теней стоил бы кадра.
    if (this.теньКостра) {
      const доКостра = Math.hypot(me.pos.x - CAMP.x, me.pos.z - CAMP.z);
      const рядом = доКостра < 40;
      this.теньКостра.castShadow = рядом;
      this.теньКостра.intensity = рядом ? 2.2 : 0;
    }

    // HDRI-окружение пересобирается само, когда небо изменилось достаточно.
    // Состояние собирается здесь — рядом с расчётом света, потому что оба
    // читают одно и то же: направление на солнце, глубину ночи и пасмурность.
    const состояниеНеба: SkyState = {
      sun: [sunDir.x, sunDir.y, sunDir.z],
      moon: [-sunDir.x, -sunDir.y, -sunDir.z],
      sunHeight: sunDir.y,
      night,
      overcast: this.sky.overcast,
      weather: this.currentWeather,
    };
    this.env.update(состояниеНеба, dt);

    // Вода. Материалов теперь четыре (озеро, пруд, река, море) плюс городская
    // мелкая вода, и у каждого свой уровень и своя глубина, поэтому обход идёт
    // по всем. Раньше был один общий материал с уровнем озера: море получало
    // чужие -3.2 м глубины и рисовалось цветом мелкой лагуны.
    //
    // Время у всех одно и то же - иначе волны на стыке тел разошлись бы фазой.
    this.waterTime += dt;
    const chop = chopFor(this.currentWeather);
    // Фонари на воде (§256): вода не знала про точечные источники, и пруд рядом
    // с горящим фонарём оставался чёрным. Ближние к камере лампы (восемь) идут
    // в шейдер равномерками: до шейдера доходит только то, что видно.
    const лампыУВоды: { d: number; light: THREE.PointLight }[] = [];
    for (const t of this.torches) {
      лампыУВоды.push({ d: t.light.position.distanceTo(this.camera.position), light: t.light });
    }
    for (const l of this.lamps) {
      лампыУВоды.push({ d: l.light.position.distanceTo(this.camera.position), light: l.light });
    }
    лампыУВоды.sort((a, b) => a.d - b.d);
    const ближние = лампыУВоды.slice(0, 8);
    for (const mat of waterMaterials) {
      const u = mat.uniforms;
      u.uTime.value = this.waterTime;
      u.uChop.value = chop;
      u.uSunDir.value.copy(lightDir).normalize();
      u.uSunColor.value.copy(this.sun.color);
      u.uSkyColor.value.copy(this.sky.horizonColor);
      u.uFogColor.value.copy(this.sky.horizonColor);
      u.uLampCount.value = ближние.length;
      for (let i = 0; i < ближние.length; i++) {
        u.uLampPos.value[i].copy(ближние[i].light.position);
        u.uLampColor.value[i]
          .copy(ближние[i].light.color)
          .multiplyScalar(Math.max(ближние[i].light.intensity, 0) * 0.6);
      }
    }
    // Сетка моря едет за камерой: мелкая область обязана быть под игроком, а не
    // в мировом нуле, - иначе, отойдя на лодке вдоль берега, он оказывается в
    // крупных треугольниках, где волну рисовать нечем.
    followSeaToCamera(this.camera.position.x);
    // Баланс света (замерян по кадрам суток, §221): днём почти всё светит
    // солнце (~3.2), полусфера лишь подсвечивает тени (~0.13), а HDRI-небо
    // даёт мягкие отражения (~0.25). Раньше полусфера и env давали 0.83 /
    // 0.46 — кадр «плыл» пасмурной серостью даже в ясный полдень.
    // Ночь заметно темнее сумерек: луна 0.12, а не 0.32.
    const dim = 1 - this.sky.overcast * 0.45;
    this.sun.intensity = (useMoon ? 0.12 : 0.25 + dayI * 2.95) * dim;
    this.hemi.intensity = (0.05 + dayI * 0.08) * (1 - this.sky.overcast * 0.3);
    this.sun.color.setHex(useMoon ? 0x9db4e8 : night > 0.4 ? 0xffc98a : 0xffe8c0);
    if (this.sky.overcast > 0.3) {
      // В дождь и бурю свет холоднее — тучи отражают серое небо
      this.sun.color.lerp(new THREE.Color(0xb8c4d2), (this.sky.overcast - 0.3) / 0.7 * 0.5);
    }
    this.sun.position.set(
      me.pos.x + lightDir.x * 120,
      Math.max(24, lightDir.y * 120),
      me.pos.z + lightDir.z * 120,
    );
    this.sun.target.position.set(me.pos.x, 0, me.pos.z);
    // Туман под цвет горизонта — сцена сливается с куполом
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.sky.horizonColor);
    // Гомон базара — только в городе
    const inCity = Math.hypot(me.pos.x - CITY.x, me.pos.z - CITY.z) < CITY.radius + 12;
    if (inCity !== this.lastInCity) {
      this.lastInCity = inCity;
      audio.setCity(inCity);
    }
    // Водопад: прокрутка текстуры струй
    const waterfall = this.scene.getObjectByName('waterfall');
    if (waterfall) {
      const mat = (waterfall as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.offset.y = (mat.map.offset.y - dt * 0.55) % 1;
    }
    // Факелы и костёр
    // Погода обновляется после записи цвета тумана из неба,
    // чтобы песчаная буря могла приглушить дальность поверх.
    this.weather.update(dt, me.pos.x, me.pos.z, me.pos.y, this.lastInCity);
    const torchOn = 0.35 + night * 0.65;
    for (const t of this.torches) {
      t.light.intensity = t.base * torchOn * (0.86 + Math.sin(now / 90 + t.phase) * 0.14);
    }
    // Свет в проёмах и фонари горят постоянно: проход закрыт от солнца, и
    // днём там темно так же, как ночью.
    for (const l of this.lamps) {
      l.light.intensity = l.base;
    }
    for (const f of this.flames) {
      f.scale.y = 1 + Math.sin(now / 70) * 0.18;
    }
    // Дым над огнями (§255): клуб выходит из огня и уходит вверх.
    for (const д of this.дым) {
      д.таймер += dt;
      if (д.таймер >= 0.14) {
        д.таймер = 0;
        д.дым.всплеск(д.x, д.y, д.z);
      }
      д.дым.update(dt);
    }
    // Чайки слетают с причала, когда игрок подходит (§278): живая птица от
    // человека улетает, а каменная — нет.
    for (const ч of чайкиНаПричале) {
      ч.t += dt;
      const близко = Math.hypot(ч.x - me.pos.x, ч.z - me.pos.z) < 5;
      if (ч.состояние === 0 && близко) {
        // Взлёт: вверх и в сторону от игрока. Сторона — по детерминированному
        // генератору, а не случайно: после перезагрузки страницы чайка должна
        // улететь так же.
        const к = hash2(Math.round(ч.x), Math.round(ч.z));
        const угол = Math.atan2(ч.z - me.pos.z, ч.x - me.pos.x) + (к - 0.5) * 1.4;
        ч.состояние = 1;
        ч.t = 0;
        ч.группа.userData.угол = угол;
      }
      if (ч.состояние === 1) {
        // Поднимается и уходит: за полторы секунды — метр вверх и три в сторону.
        const k = Math.min(1, ч.t / 1.5);
        const угол = ч.группа.userData.угол as number;
        ч.группа.position.set(
          ч.base.x + Math.cos(угол) * 3 * k,
          ч.base.y + 1.2 * k,
          ч.base.z + Math.sin(угол) * 3 * k,
        );
        ч.группа.rotation.y = угол + Math.PI;
        if (ч.t > 1.5) { ч.состояние = 2; ч.t = 0; }
      } else if (ч.состояние === 2) {
        // Улетел и ждёт, пока отойдёшь.
        if (ч.t > 7) { ч.состояние = 3; ч.t = 0; }
      } else if (ч.состояние === 3) {
        // Возвращается на место.
        const k = Math.max(0, 1 - ч.t / 2);
        const угол = ч.группа.userData.угол as number;
        ч.группа.position.set(
          ч.base.x + Math.cos(угол) * 3 * k,
          ч.base.y + 1.2 * k,
          ч.base.z + Math.sin(угол) * 3 * k,
        );
        if (ч.t > 2) {
          ч.состояние = 0;
          ч.группа.position.copy(ч.base);
        }
      }
    }
    // Лодки у причала качаются вместе с водой (§277).
    const лодкиНаВоде: { x: number; y: number; z: number }[] = [];
    for (const л of лодкиУПира) {
      л.группа.position.y = л.y + Math.sin(now * 0.85 + л.фаза) * 0.09;
      л.группа.rotation.z = Math.sin(now * 0.62 + л.фаза) * 0.035;
      л.группа.rotation.x = Math.sin(now * 0.47 + л.фаза * 1.7) * 0.02;
      // Мировая точка лодки — для ряби (§280).
      const мир = л.группа.getWorldPosition(new THREE.Vector3());
      лодкиНаВоде.push({ x: мир.x, y: мир.y - 0.2, z: мир.z });
    }
    // Рябь от лодок (§280): от борта расходятся круги.
    this.рябь.update(dt, now, лодкиНаВоде);
    // Пыльные вихри (§257): бродят по песку рядом с игроком.
    this.вихри.update(dt, now, me.pos.x, me.pos.z);
    // Птицы (§259): стая облетает игрока по дуге.
    this.птицы.update(dt, now, me.pos.x, me.pos.z, night, sunDir);
    // Мокрая земля (§261) и снег на ней (§262): в дождь песок и мостовая
    // темнеют и блестят, после дождя ещё некоторое время мокрые; в снег земля
    // белеет, и снег лежит на ней долго — дольше, чем сохнет вода.
    const идётДождь = this.currentWeather === 'rain' || this.currentWeather === 'storm';
    if (идётДождь) this.мокрота = Math.min(1, this.мокрота + dt * 0.7);
    else this.мокрота = Math.max(0, this.мокрота - dt * 0.05);
    const идётСнег = this.currentWeather === 'snow';
    if (идётСнег) this.снег = Math.min(1, this.снег + dt * 0.25);
    else this.снег = Math.max(0, this.снег - dt * 0.02);
    // Пыль от бури ложится на землю (§283): в песчаной буре земля не своя, а
    // рыжая от пыли. Пыль набирается не мгновенно и сходит не сразу.
    const пылит = this.currentWeather === 'sandstorm';
    if (пылит) this.пыль = Math.min(1, this.пыль + dt * 0.5);
    else this.пыль = Math.max(0, this.пыль - dt * 0.25);
    setGroundState(this.мокрота, this.снег, this.пыль);
    // Лужи на площади (§264) и вода в колеях дороги, лужи в пригороде (§269).
    // Дождь идёт — по лужам идут круги от капель (§285), а поверхность воды
    // перестаёт быть зеркалом.
    const дождь = this.currentWeather === 'rain' ? 1 : this.currentWeather === 'storm' ? 0.75 : 0;
    setPuddles(this.мокрота, дождь);
    this.рябьЛуж.update(dt, дождь, this.мокрота, me.pos.x, me.pos.z);
    this.водаДороги.update(dt, now, me.pos.x, me.pos.z, this.мокрота);
    // Отблески фонарей на мокрой земле (§276): лампы рядом с игроком.
    const лампыДляБлеска: { x: number; y: number; z: number }[] = [];
    for (const t of this.torches) {
      лампыДляБлеска.push({ x: t.light.position.x, y: t.light.position.y, z: t.light.position.z });
    }
    for (const l of this.lamps) {
      лампыДляБлеска.push({ x: l.light.position.x, y: l.light.position.y, z: l.light.position.z });
    }
    this.отблески.update(dt, now, me.pos.x, me.pos.z, this.мокрота, лампыДляБлеска);
    // Следы караванов (§270): на мокром песке проступают, на сухом — едва.
    this.следыКараванов.update(dt, now, me.pos.x, me.pos.z, this.мокрота);
    // Снег на зелени и крышах (§263): земля белая, а кроны и черепица ещё
    // летние — так снегопад читается наполовину декорацией.
    setSnowOnSurfaces(this.снег);
    // Ветер качает зелень (§258): кусты, трава и кроны деревьев стояли
    // неподвижно, хотя ветер в мире есть.
    //
    // СИЛА ВЕТРА ЗАВИСИТ ОТ ПОГОДЫ (§281). Раньше в буре зелень качалась
    // вдвое сильнее, а в штиль — так же, как в буре: ветер в мире один, и
    // зелень его не чувствовала. Теперь в буре зелень мечется, в штиль еле
    // заметно, а порывы идут чаще.
    const ветер = ветерСилы(this.currentWeather);
    for (const к of качающиеся) {
      // Только рядом с камерой: за горизонтом качание не видно, а список
      // растений — на весь мир.
      const dx = к.x - this.camera.position.x;
      const dz = к.z - this.camera.position.z;
      if (dx * dx + dz * dz > 4900) continue;
      // Чем сильнее ветер, тем чаще порывы.
      const быстро = 900 / ветер;
      const порыв = Math.sin(now / быстро + к.фаза) * 0.6
        + Math.sin(now / (быстро * 0.48) + к.фаза * 2.3) * 0.4;
      const сила = к.амплитуда * ветер * (0.45 + 0.55 * порыв);
      // Наклон по ветру: ось поворота поперёк ветра.
      const наклон = new THREE.Euler(
        к.база.x + Math.sin(НАПРАВЛЕНИЕ_ВЕТРА) * сила,
        к.база.y,
        к.база.z + Math.cos(НАПРАВЛЕНИЕ_ВЕТРА) * сила,
      );
      if (к.матрицы) {
        // Инстансное поле (InstancedMesh): наклон пишем в матрицу конкретного
        // экземпляра — объект один на все, а трясётся надо каждое дерево.
        const меш = к.obj as THREE.InstancedMesh;
        const м = к.матрицы[0];
        const позиция = new THREE.Vector3().setFromMatrixPosition(м);
        const поворот = new THREE.Quaternion().setFromEuler(наклон);
        const масштаб = new THREE.Vector3().setFromMatrixScale(м);
        const индекс = к.индекс ?? 0;
        меш.setMatrixAt(индекс, new THREE.Matrix4().compose(позиция, поворот, масштаб));
        меш.instanceMatrix.needsUpdate = true;
      } else {
        к.obj.rotation.set(
          к.база.x + Math.sin(НАПРАВЛЕНИЕ_ВЕТРА) * сила,
          к.база.y,
          к.база.z + Math.cos(НАПРАВЛЕНИЕ_ВЕТРА) * сила,
        );
      }
    }
    // Огни фонарей наклоняются по ветру (§282): в бурю огонь в фонаре
    // колышется, и ночной город выдаёт погоду.
    for (const о of огниФонарей) {
      const фаза = о.base.x * 0.7 + о.base.z * 1.3;
      const наклон = Math.sin(now / 620 + фаза) * 0.55 + Math.sin(now / 260 + фаза * 2.1) * 0.45;
      const сдвиг = наклон * ветер * 0.06;
      о.mesh.position.set(
        о.base.x + Math.sin(НАПРАВЛЕНИЕ_ВЕТРА) * сдвиг,
        о.base.y,
        о.base.z + Math.cos(НАПРАВЛЕНИЕ_ВЕТРА) * сдвиг,
      );
      о.mesh.rotation.z = -Math.sin(НАПРАВЛЕНИЕ_ВЕТРА) * наклон * ветер * 0.09;
      о.mesh.rotation.x = Math.cos(НАПРАВЛЕНИЕ_ВЕТРА) * наклон * ветер * 0.09;
    }

    if (this.attackCd > 0) this.attackCd -= dt;
    // Новые материалы (монстры, лошади, караваны) прошиваем пачкой раз в
    // ПЕРИОД_ПРОШИВКИ секунд: см. patchWorldMaterials.
    this.patchTimer += dt;
    if (this.patchTimer >= ПЕРИОД_ПРОШИВКИ) {
      this.patchTimer = 0;
      this.patchWorldMaterials(false);
    }
    this.composer.render();
  }

  private attackAnim = false;

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.ro?.disconnect();
    this.ro = null;
    if (document.pointerLockElement) document.exitPointerLock();
    for (const [, b] of this.rigs) b.rig.dispose();
    this.rigs.clear();
    this.sky?.dispose();
    // Окружение — после неба и до рендерера: его dispose() обращается к
    // генератору PMREM, а тот живёт на рендерере.
    this.env?.dispose();
    this.fauna?.dispose();
    this.npcs?.dispose();
    for (const д of this.дым) д.дым.dispose();
    this.вихри?.dispose();
    this.отблески?.dispose();
    this.рябь?.dispose();
    this.марево?.dispose();
    this.пыльДороги?.dispose();
    this.водаДороги?.dispose();
    this.следыКараванов?.dispose();
    this.дымТруб?.dispose();
    this.птицы?.dispose();
    this.civilians?.dispose();
    this.townfolk?.dispose();
    this.weather?.dispose();
    this.interiors?.dispose();
    this.navigator?.dispose();
    // Дорожное движение тоже нужно снять. Его `dispose()` был написан, но не
    // вызывался ниоткуда: караваны оставались в старой сцене вместе со своей
    // геометрией, материалами и текстурами. При этом `makePerson` создаёт
    // СВОЙ MeshStandardMaterial на каждый караван (роба, кожа, шляпа), так
    // что на каждый вход в мир уезжала пачка уникальных материалов.
    this.roadTraffic?.dispose();
    // Миксеры анимации коров — двухуровневые ссылки на загруженные клипы;
    // без stop() анимации продолжают крутиться для снятых сцены моделей.
    for (const mx of this.cowMixers) mx.stopAllAction();
    // SSAO: освобождаем рендер-таргеты композитора
    this.composer?.dispose();
    this.deferred?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.fxLayer?.remove();
    this.crosshair?.remove();
  }
}

function shortestAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
