// Клавиша P для панели данжей.
//
// ЗАЧЕМ. Панель данжей открывалась только через меню и разговор со стражником,
// хотя это одно из самых частых действий. Четыре соседних действия имели
// клавишу (F персонаж, G гильдия, J квесты, I сумка), и только это - нет.
// Просил владелец: клавиша P.
//
// ЧТО ЗАЩИЩАЕТСЯ. Не «в коде есть KeyP», а вся цепочка: бинд по умолчанию,
// обработчик, то что именно открывается panel-dungeons, и подпись в списке
// клавиш настроек. Пропущенное звено даёт молча неработающую клавишу: нажатие
// проходит, а панель не открывается.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');
const код = (p: string): string => stripComments(читать(p));

function must(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

const мир = код('client/src/app/world.ts');
const html = читать('client/src/app/index.html');
const панели = код('client/src/app/panels.ts');
const хаб = код('client/src/app/hub.ts');

describe('Клавиша P: панель данжей', () => {
  it('биндан по умолчанию на P', () => {
    must(/dungeons: 'KeyP'/.test(мир), 'бинда dungeons нет или он не на P');
  });

  it('обработчик вызывает именно панель данжей', () => {
    must(
      /getBind\('dungeons'\)\s*\)?\s*\{\s*\n\s*togglePanel\('panel-dungeons'\)/.test(мир) ||
        /getBind\('dungeons'\)\) \{\n\s*togglePanel\('panel-dungeons'\)/.test(мир),
      'обработчик клавиши не открывает panel-dungeons',
    );
    // Забытый else if - самый частый способ сломать цепочку: ветка есть,
    // но она вложена в соседнюю и не выполняется.
    must(
      /} else if \(e\.code === getBind\('dungeons'\)\)/.test(мир),
      'ветка не в цепочке else if: нажатие уйдёт мимо',
    );
  });

  it('панель зарегистрирована в загрузчике и в хабе', () => {
    // Клавиша без регистрации открыла бы пустую панель: панель есть в DOM,
    // но данных в ней нет.
    must(/'panel-dungeons': loadDungeons/.test(панели), 'панель данжей не привязана к загрузчику');
    must(/id: 'panel-dungeons'/.test(хаб), 'панели данжей нет в списке хаба');
  });

  it('список клавиш в настройках знает про P', () => {
    // Иначе игрок не узнает о клавише: пять соседей перечислены, это - нет.
    must(/<kbd>P<\/kbd> <span data-i18n="settings\.k_dungeons"><\/span>/.test(html),
      'в списке клавиш настроек нет P');
  });

  it('подпись переведена во всех трёх языках', () => {
    for (const кодЯзыка of ['ru', 'en', 'az']) {
      const словарь = JSON.parse(читать(`shared/locales/${кодЯзыка}.json`)) as {
        settings: Record<string, string>;
      };
      must(
        typeof словарь.settings?.k_dungeons === 'string' && словарь.settings.k_dungeons.length > 0,
        `в ${кодЯзыка}.json нет settings.k_dungeons: список клавиш покажет пустое имя`,
      );
    }
  });

  it('существующие клавиши не сломались', () => {
    // Обратная сторона: правка не должна была увести соседние бинды.
    for (const [действие, клавиша] of [
      ['map', 'KeyM'],
      ['character', 'KeyF'],
      ['guild', 'KeyG'],
      ['quests', 'KeyJ'],
      ['inventory', 'KeyI'],
    ] as const) {
      must(мир.includes(`${действие}: '${клавиша}'`), `бинд ${действие} потерял клавишу ${клавиша}`);
    }
  });

  it('P не занята другим действием', () => {
    // Иначе одно нажатие делало бы два дела, и понять, какое сработало,
    // было бы нельзя.
    const занятые = [...мир.matchAll(/:\s*'(Key[A-Z])'/g)].map((m) => m[1]);
    const п = занятые.filter((к) => к === 'KeyP');
    must(п.length === 1, `KeyP встречается ${п.length} раз: клавиша занята дважды`);
  });
});