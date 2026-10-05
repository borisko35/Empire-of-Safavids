// Декор из готовых моделей: акведук деревни.
//
// Первый пакет из папки Assets: разрушенная аркада из пяти сегментов к
// востоку от лесной деревни (строка списка владельца требует у деревни
// акведуки). Конвейер: FBX из архива → Blender (децимация 3.7 млн → 66к,
// Draco, JPEG) → public/models/decor → сцена с коллайдерами.
//
// ЧТО ПРОВЕРЯЕТСЯ. Файл лежит в источнике сборки и совпадает с манифестом;
// сцена его грузит (путь, Draco, коллайдеры); аркада стоит у деревни, на
// суше, вне домов; сегментов несколько (аркада, а не камень).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isWater } from '../../../shared/water';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const ТЕРРЕЙН = читать('client/src/app/game3d/terrain.ts');
const МАНИФЕСТ = JSON.parse(читать('client/src/app/public/models/manifest.json')) as {
  decor?: { file: string; name: string; bytes: number }[];
};

function деревня(): { x: number; z: number } {
  const м = /export const VILLAGE = \{ x: (-?\d+), z: (-?\d+), radius: (\d+)/.exec(ТЕРРЕЙН);
  must(м !== null, 'не нашли VILLAGE в terrain.ts: деревня переехала, проверка слепа');
  return { x: Number(м![1]), z: Number(м![2]) };
}

describe('Акведук деревни: модель на месте и в сцене', () => {
  it('файл декора в источнике сборки и совпадает с манифестом', () => {
    must(
      МАНИФЕСТ.decor !== undefined && МАНИФЕСТ.decor.length >= 1,
      'в манифесте нет раздела decor: файл декора никто не сверяет с диском',
    );
    for (const запись of МАНИФЕСТ.decor!) {
      const путь = join(корень, 'client/src/app/public', запись.file);
      must(existsSync(путь), `нет файла декора ${запись.file}: сцена останется без аркады`);
      must(
        statSync(путь).size === запись.bytes,
        `${запись.file}: на диске ${statSync(путь).size}, в манифесте ${запись.bytes}`
      );
    }
  });

  it('модель сжата и лёгкая, а не сырой FBX', () => {
    // 3.7 млн треугольников исходника в веб тащить нельзя: децимация и Draco.
    const путь = join(корень, 'client/src/app/public/models/decor/aqueduct-seg.glb');
    must(existsSync(путь), 'файла акведука нет: проверять нечего');
    const buf = readFileSync(путь);
    const json = JSON.parse(buf.slice(20, 20 + buf.readUInt32LE(12)).toString('utf-8')) as {
      extensionsUsed?: string[];
    };
    must(
      (json.extensionsUsed ?? []).includes('KHR_draco_mesh_compression'),
      'акведук без Draco: геометрия весит как сырая'
    );
    must(
      buf.length < 10 * 1024 * 1024,
      `акведук весит ${(buf.length / 1048576).toFixed(1)} МБ: в веб столько не возят`
    );
  });

  it('сцена грузит акведук с Draco и коллайдерами', () => {
    must(
      /const AQUEDUCT_MODEL = 'decor\/aqueduct-seg\.glb';/.test(ТЕРРЕЙН),
      'модель акведука не подключена к сцене: файл лежит, а аркады нет'
    );
    must(
      /new DRACOLoader\(\)/.test(ТЕРРЕЙН) && /setDecoderPath\('\/game\/draco\/'\)/.test(ТЕРРЕЙН),
      'загрузчик декора без Draco: сжатая геометрия не разберётся'
    );
    must(
      /export function buildAqueduct\(scene: THREE\.Scene\): void/.test(ТЕРРЕЙН),
      'нет построителя акведука: сегментам негде вставать'
    );
    must(
      /addCollider\(px, pz, 0\.9\);/.test(ТЕРРЕЙН),
      'у сегментов нет коллайдеров: сквозь аркаду ходят пешком'
    );
    must(
      /buildAqueduct\(this\.scene\);/.test(читать('client/src/app/game3d/world3d.ts')),
      'построитель не вызван из мира: код есть, а аркады нет'
    );
  });

  it('аркада стоит у деревни, на суше и вне домов', () => {
    // Площадка мерялась: восток, сухо, размах 0.2–0.3. Проверка повторяет
    // замер по тем же функциям воды, а не по памяти автора.
    const д = деревня();
    const м = /export const AQUEDUCT = \{ x: VILLAGE\.x \+ (\d+), z: VILLAGE\.z ([+-]) (\d+), count: (\d+), step: ([\d.]+) \};/.exec(
      ТЕРРЕЙН
    );
    must(м !== null, 'константа AQUEDUCT не найдена: аркада едет неизвестно куда');
    const dx = Number(м![1]);
    const dz = (м![2] === '-' ? -1 : 1) * Number(м![3]);
    const count = Number(м![4]);
    const step = Number(м![5]);
    must(count >= 3, `сегментов ${count}: один камень — не аркада`);
    for (let i = 0; i < count; i++) {
      const px = д.x + dx + (i - (count - 1) / 2) * step;
      const pz = д.z + dz;
      must(
        !isWater(px, pz),
        `сегмент ${i} в (${px}, ${pz}) стоит в воде: аркада утонула`
      );
      const отДеревни = Math.hypot(px - д.x, pz - д.z);
      must(
        отДеревни >= 14 && отДеревни <= 40,
        `сегмент ${i} в ${Math.round(отДеревни)} от центра деревни: внутри домов (кольцо 10) или в чистом поле`
      );
    }
  });
});
