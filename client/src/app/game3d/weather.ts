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
const WIND_R = 30;
const SAND_COUNT = 650;
const SAND_R = 30;
/**
 * Ближняя граница песка.
 *
 * ТУТ БЫЛО 4, И ЭТО БЫЛО БЕЛОЕ ПЯТНО ПЕРЕД ПЕРСОНАЖЕМ. Точка
 * THREE.PointsMaterial рисуется размером В МИРОВЫХ ЕДИНИЦАХ: песчинка
 * диаметром 0,24 в четырёх метрах от камеры занимает на экране около сотни
 * пикселей. Плюс у слоя frustumCulled = false и depthWrite: false, то есть
 * эти круги рисуются поверх всего, включая персонажа. На снимке в песчаной
 * буре вся сцена была забита мягкими оранжевыми пятнами.
 *
 * Теперь песчинка появляется не ближе 16 метров: при размере 0,24 это
 * около 18 пикселей — читается как пылинка, а не как пятно на объективе.
 */
const SAND_NEAR_R = 16;
const SNOW_COUNT = 900;
const SNOW_R = 26;
const SNOW_H = 22;
/** Радиус «дыры» у камеры: ни одна частица не появляется ближе */
const NEAR_R = 4.5;
/** Для снега дыра шире: близкая хлопья размывается в пятно во весь экран */
const SNOW_NEAR_R = 7.5;
/** Внешний радиус кольца снега вокруг игрока */
const SNOW_RING_R = SNOW_R / 2;
/** Число звеньев в ломаной разряда молнии */
const BOLT_SEGMENTS = 14;

/**
 * Мягкая круглая «пушинка» для всех точечных систем погоды.
 * Без текстуры WebGL рисует POINT жёстким квадратом: в ясном небе
 * висели серые кубики, и игрок принимал их за снег или пыль.
 */
let dotTexture: THREE.Texture | null = null;
function softDot(): THREE.Texture {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(c);
  dotTexture.colorSpace = THREE.SRGBColorSpace;
  return dotTexture;
}

/**
 * Случайная точка в кольце вокруг игрока. Раньше пылинки ветра и хлопья
 * снега сыпались прямо в объектив (ящик 60×60 м вокруг игрока), из-за чего
 * ближние превращались в огромные квадраты и «летали» по всему экрану.
 * Кольцо с пустотой посередине держит все частицы не ближе NEAR_R.
 */
function ringPoint(rMin: number, rMax: number): { x: number; z: number } {
  const a = Math.random() * Math.PI * 2;
  const r = rMin + Math.sqrt(Math.random()) * (rMax - rMin);
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

export interface WeatherHandle {
  setWeather(w: string): void;
  /** Уровень графики: дальность тумана и доля частиц погоды (0..1) */
  setQuality(fogFar: number, weatherAmount: number): void;
  /** Скрыть/показать погоду (true = снаружи, false = внутри здания) */
  setInside(v: boolean): void;
  update(dt: number, cx: number, cz: number, groundY: number, inCity: boolean): void;
  dispose(): void;
  /** Сколько ударов молнии произошло с начала сессии — диагностика.
   *  Именно этот счётчик показал баг: он рос на 60 в секунду. */
  readonly strikeCount: number;
}

export function createWeather(scene: THREE.Scene, audio: typeof audioType): WeatherHandle {
  let kind: WeatherKind = 'clear';
  let lightningIn = 3 + Math.random() * 5;
  let flashEl: HTMLDivElement | null = null;
  const fog = scene.fog as THREE.Fog | null;
  const fogHome = fog ? { near: fog.near, far: fog.far, color: fog.color.getHex() } : null;
  let fogK = 0;
  let sandK = 0;
  let snowT = 0;
  let inside = false; // true = игрок внутри здания // 0 — обычный, 1 — песчаный
  /** Счётчик ударов молнии (диагностика частоты) */
  let strikes = 0;


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

  // ── Ветер/песок: кольцо ледяных пылинок вокруг игрока ──
  // Координаты абсолютные мировые (как у бури), меш всегда в начале
  // координат: иначе пылинки «отстают» от игрока при движении.
  const dotTex = softDot();
  const windGeo = new THREE.BufferGeometry();
  const windPos = new Float32Array(WIND_COUNT * 3);
  const windAng = new Float32Array(WIND_COUNT);
  const windRad = new Float32Array(WIND_COUNT);
  const windH = new Float32Array(WIND_COUNT);
  const windSpd = new Float32Array(WIND_COUNT);
  const windPhase = new Float32Array(WIND_COUNT);
  for (let i = 0; i < WIND_COUNT; i++) {
    windAng[i] = Math.random() * Math.PI * 2;
    windRad[i] = NEAR_R + Math.random() * (WIND_R - NEAR_R);
    windH[i] = 0.4 + Math.random() * 11;
    windSpd[i] = 0.45 + Math.random() * 1;
    windPhase[i] = Math.random() * Math.PI * 2;
  }
  windGeo.setAttribute('position', new THREE.BufferAttribute(windPos, 3));
  const windMat = new THREE.PointsMaterial({
    color: 0xd8c298, size: 0.13, map: dotTex,
    transparent: true, opacity: 0, depthWrite: false,
  });
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
    sandRad[i] = SAND_NEAR_R + Math.random() * (SAND_R - SAND_NEAR_R);
    sandH[i] = Math.random() * 12;
    sandSpd[i] = 1.2 + Math.random() * 2.2;
  }
  sandGeo.setAttribute('position', new THREE.BufferAttribute(sandPos, 3));
  const sandMat = new THREE.PointsMaterial({
    color: 0xd8a860, size: 0.24, map: dotTex,
    transparent: true, opacity: 0, depthWrite: false,
  });
  const sandPts = new THREE.Points(sandGeo, sandMat);
  sandPts.frustumCulled = false;
  sandPts.visible = false;
  scene.add(sandPts);

  // ── Снег: медленно падающие хлопья с дрейфом ──
  // Раньше 'snow' был только в списке видов погоды: ни геометрии, ни звука,
  // ни ветки в update — сервер присылал снег, а на экране ничего не было.
  const snowGeo = new THREE.BufferGeometry();
  const snowPos = new Float32Array(SNOW_COUNT * 3);
  const snowVel = new Float32Array(SNOW_COUNT);
  const snowPhase = new Float32Array(SNOW_COUNT);
  for (let i = 0; i < SNOW_COUNT; i++) {
    const p = ringPoint(SNOW_NEAR_R, SNOW_R / 2);
    snowPos[i * 3] = p.x;
    snowPos[i * 3 + 1] = Math.random() * SNOW_H;
    snowPos[i * 3 + 2] = p.z;
    snowVel[i] = 1.3 + Math.random() * 1.7;
    snowPhase[i] = Math.random() * Math.PI * 2;
  }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snowMat = new THREE.PointsMaterial({
    color: 0xf2f7ff, size: 0.15, map: dotTex, transparent: true, opacity: 0, depthWrite: false,
  });
  const snow = new THREE.Points(snowGeo, snowMat);
  snow.frustumCulled = false;
  snow.visible = false;
  scene.add(snow);

  // ── Молния: ломаная линия разряда в небе ──
  // Раньше «молнии» не существовало: был только белый прямоугольник на весь
  // экран. Теперь это настоящий разряд в небе + засветка + отложенный гром.
  const boltGeo = new THREE.BufferGeometry();
  const boltPos = new Float32Array(BOLT_SEGMENTS * 6);
  boltGeo.setAttribute('position', new THREE.BufferAttribute(boltPos, 3));
  const boltMat = new THREE.LineBasicMaterial({
    color: 0xe6efff, transparent: true, opacity: 0, depthWrite: false, fog: false,
  });
  const bolt = new THREE.LineSegments(boltGeo, boltMat);
  bolt.frustumCulled = false;
  bolt.visible = false;
  scene.add(bolt);
  let boltLife = 0;

  function flash(strength: number): void {
    if (!flashEl) {
      flashEl = document.createElement('div');
      flashEl.id = 'weather-flash';
      flashEl.style.cssText =
        'position:fixed;inset:0;background:#dce6ff;opacity:0;pointer-events:none;z-index:200;';
      document.body.append(flashEl);
    }
    // Вспышка молнии — короткая и не «слепая»: раньше она ложила почти
    // чистый белый на весь экран, и город пропадал на полсекунды
    flashEl.style.transition = 'none';
    flashEl.style.opacity = String(0.10 + strength * 0.2);
    requestAnimationFrame(() => {
      if (!flashEl) return;
      flashEl.style.transition = 'opacity 0.3s';
      flashEl.style.opacity = '0';
    });
  }

  /** Ломаная линия разряда: от высоты topY вниз, со смещениями вбок */
  function shapeBolt(bx: number, bz: number, topY: number): void {
    for (let i = 0; i < BOLT_SEGMENTS; i++) {
      const t0 = i / BOLT_SEGMENTS;
      const t1 = (i + 1) / BOLT_SEGMENTS;
      const j0 = (Math.random() - 0.5) * 70 * (0.4 + t0);
      const j1 = (Math.random() - 0.5) * 70 * (0.4 + t1);
      boltPos[i * 6] = bx + j0;
      boltPos[i * 6 + 1] = topY * (1 - t0);
      boltPos[i * 6 + 2] = bz + (Math.random() - 0.5) * 10;
      boltPos[i * 6 + 3] = bx + j1;
      boltPos[i * 6 + 4] = topY * (1 - t1);
      boltPos[i * 6 + 5] = bz + (Math.random() - 0.5) * 10;
    }
    boltGeo.attributes.position.needsUpdate = true;
  }

  /**
   * Удар молнии. Разряд бьёт в стороне от игрока, гром приходит с
   * опозданием — чем дальше вспышка, тем позже «раскат».
   */
  function strikeLightning(cx: number, cz: number, groundY: number): void {
    strikes++;
    const dist = 90 + Math.random() * 280;
    const a = Math.random() * Math.PI * 2;
    shapeBolt(cx + Math.cos(a) * dist, cz + Math.sin(a) * dist, groundY + 60 + Math.random() * 45);
    boltLife = 0.17;
    flash(0.6 + Math.random() * 0.4);
    setTimeout(() => flash(0.3), 130);
    const delay = 220 + dist * 4.5;
    setTimeout(() => audio.thunder(), delay);
    setTimeout(() => audio.thunder(), delay + 700 + Math.random() * 900);
  }

  return {
    get strikeCount(): number { return strikes; },

    setWeather(w: string): void {
      const k = (w as WeatherKind) || 'clear';
      const known: WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'sandstorm', 'snow', 'wind'];
      const next: WeatherKind = known.includes(k) ? k : 'clear';
      // Сервер шлёт погоду раз в минуту даже когда она не менялась. Раньше
      // setWeather каждый раз обнулял накопительную дымку бури, из-за чего
      // песчаная буря мигала раз в минуту. Меняем состояние по факту.
      if (next === kind) return;
      kind = next;

      const raining = kind === 'rain' || kind === 'storm';
      const snowing = kind === 'snow';
      rain.visible = raining;
      rainMat.opacity = kind === 'storm' ? 0.85 : 0.65;
      snow.visible = snowing;
      snowMat.opacity = 0.9;
      audio.setRainLevel(raining ? (kind === 'storm' ? 1 : 0.6) : 0);
      const windy = kind === 'storm' || kind === 'sandstorm' || kind === 'wind';
      audio.setWindLevel(kind === 'sandstorm' ? 1 : windy ? 0.5 : 0);
      // Гроза — молнии часто, просто дождь — изредка.
      // Первый удар не должен случиться мгновенно при смене погоды,
      // поэтому стартуем с интервала, а не с нуля.
      lightningIn = kind === 'storm' ? 4 + Math.random() * 6
        : kind === 'rain' ? 12 + Math.random() * 14
        : 0;
      boltLife = 0;
      if (fog && fogHome) {
        fog.near = fogHome.near;
        fog.far = fogHome.far;
        fog.color.setHex(fogHome.color);
        fogK = 0;
      }
      if (kind === 'fog' && fog && fogHome) {
        // Было 0.6/0.7 — при дальности сцены 400+ м туман был почти незаметен
        fog.near = fogHome.near * 0.25;
        fog.far = fogHome.far * 0.3;
        fog.color.setHex(fogHome.color).lerp(new THREE.Color(0xc6ccd2), 0.8);
      }
    },

    /**
     * Уровень графики: дальность тумана (far «домашнего» состояния) и
     * доля частиц погоды через setDrawRange — без пересоздания буферов.
     */
    setQuality(fogFar: number, weatherAmount: number): void {
      const k = Math.max(0, Math.min(1, weatherAmount));
      // ВАЖНО: drawRange считается в ВЕРШИНАХ, а не в «кусках массива».
      // Раньше здесь стояло *6 / *3 / *3 — то есть диапазон втрое больше
      // реального числа вершин, и на слабой графике погода рисовалась
      // целиком: настройка «меньше частиц» просто не работала.
      rainGeo.setDrawRange(0, Math.floor(RAIN_COUNT * k) * 2);  // 2 вершины на каплю
      windGeo.setDrawRange(0, Math.floor(WIND_COUNT * k));
      sandGeo.setDrawRange(0, Math.floor(SAND_COUNT * k));
      snowGeo.setDrawRange(0, Math.floor(SNOW_COUNT * k));
      if (fog && fogHome) {
        fogHome.far = Math.max(80, fogFar);
        if (fogK === 0 && kind !== 'fog') fog.far = fogHome.far;
      }
    },

    setInside(v: boolean): void {
      inside = v;
      if (v) {
        // Внутри здания капли и снег висели в воздухе — гасим всё
        rain.visible = false;
        snow.visible = false;
        windPts.visible = false;
        sandPts.visible = false;
        bolt.visible = false;
        boltLife = 0;
      } else {
        rain.visible = kind === 'rain' || kind === 'storm';
        snow.visible = kind === 'snow';
        windPts.visible = kind === 'storm' || kind === 'sandstorm' || kind === 'wind';
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

      // Молнии: в грозе часто, в обычном дожде изредка.
      // Раньше условие было строго `kind === 'storm'`, поэтому при дожде
      // молния была невозможна — игрок и жаловался, что их нет.
      if (kind === 'storm' || kind === 'rain') {
        lightningIn -= d;
        if (lightningIn <= 0) {
          strikeLightning(cx, cz, groundY);
          // Счётчик ОБЯЗАН пересчитываться здесь. Раньше этого не было:
          // lightningIn уходил в минус и больше не возвращался, поэтому
          // удар бил каждый кадр (60 раз в секунду) — экран мигал, а звук
          // превращался в кашу из наложенных раскатов, и обычные звуки
          // было не слышно. Плюс приглушение шин не отпускало.
          lightningIn = (kind === 'storm' ? 6 : 16) + Math.random() * (kind === 'storm' ? 8 : 16);
        }
      }

      // Разряд живёт доли секунды и гаснет
      if (boltLife > 0) {
        boltLife -= d;
        bolt.visible = boltLife > 0;
        boltMat.opacity = Math.max(0, boltLife / 0.17) * 0.95;
      } else if (bolt.visible) {
        bolt.visible = false;
      }

      // Снег: медленное падение вокруг игрока с боковым дрейфом
      if (kind === 'snow') {
        snowT += d;
        for (let i = 0; i < SNOW_COUNT; i++) {
          const y = snowPos[i * 3 + 1] - snowVel[i] * d;
          if (y < 0.2) {
            const p = ringPoint(SNOW_NEAR_R, SNOW_R / 2);
            snowPos[i * 3] = p.x;
            snowPos[i * 3 + 1] = SNOW_H;
            snowPos[i * 3 + 2] = p.z;
            continue;
          }
          const ph = snowPhase[i];
          snowPos[i * 3 + 1] = y;
          snowPos[i * 3] += (Math.sin(snowT * 1.2 + ph) * 0.6 + 1.5) * d;
          snowPos[i * 3 + 2] += Math.cos(snowT * 0.9 + ph) * 0.6 * d;
          // Дрейф уносил хлопья всё дальше от игрока, и через минуту снег
          // вокруг него исчезал. Возвращаем на кольцо, не обрывая падение.
          const rx = snowPos[i * 3];
          const rz = snowPos[i * 3 + 2];
          const rr = Math.hypot(rx, rz);
          if (rr > SNOW_RING_R) {
            const k = SNOW_RING_R / rr;
            snowPos[i * 3] = rx * k;
            snowPos[i * 3 + 2] = rz * k;
          }
        }
        snowGeo.attributes.position.needsUpdate = true;
        snow.position.set(cx, groundY, cz);
      }

      // Ветер с песчинками. Раньше был запрещён в городе (`&& !inCity`), но
      // 5 из 7 точек появления игрока — внутри Исфахана: новичок бурю не
      // видел вообще. Теперь в городе ветер просто реже и бледнее.
      const windyKind = kind === 'storm' || kind === 'sandstorm' || kind === 'wind';
      windPts.visible = windyKind;
      if (windyKind) {
        windMat.opacity = (kind === 'sandstorm' ? 0.8 : 0.4) * (inCity ? 0.5 : 1);
        for (let i = 0; i < WIND_COUNT; i++) {
          // Пылинка облетает игрока по спирали и уходит на новый виток —
          // движение остаётся, но частица никогда не садится на объектив.
          windAng[i] += windSpd[i] * d;
          windRad[i] -= d * 3.4;
          if (windRad[i] < NEAR_R) windRad[i] = WIND_R;
          windH[i] += Math.sin(performance.now() / 1500 + windPhase[i]) * d * 0.8;
          if (windH[i] < 0.4) windH[i] = 11.4;
          if (windH[i] > 11.4) windH[i] = 0.4;
          windPos[i * 3] = cx + Math.cos(windAng[i]) * windRad[i];
          windPos[i * 3 + 1] = groundY + windH[i];
          windPos[i * 3 + 2] = cz + Math.sin(windAng[i]) * windRad[i];
        }
        windGeo.attributes.position.needsUpdate = true;
        windPts.position.set(0, 0, 0);
      }

      // Вихрь песчаной бури — только вне города; в городе лишь пыльная
      // дымка и вой ветра. Плавное появление/затухание через sandK.
      const sandTarget = kind === 'sandstorm' ? (inCity ? 0.45 : 1) : 0;
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
          // Порог пересоздания держим на SAND_NEAR_R, а не на трёх метрах:
          // иначе песчинка успевает подойти вплотную к камере и на мгновение
          // закрыть весь экран кругом во весь кадр.
          if (sandRad[i] < SAND_NEAR_R) sandRad[i] = SAND_R;
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
      const fogTarget = kind === 'sandstorm' ? (inCity ? 0.45 : 1) : 0;
      if (fog && fogHome && fogK !== fogTarget) {
        fogK += Math.sign(fogTarget - fogK) * Math.min(Math.abs(fogTarget - fogK), d * 0.5);
        fog.near = fogHome.near + (25 - fogHome.near) * fogK;
        fog.far = fogHome.far + (170 - fogHome.far) * fogK;
        fog.color.setHex(fogHome.color).lerp(new THREE.Color(0xc9a06a), fogK * 0.7);
      }
    },

    dispose(): void {
      scene.remove(rain, windPts, sandPts, snow, bolt);
      rainGeo.dispose();
      windGeo.dispose();
      sandGeo.dispose();
      snowGeo.dispose();
      boltGeo.dispose();
      (rainMat as THREE.Material).dispose();
      (windMat as THREE.Material).dispose();
      (sandMat as THREE.Material).dispose();
      (snowMat as THREE.Material).dispose();
      (boltMat as THREE.Material).dispose();
      dotTexture?.dispose();
      dotTexture = null;
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
