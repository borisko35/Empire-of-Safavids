// Биомная геометрия: рельеф меняет геймплей.
//
 // ЧТО ПРОВЕРЯЕМ. В terrainHeight добавлены модификаторы по маскам биомов:
 //   - пустыня: скальные выступы (outcrop) и сухие русла (wadi)
 //   - лес: коревосточные гряды (roots) и поляны (clearing)
 //   - горы: перевалы (pass), осыпи (scree), обрывы (cliff)
 //   - поле: катистые холмы (rolling) и валуны (boulders)
 //   - берега воды: иловатость (shore) и камыши (reeds)
 //
 // Проверяем, что код этих модификаторов присутствует и использует
 // соответствующие маски (dm, fm, ridge, waterMask).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function должен(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

const ТЕРРЕЙН = читать('client/src/app/game3d/terrain.ts');
// Убираем комментарии, чтобы не ловить их вместо кода
const КОД = ТЕРРЕЙН.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('Биомная геометрия (§319)', () => {
  // Маски биомов должны вычисляться внутри terrainHeight
  it('desertMask и forestMask вычисляются в terrainHeight', () => {
    const fnStart = КОД.indexOf('export function terrainHeight');
    const fnEnd = КОД.indexOf('export function meshHeight');
    const тело = КОД.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 15000);
    должен(/const dm = desertMask\(x, z\)/.test(тело), 'desertMask не вычисляется в terrainHeight');
    должен(/const fm = forestMask\(x, z\)/.test(тело), 'forestMask не вычисляется в terrainHeight');
  });

  // Пустыня: outcrop (выступы) и wadi (сухие русла)
  it('пустыня: outcrop и wadi используют desertMask', () => {
    const fnStart = КОД.indexOf('export function terrainHeight');
    const fnEnd = КОД.indexOf('export function meshHeight');
    const тело = КОД.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 15000);
    // Блок пустыни: if (dm > 0.3) { outcrop ... wadi ... }
    должен(/if \(dm > 0\.3\)/.test(тело), 'нет проверки dm > 0.3 для пустыни');
    должен(/outcrop/.test(тело), 'нет outcrop (скальные выступы)');
    должен(/wadi/.test(тело), 'нет wadi (сухие русла)');
    проверкаDM(тело, 'outcrop');
    проверкаDM(тело, 'wadi');
  });

  // Лес: roots (коревосточные гряды) и clearing (поляны)
  it('лес: roots и clearing используют forestMask', () => {
    const fnStart = КОД.indexOf('export function terrainHeight');
    const fnEnd = КОД.indexOf('export function meshHeight');
    const тело = КОД.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 15000);
    должны(/if \(fm > 0\.25\)/.test(тело), 'нет проверки fm > 0.25 для леса');
    должны(/roots/.test(тело), 'нет roots (коревосточные гряды)');
    должны(/clearing/.test(тело), 'нет clearing (поляны)');
    проверкаFM(тело, 'roots');
    проверкаFM(тело, 'clearing');
  });

  // Горы: pass (перевалы), scree (осыпи), cliff (обрывы)
  it('горы: pass, scree, cliff используют ridgeMask', () => {
    const fnStart = КОД.indexOf('export function terrainHeight');
    const fnEnd = КОД.indexOf('export function meshHeight');
    const тело = КОД.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 15000);
    должны(/if \(ridge > 0\.35\)/.test(тело), 'нет проверки ridge > 0.35 для гор');
    должны(/pass/.test(тело), 'нет pass (перевалы)');
    должны(/scree/.test(тело), 'нет scree (осыпи)');
    должны(/cliff/.test(тело), 'нет cliff (обрывы)');
    проверкаRidge(тело, 'pass');
    проверкаRidge(тело, 'scree');
    проверкаRidge(тело, 'cliff');
  });

  // Поле: rolling (катистые холмы) и boulders (валуны)
  it('поле: rolling и boulders используют fieldMask', () => {
    const fnStart = КОД.indexOf('export function terrainHeight');
    const fnEnd = КОД.indexOf('export function meshHeight');
    const тело = КОД.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 15000);
    должны(/fieldMask/.test(тело), 'нет fieldMask для поля');
    должны(/rolling/.test(тело), 'нет rolling (катистые холмы)');
    должны(/boulders/.test(тело), 'нет boulders (валуны)');
  });

  // Берега воды: shore (иловатость) и reeds (камыши)
  it('берега воды: shore и reeds используют waterMask', () => {
    const fnStart = КОД.indexOf('export function terrainHeight');
    const fnEnd = КОД.indexOf('export function meshHeight');
    const тело = КОД.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 15000);
    // waterMask вычисляется как w
    должны(/const w = waterMask\(x, z\)/.test(тело), 'waterMask не вычисляется для берегов');
    должны(/if \(w > 0\.05 && w < 0\.95\)/.test(тело), 'нет проверки береговой полосы');
    должны(/shore/.test(тело), 'нет shore (прибрежная иловатость)');
    должны(/reeds/.test(тело), 'нет reeds (камыши)');
  });

  // Порядок: биомные модификаторы ПОСЛЕ ровнялок, ДО воды
  it('биомная геометрия стоит после flatten и до waterMask', () => {
    const fnStart = КОД.indexOf('export function terrainHeight');
    const fnEnd = КОД.indexOf('export function meshHeight');
    const тело = КОД.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 15000);
    // Ищем маркеры, которые выживают после удаления комментариев:
    // - последняя flatten (SIMURGH_TEMPLE)
    // - начало биомного блока: if (dm > 0.3)
    // - начало водного блока: const w = waterMask
    const idxBiome = тело.indexOf('if (dm > 0.3)');
    const idxFlatten = тело.lastIndexOf('flatten(h, x, z, SIMURGH_TEMPLE');
    const idxWater = тело.indexOf('const w = waterMask');
    должны(idxBiome > idxFlatten, `биомы (dm > 0.3) должны быть ПОСЛЕ последней ровнялки: biome=${idxBiome}, flatten=${idxFlatten}`);
    должны(idxWater > idxBiome, `биомы должны быть ДО воды: biome=${idxBiome}, water=${idxWater}`);
  });
});

function должны(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

function проверкаDM(тело: string, ключ: string): void {
  const блок = /if \(dm > 0\.3\) \{[\s\S]*?\}/.exec(тело);
  должны(блок, `нет блока пустыни для ${ключ}`);
  должны(new RegExp(`${ключ}.*\\* dm`).test(блок![0]), `${ключ} не умножен на dm`);
}

function проверкаFM(тело: string, ключ: string): void {
  const блок = /if \(fm > 0\.25\) \{[\s\S]*?\}/.exec(тело);
  должны(блок, `нет блока леса для ${ключ}`);
  должны(new RegExp(`${ключ}.*\\* fm`).test(блок![0]), `${ключ} не умножен на fm`);
}

function проверкаRidge(тело: string, ключ: string): void {
  const блок = /if \(ridge > 0\.35\) \{[\s\S]*?\}/.exec(тело);
  должны(блок, `нет блока гор для ${ключ}`);
  должны(new RegExp(`${ключ}.*\\* ridge`).test(блок![0]), `${ключ} не умножен на ridge`);
}