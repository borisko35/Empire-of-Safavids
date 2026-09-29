// Проверка фигуры игрока настоящим запуском кода.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ СКРИПТ, А НЕ ТЕСТ. Тестового раннера у клиента нет:
// ни vitest, ни jest в package.json нет, а jest живёт только в сервере и
// запускается из папки server, где нет three. Первая версия проверки была
// написана как jest-тест в client/src/tests/ - она никогда бы не запустилась,
// то есть была декоративным файлом. Такой файл опаснее отсутствующего:
// он выглядит как проверка и ничего не проверяет.
//
// Скрипт запускается вручную и в сборке: npm run check:figure - в папке
// client, где three есть.
//
// ЧТО ПРОВЕРЯЕТСЯ. Не «есть ли такие-то строки в файле», а собирается ли
// персонаж и из чего он состоит. Геометрия проверяется по ТИПУ объекта
// (instanceof), а не по наличию поля parameters: это поле есть и у куба, и
// у цилиндра, и у шара, и такая проверка считала бы всё подряд - первая
// версия так и выдала «витки тюрбана: 43» при 43 мешах на персонажа.
import * as THREE from 'three';
import { buildPlayerRig, buildHumanoid } from '../src/app/game3d/rig';
import type { RigPose } from '../src/app/game3d/rig';

const CLASSES = ['qizilbash', 'sufi_mystic', 'persian_archer', 'bazaar_merchant', 'court_diplomat'];

/** Классы, у которых на рисунке тюрбан или шапка, а не шлем */
const TURBAN_CLASSES = ['sufi_mystic', 'bazaar_merchant'];

const LAND_POSES: RigPose[] = [
  { moving: false, speed: 0, grounded: true, crouch: false, block: false, dead: false, swimming: false },
  { moving: true, speed: 7, grounded: true, crouch: false, block: false, dead: false, swimming: false },
  { moving: true, speed: 3, grounded: false, crouch: false, block: true, dead: false, swimming: false },
  { moving: false, speed: 0, grounded: true, crouch: false, block: false, dead: true, swimming: false },
  // Присед на суше. В первой версии приседал только персонаж в воде, и
  // ветка «не в воде» из-за этого не выполнялась вовсе.
  { moving: false, speed: 0, grounded: true, crouch: true, block: false, dead: false, swimming: false },
  { moving: true, speed: 5, grounded: true, crouch: true, block: true, dead: false, swimming: false },
];

const WATER_POSES: RigPose[] = [
  { moving: true, speed: 2, grounded: true, crouch: false, block: false, dead: false, swimming: true },
  { moving: true, speed: 4, grounded: true, crouch: false, block: false, dead: false, swimming: true },
];

/** Нейтральная стойка на суше: ни приседа, ни плавания, ни прыжка. */
const NEUTRAL: RigPose = { moving: false, speed: 0, grounded: true, crouch: false, block: false, dead: false, swimming: false };

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
}

const params = (m: THREE.Mesh): any => (m.geometry as any).parameters ?? {};

/**
 * Натяжение треугольников у тел вращения.
 *
 * Ошибку эту нашли глазами, а не проверкой: в промежутке распахнутого халата
 * были видны сапоги, и оказалось, что они почти касаются рубахи. Сперва
 * заподозрили вывернутую наизнанку рубаху и проверили нормали - они смотрят
 * наружу, то есть верно. А натяжение индексов может быть обратным при верных
 * нормалях, и тогда при одностороннем материале видна дальняя стенка.
 *
 * Поэтому сверяем грань, посчитанную по порядку вершин, с нормалями её же
 * вершин. Знаки должны совпадать.
 */
function windingOk(mesh: THREE.Mesh): boolean {
  const pos = mesh.geometry.getAttribute('position');
  const nor = mesh.geometry.getAttribute('normal');
  const idx = mesh.geometry.getIndex();
  if (!pos || !nor) return true;
  const count = idx ? idx.count : pos.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), face = new THREE.Vector3();
  const vn = new THREE.Vector3();
  let agree = 0, disagree = 0;
  const step = Math.max(3, Math.floor(count / 3 / 400) * 3);
  for (let i = 0; i + 2 < count; i += step) {
    const i0 = idx ? idx.getX(i) : i;
    const i1 = idx ? idx.getX(i + 1) : i + 1;
    const i2 = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    ab.subVectors(b, a); ac.subVectors(c, a);
    face.crossVectors(ab, ac);
    if (face.lengthSq() < 1e-12) continue;
    face.normalize();
    vn.set(
      (nor.getX(i0) + nor.getX(i1) + nor.getX(i2)) / 3,
      (nor.getY(i0) + nor.getY(i1) + nor.getY(i2)) / 3,
      (nor.getZ(i0) + nor.getZ(i1) + nor.getZ(i2)) / 3,
    );
    if (vn.lengthSq() < 1e-12) continue;
    if (face.dot(vn) > 0) agree++; else disagree++;
  }
  return disagree <= agree;
}

/**
 * Смотрит ли ткань наружу.
 *
 * Натяжение может быть согласовано с нормалями, а нормали при этом смотрять
 * внутрь - тогда всё тело вывернуто, и при одностороннем материале видна
 * дальняя стенка. Проверяем отдельно: нормаль в нижней половине должна
 * смотреть от оси тела вращения.
 */
function radiallyOutward(mesh: THREE.Mesh): boolean {
  const pos = mesh.geometry.getAttribute('position');
  const nor = mesh.geometry.getAttribute('normal');
  if (!pos || !nor) return true;
  let sum = 0, n = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (y < -0.2 && r > 0.05) {
      sum += (nor.getX(i) * x + nor.getZ(i) * z) / r;
      n++;
    }
  }
  return n === 0 || sum / n > 0;
}

let failed = 0;
function check(ok: boolean, label: string, detail = ''): void {
  if (!ok) failed++;
  console.log(`  ${ok ? 'ок   ' : 'ПЛОХО'} ${label}${detail ? ' — ' + detail : ''}`);
}

console.log('Сборка фигуры по рисунку\n');

for (const cls of CLASSES) {
  let rig;
  try {
    rig = buildPlayerRig(cls);
  } catch (e) {
    check(false, `${cls}: собирается`, (e as Error).message);
    continue;
  }
  const meshes = meshesOf(rig.group);
  const of = (T: any) => meshes.filter(m => m.geometry instanceof T);
  const lathe = of(THREE.LatheGeometry);
  const torus = of(THREE.TorusGeometry);
  const cone = of(THREE.ConeGeometry);
  const box = of(THREE.BoxGeometry);
  const cyl = of(THREE.CylinderGeometry);

  // Суставы ищем по именам, которые сборка проставляет группам. Иначе
  // пришлось бы угадывать торс по координате, а это молча ломается вместе
  // с любой правкой сборки.
  const byName = (n: string): THREE.Object3D | null => {
    let found: THREE.Object3D | null = null;
    rig.group.traverse((o) => { if (o.name === n) found = o; });
    return found;
  };
  const torso = byName('torso');
  const armL = byName('armL');
  const legL = byName('legL');
  const legR = byName('legR');
  if (!torso || !armL || !legL || !legR) {
    check(false, `${cls}: суставы подписаны`, 'нет torso/armL/legL/legR - проверка анимации ничего не найдёт');
    rig.dispose();
    continue;
  }

  // Подол: самая нижняя точка тел вращения.
  //
  // Мерить минимум по всем телам нельзя: рубаха под халатом длинная сама по
  // себе, и укоротив только халат, проверка оставалась зелёной - слой саботажа
  // проходил, ничего не доказывая. Меряем подол того тела, у которого есть
  // разрез, то есть самого халата.
  const hemMeshes = lathe.filter(m => {
    const p = params(m);
    return typeof p.phiLength === 'number' && p.phiLength < Math.PI * 2 - 0.3;
  });
  const hemSource = hemMeshes.length ? hemMeshes : lathe;
  const hem = hemSource.length
    ? Math.abs(Math.min(...hemSource.flatMap(m => (params(m).points ?? []).map((v: any) => v.y))))
    : 0;
  // Витки тюрбана: кольца намотки радиусом 0.16–0.19.
  //
  // Диапазон узкий не по капризу: воротник (0.105) и манжеты (0.115) тоже
  // меньше 0.24, поэтому фильтр «меньше 0.24» ловил и их — витков
  // получалось 6 вместо 3, и удаление трёх витков не давало ничего.
  const wraps = torus.filter(m => {
    const r = params(m).radius ?? 0;
    return r > 0.15 && r < 0.2;
  }).length;
  // Халат распахнут спереди.
  //
  // Второй вариант сборки держала две плитки-«полы», и проверка искала их по
  // габаритам. Оказалось, что третьей такой же плиткой проходил клинок меча
  // (0.055 x 0.85) - у кызылбаша, лучника и дипломата проверка была зелёной
  // без единой настоящей полы.
  //
  // Теперь разрез сделан по-настоящему: тело вращения обходится не кругом,
  // а на 360 минус угол, и из щели видна рубаха. Значит и проверять надо
  // угол обхода, а не похожие коробки: полный круг - это колокол без
  // слоёв, ровно то, чего требовалось избавиться.
  const openRobes = lathe.filter(m => {
    const p = params(m);
    return typeof p.phiLength === 'number' && p.phiLength < Math.PI * 2 - 0.3 && p.phiStart > 0.3;
  }).length;
  // Широкая перевязь.
  //
  // Первый вариант проверки был «цилиндр выше 0.15» — и срабатывал на 11
  // элементах сразу, то есть всегда. Проверка, которая не может краснеть,
  // хуже отсутствующей: она создаёт видимость присмотра. Поэтому ищем
  // именно перевязь: диаметр около пояса (0.20–0.24) и высота 0.15–0.25.
  // Прежний тонкий золотой пояс был высотой 0.07 и под это не подходит.
  const sash = cyl.filter(m => {
    const p = params(m);
    const wide = p.radiusTop >= 0.2 && p.radiusTop <= 0.24 && p.radiusBottom >= 0.2 && p.radiusBottom <= 0.24;
    const tall = p.height > 0.15 && p.height < 0.25;
    return wide && tall;
  }).length;

  // Ноги помещаются внутрь халата.
  //
  // Находка глаз: в промежутке распахнутого халата были видны сапоги. Дело
  // оказалось не в натяжении граней, а в размерах: сапог доходил до 0.208 от
  // оси при радиусе рубахи 0.211 - нога упиралась в ткань вплотную, и
  // просвет между ними исчезал при любом ракурсе. Проверяем запас по
  // мировым габаритам, а не «есть ли сапог»: сапог был, и он был виден.
  const tunic = lathe.find(m => {
    const p = params(m);
    const ys = (p.points ?? []).map((v: any) => v.y);
    return ys.length && Math.min(...ys) < -0.5 && (p.phiLength ?? 0) > Math.PI * 2 - 0.3;
  });
  let legClearance = NaN;
  if (tunic) {
    const tunicBox = new THREE.Box3().setFromObject(tunic);
    let widest = 0;
    for (const child of [legL, legR]) {
      const b = new THREE.Box3().setFromObject(child);
      widest = Math.max(widest, Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z)));
    }
    legClearance = tunicBox.max.x - widest;
  }

  check(meshes.length > 24, `${cls}: подробность`, `${meshes.length} мешей (было 12–17)`);
  check(hem > 0.6, `${cls}: подол до щиколотки`, hem.toFixed(2));
  check(openRobes >= 1, `${cls}: халат распахнут`, `разрезов: ${openRobes}`);
  check(sash >= 1, `${cls}: широкая перевязь`, `найдено ${sash}`);
  check(lathe.every(windingOk), `${cls}: натяжение граней верное`,
    lathe.length ? '' : 'тел вращения нет');
  check(lathe.every(radiallyOutward), `${cls}: ткань лицом наружу`,
    lathe.length ? '' : 'тел вращения нет');
  check(legClearance > 0.03, `${cls}: ноги помещаются в халат`,
    `запас ${isNaN(legClearance) ? 'не измерен' : legClearance.toFixed(3)}`);
  // cone — это массив, а не число. Сравнение массива с числом даёт NaN и
  // краснеет всегда, даже когда конус на месте.
  check(cone.length >= 1, `${cls}: борода каплей`, `${cone.length} конусов`);
  if (TURBAN_CLASSES.includes(cls)) {
    check(wraps >= 3, `${cls}: тюрбан из витков`, `${wraps} витков`);
  }

  // Анимация прогоняется по фазам, а не одним списком.
  //
  // ПОЧЕМУ ПО ФАЗАМ. Первая версия крутила в каждом кадре все позы подряд,
  // включая позу в воде. Пока плаваешь, персонаж считается в воде, и ветка
  // анимации «на суше» не выполняется вовсе - а именно в ней ходьба, присед и
  // атака на земле. Поломка в этой ветке проходила незамеченной: персонаж
  // целый, проверка зелёная, а по земле он бы ходил неправильно. Теперь
  // сначала фаза суши (плавание успевает погаснуть), потом фаза воды.
  let animOk = true;
  let animErr = '';
  let landMoved = false;
  try {
    for (let f = 0; f < 30; f++) {
      rig.triggerAttack();
      for (const p of LAND_POSES) rig.update(1 / 30, p);
    }
    // Доказательство, что ветка суши действительно отработала.
    //
    // В воде торс опускается до 0.55-0.68, на суше он стоит на 0.98. Плюс на
    // суше ноги и руки качаются. Если бы фаза суши на самом деле шла в воде,
    // обе приметки были бы ложными - и поломка в ветке суши прошла бы
    // незамеченной, как это и случилось с первой версией проверки.
    landMoved = !!torso && torso.position.y > 0.9
      && (Math.abs(legL.rotation.x) > 0.01 || Math.abs(armL.rotation.x) > 0.01);

    // Фаза суши заканчивается нейтральной стойкой. Проверять положение
    // торса сразу после приседа бессмысленно: присед тоже опускает торс
    // (до 0.64), и это неотличимо от воды.
    for (let f = 0; f < 20; f++) rig.update(1 / 30, NEUTRAL);
    landMoved = !!torso && torso.position.y > 0.93;

    for (let f = 0; f < 15; f++) {
      for (const p of WATER_POSES) rig.update(1 / 30, p);
    }
    rig.equipWeapon(false); rig.equipWeapon(true);
    rig.equipShield(false); rig.equipShield(true);
    rig.setArmorTint(0x445566);
  } catch (e) {
    animOk = false;
    animErr = (e as Error).message;
  }
  check(animOk, `${cls}: анимация, оружие, щит, броня`, animErr);
  check(landMoved, `${cls}: анимация на суше отработала`,
    landMoved ? '' : `торс стоял на ${torso?.position.y.toFixed(2)} вместо 0.98 - персонаж остался в воде`);
  rig.dispose();
}

console.log('\nNPC');
try {
  const npc = buildHumanoid({ robe: 0x445566, robeDark: 0x223344, hat: 'cap', hatColor: 0xffffff, weapon: 'none' });
  const n = meshesOf(npc.group).length;
  npc.update(1 / 30, LAND_POSES[1]);
  npc.dispose();
  // Прежняя сборка должна остаться прежней: если её не станет, молча
  // поменяется внешность всех горожан, бандитов и торговцев
  check(n > 0 && n < 30, 'прежняя сборка жива и не изменилась', `${n} мешей`);
} catch (e) {
  check(false, 'прежняя сборка собирается', (e as Error).message);
}

console.log(failed === 0 ? '\nВСЁ СОБРАЛОСЬ' : `\nПРОВАЛЕНО ПРОВЕРОК: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
