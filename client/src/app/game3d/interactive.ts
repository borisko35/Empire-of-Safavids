// Интерактивные объекты: ящики, кувшины с маслом, навесы.
// Объекты, с которыми игрок может взаимодействовать кликом по центру экрана.
// §334: все три — готовые GLB-модели (crate, clay-jug, trade-tent).

import * as THREE from 'three';
import { M } from './interiors';
import { loadDecorModel } from './terrain';

/** Тип интерактивного объекта. */
export type InteractiveKind =
  | 'crate'           // толкаемый ящик
  | 'oil_jug'         // кувшин с маслом (поджигается)
  | 'awning';         // навес (рушится при ударе)

/** Данные интерактивного объекта (в userData). */
export interface InteractiveData {
  kind: InteractiveKind;
  state: 'intact' | 'burning' | 'collapsed' | 'broken';
  mass?: number;           // для ящиков
  burnTime?: number;       // для кувшинов
  collapseForce?: number;  // для навесов
}

/** Создать толкаемый ящик (GLB). */
export function createCrate(
  x: number, y: number, z: number,
  w = 0.8, h = 0.8, d = 0.8,
  ry = 0
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;

  // Плейсхолдер для мгновенного отображения: простой бокс
  const placeholder = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    M.wood
  );
  placeholder.castShadow = true;
  placeholder.receiveShadow = true;
  g.add(placeholder);

  // Асинхронная подмена на GLB-модель
  void loadDecorModel('models/decor/crate.glb').then((модель) => {
    if (!модель) return;
    g.remove(placeholder);
    const вещь = модель.clone();
    вещь.scale.setScalar(1);
    вещь.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    g.add(вещь);
  });

  g.userData = {
    kind: 'crate',
    state: 'intact',
    mass: 50,
  } as InteractiveData;

  return g;
}

/** Создать кувшин с маслом (поджигается) — GLB. */
export function createOilJug(
  x: number, y: number, z: number,
  ry = 0
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;

  // Плейсхолдер: цилиндр
  const placeholder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.35, 0.7, 12),
    M.woodDark
  );
  placeholder.position.y = 0.35;
  placeholder.castShadow = true;
  placeholder.receiveShadow = true;
  g.add(placeholder);

  void loadDecorModel('models/decor/clay-jug.glb').then((модель) => {
    if (!модель) return;
    g.remove(placeholder);
    const вещь = модель.clone();
    вещь.scale.setScalar(1);
    вещь.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    g.add(вещь);
  });

  g.userData = {
    kind: 'oil_jug',
    state: 'intact',
    burnTime: 10,
  } as InteractiveData;

  return g;
}

/** Создать навес (рушится при ударе) — GLB (trade-tent). */
export function createAwning(
  x: number, y: number, z: number,
  w = 4, d = 2.5,
  ry = 0
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;

  // Плейсхолдер: четыре столба
  const postMat = M.woodDark;
  for (const [px, pz] of [[-w/2, -d/2], [w/2, -d/2], [-w/2, d/2], [w/2, d/2]] as const) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.15, 2.5, 8),
      postMat
    );
    post.position.set(px, 1.25, pz);
    post.castShadow = true;
    post.receiveShadow = true;
    g.add(post);
  }

  void loadDecorModel('models/decor/trade-tent.glb').then((модель) => {
    if (!модель) return;
    // Удаляем плейсхолдеры (столбы)
    while (g.children.length) g.remove(g.children[0]);
    const вещь = модель.clone();
    вещь.scale.setScalar(1);
    вещь.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    g.add(вещь);
  });

  g.userData = {
    kind: 'awning',
    state: 'intact',
    collapseForce: 150,
  } as InteractiveData;

  return g;
}

/** Зарегистрировать интерактивный объект в системе кликов. */
export function registerInteractive(
  obj: THREE.Object3D,
  kind: InteractiveKind,
  extraData: Record<string, unknown> = {}
): void {
  obj.userData = {
    ...obj.userData,
    kind,
    state: 'intact',
    ...extraData,
  } as InteractiveData;
}

/** Проверить, является ли объект интерактивным. */
export function isInteractive(obj: THREE.Object3D): obj is THREE.Object3D & { userData: InteractiveData } {
  return !!obj.userData?.kind;
}

/** Получить тип интерактивного объекта. */
export function getInteractiveKind(obj: THREE.Object3D): InteractiveKind | null {
  return (obj.userData?.kind as InteractiveKind) ?? null;
}

/** Получить состояние интерактивного объекта. */
export function getInteractiveState(obj: THREE.Object3D): string | null {
  return (obj.userData?.state as string) ?? null;
}

/** Установить состояние интерактивного объекта. */
export function setInteractiveState(
  obj: THREE.Object3D,
  state: InteractiveData['state']
): void {
  if (obj.userData) {
    obj.userData.state = state;
  }
}