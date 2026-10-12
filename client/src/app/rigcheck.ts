// Проверка настоящего рига НАСТОЯЩИМ кодом игры, в настоящем three.js, в браузере.
//
// ЗАЧЕМ ОТДЕЛЬНАЯ СТРАНИЦА. Пять гипотез подряд строились на числах и ни одна
// не подтвердилась, потому что связь выводилась, а не наблюдалась. Blender здесь
// не годится: он разбирает .glb по-своему и позу считает по-своему, а вопрос
// был «что увидит игрок». Ответить на него может только тот же код, в том же
// движке, с тем же загрузчиком и тем же подгонщиком, что и в игре.
//
// Здесь поднимается ровно настоящий класс игрока - тот самый, что создаёт
// world3d, - и рядом ставится эталонная геометрия 1.9 м. Размер фигур видно
// сравнением с эталоном, а не замером.
//
// Страница нужна только для проверки и в сборку игры не входит.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { loadRealPlayerRig, CLASS_WEAPON, подогнать } from './game3d/realRig';
import { сравнитьФильтрНаЖителях } from './rigcheckMix';

const КЛАССЫ = ['qizilbash', 'sufi_mystic', 'persian_archer', 'bazaar_merchant', 'court_diplomat'];
const ВЫСОТА_ЭТАЛОНА = 1.9;
const ШИРИНА = 300;
const ВЫСОТА = 620;

interface Итог {
  класс: string;
  рост: number;
  ширина: number;
  замерИгры: number;
  подошва: number;
  голова: number;
  таз: number;
  кисть: number;
  ступня: number;
  шея: number;
  /** Материалы после подгонки: сколько прозрачных, двусторонних, металлов */
  материалы: string;
  кадр: string;
}

/**
 * Считает материалы так, как их увидит three.
 *
 * Зачем считать, а не смотреть: прозрачность и двусторонность видны только
 * тогда, когда модель чем-то перекрыта, и на белом фоне прочитать их
 * почти невозможно. А обе вещи ломают картину катастрофически и молча.
 */
function пересчётМатериалов(риг: THREE.Group): string {
  let всего = 0;
  let прозрачных = 0;
  let двусторонних = 0;
  let металлов = 0;
  let безАнизотропии = 0;
  риг.traverse((o) => {
    const меш = o as THREE.Mesh;
    if (!меш.isMesh || !меш.material) return;
    const список = Array.isArray(меш.material) ? меш.material : [меш.material];
    for (const mat of список) {
      const m = mat as THREE.MeshStandardMaterial;
      if (!m || !m.color) continue;
      всего++;
      if (m.transparent) прозрачных++;
      if (m.side === THREE.DoubleSide) двусторонних++;
      if (m.metalness > 0) металлов++;
      if (m.map && !m.map.anisotropy) безАнизотропии++;
    }
  });
  return (
    `${всего} всего, прозрачных ${прозрачных}, ` +
    `двусторонних ${двусторонних}, металлов ${металлов}, ` +
    `текстур без анизотропии ${безАнизотропии}`
  );
}

const ряд = document.getElementById('ряд')!;
const сводка = document.getElementById('сводка')!;

/**
 * Прямая проверка привязки дорожек анимации к костям.
 *
 * ЗАЧЕМ ОТДЕЛЬНО. На проде three.js 18 раз на класс пишет
 * «No target node found for track: mixamorigLeftEye.position». Утверждать, что
 * это безобидно, нельзя: предыдущие пять гипотез начинались с «наверное, это
 * ерунда». Здесь та же проверка, что делает three, - PropertyBinding.findNode -
 * но на свежезагруженных файлах, чтобы видеть и имена, и цели.
 *
 * Ничего не утверждается наперёд: выводится то, что найдено.
 */
/**
 * Подошва жителя после подгонки: обязана быть в нуле обёртки.
 *
 * ПОЧЕМУ ЭТО ВООБЩЕ ПРОВЕРЯЕТСЯ. В логе `подогнать()` есть строка
 * `низ=...`, и выглядит она как «где подошва». Это не так: строка печатается
 * ДО сдвига, который подошву и ставит на нуль (сдвиг ниже по функции). Разные
 * жители дают разный `низ` — у них разный покой скелета, — и по одному этому
 * числу нельзя ни доказать, ни опровергнуть никого.
 *
 * Здесь проверяется то, на что townfolk.ts опирается по-настоящему: после
 * `подогнать()` подошва обёртки sits at 0. Если это не так, житель висит над
 * землёй или утоплен в ней, и вся расстановка по рельефу врёт.
 */
async function проверитьПодошвуЖителей(): Promise<string[]> {
  const строки: string[] = [];
  const загрузчик = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/game/draco/');
  загрузчик.setDRACOLoader(draco);

  const низОбёртки = (корень: THREE.Object3D): number => {
    корень.updateMatrixWorld(true);
    const g = new THREE.Box3();
    const t = new THREE.Box3();
    корень.traverse((o) => {
      const узел = o as THREE.Object3D & {
        isSkinnedMesh?: boolean;
        computeBoundingBox?: () => void;
        boundingBox?: THREE.Box3 | null;
      };
      if (узел.isSkinnedMesh === true && typeof узел.computeBoundingBox === 'function') {
        узел.computeBoundingBox();
        if (узел.boundingBox) g.union(t.copy(узел.boundingBox).applyMatrix4(узел.matrixWorld));
        return;
      }
      const меш = o as THREE.Mesh;
      if (!меш.isMesh || !меш.geometry) return;
      if (!меш.geometry.boundingBox) меш.geometry.computeBoundingBox();
      if (меш.geometry.boundingBox) {
        g.union(t.copy(меш.geometry.boundingBox).applyMatrix4(меш.matrixWorld));
      }
    });
    return g.min.y;
  };

  for (const имя of ['citizen', 'citizen2', 'citizen3']) {
    const gltf: any = await new Promise((ok) =>
      загрузчик.load(`/game/models/${имя}.glb`, ok, undefined, () => ok(null)),
    );
    if (!gltf?.scene) { строки.push(`  ${имя}: не загрузилось`); continue; }
    const обёртка = подогнать(gltf.scene as THREE.Group, `житель-${имя}`);
    const низ = низОбёртки(обёртка);
    const судьба = Math.abs(низ) < 0.05 ? 'норма' : `!! подошва ${низ.toFixed(3)} м`;
    строки.push(`  ${имя.padEnd(10)} подошва ${низ >= 0 ? '+' : ''}${низ.toFixed(4)} м   ${судьба}`);
  }
  return строки;
}

async function проверитьПривязку(): Promise<string[]> {
  const строки: string[] = [];
  const загрузчик = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/game/draco/');
  загрузчик.setDRACOLoader(draco);

  const читать = (путь: string): Promise<any> =>
    new Promise((готово) => загрузчик.load(`/game/models/${путь}.glb`, готово, undefined, () => готово(null)));

  for (const [модель, клип] of [
    ['guard-qizilbash', 'standing-idle'],
    ['sufi-mystic', 'standing-idle'],
    ['archer-of-persian', 'standing-idle'],
    ['market-vendor', 'standing-idle'],
    ['court-diplomat', 'standing-idle'],
    ['citizen', 'standing-idle'],
  ]) {
    const [сцена, лента] = await Promise.all([читать(модель), читать(клип)]);
    if (!сцена || !лента) { строки.push(`  ${модель}: не загрузилось`); continue; }

    const узлыСцены = new Set<string>();
    сцена.scene.traverse((o: THREE.Object3D) => { if (o.name) узлыСцены.add(o.name); });

    const всеДорожки = лента.animations[0].tracks as THREE.KeyframeTrack[];
    const безЦели = new Set<string>();
    for (const д of всеДорожки) {
      const разобранное = THREE.PropertyBinding.parseTrackName(д.name);
      if (!разобранное.nodeName) continue;
      const цель = THREE.PropertyBinding.findNode(сцена.scene, разобранное.nodeName);
      if (!цель) безЦели.add(`${разобранное.nodeName}`);
    }

    строки.push(`  ${модель} + ${клип}: дорожек ${всеДорожки.length}, без цели ${безЦели.size}`);
    if (безЦели.size) {
      строки.push(`    ищет: ${[...безЦели].join(', ')}`);
      строки.push(`    узлы с "eye" в сцене: ${JSON.stringify([...узлыСцены].filter((n) => /eye/i.test(n)))}`);
      строки.push(`    дорожки с "eye": ${JSON.stringify([...new Set(всеДорожки.map((d) => d.name))].filter((n) => /eye/i.test(n)))}`);
    }
  }
  return строки;
}

/** Сцена на клетку: камера, свет, эталонная палочка ростом 1.9 м. */
function сценаДля(ширина: number, высота: number) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(ширина, высота, false);
  renderer.setClearColor(0x23262e, 1);
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, ширина / высота, 0.05, 200);
  const hemi = new THREE.HemisphereLight(0xdfe6f2, 0x2a2622, 1.5);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(2.6, 3.4, 3.2);
  key.castShadow = true;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8fb0ff, 0.7);
  fill.position.set(-3, 1.6, 2);
  scene.add(fill);
  // Эталон: палочка высотой ровно 1.9 м. Фигура сравнивается с ней глазами.
  const эталон = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, ВЫСОТА_ЭТАЛОНА, 0.06),
    new THREE.MeshBasicMaterial({ color: 0x4fd18b }),
  );
  эталон.position.set(-0.62, ВЫСОТА_ЭТАЛОНА / 2, 0);
  scene.add(эталон);
  const пол = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 1 }),
  );
  пол.rotation.x = -Math.PI / 2;
  пол.receiveShadow = true;
  scene.add(пол);
  // Камера ставится ПОСЛЕ того, как известна настоящая высота фигуры. Камера,
  // настроенная на заранее задуманные 1.9 м, обрезает фигуру ростом 3 м и
  // показывает одни ноги - а это читается как «ноги кривые».
  const настроить = (рост: number): void => {
    эталон.position.set(-0.62, ВЫСОТА_ЭТАЛОНА / 2, 0);
    const центр = рост * 0.52;
    const дистанция = ((рост / 2) / Math.tan((28 * Math.PI) / 360)) * 1.3;
    camera.position.set(дистанция * 0.16, центр, дистанция * 0.94);
    camera.lookAt(0, центр, 0);
  };
  return { renderer, scene, camera, настроить };
}

/** Мировая точка кости по имени, с откатом на три разных написания. */
function точкаКости(риг: THREE.Group, фрагмент: string): THREE.Vector3 | null {
  let найдено: THREE.Object3D | null = null;
  риг.traverse((o) => {
    if (найдено) return;
    const имя = o.name.replace(/:/g, '');
    if (имя.includes(фрагмент) && (o as THREE.Bone).isBone === true) найдено = o;
  });
  if (!найдено) return null;
  const v = new THREE.Vector3();
  (найдено as THREE.Object3D).getWorldPosition(v);
  return v;
}

async function показать(класс: string): Promise<Итог | null> {
  const клетка = document.createElement('div');
  клетка.className = 'клетка';
  const подпись = document.createElement('div');
  подпись.className = 'подпись';
  подпись.textContent = класс;
  клетка.appendChild(подпись);
  ряд.appendChild(клетка);

  const риг = await loadRealPlayerRig(класс);
  if (!риг) {
    подпись.textContent = `${класс}: модель не пришла`;
    return null;
  }
  const { renderer, scene, camera, настроить } = сценаДля(ШИРИНА, ВЫСОТА);
  клетка.appendChild(renderer.domElement);
  риг.setWeaponKind(CLASS_WEAPON[класс] ?? 'sword');
  риг.equipWeapon(true);
  scene.add(риг.group);

  // Десять кадров покоя: миксер должен успеть дойти до первого кадра клипа.
  const поза = { moving: false, speed: 0, grounded: true, crouch: false, block: false, dead: false, swimming: false };
  for (let i = 0; i < 10; i++) риг.update(1 / 60, поза);
  scene.updateMatrixWorld(true);

  // Две разные высоты, и путать их нельзя.
  //
  // 1) ЧТО МЕРЯЕТ ИГРА. Box3.setFromObject() по SkinnedMesh берёт локальный
  //    boundingBox геометрии, а не позу костей. Это число нужно, чтобы понять,
  //    что видит подгонщик, - но ростом фигуры оно не является.
  // 2) ЧТО РЕАЛЬНО ВЫШЛО. Высота скелета в текущей позе: от подошвы до макушки.
  const какМеряетИгра = new THREE.Box3().setFromObject(риг.group);
  const замерИгры = какМеряетИгра.max.y - какМеряетИгра.min.y;

  let макушка = -Infinity;
  let подошва = Infinity;
  let левее = Infinity;
  let правее = -Infinity;
  риг.group.traverse((o) => {
    if ((o as THREE.Bone).isBone !== true) return;
    const p = new THREE.Vector3();
    o.getWorldPosition(p);
    макушка = Math.max(макушка, p.y);
    подошва = Math.min(подошва, p.y);
    левее = Math.min(левее, p.x);
    правее = Math.max(правее, p.x);
  });
  const рост = макушка - подошва;
  const ширина = правее - левее;

  настроить(Math.max(рост, ВЫСОТА_ЭТАЛОНА));
  renderer.render(scene, camera);
  const кадр = renderer.domElement.toDataURL('image/png');

  const голова = точкаКости(риг.group, 'Head');
  const таз = точкаКости(риг.group, 'Hips');
  const кисть = точкаКости(риг.group, 'LeftHand');
  const ступня = точкаКости(риг.group, 'LeftFoot');

  return {
    класс,
    рост,
    ширина,
    замерИгры,
    подошва,
    голова: голова?.y ?? NaN,
    таз: таз?.y ?? NaN,
    кисть: кисть?.y ?? NaN,
    ступня: ступня?.y ?? NaN,
    шея: голова && таз ? голова.y - таз.y : NaN,
    материалы: пересчётМатериалов(риг.group),
    кадр,
  };
}

const итоги: Итог[] = [];
for (const класс of КЛАССЫ) {
  const итог = await показать(класс);
  if (итог) итоги.push(итог);
  сводка.textContent = `загружено ${итоги.length} из ${КЛАССЫ.length}`;
}

const строки = [
  'КЛАСС            РОСТ  ШИРИНА  ЗАМЕР  ПОДОШВА  ШЕЯ   ГОЛОВА  КИСТЬ  ОЦЕНКА',
  '-'.repeat(92),
];
for (const и of итоги) {
  // Рост должен быть около 1.9 м, подошва - на нуле, и фигура не должна быть
  // шире, чем высока. Подгонщик отказывается менять размер, когда его замер
  // не похож на рост, поэтому ЗАМЕР и РОСТ показаны рядом: расхождение между
  // ними и есть поломка подгонки.
  const рослый = Math.abs(и.рост - ВЫСОТА_ЭТАЛОНА) < 0.3;
  const наЗемле = Math.abs(и.подошва) < 0.12;
  const стройный = и.ширина < и.рост * 0.9;
  const замерВрёт = Math.abs(и.замерИгры - и.рост) / и.рост > 0.3;
  const претензии: string[] = [];
  if (!рослый) претензии.push(`рост ${и.рост.toFixed(2)}`);
  if (!наЗемле) претензии.push(`подошва ${и.подошва.toFixed(2)}`);
  if (!стройный) претензии.push(`широк ${и.ширина.toFixed(2)}`);
  if (замерВрёт) претензии.push(`замер ${и.замерИгры.toFixed(3)}`);
  строки.push(
    [
      и.класс.padEnd(16),
      и.рост.toFixed(2).padStart(5),
      и.ширина.toFixed(2).padStart(7),
      и.замерИгры.toFixed(3).padStart(6),
      и.подошва.toFixed(2).padStart(8),
      и.шея.toFixed(2).padStart(5),
      и.голова.toFixed(2).padStart(7),
      и.кисть.toFixed(2).padStart(6),
      претензии.length ? `!! ${претензии.join(', ')}` : 'хорошо',
    ].join(' '),
  );
}
строки.push('');
строки.push('МАТЕРИАЛЫ');
for (const и of итоги) {
  строки.push(`  ${и.класс.padEnd(16)} ${и.материалы}`);
}

строки.push('');
строки.push('ПРИВЯЗКА ДОРОЖЕК');
строки.push(...(await проверитьПривязку()));

строки.push('');
строки.push('ПОДОШВА ЖИТЕЛЕЙ ПОСЛЕ ПОДГОНКИ');
строки.push(...(await проверитьПодошвуЖителей()));

строки.push('');
строки.push('ФИЛЬТР ДОРОЖЕК НА ЖИТЕЛЯХ (A/B)');
строки.push(...(await сравнитьФильтрНаЖителях()));

сводка.textContent = строки.join('\n');
(window as unknown as { __rigCheck: Итог[] }).__rigCheck = итоги;
document.title = 'Проверка рига готова';