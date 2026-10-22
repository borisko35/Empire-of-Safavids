#!/usr/bin/env node
// ============================================================
// Загрузка PBR-поверхностей (Poly Haven, CC0) для игры
// ============================================================
//
// ЗАЧЕМ. До этого все поверхности в игре рисовались на canvas: цвет и
// нормаль есть, но это процедурная «крашеная» поверхность. На близком
// расстоянии стена и земля читаются заливкой, а не материалом.
//
// ЧТО ДЕЛАЕТ. Качает у Poly Haven по одному набору карт (цвет, нормаль,
// шероховатость) в 1K JPG и кладёт в client/src/app/public/textures/<id>/.
// Рядом пишет surfaces.json — что именно скачано и под какой лицензией.
// Повторный запуск ничего не качает заново (если не --force).
//
// ПОЧЕМУ 1K. 8K/4K — это гигабайты на репозиторий и минуты загрузки, а
// выигрыш на экране почти нулевой: стена дома занимает на экране меньше
// 1K текселей на метр при обычной дистанции камеры. 2K понадобится, если
// появится режим осмотра вплотную.
//
// Запуск:
//   node tools/fetch-surfaces.mjs [--force] [--thumbs]
//
// --thumbs дополнительно качает превью в tools/surface-thumbs/ для
// визуальной проверки выбора (в игру они не попадают).

import { mkdir, writeFile, stat, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'client', 'src', 'app', 'public', 'textures');
const THUMBS = join(ROOT, 'tools', 'surface-thumbs');

const API = 'https://api.polyhaven.com/files/';

// Каждая запись — зачем она в игре. Идентификаторы Poly Haven, не «наши».
const SURFACES = [
  {
    id: 'sand_01',
    tile: 4,
    use: 'земля: пустыня, песок дорог и обочин',
  },
  {
    id: 'patterned_cobblestone',
    tile: 2.0,
    use: 'мостовая площади Исфахана: геометрический рисунок',
  },
  {
    id: 'cobblestone_floor_02',
    tile: 3.2,
    use: 'улицы и проспекты: мелкий колотый камень',
  },
  {
    id: 'clay_plaster',
    tile: 2.4,
    use: 'стены домов: глиняная штукатурка',
  },
  {
    id: 'plastered_wall_02',
    tile: 2.4,
    use: 'стены домов: светлая штукатурка с зерном',
  },
  {
    id: 'yellow_plaster',
    tile: 2.4,
    use: 'стены домов: охристая штукатурка (вариант)',
  },
  {
    id: 'sandstone_blocks_04',
    tile: 2.2,
    use: 'стены города, башни, парапеты: песчаник',
  },
  {
    id: 'sandstone_blocks_05',
    tile: 2.0,
    use: 'стены города, башни: светлый песчаник',
  },
  {
    id: 'brick_wall_001',
    tile: 1.6,
    use: 'кирпичные пояса и акценты: обожжённый кирпич',
  },
  {
    id: 'clay_roof_tiles',
    tile: 1.8,
    use: 'кровли и навесы: глиняная черепица',
  },
  {
    id: 'wood_planks',
    tile: 1.6,
    use: 'дерево: двери, ставни, балки, телеги, пристани',
  },
  {
    id: 'marble_tiles',
    tile: 2.0,
    use: 'фонтан, двор мечети, полы интерьеров',
  },
];

// Карты, которые нужны игре. AO не берём: он запекается в текстуру и
// спорит с настоящим затенением сцены.
const MAPS = {
  Diffuse: 'diff',
  nor_gl: 'nor',
  Rough: 'rough',
};

const force = process.argv.includes('--force');
const withThumbs = process.argv.includes('--thumbs');

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  if (withThumbs) await mkdir(THUMBS, { recursive: true });

  const manifest = {
    note: 'PBR-поверхности Poly Haven (CC0). Скачано tools/fetch-surfaces.mjs, не править руками.',
    source: 'https://polyhaven.com/',
    licence: 'CC0 1.0',
    resolution: '1k',
    surfaces: [],
  };

  for (const s of SURFACES) {
    const files = await getJson(API + s.id);
    const entry = { id: s.id, tile: s.tile, use: s.use, maps: {} };

    for (const [apiKey, suffix] of Object.entries(MAPS)) {
      const size = files?.[apiKey]?.['1k'];
      const url = size?.jpg?.url;
      if (!url) {
        console.warn(`[surface] ${s.id}: нет карты ${apiKey} в 1k — пропуск`);
        continue;
      }
      const name = `${s.id}_${suffix}_1k.jpg`;
      const dest = join(OUT, s.id, name);
      entry.maps[suffix] = `/game/textures/${s.id}/${name}`;
      if (force || !(await exists(dest))) {
        process.stdout.write(`[surface] ${s.id}/${suffix} … `);
        await download(url, dest);
        console.log('ok');
      }
    }

    // Превью — только для проверки выбора, в игру не попадает.
    if (withThumbs) {
      const thumb = `https://cdn.polyhaven.com/asset_img/thumbs/${s.id}.png?width=384&height=384`;
      const dest = join(THUMBS, `${s.id}.png`);
      if (force || !(await exists(dest))) {
        try { await download(thumb, dest); } catch (e) { console.warn('[thumb]', s.id, String(e)); }
      }
    }

    manifest.surfaces.push(entry);
    console.log(`[surface] ${s.id}: ${Object.keys(entry.maps).join(', ')}`);
  }

  await writeFile(join(OUT, 'surfaces.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const all = await readdir(OUT);
  console.log(`\nГотово. Наборов: ${manifest.surfaces.length}, каталог: ${OUT}`);
  console.log('Содержимое:', all.join(', '));
}

main().catch((e) => { console.error(e); process.exit(1); });
