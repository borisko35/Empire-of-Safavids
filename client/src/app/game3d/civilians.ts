// ============================================================
// Горожане — Empire of Safavids
// ============================================================
// "Не квестовые" NPC: гуляют по Исфахану, стоят, разговаривают
// друг с другом (пара встаёт лицом друг к другу + облачко реплики).
// Некликабельны, дают городу жизнь. Коллайдеры — динамические,
// как у фауны (CIV_COLLIDERS в terrain.ts).

import * as THREE from 'three';
import { CITY, CIV_COLLIDERS, COLLIDERS, groundHeight, waterMask } from './terrain';

interface Civilian {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  bubble: THREE.Sprite;
  bubbleUntil: number;
  state: 'idle' | 'walk' | 'talk';
  target: { x: number; z: number };
  speed: number;
  stateUntil: number;
  talkWith: Civilian | null;
  phase: number;
}

export interface CiviliansHandle {
  update(dt: number, now: number): void;
  dispose(): void;
}

const PHRASES = [
  'Салам!',
  'Как торговля?',
  'Слава шаху!',
  'Жаркий день…',
  'Слышал новости?',
  'Хвала небесам!',
  'Хорошая цена!',
  'Дорогу, дорогу…',
];

const TUNICS = [0x8b6f4e, 0x4e6f8b, 0x7a4e6e, 0x4e8b6f, 0x9c8a5a, 0x6e4e8b, 0x8b4e5a, 0x5a7a8b];
const SKIN = [0xe4b284, 0xc89878, 0xa87858];
const HAIR = [0x2a2018, 0x4a3220, 0x6e563a, 0x8a8a8a];
const PANTS = [0x3a3630, 0x4a4438, 0x2e3a4a];

function makeBubble(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(2.6, 1.0, 1);
  sp.visible = false;
  (sp as THREE.Sprite & { setText?: (t: string) => void }).setText = (t: string) => {
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 256, 96);
    g.fillStyle = 'rgba(245, 240, 232, 0.95)';
    g.beginPath();
    g.roundRect(6, 6, 244, 62, 14);
    g.fill();
    g.beginPath();
    g.moveTo(108, 68); g.lineTo(128, 90); g.lineTo(148, 68);
    g.fill();
    g.fillStyle = '#2a2018';
    g.font = 'bold 24px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const short = t.length > 14 ? t.slice(0, 13) + '…' : t;
    g.fillText(short, 128, 38);
    tex.needsUpdate = true;
  };
  return sp;
}

const HOME_R = 85;

/** Выталкивание из статичных коллайдеров (дома, стены, фонтан). */
function resolveStatic(x: number, z: number, r: number): { x: number; z: number } {
  let px = x, pz = z;
  for (let pass = 0; pass < 2; pass++) {
    let pushed = false;
    for (const c of COLLIDERS) {
      const dx = px - c.x, dz = pz - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + r;
      if (d < min) {
        if (d > 1e-4) {
          px = c.x + (dx / d) * min;
          pz = c.z + (dz / d) * min;
        } else {
          px = c.x + min;
        }
        pushed = true;
      }
    }
    if (!pushed) break;
  }
  return { x: px, z: pz };
}

function freeSpot(cx: number, cz: number): { x: number; z: number } {
  candidates: for (let tries = 0; tries < 12; tries++) {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * (HOME_R - 8);
    const x = CITY.x + Math.cos(a) * r;
    const z = CITY.z + Math.sin(a) * r;
    // Не в фонтане, не в мечети, не в воде, не внутри построек
    if (Math.hypot(x - (CITY.x + 6), z - (CITY.z + 6)) < 7) continue;
    if (Math.abs(x - CITY.x) < 14 && Math.abs(z - (CITY.z - 8)) < 11) continue;
    if (waterMask(x, z) > 0.2) continue;
    for (const c of COLLIDERS) {
      if (Math.hypot(x - c.x, z - c.z) < c.r + 1.2) continue candidates;
    }
    return { x, z };
  }
  return { x: cx, z: cz };
}

export function createCivilians(scene: THREE.Scene): CiviliansHandle {
  const all = new THREE.Group();
  scene.add(all);
  const civs: Civilian[] = [];
  const COUNT = 8;

  for (let i = 0; i < COUNT; i++) {
    const g = new THREE.Group();
    const tunic = TUNICS[i % TUNICS.length];
    const skin = SKIN[i % SKIN.length];
    const hairC = HAIR[i % HAIR.length];
    const pantsC = PANTS[i % PANTS.length];
    const tunicMat = new THREE.MeshStandardMaterial({ color: tunic, roughness: 1 });
    const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.9 });
    const hairMat = new THREE.MeshStandardMaterial({ color: hairC, roughness: 1 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: pantsC, roughness: 1 });

    // Туловище: халат + пояс
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.36, 1.0, 8), tunicMat);
    body.position.y = 1.05;
    body.castShadow = true;
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 8), pantsMat);
    belt.position.y = 0.72;
    g.add(body, belt);

    // Ноги на шарнирах в бёдрах (для походки)
    const mkLeg = (sx: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.13, 0.55, 0);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.15), pantsMat);
      leg.position.y = -0.27;
      leg.castShadow = true;
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.24), hairMat);
      shoe.position.set(0, -0.52, 0.04);
      pivot.add(leg, shoe);
      g.add(pivot);
      return pivot;
    };
    const legL = mkLeg(-1);
    const legR = mkLeg(1);

    // Руки на шарнирах в плечах
    const mkArm = (sx: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.36, 1.42, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.58, 0.12), tunicMat);
      arm.position.y = -0.27;
      arm.castShadow = true;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), skinMat);
      hand.position.y = -0.58;
      pivot.add(arm, hand);
      g.add(pivot);
      return pivot;
    };
    const armL = mkArm(-1);
    const armR = mkArm(1);

    // Голова + лицо: глаза, рот, волосы, борода у каждого второго
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), skinMat);
    head.position.y = 1.72;
    head.castShadow = true;
    g.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1410 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 5), eyeMat);
      eye.position.set(sx * 0.075, 1.75, 0.185);
      g.add(eye);
    }
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.022, 0.012),
      new THREE.MeshBasicMaterial({ color: 0x7a3a2a }),
    );
    mouth.position.set(0, 1.64, 0.2);
    g.add(mouth);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.215, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), hairMat);
    hair.position.y = 1.74;
    g.add(hair);
    if (i % 2 === 0) {
      const beard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.06), hairMat);
      beard.position.set(0, 1.56, 0.17);
      g.add(beard);
    } else {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.14, 8), hairMat);
      cap.position.y = 1.9;
      g.add(cap);
    }
    const bubble = makeBubble();
    bubble.position.y = 2.45;
    g.add(bubble);
    const p = freeSpot(CITY.x, CITY.z);
    g.position.set(p.x, groundHeight(p.x, p.z), p.z);
    g.rotation.y = Math.random() * Math.PI * 2;
    all.add(g);
    civs.push({
      group: g, body, head, legL, legR, armL, armR, bubble, bubbleUntil: 0,
      state: 'idle', target: { x: p.x, z: p.z },
      speed: 1.1 + Math.random() * 0.7,
      stateUntil: 0, talkWith: null, phase: Math.random() * 10,
    });
  }

  let talkTimer = 5000;

  function face(a: Civilian, x: number, z: number): void {
    const want = Math.atan2(x - a.group.position.x, z - a.group.position.z);
    let d = want - a.group.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    a.group.rotation.y += d * 0.15;
  }

  function update(dt: number, now: number): void {
    CIV_COLLIDERS.length = 0;

    // Разговоры: раз в 6-10с пара стоящих рядом начинает болтать
    talkTimer -= dt * 1000;
    if (talkTimer <= 0) {
      talkTimer = 6000 + Math.random() * 4000;
      const idle = civs.filter(c => c.state === 'idle');
      outer: for (let i = 0; i < idle.length; i++) {
        for (let j = i + 1; j < idle.length; j++) {
          const a = idle[i], b = idle[j];
          const d = Math.hypot(a.group.position.x - b.group.position.x, a.group.position.z - b.group.position.z);
          if (d < 10) {
            const dur = 3500 + Math.random() * 2500;
            for (const [me, you] of [[a, b], [b, a]] as const) {
              me.state = 'talk';
              me.talkWith = you;
              me.stateUntil = now + dur;
              me.bubble.visible = true;
              (me.bubble as THREE.Sprite & { setText?: (t: string) => void }).setText?.(
                PHRASES[Math.floor(Math.random() * PHRASES.length)],
              );
              me.bubbleUntil = now + dur;
            }
            break outer;
          }
        }
      }
    }

    for (const c of civs) {
      CIV_COLLIDERS.push({ x: c.group.position.x, z: c.group.position.z, r: 0.5 });

      if (c.state === 'talk') {
        if (c.talkWith) face(c, c.talkWith.group.position.x, c.talkWith.group.position.z);
        c.body.position.y = 1.05 + Math.sin(now / 300 + c.phase) * 0.02;
        // Жестикуляция: правая рука поднята
        c.armR.rotation.x = -0.9 + Math.sin(now / 250 + c.phase) * 0.25;
        c.armL.rotation.x *= 0.9;
        c.legL.rotation.x *= 0.9;
        c.legR.rotation.x *= 0.9;
        if (now >= c.stateUntil) {
          c.state = 'idle';
          c.talkWith = null;
          c.armR.rotation.x = 0;
          c.stateUntil = now + 1000 + Math.random() * 3000;
        }
      } else if (c.state === 'idle') {
        c.body.position.y = 1.05 + Math.sin(now / 500 + c.phase) * 0.015;
        c.armL.rotation.x *= 0.9;
        c.armR.rotation.x *= 0.9;
        c.legL.rotation.x *= 0.9;
        c.legR.rotation.x *= 0.9;
        if (now >= c.stateUntil) {
          const t = freeSpot(c.group.position.x, c.group.position.z);
          c.target = t;
          c.state = 'walk';
        }
      } else {
        const dx = c.target.x - c.group.position.x;
        const dz = c.target.z - c.group.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5) {
          c.state = 'idle';
          c.stateUntil = now + 2000 + Math.random() * 5000;
        } else {
          face(c, c.target.x, c.target.z);
          const step = Math.min(d, c.speed * dt);
          let nx = c.group.position.x + (dx / d) * step;
          let nz = c.group.position.z + (dz / d) * step;
          // Не идём сквозь дома и стены: скользим, иначе новая цель
          const fixed = resolveStatic(nx, nz, 0.5);
          if (Math.hypot(fixed.x - nx, fixed.z - nz) > step * 0.9) {
            const t = freeSpot(c.group.position.x, c.group.position.z);
            c.target = t;
          } else {
            c.group.position.x = fixed.x;
            c.group.position.z = fixed.z;
          }
          // Походка: ноги и руки в противофазе
          const swing = Math.sin(now / 130 + c.phase) * 0.55;
          c.legL.rotation.x = swing;
          c.legR.rotation.x = -swing;
          c.armL.rotation.x = -swing * 0.7;
          c.armR.rotation.x = swing * 0.7;
          c.body.position.y = 1.05 + Math.abs(Math.sin(now / 130 + c.phase)) * 0.05;
        }
      }

      const gy = groundHeight(c.group.position.x, c.group.position.z);
      c.group.position.y += (gy - c.group.position.y) * Math.min(1, dt * 6);

      if (c.bubble.visible && now >= c.bubbleUntil) c.bubble.visible = false;
    }
  }

  function dispose(): void {
    all.traverse(o => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        g?.dispose?.();
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        (m as THREE.Material | undefined)?.dispose?.();
      }
    });
    scene.remove(all);
    CIV_COLLIDERS.length = 0;
  }

  return { update, dispose };
}
