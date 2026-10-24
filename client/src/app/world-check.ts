// ============================================================
// Стенд визуальной проверки мира (в игру не входит)
// ============================================================
//
// ЗАЧЕМ. Мир строится из процедурных домов, моделей декора и настоящих
// PBR-поверхностей, и понять, «читается ли кадр как город, а не как набор
// коробок», можно только глазами. Игра для этого не годится: вход требует
// сервера и базы, а нужен один неподвижный кадр с известной точки.
//
// ЧТО ДЕЛАЕТ. Поднимает настоящий World3D (тот же рендерер, тот же небо и
// свет, тот же отложенный проход), ставит камеру по параметрам адреса и
// отдаёт кадр в приёмник tools/shot-server.mjs.
//
// Адрес:
//   /world-check.html?x=34&z=26&yaw=0&pitch=0.18&dist=9&hour=15&shot=maidan
//
// x, z    — точка, на которую смотрит камера (мировые метры)
// yaw     — куда смотрит камера, радианы (0 — на +Z, как в игре)
// pitch   — наклон вниз, радианы
// dist    — расстояние камеры от точки
// hour    — игровой час, 0..24
// shot    — имя файла для приёмника; без него кадр не отправляется
//
// НАКЛОН И ПОВОРОТ СЧИТАЮТСЯ ТАК ЖЕ, КАК В ИГРЕ: камера стоит за спиной
// игрока на dist, смотрит в точку на высоте 1.7 м и опускается на pitch.

import * as THREE from 'three';
import { World3D } from './game3d/world3d';
import type { SkyState } from './game3d/skyEnvironment';

const параметры = new URLSearchParams(location.search);
const число = (имя: string, по: number): number => {
  const v = параметры.get(имя);
  return v === null || v === '' ? по : Number(v);
};

const ТОЧКА = { x: число('x', 34), z: число('z', 26) };
const РЫСКАНИЕ = число('yaw', 0);
const НАКЛОН = число('pitch', 0.16);
const ДАЛЬНОСТЬ = число('dist', 9);
const ЧАС = число('hour', 15);
const ИМЯ_КАДРА = параметры.get('shot') ?? '';
const ЖДАТЬ_МС = число('wait', 12000);
/** Подъём камеры над обычной высотой глаз: обзор города сверху (camY). */
const ПОДЪЁМ = число('camY', 0);
/** Прошивать ли отложенный G-buffer: patch=0 оставляет материалы как есть. */
const ПРОШИВКА = число('patch', 1) !== 0;
const ШИРИНА = число('w', 1280);
const ВЫСОТА = число('h', 720);

const корень = document.getElementById('сцена') as HTMLElement;
корень.style.width = `${ШИРИНА}px`;
корень.style.height = `${ВЫСОТА}px`;

const сводка = document.getElementById('сводка') as HTMLElement;
const записать = (текст: string): void => {
  сводка.textContent = текст;
  console.log(`[стенд] ${текст}`);
};

const мир = new World3D();
мир.init(корень, {
  onAttack: () => {},
  onTarget: () => {},
  onTargetCleared: () => {},
});

// Внутренности движка: стенд читает их напрямую, чтобы не заводить в игре
// отладочный API ради временной страницы.
interface Внутренности {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: { render: () => void; setSize: (w: number, h: number) => void };
  renderer: THREE.WebGLRenderer;
  sky: {
    update: (dt: number, now: number, hour01: number, center: { x: number; z: number }) => void;
    sunDirection: THREE.Vector3;
    horizonColor: THREE.Color;
    overcast: number;
  };
  env: { update: (state: SkyState, dt: number) => void };
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  clockHour: number;
  patchWorldMaterials: (первый: boolean) => void;
}

const в = мир as unknown as Внутренности;
в.clockHour = ЧАС;

const цель = new THREE.Vector3(ТОЧКА.x, 0, ТОЧКА.z);
const НАВЕРХ = new THREE.Vector3(0, 1, 0);
const СМОТРЕТЬ = new THREE.Vector3(
  Math.sin(РЫСКАНИЕ) * Math.cos(НАКЛОН),
  -Math.sin(НАКЛОН),
  Math.cos(РЫСКАНИЕ) * Math.cos(НАКЛОН),
);

function поставитьКамеру(): void {
  цель.y = 1.7;
  const позиция = цель.clone().addScaledVector(СМОТРЕТЬ, -ДАЛЬНОСТЬ);
  // Камера не должна уехать под землю: смотрим с той стороны, откуда пришли.
  позиция.y = Math.max(позиция.y, цель.y + 0.6) + ПОДЪЁМ;
  в.camera.position.copy(позиция);
  в.camera.lookAt(цель);
  void НАВЕРХ;
}

/**
 * Один кадр мира: небо, свет и рендер — в том же порядке, что в update()
 * world3d. Без этого камера стоит в мире, у которого свет из инициализации,
 * и кадр не про то, что видит игрок.
 */
function кадр(now: number): void {
  поставитьКамеру();
  const час01 = в.clockHour / 24;
  в.sky.update(1 / 60, now, час01, { x: ТОЧКА.x, z: ТОЧКА.z });
  const sunDir = в.sky.sunDirection;
  const useMoon = sunDir.y < 0.05;
  const lightDir = useMoon ? sunDir.clone().multiplyScalar(-1) : sunDir;
  const dayI = Math.max(0, Math.min(1, sunDir.y * 2.2 + 0.5));
  const night = 1 - dayI;
  const dim = 1 - в.sky.overcast * 0.45;
  в.sun.intensity = (useMoon ? 0.12 : 0.25 + dayI * 2.95) * dim;
  в.hemi.intensity = (0.05 + dayI * 0.08) * (1 - в.sky.overcast * 0.3);
  в.sun.color.setHex(useMoon ? 0x9db4e8 : night > 0.4 ? 0xffc98a : 0xffe8c0);
  в.sun.position.set(
    ТОЧКА.x + lightDir.x * 120,
    Math.max(24, lightDir.y * 120),
    ТОЧКА.z + lightDir.z * 120,
  );
  в.sun.target.position.set(ТОЧКА.x, 0, ТОЧКА.z);
  const fog = в.scene.fog as THREE.Fog | null;
  if (fog) fog.color.copy(в.sky.horizonColor);
  в.env.update({
    sun: [sunDir.x, sunDir.y, sunDir.z],
    moon: [-sunDir.x, -sunDir.y, -sunDir.z],
    sunHeight: sunDir.y,
    night,
    overcast: в.sky.overcast,
    weather: 'clear',
  }, 1 / 60);
  в.composer.render();
}

let кадров = 0;
const старт = performance.now();

function цикл(): void {
  const прошло = performance.now() - старт;
  кадр(прошло);
  кадров++;
  // Модели приезжают по сети: до снимка ждём, пока они доедут и пока
  // отложенный проход не прошьёт их материалы.
  if (прошло < ЖДАТЬ_МС) {
    if (ПРОШИВКА && кадров % 30 === 0) в.patchWorldMaterials(false);
    requestAnimationFrame(цикл);
    return;
  }
  снять();
}

function снять(): void {
  // Прошивка отложенного G-buffer перед кадром: в headless кадров за
  // отведённое время мало (софтверный GL), и штатный тик раз в 30 кадров
  // может не случиться — тогда кадр снят с непрошитыми материалами, без
  // карт поверхностей. Мир на снимке должен быть тем же, что у игрока.
  if (ПРОШИВКА) в.patchWorldMaterials(false);
  const данные = в.renderer.domElement.toDataURL('image/jpeg', 0.92);
  записать(`кадр готов: ${кадров} кадров, ${Math.round(данные.length / 1024)} КБ`);
  if (!ИМЯ_КАДРА) {
    (window as unknown as { __кадр: string }).__кадр = данные;
    return;
  }
  void fetch(`http://127.0.0.1:8099/shot?name=${encodeURIComponent(ИМЯ_КАДРА)}`, {
    method: 'POST',
    body: данные,
  }).then(() => записать(`отправлено: ${ИМЯ_КАДРА}`))
    .catch((e) => записать(`приёмник не ответил: ${String(e)}`));
}

requestAnimationFrame(цикл);

// Стенд отдаёт сцену наружу: съёмочный скрипт спрашивает по ней, сколько в
// мире материалов с настоящими картами и сколько вызовов отрисовки. Без этого
// «плоско нарисовано» — вопрос вкуса, а с этим — число.
(window as unknown as { __стенд: unknown }).__стенд = {
  scene: в.scene,
  camera: в.camera,
  renderer: в.renderer,
};
