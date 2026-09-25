// ============================================================
// Погода 3D — Empire of Safavids
// ============================================================
// Дождь (полосы + капли), молния с громом, ветер (слышен везде,
// песчинки — только вне города), песчаная буря (вихрь + вой ветра).
// Ключ погоды — АНГЛИЙСКИЙ код сервера (clear/cloudy/rain/storm/
// fog/sandstorm/snow), а не русская подпись из HUD.

import * as THREE from 'three';
import type { audio as audioType } from '../audio';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'sandstorm' | 'snow' | 'wind';

const RAIN_COUNT = 700;
const RAIN_W = 55;
const RAIN_H = 30;
const WIND_COUNT = 380;
const SAND_COUNT = 650;
const SAND_R = 30;

export interface WeatherHandle {
  setWeather(w: string): void;
  /** Скрыть/показать погоду (true = снаружи, false = внутри здания) */
  setInside(v: boolean): void;
  update(dt: number, cx: number, cz: number, groundY: number, inCity: boolean): void;
  dispose(): void;
}

export function createWeather(scene: THREE.Scene, audio: typeof audioType): WeatherHandle {
  let kind: WeatherKind = 'clear';
  let lightningIn = 3 + Math.random() * 5;
  let flashEl: HTMLDivElement | null = null;
  const fog = scene.fog as THREE.Fog | null;
  const fogHome = fog ? { near: fog.near, far: fog.far, color: fog.color.getHex() } : null;
  let fogK = 0;
  let sandK = 0;
  let inside = false; // true = игрок внутри здания // 0 — обычный, 1 — песчаный


  // ── Дождь: вертикальные полосы ──
  // Координаты капель — АБСОЛЮТНЫЕ мировые (с учётом высоты земли baseY):
  // меш всегда в начале координат, иначе на горах дождь висел в воздухе
  // (локальный порог сравнивался с groundY поверх смещения меша).
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN_COUNT * 6);
  const rainVel = new Float32Array(RAIN_COUNT);
  let rainBaseY = 0;
  const resetDrop = (i: number, cx: number, cz: number, top: boolean) => {
    const x = cx + (Math.random() - 0.5) * RAIN_W;
    const z = cz + (Math.random() - 0.5) * RAIN_W;
    const y = rainBaseY + (top ? RAIN_H + Math.random() * 4 : Math.random() * RAIN_H);
    rainPos[i * 6] = x;
    rainPos[i * 6 + 1] = y;
    rainPos[i * 6 + 2] = z;
    rainPos[i * 6 + 3] = x + 0.35;
    rainPos[i * 6 + 4] = y - 1.4;
    rainPos[i * 6 + 5] = z;
    rainVel[i] = 24 + Math.random() * 10;
  };
  for (let i = 0; i < RAIN_COUNT; i++) resetDrop(i, 0, 0, false);
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0x9fc4dd, transparent: true, opacity: 0 });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);

  // ── Ветер/песок: летящие точки (только вне города) ──
  const windGeo = new THREE.BufferGeometry();
  const windPos = new Float32Array(WIND_COUNT * 3);
  const windSeed = new Float32Array(WIND_COUNT * 2);
  for (let i = 0; i < WIND_COUNT; i++) {
    windPos[i * 3] = (Math.random() - 0.5) * 60;
    windPos[i * 3 + 1] = Math.random() * 12;
    windPos[i * 3 + 2] = (Math.random() - 0.5) * 60;
    windSeed[i * 2] = 14 + Math.random() * 14;
    windSeed[i * 2 + 1] = Math.random() * Math.PI * 2;
  }
  windGeo.setAttribute('position', new THREE.BufferAttribute(windPos, 3));
  const windMat = new THREE.PointsMaterial({ color: 0xd8c298, size: 0.22, transparent: true, opacity: 0 });
  const windPts = new THREE.Points(windGeo, windMat);
  windPts.frustumCulled = false;
  windPts.visible = false;
  scene.add(windPts);

  // ── Песчаная буря: вихрь вокруг игрока ──
  const sandGeo = new THREE.BufferGeometry();
  const sandPos = new Float32Array(SAND_COUNT * 3);
  const sandAng = new Float32Array(SAND_COUNT);
  const sandRad = new Float32Array(SAND_COUNT);
  const sandH = new Float32Array(SAND_COUNT);
  const sandSpd = new Float32Array(SAND_COUNT);
  for (let i = 0; i < SAND_COUNT; i++) {
    sandAng[i] = Math.random() * Math.PI * 2;
    sandRad[i] = 4 + Math.random() * (SAND_R - 4);
    sandH[i] = Math.random() * 12;
    sandSpd[i] = 1.2 + Math.random() * 2.2;
  }
  sandGeo.setAttribute('position', new THREE.BufferAttribute(sandPos, 3));
  const sandMat = new THREE.PointsMaterial({ color: 0xd8a860, size: 0.3, transparent: true, opacity: 0 });
  const sandPts = new THREE.Points(sandGeo, sandMat);
  sandPts.frustumCulled = false;
  sandPts.visible = false;
  scene.add(sandPts);

  function flash(strength: number): void {
    if (!flashEl) {
      flashEl = document.createElement('div');
      flashEl.id = 'weather-flash';
      flashEl.style.cssText =
        'position:fixed;inset:0;background:#e8f0ff;opacity:0;pointer-events:none;z-index:200;';
      document.body.append(flashEl);
    }
    flashEl.style.transition = 'none';
    flashEl.style.opacity = String(0.35 + strength * 0.55);
    requestAnimationFrame(() => {
      if (!flashEl) return;
      flashEl.style.transition = 'opacity 0.45s';
      flashEl.style.opacity = '0';
    });
  }

  return {
    setWeather(w: string): void {
      const k = (w as WeatherKind) || 'clear';
      const known: WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'sandstorm', 'snow', 'wind'];
      kind = known.includes(k) ? k : 'clear';
      const raining = kind === 'rain' || kind === 'storm';
      rain.visible = raining;
      rainMat.opacity = kind === 'storm' ? 0.85 : 0.65;
      audio.setRainLevel(raining ? (kind === 'storm' ? 1 : 0.6) : 0);
      const windy = kind === 'storm' || kind === 'sandstorm' || kind === 'wind';
      audio.setWindLevel(kind === 'sandstorm' ? 1 : windy ? 0.5 : 0);
      if (kind !== 'storm') lightningIn = 3 + Math.random() * 5;
      if (fog && fogHome) {
        fog.near = fogHome.near;
        fog.far = fogHome.far;
        fog.color.setHex(fogHome.color);
        fogK = 0;
      }
      if (kind === 'fog' && fog && fogHome) {
        fog.near = fogHome.near * 0.6;
        fog.far = fogHome.far * 0.7;
      }
    },

    setInside(v: boolean): void {
      inside = v;
      if (!v) {
        // Выходим из здания — восстанавливаем погоду
        rain.visible = kind === 'rain' || kind === 'storm';
        windPts.visible = (kind === 'storm' || kind === 'sandstorm' || kind === 'wind');
        sandPts.visible = kind === 'sandstorm';
      }
    },

    update(dt: number, cx: number, cz: number, groundY: number, inCity: boolean): void {
      // Не обновляем погоду внутри зданий
      if (inside) return;
      const d = Math.min(dt, 0.05);
      const raining = kind === 'rain' || kind === 'storm';

      // Дождь падает вокруг игрока (абсолютные координаты, порог — земля+0.3)
      if (raining) {
        rainBaseY = groundY;
        for (let i = 0; i < RAIN_COUNT; i++) {
          let y = rainPos[i * 6 + 1] - rainVel[i] * d;
          if (y < groundY + 0.3) {
            resetDrop(i, cx, cz, true);
            continue;
          }
          const dx = rainPos[i * 6] - cx;
          const dz = rainPos[i * 6 + 2] - cz;
          if (Math.abs(dx) > RAIN_W / 2 || Math.abs(dz) > RAIN_W / 2) {
            resetDrop(i, cx, cz, true);
            continue;
          }
          rainPos[i * 6 + 1] = y;
          rainPos[i * 6 + 4] = y - 1.4;
        }
        rainGeo.attributes.position.needsUpdate = true;
        rain.position.set(0, 0, 0);
      }

      // Молния в грозу: чаще и с двойной вспышкой, гром сразу и эхом
      if (kind === 'storm') {
        lightningIn -= d;
        if (lightningIn <= 0) {
          lightningIn = 2.5 + Math.random() * 4;
          flash(0.6 + Math.random() * 0.4);
          setTimeout(() => flash(0.35), 140);
          audio.thunder();
          setTimeout(() => audio.thunder(), 900 + Math.random() * 1200);
        }
      }

      // Ветер с песчинками — вне города при буре/грозе/ветре
      const wantWind = (kind === 'storm' || kind === 'sandstorm' || kind === 'wind') && !inCity;
      windPts.visible = wantWind;
      if (wantWind) {
        windMat.opacity = kind === 'sandstorm' ? 0.85 : 0.5;
        for (let i = 0; i < WIND_COUNT; i++) {
          let x = windPos[i * 3] + windSeed[i * 2] * d;
          if (x > 30) x -= 60;
          windPos[i * 3] = x;
          windPos[i * 3 + 1] = groundY + 0.5 + ((i * 7 + performance.now() / 900 + windSeed[i * 2 + 1]) % 11);
        }
        windGeo.attributes.position.needsUpdate = true;
        windPts.position.set(cx, 0, cz);
      }

      // Вихрь песчаной бури — только вне города; в городе лишь пыльная
      // дымка и вой ветра. Плавное появление/затухание через sandK.
      const sandTarget = kind === 'sandstorm' ? (inCity ? 0 : 1) : 0;
      if (sandK !== sandTarget) {
        const stepSand = Math.sign(sandTarget - sandK) * Math.min(Math.abs(sandTarget - sandK), d * 0.7);
        sandK += stepSand;
      }
      sandPts.visible = sandK > 0.02;
      if (sandPts.visible) {
        sandMat.opacity = Math.min(0.9, 0.9 * sandK);
        for (let i = 0; i < SAND_COUNT; i++) {
          sandAng[i] += sandSpd[i] * d;
          sandRad[i] -= d * 1.5;
          if (sandRad[i] < 3) sandRad[i] = SAND_R;
          sandH[i] += Math.sin(performance.now() / 700 + i) * d * 1.5;
          if (sandH[i] < 0) sandH[i] = 0;
          if (sandH[i] > 13) sandH[i] = 13;
          sandPos[i * 3] = cx + Math.cos(sandAng[i]) * sandRad[i];
          sandPos[i * 3 + 1] = groundY + sandH[i];
          sandPos[i * 3 + 2] = cz + Math.sin(sandAng[i]) * sandRad[i];
        }
        sandGeo.attributes.position.needsUpdate = true;
      }
      // Пыльная дымка: снаружи плотно, в городе лёгкая
      const fogTarget = kind === 'sandstorm' ? (inCity ? 0.35 : 1) : 0;
      if (fog && fogHome && fogK !== fogTarget) {
        fogK += Math.sign(fogTarget - fogK) * Math.min(Math.abs(fogTarget - fogK), d * 0.5);
        fog.near = fogHome.near + (25 - fogHome.near) * fogK;
        fog.far = fogHome.far + (170 - fogHome.far) * fogK;
        fog.color.setHex(fogHome.color).lerp(new THREE.Color(0xc9a06a), fogK * 0.7);
      }
    },

    dispose(): void {
      scene.remove(rain, windPts, sandPts);
      rainGeo.dispose();
      windGeo.dispose();
      sandGeo.dispose();
      (rainMat as THREE.Material).dispose();
      (windMat as THREE.Material).dispose();
      (sandMat as THREE.Material).dispose();
      if (flashEl) {
        flashEl.remove();
        flashEl = null;
      }
      if (fog && fogHome) {
        fog.near = fogHome.near;
        fog.far = fogHome.far;
        fog.color.setHex(fogHome.color);
      }
    },
  };
}
