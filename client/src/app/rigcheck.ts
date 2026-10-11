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
import { loadRealPlayerRig, CLASS_WEAPON } from './game3d/realRig';

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

сводка.textContent = строки.join('\n');
(window as unknown as { __rigCheck: Итог[] }).__rigCheck = итоги;
document.title = 'Проверка рига готова';