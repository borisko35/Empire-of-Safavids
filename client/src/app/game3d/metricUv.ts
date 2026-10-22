// ============================================================
// Метрический UV: текстура в метрах, а не «растянуть на грань»
// ============================================================
//
// ЗАЧЕМ. three.js по умолчанию кладёт UV каждой грани коробки в 0..1.
// Значит рисунок кирпича растягивается на всю стену: на доме 6 метров
// кирпич крупный, на доме 12 — вдвое крупнее. Глаз видит не стену, а
// растянутую картинку, и разные дома перестают быть из одного города.
//
// ЧТО ДЕЛАЕТ. Пересчитывает UV так, чтобы один повтор текстуры занимал
// tile метров на любой грани. Тогда кирпич и штукатурка одного размера
// на всех домах, башнях и заборах, а материал используется с repeat = 1.
//
// ПОЧЕМУ НЕ SHADER-ТРИПЛАНАР. Трипланар даёт бесшовность на косых
// поверхностях, но требует своей нормали-карты в шейдере и ломает
// штатное затенение MeshStandardMaterial. Здесь все стены — осевые
// коробки и цилиндры, и честного UV достаточно.

import * as THREE from 'three';

/**
 * Пересчитать UV коробки в метрах.
 *
 * Порядок граней у BoxGeometry: +X, -X, +Y, -Y, +Z, -Z, по четыре
 * вершины на грань. Для боковых граней U идёт по глубине, V по высоте;
 * для верхней и нижней U по ширине, V по глубине.
 */
export function metricBoxUV(
  geometry: THREE.BufferGeometry,
  w: number,
  h: number,
  d: number,
  tile: number,
): THREE.BufferGeometry {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv || uv.count !== 24) return geometry;
  const шаг = Math.max(0.01, tile);
  // [сколько метров по U, сколько по V] на каждую грань
  const грани: Array<[number, number]> = [
    [d, h], [d, h],   // +X, -X
    [w, d], [w, d],   // +Y, -Y
    [w, h], [w, h],   // +Z, -Z
  ];
  for (let грань = 0; грань < 6; грань++) {
    const [поU, поV] = грани[грань];
    for (let i = 0; i < 4; i++) {
      const индекс = грань * 4 + i;
      uv.setXY(индекс, uv.getX(индекс) * (поU / шаг), uv.getY(индекс) * (поV / шаг));
    }
  }
  uv.needsUpdate = true;
  return geometry;
}

/**
 * Пересчитать UV цилиндра в метрах: окружность и высота.
 *
 * Крышки при этом тоже масштабируются — их UV считаются от радиуса, и
 * выходит почти правильный масштаб. Для башен, колонн и чаш этого
 * достаточно: крышки закрыты настилом или водой.
 */
export function metricCylinderUV(
  geometry: THREE.BufferGeometry,
  radius: number,
  height: number,
  tile: number,
): THREE.BufferGeometry {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) return geometry;
  const шаг = Math.max(0.01, tile);
  const поОкружности = (Math.PI * 2 * radius) / шаг;
  const поВысоте = height / шаг;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * поОкружности, uv.getY(i) * поВысоте);
  }
  uv.needsUpdate = true;
  return geometry;
}
