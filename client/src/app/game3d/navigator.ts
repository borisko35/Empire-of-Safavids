// ============================================================
// Стрелка-навигатор по активному квесту — Empire of Safavids
// ============================================================
// Золотая стрелка парит над игроком и ведёт к цели текущего квеста.
// Маршрут строится по опорным точкам, а не по прямой: через городские
// ворота (а не сквозь стену) и в обход озера. Пунктирная линия пути
// рисуется на земле, стрелка смотрит на ближайшую точку маршрута.

import * as THREE from 'three';
import { CITY, CITY_INNER, GATE, LAKE, groundHeight } from './terrain';

export interface NavTarget {
  x: number;
  z: number;
  label: string;
}

export interface NavigatorHandle {
  setTarget(target: NavTarget | null): void;
  update(now: number, player: { x: number; z: number }): void;
  /** Текущий построенный маршрут (для мини-карты) */
  getRoute(): Pt[];
  dispose(): void;
}

interface Pt { x: number; z: number }

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Расстояние от центра круга до отрезка (для проверки пересечений) */
function segCircleDist(a: Pt, b: Pt, c: Pt): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((c.x - a.x) * dx + (c.z - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + dx * t - c.x, a.z + dz * t - c.z);
}

/** Маршрут от игрока к цели: ворота + обход озера */
function buildRoute(from: Pt, to: Pt): Pt[] {
  const cityC: Pt = { x: CITY.x, z: CITY.z };
  // Граница города — ВНУТРЕННЯЯ грань кладки, а не ось стены.
  //
  // Раньше здесь стояло `CITY.radius - 2`, и это было верно только пока стена
  // имела нулевую толщину. Теперь кладка занимает 13.06 м: ось 116, внутренняя
  // грань 109.47. Со старой строкой навигатор считал городом 4.5 м камня, и
  // маршрут между точкой «внутри кладки» и точкой «в поле» шёл напрямую —
  // то есть сквозь стену в стороне от ворот. Минус два метра оставлен как
  // запас, чтобы путь не липла к самой грани.
  const граница = CITY_INNER - 2;
  const inCity = (p: Pt): boolean => dist(p, cityC) < граница;
  const pts: Pt[] = [];

  // Через стену — только в ворота
  if (inCity(from) !== inCity(to)) {
    pts.push({ x: GATE.x, z: GATE.z });
  } else if (!inCity(from) && segCircleDist(from, to, cityC) < граница) {
    pts.push({ x: GATE.x, z: GATE.z });
  }
  pts.push(to);

  // Обход озера для каждого отрезка (макс. 2 объезда — озера два нет, одно)
  const routed: Pt[] = [from];
  for (const p of pts) {
    let cur = routed[routed.length - 1];
    // до двух попыток объезда на отрезок
    for (let attempt = 0; attempt < 2; attempt++) {
      if (segCircleDist(cur, p, { x: LAKE.x, z: LAKE.z }) > LAKE.r + 8) break;
      // Середина отрезка, вытолкнутая от центра озера
      const mx = (cur.x + p.x) / 2, mz = (cur.z + p.z) / 2;
      let ox = mx - LAKE.x, oz = mz - LAKE.z;
      let len = Math.hypot(ox, oz);
      if (len < 1) { ox = 1; oz = 0; len = 1; } // середина в центре озера
      const detour: Pt = { x: LAKE.x + (ox / len) * (LAKE.r + 20), z: LAKE.z + (oz / len) * (LAKE.r + 20) };
      routed.push(detour);
      cur = detour;
    }
    routed.push(p);
  }
  // Убрать дубли подряд
  return routed.filter((p, i) => i === 0 || dist(p, routed[i - 1]) > 1);
}

export function createNavigator(scene: THREE.Scene): NavigatorHandle {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xc9a84c, emissive: 0xd89118, emissiveIntensity: 0.9,
    roughness: 0.35, metalness: 0.35,
  });
  // Древко и наконечник (стрелка смотрит вдоль +Z)
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 1.0), mat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 4), mat);
  head.rotation.x = Math.PI / 2;
  head.position.z = 0.75;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.12), mat);
  tail.position.z = -0.5;
  group.add(shaft, head, tail);
  // Стрелка уменьшена и поднята: раньше она висела в 3.15 м над землёй
  // при длине около 2 м, то есть перекрывала голову и корпус персонажа —
  // на близкой камере это выглядело как гигантская фигура поверх героя.
  group.scale.setScalar(0.5);
  group.visible = false;
  scene.add(group);

  // Пунктирная линия пути на земле
  const lineMat = new THREE.LineDashedMaterial({ color: 0xffd980, dashSize: 1.2, gapSize: 0.9, transparent: true, opacity: 0.9 });
  let line: THREE.Line | null = null;
  let lastBuiltKey = '';

  let target: NavTarget | null = null;
  let route: Pt[] = [];

  const rebuildLine = (r: Pt[]): void => {
    if (line) {
      scene.remove(line);
      line.geometry.dispose();
      line = null;
    }
    if (r.length < 2) return;
    const verts: number[] = [];
    for (const p of r) {
      verts.push(p.x, groundHeight(p.x, p.z) + 0.35, p.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    line = new THREE.Line(geo, lineMat);
    line.computeLineDistances();
    scene.add(line);
  };

  return {
    setTarget(t: NavTarget | null): void {
      target = t;
      route = [];
      group.visible = !!t;
      lastBuiltKey = '';
      if (!t && line) {
        scene.remove(line);
        line.geometry.dispose();
        line = null;
      }
    },

    update(now: number, player: { x: number; z: number }): void {
      if (!target) return;
      const from: Pt = { x: player.x, z: player.z };
      route = buildRoute(from, target);
      // Перестраиваем линию, если игрок заметно сдвинулся или цель сменилась
      const key = `${target.x.toFixed(0)},${target.z.toFixed(0)}|${(player.x / 4).toFixed(0)},${(player.z / 4).toFixed(0)}`;
      if (key !== lastBuiltKey) {
        lastBuiltKey = key;
        rebuildLine(route);
      }
      // Стрелка смотрит на ближайшую точку маршрута (а не сквозь стену)
      const next = route.length > 1 ? route[1] : target;
      group.rotation.y = Math.atan2(next.x - player.x, next.z - player.z);
      // 4.3 м — над головой (персонаж ~1.9 м) и с запасом, чтобы стрелка
      // не наезжала на плечи вблизи
      group.position.set(player.x, 4.3 + Math.sin(now / 300) * 0.14, player.z);
      mat.emissiveIntensity = 0.8 + Math.sin(now / 170) * 0.3;
    },

    getRoute(): Pt[] {
      return route;
    },

    dispose(): void {
      shaft.geometry.dispose();
      head.geometry.dispose();
      tail.geometry.dispose();
      mat.dispose();
      lineMat.dispose();
      if (line) { scene.remove(line); line.geometry.dispose(); }
      scene.remove(group);
    },
  };
}
