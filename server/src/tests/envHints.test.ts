// Пометки окружения (§370): «толкнуть, сломать, поджечь» видны игроку.
//
// ЗА ЧТО БОРЕТСЯ. Владелец просил «пометить, что можно толкнуть, сломать,
// поджечь». Механики стояли (толкание §334, поджог, обрушение), но колбэк
// onInteractive был объявлен и НЕ ПОТРЕБЛЯЛСЯ никем: игрок кликал в кувшин
// и не получал ничего — ни подсказки при наведении, ни отзыва на действие.
// Мёртвый колбэк — тот же класс находок, что мёртвые поля справочников.
//
// ВТОРОЕ — БАГ ПОВТОРНОГО СРАБАТЫВАНИЯ. collapseAwning и igniteOilJug
// писали старое поле userData.state, а заслон повторов и колбэк читают
// interactiveState. Обрушенный навес можно было обрушать снова, горящий
// кувшин — поджигать заново. Здесь требуется ОБА поля.
//
// ЧТО ПРОВЕРЯЕТСЯ. Элемент страницы и его стиль, hover-луч с заслоном
// состояния, текст подсказки из словаря (движок не знает переводов), тосты
// только на переходы состояния, словари на трёх языках.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const мир = stripComments(read('client/src/app/game3d/world3d.ts'));
const глобус = read('client/src/app/world.ts');
const страница = read('client/web/game/index.html');
const стили = read('client/src/app/styles.css');

describe('Подсказка под прицелом', () => {
  it('элемент страницы существует и скрыт по умолчанию', () => {
    must(/<div class="hud env-hint hidden" id="env-hint"><\/div>/.test(страница),
      'элемента подсказки нет: наведение не показывает ничего');
  });

  it('стиль живёт в styles.css и прячется за рамкой цели', () => {
    must(/\.env-hint \{/.test(стили), 'стиля подсказки нет: элемент без вида');
    must(/#target-frame:not\(\.hidden\) ~ #env-hint \{ top: 88px; \}/.test(стили),
      'подсказка не сдвигается за рамкой цели: наложение сверху');
  });

  it('движок рисует в готовый элемент страницы и гасит повторы', () => {
    must(/document\.getElementById\('env-hint'\)/.test(мир),
      'движок создаёт свой элемент: стили разъедутся со стилями страницы');
    must(/if \(kind === this\.envHintKind\) return;/.test(мир),
      'подсказка перестраивается каждый кадр: лишняя работа и мигание');
    // Скрытый и сломанный не подсказывают: сломанное не манипулируют.
    must(/interactiveState \?\? 'intact'\) === 'intact'/.test(мир),
      'подсказка стоит на сломанном объекте: ложный зов');
  });

  it('дистанция подсказки не меньше дистанции действия', () => {
    // Увидеть можно раньше, чем дотянуться: иначе подсказка мигает ровно
    // на границе действия и читается как лаг.
    const hover = Number((мир.match(/hit\.distance <= (\d+)/) ?? [])[1]);
    must(hover >= 26, `дистанция подсказки ${hover}: она должна перекрывать дальность клика (22)`);
  });

  it('строку даёт мир: движок не знает переводов', () => {
    must(/onInteractiveHint\?: \(kind: string\) => string/.test(мир),
      'колбэка подсказки нет: движок встраивал бы русские строки');
    must(/crate: 'env\.push'/.test(глобус) && /oil_jug: 'env\.ignite'/.test(глобус) && /awning: 'env\.collapse'/.test(глобус),
      'мир не переводит виды окружения');
    // t\( — граница слова: иначе ловится intersect( и прочие хвосты.
    must(!/t\(/.test(мир.slice(мир.indexOf('private updateEnvHint'), мир.indexOf('private камераЗакрыта'))),
      'движок зовёт переводчик сам: i18n в рендере роняет серверные тесты');
  });
});

describe('Действие отзывается — и только на переходы', () => {
  it('мёртвый колбэк ожил потребителем', () => {
    must(/onInteractive: \(kind, state\) => \{/.test(глобус),
      'onInteractive по-прежнему никто не потребляет: клики молчат');
  });

  it('тосты стоят на переходах, а не на каждом клике', () => {
    const обработчик = глобус.slice(глобус.indexOf('onInteractive: (kind, state) => {'), глобус.indexOf('onInteractive: (kind, state) => {') + 600);
    must(/state === 'broken'/.test(обработчик) && /state === 'burning'/.test(обработчик),
      'тостов на переходы нет');
    must(!/state === 'intact'/.test(обработчик),
      'тост на intact: каждый клик по ящику — спам в углу');
  });

  it('повторное срабатывание закрыто: оба поля состояния', () => {
    must(/obj\.userData\.state = 'collapsed';\s*\n\s*obj\.userData\.interactiveState = 'collapsed';/.test(мир),
      'навес ставит только старое поле: обрушенный можно обрушать снова');
    must(/obj\.userData\.state = 'burning';\s*\n\s*obj\.userData\.interactiveState = 'burning';/.test(мир),
      'кувшин ставит только старое поле: горящий можно поджигать заново');
  });
});

describe('Словари: подсказки на трёх языках', () => {
  const ключи = ['push', 'ignite', 'collapse', 'broken', 'ignited', 'collapsed'];
  for (const lang of ['en', 'ru', 'az']) {
    it(`${lang}: все шесть строк на месте`, () => {
      const словарь = JSON.parse(read(`shared/locales/${lang}.json`));
      const раздел = словарь.env ?? {};
      const пустые = ключи.filter((k) => !(раздел[k] ?? '').trim());
      must(пустые.length === 0, `${lang}: пустые ключи окружения — ${пустые.join(', ')}`);
    });
  }
});
