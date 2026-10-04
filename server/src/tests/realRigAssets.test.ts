// Настоящий персонаж: активы на месте и клипы играют на персонажах.
//
// ЧТО БЫЛО ИЗМЕРЕНО. Пять моделей персонажей и восемнадцать клипов получены из
// папок Characters и Animation конвертацией FBX -> GLB (Blender 5.2, сжатие Draco и
// WebP, текстуры уменьшены до 1024). Пять классов игрока в rig.ts названы ровно так
// же, как пять моделей: совпадение один в один.
//
// ГЛАВНАЯ ОПАСНОСТЬ. three.js связывает дорожку анимации с костью ПО ИМЕНИ. Если в
// клипе есть кость, которой нет в персонаже, движение пропадает молча: клип
// проигрывается, но рука или нога не двигается, и ошибки нет нигде. Проверка ниже
// сверяет множества имен у настоящих файлов, чтобы такое нельзя было закоммитить.
//
// Проверяется:
//   1. все файлы лежат в репозитории по путям, откуда их берет сборка;
//   2. манифест совпадает с диском по байтам (манифест не врет);
//   3. у каждого персонажа есть скин и веса у каждого примитива;
//   4. ни один клип не ссылается на кость, которой нет ни в одном персонаже;
//   5. классу игрока соответствует существующий файл;
//   6. декодер Draco на месте, а модели сжаты;
//   7. запасной путь не потерян: процедурный риг создается первым;
//   8. масштаб берётся из габаритов модели, а не из константы на модель.
//
// Идентификаторы латиницей намеренно: при записи файла кириллица в коде уже
// один раз исказилась, и ошибка выглядела как ошибка компиляции.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const MODELS = join(ROOT, 'client/src/app/public/models');
const DRACO = join(ROOT, 'client/src/app/public/draco');

type Prim = { attributes: Record<string, number> };
type Sampler = { output: number };
type Anim = {
  channels: { target: { node: number; path: string }; sampler: number }[];
  samplers: Sampler[];
};
type GLTF = {
  // translation и scale нужны для размера скелета, scenes — для масштаба корня.
  // children нужен для длины кости: длина измеряется до начала кости-потомка.
  nodes?: { name?: string; translation?: number[]; scale?: number[]; children?: number[] }[];
  meshes?: { primitives?: Prim[] }[];
  accessors?: {
    min?: number[];
    max?: number[];
    componentType?: number;
    type?: string;
    count?: number;
    bufferView?: number;
    byteOffset?: number;
  }[];
  bufferViews?: { byteOffset?: number }[];
  scenes?: { nodes: number[] }[];
  skins?: unknown[];
  animations?: Anim[];
  extensionsUsed?: string[];
};

type ManifestEntry = { file: string; name: string; bytes: number };
type Manifest = {
  characters: (ManifestEntry & { bones: number })[];
  clips: (ManifestEntry & { channels: number })[];
};

function readText(path: string): string {
  return readFileSync(path, 'utf-8');
}

/** GLB: 12 bait zagolovka, potom JSON-chank. Chitaetsya kak est, bez dekodirovaniya. */
function readGLB(file: string): GLTF {
  const buf = readFileSync(join(MODELS, file));
  if (buf.slice(0, 4).toString('ascii') !== 'glTF') {
    throw new Error(`${file} ne GLB`);
  }
  const jsonLength = buf.readUInt32LE(12);
  if (buf.slice(16, 20).toString('ascii') !== 'JSON') {
    throw new Error(`${file}: pervyi chank ne JSON`);
  }
  return JSON.parse(buf.slice(20, 20 + jsonLength).toString('utf-8')) as GLTF;
}

/**
 * Насколько корень уезжает со своего места за клип.
 *
 * Смещение считается от ПОКОЯ кости, а не от нуля: в glTF дорожка перевода заменяет
 * собственный перевод узла целиком, поэтому уехать можно и вместе с покоем.
 */
function rootDrift(file: string): number {
  const buf = readFileSync(join(MODELS, file));
  const jsonLength = buf.readUInt32LE(12);
  const jsonEnd = 20 + jsonLength;
  const gltf = JSON.parse(buf.slice(20, jsonEnd).toString('utf-8')) as GLTF;
  const bin = buf.slice(jsonEnd + 8, jsonEnd + 8 + buf.readUInt32LE(jsonEnd));
  const nodes = gltf.nodes ?? [];
  const hips = nodes.findIndex((n) => n.name === 'mixamorig:Hips');
  if (hips < 0) throw new Error(file + ": net kosti taza");
  const rest = nodes[hips].translation ?? [0, 0, 0];
  let drift = 0;
  for (const anim of gltf.animations ?? []) {
    for (const channel of anim.channels) {
      if (channel.target.node !== hips || channel.target.path !== 'translation') continue;
      const sampler = anim.samplers[channel.sampler];
      const acc = (gltf.accessors ?? [])[sampler ? sampler.output : -1];
      if (!acc || acc.componentType !== 5126 || acc.type !== 'VEC3') continue;
      const view = (gltf.bufferViews ?? [])[acc.bufferView ?? -1];
      if (!view) continue;
      const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      for (let f = 0; f < (acc.count ?? 0); f++) {
        for (let k = 0; k < 3; k++) {
          const value = bin.readFloatLE(base + f * 12 + k * 4);
          drift = Math.max(drift, Math.abs(value - rest[k]));
        }
      }
    }
  }
  return drift;
}
function must(ok: unknown, why: string): void {
  if (!ok) throw new Error(why);
}

const manifest = JSON.parse(readText(join(MODELS, 'manifest.json'))) as Manifest;

const CLASSES = [
  'qizilbash',
  'sufi_mystic',
  'persian_archer',
  'bazaar_merchant',
  'court_diplomat',
];

function shortName(file: string): string {
  return file.replace('models/', '');
}

function boneNames(gltf: GLTF): string[] {
  return (gltf.nodes ?? [])
    .map((n) => n.name ?? '')
    .filter((n) => n.startsWith('mixamorig:'));
}

function realRigSource(): string {
  return readText(join(ROOT, 'client/src/app/game3d/realRig.ts'));
}

function world3dSource(): string {
  return readText(join(ROOT, 'client/src/app/game3d/world3d.ts'));
}

describe('Активы: настоящие модели на месте', () => {
  it('все клипы лежат в репозитории, и персонажей хоть один есть', () => {
    // Раньше здесь стояло требование «столько же моделей, сколько классов». Сейчас
    // доспех один на пять классов, и такая проверка ловила бы не забытый класс, а
    // наоборот - запрещала бы иметь меньше файлов, чем классов. Нужно другое: чтобы
    // каждый класс вёл в файл, который есть и в манифесте, и на диске; это проверяет
    // следующая проверка, здесь остаётся только факт наличия персонажа.
    must(
      manifest.characters.length >= 1,
      'v manifeste net ni odnogo personazha: vse klassy ostanutsya na palochkah',
    );
    // 18 первых + 18 докачанных = 36. Число берётся из манифеста и сверяется с
    // диском: константой оно жить не может, файлы добавляются.
    must(
      manifest.clips.length >= 36,
      `v manifeste ${manifest.clips.length} klipov, a dolzhno byt ne menshe 36: 18 pervых + 18 dokačannyx`,
    );
    for (const entry of [...manifest.characters, ...manifest.clips]) {
      must(
        existsSync(join(ROOT, 'client/src/app/public', entry.file)),
        `net fayla po puti sborki: ${entry.file}. Vite kladet soderzhimoe public v web/game, i bez fayla personazh ostanetsya na palochkah`,
      );
    }
  });

  it('манифест совпадает с диском по байтам', () => {
    for (const entry of [...manifest.characters, ...manifest.clips]) {
      const size = statSync(join(ROOT, 'client/src/app/public', entry.file)).size;
      must(
        size === entry.bytes,
        `${entry.file}: manifeste govorit ${entry.bytes} bait, na diske ${size}. Rashozhdenie znachit, chto fayl zamenili, a manifeste net`,
      );
    }
  });

  it('декодер Draco на месте: без него сжатая геометрия не грузится', () => {
    for (const name of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
      const path = join(DRACO, name);
      must(existsSync(path), `net ${name}: DRACOLoader gruzit dekoder po seti`);
      must(
        statSync(path).size > 1000,
        `${name} pust ili pochti: ${statSync(path).size} bait. Fajl est, a dekodera v nem net, i pervaya zagruzka modeli upastet`,
      );
    }
  });

  it('модели действительно сжаты Draco, и это объявлено в файле', () => {
    for (const person of manifest.characters) {
      const gltf = readGLB(shortName(person.file));
      must(
        (gltf.extensionsUsed ?? []).includes('KHR_draco_mesh_compression'),
        `${person.name}: net KHR_draco_mesh_compression, hotya konvertaciya obeshchala szhatie`,
      );
    }
  });
});

describe('Персонаж: с настоящим скелетом, а не мешем без костей', () => {
  it('у каждого персонажа есть скин', () => {
    for (const person of manifest.characters) {
      const gltf = readGLB(shortName(person.file));
      must(
        (gltf.skins ?? []).length > 0,
        `${person.name}: skinov net, eto statichnaya mesh, i klipy po nej ne poyut`,
      );
    }
  });

  it('веса есть у каждого примитива, а не только у первого', () => {
    for (const person of manifest.characters) {
      const gltf = readGLB(shortName(person.file));
      let total = 0;
      let skinned = 0;
      for (const mesh of gltf.meshes ?? []) {
        for (const prim of mesh.primitives ?? []) {
          total++;
          if (
            prim.attributes.JOINTS_0 !== undefined &&
            prim.attributes.WEIGHTS_0 !== undefined
          ) {
            skinned++;
          }
        }
      }
      must(total > 0, `${person.name}: v fayle net ni odnogo primitiva`);
      must(
        skinned === total,
        `${person.name}: vesa est u ${skinned} primitivov iz ${total}. Chast tela ne budet dvigatsya skeletom, i eto ne vidno po oshibkam`,
      );
    }
  });

  it('число костей совпадает с манифестом и достаточно для гуманоида', () => {
    for (const person of manifest.characters) {
      const bones = boneNames(readGLB(shortName(person.file)));
      must(
        bones.length === person.bones,
        `${person.name}: kostey v fayle ${bones.length}, v manifeste ${person.bones}`,
      );
      must(
        bones.length >= 60,
        `${person.name}: kostey vsego ${bones.length}, a dlya gumanoida nuzhno ne menshe 60`,
      );
    }
  });
});

describe('Клипы играют на персонажах', () => {
  it('ни один клип не ссылается на кость, которой нет ни в одном персонаже', () => {
    const bones = new Set<string>();
    for (const person of manifest.characters) {
      for (const name of boneNames(readGLB(shortName(person.file)))) bones.add(name);
    }
    const lost = new Set<string>();
    for (const clip of manifest.clips) {
      const gltf = readGLB(shortName(clip.file));
      const nodes = gltf.nodes ?? [];
      for (const anim of gltf.animations ?? []) {
        for (const channel of anim.channels) {
          const name = nodes[channel.target.node]?.name ?? '';
          if (name.startsWith('mixamorig:') && !bones.has(name)) {
            lost.add(`${clip.name} -> ${name}`);
          }
        }
      }
    }
    must(
      lost.size === 0,
      `dorozhki vedut v nikuda (${lost.size}): ${[...lost].slice(0, 5).join(', ')}. Takoe dvizhenie propadet v igre`,
    );
  });

  it('в каждом клипе есть дорожки, а не пустой файл', () => {
    for (const clip of manifest.clips) {
      const anims = readGLB(shortName(clip.file)).animations ?? [];
      must(anims.length > 0, `${clip.name}: v fayle net ni odnoi animacii`);
      must(
        anims[0].channels.length > 0,
        `${clip.name}: animaciya est, a dorozhek nol, fayl nichego ne dvigaet`,
      );
    }
  });

  it('число дорожек совпадает с манифестом', () => {
    for (const clip of manifest.clips) {
      const anims = readGLB(shortName(clip.file)).animations ?? [];
      const channels = anims.reduce((sum, a) => sum + a.channels.length, 0);
      must(
        channels === clip.channels,
        `${clip.name}: dorozhek ${channels}, v manifeste ${clip.channels}`,
      );
    }
  });

  it('имена костей не потеряли номер из пространства имён', () => {
    // Tri modeli prishli s imenami vida mixamorig9:LeftArm. Nomer ne chast imeni, i
    // bez snyatiya nomera klipy po kostyam ne nahodyat.
    for (const clip of manifest.clips) {
      for (const name of boneNames(readGLB(shortName(clip.file)))) {
        must(
          !/mixamorig\d+:/.test(name),
          `${clip.name}: kost nazvana ${name}, s nomerom v prostranstve imen. Takoi kosti net ni v odnoi modele posle snyatiya nomera`,
        );
      }
    }
  });
});

describe('Koren ne uvozit personazha s mesta', () => {
  // Porog 8 izmeren na oboikh naborah: bitye davali 10,69-728,75, godnye 0,05-6,18.
  const MAX_DRIFT = 8;

  it('ni odin klip ne dvigaet koren silnee skeleta', () => {
    const bad: string[] = [];
    for (const clip of manifest.clips) {
      const drift = rootDrift(shortName(clip.file));
      if (drift > MAX_DRIFT) bad.push(clip.name + ': ' + drift.toFixed(1));
    }
    must(
      bad.length === 0,
      'klipov s uezdom kornya: ' + bad.length + ' - ' + bad.slice(0, 4).join(', ') +
        '. Skelet vysokoy okolo metra, a koren otkhodit na desyatki edinits: dorozhki i pokoy kosti v raznyh edinitsah, i personazh pod zemley',
    );
  });

  it('u stoящего pokoya koren pochti na meste', () => {
    // Стоящий покой играется всегда, поэтому если уезжает он - не видно персонажа прежде
    // всего. Остальные клипы могут двигаться: присед и падение это делают по делу.
    const idle = manifest.clips.find((c) => c.name === 'standing-idle');
    must(idle !== undefined, 'klipa standing-idle net v manifeste');
    // must не сужает тип, поэтому проверка на undefined повторяется здесь явно.
    if (!idle) return;
    const drift = rootDrift(shortName(idle.file));
    // 0,2 - не с потолка: у годного standing-idle смещение 0,0485, запас вчетверо.
    // Битый файл давал 10,69. Ломка сдвига в 0,3 обязана ломать эту проверку.
    must(
      drift < 0.2,
      'u standing-idle koren otkhodit na ' + drift.toFixed(2) +
        ': personazh budet rezko smeshchatsya, a dolzhen stojat na meste',
    );
  });
});

describe('Масштаб в файле: один, а не два', () => {
  // Blender при обратном импорте файла компенсирует масштаб корня молча, three.js
  // учитывает его честно. Из-за этого файл с корнем 0,01 выглядит правильным при
  // любой проверке в Blender и ломает игру.
  function rootScale(gltf: GLTF): number {
    const rootIndex = (gltf.scenes?.[0]?.nodes ?? [])[0];
    if (rootIndex === undefined) return 1;
    const scale = (gltf.nodes ?? [])[rootIndex]?.scale ?? [1, 1, 1];
    return (Math.abs(scale[0]) + Math.abs(scale[1]) + Math.abs(scale[2])) / 3;
  }

  function meshHeight(gltf: GLTF): number | null {
    let min = Infinity;
    let max = -Infinity;
    for (const mesh of gltf.meshes ?? []) {
      for (const prim of mesh.primitives ?? []) {
        const acc = (gltf.accessors ?? [])[prim.attributes.POSITION];
        if (!acc?.min || !acc.max) continue;
        min = Math.min(min, acc.min[1]);
        max = Math.max(max, acc.max[1]);
      }
    }
    return max > min ? max - min : null;
  }

  it('у всех файлов в models масштаб корня равен единице', () => {
    const плохие: string[] = [];
    for (const entry of [...manifest.characters, ...manifest.clips]) {
      const gltf = readGLB(shortName(entry.file));
      const scale = rootScale(gltf);
      if (Math.abs(scale - 1) > 0.0005) {
        плохие.push(`${entry.name}: ${scale.toFixed(4)}`);
      }
    }
    must(
      плохие.length === 0,
      `масштаб корня не равен 1 у ${плохие.length} файлов: ${плохие.slice(0, 4).join(', ')}. three.js этот масштаб учитывает, а нормализация по мешу умножит сцену на 95 и получится огромная размазанная фигура`,
    );
  });

  it('персонаж приезжает в игру правдоподобного роста', () => {
    // Рост в единицах игрового мира. Спец при 1,78-1,81, страж 3,78: он и в исходнике
    // вдвое больше остальных, и нормализация приводит его к общей высоте.
    for (const person of manifest.characters) {
      const height = meshHeight(readGLB(shortName(person.file)));
      must(height !== null, `${person.name}: нечем измерить рост — у меша нет границ`);
      must(
        (height ?? 0) > 1.5 && (height ?? 0) < 4.0,
        `${person.name}: рост ${height?.toFixed(3)} вне диапазона 1.5-4.0. Модель приедет в игру то гигантом, то точкой`,
      );
    }
  });

  it('нормализация не станет увеличивать сцену в разы', () => {
    // Страховка в клиенте: даже если актив снова окажется битым, персонаж не должен
    // превратиться в фигуру во весь экран молча.
    const src = realRigSource();
    must(/const MAX_SCALE = 5;/.test(src), 'в клиенте нет верхней границы коэффициента');
    must(/const MIN_SCALE = 0.2;/.test(src), 'в клиенте нет нижней границы коэффициента');
    must(
      /if \(k < MIN_SCALE \|\| k > MAX_SCALE\)/.test(src),
      'границы объявлены, но не проверяются: битый актив снова растянет сцену',
    );
    must(
      /не трогаю размер/.test(src),
      'при битом коэффициенте нет сообщения в консоль: непонятно, почему персонаж такой',
    );
  });
});

describe('Персонаж игрока смотрит в камеру, а не по направлению движения', () => {
  /**
   * Куда в мире стоит камера при заданном yaw.
   *
   * Формулы читаются из world3d.ts, а не выписаны здесь: соглашение о камере может
   * измениться, и проверка обязана это заметить, а не проверять саму себя.
   */
  function камера(): { x: (yaw: number, dist: number) => number; z: (yaw: number, dist: number) => number } {
    const src = world3dSource();
    const поX = /const camX = me\.pos\.x \+ Math\.(\w+)\(this\.yaw\)/.exec(src);
    const поZ = /const camZ = me\.pos\.z \+ Math\.(\w+)\(this\.yaw\)/.exec(src);
    must(поX, 'не нашли, где ставится camX: камера переехала, проверка ослепла');
    must(поZ, 'не нашли, где ставится camZ: камера переехала, проверка ослепла');
    // must() не сужает тип, поэтому проверяем вторым шагом: без этого TypeScript
    // считает результат регулярного выражения possibly null.
    if (!поX || !поZ) return { x: () => 0, z: () => 0 };
    const fnX = Math[поX[1] as 'sin' | 'cos'];
    const fnZ = Math[поZ[1] as 'sin' | 'cos'];
    return {
      x: (yaw: number, dist: number) => fnX(yaw) * Math.cos(0) * dist,
      z: (yaw: number, dist: number) => fnZ(yaw) * Math.cos(0) * dist,
    };
  }

  /** Куда смотрит модель, повёрнутая на угол: её ось +Z после поворота. */
  function взгляд(угол: number): { x: number; z: number } {
    return { x: Math.sin(угол), z: Math.cos(угол) };
  }

  const ПРОВЕРЯЕМ = [0, 0.7, -0.7, Math.PI / 2, Math.PI, -Math.PI, 2.9, -2.9, 3.13];

  it('нужный доворот действительно равен yaw, а не yaw со сдвигом на полоборота', () => {
    // Смыкает формулу камеры с кодом. Проверка выше честно считает, что поворот на yaw
    // смотрит в камеру, но она не читает сам поворот из кода: если в коде стоит
    // «-this.yaw» или «this.yaw + Math.PI», геометрия останется верной, а персонаж
    // повернётся задом. Поэтому нужный угол вычисляется из формулы камеры и обязан
    // совпасть с тем, что стоит в коде.
    const cam = камера();
    for (const yaw of ПРОВЕРЯЕМ) {
      const нужный = Math.atan2(cam.x(yaw, 7), cam.z(yaw, 7));
      const разница = Math.abs(нужный - yaw);
      must(
        разница < 1e-9 || Math.abs(разница - 2 * Math.PI) < 1e-9,
        `при yaw ${yaw.toFixed(2)} доворот в камеру должен быть ${нужный.toFixed(4)}, ` +
          `а в коде стоит this.yaw = ${yaw.toFixed(4)}. Камера смотрит с другой стороны, ` +
          'и персонаж повернётся задом к камере',
      );
    }
  });

  it('камера стоит в направлении взгляда персонажа, повёрнутого на yaw', () => {
    const cam = камера();
    for (const yaw of ПРОВЕРЯЕМ) {
      const кКамере = { x: cam.x(yaw, 7), z: cam.z(yaw, 7) };
      const длина = Math.hypot(кКамере.x, кКамере.z);
      const взглядПриYaw = взгляд(yaw);
      const скалярное =
        (взглядПриYaw.x * кКамере.x + взглядПриYaw.z * кКамере.z) / длина;
      must(
        Math.abs(скалярное - 1) < 1e-9,
        `при yaw ${yaw.toFixed(2)} персонаж повёрнут на yaw, но смотрит ` +
          `не в ту сторону, куда стоит камера (скалярное ${скалярное.toFixed(4)}). ` +
          'Знак угла перепутан: персонаж будет развёрнут задом к камере.',
      );
      // Обратная сторона: тот же поворот со сдвигом на π обязан смотреть ОТ камеры.
      const наоборот = взгляд(yaw + Math.PI);
      const скалярное2 =
        (наоборот.x * кКамере.x + наоборот.z * кКамере.z) / длина;
      must(
        Math.abs(скалярное2 + 1) < 1e-9,
        `при yaw ${yaw.toFixed(2)} поворот на yaw + пи смотрит не от камеры ` +
          `(скалярное ${скалярное2.toFixed(4)}): соглашение о том, куда смотрит модель, нарушено`,
      );
    }
  });

  it('камера всё так же смотрит на самого игрока', () => {
    // Если камера перестанет смотреть на игрока, формулы выше станут правдой только
    // формально: позиция останется, а лицо в кадре будет уже не то.
    const src = world3dSource();
    must(
      /this\.camera\.lookAt\(me\.pos\.x, [^,]+, me\.pos\.z\)/.test(src),
      'камера больше не смотрит на игрока: поворот персонажа по yaw потерял смысл',
    );
  });

  it('поворот игрока не зависит от того, идёт он или стоит', () => {
    const src = world3dSource();
    must(
      /if \(isMe\) \{\s*\n\s*const want = this\.yaw;/.test(src),
      'поворот игрока больше не безусловный: стоящий персонаж будет смотреть ' +
        'по последнему направлению шага, и ровно в покое, когда виден торс, ' +
        'спина окажется к камере',
    );
    must(
      !/isMe && moving\)/.test(src),
      'поворот игрока снова привязан к движению: стоя смотришь на спину',
    );
  });

  it('доворот плавный, а не мгновенный и не забытый', () => {
    const src = world3dSource();
    must(
      /const FACE_TURN_RATE = (\d+(?:\.\d+)?);/.test(src),
      'нет константы FACE_TURN_RATE: скорость доворота задана числом в коде, ' +
        'и её нельзя ни найти, ни подкрутить',
    );
    const скорость = Number(/const FACE_TURN_RATE = (\d+(?:\.\d+)?);/.exec(src)?.[1]);
    must(
      скорость > 0 && скорость <= 60,
      `скорость доворота ${скорость} в секунду: при нуле персонаж не повернётся ` +
        'никогда, а при большом значении дёрнется мгновенно',
    );
    must(
      /dt \* FACE_TURN_RATE/.test(src),
      'константа объявлена, но не используется в довороте',
    );
  });

  it('чужой персонаж остаётся развёрнутым по движению', () => {
    // У каждого своя камера. Если развернуть к моей всех, чужой персонаж поедет боком.
    const src = world3dSource();
    must(
      /const want = Math\.atan2\(dx, dz\)/.test(src),
      'поворот монстров по направлению движения пропал: это другая величина, ' +
        'чем поворот игрока, и её нельзя заменять',
    );
    must(
      /isMe\) \{\s*\n\s*const want = this\.yaw;/.test(src),
      'поворот по yaw вышел из-под условия «это я»: он начнёт крутить и чужих',
    );
  });
});

describe('Оттенок доспеха различает классы', () => {
  function tintTable(): { cls: string; hex: string }[] {
    const src = realRigSource();
    const start = src.indexOf('MODEL_TINT');
    if (start < 0) return [];
    const block2 = src.slice(start, src.indexOf('};', start));
    return [...block2.matchAll(/(\w+):\s*0x([0-9a-fA-F]{6})/g)].map((m) => ({
      cls: m[1],
      hex: m[2].toLowerCase(),
    }));
  }

  it('у каждого класса свой оттенок, и все они разные', () => {
    const rows = tintTable();
    must(rows.length === CLASSES.length, `v MODEL_TINT ${rows.length} zapisey, a klassov ${CLASSES.length}`);
    for (const cls of CLASSES) {
      must(
        rows.some((r) => r.cls === cls),
        `klassa ${cls} net v MODEL_TINT: on budet vyglydet kak vse ostalnye` +
          '. Pyat klassov delyat odin dospeh, i razlichaet ih tolkoottenok',
      );
    }
    const uniq = new Set(rows.map((r) => r.hex));
    must(
      uniq.size === rows.length,
      `otтенков ${uniq.size} na ${rows.length} klassov: vse klassy odinakvye` +
        '. Osensiblyatelnost ne zakryvaet raznicu, a odin dospeh na pyat klassov ' +
        'dolzhen razlichatsya chem-to besides',
    );
  });

  it('конструктор берёт оттенок из своего параметра', () => {
    // Без этой проверки оттенок можно было бы тихо отключить в конструкторе: таблица
    // осталась бы полной, домножение на месте, а все классы стали бы одинаковыми.
    const src = realRigSource();
    must(
      /this\.классТинт = оттенок === null/.test(src),
      'konstruktor ne beret oттенок iz svoyеgo parametra: ' +
        'otтенок klassа vsegda budet belym, i vse pyat klassov stanut odinakovymi',
    );
    must(
      /MODEL_TINT\[charClass\]/.test(src),
      'zagruzchik ne peredaet oттенок klassа v konstruktor: ' +
        'tablica est, no nikto ee ne primenяet',
    );
  });
  it('оттенок домножается на цвет брони, а не заменяет его', () => {
    const src = realRigSource();
    must(
      /multiply\(this\.броняТинт\)\.multiply\(this\.классТинт\)/.test(src),
      'cvet dospehа ne umnozhaetsya na otтенок klassa: ' +
        'nadetyi dospeh со svoei redkostyu zatret by otтенok, i klassy stali by odinakovymi',
    );
    must(
      /setHex\(исходный\)/.test(src),
      'cvet schitaetsya ot исходnogo: иначе смена otтенка копилась бы raz za razom ' +
        'и dospeh temnel s kazhdoi smenoi',
    );
  });
});

describe('Подключённые состояния ведут к существующим клипам', () => {
  it('каждый клип, названный в realRig.ts, лежит на диске', () => {
    // Состояние, которому назначен несуществующий клип, выглядит в игре как «персонаж
    // замер», и нигде не падает: загрузчик молча отдаёт null, а хочу() пропускает
    // переключение. Проверка по коду ловит это до игры.
    const src = realRigSource();
    const имена = [...src.matchAll(/'([a-z]+(?:-[a-z0-9]+)+)'/g)].map((m) => m[1]);
    const клипы = new Set(manifest.clips.map((c) => c.name));
    // Из имён берём только те, что похожи на клипы: в файле есть и путь к папке.
    const кандидаты = имена.filter((n) => клипы.has(n) || /^(walk|run|crouch|swim|block|death|dodge|sit|cheer|hurt|knife|jumping|standing|start|stop|sword)-/.test(n));
    const наДиске = [...new Set(кандидаты.filter((n) => !клипы.has(n)))];
    must(
      наДиске.length === 0,
      `realRig.ts ссылается на клипы, которых нет в models: ${наДиске.join(', ')}. Состояние будет замирать на месте`,
    );
  });

  it('смерть, блок, плавание и уклонение подключены, а не заменены заглушкой', () => {
    // Заглушки стояли там, где клипов не было: смерть играла падением, блок держал
    // текущий клип, плавание стояло на месте. Смысл проверки — не дать вернуться туда.
    const src = realRigSource();
    must(/const CLIP_DEATH = 'death-fall-forward'/.test(src), 'смерть не подключена');
    must(/if \(p\.block\) \{ this\.хочу\(CLIP_BLOCK\)/.test(src), 'блок не подключён');
    must(
      /p\.moving \? CLIP_SWIM : CLIP_SWIM_IDLE/.test(src),
      'плавание не различает движение и покой',
    );
    must(/triggerDodge\(direction/.test(src), 'уклонение не проигрывается');
  });

  it('смерть и уклонение играются один раз, а не зациклены', () => {
    // Смерть в цикле — это мигающий труп: падение начинается заново каждые несколько
    // секунд. Поэтому одноразовые клипы помечены отдельно.
    const src = realRigSource();
    must(/const ОДИН_РАЗ = new Set<string>\(\[/.test(src), 'нет списка одноразовых клипов');
    must(/CLIP_DEATH,/.test(src), 'смерть не помечена как одноразовая');
    must(/\.\.\.Object\.values\(CLIP_DODGE\)/.test(src), 'перекат не помечен как одноразовый');
    must(/clampWhenFinished = true/.test(src), 'одноразовый клип не замирает на последнем кадре');
    // Проверяем, что играет ИМЕННО клип смерти. Проверка на отсутствие старой строки
    // пропускала подмену на любую другую константу: ломка «смерть -> прыжок» прошла
    // на зелёном.
    must(
      /if \(p\.dead\) \{ this\.хочу\(CLIP_DEATH\)/.test(src),
      'смерть играет не клип смерти, а что-то другое: персонаж будет падать заново или замирать стоя',
    );
  });

  it('у интерфейса Rig есть необязательный крючок уклонения, и он зовётся', () => {
    // Необязательный, потому что четыре сборки из палочек его не умеют.
    must(
      /triggerDodge\?: \(direction: DodgeDirection\) => void;/.test(readText(join(ROOT, 'client/src/app/game3d/rig.ts'))),
      'в интерфейсе Rig нет triggerDodge: настоящая модель не сможет показать перекат',
    );
    const world = world3dSource();
    must(/rig\.triggerDodge\?\./.test(world), 'уклонение не запускает анимацию');
    must(
      /сторона = ix < 0 \? 'left' : 'right'/.test(world) && /сторона = iz < 0 \? 'back' : 'forward'/.test(world),
      'сторона уклонения не определяется по нажатым клавишам: перекат всегда будет одним и тем же',
    );
  });
});

describe('Класс игрока ведёт к существующей модели', () => {
  it('все пять классов из rig.ts имеют свою модель', () => {
    const src = realRigSource();
    for (const cls of CLASSES) {
      must(
        src.includes(`${cls}: `),
        `klassa ${cls} net v karte modeley realRig.ts: igrok etogo klassa ostanetsya na palochkah`,
      );
    }
    // Только блок PLAYER_MODEL: в файле есть ещё MODEL_TINT с такими же строками
    // "класс: ", и без среза каждая строка считалась бы дважды.
    const blockStart = src.indexOf('PLAYER_MODEL');
    const block = src.slice(blockStart, src.indexOf('};', blockStart));
    const entries = block.split('\n').map((line) => line.trim())
      .filter((line) => CLASSES.some((cls) => line.startsWith(`${cls}: `)));
    must(
      entries.length === CLASSES.length,
      `v karte modeley ${entries.length} zapisey, a klassov ${CLASSES.length}: libo zabyt klass, libo model dostalas nikomu`,
    );
  });

  it('файл каждой модели из карты реально лежит на диске', () => {
    const src = realRigSource();
    const start = src.indexOf('PLAYER_MODEL');
    const block = src.slice(start, src.indexOf('};', start));
    const files = [...block.matchAll(/:\s*'([a-z-]+)',/g)].map((m) => m[1] + '.glb');
    must(files.length === CLASSES.length, `v karte ${files.length} zapisey klassov, a klassov ${CLASSES.length}`);
    // Один доспех на пять классов, поэтому сверяем не число файлов, а то, что каждый
    // класс ведёт в файл, который есть и в манифесте, и на диске. Манифест пишется по
    // диску, карта ведётся руками: их расхождение и есть признак устаревшего манифеста.
    const вМанифесте = new Set(manifest.characters.map((c) => shortName(c.file)));
    for (const file of files) {
      must(
        вМанифесте.has(file),
        `karta ssylaetsya na ${file}, a v manifeste takogo net: klass ostanetsya na palochkach, manifest ustarel`,
      );
      must(
        existsSync(join(MODELS, file)),
        `karta ssylaetsya na ${file}, a takogo fayla net: igrok etogo klassa ostanetsya na palochkah`,
      );
    }
  });
});

/**
 * Мировые позиции костей: перевод узла в glTF задан относительно родителя, поэтому
 * спускаемся по дереву от корня сцены.
 */
function worldPositions(gltf: GLTF): Map<string, number[]> {
  const nodes = gltf.nodes ?? [];
  const parent = new Array<number>(nodes.length).fill(-1);
  for (let i = 0; i < nodes.length; i++) {
    for (const child of nodes[i].children ?? []) parent[child] = i;
  }
  const cache = new Map<number, number[]>();
  function world(i: number): number[] {
    const hit = cache.get(i);
    if (hit) return hit;
    const t = nodes[i].translation ?? [0, 0, 0];
    const p = parent[i];
    const base = p < 0 ? [0, 0, 0] : world(p);
    const out = [base[0] + t[0], base[1] + t[1], base[2] + t[2]];
    cache.set(i, out);
    return out;
  }
  const out = new Map<string, number[]>();
  for (let i = 0; i < nodes.length; i++) {
    const name = nodes[i].name ?? '';
    if (name.startsWith('mixamorig:')) out.set(name, world(i));
  }
  return out;
}

/**
 * Длины костей: от начала кости до начала первой кости-потомка.
 *
 * Именно эта величина, а не head->tail: между началом и концом кости может лежать
 * промежуточная кость, и разница между двумя определениями измерялась в 3,4 %.
 */
function boneChainLengths(gltf: GLTF): Map<string, number> {
  const nodes = gltf.nodes ?? [];
  const world = worldPositions(gltf);
  const out = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) {
    const name = nodes[i].name ?? '';
    if (!name.startsWith('mixamorig:')) continue;
    const from = world.get(name);
    if (!from) continue;
    for (const child of nodes[i].children ?? []) {
      const childName = nodes[child]?.name ?? '';
      if (childName.includes('End')) continue;
      const to = world.get(childName);
      if (!to) break;
      out.set(name, Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]));
      break;
    }
  }
  return out;
}

describe('Скелет клипа совпадает со скелетом персонажа', () => {
  // Высота, к которой игра приводит любую модель: см. TARGET_HEIGHT в realRig.ts.
  const TARGET = 1.9;
  // Допуск 15 %: модели разного происхождения, и разброс между персонажами сам по
  // себе достигает 8 % (1.042..1.122). Вдвое больше скелета — это 100 %, и такое
  // проверка ловит.

  type Bones = { torso: number; rootScale: number; height: number | null };

  function bones(gltf: GLTF): Bones | null {
    const hips = (gltf.nodes ?? []).find((n) => n.name === 'mixamorig:Hips')?.translation;
    const head = (gltf.nodes ?? []).find((n) => n.name === 'mixamorig:Head')?.translation;
    if (!hips || !head) return null;
    const rootIndex = (gltf.scenes?.[0]?.nodes ?? [])[0];
    const scale = (rootIndex === undefined ? undefined : (gltf.nodes ?? [])[rootIndex ?? -1]?.scale) ?? [1, 1, 1];
    let min = Infinity;
    let max = -Infinity;
    for (const mesh of gltf.meshes ?? []) {
      for (const prim of mesh.primitives ?? []) {
        const acc = (gltf.accessors ?? [])[prim.attributes.POSITION];
        if (!acc?.min || !acc.max) continue;
        min = Math.min(min, acc.min[1]);
        max = Math.max(max, acc.max[1]);
      }
    }
    return {
      torso: Math.hypot(head[0] - hips[0], head[1] - hips[1], head[2] - hips[2]),
      rootScale: (Math.abs(scale[0]) + Math.abs(scale[1]) + Math.abs(scale[2])) / 3,
      height: max > min ? max - min : null,
    };
  }

  function characterNorm(): number[] {
    const out: number[] = [];
    for (const person of manifest.characters) {
      const b = bones(readGLB(shortName(person.file)));
      if (!b || !b.height) continue;
      out.push((b.torso * b.rootScale * TARGET) / b.height);
    }
    return out;
  }

  /** Отношение длин общих костей клипа к персонажу: 1 - значит скелеты одного размера. */
  function clipBoneRatio(clipFile: string, reference: Map<string, number>): number | null {
    const lengths = boneChainLengths(readGLB(clipFile));
    let sum = 0;
    let count = 0;
    for (const [name, length] of lengths) {
      const want = reference.get(name);
      if (!want || want <= 1e-6 || length <= 1e-6) continue;
      sum += length / want;
      count++;
    }
    return count >= 20 ? sum / count : null;
  }

  function referenceSkeleton(): Map<string, number> | null {
    const person = manifest.characters[0];
    return person ? boneChainLengths(readGLB(shortName(person.file))) : null;
  }

  it('у персонажей скелет одного размера после нормализации в игре', () => {
    const norms = characterNorm();
    must(norms.length >= 1, 'v manifeste net personazha: skeleta s chem sravnivat ne s chem');
    const spread = Math.max(...norms) / Math.min(...norms);
    must(
      spread < 1.2,
      `skelety personazhey raznye v ${spread.toFixed(2)} raza posle privedeniya k odnoy vysote: igrok budet menyat rost pri smene klassa`,
    );
  });

  it('скелет клипа равен скелету персонажа, а не вдвое больше', () => {
    const reference = referenceSkeleton();
    must(reference !== null, 'net personazha: skeleta s chem sravnivat ne s chem');
    const ref = reference as Map<string, number>;
    must(ref.size >= 20, `u personazha izmerimo ${ref.size} kostey, a nuzhno 20: ne s chem sravnivat`);
    const bad: string[] = [];
    for (const clip of manifest.clips) {
      const ratio = clipBoneRatio(shortName(clip.file), ref);
      must(ratio !== null, `klip ${clip.name}: ne s chem sravnivat, kostej net`);
      const value = ratio as number;
      if (Math.abs(value - 1) > 0.06) bad.push(`${clip.name}: x${value.toFixed(2)}`);
    }
    must(
      bad.length === 0,
      `klipov s chuzhim skeletom: ${bad.length} - ${bad.slice(0, 4).join(', ')}. ` +
        'Kost u raznyh personazhey Mixamo nemnogo raznye, i takoe rashozhdenie mozhno, ' +
        'no stolko rasxozhdenie bylo by oshibkoy podgonki',
    );
  });

  it('у клипа нет неучтённого масштаба: он впечатан в кости', () => {
    // Масштаб корня, оставленный на узле, - это вторая система единиц в файле.
    // После впечатывания экспорт опускает поле целиком, поэтому «поля нет» и
    // «масштаб равен единице» - одно и то же состояние.
    const clip = readGLB(shortName(manifest.clips[0].file));
    const rootIndex = (clip.scenes?.[0]?.nodes ?? [])[0];
    must(rootIndex !== undefined, 'u klipa net kornya sceny: masshtab nechego menyat');
    const scale = (clip.nodes ?? [])[rootIndex]?.scale;
    const value = scale
      ? (Math.abs(scale[0]) + Math.abs(scale[1]) + Math.abs(scale[2])) / 3
      : 1;
    must(
      Math.abs(value - 1) <= 0.0005,
      `u klipa masshtab kornya ${value}: on ne vpechatan v kosti, i fайл derzhit dve sistemy edinits. three.js etot masshtab uchityvaet`,
    );
  });
});

describe('Запасной путь не потерян', () => {
  it('процедурный риг создаётся первым, а настоящая модель приходит позже', () => {
    // Обратный порядок означал бы пустоту на месте игрока всё время загрузки.
    const src = world3dSource();
    const made = src.indexOf('buildPlayerRig(p.charClass)');
    // Ищем именно ВЫЗОВ подмены, а не любое упоминание имени: объявление метода
    // стоит выше по файлу, и сравнение по нему выходило бы неверным.
    const call = src.indexOf('this.upgradeToRealModel(');
    const def = src.indexOf('private upgradeToRealModel(');
    must(made > 0, 'procedurny rig igroka bolshe ne cozdaetsya');
    must(def > 0, 'metoda podmeny net: model zagruzitsya, no nikogda ne podstanetsya');
    must(call > 0, 'podmena nigde ne vzyvaetsya');
    must(
      call > made,
      'podmena zaprashivaetsya ranshe, chem cozdan procedurny rig: igrok budet pustym, poka fayl gruzitsya',
    );
    must(
      /this\.scene\.add\(b\.rig\.group\)/.test(src),
      'procedurny rig ne dobavlyaetsya v scenu do podmeny',
    );
  });

  it('подмена сохраняет позицию, поворот и надетое снаряжение', () => {
    const src = world3dSource();
    must(
      /real\.group\.position\.copy/.test(src),
      'poziciya pri podmene ne perenitsya: personazh okazhetsya v nachale koordinat',
    );
    must(
      /real\.group\.rotation\.copy/.test(src),
      'povorot pri podmene ne perenitsya: personazh budet smotret ne tuda',
    );
    must(
      /real\.equipWeapon/.test(src) && /real\.equipShield/.test(src),
      'snaryazhenie ne perenitsya na nastoyashchuyu model: igrok na sekundu ostanetsya bez oruzhiya',
    );
    must(
      /прежний\.dispose\(\)/.test(src),
      'staryi rig ne osvobozhdaetsya pri podmene: ego geometriya ostanetsya v pamyati navsegda',
    );
  });

  it('масштаб берётся из габаритов модели, а не из константы на модель', () => {
    // Modeli raznogo proiskhozhdeniya: u chetyrykh vysota 1.76-1.78, u
    // guard-qizilbash 3.78. Konstanta na kazhduyu model razezhalas by pri pervoy
    // zamene fayla.
    const src = realRigSource();
    must(
      /new THREE\.Box3\(\)\.setFromObject/.test(src),
      'gabarity modeli ne izmeryayutsya: rost personazha pridetsya ugadyvat',
    );
    must(
      /TARGET_HEIGHT \/ высота/.test(src),
      'model ne privoditsya k obshche vysote: strazh okazhetsya vdvoe vyshe ostalnyh',
    );
  });

  it('отказ загрузки не ломает игру, а оставляет палочки', () => {
    const src = realRigSource();
    must(
      /if \(!сцена \|\| !idle\) return null;/.test(src),
      'podmena proiskhodit dazhe bez pokoya skeleta: igrok uvidit model s rasstavlennymi rukami',
    );
    must(
      (src.match(/\(\) => готово\(null\)/g) ?? []).length >= 2,
      'obrabotchik oshibki est ne u oboih zagruzchikov: odin iz nih obryvaet igru pri nedostupnom fayle. Soderzhashchego nyaledo dva — u sceny i u klipov',
    );
    must(
      /if \(cur && !real\) cur\.realModelTried = false;/.test(world3dSource()),
      'posle neudachnoi popytki flag ne sbrosaetsya: povtornaya popytka ne proizoydet',
    );
  });
});