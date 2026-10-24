// Лагерь.
//
// ЧТО БЫЛО (22 октября 2026, §289). Шатры — полотнище со скатами, частокол —
// 26 кольев и два ряда перекладин, костёр — цилиндр с додекаэдрами.
//
// ЧТО ТЕПЕРЬ (§326). Шатёр остаётся своим: это работа руками, и она хорошая.
// Частокол — готовые секции палисада (medieval-wooden-palisade), костёр —
// готовая модель bonfire (Quaternius), пламя остаётся своим: оно носитель
// света и анимации огня.
//
// ЧТО ПРОВЕРЯЕТСЯ. Шатёр не деградировал; частокол и костёр ставятся
// готовыми моделями; пламя сохранило имя, по которому мир его анимирует.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function должен(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const МАНИФЕСТ = JSON.parse(читать('client/src/app/public/models/manifest.json')) as {
  decor?: { file: string; name: string; bytes: number }[];
  animals?: { file: string; name: string; bytes: number }[];
};
const вМанифесте = (раздел: 'decor' | 'animals', имя: string): boolean =>
  (МАНИФЕСТ[раздел] ?? []).some((д) => д.name === имя);

const ТЕРРЕЙН = читать('client/src/app/game3d/terrain.ts');

describe('Лагерь', () => {
  it('шатёр — полотнище, а не конус', () => {
    должен(/function шатёр\(/.test(ТЕРРЕЙН), 'нет сборщика шатра');
    должен(
      /const провис = Math\.sin\(t \* Math\.PI\) \* [\d.]+ \* s;/.test(ТЕРРЕЙН),
      'полотнище шатра не провисает',
    );
    должен(
      !/new THREE\.ConeGeometry\(2\.6, 3\.4, 7\)/.test(ТЕРРЕЙН),
      'шатры снова конусы',
    );
    должен(/копия\.side = THREE\.DoubleSide;/.test(ТЕРРЕЙН), 'полотнище шатра одностороннее');
  });

  it('у шатра есть клапан, конёк, шесты, верёвки и коврик', () => {
    должен(/const клапан = new THREE\.Mesh\(new THREE\.PlaneGeometry/.test(ТЕРРЕЙН), 'у шатра нет клапана');
    должен(/const конёк = new THREE\.Mesh\(new THREE\.CylinderGeometry/.test(ТЕРРЕЙН), 'у шатра нет конька');
    должен(/const шест = new THREE\.Mesh\(new THREE\.CylinderGeometry/.test(ТЕРРЕЙН), 'у шатра нет шестов');
    должен(/const верёвка = new THREE\.Mesh\(new THREE\.CylinderGeometry/.test(ТЕРРЕЙН), 'у шатра нет верёвок');
    должен(/const кол = new THREE\.Mesh\(new THREE\.CylinderGeometry/.test(ТЕРРЕЙН), 'у шатра нет кольев');
    должен(/const ковёр = new THREE\.Mesh\(new THREE\.BoxGeometry/.test(ТЕРРЕЙН), 'у шатра нет коврика');
  });

  it('частокол — готовые секции палисада', () => {
    должен(вМанифесте('decor', 'medieval-wooden-palisade'),
      'medieval-wooden-palisade.glb нет в манифесте');
    const блок = ТЕРРЕЙН.split("Частокол кольцом")[1].split("addCollider(CAMP.x + 15")[0];
    должен(/for \(let i = 0; i < 26; i\+\+\)/.test(блок), 'частокол не кольцом');
    должен(/decorВещь\(camp, 'medieval-wooden-palisade', px, pz,/.test(блок),
      'частокол стоит не из готовых секций');
    // Колья и перекладины из примитивов ушли.
    должен(!/CylinderGeometry\(0\.13, 0\.19, 2\.6, 6\)/.test(ТЕРРЕЙН), 'частокол снова из кольев');
  });

  it('костёр — готовая модель, пламя своё', () => {
    должен(вМанифесте('decor', 'bonfire'), 'bonfire.glb нет в манифесте');
    должен(/decorВещь\(camp, 'bonfire', 0, 0, \{ размер: [\d.]+, по: 'horizontal', y: 0 \}\);/.test(ТЕРРЕЙН),
      'костёр стоит не из готовой модели');
    // Пламя на месте — его анимирует мир по имени.
    должен(/flame\.name = 'campfire-flame';/.test(ТЕРРЕЙН), 'пламя костра потеряло имя');
    должен(!/DodecahedronGeometry\(0\.22, 0\)/.test(ТЕРРЕЙН), 'камни костра снова додекаэдры');
  });
});
