// §317. Поверхности: PBR-материалы, загрузка текстур.
//
// ЧТО ПРОВЕРЯЕТСЯ. Материалы PBR (applySurface, surfaceMaterial);
// загрузка карт (diff/nor/rough); метрический UV через surfaceTile.
// Вода, небо, лодки, снег, купола — в других файлах.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function должен(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

function должны(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

const ПОВЕРХНОСТИ = читать('client/src/app/game3d/surfaces.ts');

describe('§317. PBR-поверхности', () => {
  it('экспортирует тип SurfaceId и наборы', () => {
    должны(/export type SurfaceId/.test(ПОВЕРХНОСТИ), 'нет типа SurfaceId');
    должны(/const НАБОРЫ: Record<SurfaceId/.test(ПОВЕРХНОСТИ), 'нет НАБОРЫ');
    должны(/'sand_01'/.test(ПОВЕРХНОСТИ), 'нет sand_01');
    должны(/'patterned_cobblestone'/.test(ПОВЕРХНОСТИ), 'нет patterned_cobblestone');
    должны(/'clay_roof_tiles'/.test(ПОВЕРХНОСТИ), 'нет clay_roof_tiles');
  });

  it('экспортирует surfaceTile для метрического UV', () => {
    должны(/export function surfaceTile/.test(ПОВЕРХНОСТИ), 'нет surfaceTile');
    должны(/НАБОРЫ\[id\]\.tile/.test(ПОВЕРХНОСТИ), 'surfaceTile не использует НАБОРЫ');
  });

  it('экспортирует applySurface и surfaceMaterial', () => {
    должны(/export function applySurface/.test(ПОВЕРХНОСТИ), 'нет applySurface');
    должны(/export function surfaceMaterial/.test(ПОВЕРХНОСТИ), 'нет surfaceMaterial');
  });

  it('applySurface загружает diff/nor/rough и ставит на материал', () => {
    должны(/Promise\.all\(\[diff\.ready, nor\.ready, rough\.ready\]/.test(ПОВЕРХНОСТИ),
      'applySurface не ждёт загрузки карт');
    должны(/материал\.map = клон/.test(ПОВЕРХНОСТИ), 'не ставит карту цвета');
    должны(/материал\.normalMap = клон/.test(ПОВЕРХНОСТИ), 'не ставит нормаль');
    должны(/материал\.roughnessMap = клон/.test(ПОВЕРХНОСТИ), 'не ставит шероховатость');
  });

  it('surfaceMaterial создаёт MeshStandardMaterial и вызывает applySurface', () => {
    должны(/new THREE\.MeshStandardMaterial/.test(ПОВЕРХНОСТИ), 'нет MeshStandardMaterial');
    должны(/applySurface\(материал, id, opts\)/.test(ПОВЕРХНОСТИ), 'surfaceMaterial не вызывает applySurface');
  });

  it('экспортирует setSurfaceAnisotropy', () => {
    должны(/export function setSurfaceAnisotropy/.test(ПОВЕРХНОСТИ), 'нет setSurfaceAnisotropy');
  });

  it('использует RepeatWrapping и анизотропию для текстур', () => {
    должны(/RepeatWrapping/.test(ПОВЕРХНОСТИ), 'нет RepeatWrapping');
    должны(/anisotropy/.test(ПОВЕРХНОСТИ), 'нет anisotropy');
  });
});

// Экспортируем функции для подавления предупреждений о неиспользуемых
export { должен, должны };