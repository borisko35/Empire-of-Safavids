// Узкий отладчик: печатает коэффициенты по каждой кости и структуру дерева.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = join(HERE, '..', 'src', 'app', 'public', 'models');

function load(file) {
  const buf = readFileSync(file);
  let offset = 12, json = null, bin = 0;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (type === 0x4e4f534a) { json = JSON.parse(buf.toString('utf8', data, data + len)); }
    else if (type === 0x004e4942) { bin = data; }   // BINARY chunk: смещения bufferView отсчитываются отсюда
    offset = data + len + ((4 - (len % 4)) % 4);
  }
  json.__bin = bin;
  json.bufferViews.forEach((v) => { v.buf = buf; });
  return json;
}
function acc3(g, i) {
  const a = g.accessors[i], v = g.bufferViews[a.bufferView];
  const stride = v.byteStride ?? 12;
  const b = g.__bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float32Array(a.count * 3);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < 3; c++) out[k * 3 + c] = v.buf.readFloatLE(b + k * stride + c * 4);
  return out;
}
const sanitize = (n) => String(n ?? '').replace(/\s/g, '_').replace(/[\[\]\.:\/]/g, '');

const model = load(join(MODELS, 'guard-qizilbash.glb'));
const clip = load(join(MODELS, 'standing-idle.glb'));

const rest = new Map();
model.nodes.forEach((n) => { const nm = sanitize(n.name); if (!nm) return; const t = n.translation ?? [0,0,0]; rest.set(nm, [t[0], t[1], t[2]]); });

const trans = new Map();
for (const anim of clip.animations) {
  for (const ch of anim.channels) {
    if (ch.target?.path !== 'translation') continue;
    const nm = sanitize(clip.nodes[ch.target.node]?.name);
    if (!nm) continue;
    const vals = acc3(clip, anim.samplers[ch.sampler].output);
    trans.set(nm, [vals[0], vals[1], vals[2]]);
  }
  break;
}

const factors = [];
console.log('кость'.padEnd(30), 'покой'.padEnd(26), 'клип(1й кадр)'.padEnd(26), 'коэф');
console.log('-'.repeat(96));
for (const [nm, v] of trans) {
  const own = rest.get(nm);
  if (!own) { console.log(nm.padEnd(30), 'НЕТ В МОДЕЛИ'); continue; }
  let best = -1;
  for (let k = 0; k < 3; k++) if (best < 0 || Math.abs(v[k]) > Math.abs(v[best])) best = k;
  if (Math.abs(v[best]) < 1e-4) continue;
  const ownV = Math.abs(own[best]);
  if (ownV < 1e-6) continue;
  const f = ownV / Math.abs(v[best]);
  factors.push(f);
  if (factors.length <= 20) {
    console.log(nm.padEnd(30),
      `[${own.map((x) => x.toFixed(2).padStart(8)).join(',')}]`.padEnd(26),
      `[${v.map((x) => x.toFixed(3).padStart(8)).join(',')}]`.padEnd(26),
      f.toFixed(2));
  }
}
const sorted = [...factors].sort((a, b) => a - b);
console.log(`\nвсего коэффициентов: ${factors.length}`);
console.log(`медиана: ${sorted[Math.floor(sorted.length / 2)]?.toFixed(2)}`);
console.log(`первые 10 отсортированных: ${sorted.slice(0, 10).map((v) => v.toFixed(2)).join(', ')}`);
console.log(`медиана среди значений > 1: ${(() => { const b = sorted.filter((v) => v > 1); return b.length ? b[Math.floor(b.length / 2)].toFixed(2) : 'нет'; })()}`);

// Структура: сколько корней, есть ли циклы, где mesh-узлы
const par = new Array(model.nodes.length).fill(-1);
model.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => { par[c] = i; }));
const roots = model.nodes.map((_, i) => i).filter((i) => par[i] === -1);
const meshes = model.nodes.map((n, i) => [n, i]).filter(([n]) => n.mesh !== undefined);
console.log(`\nузлов: ${model.nodes.length}, корней: ${roots.length}, мешей: ${meshes.length}`);
console.log('корни:', roots.map((i) => `${i}:${model.nodes[i].name}`).join(', '));
console.log('меши :', meshes.map(([n, i]) => `${i}:${n.name}(par=${par[i]})`).join(', '));

// Глубина до корня для нескольких костей + мировая высота покоя
const memo = new Map();
function world(i, stack = new Set()) {
  if (memo.has(i)) return memo.get(i);
  if (stack.has(i)) { console.log('  ЦИКЛ на узле', i, model.nodes[i].name); return [0,0,0]; }
  stack.add(i);
  const t = model.nodes[i].translation ?? [0,0,0];
  const p = par[i];
  const b = p >= 0 ? world(p, stack) : [0,0,0];
  const w = [b[0] + t[0], b[1] + t[1], b[2] + t[2]];
  memo.set(i, w);
  return w;
}
for (const frag of ['Hips', 'Spine', 'Head', 'LeftHand', 'LeftFoot']) {
  const idx = model.nodes.findIndex((n) => sanitize(n.name) === `mixamorig${frag}` || sanitize(n.name).endsWith(frag));
  if (idx < 0) { console.log(`${frag}: не найдена`); continue; }
  let d = 0, k = idx;
  while (par[k] >= 0 && d < 50) { k = par[k]; d++; }
  const w = world(idx);
  console.log(`${frag.padEnd(10)} узел ${String(idx).padStart(3)} глубина ${String(d).padStart(2)} мирный y=${w[1].toFixed(2)}`);
}