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
  wood: mat(0x8a6a42),
  hair: mat(0x2c201a),
  eye: new THREE.MeshBasicMaterial({ color: 0x1a1410 }),
};

export type Weapon = 'sword' | 'staff' | 'bow' | 'dagger' | 'rapier' | 'none';
export type Hat = 'turban' | 'helmet' | 'hood' | 'cap' | 'none';

/** Сторона рывка: из этих четырёх выбирается клип переката */
export type DodgeDirection = 'forward' | 'back' | 'left' | 'right';

export interface RigPose {
  moving: boolean;
  speed: number;      // юнитов/сек (для фазы и размаха)
  grounded: boolean;
  crouch: boolean;
  block: boolean;
  dead: boolean;
  swimming: boolean;  // плавание в воде
}

export interface Rig {
  group: THREE.Group;
  update: (dt: number, p: RigPose) => void;
  /**
   * Замах. Стадия связки: 1 — прямой удар, 2 — обратный. Параметр
   * необязательный: старые вызовы без стадии работают как первая.
   * Процедурные риги (запасной вариант без модели) стадию принимают, но
   * показывают один и тот же замах — второй клип есть только у модели.
   */
  triggerAttack: (stage?: 1 | 2) => void;
  /**
   * Уклонение в сторону: forward, back, left, right.
   *
   * Необязательный: четыре сборки в этом файле состоят из палочек и показывают
   * уклонение без анимации. Настоящая модель проигрывает перекат.
   */
  triggerDodge?: (direction: DodgeDirection) => void;
  /**
   * Вид оружия для превью и игры. Необязательный, как triggerDodge:
   * процедурные сборки его не умеют, у них оружие задано при построении.
   */
  setWeaponKind?: (kind: Weapon) => void;
  equipWeapon: (visible: boolean) => void;
  equipShield: (visible: boolean) => void;
  isWeaponEquipped: () => boolean;
  isShieldEquipped: () => boolean;
  /**
   * Цвет надетой брони на груди; null — без брони (цвет класса).
   *
   * Раньше внешний вид вообще не зависел от того, что надето: у всех стоял
   * один и тот же силуэт класса, поэтому смена доспеха не была видна.
   */
  setArmorTint: (color: number | null) => void;
  dispose: () => void;
}

/**
 * Четвероногий зверь: волк, рысь и всё, что ходит на четырёх ногах.
 *
 * Общая фигура с настройкой цвета и масштаба. Заведена потому, что волк
 * раньше рисовался гуманоидом в капюшоне с мечом, а рисовать второе
 * четвероногое копией того же кода - значит завести две правки там, где
 * хватит одной.
 */
export interface QuadrupedCfg {
  /** Шерсть корпуса */
  fur: number;
  /** Голова, морда, ноги и хвост */
  furDark: number;
  /** Грудь и брюхо: светлее корпуса, иначе силуэт сливается с землёй */
  light: number;
  /** Общий размер */
  scale?: number;
}

export interface HumanoidCfg {
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

export function buildWeapon(kind: Weapon): THREE.Group {
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

/**
 * Щит: диск, обод и умбон.
 *
 * Вынесено потому, что щит собирался дважды — в `buildHumanoid` и в `buildFigure` —
 * почти одинаковым кодом, и появился бы ещё третий раз в настоящем персонаже из
 * `realRig.ts`. Радиусы и смещения у двух мест были свои, поэтому вынесено с
 * параметрами: по умолчанию — как у гуманоида.
 *
 * Диск стоит строго вертикально, и ночью (свет сверху, от луны и факелов) на него
 * падает только скользящий свет — грань уходила в абсолютный ноль, и щит выглядел
 * чёрным шаром. Светлее + наклон + небольшое собственное свечение.
 */
export function buildShield(
  radius = 0.28,
  offset: [number, number, number] = [-0.22, -0.48, 0.15],
): THREE.Group {
  const группа = new THREE.Group();
  const shieldMat = mat(0xb08a52, 0.8, 0.05);
  shieldMat.emissive = new THREE.Color(0x3a2a14);
  shieldMat.emissiveIntensity = 0.55;
  const rimMat = mat(0xb9a06a, 0.45, 0.6);
  rimMat.emissive = new THREE.Color(0x2a2410);
  rimMat.emissiveIntensity = 0.5;

  const диск = cyl(radius, radius, 0.045, shieldMat, 14);
  // Наклон по Y и Z: диск перестаёт быть строго вертикальным и ловит верхний
  // свет, поэтому ночью читается как щит, а не как чёрный круг
  диск.rotation.set(Math.PI / 2, 0.32, 0.12);
  диск.position.set(offset[0], offset[1], offset[2]);

  const обод = cyl(radius * 1.09, radius * 1.09, 0.028, rimMat, 14);
  обод.rotation.copy(диск.rotation);
  обод.position.set(offset[0], offset[1], offset[2] - 0.005);

  const умбон = sphere(0.06, MAT.gold, 8);
  умбон.position.set(offset[0], offset[1], offset[2] + 0.05);

  группа.add(диск, обод, умбон);
  return группа;
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

  // Оружие в правой руке.
  // Кисть держит РУКОЯТЬ, а не гарду. У меча рукоять смещена внутри
  // группы на −0.09 по Y, гарда на 0, наконечник на −0.18. Кисть руки
  // лежит на −0.6, поэтому гарда встаёт на −0.51: −0.51 + (−0.09) = −0.6.
  // Раньше гарда ставилась прямо в кисть (−0.6), из-за чего наконечник
  // уходил в предплечье, а клинок рос вдоль руки.
  let weaponRef: THREE.Group | null = null;
  if (cfg.weapon !== 'none') {
    weaponRef = buildWeapon(cfg.weapon);
    weaponRef.position.set(0.04, -0.51, 0.11);
    // Лёгкий наклон вперёд: клинок не упирается в плечо и не режет корпус
    weaponRef.rotation.x = 0.32;
    armR.add(weaponRef);
  }
  // Щит на левой: держим перед предплечьем и заметно левее середины тела.
  // Прежний диск радиусом 0.3 стоял в кисти и доставал до правой руки —
  // щит накладывался на меч, и оба казались приросшими к телу.
  //
  // Свой материал, а не MAT.wood: плоский диск стоит строго вертикально, и
  // ночью (свет сверху, от луны и факелов) на него падает только скользящий
  // свет — грань уходила в абсолютный ноль, и щит выглядел чёрным шаром
  // (видно на скриншоте). Светлее + наклон + небольшое собственное свечение.
  let shieldRef: THREE.Object3D | null = null;
  if (cfg.shield) {
    shieldRef = buildShield();
    armL.add(shieldRef);
  }

  let weaponOn = !!weaponRef;
  let shieldOn = !!shieldRef;

  body.add(torso);
  group.scale.setScalar(s);

  // ── Состояние анимации ──
  let phase = Math.random() * 6;
  let attackT = -1;             // прогресс атаки 0..1, -1 — нет
  let blockT = 0;               // 0..1 плавный вход в блок
  let crouchT = 0;
  let airT = 0;                 // 0..1 в воздухе
  let deadT = 0;
  let swimT = 0;                // 0..1 плавание

  const rig: Rig = {
    group,
    triggerAttack(_stage: 1 | 2 = 1) { if (attackT < 0 || attackT > 1) attackT = 0; },
    update(dt, p) {
      const speedRatio = Math.min(1, p.speed / 7);
      phase += dt * (p.moving ? 2.2 + p.speed * 1.35 : 2);

      attackT = attackT < 0 ? -1 : attackT + dt / 0.45;
      if (attackT > 1.35) attackT = -1;
      blockT += ((p.block ? 1 : 0) - blockT) * Math.min(1, dt * 10);
      crouchT += ((p.crouch ? 1 : 0) - crouchT) * Math.min(1, dt * 8);
      airT += ((p.grounded ? 0 : 1) - airT) * Math.min(1, dt * 10);
      deadT = p.dead ? Math.min(1, deadT + dt * 2.2) : 0;
      swimT += ((p.swimming ? 1 : 0) - swimT) * Math.min(1, dt * 6);

      const inWater = swimT > 0.01;

      // ── Плавание: тело горизонтально, руки гребут, ноги бьют ──
      if (inWater) {
        // Тело: горизонтальное положение
        const swimLean = 0.55 * swimT;
        torso.rotation.x += (swimLean - torso.rotation.x) * Math.min(1, dt * 6);
        torso.position.y = (0.98 - 0.3) * (1 - swimT) + 0.55 * swimT;

        // Руки: гребок вперёд-назад (альтернативно)
        const swimPhase = phase * 0.8;
        const armSwingL = Math.sin(swimPhase) * 0.7 * swimT;
        const armSwingR = Math.sin(swimPhase + Math.PI) * 0.7 * swimT;
        armL.rotation.x += (armSwingL - 0.3 * swimT - armL.rotation.x) * Math.min(1, dt * 8);
        armL.rotation.z += (-0.4 * swimT - armL.rotation.z) * Math.min(1, dt * 8);
        armR.rotation.x += (armSwingR - 0.3 * swimT - armR.rotation.x) * Math.min(1, dt * 8);
        armR.rotation.z += (0.4 * swimT - armR.rotation.z) * Math.min(1, dt * 8);

        // Ноги: биение в воде
        const legKick = Math.sin(swimPhase * 1.3) * 0.3 * swimT;
        legL.rotation.x += (legKick - 0.2 * swimT - legL.rotation.x) * Math.min(1, dt * 10);
        legR.rotation.x += (-legKick - 0.2 * swimT - legR.rotation.x) * Math.min(1, dt * 10);
      }

      const w = Math.sin(phase);            // взмах ног
      const swingAmp = p.moving ? 0.28 + 0.5 * speedRatio : 0.035;

      // ── Если НЕ в воде — обычная анимация ходьбы/бега ──
      if (!inWater) {
        // Ноги: бег/шаг + поджатие в прыжке + присед
        const legLX = w * swingAmp - airT * 0.55 - crouchT * 0.7;
        const legRX = -w * swingAmp - airT * 0.3 - crouchT * 0.5;
        legL.rotation.x += (legLX - legL.rotation.x) * Math.min(1, dt * 14);
        legR.rotation.x += (legRX - legR.rotation.x) * Math.min(1, dt * 14);

        // Корпус: покачивание, наклон при беге, присед
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
      }

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
    equipWeapon(visible: boolean) {
      if (weaponRef) { weaponRef.visible = visible; weaponOn = visible; }
    },
    equipShield(visible: boolean) {
      if (shieldRef) { shieldRef.visible = visible; shieldOn = visible; }
    },
    isWeaponEquipped() { return weaponOn; },
    isShieldEquipped() { return shieldOn; },
    setArmorTint(color) {
      // Тон груди. Перекрашиваем материал халата, а не создаём второй меш:
      // иначе на каждый доспех плодилась бы копия геометрии
      robe.color.setHex(color ?? cfg.robe);
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
    triggerAttack(_stage: 1 | 2 = 1) { if (attackT < 0 || attackT > 1) attackT = 0; },
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
    equipWeapon() {},
    equipShield() {},
    isWeaponEquipped() { return false; },
    isShieldEquipped() { return false; },
    setArmorTint() {},
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
    triggerAttack(_stage: 1 | 2 = 1) { if (attackT < 0 || attackT > 1) attackT = 0; },
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
    equipWeapon() {},
    equipShield() {},
    isWeaponEquipped() { return false; },
    isShieldEquipped() { return false; },
    setArmorTint() {},
    dispose() { group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); }); },
  };
}

// ── Скорпион (пустынный, низкий, сегментированное тело, хвост-жалo, клешни)
// ── Подводные существа ───────────────────────────────────────
// Раньше buildMonsterRig для неизвестного id отдавал гуманоида с
// мечом: «Левиафан Тебриза» выглядел как капюшон с саблей. Здесь
// настоящее тело: хребет из сегментов, хвост, плавники, глаза.
interface FishCfg {
  /** Цвет спины */
  body: number;
  /** Цвет брюха */
  belly: number;
  /** Длина тела в условных единицах */
  length: number;
  /** Высота тела */
  girth: number;
  /** Цвет глаз */
  eye: number;
  /** Светится ли (призрачная рыба) */
  glow?: number;
  /** Ширина пасти — у Левиафана пасть с клыками */
  jaws?: boolean;
}

function buildFish(cfg: FishCfg): Rig {
  const group = new THREE.Group();
  const back = mat(cfg.body, 0.55, 0.3);
  const bellyMat = mat(cfg.belly, 0.6, 0.3);
  const finMat = mat(cfg.body, 0.6, 0.25);
  const body = new THREE.Group();
  group.add(body);

  // Позвоночник: сегменты от головы к хвосту. Их используем и для
  // формы тела, и для волнистого плавания — хвост идёт волной.
  const SEG = 7;
  const segs: THREE.Mesh[] = [];
  const L = cfg.length, G = cfg.girth;
  for (let i = 0; i < SEG; i++) {
    // Утончаемся к хвосту, самая толстая часть — у самой головы
    const k = i / (SEG - 1);
    const r = G * (1 - k * 0.78) * (i === 0 ? 0.85 : 1);
    const seg = sphere(Math.max(0.05, r), i < 2 ? back : back, 10);
    seg.scale.set(0.85, 0.95, 1.5);
    seg.position.set(0, 0, L * (0.42 - k * 0.84));
    body.add(seg);
    segs.push(seg);
  }

  // Брюхо — светлее, как у настоящей рыбы
  const under = sphere(G * 0.7, bellyMat, 8);
  under.scale.set(0.9, 0.5, 1.4);
  under.position.set(0, -G * 0.45, L * 0.16);
  body.add(under);

  // Голова
  const head = sphere(G * 0.92, back, 10);
  head.scale.set(0.9, 1.0, 1.15);
  head.position.set(0, 0, L * 0.5);
  body.add(head);

  // Пасть и клыки
  if (cfg.jaws) {
    const maw = new THREE.Mesh(new THREE.ConeGeometry(G * 0.62, G * 0.9, 6), mat(0x2a1418, 0.4, 0.5));
    maw.rotation.x = Math.PI / 2;
    maw.position.set(0, -G * 0.18, L * 0.72);
    body.add(maw);
    for (const side of [-1, 1]) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.2, 5), mat(0xe8e0d0, 0.4, 0.4));
      fang.position.set(side * G * 0.34, -G * 0.42, L * 0.66);
      fang.rotation.x = Math.PI / 2.1;
      body.add(fang);
    }
  }

  // Глаза
  for (const side of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(G * 0.17, 7, 7), mat(cfg.eye, 0.3, 0.4));
    e.position.set(side * G * 0.55, G * 0.22, L * 0.5);
    body.add(e);
  }

  // Хвостовой плавник
  const tail = new THREE.Mesh(new THREE.ConeGeometry(G * 1.1, G * 1.5, 3), finMat);
  tail.rotation.x = -Math.PI / 2;
  tail.rotation.z = Math.PI;
  tail.scale.set(0.35, 1, 1);
  tail.position.set(0, 0, -L * 0.58);
  body.add(tail);

  // Спинной и боковые плавники
  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(G * 0.5, G * 0.9, 3), finMat);
  dorsal.position.set(0, G * 0.85, L * 0.05);
  body.add(dorsal);
  for (const side of [-1, 1]) {
    const sideFin = new THREE.Mesh(new THREE.ConeGeometry(G * 0.36, G * 0.7, 3), finMat);
    sideFin.position.set(side * G * 0.8, -G * 0.2, L * 0.02);
    sideFin.rotation.z = side * -1.3;
    body.add(sideFin);
  }

  let phase = Math.random() * 6;
  let attackT = -1;
  let deadT = 0;
  // Светящаяся рыба: мягкое свечение вокруг тела
  let glowLight: THREE.PointLight | null = null;
  if (cfg.glow) {
    glowLight = new THREE.PointLight(cfg.glow, 1.1, 6);
    glowLight.position.set(0, 0, 0);
    group.add(glowLight);
  }

  return {
    group,
    triggerAttack(_stage: 1 | 2 = 1) { if (attackT < 0 || attackT > 1) attackT = 0; },
    update(dt, p) {
      // Рыба ползёт только когда плывёт: стоящая на месте подводная
      // существо всё равно чуть качается, но не «бежит»
      const speedK = p.moving ? 1 : 0.35;
      phase += dt * (p.moving ? 4.6 : 1.7);
      const wave = Math.sin(phase);
      for (let i = 0; i < segs.length; i++) {
        const k = i / (segs.length - 1);
        // Волна идёт от головы к хвосту, у хвоста амплитуда больше
        segs[i].position.x = Math.sin(phase - k * 1.5) * cfg.girth * 0.22 * k * speedK;
      }
      tail.rotation.z = Math.PI + wave * 0.4 * speedK;
      body.rotation.z = wave * 0.05 * speedK;
      if (attackT >= 0) {
        attackT += dt / 0.5;
        // Раскрытая пасть на рывке
        body.scale.setScalar(1 + Math.max(0, 0.18 - Math.abs(attackT - 0.35)) * 1.2);
        if (attackT > 1.3) { attackT = -1; body.scale.setScalar(1); }
      }
      if (glowLight) {
        glowLight.intensity = 0.9 + Math.sin(phase * 2.3) * 0.35;
      }
      deadT = p.dead ? Math.min(1, deadT + dt * 2.2) : 0;
      if (deadT > 0) {
        // Умирает рыба — переворачивается и всплывает
        group.rotation.x = -Math.PI / 2 * Math.min(1, deadT * 1.4);
        body.position.y = deadT * 0.5;
      } else {
        group.rotation.x *= 1 - Math.min(1, dt * 8);
        body.position.y *= 1 - Math.min(1, dt * 8);
      }
    },
    equipWeapon() {},
    equipShield() {},
    isWeaponEquipped() { return false; },
    isShieldEquipped() { return false; },
    setArmorTint() {},
    dispose() { group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); }); },
  };
}

/**
 * Волк: четвероногий.
 *
 * Зачем отдельная фигура. mob_wolf раньше попадал в default разбора
 * buildMonsterRig и рисовался гуманоидом в капюшоне с мечом - волк с
 * саблей. Вблизи стартовой зоны Тебриза это первое, что видит игрок.
 *
 * Размеры под дистанцию боя (3 м): корпус около метра в длину, иначе
 * волк не читается на общем плане.
 */
function buildQuadruped(cfg: QuadrupedCfg): Rig {
  const group = new THREE.Group();
  const fur = mat(cfg.fur, 0.95);
  const furDark = mat(cfg.furDark, 0.95);
  const light = mat(cfg.light, 0.95);
  const dark = mat(0x1e1c1a, 0.9);
  const body = new THREE.Group();
  const k = cfg.scale ?? 1;
  group.add(body);

  // Корпус: вытянут вдоль Z, плечо выше хвоста.
  const torso = sphere(0.30, fur, 10);
  torso.scale.set(0.72, 0.62, 1.45);
  torso.position.set(0, 0.42, 0);
  body.add(torso);

  // Грудь светлее корпуса, иначе силуэт сливается с землёй.
  const chest = sphere(0.22, light, 8);
  chest.scale.set(0.85, 0.9, 0.8);
  chest.position.set(0, 0.38, 0.24);
  body.add(chest);

  // Голова: вытянутая морда, чтобы читался хищник, а не собака.
  const head = sphere(0.16, furDark, 8);
  head.scale.set(0.8, 0.8, 1.0);
  head.position.set(0, 0.52, 0.46);
  body.add(head);

  const snout = sphere(0.10, furDark, 6);
  snout.scale.set(0.7, 0.6, 1.3);
  snout.position.set(0, 0.47, 0.60);
  body.add(snout);

  // Уши: треугольники из конусов, читаются силуэтом.
  for (const side of [-1, 1]) {
    const ear = cyl(0.0, 0.055, 0.14, furDark, 6);
    ear.position.set(side * 0.09, 0.65, 0.44);
    body.add(ear);
    const eye = sphere(0.022, dark, 5);
    eye.position.set(side * 0.07, 0.56, 0.57);
    body.add(eye);
  }

  // Ноги: четыре, передние чуть короче задних. Сами ноги строятся ниже, в
  // цикле с анимацией, чтобы не создавать их дважды.
  const ноги: [number, number, number][] = [
    [0.15, 0.30, -0.16], [-0.15, 0.30, -0.16], [0.15, 0.32, 0.20], [-0.15, 0.32, 0.20],
  ];

  // Хвост: вверх и назад, как у загнанного зверя.
  const tail = cyl(0.03, 0.07, 0.46, furDark, 6);
  tail.rotation.x = 0.9;
  tail.position.set(0, 0.60, -0.48);
  body.add(tail);

  // Ноги храним отдельно, чтобы шевелить их по очереди: у четвероногого
  // диагональный шаг, иначе лапы скользят по земле.
  const лапы: THREE.Mesh[] = [];
  for (const [x, , z] of ноги) {
    const leg = cyl(0.045, 0.055, x > 0 ? 0.30 : 0.32, furDark, 6);
    leg.position.set(x, (x > 0 ? 0.30 : 0.32) / 2, z);
    // Диагонали двигаются вместе: передняя правая и задняя левая.
    leg.userData.диагональ = (z > 0) === (x > 0);
    body.add(leg);
    лапы.push(leg);
    // Подушечка: без неё лапа выглядит обрубком, а не стопой.
    const paw = sphere(0.06, dark, 5);
    paw.scale.set(1, 0.6, 1.2);
    paw.position.set(x, 0.04, z + 0.03);
    body.add(paw);
  }

  // Размер зверя: рысь крупнее волка, и масштаб задаётся настройкой.
  if (k !== 1) body.scale.setScalar(k);

  let фаза = 0;
  let падение = 0;
  return {
    group,
    triggerAttack(_stage: 1 | 2 = 1) {},
    update(dt, p) {
      // Шаг быстрее в движении; на месте волк дышит и качает головой.
      фаза += dt * (p.moving ? 7 : 1.2);
      const амплитуда = p.moving ? 0.16 : 0.02;
      for (const лапа of лапы) {
        const знак = лапа.userData.диагональ as boolean ? 1 : -1;
        лапа.rotation.x = Math.cos(фаза) * амплитуда * знак;
      }
      body.position.y = Math.abs(Math.sin(фаза)) * (p.moving ? 0.03 : 0.008);
      tail.rotation.z = Math.sin(фаза * 0.5) * 0.12;

      // Падение: заваливается набок, как четвероногое.
      падение = p.dead ? Math.min(1, падение + dt * 2.2) : 0;
      if (падение > 0) {
        group.rotation.x = -Math.PI / 2 * Math.min(1, падение * 1.4);
        body.position.y = -падение * 0.12;
      } else {
        group.rotation.x *= 1 - Math.min(1, dt * 8);
      }
    },
    equipWeapon() {}, equipShield() {},
    isWeaponEquipped() { return false; },
    isShieldEquipped() { return false; },
    setArmorTint() {},
    dispose() { group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); }); },
  };
}

function buildScorpion(): Rig {
  const group = new THREE.Group();
  const sand = mat(0xc4a04a, 0.9);
  const sandDark = mat(0x8a6e2a, 0.9);
  const dark = mat(0x3a2a10, 0.85);
  const body = new THREE.Group();
  group.add(body);

  // Тело: плоское овальное
  const torso = sphere(0.28, sand, 10);
  torso.scale.set(1.3, 0.35, 1.0);
  torso.position.set(0, 0.12, 0);
  body.add(torso);

  // Голова (передняя часть)
  const head = sphere(0.18, sandDark, 8);
  head.scale.set(1.1, 0.5, 0.9);
  head.position.set(0, 0.2, 0.28);
  body.add(head);

  // Клешни
  for (const side of [-1, 1]) {
    const clawArm = cyl(0.03, 0.03, 0.22, dark);
    clawArm.rotation.z = side * 0.4;
    clawArm.position.set(side * 0.24, 0.2, 0.44);
    // Клешня-кулак
    const claw = sphere(0.07, dark, 6);
    claw.scale.set(1, 0.6, 0.8);
    claw.position.set(side * 0.34, 0.32, 0.54);
    body.add(clawArm, claw);
  }

  // Хвост: 4 сегмента + жало
  const tailSegs = [
    { x: 0, y: 0.08, z: -0.22, r: 0.08 },
    { x: 0, y: 0.2, z: -0.38, r: 0.07 },
    { x: 0, y: 0.36, z: -0.50, r: 0.06 },
    { x: 0, y: 0.50, z: -0.58, r: 0.05 },
  ];
  for (const s of tailSegs) {
    const seg = sphere(s.r, sandDark, 8);
    seg.position.set(s.x, s.y, s.z);
    body.add(seg);
  }
  // Жало (шило)
  const stinger = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 6), dark);
  stinger.position.set(0, 0.58, -0.63);
  stinger.rotation.x = -0.3;
  body.add(stinger);

  // Ноги (6 пар — по 3 с каждой стороны)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const legX = side * (0.26 + i * 0.03);
      const legZ = 0.08 - i * 0.12;
      const leg = cyl(0.02, 0.02, 0.18, dark);
      leg.position.set(legX, 0.04, legZ);
      leg.rotation.z = side * 0.6;
      body.add(leg);
    }
  }

  let phase = Math.random() * 6;
  let deadT = 0;
  return {
    group,
    triggerAttack(_stage: 1 | 2 = 1) {},
    update(dt, p) {
      phase += dt * (p.moving ? 4 : 1.5);
      deadT = p.dead ? Math.min(1, deadT + dt * 2.2) : 0;
      // Покачивание при ходьбе
      body.position.y = Math.abs(Math.cos(phase * 0.7)) * 0.015 * (p.moving ? 1 : 0.2);
      // Хвост слегка поднимается при атаке
      if (deadT > 0) {
        group.rotation.x = -Math.PI / 2 * Math.min(1, deadT * 1.4);
        body.position.y = -deadT * 0.15;
      } else {
        group.rotation.x *= 1 - Math.min(1, dt * 8);
      }
    },
    equipWeapon() {}, equipShield() {},
    isWeaponEquipped() { return false; },
    isShieldEquipped() { return false; },
    setArmorTint() {},
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
    case 'mob_desert_scorpion':
      return buildScorpion();
    case 'mob_div_fire':
      return buildDemon();
    // ── Озеро: подводные существа ──
    // Цвета намеренно светлее воды: озеро тёмное, и тёмная тварь на нём
    // не читается — игрок должен видеть, что в воде кто-то есть.
    // Размеры под дистанцию боя (3 м): крупнее — и тварь занимает
    // пол-экрана вместо того, чтобы быть мишенью.
    case 'mob_lake_piranha':
      return buildFish({ body: 0x8a9a86, belly: 0xe8d8b0, length: 0.34, girth: 0.10, eye: 0xffb03a, jaws: true });
    case 'mob_lake_sturgeon_horror':
      return buildFish({ body: 0x6e7a5e, belly: 0xc4bd94, length: 0.95, girth: 0.24, eye: 0xd8d24a, jaws: true });
    case 'mob_lake_ghost_fish':
      return buildFish({ body: 0xd6f0ff, belly: 0xffffff, length: 0.72, girth: 0.19, eye: 0x6ecf7a, glow: 0xa8e4ff });
    case 'mob_lake_leviathan':
      return buildFish({ body: 0x4a7a9e, belly: 0x9ec4d4, length: 1.7, girth: 0.42, eye: 0xff6a4a, glow: 0x5aa8d8, jaws: true });
    case 'world_boss_simurgh':
      return buildSimurgh();
    case 'mob_wolf':
      return buildQuadruped({ fur: 0x6e6a62, furDark: 0x413e39, light: 0xb4ada0 });
    // Оазисная рысь: пятнистого меха геометрией не сделать, поэтому
    // отличия — цвет и размер.
    case 'mob_oasis_lynx':
      return buildQuadruped({ fur: 0x9a7a4e, furDark: 0x5c452a, light: 0xd8c49a, scale: 1.2 });
    case 'mob_caravan_raider':
      return buildHumanoid({ robe: 0x6a5230, robeDark: 0x3a2c18, hat: 'hood', hatColor: 0x2a2014, weapon: 'rapier', scale: 1.08 });
    case 'mob_corsair':
      return buildHumanoid({ robe: 0x2a3a4a, robeDark: 0x16202a, hat: 'cap', hatColor: 0x1a2028, weapon: 'rapier', scale: 1.10 });
    // Портный головорез - самый крупный наземный монстр залива: без
    // оружия в руках, только напястник из корабельной арматуры.
    case 'mob_harbor_brute':
      return buildHumanoid({ robe: 0x4a4038, robeDark: 0x2a2420, hat: 'none', hatColor: 0x000000, weapon: 'none', shield: true, scale: 1.34 });

    // ── Подводные залива ──────────────────────────────────────
    // Тело рыбы, а не гуманоид: все три помечены aquatic, ИИ держит их в
    // воде, и суша с мечом была бы враньём.
    // Цвета светлее воды залива намеренно: вода тёмная, и тёмная тварь
    // в ней не читается — игрок должен видеть, что в воде кто-то есть.
    case 'mob_gulf_reef_raider':
      return buildFish({ body: 0x7a8f86, belly: 0xd6cfae, length: 1.1, girth: 0.28, eye: 0xffb03a, jaws: true });
    case 'mob_gulf_depth_lurker':
      return buildFish({ body: 0x2e3a4e, belly: 0x8ea0b8, length: 2.1, girth: 0.55, eye: 0x9fe8ff, glow: 0x2a4a6a, jaws: true });
    case 'mob_gulf_leviathan_cub':
      return buildFish({ body: 0x3f6a78, belly: 0xbfe0e8, length: 1.6, girth: 0.44, eye: 0xff6a4a, glow: 0x3a7a8a, jaws: true });

    // ── Герат: восьмой регион ───────────────────────────────
    // Три монстра Герата. Без своих веток они уезжали в default и
    // рисовались гуманоидом в капюшоне с мечом - то есть выглядели как
    // бандиты из другого края мира. Проверка «у каждого монстра из базы
    // есть своя ветка» это сторожит.
    case 'mob_herat_gate_guard':
      // Страж врат: тяжёлая броня, щит, шлем. Он стоит на посту, и вид у
      // него должен читаться как стойкий, а не как нападающий.
      return buildHumanoid({ robe: 0x4a4e58, robeDark: 0x2a2d34, hat: 'helmet', hatColor: 0xb8a068, weapon: 'sword', shield: true, scale: 1.20 });
    case 'mob_herat_road_reaver':
      // Дорожный налётчик: плащ в пыли, кинжал вместо меча, ниже остальных.
      return buildHumanoid({ robe: 0x8a7048, robeDark: 0x544028, hat: 'hood', hatColor: 0x6a5230, weapon: 'dagger', scale: 1.02 });
    case 'mob_herat_dust_lord':
      // Пыльный владыка: мифическое тело, а не гуманоид. То же тело, что у
      // джиннов и песчаного дива, - и это честное ограничение сборки, а не
      // пропуск: отдельное тело для пыли - следующая работа.
      return buildDemon();

    // ── Дальние края: девятый и десятый регионы ──────────────────────────
    // Решение владельца: за x = ±2350 край стал настоящей землёй. Шестеро
    // монстров без веток молча уезжали в default - гуманоид в капюшоне с
    // саблей, - и два мифических босса выглядели бы как рядовой налётчик.
    case 'mob_east_ridge_watch':
      // Страж хребта: самая холодная броня на карте, широкий щит, выше всех.
      // Горы на востоке холодные и каменные, и вид должен быть каменным.
      return buildHumanoid({ robe: 0x39424f, robeDark: 0x1b212b, hat: 'helmet', hatColor: 0xaebfd2, weapon: 'sword', shield: true, scale: 1.24 });
    case 'mob_east_road_reaver':
      // Каменный дорожник: ржавый доспех, топора нет - только рапира, потому
      // что бьёт вдоль дороги, а не по камню.
      return buildHumanoid({ robe: 0x6b4a3a, robeDark: 0x3a2721, hat: 'cap', hatColor: 0x8a6a4a, weapon: 'rapier', scale: 1.06 });
    case 'mob_east_horizon_terror':
      // Ужас Горизонта: мифическое тело, а не гуманоид. То же тело, что у
      // гератского Пыльного Владыки, - ограничение сборки, а не пропуск.
      return buildDemon();
    case 'mob_west_plain_stalker':
      // Степной ловчий: самое быстрое тело на западе, без щита и без шлема,
      // только чалма. Он не дерётся в стойке, он догоняет.
      return buildHumanoid({ robe: 0x7f7a5c, robeDark: 0x47442f, hat: 'turban', hatColor: 0xbdb487, weapon: 'dagger', scale: 0.98 });
    case 'mob_west_border_warden':
      // Смотритель границы: тяжелее всех на западе, с огромным щитом и
      // посохом - он держит границу, а не догоняет.
      return buildHumanoid({ robe: 0x3f4a3a, robeDark: 0x212a1f, hat: 'helmet', hatColor: 0x8fa07c, weapon: 'staff', shield: true, scale: 1.28 });
    case 'mob_west_limit_stalker':
      // Ловчий Предела: мифическое тело. Самая тёмная окраска на карте.
      return buildDemon();
    // ── ЧТО БЫЛО ПОД ЭТИМ БЛОКОМ ──────────────────────────────
    // Дальше шёл `default: buildHumanoid({ hood, sword })`. Из двадцати
    // четырёх монстров разбирались одиннадцать, а остальные ТРИНАДЦАТЬ
    // рисовались как гуманоид в капюшоне с мечом - и молча. Среди них
    // четыре босса: bandit_king, ottoman_pasha, div_arzhang и мировой
    // босс rustam_reborn. То есть «Великий Рустам» был капюшоном с
    // саблей, и это выглядело не поломкой, а просто бедной графикой.
    //
    // Почему молчало: поле modelPath в monsters.ts указывало на .fbx
    // для всех двадцати четырёх, но клиент не грузит модели вообще -
    // он собирает тела процедурно по monsterId. Поле выглядело как
    // рабочее описание внешности и не читалось никем.
    //
    // Теперь каждый монстр базы имеет свою ветку, а не подменяется
    // заглушкой. Проверка monsterRigCoverage.test.ts не даёт вернуться
    // к молчаливому default.
    //
    // Общая форма у джиннов и дивов - buildDemon: он не принимает цвет,
    // поэтому эти четверо выглядят одинаково. Это честное ограничение
    // сборки, а не пропуск: отдельные тела для них - следующая работа.
    case 'mob_road_bandit':
      return buildHumanoid({ robe: 0x7a6a52, robeDark: 0x4c4030, hat: 'none', hatColor: 0x000000, weapon: 'dagger', scale: 0.95 });
    case 'mob_assassin_acolyte':
      return buildHumanoid({ robe: 0x2e2a38, robeDark: 0x1c1924, hat: 'hood', hatColor: 0x241f30, weapon: 'dagger', scale: 1.0 });
    case 'mob_fog_assassin':
      return buildHumanoid({ robe: 0x9aa4a8, robeDark: 0x6e787c, hat: 'hood', hatColor: 0x8c969a, weapon: 'rapier', scale: 1.04 });
    case 'mob_undead_guardian':
      return buildHumanoid({ robe: 0x5c5442, robeDark: 0x3a3428, hat: 'none', hatColor: 0x000000, weapon: 'sword', shield: true, scale: 1.06 });
    case 'mob_rain_spirit':
      // Дух воды: бледный, без оружия, слегка крупнее человека.
      return buildHumanoid({ robe: 0x9fc8d8, robeDark: 0x6f9cb0, hat: 'none', hatColor: 0x000000, weapon: 'none', scale: 1.05 });
    case 'mob_sand_elemental':
      return buildHumanoid({ robe: 0xc4a878, robeDark: 0x9a8256, hat: 'none', hatColor: 0x000000, weapon: 'none', scale: 1.12 });
    case 'mob_storm_djinn':
    case 'mob_sand_div':
      return buildDemon();
    case 'boss_bandit_king':
      return buildHumanoid({ robe: 0x6e4a2a, robeDark: 0x3e2a18, hat: 'helmet', hatColor: 0xd8b048, weapon: 'sword', shield: true, scale: 1.25 });
    case 'boss_ottoman_pasha':
      return buildHumanoid({ robe: 0x2e5a44, robeDark: 0x1a3a2c, hat: 'turban', hatColor: 0xf0e8d8, weapon: 'sword', shield: true, scale: 1.30 });
    case 'boss_div_arzhang':
      return buildDemon();
    case 'world_boss_rustam_reborn':
      // Рустам - герой, а не демон: тяжёлый доспех, шлем, рапира, щит и
      // масштаб мирового босса.
      return buildHumanoid({ robe: 0x8a8f96, robeDark: 0x4c5158, hat: 'helmet', hatColor: 0xc0c8d0, weapon: 'rapier', shield: true, scale: 1.45 });
    default:
      // Заглушка осталась, но больше не молчит: любая новая ветка,
      // не попавшая в разбор, будет видна в игре как капюшон с мечом.
      return buildHumanoid({ robe: 0x605040, robeDark: 0x40362c, hat: 'hood', hatColor: 0x4c3a22, weapon: 'sword' });
  }
}

/** Риг игрока по классу */
// ── Фигура по рисунку: халат в два слоя, тюрбан, перевязь ──────
//
// Всё, что ниже, относится к одному только игроку. NPC собираются через
// buildHumanoid, и он намеренно не тронут: переписать его вместе с героем
// означало бы поменять облик всех горожан и мобов, а это отдельное решение
// владельца, а не побочный эффект.

// Смешать цвет с кремовым: приглушение вместо замены.
function muted(color: number, toward: number, t: number): number {
  const c = new THREE.Color(color);
  const d = new THREE.Color(toward);
  c.lerp(d, t);
  return c.getHex();
}

/**
 * Тело вращения по профилю.
 *
 * phiStart и phiLength дают разрез спереди: халат на рисунке распахнут, и из
 * щели видна светлая рубаха. Прежний халат был сплошным телом вращения, то
 * есть колоколом без всяких слоёв.
 *
 * Углы: three раскладывает профиль как x = r·sin(phi), z = r·cos(phi), то
 * есть перед (+Z) - это phi = 0, а не phi = π/2. Разрез шириной gap по центру
 * спереди получается, если вести обходот от gap/2 на 2π - gap.
 *
 * Первая версия ставила phiStart = π/2 + gap/2, и разрез оказывался сбоку:
 * халат был распахнут на левом боку, а капюшон наполовину закрывал лицо.
 * Ошибку видно только глазами - все проверки были зелёные.
 */
function lathe(
  points: [number, number][],
  material: THREE.Material,
  seg = 16,
  phiStart = 0,
  phiLength = Math.PI * 2,
): THREE.Mesh {
  const profile = points.map(([x, y]) => new THREE.Vector2(x, y));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, seg, phiStart, phiLength), material);
  mesh.castShadow = true;
  return mesh;
}

/** Плоская полоса с толщиной: лацканы, конец перевязи, хвост тюрбана. */
function slab(w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
  return box(w, h, d, m);
}

/** Ширина разреза халата спереди. */
const ROBE_GAP = 0.75;

/**
 * Тюрбан на макушке.
 *
 * Голова в сборке устроена так: начало группы - у основания черепа, сам
 * череп поднят на 0.12. Прежний тюрбан ставился на ноль группы, то есть
 * на шею, и накрывал лицо. Теперь весь головной убор поднимается на
 * HEAD_TOP = 0.19 - выше середины черепа, но ниже его вершины.
 */
const HEAD_TOP = 0.19;

function buildTurban(color: number): THREE.Group {
  const g = new THREE.Group();
  g.position.y = HEAD_TOP;
  const m = mat(color, 0.95, 0.05);
  const mLight = mat(muted(color, 0xf4ecd8, 0.28), 0.95, 0.05);

  // Купол: основание на макушке, вершина выше черепа
  const dome = lathe([
    [0.0, 0.0], [0.14, 0.004], [0.168, 0.03], [0.175, 0.075],
    [0.172, 0.115], [0.15, 0.148], [0.09, 0.166], [0.0, 0.172],
  ], m, 20);
  g.add(dome);

  // Витки намотки. Радиус каждого чуть больше купола на этой высоте, иначе
  // кольца утонут в ткани и намотки не видно.
  // Радиус каждого витка - радиус купола на этой высоте плюс 0.014. Первый
  // вариант ставил виток уже купола, и он просто тонул в ткани: намотка
  // читалась как brim, то есть персонаж был в шляпе.
  const wraps: [number, number][] = [[0.03, 0.182], [0.075, 0.19], [0.115, 0.188]];
  wraps.forEach(([y, r], i) => {
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 7, 20), i === 1 ? mLight : m);
    wrap.rotation.x = Math.PI / 2;
    wrap.rotation.z = 0.26 * (i - 1);
    wrap.position.y = y;
    wrap.castShadow = true;
    g.add(wrap);
  });

  // Хвост ткани сзади - та самая деталь, по которой тюрбан узнаётся
  const tail = slab(0.1, 0.24, 0.06, m);
  tail.position.set(0.05, 0.07, -0.16);
  tail.rotation.x = 0.55;
  g.add(tail);
  return g;
}

/** Мягкая шапка с загнутой вершиной: у дипломата на рисунке именно такая. */
function buildSoftCap(color: number): THREE.Group {
  const g = new THREE.Group();
  g.position.y = HEAD_TOP;
  const m = mat(color, 0.9, 0.06);
  const cap = lathe([
    [0.0, 0.0], [0.14, 0.0], [0.158, 0.045], [0.155, 0.09],
    [0.13, 0.13], [0.08, 0.155], [0.0, 0.165],
  ], m, 18);
  g.add(cap);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.085, 8), m);
  tip.position.set(0, 0.185, -0.055);
  tip.rotation.x = -0.95;
  tip.castShadow = true;
  g.add(tip);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.02, 6, 18), mat(muted(color, 0x000000, 0.35), 0.9, 0.06));
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.022;
  g.add(band);
  return g;
}

/**
 * Капюшон: купол и полы, лицо открыто.
 *
 * Первый вариант был сферой с вырезанным спереди сектором. Сфера с вырезом
 * не годится: материал односторонний, поэтому сквозь вырез видно насквозь,
 * а края выреза - дуги - читаются как два рога. Теперь это тело вращения с
 * разрезом: края у него радиальные и прямые, то есть выглядят как вырез
 * капюшона, а материал двусторонний, и изнутри видно подкладку.
 */
function buildHood(color: number): THREE.Group {
  const g = new THREE.Group();
  g.position.y = HEAD_TOP;
  const m = mat(color, 0.95, 0.04);
  m.side = THREE.DoubleSide;
  // Одна деталь вместо двух: пола идёт от шеи вверх, обходит голову и
  // смыкается на макушке, спереди остаётся вырез под лицо.
  //
  // Второй вариант был куполом плюс отдельной полой. Купол начинался на
  // 0.19 - как раз на уровне бровей (0.196) - и нависал над лицом, так что
  // капюшон закрывал голову целиком. Здесь нижняя точка профиля - это шея,
  // а лоб остаётся открытым.
  g.add(lathe([
    [0.152, -0.1], [0.172, -0.02], [0.18, 0.08], [0.176, 0.15],
    [0.156, 0.21], [0.115, 0.245], [0.055, 0.262], [0.0, 0.268],
  ], m, 20, 0.95, Math.PI * 2 - 1.9));
  return g;
}

/** Борода каплей плюс усы. Прежняя была приплюснутым шаром. */
function buildBeard(color: number): THREE.Group {
  const g = new THREE.Group();
  const m = mat(color, 0.9, 0.05);
  // Борода: уже и короче прежней. Широкая капля закрывала подбородок и
  // читалась вместе с усами как маска на пол-лица.
  const drop = new THREE.Mesh(new THREE.ConeGeometry(0.072, 0.19, 7), m);
  drop.rotation.x = Math.PI;
  drop.position.set(0, -0.03, 0.08);
  drop.castShadow = true;
  g.add(drop);
  // Усы: две полоски, расходящиеся от центра. Прежний брусок шириной 0.15
  // лежал поперёк рта и был единственной тёмной полосой на лице.
  for (const side of [-1, 1]) {
    const stache = slab(0.062, 0.024, 0.04, m);
    stache.position.set(side * 0.038, 0.088, 0.128);
    stache.rotation.z = side * 0.3;
    g.add(stache);
  }
  return g;
}

/**
 * Сапог с голенищем.
 *
 * В прежней сборке подошва стояла на -0.93 относительно бедра при высоте
 * бедра 0.95 - то есть на земле. Здесь бедро выше (0.92), а сапог длинный
 * и достаёт до земли: подошва на -0.86, то есть на высоте 0.06.
 */
function buildBoot(color: number): THREE.Group {
  const g = new THREE.Group();
  const m = mat(color, 0.8, 0.15);
  const shaft = cyl(0.058, 0.078, 0.8, m, 10);
  shaft.position.y = -0.4;
  const cuffRing = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.016, 6, 12), mat(muted(color, 0x000000, 0.3), 0.8, 0.15));
  cuffRing.rotation.x = Math.PI / 2;
  cuffRing.position.y = -0.76;
  const foot = box(0.11, 0.1, 0.24, mat(muted(color, 0x000000, 0.25), 0.8, 0.15));
  foot.position.set(0, -0.86, 0.04);
  const toe = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), mat(muted(color, 0x000000, 0.15), 0.8, 0.15));
  toe.scale.set(0.85, 0.6, 1.25);
  // Мысок отодвинут назад: на 0.14 он вылезал из-под рубахи (0.218 против
  // радиуса ткани 0.212) и проглядывал в просмотре между полами халата.
  toe.position.set(0, -0.87, 0.085);
  g.add(shaft, cuffRing, foot, toe);
  return g;
}

/**
 * Сборка фигуры по рисунку.
 *
 * Сохраняется всё, чего ждёт остальная игра: те же группы (body, torso,
 * head, armL/armR, legL/legR), оружие в правой руке, щит в левой, та же
 * анимация и тот же контракт Rig.
 */
function buildFigure(cfg: HumanoidCfg): Rig {
  const CREAM = 0xe8dcc0;          // нижняя рубаха
  const SASH = 0x8a6a3c;           // перевязь
  const HAIR = 0x4a3524;           // волосы и борода
  const LEATHER = 0x6b4a2f;        // сапоги

  const upper = mat(muted(cfg.robe, CREAM, 0.42), 0.94, 0.04);
  // Халат виден изнутри, когда он распахнут, поэтому двусторонний.
  upper.side = THREE.DoubleSide;
  const under = mat(CREAM, 0.95, 0.03);
  const sashMat = mat(SASH, 0.9, 0.06);
  const s = cfg.scale ?? 1;

  const group = new THREE.Group();
  const body = new THREE.Group();     // опускается при приседе
  group.add(body);

  // ── Ноги и сапоги ──
  // Расставка ног подобрана так, чтобы сапог целиком помещался внутрь рубахи.
  // При прежней расстановке (±0.11) и прежней толщине сапога (радиус 0.098)
  // его край доходил до 0.208 при радиусе рубахи 0.211 - то есть нога
  // упиралась в ткань почти вплотную, и в просмотре сапоги проглядывали
  // сквозь рубаху. Теперь запас около 0.045.
  const legL = new THREE.Group(); legL.name = 'legL'; legL.position.set(-0.085, 0.92, 0);
  const legR = new THREE.Group(); legR.name = 'legR'; legR.position.set(0.085, 0.92, 0);
  const boot = buildBoot(LEATHER);
  legL.add(boot.clone());
  legR.add(boot.clone());
  body.add(legL, legR);

  // ── Торс ──
  const torso = new THREE.Group();
  // Имена группам: без них проверка геометрии вынуждена угадывать, где
  // торс, по координатам, и не может отличить «анимация на суше отработала»
  // от «персонаж всё это время считался в воде» - а это разные ветки кода.
  torso.name = 'torso';
  torso.position.y = 0.98;

  // Нижняя рубаха: светлая, видна в разрезе халата и снизу
  const tunic = lathe([
    [0.0, -0.85], [0.2, -0.84], [0.212, -0.5], [0.205, -0.15],
    [0.198, 0.12], [0.2, 0.32], [0.182, 0.48], [0.13, 0.58], [0.0, 0.62],
  ], under, 20);
  torso.add(tunic);

  // Халат: тот же профиль, что и у юбки, но сверху он идёт к плечам, и спереди
  // в нём настоящий разрез. Радиус держится ровным (0.215–0.225), а внизу
  // чуть расширяется - это халат, а не колокол.
  const robe = lathe([
    [0.228, -0.93], [0.232, -0.6], [0.226, -0.28], [0.222, 0.0],
    [0.228, 0.26], [0.216, 0.46], [0.17, 0.58], [0.0, 0.63],
  ], upper, 26, ROBE_GAP / 2, Math.PI * 2 - ROBE_GAP);
  torso.add(robe);

  // Плечи: полусфера с тем же разрезом, чтобы линия халата не замыкалась
  const shoulders = new THREE.Mesh(
    new THREE.SphereGeometry(0.215, 18, 10, ROBE_GAP / 2, Math.PI * 2 - ROBE_GAP),
    upper,
  );
  shoulders.scale.set(1.06, 0.52, 0.9);
  shoulders.position.y = 0.5;
  shoulders.castShadow = true;
  torso.add(shoulders);

  // Лацканы: две полосы, сходящиеся на груди, - на рисунке халат там
  // перехвачен, и это то, что держит разрез от расползания.
  //
  // Цвет - затемнённый халат, а не смешанный с кремовым. Смешанный с
  // кремовым лацкан выходил светлее халата и читался серыми лямками.
  const lapelMat = mat(muted(cfg.robe, 0x1a1410, 0.34), 0.94, 0.04);
  for (const side of [-1, 1]) {
    const lapel = slab(0.1, 0.36, 0.05, lapelMat);
    lapel.position.set(side * 0.075, 0.4, 0.165);
    lapel.rotation.z = side * 0.34;
    lapel.rotation.y = -side * 0.42;
    torso.add(lapel);
  }
  // Воротник
  // Прежний воротник был тором радиусом 0.105 с трубкой 0.028 - белый пончик
  // вокруг шеи. Уменьшен и опущен к горлу.
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.019, 6, 14), under);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.578;
  torso.add(collar);

  // ── Перевязь: широкая, с узлом и свисающим концом ──
  // На рисунке пояс держит весь силуэт. Тонкий золотой пояс прежней сборки
  // этого не давал. Радиус чуть больше халата, иначе она в нём тонет.
  const sash = cyl(0.232, 0.238, 0.2, sashMat, 16);
  sash.position.y = 0.13;
  torso.add(sash);
  const sashEdge = cyl(0.239, 0.239, 0.03, mat(muted(SASH, 0x000000, 0.3), 0.9, 0.06), 16);
  sashEdge.position.y = 0.225;
  torso.add(sashEdge);
  const knot = sphere(0.042, mat(muted(SASH, 0x000000, 0.15), 0.9, 0.06), 8);
  knot.position.set(0.12, 0.11, 0.175);
  torso.add(knot);
  // Начало ниже пояса: прежний конец перевязи начинался выше ремня, и его
  // тёмный угол торчал на поясе чёрной запятой.
  const sashTail = slab(0.09, 0.36, 0.045, sashMat);
  sashTail.position.set(0.13, -0.2, 0.175);
  sashTail.rotation.z = 0.05;
  torso.add(sashTail);

  // ── Голова ──
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 0.68;
  const skull = sphere(0.155, mat(0xe4b284, 0.95), 16);
  skull.position.y = 0.12;
  skull.scale.set(0.94, 1.05, 0.98);
  // Челюсть: убирает шарообразность
  const jaw = cyl(0.02, 0.115, 0.11, mat(0xd6a37a, 0.95), 12);
  jaw.position.set(0, 0.045, 0.035);
  head.add(skull, jaw);
  head.add(buildBeard(HAIR));
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.021, 6, 6), MAT.eye);
  eyeL.position.set(-0.058, 0.155, 0.125);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.058;
  head.add(eyeL, eyeR);
  for (const side of [-1, 1]) {
    const brow = box(0.05, 0.013, 0.02, mat(HAIR, 0.9, 0.05));
    brow.position.set(side * 0.058, 0.196, 0.126);
    head.add(brow);
  }
  // Волосы под убором: показывают, что под тюрбаном или шапкой есть голова
  const hair = sphere(0.157, mat(HAIR, 0.92, 0.05), 14);
  hair.scale.set(1, 0.78, 1);
  hair.position.set(0, 0.13, -0.012);
  head.add(hair);

  if (cfg.hat === 'helmet') {
    const helmGrp = new THREE.Group();
    helmGrp.position.y = HEAD_TOP;
    const helm = lathe([
      [0.0, 0.0], [0.148, 0.0], [0.172, 0.06], [0.176, 0.14], [0.15, 0.2], [0.0, 0.23],
    ], mat(cfg.hatColor, 0.6, 0.35), 18);
    helmGrp.add(helm);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.168, 0.022, 6, 18), mat(muted(cfg.hatColor, 0x000000, 0.25), 0.6, 0.35));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    helmGrp.add(rim);
    const plume = slab(0.035, 0.16, 0.12, mat(0x8a1f2a, 0.9, 0.05));
    plume.position.set(0, 0.3, -0.04);
    plume.rotation.x = -0.25;
    helmGrp.add(plume);
    head.add(helmGrp);
  } else if (cfg.hat === 'turban') {
    head.add(buildTurban(cfg.hatColor));
  } else if (cfg.hat === 'hood') {
    head.add(buildHood(cfg.hatColor));
  } else {
    head.add(buildSoftCap(cfg.hatColor));
  }
  torso.add(head);

  // ── Руки: широкий рукав, потом кисть ──
  const armL = new THREE.Group(); armL.name = 'armL'; armL.position.set(-0.26, 0.46, 0);
  const armR = new THREE.Group(); armR.name = 'armR'; armR.position.set(0.26, 0.46, 0);
  const armGeo = () => {
    const a = new THREE.Group();
    const upperSleeve = cyl(0.092, 0.078, 0.3, upper, 10);
    upperSleeve.position.y = -0.15;
    // Расширяющийся книзу рукав - «бубен» на рисунке
    const wideSleeve = cyl(0.1, 0.148, 0.32, upper, 12);
    wideSleeve.position.y = -0.44;
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.022, 6, 14), mat(muted(cfg.robeDark, CREAM, 0.4), 0.94, 0.04));
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = -0.585;
    const hand = sphere(0.068, mat(0xe4b284, 0.95), 8);
    hand.position.y = -0.66;
    a.add(upperSleeve, wideSleeve, cuff, hand);
    return a;
  };
  armL.add(armGeo()); armR.add(armGeo());
  torso.add(armL, armR);

  // ── Оружие в правой руке ──
  let weaponRef: THREE.Group | null = null;
  if (cfg.weapon !== 'none') {
    weaponRef = buildWeapon(cfg.weapon);
    weaponRef.position.set(0.04, -0.6, 0.12);
    weaponRef.rotation.x = 0.32;
    armR.add(weaponRef);
  }

  // ── Щит в левой ──
  let shieldRef: THREE.Object3D | null = null;
  if (cfg.shield) {
    shieldRef = buildShield(0.27, [-0.2, -0.5, 0.14]);
    armL.add(shieldRef);
  }

  let weaponOn = !!weaponRef;
  let shieldOn = !!shieldRef;

  body.add(torso);
  group.scale.setScalar(s);

  // ── Анимация ──
  // Копия прежней: движение, присед, прыжок, плавание, атака и смерть.
  // ── Анимация ──
  // Копия прежней: движение, присед, прыжок, плавание, атака и смерть.
  // Рост ног и рук изменился, поэтому опорные точки сдвинуты на их длину.
  let phase = Math.random() * 6;
  let attackT = -1;
  let blockT = 0;
  let crouchT = 0;
  let airT = 0;
  let deadT = 0;
  let swimT = 0;

  return {
    group,
    triggerAttack(_stage: 1 | 2 = 1) { if (attackT < 0 || attackT > 1) attackT = 0; },
    update(dt, p) {
      const speedRatio = Math.min(1, p.speed / 7);
      phase += dt * (p.moving ? 2.2 + p.speed * 1.35 : 2);

      attackT = attackT < 0 ? -1 : attackT + dt / 0.45;
      if (attackT > 1.35) attackT = -1;
      blockT += ((p.block ? 1 : 0) - blockT) * Math.min(1, dt * 10);
      crouchT += ((p.crouch ? 1 : 0) - crouchT) * Math.min(1, dt * 8);
      airT += ((p.grounded ? 1 : 0) - airT) * Math.min(1, dt * 10);
      deadT = p.dead ? Math.min(1, deadT + dt * 2.2) : 0;
      swimT += ((p.swimming ? 1 : 0) - swimT) * Math.min(1, dt * 6);

      const inWater = swimT > 0.01;

      if (inWater) {
        const swimLean = 0.55 * swimT;
        torso.rotation.x += (swimLean - torso.rotation.x) * Math.min(1, dt * 6);
        torso.position.y = 0.68 * (1 - swimT) + 0.55 * swimT;
        const swimPhase = phase * 0.8;
        const armSwingL = Math.sin(swimPhase) * 0.7 * swimT;
        const armSwingR = Math.sin(swimPhase + Math.PI) * 0.7 * swimT;
        armL.rotation.x += (armSwingL - 0.3 * swimT - armL.rotation.x) * Math.min(1, dt * 8);
        armL.rotation.z += (-0.4 * swimT - armL.rotation.z) * Math.min(1, dt * 8);
        armR.rotation.x += (armSwingR - 0.3 * swimT - armR.rotation.x) * Math.min(1, dt * 8);
        armR.rotation.z += (0.4 * swimT - armR.rotation.z) * Math.min(1, dt * 8);
        const legKick = Math.sin(swimPhase * 1.3) * 0.3 * swimT;
        legL.rotation.x += (legKick - 0.2 * swimT - legL.rotation.x) * Math.min(1, dt * 10);
        legR.rotation.x += (-legKick - 0.2 * swimT - legR.rotation.x) * Math.min(1, dt * 10);
      }

      const w = Math.sin(phase);
      const swingAmp = p.moving ? 0.28 + 0.5 * speedRatio : 0.035;

      if (!inWater) {
        const legLX = w * swingAmp - airT * 0.55 - crouchT * 0.7;
        const legRX = -w * swingAmp - airT * 0.3 - crouchT * 0.5;
        legL.rotation.x += (legLX - legL.rotation.x) * Math.min(1, dt * 14);
        legR.rotation.x += (legRX - legR.rotation.x) * Math.min(1, dt * 14);

        const bob = p.moving && p.grounded ? Math.abs(Math.cos(phase)) * 0.05 * (0.4 + speedRatio) : Math.sin(phase * 0.6) * 0.012;
        torso.position.y = 0.98 + bob - crouchT * 0.34;
        const leanX = (p.moving ? 0.1 * speedRatio : 0.02 * Math.sin(phase * 0.5)) + crouchT * 0.32 + airT * 0.12;
        torso.rotation.x += (leanX - torso.rotation.x) * Math.min(1, dt * 8);
        torso.rotation.y *= (1 - Math.min(1, dt * 6));

        const armLX = -w * swingAmp * 0.75 - blockT * 2.1 - airT * 0.35 + crouchT * 0.3;
        const armRX = w * swingAmp * 0.75 + airT * 0.3;
        armL.rotation.x += (armLX - armL.rotation.x) * Math.min(1, dt * 12);
        armL.rotation.z += (blockT * -0.5 - armL.rotation.z) * Math.min(1, dt * 12);
        armR.rotation.x += (armRX - armR.rotation.x) * Math.min(1, dt * 12);
        armR.rotation.z += (attackT >= 0 && attackT < 0.35 ? -0.9 : 0) * 1 - armR.rotation.z * 0.2;
      }

      if (attackT >= 0) {
        const t = attackT;
        if (t < 0.35) {
          const k = t / 0.35;
          armR.rotation.x = -0.2 - k * 2.1;
          torso.rotation.y = -k * 0.35;
        } else if (t < 0.62) {
          const k = (t - 0.35) / 0.27;
          armR.rotation.x = -2.3 + k * 3.3;
          torso.rotation.y = -0.35 + k * 0.55;
        } else {
          const k = (t - 0.62) / 0.73;
          armR.rotation.x = 1.0 - k * 1.0;
          torso.rotation.y = 0.2 * (1 - k);
        }
      }

      if (deadT > 0) {
        group.rotation.x = -Math.PI / 2 * Math.min(1, deadT * 1.4);
        body.position.y = -deadT * 0.25;
      } else {
        group.rotation.x *= (1 - Math.min(1, dt * 8));
        body.position.y = -crouchT * 0.36;
      }
    },
    equipWeapon(visible: boolean) {
      if (weaponRef) { weaponRef.visible = visible; weaponOn = visible; }
    },
    equipShield(visible: boolean) {
      if (shieldRef) { shieldRef.visible = visible; shieldOn = visible; }
    },
    isWeaponEquipped() { return weaponOn; },
    isShieldEquipped() { return shieldOn; },
    setArmorTint(color) {
      // Перекрашиваем материал верха: под нагрудным доспехом должен
      // меняться халат, иначе игрок не видит, что надел
      upper.color.setHex(color ?? cfg.robe);
    },
    dispose() {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
    },
  };
}

export function buildPlayerRig(charClass: string): Rig {
  const cfgs: Record<string, HumanoidCfg> = {
    qizilbash: { robe: 0xa62c38, robeDark: 0x7c1f28, hat: 'helmet', hatColor: 0xb2b8c4, weapon: 'sword', shield: true },
    sufi_mystic: { robe: 0x6f54c8, robeDark: 0x4c3a8c, hat: 'turban', hatColor: 0x2e8b8b, weapon: 'staff' },
    persian_archer: { robe: 0x3e8a58, robeDark: 0x2c6440, hat: 'hood', hatColor: 0x6e563a, weapon: 'bow' },
    bazaar_merchant: { robe: 0xc9a03a, robeDark: 0x96752a, hat: 'turban', hatColor: 0xe8e0d0, weapon: 'dagger' },
    court_diplomat: { robe: 0x3a7fb2, robeDark: 0x2a5e84, hat: 'cap', hatColor: 0xb2b8c4, weapon: 'rapier' },
  };
  // Сборка по рисунку: халат в два слоя, тюрбан, перевязь, борода,
  // сапоги. NPC собираются через buildHumanoid - он не тронут.
  return buildFigure(cfgs[charClass] ?? cfgs.qizilbash);
}


