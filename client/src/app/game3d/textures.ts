// ============================================================
// Процедурные текстуры — Empire of Safavids
// ============================================================
// Рисуются на canvas при загрузке мира (без внешних файлов):
// песок, штукатурка, каменная кладка, изразцовая мозаика, дерево.
// Используются материалами terrain.ts и NPC-модулем.

import * as THREE from 'three';

// ── Asset bundle system integration ──────────────────────────
// TextureSystem is the authoritative CDN/mip catalog for future
// texture assets (see client/src/assets/TextureSystem.ts). The
// procedural canvas textures below are the current fallback and
// remain in use until CDN bundles are published. Delegation
// helpers expose TextureSystem via this module so callers can
// prefer CDN URLs with graceful fallback to procedural.
// TODO: when CDN is live, replace callers of sandTexture() etc.
// with textureManager.getCdnUrl() + TextureLoader.
import { textureManager, TEXTURE_CATALOG } from '../../assets/TextureSystem';
export { textureManager, TEXTURE_CATALOG };
export type { TextureQuality, TextureDefinition } from '../../assets/TextureSystem';

/** CDN URL for a catalog texture at given quality, if catalogued. */
export function getTextureCdnUrl(id: string, quality: 'low' | 'medium' | 'high' | 'ultra' = 'high'): string | undefined {
  return textureManager.getCdnUrl(id, quality);
}

/** Whether a texture id is in the bundle catalog (future CDN). */
export function hasCatalogTexture(id: string): boolean {
  return !!TEXTURE_CATALOG[id];
}

export function makeCanvas(size = 256): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d')! };
}

/**
 * Максимальная анизотропная фильтрация, сколько позволяет железо.
 *
 * ЗАЧЕМ. Раньше стояло зашитое 4. Землю игрок видит почти вдоль — под
 * скользящим углом, и с анизотропией 4 она превращается в мыльную муть:
 * мир теряет чёткость именно там, куда смотрит. На типичной видеокарте
 * доступно 16.
 *
 * Значение не угадываем, а спрашиваем у рендера: он один знает возможности
 * устройства. До создания рендера держим 4 — разумный минимум, чтобы
 * текстуры, созданные раньше, не оказались вовсе без фильтрации.
 */
let МАКС_АНИЗОТРОПИЯ = 4;

/** Сообщить Textures возможности рендера. Вызывать после его создания. */
export function setTextureAnisotropy(max: number): void {
  МАКС_АНИЗОТРОПИЯ = Math.max(1, Math.floor(max));
}

/**
 * Низкочастотная пестрота: мягкие пятна без мелкой детали.
 *
 * ЗАЧЕМ. Одна детальная текстура на большой площади всегда читается
 * решёткой: глаз очень быстро находит период повтора, и площадь
 * перестаёт быть площадью. Лечится вторым слоем — макро-вариацией,
 * растянутой на всю площадь целиком, так что её повтор не виден.
 *
 * Текстура ВОЛНИТСЯ по краям: пятна рисуются с заходом за границы, иначе
 * на стыке появилась бы прямая линия — то есть тот же дефект, только в
 * другом масштабе.
 */
export function macroTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  const пятно = (x: number, y: number, r: number, свет: number) => {
    // Рисуем девять раз — со сдвигами, чтобы пятно уходило за края и
    // стыковалось само с собой.
    for (const [dx, dy] of [
      [0, 0], [size, 0], [-size, 0], [0, size], [0, -size],
      [size, size], [-size, size], [size, -size], [-size, -size],
    ]) {
      const px = x + dx, py = y + dy;
      // Пятно считается только если хотя бы касается холста.
      if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, свет > 0 ? `rgba(255,255,255,${свет})` : `rgba(0,0,0,${-свет})`);
      g.addColorStop(1, 'rgba(128,128,128,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // Крупные пятна: свет и тень вразнобой, иначе кадр получится плоским.
  for (let i = 0; i < 26; i++) {
    пятно(Math.random() * size, Math.random() * size, 26 + Math.random() * 52, (Math.random() * 0.5 - 0.25));
  }
  return toTexture(canvas, 1);
}

/**
 * Наложить макро-слой поверх детальной текстуры материала.
 *
 * КАК. Стандартный шейдер MeshStandardMaterial умеет ровно одну карту, и
 * она обязана повторяться. Поэтому слой добавляется патчем: своя
 * переменная с «сырой» координатой (без repeat детальной карты) и
 * умножение diffuseColor на маску вокруг единицы.
 *
 * ПОЧЕМУ УМНОЖЕНИЕ, А НЕ СМЕШИВАНИЕ. Маска лежит около 1.0 и только
 * слегка отклоняется: она не перекрашивает плитку, а гасит и подсвечивает
 * её, поэтому рисунок плиты остаётся, а повтор перестаёт читаться.
 *
 * Сила — доля отклонения от единицы: 0.35 означает ±35% яркости.
 */
export function addMacroLayer(
  material: THREE.Material,
  макро: THREE.Texture,
  сила = 0.35,
  повтор = 1.5,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMacroMap = { value: макро };
    shader.uniforms.uMacroStrength = { value: сила };
    shader.uniforms.uMacroRepeat = { value: повтор };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vMacroUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMacroUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vMacroUv;
        uniform sampler2D uMacroMap;
        uniform float uMacroStrength;
        uniform float uMacroRepeat;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float v = texture2D(uMacroMap, vMacroUv * uMacroRepeat).r;
          diffuseColor.rgb *= mix(1.0 - uMacroStrength, 1.0 + uMacroStrength, v);
        }`);
  };
  // Ключ нужен, чтобы three не переиспользовала программу от материала
  // без макро-слоя: иначе патч тихо пропадёт.
  material.customProgramCacheKey = () => 'macroLayer';
  material.needsUpdate = true;
}

/**
 * Карта ЦВЕТА. sRGB здесь правильно: глаз видит в этих ступенях, и three
 * приводит линейный цвет к тому, на что смотрит рендер.
 */
export function toTexture(canvas: HTMLCanvasElement, repeat: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = МАКС_АНИЗОТРОПИЯ;
  return tex;
}

/**
 * Карта ДАННЫХ — и вот здесь до 15.10.2026 стоял вызов toTexture.
 *
 * ЧТО ЭТО ЛОМАЛО. Цветовое пространство текстуры в three — не подпись, а
 * указание GPU: при SRGBColorSpace и UnsignedByte текстура грузится во
 * внутренний формат SRGB8_ALPHA8 (WebGLTextures.js, строка 234), и каждое
 * чтение проходит через sRGB→linear на уровне железа. Этот декод действует на
 * ЛЮБУЮ роль текстуры — в том числе на карты нормалей, шероховатости и
 * смещения, которые цветом вовсе не являются.
 *
 * ЧТО ИЗ ЭТОГО ПОЛУЧАЛОСЬ. Карта нормалей хранит «ровно вверх» байтами
 * 128,128,255. Декод даёт шейдеру 0.2159, 0.2159, 1.0, и вычитание
 * `normalMap - 0.5` даёт (-0.284, -0.284, 0.5) — то есть наклон поверхности
 * на 38.8 градусов. Каждый камень, каждое дерево и вся вода в игре были
 * освещены так, будто развёрнуты на 39 градусов, и это видно: свет «плывёт»
 * по стенам вместо того, чтобы стоять на месте. Шероховатость 0.5 читалась как
 * 0.216 (поверхности глянцевее задуманного), а карта смещения сжимала
 * середину рельефа.
 *
 * У карты данных линейная передача: NoColorSpace.
 */
export function toDataTexture(canvas: HTMLCanvasElement, repeat: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = МАКС_АНИЗОТРОПИЯ;
  return tex;
}

/** Пестрота: случайное затемнение пикселя */
export function speckle(ctx: CanvasRenderingContext2D, size: number, count: number, alpha = 0.08): void {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 0.5 + Math.random() * 1.6;
    ctx.fillStyle = Math.random() < 0.5
      ? `rgba(0,0,0,${alpha * Math.random()})`
      : `rgba(255,255,255,${alpha * Math.random()})`;
    ctx.fillRect(x, y, r, r);
  }
}

/** Песчаная земля с рябью */
export function sandTexture(repeat = 48): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#a08a63';
  ctx.fillRect(0, 0, size, size);
  // волны-рябь
  for (let y = 0; y < size; y += 5) {
    const off = Math.sin(y * 0.11) * 6;
    ctx.fillStyle = `rgba(0,0,0,${0.025 + Math.random() * 0.03})`;
    ctx.fillRect(0, y + off, size, 2.2);
  }
  // пятна травы/камешков
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(93,115,69,0.14)' : 'rgba(125,130,142,0.18)';
    ctx.beginPath();
    ctx.ellipse(x, y, 1.5 + Math.random() * 3, 1 + Math.random() * 2, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, size, 900);
  return toTexture(canvas, repeat);
}

/** Тёплая штукатурка домов */
export function plasterTexture(base: string, repeat = 2): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  // вертикальные потёки
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    ctx.fillStyle = `rgba(70,50,30,${0.03 + Math.random() * 0.05})`;
    ctx.fillRect(x, Math.random() * size * 0.4, 1.5 + Math.random() * 2.5, size * (0.3 + Math.random() * 0.6));
  }
  // трещины
  ctx.strokeStyle = 'rgba(60,45,30,0.22)';
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    let x = Math.random() * size, y = Math.random() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += (Math.random() - 0.5) * 34;
      y += Math.random() * 26;
      ctx.lineTo(x, y);
    }
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  speckle(ctx, size, 500, 0.06);
  return toTexture(canvas, repeat);
}

/** Высота/смещение для камня: heightmap для displacement mapping (POM/vertex displacement) */
export function stoneDisplacementTexture(repeat = 6): THREE.CanvasTexture {
  const size = 256;
  const { canvas: _canvas, ctx } = makeCanvas(size);
  // heightmap: камни светлее (выше), швы темнее (ниже)
  ctx.fillStyle = '#404040';
  ctx.fillRect(0, 0, size, size);
  const bh = 22, bw = 46;
  for (let row = 0; row * bh < size; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col * bw < size + bw; col++) {
      const x = col * bw + off, y = row * bh;
      const shade = 180 + Math.floor(Math.random() * 40);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
    }
  }
  return toDataTexture(_canvas as unknown as HTMLCanvasElement, repeat);
}

/** Шершавость для камня: верхние грани полированные, швы и боковины шершавые */
export function stoneRoughnessTexture(repeat = 6): THREE.CanvasTexture {
  const size = 256;
  const { canvas: _canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  const bh = 22, bw = 46;
  for (let row = 0; row * bh < size; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col * bw < size + bw; col++) {
      const x = col * bw + off, y = row * bh;
      // верх грани — полированный (светлый = низкая шершавость).
      // Одно число на все три канала. Раньше здесь стояли три отдельные
      // Math.random(), то есть R, G и B получали разные значения и карта
      // получалась цветной. Для шероховатости это неверно: three.js читает
      // зелёный канал (texelRoughness.g), так что из красно-зелёно-синей
      // карты в шейдер попадает лишь один из трёх независимо розыгранных
      // шумов — и камень пестреет случайным оттенком там, где шероховатость
      // должна быть одинаковой.
      const верх = 200 + Math.floor(Math.random() * 40);
      ctx.fillStyle = `rgb(${верх},${верх},${верх})`;
      ctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
      // швы — шершавые (тёмный = высокая шершавость)
      ctx.fillStyle = 'rgba(60,60,60,0.8)';
      ctx.fillRect(x + 1.5, y + bh - 3, bw - 3, 2); // нижний шов
      ctx.fillStyle = 'rgba(60,60,60,0.8)';
      ctx.fillRect(x + 1.5, y + 1.5, 2, bh - 3); // левый шов
    }
  }
  return toDataTexture(_canvas as unknown as HTMLCanvasElement, repeat);
}

/** Нормальная карта для каменной кладки: выступающие камни, углублённые швы */
export function stoneNormalTexture(repeat = 6): THREE.CanvasTexture {
  const size = 256;
  const { canvas: _canvas, ctx } = makeCanvas(size);
  // heightmap: камни светлее (выше), швы темнее (ниже)
  ctx.fillStyle = '#404040';
  const bh = 22, bw = 46;
  for (let row = 0; row * bh < size; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col * bw < size + bw; col++) {
      const x = col * bw + off, y = row * bh;
      const shade = 180 + Math.floor(Math.random() * 40);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
    }
  }
  const img = ctx.getImageData(0, 0, size, size);
  const normalCanvas = heightToNormal(img.data, size, 2.5);
  return toDataTexture(normalCanvas as unknown as HTMLCanvasElement, repeat);
}

/** Каменная кладка стен */
export function stoneTexture(repeat = 6): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#9a9184';
  ctx.fillRect(0, 0, size, size);
  const bh = 22, bw = 46;
  for (let row = 0; row * bh < size; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col * bw < size + bw; col++) {
      const x = col * bw + off, y = row * bh;
      const shade = 0.82 + Math.random() * 0.3;
      const r = Math.floor(154 * shade), g = Math.floor(145 * shade), b = Math.floor(132 * shade);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x + 1.5, y + 1.5, bw - 3, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(x + 1.5, y + bh - 3.5, bw - 3, 2);
    }
  }
  speckle(ctx, size, 700);
  return toTexture(canvas, repeat);
}

/** Изразцовая мозаика куполов (бирюза с золотыми швами) */
export function mosaicTexture(repeat = 5): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#1f6b6b';
  ctx.fillRect(0, 0, size, size);
  const t = 16;
  for (let y = 0; y < size; y += t) {
    for (let x = 0; x < size; x += t) {
      const hue = 168 + Math.random() * 16;
      const light = 34 + Math.random() * 16;
      ctx.fillStyle = `hsl(${hue},52%,${light}%)`;
      ctx.fillRect(x + 1, y + 1, t - 2, t - 2);
      // блики на изразцах
      if (Math.random() < 0.35) {
        ctx.fillStyle = 'rgba(255,255,255,0.13)';
        ctx.fillRect(x + 2, y + 2, t - 5, 3);
      }
    }
  }
  // золотые швы
  ctx.strokeStyle = 'rgba(201,168,76,0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= size; i += t) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
  }
  return toTexture(canvas, repeat);
}

/** Плитка площади (персидский геометрический узор) */
export function plazaTexture(repeat = 14): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#b59d72';
  ctx.fillRect(0, 0, size, size);
  const t = 64;
  for (let y = 0; y < size; y += t) {
    for (let x = 0; x < size; x += t) {
      const alt = ((x / t) + (y / t)) % 2 === 0;
      ctx.fillStyle = alt ? '#ab9265' : '#c0a878';
      ctx.fillRect(x, y, t, t);
      // ромб в центре плитки
      ctx.strokeStyle = 'rgba(120,95,55,0.5)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x + t / 2, y + 8); ctx.lineTo(x + t - 8, y + t / 2);
      ctx.lineTo(x + t / 2, y + t - 8); ctx.lineTo(x + 8, y + t / 2);
      ctx.closePath(); ctx.stroke();
    }
  }
  speckle(ctx, size, 600);
  return toTexture(canvas, repeat);
}

/**
 * Генерация нормальной карты из heightmap через Sobel-оператор.
 * heightmap — серое изображение (0..255), где яркость = высота.
 * Возвращает RGB-нормальную карту для использования в material.normalMap.
 */
function heightToNormal(heightData: Uint8ClampedArray, size: number, strength = 2.0): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const ym = (y - 1 + size) % size, yp = (y + 1) % size;
      const hL = heightData[y * size + xm], hR = heightData[y * size + xp];
      const hD = heightData[ym * size + x], hU = heightData[yp * size + x];
      const dx = (hL - hR) / 255 * strength;
      const dy = (hD - hU) / 255 * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      d[i] = Math.floor(((dx / len) * 0.5 + 0.5) * 255);
      d[i + 1] = Math.floor(((dy / len) * 0.5 + 0.5) * 255);
      d[i + 2] = Math.floor((1 / len) * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Шершавость для дерева: по волокнам — гладче, поперек — шерше */
export function woodRoughnessTexture(repeat = 2): THREE.CanvasTexture {
  const size = 128;
  const { canvas: _canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  const plank = size / 4;
  for (let i = 0; i < 4; i++) {
    const base = 140 + Math.floor(Math.random() * 30);
    ctx.fillStyle = `rgb(${base},${base},${base})`;
    ctx.fillRect(0, i * plank + 1, size, plank - 2);
    // волокна — тёмнее = шерше поперек, светлее = гладче вдоль
    ctx.strokeStyle = 'rgba(40,40,40,0.6)';
    for (let g = 0; g < 5; g++) {
      ctx.beginPath();
      const y = i * plank + 3 + Math.random() * (plank - 6);
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.12 + i) * 1.6);
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }
  const img = ctx.getImageData(0, 0, size, size);
  // инвертируем: в roughnessMap яркость = шершавость. Волокна = тёмнее = гладче
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const val = data[i];
    // инвертируем: волокна (тёмные) -> низкая шершавость
    data[i] = data[i + 1] = data[i + 2] = 255 - Math.floor((255 - val) * 0.6);
    data[i + 3] = 255;
  }
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  out.getContext('2d')!.putImageData(img, 0, 0);
  return toDataTexture(out, repeat);
}

/** Нормальная карта для воды: волны Герстнера/синусоиды для деталей поверхности */
export function waterNormalTexture(repeat = 6): THREE.CanvasTexture {
  const size = 512;
  const { canvas: _canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  // Генерируем heightmap волн: наложение нескольких синусоид
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // Наложение нескольких волн разной частоты и амплитуды
      let h = 0;
      h += Math.sin(u * 8 * Math.PI + v * 4 * Math.PI) * 0.4;
      h += Math.sin(u * 16 * Math.PI - v * 8 * Math.PI) * 0.25;
      h += Math.sin(u * 32 * Math.PI + v * 2 * Math.PI) * 0.15;
      h += Math.sin(u * 64 * Math.PI - v * 16 * Math.PI) * 0.1;
      // Рипплы
      h += Math.sin(u * 128 * Math.PI) * 0.05;
      h += Math.sin(v * 128 * Math.PI) * 0.05;
      const val = Math.floor((h + 1) * 0.5 * 255);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = val;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const normalCanvas = heightToNormal(ctx.getImageData(0, 0, size, size).data, size, 1.2);
  return toDataTexture(normalCanvas, repeat);
}

/** Пена на гребнях волн: белая пена в гребнях волн */
export function waterFoamTexture(repeat = 6): THREE.CanvasTexture {
  const size = 512;
  const { canvas: _canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  // Пена появляется на гребнях волн (высокие значения heightmap)
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // Те же волны, что и в normal map
      let h = 0;
      h += Math.sin(u * 8 * Math.PI + v * 4 * Math.PI) * 0.4;
      h += Math.sin(u * 16 * Math.PI - v * 8 * Math.PI) * 0.25;
      h += Math.sin(u * 32 * Math.PI + v * 2 * Math.PI) * 0.15;
      h += Math.sin(u * 64 * Math.PI - v * 16 * Math.PI) * 0.1;
      h += Math.sin(u * 128 * Math.PI) * 0.05;
      h += Math.sin(v * 128 * Math.PI) * 0.05;
      // Пена только на самых высоких гребнях (h > 0.6)
      const foam = Math.max(0, (h - 0.6) / 0.4);
      const val = Math.floor(foam * foam * 255); // foam^2 для резкости
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = val;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(_canvas as unknown as HTMLCanvasElement, repeat);
}

/** Нормальная карта для дерева: борозды между досками, волокна */
export function woodNormalTexture(repeat = 2): THREE.CanvasTexture {
  const size = 128;
  const { canvas: _canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#808080';
  const plank = size / 4;
  for (let i = 0; i < 4; i++) {
    const shade = 140 + Math.floor(Math.random() * 30);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fillRect(0, i * plank + 1, size, plank - 2);
    // волокна — тонкие тёмные линии на heightmap
    ctx.strokeStyle = 'rgba(60,60,60,0.5)';
    for (let g = 0; g < 5; g++) {
      ctx.beginPath();
      const y = i * plank + 3 + Math.random() * (plank - 6);
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.12 + i) * 1.6);
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }
  const img = ctx.getImageData(0, 0, size, size);
  const normalCanvas = heightToNormal(img.data, size, 1.8);
  return toDataTexture(normalCanvas as unknown as HTMLCanvasElement, repeat);
}

/** Деревянные доски */
export function woodTexture(repeat = 2): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#7a5f3c';
  ctx.fillRect(0, 0, size, size);
  const plank = size / 4;
  for (let i = 0; i < 4; i++) {
    const shade = 0.85 + Math.random() * 0.28;
    ctx.fillStyle = `rgba(${Math.floor(122 * shade)},${Math.floor(95 * shade)},${Math.floor(60 * shade)},1)`;
    ctx.fillRect(0, i * plank + 1, size, plank - 2);
    // волокна
    ctx.strokeStyle = 'rgba(60,42,22,0.35)';
    for (let g = 0; g < 5; g++) {
      ctx.beginPath();
      const y = i * plank + 3 + Math.random() * (plank - 6);
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.12 + i) * 1.6);
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }
  return toTexture(canvas, repeat);
}

/** Вода: светлые проблски и рябь для озёр и реки */
export function waterTexture(repeat = 6): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#3d7fae';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * size;
    const x = Math.random() * size;
    const w = 20 + Math.random() * 70;
    ctx.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.1})`;
    ctx.beginPath();
    ctx.ellipse(x, y, w / 2, 1.2 + Math.random() * 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = `rgba(210,240,255,${0.1 + Math.random() * 0.14})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let x = Math.random() * size, y = Math.random() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += 14 + Math.random() * 18;
      y += (Math.random() - 0.5) * 8;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return toTexture(canvas, repeat);
}

/** Падающая вода: вертикальные струи (прокручивается в world3d) */
export function waterfallTexture(repeat = 2): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#9fc8e0';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * size;
    const w = 2 + Math.random() * 7;
    ctx.fillStyle = `rgba(255,255,255,${0.14 + Math.random() * 0.3})`;
    ctx.fillRect(x, 0, w, size);
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(160,200,230,${0.2 + Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 3 + Math.random() * 8, 20 + Math.random() * 60);
  }
  return toTexture(canvas, repeat);
}

// ── Растительность и ткань ────────────────────────────────────
//
// ЗАЧЕМ ЭТОТ БЛОК. Камень, песок и дерево носили albedo, карту нормалей и
// карту шероховатости, а листва, стволы и ткань стояли голым цветом с
// roughness: 1. Разница видна сразу и не в пользу вторых: крона читалась как
// вырезанная из цветного картона, ствол — как палка, ткань — как заливка.
// Плоская поверхность не даёт главного, за что цепляется глаз на кустах и
// кронах: претензионной детали и честной тени от неё.
//
// Цвета материалов в terrain.ts остаются те же — текстура приходит в
// multiply к color, то есть материал по-прежнему красится своим цветом.

/**
 * Листва: гроздь листьев, а не сплошная заливка.
 *
 * Каждый лист — эллипс с осью, повёрнутой случайно. Рисуются в три слоя по
 * светлоте, тёмный снизу: так крона приобретает объём даже при плоском
 * освещении, а без слоёв крона выглядит как одно пятно.
 */
export function foliageTexture(
  base: string,
  repeat = 3,
  size = 128,
): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const тройка = (r: number, g: number, b: number) => `rgb(${r},${g},${b})`;
  // Разбор базового цвета, чтобы слои отличались тоном, а не случайным
  // цветом: иначе крона из трёх зелёных уходила бы в пёстрое конфетти.
  const числа = base.match(/\w\w/g);
  const [б, г, к] = числа
    ? [parseInt(числа[0], 16), parseInt(числа[1], 16), parseInt(числа[2], 16)]
    : [74, 106, 56];

  const слой = (множитель: number, плотность: number) => {
    ctx.fillStyle = тройка(
      Math.min(255, Math.round(б * множитель)),
      Math.min(255, Math.round(г * множитель)),
      Math.min(255, Math.round(к * множитель)),
    );
    for (let i = 0; i < плотность; i++) {
      // Лист рисуется девять раз со сдвигами, чтобы он уходил за края и
      // стыковался сам с собой — иначе по периметру была бы рамка.
      const x = Math.random() * size;
      const y = Math.random() * size;
      const rx = 3 + Math.random() * 6;
      const ry = 1.6 + Math.random() * 3.2;
      const угол = Math.random() * Math.PI;
      for (const [dx, dy] of [
        [0, 0], [size, 0], [-size, 0], [0, size], [0, -size],
        [size, size], [-size, size], [size, -size], [-size, -size],
      ]) {
        ctx.beginPath();
        ctx.ellipse(x + dx, y + dy, rx, ry, угол, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  слой(0.66, 90);   // тень снизу
  слой(1.0, 120);   // основная масса
  слой(1.34, 45);   // верхний свет

  return toTexture(canvas, repeat);
}

/**
 * Карта нормалей для листвы: из той же картинки листьев.
 *
 * Нормали берутся из яркости альбедо: у листа своя яркость, значит и
 * наклон есть. Листья рисуются теми же девятью сдвигами, иначе по краям
 * нормаль прыгала бы на стыке текстуры.
 */
export function foliageNormalTexture(repeat = 3, size = 128): THREE.CanvasTexture {
  // canvas не нужен: из него читается только картинка, а нормали считаются
  // из пикселей через heightToNormal. Та же оговорка в barkNormalTexture.
  const { ctx } = makeCanvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 240; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const rx = 3 + Math.random() * 6;
    const ry = 1.6 + Math.random() * 3.2;
    const угол = Math.random() * Math.PI;
    const свет = 110 + Math.floor(Math.random() * 90);
    ctx.fillStyle = `rgb(${свет},${свет},${свет})`;
    for (const [dx, dy] of [
      [0, 0], [size, 0], [-size, 0], [0, size], [0, -size],
      [size, size], [-size, size], [size, -size], [-size, -size],
    ]) {
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, rx, ry, угол, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const img = ctx.getImageData(0, 0, size, size);
  const normalCanvas = heightToNormal(img.data, size, 2.6);
  return toDataTexture(normalCanvas as unknown as HTMLCanvasElement, repeat);
}

/**
 * Кора: вертикальные гребни, а не доски.
 *
 * Отличие от woodTexture принципиальное: доски — это горизонтальные полосы со
 * стыками, кора — вертикальные волокна, слитые в одну поверхность. На
 * стволе, обёрнутом цилиндром, доски читались бы как обои в полоску.
 */
export function barkTexture(base: string, repeat = 2, size = 128): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size);
  const числа = base.match(/\w\w/g);
  const [б, г, к] = числа
    ? [parseInt(числа[0], 16), parseInt(числа[1], 16), parseInt(числа[2], 16)]
    : [90, 70, 48];
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Волокна идут вертикально и слегка гуляют по x — кора живая, а не
  // расчёсана.
  for (let i = 0; i < 90; i++) {
    const x0 = Math.random() * size;
    const свет = Math.random() > 0.5 ? 1.28 : 0.68;
    ctx.strokeStyle = `rgba(${Math.round(б * свет)},${Math.round(г * свет)},${Math.round(к * свет)},${0.35 + Math.random() * 0.4})`;
    ctx.lineWidth = 1 + Math.random() * 3.4;
    ctx.beginPath();
    let x = x0;
    ctx.moveTo(x, -4);
    for (let y = -4; y <= size + 4; y += 10) {
      x += (Math.random() - 0.5) * 3.2;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Короткие поперечные трещины: у коры есть и они, и без них вертикаль
  // читается как штриховка, а не как растрескавшаяся поверхность.
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.strokeStyle = `rgba(20,14,8,${0.2 + Math.random() * 0.35})`;
    ctx.lineWidth = 0.7 + Math.random() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 5, y + 4 + Math.random() * 14);
    ctx.stroke();
  }
  return toTexture(canvas, repeat);
}

/** Карта нормалей для коры: вертикальные волокна. */
export function barkNormalTexture(repeat = 2, size = 128): THREE.CanvasTexture {
  const { ctx } = makeCanvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const x0 = Math.random() * size;
    const свет = 110 + Math.floor(Math.random() * 80);
    ctx.strokeStyle = `rgb(${свет},${свет},${свет})`;
    ctx.lineWidth = 1 + Math.random() * 3.4;
    ctx.beginPath();
    let x = x0;
    ctx.moveTo(x, -4);
    for (let y = -4; y <= size + 4; y += 10) {
      x += (Math.random() - 0.5) * 3.2;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const img = ctx.getImageData(0, 0, size, size);
  const normalCanvas = heightToNormal(img.data, size, 2.4);
  return toDataTexture(normalCanvas as unknown as HTMLCanvasElement, repeat);
}

/**
 * Ткань: переплетение нитей.
 *
 * Ткани в игре — паруса, шатры, ковры, флаги. Переплетение видно вблизи, а
 * на плоской заливке ткань выглядит как крашеный картон: нет ни блика на
 * нитях, ни собственной тени между ними.
 */
export function clothTexture(base: string, repeat = 4, size = 128): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const числа = base.match(/\w\w/g);
  const [б, г, к] = числа
    ? [parseInt(числа[0], 16), parseInt(числа[1], 16), parseInt(числа[2], 16)]
    : [139, 26, 26];

  const шаг = 4;
  for (let y = 0; y < size; y += шаг) {
    for (let x = 0; x < size; x += шаг) {
      // Через одну клетка основная нить лежит сверху — это и есть
      // переплетение. Нити одного направления чуть светлее, другого
      // темнее, и глаз сразу читает ткань, а не сетку.
      const сверху = ((x / шаг) + (y / шаг)) % 2 === 0;
      const множитель = сверху ? 1.22 : 0.78;
      ctx.fillStyle = `rgba(${Math.round(б * множитель)},${Math.round(г * множитель)},${Math.round(к * множитель)},0.9)`;
      ctx.fillRect(x, y, шаг - 1, шаг - 1);
    }
  }
  // Редкие ворсинки: ткань поношена, а не новая из фабрики.
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1 + Math.random() * 3);
  }
  return toTexture(canvas, repeat);
}

// ── Снег ──────────────────────────────────────────────────────
//
// ЗАЧЕМ ЭТОТ БЛОК. Снег стоял плоским белым с roughness: 1. Настоящий снег
// имеет мелкие кристаллы, которые ловят свет и дают характерный блеск.
// Плоская поверхность не даёт этого эффекта: снег выглядит как белая
// бумага, а не как снежный покров.

/**
 * Текстура снега: мелкие кристаллы и блики.
 *
 * Снег состоит из мелких кристаллов льда, которые отражают свет. Даже в
 * пасмурный день снег имеет характерный блеск за счёт множества мелких
 * граней. Текстура воспроизводит этот эффект мелкими светлыми точками и
 * лёгкими неровностями.
 */
export function snowTexture(base: string, repeat = 4, size = 128): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size);
  const числа = base.match(/\w\w/g);
  const [б, г, к] = числа
    ? [parseInt(числа[0], 16), parseInt(числа[1], 16), parseInt(числа[2], 16)]
    : [238, 242, 246];
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Кристаллы снега: мелкие светлые точки разного размера
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.5 + Math.random() * 2.5;
    const свет = 1.2 + Math.random() * 0.6;
    ctx.fillStyle = `rgba(${Math.round(Math.min(255, б * свет))},${Math.round(Math.min(255, г * свет))},${Math.round(Math.min(255, к * свет))},${0.3 + Math.random() * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Лёгкие неровности: снег не идеально ровный
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 3 + Math.random() * 12;
    const свет = 0.92 + Math.random() * 0.12;
    ctx.fillStyle = `rgba(${Math.round(б * свет)},${Math.round(г * свет)},${Math.round(к * свет)},${0.15 + Math.random() * 0.2})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  return toTexture(canvas, repeat);
}

/** Карта нормалей для снега: мелкие неровности. */
export function snowNormalTexture(repeat = 4, size = 128): THREE.CanvasTexture {
  const { canvas: _canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  // Мелкие бугорки: снег не идеально ровный
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.5 + Math.random() * 2.5;
    const свет = 110 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgb(${свет},${свет},${свет})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Лёгкие волны: следы ветра
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 8 + Math.random() * 20;
    const свет = 105 + Math.floor(Math.random() * 50);
    ctx.fillStyle = `rgb(${свет},${свет},${свет})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const img = ctx.getImageData(0, 0, size, size);
  const normalCanvas = heightToNormal(img.data, size, 1.5);
  return toDataTexture(normalCanvas as unknown as HTMLCanvasElement, repeat);
}

// ── Дерево для рамы окна ──────────────────────────────────────
//
// ЗАЧЕМ ЭТОТ БЛОК. Рама окна стояла плоским светлым камнем. Настоящая рама —
// дерево, и без текстуры она читается как пластиковая полоса.

/** Текстура дерева для рамы окна: вертикальные волокна. */
export function windowFrameTexture(base: string, repeat = 2, size = 128): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size);
  const числа = base.match(/\w\w/g);
  const [б, г, к] = числа
    ? [parseInt(числа[0], 16), parseInt(числа[1], 16), parseInt(числа[2], 16)]
    : [205, 185, 143];
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Вертикальные волокна дерева
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * size;
    const свет = 0.75 + Math.random() * 0.5;
    ctx.strokeStyle = `rgba(${Math.round(б * свет)},${Math.round(г * свет)},${Math.round(к * свет)},${0.3 + Math.random() * 0.4})`;
    ctx.lineWidth = 0.5 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (Math.random() - 0.5) * 4, size);
    ctx.stroke();
  }

  // Горизонтальные сучки
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 2 + Math.random() * 6;
    const свет = 0.7 + Math.random() * 0.3;
    ctx.fillStyle = `rgba(${Math.round(б * свет)},${Math.round(г * свет)},${Math.round(к * свет)},0.4)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  return toTexture(canvas, repeat);
}

/** Карта нормалей для дерева рамы окна. */
export function windowFrameNormalTexture(repeat = 2, size = 128): THREE.CanvasTexture {
  const { canvas: _canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  // Вертикальные волокна
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * size;
    const свет = 110 + Math.floor(Math.random() * 40);
    ctx.strokeStyle = `rgb(${свет},${свет},${свет})`;
    ctx.lineWidth = 0.5 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (Math.random() - 0.5) * 4, size);
    ctx.stroke();
  }

  const img = ctx.getImageData(0, 0, size, size);
  const normalCanvas = heightToNormal(img.data, size, 1.2);
  return toDataTexture(normalCanvas as unknown as HTMLCanvasElement, repeat);
}
