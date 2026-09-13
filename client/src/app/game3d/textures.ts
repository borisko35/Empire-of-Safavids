// ============================================================
// Процедурные текстуры — Empire of Safavids
// ============================================================
// Рисуются на canvas при загрузке мира (без внешних файлов):
// песок, штукатурка, каменная кладка, изразцовая мозаика, дерево.
// Используются материалами terrain.ts и NPC-модулем.

import * as THREE from 'three';

function makeCanvas(size = 256): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d')! };
}

function toTexture(canvas: HTMLCanvasElement, repeat: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Пестрота: случайное затемнение пикселя */
function speckle(ctx: CanvasRenderingContext2D, size: number, count: number, alpha = 0.08): void {
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
