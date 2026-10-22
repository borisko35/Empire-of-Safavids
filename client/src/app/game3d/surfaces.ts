// ============================================================
// PBR-поверхности: настоящие карты цвета, нормалей и шероховатости
// ============================================================
//
// ЗАЧЕМ. Все поверхности мира до этого рисовались на canvas: у них был
// цвет и слабая нормаль, но не было материала. На близком расстоянии
// стена читалась крашеной плоскостью, а камень — картинкой с периодом.
//
// ЧТО ЗДЕСЬ. Двенадцать наборов Poly Haven (CC0, см. tools/fetch-surfaces.mjs
// и THIRD_PARTY.md), по три карты в каждом: цвет (sRGB), нормаль (линейная),
// шероховатость (линейная). 1K JPG — компромисс: на дистанции камеры
// стена дома занимает меньше 1K текселей на метр, а 4K стоил бы сотни
// мегабайт репозитория и минуты первой загрузки.
//
// ПОЧЕМУ НЕ ПРОСТО textur.repeat. Повтор — свойство текстуры, а не
// материала. Один и тот же набор нужен и на площади (повтор 80), и на
// двери (повтор 1). Поэтому базовые текстуры грузятся один раз, а на
// каждый повтор делается дешёвый клон (общий source, разные repeat).
//
// ПОЧЕМУ МАТЕРИАЛ НЕ ЧЕРНЕЕТ, ПОКА ТЕКСТУРА ЕДЕТ. Карта не ставится,
// пока её картинка не пришла: три.js с пустой картой рисует чёрное.
// До прихода материала остаётся прежняя процедурная карта либо цвет —
// мир виден сразу, а детали поверхностей появляются через доли секунды.
//
// ЧЕГО ЗДЕСЬ НЕТ. AO (ambient occlusion) не берём: он запечён в текстуру
// и спорит с настоящим затенением сцены. Displacement тоже не берём —
// геометрия домов плоская, и смещать там нечего.

import * as THREE from 'three';

/** Идентификаторы совпадают с папками в public/textures и с surfaces.json. */
export type SurfaceId =
  | 'sand_01'
  | 'patterned_cobblestone'
  | 'cobblestone_floor_02'
  | 'clay_plaster'
  | 'plastered_wall_02'
  | 'yellow_plaster'
  | 'sandstone_blocks_04'
  | 'sandstone_blocks_05'
  | 'brick_wall_001'
  | 'clay_roof_tiles'
  | 'wood_planks'
  | 'marble_tiles';

/**
 * Набор карт. tile — сколько метров поверхности покрывает один повтор
 * текстуры. По нему считается метрический UV (см. metricBoxUV), поэтому
 * камень на доме 12 м и на доме 6 м одного размера, а не растянут.
 */
const НАБОРЫ: Record<SurfaceId, { tile: number }> = {
  sand_01: { tile: 4 },
  patterned_cobblestone: { tile: 2.6 },
  cobblestone_floor_02: { tile: 3.2 },
  clay_plaster: { tile: 2.4 },
  plastered_wall_02: { tile: 2.4 },
  yellow_plaster: { tile: 2.4 },
  sandstone_blocks_04: { tile: 2.2 },
  sandstone_blocks_05: { tile: 2.0 },
  brick_wall_001: { tile: 1.6 },
  clay_roof_tiles: { tile: 1.8 },
  wood_planks: { tile: 1.6 },
  marble_tiles: { tile: 2.0 },
};

/** Сколько метров покрывает один повтор набора (нужно для метрического UV). */
export function surfaceTile(id: SurfaceId): number {
  return НАБОРЫ[id].tile;
}

// Анизотропия: землю и мостовую игрок видит почти вдоль, и без неё
// дальний план превращается в мыло. Значение сообщает рендер после
// создания (см. world3d), до этого держим разумный минимум.
let анизотропия = 4;

export function setSurfaceAnisotropy(max: number): void {
  анизотропия = Math.max(1, Math.floor(max));
  for (const загруженная of кеш.values()) {
    загруженная.texture.anisotropy = анизотропия;
    загруженная.texture.needsUpdate = true;
  }
}

interface Загруженная {
  texture: THREE.Texture;
  ready: Promise<THREE.Texture>;
}

const кеш = new Map<string, Загруженная>();

/**
 * Загрузить одну карту. Возвращает текстуру сразу (three так умеет) и
 * обещание, которое сбудется, когда картинка приедет. При ошибке
 * обещание тоже сбывается — с текстурой без картинки: материал просто
 * останется процедурным, игра не встанет.
 */
function загрузить(url: string, цвет: boolean): Загруженная {
  const готовое = кеш.get(url);
  if (готовое) return готовое;

  let сбыть!: (t: THREE.Texture) => void;
  const ready = new Promise<THREE.Texture>((r) => { сбыть = r; });

  const texture = new THREE.TextureLoader().load(
    url,
    (t) => {
      t.anisotropy = анизотропия;
      t.needsUpdate = true;
      сбыть(t);
    },
    undefined,
    () => {
      // Файла нет — не подменяем мир чёрным. Материал остаётся как был.
      console.warn(`[surfaces] не загрузилась карта ${url}`);
      сбыть(texture);
    },
  );

  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = цвет ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = анизотропия;

  const запись = { texture, ready };
  кеш.set(url, запись);
  return запись;
}

const КОРЕНЬ = '/game/textures';

function карты(id: SurfaceId): {
  diff: Загруженная; nor: Загруженная; rough: Загруженная;
} {
  const папка = `${КОРЕНЬ}/${id}/${id}`;
  return {
    diff: загрузить(`${папка}_diff_1k.jpg`, true),
    nor: загрузить(`${папка}_nor_1k.jpg`, false),
    rough: загрузить(`${папка}_rough_1k.jpg`, false),
  };
}

function клон(t: THREE.Texture, repeat: number): THREE.Texture {
  const к = t.clone();
  к.wrapS = THREE.RepeatWrapping;
  к.wrapT = THREE.RepeatWrapping;
  к.repeat.set(repeat, repeat);
  к.anisotropy = анизотропия;
  к.needsUpdate = true;
  return к;
}

export interface SurfaceOptions {
  /** Повтор на сторону; по умолчанию 1. */
  repeat?: number;
  color?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  side?: THREE.Side;
  /**
   * Ставить ли карту цвета. У земли цвет уже нарисован вершинами по
   * биомам: вторая карта цвета перемножилась бы с ним и затемнила мир.
   * Там нужны только нормаль и шероховатость.
   */
  colorMap?: boolean;
}

/**
 * Наложить настоящую поверхность на существующий материал.
 *
 * Цвет материала НЕ трогается: он остаётся множителем текстуры, как и
 * раньше, и снег (§263) продолжает возвращать стены к запомненному цвету.
 * Карты ставятся только после загрузки — см. шапку модуля.
 */
export function applySurface(
  материал: THREE.MeshStandardMaterial,
  id: SurfaceId,
  opts: SurfaceOptions = {},
): void {
  const repeat = opts.repeat ?? 1;
  const { diff, nor, rough } = карты(id);

  Promise.all([diff.ready, nor.ready, rough.ready]).then(([d, n, r]) => {
    if (!d.image || !n.image || !r.image) return;
    if (opts.colorMap !== false) материал.map = клон(d, repeat);
    материал.normalMap = клон(n, repeat);
    материал.roughnessMap = клон(r, repeat);
    if (opts.normalScale !== undefined) {
      материал.normalScale.set(opts.normalScale, opts.normalScale);
    }
    материал.needsUpdate = true;
    материал.userData.surface = id;
  });
}

/** Новый материал с настоящей поверхностью: цвет и шероховатость сразу. */
export function surfaceMaterial(
  id: SurfaceId,
  opts: SurfaceOptions = {},
): THREE.MeshStandardMaterial {
  const материал = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xffffff,
    roughness: opts.roughness ?? 0.92,
    metalness: opts.metalness ?? 0,
    side: opts.side,
  });
  applySurface(материал, id, opts);
  return материал;
}
