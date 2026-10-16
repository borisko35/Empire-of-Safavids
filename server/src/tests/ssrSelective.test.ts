// SSR не отражает всё подряд.
//
// ЗАЧЕМ ФАЙЛ. SSRPass создавался со `selects: null`. Комментарий над ним
// обещал отражения «для воды, мокрого камня, металла, стекла», но в three
// null означает не «выборочно», а «вся сцена». Дословно, SSRPass.js:151:
//
//   Which 3D objects should be affected by SSR.
//   If not set, the entire scene is affected.
//
// Итог был зеркальным: земля отражала дома, стены — друг друга, персонаж
// сам себя. Владелец прислал скриншот и написал «всё стало зеркальным».
//
// Комментарий в коде чинить недостаточно: он говорил правильное намерение
// и стоял рядом с делающим обратное. Проверка смотрит на сам параметр.
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

function must(cond: boolean, why: string): void {
  if (!cond) throw new Error(why);
}

describe('SSR отражает выборочно, а не всю сцену', () => {
  const world3d = read('client/src/app/game3d/world3d.ts');
  const ssrLib = read('client/node_modules/three/examples/jsm/postprocessing/SSRPass.js');

  it('в three действительно null означает «вся сцена»', () => {
    // Если библиотека поменяет смысл, проверка перестанет быть доказательством
    // и станет проверкой нашего предположения. Пусть она это увидит.
    must(/If not set, the entire scene is affected/.test(ssrLib),
      'three больше не утверждает, что null = вся сцена: вывод надо перепроверить');
  });

  it('у прохода список отражающих, а не null', () => {
    must(/selects: \[\],/.test(world3d),
      'список снова null — зеркало вернётся');
    must(!/selects: null,/.test(world3d),
      'нашёлся selects: null — отражает вся сцена, как и было');
  });

  it('список собирается обходом готовой сцены', () => {
    must(/private collectSsrReflectors\(\): void/.test(world3d),
      'метода сбора отражающих нет');
    must(/metalness >= 0\.3/.test(world3d),
      'критерий отбора потерян: непонятно, что вообще отражает');
    must(/this\.ssrPass\.selects = отражающие;/.test(world3d),
      'собранный список не отдаётся проходу');
  });

  it('сбор вызывается после постройки мира, а не до неё', () => {
    // Обход пустой сцены вернёт пустой список, и отражений не будет нигде:
    // правка выглядела бы как «сломал и починил». Порядок тут содержателен.
    const собирает = world3d.indexOf('this.collectSsrReflectors();');
    const строит = world3d.indexOf('this.navigator = createNavigator(this.scene);');
    must(собирает > -1, 'вызова collectSsrReflectors нет вовсе');
    must(собирает > строит, 'список собирается до конца постройки мира — он пустой');
  });
});