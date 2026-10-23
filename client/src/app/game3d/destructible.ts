// Destructible decor: crates, barrels, vases, furniture, windows, doors.
// Objects that can be broken by hits, set on fire, smashed windows.

import * as THREE from 'three';
import { M } from './interiors';

/** Type of destructible decor. */
export type DestructibleKind =
  | 'crate'       // wooden crate (already in interactive, but here with HP)
  | 'barrel'      // barrel (explodes/burns)
  | 'vase'        // vase/jug (shatters in one hit)
  | 'furniture'   // furniture (chair, table, bed)
  | 'window'      // window (smashable)
  | 'door'        // door (breakable)
  | 'chandelier'  // chandelier (falls)
  | 'bookshelf';  // bookshelf (collapses)

/** State of destructible object. */
export type DestructibleState = 'intact' | 'damaged' | 'broken' | 'burning';

/** Destructible object data (in userData). */
export interface DestructibleData {
  kind: DestructibleKind;
  state: DestructibleState;
  maxHealth: number;
  health: number;
  /** Materials for each state (optional). */
  materials?: {
    intact?: THREE.Material;
    damaged?: THREE.Material;
    broken?: THREE.Material;
    burning?: THREE.Material;
  };
  /** Callback when broken (spawn loot, effects, sound). */
  onBreak?: (obj: THREE.Object3D) => void;
  /** Fire damage per second. */
  fireDPS?: number;
  /** Can it burn. */
  flammable?: boolean;
  /** Explodes when destroyed. */
  explosive?: boolean;
}

/** Base health config per type. */
const KIND_CONFIG: Record<DestructibleKind, { health: number; flammable: boolean; explosive: boolean; fireDPS: number }> = {
  crate:     { health: 50,  flammable: true,  explosive: false, fireDPS: 5 },
  barrel:    { health: 30,  flammable: true,  explosive: true,  fireDPS: 15 },
  vase:      { health: 10,  flammable: false, explosive: false, fireDPS: 0 },
  furniture: { health: 80,  flammable: true,  explosive: false, fireDPS: 8 },
  window:    { health: 5,   flammable: false, explosive: false, fireDPS: 0 },
  door:      { health: 100, flammable: true,  explosive: false, fireDPS: 10 },
  chandelier:{ health: 20,  flammable: false, explosive: false, fireDPS: 0 },
  bookshelf: { health: 60,  flammable: true,  explosive: false, fireDPS: 10 },
};

/** Create destructible crate. */
export function createDestructibleCrate(
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

  const cfg = KIND_CONFIG.crate;
  g.userData = {
    kind: 'crate',
    state: 'intact',
    maxHealth: cfg.health,
    health: cfg.health,
    flammable: cfg.flammable,
    explosive: cfg.explosive,
    fireDPS: cfg.fireDPS,
  } as DestructibleData;

  return g;
}

/** Create destructible barrel. */
export function createDestructibleBarrel(
  x: number, y: number, z: number,
  ry = 0
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.6, 1.0, 12),
    M.woodDark
  );
  body.position.y = 0.5;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Hoop
  const hoop = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.04, 8, 16),
    M.iron
  );
  hoop.position.y = 0.5;
  hoop.rotation.x = Math.PI / 2;
  hoop.castShadow = true;
  g.add(hoop);

  const cfg = KIND_CONFIG.barrel;
  g.userData = {
    kind: 'barrel',
    state: 'intact',
    maxHealth: cfg.health,
    health: cfg.health,
    flammable: cfg.flammable,
    explosive: cfg.explosive,
    fireDPS: cfg.fireDPS,
  } as DestructibleData;

  return g;
}

/** Create destructible vase/jug. */
export function createDestructibleVase(
  x: number, y: number, z: number,
  ry = 0
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.3, 0.6, 12),
    M.wood
  );
  body.position.y = 0.3;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.12, 0.2, 12),
    M.wood
  );
  neck.position.y = 0.7;
  neck.castShadow = true;
  g.add(neck);

  const cfg = KIND_CONFIG.vase;
  g.userData = {
    kind: 'vase',
    state: 'intact',
    maxHealth: cfg.health,
    health: cfg.health,
    flammable: cfg.flammable,
    explosive: cfg.explosive,
    fireDPS: cfg.fireDPS,
  } as DestructibleData;

  return g;
}

/** Create destructible furniture (chair/table/bed). */
export function createDestructibleFurniture(
  x: number, y: number, z: number,
  kind: 'chair' | 'table' | 'bed',
  ry = 0
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;

  if (kind === 'chair') {
    // Legs
    for (const [lx, lz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]] as const) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8),
        M.woodDark
      );
      leg.position.set(lx, 0.5, lz);
      leg.castShadow = true;
      g.add(leg);
    }
    // Seat
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.08, 0.7),
      M.wood
    );
    seat.position.y = 1.0;
    seat.castShadow = true;
    g.add(seat);
    // Back
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.8, 0.08),
      M.wood
    );
    back.position.set(0, 1.5, -0.3);
    back.castShadow = true;
    g.add(back);
  } else if (kind === 'table') {
    // Legs
    for (const [lx, lz] of [[-0.7, -0.5], [0.7, -0.5], [-0.7, 0.5], [0.7, 0.5]] as const) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.75, 8),
        M.woodDark
      );
      leg.position.set(lx, 0.375, lz);
      leg.castShadow = true;
      g.add(leg);
    }
    // Tabletop
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.1, 1.2),
      M.wood
    );
    top.position.y = 0.8;
    top.castShadow = true;
    g.add(top);
  } else if (kind === 'bed') {
    // Bed frame
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.5, 2.0),
      M.woodDark
    );
    frame.position.y = 0.25;
    frame.castShadow = true;
    g.add(frame);
    // Mattress
    const mattress = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.2, 1.9),
      M.red
    );
    mattress.position.y = 0.6;
    mattress.castShadow = true;
    g.add(mattress);
  }

  const cfg = KIND_CONFIG.furniture;
  g.userData = {
    kind: 'furniture',
    state: 'intact',
    maxHealth: cfg.health,
    health: cfg.health,
    flammable: cfg.flammable,
    explosive: cfg.explosive,
    fireDPS: cfg.fireDPS,
  } as DestructibleData;

  return g;
}

/** Create destructible window. */
export function createDestructibleWindow(
  x: number, y: number, z: number,
  w = 1.0, h = 1.5,
  ry = 0
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;

  // Frame
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.1, h + 0.1, 0.1),
    M.woodDark
  );
  frame.castShadow = true;
  frame.receiveShadow = true;
  g.add(frame);

  // Glass - use basic transparent material
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x70a0f0, transparent: true, opacity: 0.7 });
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.05),
    glassMat
  );
  glass.position.z = 0.025;
  glass.castShadow = true;
  glass.receiveShadow = true;
  g.add(glass);

  // Mullion
  const mullion = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, h, 0.1),
    M.woodDark
  );
  mullion.castShadow = true;
  g.add(mullion);
  const transom = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.05, 0.1),
    M.woodDark
  );
  transom.castShadow = true;
  g.add(transom);

  const cfg = KIND_CONFIG.window;
  g.userData = {
    kind: 'window',
    state: 'intact',
    maxHealth: cfg.health,
    health: cfg.health,
    flammable: cfg.flammable,
    explosive: cfg.explosive,
    fireDPS: cfg.fireDPS,
  } as DestructibleData;

  return g;
}

/** Register destructible object. */
export function registerDestructible(
  obj: THREE.Object3D,
  kind: DestructibleKind,
  extraData: Partial<DestructibleData> = {}
): void {
  const cfg = KIND_CONFIG[kind];
  obj.userData = {
    ...obj.userData,
    kind,
    state: 'intact',
    maxHealth: cfg.health,
    health: cfg.health,
    flammable: cfg.flammable,
    explosive: cfg.explosive,
    fireDPS: cfg.fireDPS,
    ...extraData,
  } as DestructibleData;
}

/** Damage destructible object. */
export function damageDestructible(
  obj: THREE.Object3D,
  damage: number,
  damageType: 'physical' | 'fire' | 'explosion' = 'physical'
): { broken: boolean; newState: DestructibleState } {
  const data = obj.userData as DestructibleData;
  if (!data || data.state === 'broken') return { broken: false, newState: data.state };

  // Fire damage with flammability check
  let dmg = damage;
  if (damageType === 'fire') {
    if (!data.flammable) return { broken: false, newState: data.state };
    dmg = data.fireDPS || 5;
  }

  data.health = Math.max(0, data.health - dmg);

  // Determine new state
  let newState: DestructibleState = data.state;
  if (data.health <= 0) {
    newState = 'broken';
  } else if (data.health < data.maxHealth * 0.5) {
    newState = 'damaged';
  }

  data.state = newState;

  return { broken: newState === 'broken', newState };
}

/** Check if object is destructible. */
export function isDestructible(obj: THREE.Object3D): obj is THREE.Object3D & { userData: DestructibleData } {
  return !!obj.userData?.kind && 'health' in obj.userData;
}

/** Get destructible kind. */
export function getDestructibleKind(obj: THREE.Object3D): DestructibleKind | null {
  return (obj.userData?.kind as DestructibleKind) ?? null;
}

/** Get destructible state. */
export function getDestructibleState(obj: THREE.Object3D): DestructibleState | null {
  return (obj.userData?.state as DestructibleState) ?? null;
}

/** Set destructible state. */
export function setDestructibleState(
  obj: THREE.Object3D,
  state: DestructibleState
): void {
  if (obj.userData) {
    obj.userData.state = state;
  }
}

/** Apply visual changes for state. */
export function applyDestructibleVisuals(obj: THREE.Object3D): void {
  const data = obj.userData as DestructibleData;
  if (!data) return;

  obj.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const mat = child.material as THREE.MeshStandardMaterial;
    if (!mat) return;

    switch (data.state) {
      case 'damaged':
        // Darkening and cracks (simplified: darkening)
        mat.emissive.setHex(0x1a0a0a);
        mat.emissiveIntensity = 0.3;
        break;
      case 'broken':
        // Broken look: dark, no reflections
        mat.color.multiplyScalar(0.4);
        mat.roughness = 1;
        mat.metalness = 0;
        mat.emissive.setHex(0x000000);
        break;
      case 'burning':
        // Burning look
        mat.emissive.setHex(0xff3300);
        mat.emissiveIntensity = 1.0;
        break;
      default:
        // Restore original look (only for intact)
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
    }
  });
}

/** Create break effect (debris, dust). */
export function createBreakEffect(
  _obj: THREE.Object3D,
  position: THREE.Vector3
): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(position);

  // Debris
  for (let i = 0; i < 8; i++) {
    const piece = new THREE.Mesh(
      new THREE.BoxGeometry(
        0.1 + Math.random() * 0.3,
        0.05,
        0.1 + Math.random() * 0.3
      ),
      M.wood
    );
    piece.position.set(
      (Math.random() - 0.5) * 0.5,
      0.1 + Math.random() * 0.3,
      (Math.random() - 0.5) * 0.5
    );
    piece.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    piece.castShadow = true;
    g.add(piece);
  }

  // Dust (using wood material as placeholder since M.smoke doesn't exist)
  const dust = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 1.0, 0.5, 8),
    M.wood
  );
  dust.position.y = 0.25;
  dust.castShadow = false;
  g.add(dust);

  return g;
}