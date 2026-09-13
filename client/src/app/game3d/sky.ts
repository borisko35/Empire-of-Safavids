// ============================================================
// Небо: купол, солнце, луна, звёзды, облака — Empire of Safavids
// ============================================================
// Час игровых суток (0–23) движёт солнце и луну по дуге; купол с
// градиентом перекрашивается (рассвет/день/закат/ночь), звёзды
// проявляются к ночи. Облака — кластеры перекрывающихся сфер
// («пух»), дрейфующие над миром. Купол и светила центрируются на
// игроке, поэтому дальность мира не ограничивает небо.

import * as THREE from 'three';

const SKY_RADIUS = 1500;
const CELESTIAL_RADIUS = 1080;

export interface SkyHandle {
  update(dt: number, now: number, hour01: number, center: { x: number; z: number }): void;
  /** Направление на солнце (y < 0 — солнце под горизонтом) */
  sunDirection: THREE.Vector3;
  /** Цвет горизонта — для тумана сцены */
  horizonColor: THREE.Color;
  dispose(): void;
}

interface Palette {
  top: THREE.Color;
  horizon: THREE.Color;
}

const DAY: Palette = { top: new THREE.Color(0x4a7ec2), horizon: new THREE.Color(0xcfe0ea) };
const DUSK: Palette = { top: new THREE.Color(0x35476e), horizon: new THREE.Color(0xe8956a) };
const NIGHT: Palette = { top: new THREE.Color(0x060b18), horizon: new THREE.Color(0x0d1626) };

function mixPalette(a: Palette, b: Palette, t: number): Palette {
  return {
    top: a.top.clone().lerp(b.top, t),
    horizon: a.horizon.clone().lerp(b.horizon, t),
  };
}

/** Пушистое облако: 6–9 перекрывающихся сфер с плоским низом */
function makePuffCloud(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const puffs = 6 + Math.floor(Math.random() * 4);
  const base = 5 + Math.random() * 5;
  for (let i = 0; i < puffs; i++) {
    const r = base * (0.45 + Math.random() * 0.7);
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
    puff.position.set(
      (i - puffs / 2) * base * 0.62 + (Math.random() - 0.5) * base * 0.4,
      Math.random() * base * 0.3,
      (Math.random() - 0.5) * base * 1.4,
    );
    puff.scale.y = 0.55 + Math.random() * 0.25;
    g.add(puff);
  }
  return g;
}

export function createSky(scene: THREE.Scene): SkyHandle {
  // ── Купол с вертикальным градиентом ──
  const uniforms = {
    topColor: { value: DAY.top.clone() },
    bottomColor: { value: DAY.horizon.clone() },
  };
  const domeMat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */`
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y;
        float t = smoothstep(-0.02, 0.42, h);
        gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 18), domeMat);
  scene.add(dome);

  // ── Солнце с ореолом ──
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(34, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false }),
  );
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 128;
  const gctx = glowCanvas.getContext('2d')!;
  const grad = gctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,236,170,0.85)');
  grad.addColorStop(0.35, 'rgba(255,214,120,0.30)');
  grad.addColorStop(1, 'rgba(255,200,100,0)');
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, 128, 128);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, fog: false }));
  sunGlow.scale.set(340, 340, 1);
  const sunGroup = new THREE.Group();
  sunGroup.add(sun, sunGlow);
  scene.add(sunGroup);

  // ── Луна ──
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(22, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xe6ebf4, fog: false }),
  );
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, transparent: true, opacity: 0.45, depthWrite: false, fog: false,
    color: 0xbccbe8,
  }));
  moonGlow.scale.set(180, 180, 1);
  const moonGroup = new THREE.Group();
  moonGroup.add(moon, moonGlow);
  scene.add(moonGroup);

  // ── Звёзды ──
  const starCount = 1100;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.92); // верхняя полусфера
    const r = SKY_RADIUS * 0.94;
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi);
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xdfe8ff, size: 2.1, sizeAttenuation: false,
    transparent: true, opacity: 0, fog: false, depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // ── Облака ──
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92, flatShading: true,
    emissive: 0x8a93a8, emissiveIntensity: 0.24,
  });
  const clouds: { group: THREE.Group; speed: number }[] = [];
  for (let i = 0; i < 9; i++) {
    const cloud = makePuffCloud(cloudMat);
    const a = (i / 9) * Math.PI * 2 + Math.random();
    const r = 260 + Math.random() * 820;
    cloud.position.set(Math.cos(a) * r, 95 + Math.random() * 55, Math.sin(a) * r);
    clouds.push({ group: cloud, speed: 1.0 + Math.random() * 1.6 });
    scene.add(cloud);
  }

  const sunDirection = new THREE.Vector3(0, 1, 0);
  const horizonColor = new THREE.Color();

  function update(dt: number, now: number, dayFraction: number, center: { x: number; z: number }): void {
    const hour01 = dayFraction * 24; // 0–23
    // Купол, звёзды и светила следуют за игроком
    dome.position.set(center.x, 0, center.z);
    stars.position.set(center.x, 0, center.z);

    // Дуга: восход в 6, зенит в 12, закат в 18 (дневная половина)
    const dayAngle = ((hour01 - 6) / 12) * Math.PI;
    const e = Math.sin(dayAngle); // высота солнца: >0 днём
    sunDirection.set(Math.cos(dayAngle), e, -0.38).normalize();

    // Луна — та же дуга со сдвигом на 12 часов
    const mAngle = ((hour01 + 12 - 6) / 12) * Math.PI;
    const mElev = Math.sin(mAngle);
    moonGroup.position.set(
      center.x + Math.cos(mAngle) * CELESTIAL_RADIUS * Math.cos(0.32),
      mElev * CELESTIAL_RADIUS,
      center.z - 0.35 * CELESTIAL_RADIUS,
    );
    sunGroup.position.set(
      center.x + sunDirection.x * CELESTIAL_RADIUS,
      sunDirection.y * CELESTIAL_RADIUS,
      center.z + sunDirection.z * CELESTIAL_RADIUS,
    );
    sunGlow.position.set(0, 0, 0);
    sun.visible = e > -0.12;
    sunGlow.visible = e > -0.12;
    moon.visible = mElev > -0.1;
    moonGlow.visible = mElev > -0.1;

    // Палитра по высоте солнца: ночь -> закат/рассвет -> день
    let pal: Palette;
    if (e < -0.08) pal = NIGHT;
    else if (e < 0.22) pal = mixPalette(NIGHT, DUSK, Math.max(0, (e + 0.08) / 0.3));
    else if (e < 0.5) pal = mixPalette(DUSK, DAY, (e - 0.22) / 0.28);
    else pal = DAY;

    // Золотой отблеск на горизонте со стороны солнца на рассвете/закате
    if (e > -0.05 && e < 0.3) {
      pal = {
        top: pal.top,
        horizon: pal.horizon.clone().lerp(new THREE.Color(0xf2b06a), Math.sin(((0.3 - Math.abs(e)) / 0.35)) * 0.5),
      };
    }

    uniforms.topColor.value.copy(pal.top);
    uniforms.bottomColor.value.copy(pal.horizon);
    horizonColor.copy(pal.horizon);

    starMat.opacity = Math.min(1, Math.max(0, -e * 3.4));
    stars.rotation.y = now / 240000;

    // Дрейф облаков
    for (const c of clouds) {
      c.group.position.x += dt * c.speed;
      if (c.group.position.x > center.x + 1150) c.group.position.x = center.x - 1150;
      // лёгкая пульсация в цвет неба: ночью облака темнее
      const nightK = Math.min(1, Math.max(0, -e * 2.4));
      cloudMat.color.setRGB(1 - nightK * 0.82, 1 - nightK * 0.82, 1 - nightK * 0.78);
    }
  }

  function dispose(): void {
    dome.geometry.dispose(); domeMat.dispose();
    sun.geometry.dispose(); (sun.material as THREE.Material).dispose();
    moon.geometry.dispose(); (moon.material as THREE.Material).dispose();
    starGeo.dispose(); starMat.dispose();
    glowTex.dispose();
    for (const c of clouds) c.group.children.forEach(ch => (ch as THREE.Mesh).geometry.dispose());
    cloudMat.dispose();
  }

  return { update, sunDirection, horizonColor, dispose };
}
