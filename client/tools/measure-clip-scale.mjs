// ЗАМЕР, А НЕ ДОГАДКА: во сколько раз клип больше покоя костей у каждой модели.
//
// Зачем отдельным скриптом. Пять гипотез подряд строились на сравнении чисел, и
// ни одна не подтвердилась, потому что связь выводилась, а не наблюдалась. Этот
// скрипт читает те же .glb, что читает игра, и повторяет ровно ту арифметику,
// что в realRig.ts, - чтобы видеть, что код делает на самом деле.
//
// GLB разбирается вручную, без three.js: нужны только узлы (переводы костей в
// покое) и сэмплеры анимации. Это ровно те два числа, которыми пользуется
// коэффициентКлипа(), и геометрия тут ни при чём.
//
// Имена переменных латиницей: в кириллице `глтф` и `глtf` неразличимы глазом,
// а Node считает их разными переменными. Ошибка такого рода стоила дня.
//
// Запуск: node tools/measure-clip-scale.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = join(HERE, '..', 'src', 'app', 'public', 'models');

/** Заголовок и чанки GLB. Возвращает распакованный JSON. */
function glbJson(file) {
  const buf = readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error(`not a glb: ${file}`);
  let offset = 12;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) return JSON.parse(buf.toString('utf8', offset + 8, offset + 8 + len));
    offset += 12 + len + ((4 - (len % 4)) % 4);
  }
  throw new Error(`no json chunk in ${file}`);
}

/** Тот же JSON, но с буфером и началом BINARY-чанка: нужны значения accessor'ов. */
function glbWithBuffers(file) {
  const buf = readFileSync(file);
  let offset = 12;
  let gltf = null;
  let bin = 0;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (type === 0x4e4f534a) gltf = JSON.parse(buf.toString('utf8', data, data + len));
    // Смещения bufferView в glTF отсчитываются от начала BINARY-чанга, а не от
    // начала файла. Без этого чтения выходят числа вида 1e+37.
    else if (type === 0x004e4942) bin = data;
    offset = data + len + ((4 - (len % 4)) % 4);
  }
  if (!gltf) throw new Error(`no json chunk in ${file}`);
  gltf.__bin = bin;
  gltf.bufferViews.forEach((v) => { v.buf = buf; });
  return gltf;
}

/** Значения accessor'а: VEC3 float. */
function vec3Accessor(gltf, index) {
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView];
  const stride = view.byteStride ?? 12;
  const base = gltf.__bin + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Float32Array(acc.count * 3);
  for (let i = 0; i < acc.count; i++) {
    out[i * 3] = view.buf.readFloatLE(base + i * stride);
    out[i * 3 + 1] = view.buf.readFloatLE(base + i * stride + 4);
    out[i * 3 + 2] = view.buf.readFloatLE(base + i * stride + 8);
  }
  return out;
}

// three.js выбрасывает из имени узла эти символы при создании дорожек анимации.
// Именно из-за этого в track.namecolon исчезает, и поиск кости по имени ловит
// соседнюю, а не ту, что нужна.
const RESERVED = /[\[\]\.:\/]/g;
const sanitize = (name) => String(name ?? '').replace(/\s/g, '_').replace(RESERVED, '');

/** Локальный перевод каждой кости в покое: то, что в three.js лежит в bone.position. */
function restBones(gltf) {
  const bones = new Map();
  gltf.nodes.forEach((n) => {
    const name = sanitize(n.name);
    if (!name) return;
    const t = n.translation ?? [0, 0, 0];
    bones.set(name, { x: t[0], y: t[1], z: t[2] });
  });
  return bones;
}

/** Родитель по индексу узла: glTF хранит детей списком, а не ссылкой вверх. */
function parents(gltf) {
  const par = new Array(gltf.nodes.length).fill(-1);
  gltf.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => { par[c] = i; }));
  return par;
}

/** Имя узла -> { имя -> [x,y,z] }: первый кадр дорожек перевода. */
function clipTranslations(gltf) {
  const out = new Map();
  for (const anim of gltf.animations ?? []) {
    for (const ch of anim.channels) {
      if (ch.target?.path !== 'translation') continue;
      const name = sanitize(gltf.nodes[ch.target.node]?.name);
      if (!name) continue;
      const vals = vec3Accessor(gltf, anim.samplers[ch.sampler].output);
      out.set(name, [vals[0], vals[1], vals[2]]);
    }
    break;
  }
  return out;
}

/** Медиана коэффициентов: во сколько раз кость модели крупнее кости клипа. */
function median(values) {
  const a = [...values].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

/** РОВНО ТА АРИФМЕТИКА, ЧТО В realRig.ts СЕЙЧАС. */
function coefAsInCode(rest, trans) {
  const factors = [];
  for (const [name, v] of trans) {
    const own = rest.get(name);
    if (!own) continue;
    // ↓↓↓ вот этот блок копируется из realRig.ts без изменений
    let best = -1;
    let sign = 1;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(v[k]) > Math.abs(v[best])) { best = k; sign = Math.sign(v[k]) || 1; }
    }
    if (best < 0 || Math.abs(v[best]) < 1e-4) continue;
    // ↑↑↑
    const ownValue = Math.abs([own.x, own.y, own.z][best]);
    if (ownValue < 1e-6) continue;
    factors.push(ownValue / Math.abs(v[best]));
  }
  return { value: factors.length < 3 ? null : median(factors), hits: factors.length };
}

/** ТО ЖЕ, СО ЕДИНСТВЕННЫМ ОТЛИЧИЕМ: первый элемент не берётся из массива с индексом −1. */
function coefFixed(rest, trans) {
  const factors = [];
  for (const [name, v] of trans) {
    const own = rest.get(name);
    if (!own) continue;
    let best = -1;
    for (let k = 0; k < 3; k++) {
      if (best < 0 || Math.abs(v[k]) > Math.abs(v[best])) best = k;
    }
    if (best < 0 || Math.abs(v[best]) < 1e-4) continue;
    const ownValue = Math.abs([own.x, own.y, own.z][best]);
    if (ownValue < 1e-6) continue;
    factors.push(ownValue / Math.abs(v[best]));
  }
  return { value: factors.length < 3 ? null : median(factors), hits: factors.length };
}

/**
 * Мировая точка кости под анимацией и данным масштабом клипа.
 *
 * Складывать только переводы нельзя: у костей Mixamo перевод идёт вдоль СОБСТВЕННОЙ
 * оси кости, а направление этой оси задаёт поворот узла. Без поворотов та же самая
 * фигура даёт ступню выше головы. Поэтому собираем полную матрицу: сначала
 * перевод клипа умножается на масштаб, потом накладывается поворот узла.
 *
 * Матрицы 4x4 храним построчно в обычном массиве - ради горстки костей свой
 * класс матриц не нужен, а лишняя абстракция здесь только мешала бы читать.
 */
function posedWorld(model, clip, clipScale) {
  const par = parents(model);
  const trans = clipTranslations(clip);
  const memo = new Map();

  const matOf = (idx) => {
    const n = model.nodes[idx];
    const [tx, ty, tz] = trans.has(sanitize(n.name))
      ? trans.get(sanitize(n.name)).map((v) => v * clipScale)
      : (n.translation ?? [0, 0, 0]);
    const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1];
    const [sx, sy, sz] = n.scale ?? [1, 1, 1];
    // Вращение кватернионом -> матрица 3x3 (столбцы: X, Y, Z оси).
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    return [
      (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, tx,
      (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, ty,
      (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, tz,
      0, 0, 0, 1,
    ];
  };

  const mul = (a, b) => {
    const o = new Array(16).fill(0);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
      }
    }
    return o;
  };

  const walk = (idx, stack) => {
    if (memo.has(idx)) return memo.get(idx);
    if (stack.has(idx)) return null;
    stack.add(idx);
    const p = par[idx];
    const parent = p >= 0 ? walk(p, stack) : null;
    const local = matOf(idx);
    const world = parent ? mul(parent, local) : local;
    memo.set(idx, world);
    return world;
  };
  model.nodes.forEach((_, i) => walk(i, new Set()));

  const byName = new Map();
  model.nodes.forEach((n, i) => byName.set(sanitize(n.name), memo.get(i)));
  const pick = (fragment) => {
    for (const [name, m] of byName) if (name.includes(fragment)) return m ? [m[3], m[7], m[11]] : null;
    return null;
  };
  return {
    head: pick('Head'),
    hips: pick('Hips'),
    spine: pick('Spine'),
    handL: pick('LeftHand'),
    handR: pick('RightHand'),
    footL: pick('LeftFoot'),
    footR: pick('RightFoot'),
  };
}

/** Высота фигуры в позе: размах Y по всем костям скелета. */
function posedHeight(world) {
  const ys = Object.values(world).filter(Boolean).map((p) => p[1]);
  return ys.length ? { min: Math.min(...ys), max: Math.max(...ys), height: Math.max(...ys) - Math.min(...ys) } : null;
}

const TARGET_HEIGHT = 1.9;
const FALLBACK = 100;
const MODELS_TO_TEST = ['guard-qizilbash', 'sufi-mystic', 'archer-of-persian', 'market-vendor', 'court-diplomat', 'citizen'];
const clip = glbWithBuffers(join(MODELS, 'standing-idle.glb'));

console.log('Коэффициент клипа: как в коде против как должно быть\n');
console.log('модель'.padEnd(20), 'костей'.padEnd(8), 'дорожек'.padEnd(10), 'как в коде'.padEnd(22), 'починенный'.padEnd(12), 'попаданий');
console.log('-'.repeat(86));

const rows = [];
for (const name of MODELS_TO_TEST) {
  const model = glbWithBuffers(join(MODELS, `${name}.glb`));
  const rest = restBones(model);
  const trans = clipTranslations(clip);
  const asIs = coefAsInCode(rest, trans);
  const fixed = coefFixed(rest, trans);
  const inGame = asIs.value ?? (rootScale(model) < 0.5 ? FALLBACK : 1);
  console.log(
    name.padEnd(20),
    String(rest.size).padEnd(8),
    String(trans.size).padEnd(10),
    (asIs.value === null ? `НЕТ ЗАМЕРА -> ${inGame}` : asIs.value.toFixed(1)).padEnd(22),
    (fixed.value === null ? 'НЕТ ЗАМЕРА' : fixed.value.toFixed(1)).padEnd(12),
    `${asIs.hits} из ${trans.size}`,
  );
  rows.push({ name, model, rest, asIs, fixed, inGame });
}

/** Средний модуль масштаба корней сцены - как в realRig.ts. */
function rootScale(model) {
  if (!model.scenes?.length) return 1;
  const roots = model.scenes[0].nodes ?? [];
  if (!roots.length) return 1;
  const s = roots.reduce((sum, r) => {
    const n = model.nodes[r];
    const t = n.scale ?? [1, 1, 1];
    return sum + (Math.abs(t[0]) + Math.abs(t[1]) + Math.abs(t[2])) / 3;
  }, 0);
  return s / roots.length;
}

console.log('\nЧто из этого видит игрок. Мировые координаты костей в сантиметрах ассета,');
console.log('и то же самое в долях роста персонажа (игровой масштаб подгоняет фигуру к 1.9 м).\n');

console.log('\nЧто из этого видит игрок. Мировые координаты костей в единицах ассета');
console.log('(у пяти классов это сантиметры, у граждан - метры).\n');

for (const r of rows) {
  const need = r.fixed.value ?? r.inGame;
  const now = posedWorld(r.model, clip, r.inGame);
  const want = posedWorld(r.model, clip, need);
  const k = r.inGame / need;
  const hNow = posedHeight(now);
  const hWant = posedHeight(want);
  console.log(`${r.name}:  применяется ${r.inGame.toFixed(1)}, нужно ${need.toFixed(1)}  ->  кости в ${(k * 100).toFixed(0)} % от нужного`);
  console.log(`  высота фигуры в позе: сейчас ${hNow.height.toFixed(1)}, нужно ${hWant.height.toFixed(1)}`);
  for (const [what, label] of [['hips', 'таз    '], ['head', 'голова '], ['handL', 'кисть Л'], ['footL', 'ступня Л'], ['footR', 'ступня П']]) {
    const a = now[what], b = want[what];
    if (!a || !b) { console.log(`  ${label}: не найдена`); continue; }
    console.log(`  ${label}  сейчас y=${a[1].toFixed(1).padStart(8)}   нужно y=${b[1].toFixed(1).padStart(8)}   разница=${(a[1] - b[1]).toFixed(1).padStart(8)}`);
  }
  const шея = (now.head && now.spine) ? now.head[1] - now.spine[1] : NaN;
  const шеяНужна = (want.head && want.spine) ? want.head[1] - want.spine[1] : NaN;
  const кисть = (now.handL && now.head) ? now.handL[1] - now.head[1] : NaN;
  const кистьНужна = (want.handL && want.head) ? want.handL[1] - want.head[1] : NaN;
  console.log(`  шея (голова минус позвоночник): ${шея.toFixed(1)} вместо ${шеяНужна.toFixed(1)}  ->  ${(шея / шеяНужна * 100).toFixed(0)} %`);
  console.log(`  кисть относительно головы:      ${кисть.toFixed(1)} вместо ${кистьНужна.toFixed(1)}  ->  ${(кисть / кистьНужна * 100).toFixed(0)} %\n`);
}

console.log('Высота фигуры в позе, если бы масштаб клипа был правильным:');
for (const r of rows) {
  const need = r.fixed.value ?? r.inGame;
  const h = posedHeight(posedWorld(r.model, clip, need));
  console.log(`  ${r.name.padEnd(20)} ${h.min.toFixed(1).padStart(8)} .. ${h.max.toFixed(1).padStart(8)}   рост ${h.height.toFixed(1)}`);
}