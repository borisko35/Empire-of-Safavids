// Интерактивные объекты: ящики, кувшины, навесы — готовые GLB-модели (§334).
//
// ЧТО БЫЛО (до §334). Ящик — бокс с рёбрами, кувшин — цилиндр+шар+торус,
// навес — столбы+перекладины+покрытие из сена. Всё примитивы.
//
// ЧТО ТЕПЕРЬ. Все три — готовые модели: crate.glb, clay-jug.glb, trade-tent.glb.
// Функции возвращают группу с простым плейсхолдером, асинхронно подменяют на GLB.
//
// ЧТО ПРОВЕРЯЕТСЯ. В interactive.ts вызывается loadDecorModel с путями к моделям
// в манифесте; сложные процедурные сборки (рёбра ящика, горлышко+ручка кувшина,
// каркас навеса) ушли — остались только минимальные плейсхолдеры.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function должен(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const ИНТЕРАКТИВ = читать('client/src/app/game3d/interactive.ts');
const код = ИНТЕРАКТИВ.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('Интерактивные объекты на GLB (§334)', () => {
  it('ящик — crate.glb, рёбра ушли', () => {
    должен(/loadDecorModel\(['"]models\/decor\/crate\.glb['"]\)/.test(код),
      'createCrate не вызывает loadDecorModel для crate.glb');
    // Рёбра ящика (BoxGeometry(t, h, t) в цикле) ушли — остался только
    // простой плейсхолдер BoxGeometry(w, h, d).
    должен(!/BoxGeometry\(t, h, t\)/.test(код),
      'рёбра ящика снова процедурные');
  });

  it('кувшин — clay-jug.glb, горлышко и ручка ушли', () => {
    должен(/loadDecorModel\(['"]models\/decor\/clay-jug\.glb['"]\)/.test(код),
      'createOilJug не вызывает loadDecorModel для clay-jug.glb');
    // Сложные части: горлышко (CylinderGeometry 0.1, 0.12, 0.2), пробка,
    // ручка (TorusGeometry) ушли — остался только простой цилиндр-плейсхолдер.
    должен(!/new THREE\.CylinderGeometry\(0\.1, 0\.12, 0\.2, 12\)/.test(код),
      'горлышко кувшина снова процедурное');
    должен(!/new THREE\.TorusGeometry\(0\.18, 0\.02, 6, 12\)/.test(код),
      'ручка кувшина снова торус');
  });

  it('навес — trade-tent.glb, каркас ушёл', () => {
    должен(/loadDecorModel\(['"]models\/decor\/trade-tent\.glb['"]\)/.test(код),
      'createAwning не вызывает loadDecorModel для trade-tent.glb');
    // Каркас навеса: перекладины BoxGeometry(w, frameH, frameH) и
    // BoxGeometry(frameH, frameH, d) ушли — остались только 4 столба-плейсхолдера.
    должен(!/new THREE\.BoxGeometry\(w, frameH, frameH\)/.test(код),
      'перекладины навеса снова боксы');
    должен(!/new THREE\.BoxGeometry\(frameH, frameH, d\)/.test(код),
      'стойки навеса снова боксы');
  });
});