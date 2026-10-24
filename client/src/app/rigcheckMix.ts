// A/B жителей: миксер с фильтром дорожек и без. Часть стенда `rig-check`.
//
// ЗАЧЕМ A/B, А НЕ ПРОВЕРКА НА ГЛАЗ. Правку `безМёртвыхДорожек()` сначала
// пришлось принять на веру: сторож доказывает, что вызов стоит в коде, но не
// доказывает, что three.js перестаёт писать предупреждения. Показать это на живом
// проде не вышло — лимит гостей исчерпан собственными прогонами приёмки.
// Здесь то же меряется напрямую, настоящим three.js на настоящих файлах:
// миксер ставится ДВАЖДЫ, один раз сырым клипом, другой раз отфильтрованным, и
// считается, сколько раз движок пожаловался.
//
// ОБА МИКСЕРА СТАВЯТСЯ НА РАЗНЫЕ СЦЕНЫ. Миксер держит привязки дорожек в своём
// корне; второй, поставленный на ту же сцену, унаследовал бы уже привязанные
// дорожки и показал ноль предупреждений без всякой причины — зелёный результат,
// выдуманный самим измерением.
//
// ПРЕДУПРЕЖДЕНИЯ СЧИТАЮТСЯ ПЕРЕХВАТОМ console.warn: three пишет в него и больше
// никуда. Подмена восстанавливается в finally, иначе сломанная проверка оставила
// бы консоль молчащей на всё остальное время работы стенда.
import { декодерDraco } from './game3d/draco';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { подогнать, безМёртвыхДорожек } from './game3d/realRig';
// Модели закрыты входом (см. game3d/modelAccess.ts).
import { сВходом } from './game3d/modelAccess';

/** Сколько раз three пожаловался на дорожку без цели за один запуск миксера. */
function замерить(корень: THREE.Object3D, клип: THREE.AnimationClip): number {
  let сколько = 0;
  const был = console.warn;
  console.warn = (...args: unknown[]) => {
    if (String(args[0]).includes('No target node found')) сколько++;
    (был as (...a: unknown[]) => void).apply(console, args);
  };
  try {
    const смеситель = new THREE.AnimationMixer(корень);
    const действие = смеситель.clipAction(клип);
    действие.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    // Привязка дорожек создаётся при первом проходе миксера, а не на play().
    смеситель.update(1 / 60);
    смеситель.stopAllAction();
  } finally {
    console.warn = был;
  }
  return сколько;
}

export async function сравнитьФильтрНаЖителях(): Promise<string[]> {
  const строки: string[] = [];
  const загрузчик = сВходом(new GLTFLoader());
    загрузчик.setDRACOLoader(декодерDraco());

  const взять = (путь: string): Promise<any> =>
    new Promise((ok) => загрузчик.load(`/game/models/${путь}.glb`, ok, undefined, () => ok(null)));

  const [сценаA, сценаB, сКлипом] = await Promise.all([
    взять('citizen'),
    взять('citizen'),
    взять('standing-idle'),
  ]);
  if (!сценаA?.scene || !сценаB?.scene || !сКлипом?.animations?.[0]) {
    return ['  не загрузилось: citizen.glb или standing-idle.glb'];
  }
  const лента: THREE.AnimationClip = сКлипом.animations[0];

  const группаA = new THREE.Group();
  группаA.add(подогнать(сценаA.scene as THREE.Group, 'жительA'));
  const группаB = new THREE.Group();
  группаB.add(подогнать(сценаB.scene as THREE.Group, 'жительB'));

  const безФильтра = замерить(группаA, лента);
  const годный = безМёртвыхДорожек(лента, группаB, 'жительB');
  const сФильтром = замерить(группаB, годный);

  строки.push(`  дорожек в клипе: ${лента.tracks.length}`);
  строки.push(`  без фильтра: ${безФильтра} предупреждений three`);
  строки.push(`  с фильтром : ${сФильтром} предупреждений three`);
  строки.push(
    безФильтра > 0 && сФильтром === 0
      ? `  вердикт: фильтр убирает шум целиком, ${безФильтра} → 0`
      : `  !! вердикт: ожидалось было больше нуля и стало ноль, а вышло ${безФильтра} и ${сФильтром}`,
  );
  return строки;
}