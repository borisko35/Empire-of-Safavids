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
type Anim = { channels: { target: { node: number } }[] };
type GLTF = {
  nodes?: { name?: string }[];
  meshes?: { primitives?: Prim[] }[];
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
  it('пять персонажей и восемнадцать клипов лежат в репозитории', () => {
    must(
      manifest.characters.length === CLASSES.length,
      `v manifeste ${manifest.characters.length} personazhey, a klassov igroka ${CLASSES.length}`,
    );
    must(
      manifest.clips.length === 18,
      `v manifeste ${manifest.clips.length} klipov, a v papke Animation bylo 18 faylov animacii`,
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

describe('Класс игрока ведёт к существующей модели', () => {
  it('все пять классов из rig.ts имеют свою модель', () => {
    const src = realRigSource();
    for (const cls of CLASSES) {
      must(
        src.includes(`${cls}: `),
        `klassa ${cls} net v karte modeley realRig.ts: igrok etogo klassa ostanetsya na palochkah`,
      );
    }
    const entries = src
      .split('\n')
      .map((line) => line.trim())
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
    const files = [...block.matchAll(/:\s*'([a-z-]+)',/g)].map((m) => `${m[1]}.glb`);
    must(files.length === CLASSES.length, `v karte ${files.length} imen faylov, a klassov ${CLASSES.length}`);
    for (const file of files) {
      must(
        existsSync(join(MODELS, file)),
        `karta ssylaetsya na ${file}, a takogo fayla net: igrok etogo klassa ostanetsya na palochkah`,
      );
    }
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