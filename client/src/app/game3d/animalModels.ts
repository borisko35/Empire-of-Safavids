// ============================================================
// Настоящие модели зверей — Empire of Safavids
// ============================================================
// Фауна больше не собирается из капсул: каждый вид приезжает готовым GLB.
// Ригованные модели (Quaternius, CC0) везут клипы внутри файла — Walk, Gallop,
// Idle, Eating, Death; статичные (верблюд, коза, птицы) живут позой.
//
// ПОЧЕМУ СВОЙ ЗАГРУЗЧИК, А НЕ загрузитьСцену ИЗ realRig. realRig отдаёт только
// gltf.scene и выбрасывает gltf.animations — ровно то, ради чего зверь и
// возится: у него клипы вшиты в файл, отдельными файлами их не возят. Здесь
// возвращаются и сцена, и клипы, а дальше вызывающий сам решает, что с ними
// делать. Кеш и страховки — те же правила, что у загрузитьСцену: один промис
// на файл, отказ сети или синхронный сбой дают null, а не отклонённый промис
// (вызывающие пишут .then без .catch — так принято по всему проекту).
//
// НОРМАЛИЗАЦИЯ МАСШТАБА. Источники едут в разных единицах: Quaternius —
// метры, Google Poly — сантиметры. Игра не должна этого знать: модель
// измеряется Box3 и масштабируется так, чтобы её длиннейший горизонтальный
// габарит стал равен заданной длине тела. Высота над землёй выравнивается:
// низ bbox кладётся на y = 0, чтобы зверь не тонул и не висел.
//
// ОРИЕНТАЦИЯ. Движок фауны ведёт зверя вдоль локального +Z (rotation.y из
// atan2). Модели смотрят кто куда, поэтому у вида есть поправка yaw,
// подобранная по кадрам. Значение по умолчанию — 0; если на скриншоте зверь
// идёт боком, правится в таблице ВИДЫ, а не на местах спавна.

import * as THREE from 'three';
import { clone as копияСкелета } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { сВходом } from './modelAccess';
import { декодерDraco } from './draco';

const MODEL_BASE = '/game/models/';

let общийЗагрузчик: GLTFLoader | null = null;

function загрузчик(): GLTFLoader | null {
  if (общийЗагрузчик) return общийЗагрузчик;
  try {
    const l = new GLTFLoader();
    l.setDRACOLoader(декодерDraco());
    общийЗагрузчик = l;
    return l;
  } catch (e) {
    console.warn('[animal] gltf loader unavailable', e);
    return null;
  }
}

interface ГрузСцены {
  сцена: THREE.Group;
  клипы: THREE.AnimationClip[];
}

const кеш = new Map<string, Promise<ГрузСцены | null>>();

/**
 * Сцена и клипы одного файла животного. Кеш по имени файла: файл разбирается
 * один раз, экземпляры клонируются от него.
 */
export function загрузитьЖивотное(файл: string): Promise<ГрузСцены | null> {
  const готово = кеш.get(файл);
  if (готово) return готово;
  const задача = new Promise<ГрузСцены | null>((готово) => {
    try {
      const l = загрузчик();
      if (!l) { готово(null); return; }
      сВходом(l).load(
        `${MODEL_BASE}${файл}.glb`,
        (gltf) => готово({ сцена: gltf.scene as THREE.Group, клипы: gltf.animations ?? [] }),
        undefined,
        // Нет файла или сети — зверь просто не появится, игра не падает.
        () => готово(null),
      );
    } catch (e) {
      console.warn(`[animal] сцена ${файл}: сбой загрузчика`, e);
      готово(null);
    }
  });
  кеш.set(файл, задача);
  return задача;
}

/** Какой клип искать по подстроке имени, у какого вида что есть. */
export interface ВидЖивотного {
  /** Файл внутри /game/models/ без расширения. */
  файл: string;
  /** Поправка курса: морда модели должна смотреть в +Z. */
  yaw: number;
  /** Подстроки имён клипов; отсутствует у статичных видов. */
  клипы?: { walk?: string; run?: string; idle?: string; swim?: string };
}

/**
 * Таблица видов. Порядок и состав — по спавну фауны (fauna.ts) и дорожному
 * каравану (roadTraffic.ts). yaw выставляется по скриншоту: модель, идущая
 * боком, лечится здесь, а не на местах спавна.
 */
export const ВИДЫ: Record<string, ВидЖивотного> = {
  // Ригованные: клипы в файле.
  stag:      { файл: 'animals/stag',    yaw: 0, клипы: { walk: 'Walk', run: 'Gallop', idle: 'Idle' } },
  fox:       { файл: 'animals/fox',     yaw: 0, клипы: { walk: 'Walk', run: 'Gallop', idle: 'Idle' } },
  deer:      { файл: 'animals/deer',    yaw: 0, клипы: { walk: 'Walk', run: 'Gallop', idle: 'Idle' } },
  sheep:     { файл: 'animals/sheep',   yaw: 0, клипы: { walk: 'Walk', run: 'Run', idle: 'Idle' } },
  bunny:     { файл: 'animals/bunny',   yaw: 0, клипы: { walk: 'Walk', run: 'Run', idle: 'Idle' } },
  alpaca:    { файл: 'animals/alpaca',  yaw: 0, клипы: { walk: 'Walk', run: 'Gallop', idle: 'Idle' } },
  horse:     { файл: 'animals/horse',   yaw: 0, клипы: { walk: 'Walk', run: 'Gallop', idle: 'Idle' } },
  donkey:    { файл: 'animals/donkey',  yaw: 0, клипы: { walk: 'Walk', run: 'Gallop', idle: 'Idle' } },
  wolf:      { файл: 'animals/wolf',    yaw: 0, клипы: { walk: 'Walk', run: 'Gallop', idle: 'Idle' } },
  husky:     { файл: 'animals/husky',   yaw: 0, клипы: { walk: 'Walk', run: 'Gallop', idle: 'Idle' } },
  bull:      { файл: 'animals/bull',    yaw: 0, клипы: { walk: 'Walk', run: 'Gallop', idle: 'Idle' } },
  cow:       { файл: 'animals/cow',     yaw: 0, клипы: { walk: 'Walk', run: 'Gallop', idle: 'Idle' } },
  // Рыбы: свой клип плавания у каждого семейства.
  'fish-a':  { файл: 'animals/fish-a',    yaw: 0, клипы: { swim: 'Swim' } },
  'fish-b':  { файл: 'animals/fish-b',    yaw: 0, клипы: { swim: 'Swim' } },
  'fish-c':  { файл: 'animals/fish-c',    yaw: 0, клипы: { swim: 'Swim' } },
  piranha:   { файл: 'animals/piranha',   yaw: 0, клипы: { swim: 'Swimming_Normal' } },
  koi:       { файл: 'animals/koi',       yaw: 0, клипы: { swim: 'Swimming_Normal' } },
  clownfish: { файл: 'animals/clownfish', yaw: 0, клипы: { swim: 'Swimming_Normal' } },
  bluetang:  { файл: 'animals/bluetang',  yaw: 0, клипы: { swim: 'Swimming_Normal' } },
  tuna:      { файл: 'animals/tuna',      yaw: 0, клипы: { swim: 'Swimming_Fast' } },
  swordfish: { файл: 'animals/swordfish', yaw: 0, клипы: { swim: 'Swimming_Fast' } },
  // Статичные: поза вместо анимации.
  camel:     { файл: 'animals/camel',   yaw: 0 },
  goat:      { файл: 'animals/goat',    yaw: 0 },
  lizard:    { файл: 'animals/lizard',  yaw: 0 },
  seagull:   { файл: 'animals/seagull', yaw: 0 },
  heron:     { файл: 'animals/heron',   yaw: 0 },
  stork:     { файл: 'animals/stork',   yaw: 0 },
  duck:      { файл: 'animals/duck',    yaw: 0 },
};

/** Собранный экземпляр зверя: то, что нужно фауне на каждый кадр. */
export interface Зверь {
  group: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  walk: THREE.AnimationAction | null;
  run: THREE.AnimationAction | null;
  idle: THREE.AnimationAction | null;
  swim: THREE.AnimationAction | null;
  /** Длина тела в метрах после нормализации — для коллайдера. */
  length: number;
}

/**
 * Собрать зверя вида `вид` с длиной тела `длина` (метры, по длиннейшей
 * горизонтальной оси модели).
 *
 * Возвращает null, если файл не доехал: вызывающий остаётся на процедурной
 * сборке — то же правило, что у loadRealMonsterRig.
 */
export async function собратьЗверя(вид: string, длина: number): Promise<Зверь | null> {
  const спека = ВИДЫ[вид];
  if (!спека) return null;
  const груз = await загрузитьЖивотное(спека.файл);
  if (!груз) return null;

  // Клон: у ригованных скелет общий с кешем, и Object3D.clone оставил бы
  // миксер одного зверя двигать всех (тот же урок, что в townfolk.ts).
  const hasSkin = груз.клипы.length > 0;
  const модель = hasSkin ? (копияСкелета(груз.сцена) as THREE.Group) : груз.сцена.clone(true);

  // Измерение ДО поворота: yaw меняет местами X и Z, а нормализация должна
  // работать независимо от того, как модель легла в файле.
  const box = new THREE.Box3().setFromObject(модель);
  const размер = box.getSize(new THREE.Vector3());
  const горизонт = Math.max(размер.x, размер.z);
  if (горизонт <= 1e-6 || размер.y <= 1e-6) return null;
  const k = длина / горизонт;

  // Внешняя группа ведётся движком (позиция, курс), внутренняя держит
  // поправку курса, масштаб и посадку на землю.
  const внешняя = new THREE.Group();
  const внутренняя = new THREE.Group();
  внутренняя.rotation.y = спека.yaw;
  внутренняя.scale.setScalar(k);
  внутренняя.add(модель);
  внешняя.add(внутренняя);

  // Посадка: низ bbox после масштаба — на y = 0.
  const boxПосле = new THREE.Box3().setFromObject(внешняя);
  внешняя.position.y = -boxПосле.min.y;

  // Тени и отключенный frustum culling у скелетных мешей: скинned-меш с
  // двигающимися костями исчезает, когда его статичный bbox уехал из кадра.
  внешняя.traverse((o) => {
    const м = o as THREE.Mesh;
    if (м.isMesh) {
      м.castShadow = true;
      if ((м as THREE.SkinnedMesh).isSkinnedMesh) м.frustumCulled = false;
    }
  });

  // Клипы и миксер — только у ригованных.
  let mixer: THREE.AnimationMixer | null = null;
  let walk: THREE.AnimationAction | null = null;
  let run: THREE.AnimationAction | null = null;
  let idle: THREE.AnimationAction | null = null;
  let swim: THREE.AnimationAction | null = null;
  if (hasSkin && спека.клипы) {
    mixer = new THREE.AnimationMixer(модель);
    const найти = (подстрока?: string): THREE.AnimationAction | null => {
      if (!подстрока) return null;
      const клип = груз.клипы.find((c) => c.name.includes(подстрока));
      return клип ? mixer!.clipAction(клип) : null;
    };
    walk = найти(спека.клипы.walk);
    run = найти(спека.клипы.run);
    idle = найти(спека.клипы.idle);
    swim = найти(спека.клипы.swim);
    if (idle) { idle.play(); }
    else if (walk) { walk.play(); }
    else if (swim) { swim.play(); }
  }

  return {
    group: внешняя,
    mixer,
    walk,
    run,
    idle,
    swim,
    length: длина,
  };
}

/**
 * Переключить зверя между покоем и ходьбой (или плаванием).
 *
 * Фейд 0.2 с — как CROSSFADE у realRig; без него зверь дёргается между
 * позами на каждой паузе. Вызывается на каждый кадр, дешёвый.
 */
export function вестиЗверя(з: Зверь, движется: boolean, dt: number): void {
  if (!з.mixer) return;
  const цель = движется ? (з.walk ?? з.swim ?? з.idle) : (з.idle ?? з.walk ?? з.swim);
  for (const действие of [з.walk, з.run, з.idle, з.swim]) {
    if (!действие) continue;
    const должно = действие === цель;
    if (должно && !действие.isRunning()) {
      действие.reset().fadeIn(0.2).play();
    } else if (!должно && действие.isRunning()) {
      действие.fadeOut(0.2);
    }
  }
  з.mixer.update(dt);
}

// ── Звери вне фауны ─────────────────────────────────────────────
// Фауна тикает своих зверей сама (вестиЗверя на каждый кадр). Но звери
// живут и вне фауны — лошадь в конюшне, верблюды каравана. Их миксеры
// некому обновлять: без тикера модель застывает в позе привязки.

const звёздныеМиксеры = new Set<THREE.AnimationMixer>();

/** Зарегистрировать зверя, чей миксер должен тикать вне фауны. */
export function следитьЗверем(з: Зверь): void {
  if (з.mixer) звёздныеМиксеры.add(з.mixer);
}

/** Забыть зверя (при уборке сцены), чтобы миксер не тикал в пустоту. */
export function забытьЗверя(з: Зверь): void {
  if (з.mixer) звёздныеМиксеры.delete(з.mixer);
}

/** Обновить миксеры зверей вне фауны. Вызывается из World3D на каждый кадр. */
export function тикатьЗверей(dt: number): void {
  for (const м of звёздныеМиксеры) м.update(dt);
}
