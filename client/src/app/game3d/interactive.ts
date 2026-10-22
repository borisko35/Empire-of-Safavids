// Интерактивные объекты: ящики, кувшины с маслом, навесы.
// Объекты, с которыми игрок может взаимодействовать кликом по центру экрана.

import * as THREE from 'three';
import { M } from './interiors';

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

/** Создать толкаемый ящик. */
export function createCrate(
  x: number, y: number, z: number,
  w = 0.8, h = 0.8, d = 0.8,
  ry = 0
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    M.wood
  );
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const edgeMat = M.woodDark;
  const t = 0.04;
  for (const [ex, ez] of [[-w/2, -d/2], [w/2, -d/2], [-w/2, d/2], [w/2, d/2]] as const) {
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(t, h, t),
      edgeMat
    );
    edge.position.set(ex, 0, ez);
    edge.castShadow = true;
    g.add(edge);
  }
  for (const [ex, ez] of [[-w/2, -d/2], [w/2, -d/2], [-w/2, d/2], [w/2, d/2]] as const) {
    for (const ey of [h/2, -h/2] as const) {
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(w, t, t),
        edgeMat
      );
      edge.position.set(ex, ey, ez);
      edge.castShadow = true;
      g.add(edge);
    }
    for (const ey of [h/2, -h/2] as const) {
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(t, t, d),
        edgeMat
      );
      edge.position.set(ex, ey, ez);
      edge.castShadow = true;
      g.add(edge);
    }
  }

  g.userData = {
    kind: 'crate',
    state: 'intact',
    mass: 50,
  } as InteractiveData;

  return g;
}

/** Создать кувшин с маслом (поджигается). */
export function createOilJug(
  x: number, y: number, z: number,
  ry = 0
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.35, 0.7, 12),
    M.woodDark
  );
  body.position.y = 0.35;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.12, 0.2, 12),
    M.woodDark
  );
  neck.position.y = 0.8;
  neck.castShadow = true;
  g.add(neck);

  const cork = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.08, 12),
    M.red
  );
  cork.position.y = 0.92;
  cork.castShadow = true;
  g.add(cork);

  const handle = new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.02, 6, 12),
    M.iron
  );
  handle.position.set(0.25, 0.45, 0);
  handle.rotation.x = Math.PI / 2;
  handle.castShadow = true;
  g.add(handle);

  g.userData = {
    kind: 'oil_jug',
    state: 'intact',
    burnTime: 10,
  } as InteractiveData;

  return g;
}

/** Создать навес (рушится при ударе). */
export function createAwning(
  x: number, y: number, z: number,
  w = 4, d = 2.5,
  ry = 0
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;

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

  const frameMat = M.woodDark;
  const frameH = 0.15;
  for (const [px, pz] of [[-w/2, -d/2], [w/2, -d/2], [-w/2, d/2], [w/2, d/2]] as const) {
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(w, frameH, frameH),
      frameMat
    );
    beam.position.set(px, 2.5, pz);
    beam.castShadow = true;
    g.add(beam);
  }
  for (const [px, pz] of [[-w/2, -d/2], [w/2, -d/2], [-w/2, d/2], [w/2, d/2]] as const) {
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(frameH, frameH, d),
      frameMat
    );
    beam.position.set(px, 2.5, pz);
    beam.castShadow = true;
    g.add(beam);
  }

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.4, 0.1, d + 0.4),
    M.hay
  );
  roof.position.y = 2.55;
  roof.castShadow = true;
  roof.receiveShadow = true;
  g.add(roof);

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