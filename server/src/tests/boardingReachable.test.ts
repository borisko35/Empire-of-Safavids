// Абордаж: кнопка наконец ведёт к живому маршруту.
//
// ЗАЧЕМ. Я построил абордаж с одной стороны: маршрут `/boarding/targets`
// работает (проверено на проде — 200, reason=board_no_boat), клиентский вызов
// `api.boardingTargets` написан, но кнопки не было НИ ОДНОЙ. Игрок не мог
// воспользоваться механикой. Это ровно тот класс, от которого вся серия
// коммитов «объявлено, но не работает».
//
// Проверка требует ВСЮ цепочку: маршрут -> вызов -> панель -> кнопка -> перевод.
// Каждое звено ломается отдельно и тихо.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');
const код = (p: string): string => stripComments(читать(p));

function must(условие: unknown, причина: string): void {
  if (!условие) throw new Error(причина);
}

const маршруты = код('server/src/routes/game.ts');
const апи = код('client/src/app/api.ts');
const панель = код('client/src/app/panels.ts');

describe('Абордаж: цепочка целиком', () => {
  it('маршрут есть', () => {
    must(маршруты.includes("gameRouter.get('/boarding/targets'"), 'маршрута нет');
  });

  it('клиентский вызов есть', () => {
    must(/boardingTargets:\s*\(/.test(апи), 'вызова нет');
  });

  it('панель вызывает вызов', () => {
    // Вот это звено и отсутствовало: без него всё остальное — мёртвый код.
    must(/api\.boardingTargets\(/.test(панель), 'панель не вызывает boardingTargets');
  });

  it('оба режима показаны', () => {
    // Двойной принцип: режим выбирает атакующий. Проверка требует,
    // чтобы интерфейс давал именно ВЫБОР, а не один режим.
    must(/for \(const режим of \['pve', 'pvp'\] as const\)/.test(панель),
      'в интерфейсе нет выбора режима: двойной принцип не доехал до игрока');
    must(/t\('panels\.boarding_pve'\)/.test(панель), 'PvE не показан');
    must(/t\('panels\.boarding_pvp'\)/.test(панель), 'PvP не показан');
  });

  it('пустой список объясняется', () => {
    // Без лодки сервер отвечает reason=board_no_boat. Молчаливый пустой
    // список выглядит как «абордаж сломан», а не «нужна лодка».
    must(/reason === 'board_no_boat' \? t\('panels\.boarding_no_boat'\)/.test(панель),
      'причина отказа без лодки не доходит до игрока');
  });

  it('переводы есть во всех трёх языках', () => {
    for (const язык of ['ru', 'en', 'az']) {
      const словарь = JSON.parse(читать(`shared/locales/${язык}.json`)) as {
        panels: Record<string, string>;
      };
      for (const ключ of ['boarding', 'boarding_pve', 'boarding_pvp', 'boarding_list', 'boarding_found', 'boarding_empty', 'boarding_no_boat']) {
        must(
          typeof словарь.panels?.[ключ] === 'string' && словарь.panels[ключ].length > 0,
          `в ${язык}.json нет panels.${ключ}`,
        );
      }
    }
  });
});