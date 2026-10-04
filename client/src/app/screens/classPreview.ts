// Живые 3D-превью классов на экране выбора — Empire of Safavids.
//
// ЧТО ЭТО. Карточки классов показывали плоские пиксельные спрайты 36x36.
// Теперь в каждой карточке — настоящая модель персонажа (тот же паладин с
// оттенком класса, что и в игре), с честным оружием класса, на медленном
// круге. Загрузка модели общая с игрой: loadRealPlayerRig кеширует glb,
// повторная загрузка берёт промисы из кеша, а не из сети.
//
// ПОЧЕМУ ПЯТЬ ОТДЕЛЬНЫХ РЕНДЕРОВ, А НЕ ОДИН. Один рендер на пять карточек
// потребовал бы scissor-копирования между canvas — сложнее и хрупче. Пять
// маленьких контекстов без теней — дёшево, а лимит контекстов (~16) далеко:
// превью останавливаются при уходе с экрана.
//
// СТРОКИ ГОТОВЫХ ПЕРСОНАЖЕЙ — НЕ ТРОНУТЫ, и это осознанно. Число персонажей
// у игрока не ограничено, а каждый живой превью — это GL-контекст. Десять
// персонажей убили бы все контексты, и часть canvas осталась бы чёрной.
// Строки показывают спрайты, как раньше.
import * as THREE from 'three';
import { loadRealPlayerRig, type RealRig } from '../game3d/realRig';
import type { RigPose, Weapon } from '../game3d/rig';

/**
 * Честное оружие класса: превью показывает то, чем класс воюет.
 * Совпадает с процедурным buildPlayerRig — два источника оружия в проекте,
 * и расхождение между ними означало бы, что превью врёт.
 */
export const CLASS_WEAPON: Record<string, Weapon> = {
  qizilbash: 'sword',
  sufi_mystic: 'staff',
  persian_archer: 'bow',
  bazaar_merchant: 'dagger',
  court_diplomat: 'rapier',
};

/** Щит только у кизылбаша — как в игре (world3d.equipShield). */
export function classHasShield(classId: string): boolean {
  return classId === 'qizilbash';
}

/**
 * Мистик в игре воюет без видимого оружия (world3d прячет его через
 * equipWeapon(false)). Превью показывает то же, иначе игрок увидел бы
 * посох, которого в игре не будет.
 */
export function classShowsWeapon(classId: string): boolean {
  return classId !== 'sufi_mystic';
}

/** Поза превью: стоит и дышит. Именно её update крутит standing-idle. */
const IDLE_POSE: RigPose = {
  moving: false, speed: 0, grounded: true,
  crouch: false, block: false, dead: false, swimming: false,
};

/** Скорость круга, рад/с. Медленно: модель должно быть видно, а не мелькать. */
const TURNTABLE = 0.5;

interface АктивноеПревью {
  rig: RealRig;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

const активные: АктивноеПревью[] = [];
let цикл: number | null = null;
let последнееВремя = 0;
/**
 * Поколение экрана выбора. attach грузит модель асинхронно (секунды), а игрок
 * может уйти в игру раньше: без поколения опоздавшее превью пересоздало бы
 * рендеры и перезапустило цикл поверх игры.
 */
let поколение = 0;

/** Один общий цикл на все пять превью, а не пять requestAnimationFrame. */
function тик(время: number): void {
  цикл = requestAnimationFrame(тик);
  const dt = Math.min(0.05, (время - последнееВремя) / 1000 || 0.016);
  последнееВремя = время;
  for (const п of активные) {
    п.rig.group.rotation.y += dt * TURNTABLE;
    п.rig.update(dt, IDLE_POSE);
    п.renderer.render(п.scene, п.camera);
  }
}

function ensureЦикл(): void {
  if (цикл !== null) return;
  последнееВремя = performance.now();
  цикл = requestAnimationFrame(тик);
}

/**
 * Вешает живое 3D-превью класса на canvas. Возвращает false, если модель не
 * загрузилась: тогда вызывающий оставляет пиксельный спрайт, а не пустую
 * тёмную карточку.
 */
export async function attachClassPreview(canvas: HTMLCanvasElement, classId: string): Promise<boolean> {
  const моё = поколение;
  const rig = await loadRealPlayerRig(classId);
  if (!rig) return false;
  if (моё !== поколение || !canvas.isConnected) {
    // Экран уже закрыт: модель успела, а игрок — нет. Риг разбирается,
    // в список не добавляется, цикл не трогается.
    rig.dispose();
    return false;
  }
  // Canvas уже в DOM: размеры берутся из CSS. setSize с updateStyle=false,
  // чтобы рендер не переписывал стили карточки.
  const ширина = canvas.clientWidth || 120;
  const высота = canvas.clientHeight || 140;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(ширина, высота, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff2dd, 0x1a2030, 0.9));
  const ключ = new THREE.DirectionalLight(0xffe9c4, 1.6);
  ключ.position.set(2, 3, 2);
  scene.add(ключ);
  // Камера на уровне груди: модель 1.9 видна целиком с запасом.
  const камера = new THREE.PerspectiveCamera(35, ширина / высота, 0.1, 20);
  камера.position.set(0, 1.0, 3.2);
  камера.lookAt(0, 0.9, 0);
  rig.setWeaponKind(CLASS_WEAPON[classId] ?? 'sword');
  rig.equipWeapon(classShowsWeapon(classId));
  rig.equipShield(classHasShield(classId));
  scene.add(rig.group);
  активные.push({ rig, renderer, scene, camera: камера });
  ensureЦикл();
  return true;
}

/**
 * Останавливает все превью и освобождает GL-контексты. Вызывается при уходе
 * с экрана выбора: без этого в игру уходили бы пять живых контекстов плюс
 * игровой, и цикл крутил бы модели поверх игры.
 */
export function stopClassPreviews(): void {
  поколение++;
  if (цикл !== null) {
    cancelAnimationFrame(цикл);
    цикл = null;
  }
  for (const п of активные.splice(0)) {
    п.rig.dispose();
    п.renderer.dispose();
  }
}
