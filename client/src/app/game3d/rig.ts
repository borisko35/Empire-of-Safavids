// ============================================================
// Риги персонажей и монстров — Empire of Safavids
// ============================================================
// Стилизованные модели из примитивов + процедурные анимации:
// ходьба, бег, прыжок, присед, блок, атака, покачивание, смерть.
// Персонаж смотрит вдоль +Z (поворот задаёт world3d через rotation.y).

import * as THREE from 'three';

const mat = (color: number, rough = 0.85, metal = 0.05) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

const MAT = {
  skin: mat(0xe4b284),
  skinDark: mat(0xbc8a62),
  steel: mat(0xb2b8c4, 0.35, 0.75),
  steelDark: mat(0x686e7a, 0.4, 0.7),
  gold: mat(0xc9a84c, 0.35, 0.75),
  leather: mat(0x6e563a),
  leatherDark: mat(0x4c3a22),
  hair: mat(0x2c201a),
  eye: new THREE.MeshBasicMaterial({ color: 0x1a1410 }),
};

export type Weapon = 'sword' | 'staff' | 'bow' | 'dagger' | 'rapier' | 'none';
export type Hat = 'turban' | 'helmet' | 'hood' | 'cap' | 'none';

export interface RigPose {
  moving: boolean;
  speed: number;      // юнитов/сек (для фазы и размаха)
  grounded: boolean;
  crouch: boolean;
  block: boolean;
  dead: boolean;
}

export interface Rig {
  group: THREE.Group;
  update: (dt: number, p: RigPose) => void;
  triggerAttack: () => void;
  dispose: () => void;
}

interface HumanoidCfg {
  robe: number;
  robeDark: number;
  hat: Hat;
  hatColor: number;
  weapon: Weapon;
  shield?: boolean;
  scale?: number;
}

function box(w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.castShadow = true;
  return mesh;
}

function sphere(r: number, m: THREE.Material, seg = 12): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), m);
  mesh.castShadow = true;
  return mesh;
}

function cyl(rt: number, rb: number, h: number, m: THREE.Material, seg = 10): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.castShadow = true;
  return mesh;
}

function buildWeapon(kind: Weapon): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'sword') {
    const blade = box(0.055, 0.85, 0.028, MAT.steel);
    blade.position.y = 0.5;
    const guard = cyl(0.14, 0.14, 0.035, MAT.gold);
    const grip = cyl(0.03, 0.035, 0.16, MAT.leatherDark);
    grip.position.y = -0.09;
    const pommel = sphere(0.045, MAT.gold, 8);
    pommel.position.y = -0.18;
    g.add(blade, guard, grip, pommel);
  } else if (kind === 'staff') {
    const shaft = cyl(0.028, 0.034, 1.5, MAT.leatherDark);
    shaft.position.y = 0.45;
    const orb = sphere(0.09, mat(0x2e8b8b, 0.3, 0.4), 10);
    orb.position.y = 1.25;
    const glow = new THREE.PointLight(0x35c0c0, 1.6, 3.2);
    glow.position.y = 1.25;
    g.add(shaft, orb, glow);
  } else if (kind === 'bow') {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.028, 6, 14, Math.PI * 1.25), MAT.leatherDark);
    arc.rotation.z = Math.PI * 0.62;
    const string_ = box(0.012, 0.94, 0.012, mat(0xe8e0d0));
    string_.position.set(0.1, 0, 0);
    g.add(arc, string_);
  } else if (kind === 'dagger') {
    const blade = box(0.045, 0.4, 0.024, MAT.steel);
    blade.position.y = 0.22;
    const guard = cyl(0.09, 0.09, 0.03, MAT.gold);
    g.add(blade, guard);
  } else if (kind === 'rapier') {
    const blade = box(0.03, 0.95, 0.018, MAT.steel);
    blade.position.y = 0.55;
    const cup = cyl(0.1, 0.13, 0.06, MAT.gold);
    g.add(blade, cup);
  }
  return g;
}

function buildHat(kind: Hat, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = mat(color);
  if (kind === 'turban') {
    const wrap = cyl(0.175, 0.19, 0.12, m);
    wrap.position.y = 0.09;
    const top = sphere(0.115, m, 10); top.scale.y = 0.55; top.position.y = 0.17;
    const band = cyl(0.185, 0.185, 0.03, MAT.gold);
    band.position.y = 0.045;
    g.add(wrap, top, band);
  } else if (kind === 'helmet') {
    const dome = sphere(0.185, MAT.steel, 12);
    dome.scale.y = 0.8; dome.position.y = 0.07;
    const crest = box(0.03, 0.12, 0.3, MAT.steelDark);
    crest.position.y = 0.24;
    const rim = cyl(0.19, 0.19, 0.035, MAT.steelDark);
    rim.position.y = 0.02;
    g.add(dome, crest, rim);
  } else if (kind === 'hood') {
    const shell = sphere(0.21, m, 12);
    shell.scale.set(1, 1.12, 1.05); shell.position.y = 0.06;
    const rimT = torusRing(0.15, m);
    rimT.position.set(0, -0.06, 0.09);
    g.add(shell, rimT);
  } else if (kind === 'cap') {
    const dome = sphere(0.18, m, 10);
    dome.scale.y = 0.55; dome.position.y = 0.06;
    const visor = box(0.16, 0.02, 0.12, m);
    visor.position.set(0, 0.02, 0.16);
    g.add(dome, visor);
  }
  return g;
}

function torusRing(r: number, m: THREE.Material): THREE.Mesh {
  const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 6, 16), m);
  t.rotation.x = Math.PI / 2;
  return t;
}

/** Гуманоидный риг с процедурными анимациями */
export function buildHumanoid(cfg: HumanoidCfg): Rig {
  const robe = mat(cfg.robe);
  const robeDark = mat(cfg.robeDark);
  const s = cfg.scale ?? 1;

  const group = new THREE.Group();
  const body = new THREE.Group();      // опускается при приседе
  group.add(body);

  // Ноги
  const legL = new THREE.Group(); legL.position.set(-0.12, 0.95, 0);
  const legR = new THREE.Group(); legR.position.set(0.12, 0.95, 0);
  const legGeo = () => {
    const l = box(0.16, 0.95, 0.19, robeDark);
    l.position.y = -0.475;
    const foot = box(0.17, 0.09, 0.3, MAT.leatherDark);
    foot.position.set(0, -0.93, 0.06);
    const leg = new THREE.Group();
    leg.add(l, foot);
    return leg;
  };
  legL.add(legGeo()); legR.add(legGeo());
  body.add(legL, legR);

  // Юбка халата (прячет стык ног)
  const skirt = cyl(0.24, 0.37, 0.6, robeDark, 12);
  skirt.position.y = 0.72;
  body.add(skirt);

  // Торс с головой и руками
  const torso = new THREE.Group();
  torso.position.y = 0.98;
  const chest = box(0.42, 0.56, 0.26, robe);
  chest.position.y = 0.32;
  const belt = cyl(0.23, 0.25, 0.07, MAT.gold, 12);
  belt.position.y = 0.04;
  torso.add(chest, belt);

  const head = new THREE.Group();
  head.position.y = 0.68;
  const skull = sphere(0.16, MAT.skin, 14);
  skull.position.y = 0.12;
  const beard = sphere(0.09, MAT.hair, 8);
  beard.scale.set(1.25, 0.7, 0.8); beard.position.set(0, 0.02, 0.09);
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), MAT.eye);
  eyeL.position.set(-0.06, 0.15, 0.14);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.06;
  head.add(skull, beard, eyeL, eyeR);
  const hat = buildHat(cfg.hat, cfg.hatColor);
  hat.position.y = 0.16;
  head.add(hat);
  torso.add(head);

  // Руки
  const armL = new THREE.Group(); armL.position.set(-0.28, 0.52, 0);
  const armR = new THREE.Group(); armR.position.set(0.28, 0.52, 0);
  const armGeo = () => {
    const a = box(0.12, 0.56, 0.13, robe);
    a.position.y = -0.28;
    const hand = sphere(0.075, MAT.skin, 8);
    hand.position.y = -0.6;
    const arm = new THREE.Group();
    arm.add(a, hand);
    return arm;
  };
  armL.add(armGeo()); armR.add(armGeo());
  torso.add(armL, armR);

  // Оружие в правой руке
  if (cfg.weapon !== 'none') {
    const weapon = buildWeapon(cfg.weapon);
    weapon.position.y = -0.6;
    armR.add(weapon);
  }
  // Щит на левой
  if (cfg.shield) {
    const shield = cyl(0.3, 0.3, 0.05, MAT.wood, 14);
    shield.rotation.x = Math.PI / 2;
    shield.position.set(-0.05, -0.55, 0.08);
    const boss = sphere(0.06, MAT.steel, 8);
    boss.position.set(-0.05, -0.55, 0.12);
    armL.add(shield, boss);
  }

  body.add(torso);
  group.scale.setScalar(s);

  // ── Состояние анимации ──
  let phase = Math.random() * 6;
  let attackT = -1;             // прогресс атаки 0..1, -1 — нет
  let blockT = 0;               // 0..1 плавный вход в блок
  let crouchT = 0;
  let airT = 0;                 // 0..1 в воздухе
  let deadT = 0;

  const rig: Rig = {
    group,
    triggerAttack() { if (attackT < 0 || attackT > 1) attackT = 0; },
    update(dt, p) {
      const speedRatio = Math.min(1, p.speed / 7);
      phase += dt * (p.moving ? 2.2 + p.speed * 1.35 : 2);

      attackT = attackT < 0 ? -1 : attackT + dt / 0.45;
      if (attackT > 1.35) attackT = -1;
      blockT += ((p.block ? 1 : 0) - blockT) * Math.min(1, dt * 10);
      crouchT += ((p.crouch ? 1 : 0) - crouchT) * Math.min(1, dt * 8);
      airT += ((p.grounded ? 0 : 1) - airT) * Math.min(1, dt * 10);
      deadT = p.dead ? Math.min(1, deadT + dt * 2.2) : 0;

      const w = Math.sin(phase);            // взмах ног
      const swingAmp = p.moving ? 0.28 + 0.5 * speedRatio : 0.035;

      // Ноги: бег/шаг + поджатие в прыжке + присед
      const legLX = w * swingAmp - airT * 0.55 - crouchT * 0.7;
      const legRX = -w * swingAmp - airT * 0.3 - crouchT * 0.5;
      legL.rotation.x += (legLX - legL.rotation.x) * Math.min(1, dt * 14);
      legR.rotation.x += (legRX - legR.rotation.x) * Math.min(1, dt * 14);

      // Корпус: покачивание, наклон при беге, присед, смерть
      const bob = p.moving && p.grounded ? Math.abs(Math.cos(phase)) * 0.05 * (0.4 + speedRatio) : Math.sin(phase * 0.6) * 0.012;
      torso.position.y = 0.98 + bob - crouchT * 0.34;
      const leanX = (p.moving ? 0.1 * speedRatio : 0.02 * Math.sin(phase * 0.5)) + crouchT * 0.32 + airT * 0.12;
      torso.rotation.x += (leanX - torso.rotation.x) * Math.min(1, dt * 8);
      torso.rotation.y *= (1 - Math.min(1, dt * 6));

      // Руки: противофаза к ногам; блок левой; атака правой
      const armLX = -w * swingAmp * 0.75 - blockT * 2.1 - airT * 0.35 + crouchT * 0.3;
      const armRX = w * swingAmp * 0.75 + airT * 0.3;
      armL.rotation.x += (armLX - armL.rotation.x) * Math.min(1, dt * 12);
      armL.rotation.z += (blockT * -0.5 - armL.rotation.z) * Math.min(1, dt * 12);
      armR.rotation.x += (armRX - armR.rotation.x) * Math.min(1, dt * 12);
      armR.rotation.z += (attackT >= 0 && attackT < 0.35 ? -0.9 : 0) * 1 - armR.rotation.z * 0.2;

      // Атака: замах -> рубящий удар -> возврат
      if (attackT >= 0) {
        const t = attackT;
        if (t < 0.35) {
          const k = t / 0.35;
          armR.rotation.x = -0.2 - k * 2.1;          // замах назад-вверх
          torso.rotation.y = -k * 0.35;
        } else if (t < 0.62) {
          const k = (t - 0.35) / 0.27;
          armR.rotation.x = -2.3 + k * 3.3;          // рубящий удар вниз
          torso.rotation.y = -0.35 + k * 0.55;
        } else {
          const k = (t - 0.62) / 0.73;
          armR.rotation.x = 1.0 - k * 1.0;           // возврат
          torso.rotation.y = 0.2 * (1 - k);
        }
      }

      // Смерть: падение навзничь и погружение
      if (deadT > 0) {
        group.rotation.x = -Math.PI / 2 * Math.min(1, deadT * 1.4);
        body.position.y = -deadT * 0.25;
      } else {
        group.rotation.x *= (1 - Math.min(1, dt * 8));
        body.position.y = -crouchT * 0.36;
      }
    },
    dispose() {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
    },
  };
  return rig;
}

// ── Див (огненный демон) ─────────────────────────────────────
function buildDemon(): Rig {
  const group = new THREE.Group();
  const red = mat(0xb23a26, 0.9);
  const redDark = mat(0x7c2416, 0.9);
  const body = new THREE.Group();
  group.add(body);

  const torso = sphere(0.55, red, 14);
  torso.scale.set(1.15, 1, 0.9);
  torso.position.y = 1.05;
  const head = sphere(0.34, red, 12);
  head.position.y = 1.75;
  // рога
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5, 7), MAT.gold);
    horn.position.set(side * 0.22, 2.06, 0);
    horn.rotation.z = -side * 0.5;
    body.add(horn);
  }
  // глаза с огнём
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd25c }));
    eye.position.set(side * 0.13, 1.8, 0.28);
    body.add(eye);
  }
  const jaw = box(0.3, 0.08, 0.2, redDark);
  jaw.position.set(0, 1.58, 0.22);
  body.add(torso, head, jaw);
  // лапы-руки
  const armL = new THREE.Group(); armL.position.set(-0.6, 1.35, 0);
  const armR = new THREE.Group(); armR.position.set(0.6, 1.35, 0);
  const claw = () => {
    const a = box(0.2, 0.75, 0.22, redDark);
    a.position.y = -0.38;
    const hand = sphere(0.14, red, 8);
    hand.position.y = -0.8;
    const arm = new THREE.Group();
    arm.add(a, hand);
    return arm;
  };
  armL.add(claw()); armR.add(claw());
  body.add(armL, armR);
  // ноги толстые короткие
  const legL = new THREE.Group(); legL.position.set(-0.28, 0.55, 0);
  const legR = new THREE.Group(); legR.position.set(0.28, 0.55, 0);
  const paw = () => {
    const l = box(0.26, 0.55, 0.3, redDark);
    l.position.y = -0.27;
    const foot = box(0.3, 0.12, 0.44, red);
    foot.position.set(0, -0.55, 0.08);
    const leg = new THREE.Group();
    leg.add(l, foot);
    return leg;
  };
  legL.add(paw()); legR.add(paw());
  body.add(legL, legR);
  // огненный ореол (частицы-точки)
  const sparks = new THREE.Group();
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.8 });
  for (let i = 0; i < 14; i++) {
    const sp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 5), sparkMat);
    const a = (i / 14) * Math.PI * 2;
    sp.position.set(Math.cos(a) * 0.75, 0.6 + Math.sin(a * 3) * 0.4, Math.sin(a) * 0.6);
    sparks.add(sp);
  }
  group.add(sparks);

  let phase = Math.random() * 6;
  let attackT = -1;
  let deadT = 0;
  return {
    group,
    triggerAttack() { if (attackT < 0 || attackT > 1) attackT = 0; },
    update(dt, p) {
      phase += dt * (p.moving ? 5.2 : 2.4);
      attackT = attackT < 0 ? -1 : attackT + dt / 0.55;
      if (attackT > 1.4) attackT = -1;
      deadT = p.dead ? Math.min(1, deadT + dt * 2.2) : 0;
      const w = Math.sin(phase);
      const amp = p.moving ? 0.45 : 0.05;
      legL.rotation.x = w * amp; legR.rotation.x = -w * amp;
      armL.rotation.x = -w * amp * 0.6;
      armR.rotation.x = w * amp * 0.6;
      body.rotation.z = w * 0.06;
      body.position.y = Math.abs(Math.cos(phase)) * 0.04 * (p.moving ? 1 : 0.3);
      if (attackT >= 0) {
        const t = attackT;
        const k = t < 0.4 ? -t / 0.4 * 1.8 : Math.max(-0.2, -1.8 + ((t - 0.4) / 0.25) * 2.4);
        armL.rotation.x = k; armR.rotation.x = k;
      }
      sparkMat.opacity = 0.55 + Math.sin(phase * 4) * 0.25;
      sparks.rotation.y += dt * 0.8;
      if (deadT > 0) {
        group.rotation.x = -Math.PI / 2 * Math.min(1, deadT * 1.4);
        body.position.y = -deadT * 0.4;
      } else group.rotation.x *= 1 - Math.min(1, dt * 8);
    },
    dispose() { group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); }); },
  };
}

// ── Симург (мировой босс-птица) ──────────────────────────────
function buildSimurgh(): Rig {
  const group = new THREE.Group();
  const gold = mat(0xd8b25a, 0.6, 0.25);
  const goldLight = mat(0xf0d488, 0.6, 0.25);
  const body = new THREE.Group();
  group.add(body);

  const trunk = sphere(0.55, goldLight, 14);
  trunk.scale.set(0.75, 1, 1.15);
  trunk.position.y = 1.5;
  const head = sphere(0.3, goldLight, 12);
  head.position.set(0, 2.45, 0.25);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 8), mat(0xc98a2e, 0.5, 0.5));
  beak.position.set(0, 2.42, 0.6);
  beak.rotation.x = Math.PI / 2;
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), MAT.eye);
  eyeL.position.set(-0.11, 2.52, 0.45);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.11;
  body.add(trunk, head, beak, eyeL, eyeR);
  // крылья
  const wingL = new THREE.Group(); wingL.position.set(-0.4, 1.9, 0);
  const wingR = new THREE.Group(); wingR.position.set(0.4, 1.9, 0);
  const wingGeoL = box(2.3, 0.09, 0.85, gold);
  wingGeoL.position.x = -1.15;
  const tipL = box(0.9, 0.07, 0.55, goldLight);
  tipL.position.set(-2.4, 0.05, 0.1);
  wingL.add(wingGeoL, tipL);
  const wingGeoR = box(2.3, 0.09, 0.85, gold);
  wingGeoR.position.x = 1.15;
  const tipR = box(0.9, 0.07, 0.55, goldLight);
  tipR.position.set(2.4, 0.05, 0.1);
  wingR.add(wingGeoR, tipR);
  body.add(wingL, wingR);
  // хвост: три пера
  const tails: [number, number][] = [[0x2e8b8b, -0.22], [0xc9a84c, 0], [0x8b1a1a, 0.22]];
  for (const [color, off] of tails) {
    const feather = box(0.12, 0.05, 1.5, mat(color, 0.7, 0.2));
    feather.position.set(off, 1.25, -1.1);
    feather.rotation.y = off * 0.6;
    body.add(feather);
  }
  // лапы
  for (const side of [-1, 1]) {
    const leg = box(0.09, 0.6, 0.09, mat(0xbe8c42, 0.6, 0.3));
    leg.position.set(side * 0.2, 0.4, 0.1);
    body.add(leg);
  }

  let phase = Math.random() * 6;
  let attackT = -1;
  let deadT = 0;
  return {
    group,
    triggerAttack() { if (attackT < 0 || attackT > 1) attackT = 0; },
    update(dt, p) {
      phase += dt * (p.moving ? 7 : 3.4);
      attackT = attackT < 0 ? -1 : attackT + dt / 0.6;
      if (attackT > 1.4) attackT = -1;
      deadT = p.dead ? Math.min(1, deadT + dt * 2.2) : 0;
      const flap = Math.sin(phase) * (p.moving ? 0.7 : 0.35);
      wingL.rotation.z = flap + 0.15;
      wingR.rotation.z = -flap - 0.15;
      body.position.y = 0.45 + Math.sin(phase * 0.7) * 0.12;   // парение
      body.rotation.x = attackT >= 0 ? -0.4 : 0;
      if (deadT > 0) {
        group.rotation.x = -Math.PI / 2 * Math.min(1, deadT * 1.4);
        body.position.y = -deadT * 0.6;
      } else group.rotation.x *= 1 - Math.min(1, dt * 8);
    },
    dispose() { group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); }); },
  };
}

/** Риг монстра по серверному id */
export function buildMonsterRig(monsterId: string): Rig {
  switch (monsterId) {
    case 'mob_bandit_scout':
      return buildHumanoid({ robe: 0x605040, robeDark: 0x40362c, hat: 'hood', hatColor: 0x4c3a22, weapon: 'sword', scale: 1.0 });
    case 'mob_bandit_warrior':
      return buildHumanoid({ robe: 0x4a423c, robeDark: 0x302a26, hat: 'hood', hatColor: 0x121014, weapon: 'sword', scale: 1.08 });
    case 'mob_ottoman_janissary':
      return buildHumanoid({ robe: 0x42644c, robeDark: 0x2c4434, hat: 'cap', hatColor: 0xe8e0d0, weapon: 'sword', scale: 1.05 });
    case 'mob_mongol_raider':
      return buildHumanoid({ robe: 0x58462f, robeDark: 0x3c3020, hat: 'helmet', hatColor: 0x4c3a22, weapon: 'bow', scale: 1.02 });
    case 'mob_div_fire':
      return buildDemon();
    case 'world_boss_simurgh':
      return buildSimurgh();
    default:
      return buildHumanoid({ robe: 0x605040, robeDark: 0x40362c, hat: 'hood', hatColor: 0x4c3a22, weapon: 'sword' });
  }
}

/** Риг игрока по классу */
export function buildPlayerRig(charClass: string): Rig {
  const cfgs: Record<string, HumanoidCfg> = {
    qizilbash: { robe: 0xa62c38, robeDark: 0x7c1f28, hat: 'helmet', hatColor: 0xb2b8c4, weapon: 'sword', shield: true },
    sufi_mystic: { robe: 0x6f54c8, robeDark: 0x4c3a8c, hat: 'turban', hatColor: 0x2e8b8b, weapon: 'staff' },
    persian_archer: { robe: 0x3e8a58, robeDark: 0x2c6440, hat: 'hood', hatColor: 0x6e563a, weapon: 'bow' },
    bazaar_merchant: { robe: 0xc9a03a, robeDark: 0x96752a, hat: 'turban', hatColor: 0xe8e0d0, weapon: 'dagger' },
    court_diplomat: { robe: 0x3a7fb2, robeDark: 0x2a5e84, hat: 'cap', hatColor: 0xb2b8c4, weapon: 'rapier' },
  };
  return buildHumanoid(cfgs[charClass] ?? cfgs.qizilbash);
}
