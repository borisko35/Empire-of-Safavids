// Настоящий персонаж: скелетная модель из GLB вместо палочек.
//
// Почему отдельным путём, а не правкой rig.ts. Процедурный риг собирается из
// коробок и работает всегда: он нужен толпе (30 мирных жителей), демонам, ящерам и
// как запасной вариант. Настоящая модель нужна там, где игрок смотрит в упор, и
// только там. Поэтому новый путь возвращает тот же интерфейс Rig, а процедурный
// остаётся запасным: если файл не пришёл или не разобрался, игрок получает прежний
// силуэт, а не пустоту.
//
// Числа здесь измерены, а не взяты из головы:
//   TARGET_HEIGHT 1.9 — высота нынешнего процедурного рига (rig.ts: ноги 0.95,
//     торс 0.98, голова 1.66, череп 1.78 плюс тюрбан);
//   масштаб приводится по габаритам самой модели через Box3, потому что модели
//   разного происхождения: у четырёх высота 1.76-1.78, а у guard-qizilbash 3.78 —
//     вдвое больше, и без нормализации страж был бы вдвое выше остальных.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildShield, buildWeapon, type Rig, type RigPose, type Weapon } from './rig';

/** Куда сложены модели. Тот же префикс, что у бандла игры. */
const MODEL_BASE = '/game/models/';
/** Декодер Draco лежит рядом: без него сжатая геометрия не грузится. */
const DRACO_BASE = '/game/draco/';
/** Во что должна вырасти любая загруженная модель, в единицах игрового мира. */
const TARGET_HEIGHT = 1.9;

/**
 * Класс игрока → файл модели.
 *
 * Совпадение один в один, а не подбор: пять классов в rig.ts названы ровно так же,
 * как пять моделей из папки Characters — qizilbash, sufi_mystic, persian_archer,
 * bazaar_merchant, court_diplomat. Ни одна из этих моделей в игре пока не
 * использовалась, они ждали именно этого.
 */
const PLAYER_MODEL: Record<string, string> = {
  qizilbash: 'guard-qizilbash',
  sufi_mystic: 'sufi-mystic',
  persian_archer: 'archer-of-persian',
  bazaar_merchant: 'market-vendor',
  court_diplomat: 'court-diplomat',
};

/** Кости кистей Mixamo: к ним крепится снаряжение. */
const BONE_RIGHT_HAND = 'mixamorig:RightHand';
const BONE_LEFT_HAND = 'mixamorig:LeftHand';

/**
 * Клипы под состояния RigPose.
 *
 * НЕПОЛНОТА, НАЗВАННАЯ ЧЕСТНО. В наборе восемнадцать клипов, и в них нет блока,
 * плавания и смерти. Здесь они не выдуманы:
 *   - блок держит текущий клип: руки не поднимаются, и это видимое отсутствие;
 *   - плавание стоит на месте (idle);
 *   - смерть играет падение `jumping-down` как временную замену.
 * Настоящих клипов блока, плавания и смерти в наборе нет; это записано в ROADMAP,
 * и молча подменять их нечем.
 *
 * Четыре клипа присевания (вперёд, назад, влево, вправо) не используются: в RigPose
 * нет направления движения, только флаг и скорость, поэтому назад и вбок выбрать
 * нельзя. Взяты только вперёд и покой.
 */
const CLIP_IDLE = 'standing-idle';
const CLIP_WALK = 'walking';
const CLIP_RUN = 'running';
const CLIP_CROUCH_IDLE = 'crouch-idle';
const CLIP_CROUCH_FWD = 'crouch-walk-forward';
const CLIP_ATTACK = 'sword-shield-attack';
const CLIP_JUMP = 'jumping';

/**
 * Клипы, добавленные после того, как владелец докачал недостающее.
 *
 * Смерть и уклонение играются один раз: у клипа смерти раньше не было, и вместо неё
 * шёл `jumping-down`, то есть персонаж падал, но не умирал. Теперь падение настоящее.
 */
const CLIP_DEATH = 'death-fall-forward';
const CLIP_DEATH_BACK = 'death-fall-back';
const CLIP_BLOCK = 'block';
const CLIP_BLOCK_CROUCH = 'block-crouch';
const CLIP_BLOCK_CROUCH_IDLE = 'block-crouch-idle';
const CLIP_SWIM = 'swim';
const CLIP_SWIM_IDLE = 'swim-idle';
const CLIP_DODGE = {
  forward: 'dodge-forward',
  back: 'dodge-back',
  left: 'dodge-left',
  right: 'dodge-right',
} as const;

/**
 * Эти клипы проигрываются один раз и замирают на последнем кадре.
 *
 * Прежний переключатель всегда ставил LoopRepeat, и персонаж после смерти
 * падал бы заново каждые несколько секунд — мигающий труп. Смерть, уклонение и
 * атака сюда и отнесены.
 */
const ОДИН_РАЗ = new Set<string>([
  CLIP_DEATH,
  CLIP_DEATH_BACK,
  CLIP_ATTACK,
  ...Object.values(CLIP_DODGE),
]);

/** С какой скорости идёт бег, а не шаг. Порог взят по длинам клипов. */
const RUN_THRESHOLD = 3.4;

/**
 * Модель не крутится: Mixamo, как и glTF, смотрит в +Z, и у процедурного рига лицо
 * тоже в +Z (борода и глаза стоят на положительном z в rig.ts, и там же написано
 * «персонаж смотрит вдоль +Z»). Это единственное место, где значение выбрано
 * соглашением, а не измерено: глазами в игре его нужно подтвердить один раз.
 */
const MODEL_ROTATION_Y = 0;

/** Длина перехода между клипами, секунды. */
const CROSSFADE = 0.18;

// ── Загрузчики и кеш ────────────────────────────────────────────────────────────

let общийЗагрузчик: GLTFLoader | null = null;

function загрузчик(): GLTFLoader | null {
  if (общийЗагрузчик) return общийЗагрузчик;
  try {
    // DRACOLoader остаётся жив внутри загрузчика: он сам себя не выгружает, а без
    // него геометрия со сжатием не разбирается.
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_BASE);
    const l = new GLTFLoader();
    l.setDRACOLoader(draco);
    общийЗагрузчик = l;
    return l;
  } catch (e) {
    // Нет загрузчика — игра продолжает работать на процедурных ригах.
    console.warn('[rig] gltf loader unavailable', e);
    return null;
  }
}

/**
 * Разобранная сцена хранится один раз на файл и клонируется под каждого.
 *
 * Клонируются и материалы: у выдвоенной сцены они общие, и покраска брони одного
 * игрока перекрасила бы всех, кто выбрал тот же класс.
 */
const сцены = new Map<string, Promise<THREE.Group | null>>();
const клипы = new Map<string, Promise<THREE.AnimationClip | null>>();

function загрузитьСцену(имя: string): Promise<THREE.Group | null> {
  const готово = сцены.get(имя);
  if (готово) return готово;
  const задача = new Promise<THREE.Group | null>((готово) => {
    const l = загрузчик();
    if (!l) { готово(null); return; }
    l.load(
      `${MODEL_BASE}${имя}.glb`,
      (gltf) => готово((gltf.scene as THREE.Group) ?? null),
      undefined,
      // Нет файла или сети: это не ошибка игры, а повод остаться на палочках.
      () => готово(null),
    );
  });
  сцены.set(имя, задача);
  return задача;
}

function загрузитьКлип(имя: string): Promise<THREE.AnimationClip | null> {
  const готово = клипы.get(имя);
  if (готово) return готово;
  const задача = new Promise<THREE.AnimationClip | null>((готово) => {
    const l = загрузчик();
    if (!l) { готово(null); return; }
    l.load(
      `${MODEL_BASE}${имя}.glb`,
      (gltf) => готово((gltf.animations && gltf.animations[0]) ?? null),
      undefined,
      () => готово(null),
    );
  });
  клипы.set(имя, задача);
  return задача;
}

/** Приводит модель к игровому масштабу и ставит ноги на нуль. */
function подогнать(сцена: THREE.Group): THREE.Group {
  const обёртка = new THREE.Group();
  const габариты = new THREE.Box3().setFromObject(сцена);
  const высота = габариты.max.y - габариты.min.y;
  if (высота > 0.001) {
    const k = TARGET_HEIGHT / высота;
    сцена.scale.setScalar(k);
    // Сдвиг делаем после масштабирования, иначе смещение умножится ещё раз.
    сцена.position.y = -габариты.min.y * k;
  }
  сцена.rotation.y = MODEL_ROTATION_Y;
  сцена.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const материалы = (Array.isArray(m.material) ? m.material : [m.material]).map(
      (mat) => mat.clone(),
    );
    m.material = Array.isArray(m.material) ? материалы : материалы[0];
  });
  обёртка.add(сцена);
  return обёртка;
}

// ── Риг на настоящей модели ─────────────────────────────────────────────────────

export class RealRig implements Rig {
  readonly group: THREE.Group;
  private readonly mixer: THREE.AnimationMixer;
  private readonly сцена: THREE.Group;
  private текущийКлип: THREE.AnimationClip | null = null;
  private текущееИмя = '';
  /** Чего мы хотим сейчас: клип мог ещё доехать, и тогда включится только он. */
  private желаемое = '';
  private оружие: THREE.Group | null = null;
  private щит: THREE.Group | null = null;
  private оружиеВидно = false;
  private щитВиден = false;
  private видОружия: Weapon = 'sword';
  /** Исходные цвета материалов: без них снятие брони не вернуло бы вид. */
  private исходныеЦвета = new Map<THREE.Material, number>();

  constructor(сцена: THREE.Group, первыйКлип: THREE.AnimationClip) {
    this.сцена = new THREE.Group();
    this.сцена.add(подогнать(сцена));
    this.group = this.сцена;
    this.mixer = new THREE.AnimationMixer(this.group);

    this.сцена.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const материалы = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of материалы) {
        const цветный = mat as THREE.MeshStandardMaterial;
        if (цветный && цветный.color) this.исходныеЦвета.set(mat, цветный.color.getHex());
      }
    });

    this.включить(первыйКлип.name || CLIP_IDLE, первыйКлип);
  }

  /**
   * Переключает на клип. Первый переход — без наложения, дальше с наложением.
   *
   * Клип из ОДИН_РАЗ ставится на один проход и замирает: без этого персонаж после
   * смерти начинал бы падать заново каждые несколько секунд.
   */
  private включить(имя: string, клип: THREE.AnimationClip): void {
    if (this.текущееИмя === имя) return;
    const прежний = this.текущийКлип;
    const действие = this.mixer.clipAction(клип);
    const одноразовый = ОДИН_РАЗ.has(имя);
    действие.enabled = true;
    if (одноразовый) {
      действие.reset().setLoop(THREE.LoopOnce, 1).play();
      // clampWhenFinished держит последний кадр: без него поза сбрасывается в нули
      // и персонаж после смерти дёргается стойкой.
      действие.clampWhenFinished = true;
    } else {
      действие.clampWhenFinished = false;
      действие.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    }
    if (прежний && прежний !== клип) {
      действие.crossFadeFrom(this.mixer.clipAction(прежний), CROSSFADE, false);
    }
    this.текущийКлип = клип;
    this.текущееИмя = имя;
  }

  /**
   * Просит клип и включает его, если он уже доехал; иначе читает файл.
   *
   * Отдельно от `update` — потому что там нет ни сети, ни промиса.
   */
  private хочу(имя: string): void {
    if (имя === this.желаемое) return;
    this.желаемое = имя;
    if (имя === this.текущееИмя) return;
    void загрузитьКлип(имя).then((клип) => {
      // Клип мог прийти уже после смены состояния: включаем только если он всё ещё
      // нужен, иначе персонаж дёргается назад к устаревшему.
      if (!клип || имя !== this.желаемое) return;
      this.включить(имя, клип);
    });
  }

  update(dt: number, p: RigPose): void {
    // Длинный кадр (вкладка была свёрнута) не должен дёргать позу рывком.
    this.mixer.update(Math.min(Math.max(dt, 0), 0.1));
    if (p.dead) { this.хочу(CLIP_DEATH); return; }
    // Плавание: на месте и в движении разные клипы, а не один и тот же.
    if (p.swimming) { this.хочу(p.moving ? CLIP_SWIM : CLIP_SWIM_IDLE); return; }
    if (!p.grounded) { this.хочу(CLIP_JUMP); return; }
    if (p.crouch) {
      // Блок в приседе — отдельные клипы: стоять с щитом в полный рост и в
      // приседе выглядит по-разному, и раньше блок просто держал текущий клип.
      if (p.block) { this.хочу(p.moving ? CLIP_BLOCK_CROUCH : CLIP_BLOCK_CROUCH_IDLE); return; }
      this.хочу(p.moving ? CLIP_CROUCH_FWD : CLIP_CROUCH_IDLE);
      return;
    }
    if (p.block) { this.хочу(CLIP_BLOCK); return; }
    if (p.moving) { this.хочу(p.speed > RUN_THRESHOLD ? CLIP_RUN : CLIP_WALK); return; }
    this.хочу(CLIP_IDLE);
  }

  /**
   * Уклонение: рывок в сторону, из которой пришёл удар по ногам.
   *
   * Направление передаётся снаружи, потому что риг не знает, куда смотрит камера.
   * Клип одноразовый: рывок длится доли секунды, и повторять его в цикле нельзя.
   */
  triggerDodge(direction: keyof typeof CLIP_DODGE): void {
    const имя = CLIP_DODGE[direction];
    void загрузитьКлип(имя).then((клип) => {
      if (!клип || !this.group.parent) return;
      // Переход не делаем: рывок резкий, и наложение в 0,18 с съело бы его начало.
      this.включить(имя, клип);
    });
  }

  triggerAttack(): void {
    void загрузитьКлип(CLIP_ATTACK).then((клип) => {
      if (!клип || !this.group.parent) return;
      // Через включить(), а не напрямую: одноразовость и замирание на последнем
      // кадре задаются там, иначе атака осталась бы вечно в крайней позе.
      this.включить(CLIP_ATTACK, клип);
    });
  }

  equipWeapon(visible: boolean): void {
    this.оружиеВидно = visible;
    if (!this.оружие) {
      const кость = this.сцена.getObjectByName(BONE_RIGHT_HAND);
      if (!кость) return;
      this.оружие = buildWeapon(this.видОружия);
      // Кисть в модели Mixamo повёрнута так же, как в процедурном риге, где
      // рукоять тоже уходит вниз, поэтому доворот не подбирался вслепую.
      this.оружие.position.set(0, -0.05, 0.02);
      кость.add(this.оружие);
    }
    this.оружие.visible = visible;
  }

  equipShield(visible: boolean): void {
    this.щитВиден = visible;
    if (!this.щит) {
      const кость = this.сцена.getObjectByName(BONE_LEFT_HAND);
      if (!кость) return;
      // Тот же щит, что и у процедурного рига: он вынесен в buildShield, чтобы
      // не было второй копии.
      this.щит = buildShield(0.2, [0, -0.05, 0.06]);
      this.щит.scale.setScalar(0.75);
      кость.add(this.щит);
    }
    this.щит.visible = visible;
  }

  isWeaponEquipped(): boolean { return this.оружиеВидно; }
  isShieldEquipped(): boolean { return this.щитВиден; }

  setArmorTint(color: number | null): void {
    for (const [mat, исходный] of this.исходныеЦвета) {
      const цветный = mat as THREE.MeshStandardMaterial;
      if (!цветный.color) continue;
      цветный.color.setHex(color === null ? исходный : color);
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.group);
    // Геометрия и текстуры общие из кеша: их dispose уронил бы всех, кто грузит ту
    // же модель. Освобождаем только клоны материалов.
    for (const mat of this.исходныеЦвета.keys()) mat.dispose();
    this.исходныеЦвета.clear();
    this.group.removeFromParent();
  }
}

/**
 * Настоящий риг игрока, если модель есть и первый клип дошёл.
 *
 * null означает «остаться на процедурном»: вызывающий код ничего не чинит, он
 * просто продолжает рисовать палочки.
 */
export async function loadRealPlayerRig(charClass: string): Promise<RealRig | null> {
  const имя = PLAYER_MODEL[charClass];
  if (!имя) return null;
  const [сцена, idle] = await Promise.all([
    загрузитьСцену(имя),
    загрузитьКлип(CLIP_IDLE),
  ]);
  // Подмена происходит только когда есть и тело, и покой: иначе игрок на секунду
  // увидел бы модель в позе покоя скелета, то есть с расставленными руками.
  if (!сцена || !idle) return null;
  try {
    const копия = cloneSkeleton(сцена) as THREE.Group;
    return new RealRig(копия, idle);
  } catch (e) {
    console.warn('[rig] skeleton clone failed', e);
    return null;
  }
}

/** Сколько классов игрока имеют настоящую модель. */
export const МОДЕЛЕЙ_В_КЛАССЕ = Object.keys(PLAYER_MODEL).length;