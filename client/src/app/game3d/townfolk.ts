// ============================================================
// Жители городов — Empire of Safavids
// ============================================================
// Настоящие модели вместо фигурок из примитивов: по трое в Тебризе, Ширазе
// и Месопотамии. В столице (Исфахан) горожане уже есть — там их тридцать
// и они ходят, разговаривают и толкаются (civilians.ts); эти трое стоят в
// трёх других городах, где до сих пор было пусто.
//
// ЧТО ЗДЕСЬ ВАЖНО.
// 1. Модель приезжает отдельным файлом, а движение — отдельным клипом.
//    Игра так уже умеет: realRig грузит клипы отдельными файлами и цепляет
//    их к ригу по именам костей. Кости у жителя и у клипов одни и те же
//    (mixamorig:*), поэтому вшивать анимацию в модель не пришлось — в
//    исходнике она одна, и это поза привязки: T-pose, все 250 кадров
//    одинаковые. Такую в город ставить нельзя.
// 2. Скелет клонируется через SkeletonUtils, а не Object3D.clone:
//    обычный клон делит Skeleton с оригиналом, и все девять фигур стали бы
//    двигаться от одной кости.
// 3. Один AnimationMixer на город, а не на фигуру: дорожки клипа ищут кости
//    по именам внутри поддерева, поэтому одно действие ведёт троих сразу.
//    Фаза у города своя, иначе все девять дышали бы в один такт.

import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { clone as копияСкелета } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { REGION_TOWNS, addCollider, groundHeight } from './terrain';
import { подогнать } from './realRig';

/**
 * Модели жителей, по очереди на каждую фигуру.
 *
 * Три модели из набора Mixamo: у них одинаковые 65 костей и совпадают
 * имена, поэтому клип один на всех. Списком, а не одной строкой — иначе все
 * девять фигур в трёх городах выглядели бы как девять копий, а города
 * различаются только тем, где стоят.
 *
 * Моделей ровно столько же, сколько жителей в городе: чередование идёт по
 * индексу точки, и при трёх моделях и трёх точках каждый город получает все
 * три. Добавили четвёртую модель — в городах начнут попарно совпадать, и это
 * нормально.
 */
const МОДЕЛИ = ['citizen', 'citizen2', 'citizen3'] as const;
const КЛИП = 'standing-idle';
const БАЗА = '/game/models/';

/**
 * Радиус коллайдера фигуры.
 *
 * 0.45 — по ширине плеч плюс запас на то, чтобы игрок не прижимался к жителю
 * вплотную. Ровно 0.5, как у процедурных горожан столицы, не берём: у этой
 * модели реальные плечи шире примитива.
 */
const СТОИТ_НА = 0.45;

/**
 * Доля радиуса города, на которой стоят жители.
 *
 * 0.42 — кольцо между торговыми рядами (они стоят на 0.3 радиуса по осям) и
 * домами (те на 0.58 и дальше). На 0.3 житель встал бы в ряд, на 0.58+ — в дом.
 */
const КОЛЬЦО = 0.42;

/**
 * Города и углы, на которых стоят жители.
 *
 * Углы в градусах, отсчёт от оси +x по часовой стрелке в плоскости xz.
 *
 * Для Шираза углы особые. Зона caucasus_pass (z от 500) накрывает северную
 * половину города: сам Шираз стоит на z = 493 при радиусе 44, то есть
 * половина его площади лежит в зоне Кавказа. Жителей это не касалось бы, если
 * бы они стояли на своей половине, поэтому его точки держатся южнее и по
 * бокам. Сама ошибка границ зон — не наша и чинится отдельно.
 */
export const TOWNSFOLK_TOWNS: readonly { region: string; углы: readonly number[] }[] = [
  { region: 'tabriz', углы: [45, 135, 225] },
  { region: 'shiraz', углы: [0, 180, 225] },
  { region: 'mesopotamia', углы: [45, 135, 225] },
];

export interface TownfolkSpot {
  /** Регион города, как в REGION_TOWNS */
  region: string;
  x: number;
  z: number;
  /** Поворот фигуры: лицом к центру города плюс разброс, чтобы не стояли строем */
  ry: number;
}

/**
 * Места под жителей: девять точек, три в каждом городе.
 *
 * Отдельная функция, а не только код построения, потому что по ней проверки
 * сверяют точки с землёй: сухо ли, в своей ли зоне, не на крыше ли. Проверка
 * не запускает three.js и не ждёт сети.
 *
 * Разброс поворота задаётся по индексу точки, а не Math.random: иначе после
 * перезагрузки страницы жители вставали бы в другую сторону, и игрок сравнивал
 * бы город с тем, что видел в прошлый раз.
 */
export function townfolkSpots(): TownfolkSpot[] {
  const точки: TownfolkSpot[] = [];
  for (const город of TOWNSFOLK_TOWNS) {
    const t = REGION_TOWNS.find((город2) => город2.region === город.region);
    if (!t) continue;
    город.углы.forEach((градус, номер) => {
      const угол = (градус * Math.PI) / 180;
      точки.push({
        region: город.region,
        x: Math.round(t.x + Math.cos(угол) * t.radius * КОЛЬЦО),
        z: Math.round(t.z + Math.sin(угол) * t.radius * КОЛЬЦО),
        ry: Math.atan2(-Math.sin(угол), -Math.cos(угол)) + (номер - 1) * 0.7,
      });
    });
  }
  return точки;
}

export interface TownfolkHandle {
  /** Продвигает анимацию: без вызова mix.update фигуры стоят столбом */
  update(dt: number): void;
  dispose(): void;
}

function загрузчик(): GLTFLoader | null {
  try {
    const draco = new DRACOLoader();
    draco.setDecoderPath('/game/draco/');
    const l = new GLTFLoader();
    l.setDRACOLoader(draco);
    return l;
  } catch {
    return null;
  }
}

const сцены = new Map<string, Promise<THREE.Group | null>>();
const клипы = new Map<string, Promise<THREE.AnimationClip | null>>();

function загрузитьСцену(имя: string): Promise<THREE.Group | null> {
  const готово = сцены.get(имя);
  if (готово) return готово;
  const задача = new Promise<THREE.Group | null>((готово) => {
    const l = загрузчик();
    if (!l) { готово(null); return; }
    l.load(
      `${БАЗА}${имя}.glb`,
      (gltf: GLTF) => готово((gltf.scene as THREE.Group) ?? null),
      undefined,
      // Нет файла или сети — это не ошибка игры, а повод остаться без жителей
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
      `${БАЗА}${имя}.glb`,
      (gltf: GLTF) => готово((gltf.animations && gltf.animations[0]) ?? null),
      undefined,
      () => готово(null),
    );
  });
  клипы.set(имя, задача);
  return задача;
}

/**
 * Ставит жителей по местам.
 *
 * Коллайдеры заводятся сразу, до загрузки модели: иначе в первые секунды
 * после старта игрок проходит сквозь ещё не видимых людей и упирается в них,
 * когда те появляются.
 */
export function createTownfolk(scene: THREE.Scene): TownfolkHandle {
  const группы: THREE.Group[] = [];
  const смесители: THREE.AnimationMixer[] = [];
  const точки = townfolkSpots();

  // Коллайдеры — до загрузки, по той же причине, что и у декора.
  for (const точка of точки) {
    addCollider(точка.x, точка.z, СТОИТ_НА);
  }

  // Группы создаём сразу: по одной на город, в них потом лягут клоны.
  const поГородам = new Map<string, THREE.Group>();
  for (const город of TOWNSFOLK_TOWNS) {
    const g = new THREE.Group();
    g.name = `townfolk-${город.region}`;
    scene.add(g);
    группы.push(g);
    поГородам.set(город.region, g);
  }

  // Модели грузим заранее и все: если грузить по одной внутри цикла по городам,
  // порядок появления фигур зависел бы от того, какая сеть быстрее, и часть
  // жителей просто не появилась бы.
  void Promise.all([
    ...МОДЕЛИ.map((имя) => загрузитьСцену(имя)),
    загрузитьКлип(КЛИП),
  ]).then(([...остальное]: (THREE.Group | THREE.AnimationClip | null)[]) => {
    // Клип — последний элемент: Promise.all сохраняет порядок, а разбор
    // массива по типам без явной аннотации даёт union, из которого AnimationClip
    // не вытащить (tsc ругается на clipAction).
    const клип = остальное[остальное.length - 1] as THREE.AnimationClip | null;
    if (!клип) return;
    const модели = МОДЕЛИ.map((_, н) => остальное[н]).filter(
      (сцена): сцена is THREE.Group => сцена !== null,
    );
    if (!модели.length) return;

    let порядковый = 0;
    for (const город of TOWNSFOLK_TOWNS) {
      const свои = точки.filter((т) => т.region === город.region);
      const группа = поГородам.get(город.region);
      if (!группа || свои.length === 0) continue;
      for (const [номер, точка] of свои.entries()) {
        // Модели чередуются по индексу точки внутри города, а не по индексу
        // города: так в каждом городе есть обе, а не в первом обе, а в двух
        // других по одной.
        const имя = модели[номер % модели.length];
        // Скелет клонируется отдельной функцией: обычный клон делит Skeleton
        // с оригиналом, и все клоны движутся от одной кости.
        const клон = копияСкелета(имя) as THREE.Group;
        const подогнанная = подогнать(клон, `townfolk-${город.region}-${номер}`);
        подогнанная.position.set(точка.x, groundHeight(точка.x, точка.z), точка.z);
        подогнанная.rotation.y = точка.ry;
        группа.add(подогнанная);
      }
      // Один смеситель на город: дорожки клипа находят кости по именам внутри
      // группы, поэтому одно действие ведёт всех троих.
      const смеситель = new THREE.AnimationMixer(группа);
      const действие = смеситель.clipAction(клип);
      действие.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      // Фаза своя у города: иначе все девять дышат в один такт.
      действие.time = порядковый * 0.7;
      смесители.push(смеситель);
      порядковый++;
    }
  });

  return {
    update(dt: number): void {
      // Нечисловой кадр ломает смеситель: он начнёт считать время в NaN и
      // вернётся к нормальной работе только после перезагрузки страницы.
      const шаг = Number.isFinite(dt) ? dt : 1 / 60;
      for (const смеситель of смесители) смеситель.update(шаг);
    },
    dispose(): void {
      for (const смеситель of смесители) {
        смеситель.stopAllAction();
        смеситель.uncacheRoot(смеситель.getRoot());
      }
      смесители.length = 0;
      for (const группа of группы) {
        группа.traverse((o) => {
          const меш = o as THREE.Mesh;
          if (!меш.isMesh) return;
          const материалы = Array.isArray(меш.material) ? меш.material : [меш.material];
          for (const материал of материалы) {
            // Текстуры общие с кэшем сцены: гасим только отсылку материала.
            (материал as THREE.Material).dispose();
          }
        });
        группа.removeFromParent();
      }
      группы.length = 0;
    },
  };
}