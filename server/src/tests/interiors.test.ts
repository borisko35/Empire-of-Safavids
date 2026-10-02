// Интерьеры зданий: десять комнат нарисованы, а попасть в них было нельзя.
//
// ЧТО БЫЛО. 3D-слой давно умел три вещи: pickDoor() определял клик по двери
// и звал обработчик onDoor; enterBuildingAt() телепортировал внутрь; exitBuildingAt()
// — наружу. Сервер принимал interior:enter и interior:exit, проверял, что
// игрок действительно у двери, двигал позицию в базе и Redis и отвечал
// подтверждением. А вот обработчик двери в world3d.init НЕ ПЕРЕДАВАЛИ —
// объект создавался без onDoor.
//
// Итог: игрок подходил к двери, нажимал, и ничего не происходило. Дверь
// выглядит частью стены, подсказки нет, объяснить нечем. Пять публичных
// методов World3D при этом ни разу не вызывались за всё время существования.
//
// ТУТ ЛЕЧИТСЯ ТОЛЬКО ОДНО ЗВЕНО — обработчик. Всё остальное уже было готово,
// что и делает находку дорогой: подсистема стоила десятки тысяч строк и была
// недостижима из-за одной незаполненной строчки.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const client = stripComments(read('client/src/app/world.ts'));
const w3d = stripComments(read('client/src/app/game3d/world3d.ts'));

/** Какой именно триггер в init передаётся приложением */
function initCallbacks(): string {
  const start = client.indexOf('world3d.init(');
  return client.slice(start, start + 2000);
}

describe('Интерьеры: дверь доходит до приложения', () => {
  it('обработчик двери передаётся в 3D-слой', () => {
    // ГЛАВНОЕ. onDoor — единственное незаполненное звено: без него клик
    // по двере уходил в никуда, и все десять комнат были недостижимы
    expect(initCallbacks()).toMatch(/onDoor:/);
  });

  it('образается к существующему полю обратной связи', () => {
    // Если переименуют поле в интерфейсе, а здесь останется старое имя,
    // ошибка будет молчаливой: TypeScript её поймает, но только если поле
    // удалят, а не переименуют
    expect(w3d).toMatch(/onDoor\?:/);
  });

  it('обработчик вызывает функцию входа', () => {
    expect(initCallbacks()).toMatch(/enterOrExitBuilding/);
  });

  it('функция входа объявлена', () => {
    expect(client).toMatch(/function enterOrExitBuilding/);
  });
});

describe('Интерьеры: сервер решает, можно ли войти', () => {
  it('события берутся из общих констант, а не пишутся строкой', () => {
    // Имя события живёт в shared/constants. Если там переименуют, а здесь
    // оставят литерал, вход в здания снова станет невозможен — молча
    expect(client).toMatch(/SOCKET_EVENTS\.INTERIOR_ENTER/);
    expect(client).toMatch(/SOCKET_EVENTS\.INTERIOR_EXIT/);
  });

  it('вход и выход — разные события', () => {
    // Ошибочка, из-за которой выход работал бы как вход: игрок вышел бы
    // «наружу» дважды, а внутрь не вернулся бы
    const c = stripComments(read('shared/constants.ts'));
    const enter = c.match(/INTERIOR_ENTER:\s*'([^']+)'/);
    const exit = c.match(/INTERIOR_EXIT:\s*'([^']+)'/);
    expect(enter).not.toBeNull();
    expect(exit).not.toBeNull();
    expect(enter![1]).not.toBe(exit![1]);
  });

  it('телепорт происходит только по ответу сервера', () => {
    // ВАЖНО ДЛЯ АНТИЧИТА. Если телепортировать сразу на клик, первый же
    // пакет движения из старой точки прилетит раньше сброса трекинга, и
    // игрока выкинет за спидхак. Поэтому клик только спрашивает сервер
    // Запрос входа теперь несёт ещё и номер двери ({ buildingId, entranceId }):
      // без него сервер не знает, через какую из трёх дверей крепости вошёл
      // игрок, и правила входа (присед, золото) не к чему применить.
      // Смысл проверки не меняется: клик по-прежнему ТОЛЬКО спрашивает сервер,
      // телепорт происходит только в ответе.
      expect(client).toMatch(/socket\.emit\(\s*event,\s*\{ buildingId, entranceId \},\s*\(/);
    expect(client).toMatch(/enterBuildingAt\(buildingId, res\.target\)/);
    expect(client).toMatch(/exitBuildingAt\(res\.target\)/);
  });

  it('отказ сервера показывается игроку', () => {
    // Молчание выглядит как «дверь не работает» — ровно тот симптом,
    // который и был у игрока
    expect(client).toMatch(/if \(!res\?\.ok\)/);
  });

  it('причины отказа переводятся, а не показываются служебным текстом', () => {
    // Сервер отдаёт причины по-английски: 'Too far from the door' и т. п.
    // Игрок не должен видеть внутренний текст
    expect(client).toMatch(/'Too far from the door':/);
    expect(client).toMatch(/'Not inside':/);
    expect(client).toMatch(/'Unknown building':/);
  });

  it('на любое сообщение сервера есть запасной перевод', () => {
    // Иначе добавление новой причины на сервере покажет игроку пустоту
    expect(client).toMatch(/map\[res\?\.reason \?\? ''\] \?\? t\(/);
  });
});

describe('Интерьеры: дверь не залипает', () => {
  it('повторные клики во время запроса игнорируются', () => {
    // При медленной сети иначе можно отправить несколько запросов и
    // получить два телепорта подряд
    expect(client).toMatch(/if \(doorBusy\) return;/);
    expect(client).toMatch(/doorBusy = true;/);
  });

  it('флаг снимается и при успехе, и при отказе', () => {
    expect(client).toMatch(/settled = false;/);
    expect(client).toMatch(/doorBusy = false;/);
  });

  it('есть страховка на случай молчания сервера', () => {
    // Обрыв связи или перезагрузка сервера: без страховки дверь осталась бы
    // «занятой» навсегда и перестала бы открываться до перезахода в игру
    expect(client).toMatch(/window\.setTimeout\(/);
    expect(client).toMatch(/inside_failed/);
  });

  it('страховка не срабатывает, если ответ уже пришёл', () => {
    // Иначе через 6 секунд после успешного входа игрок увидит ошибку
    expect(client).toMatch(/if \(settled\) return;/);
  });

  it('состояние без мира не трогается', () => {
    expect(client).toMatch(/if \(!world3d\) return;/);
  });
});

describe('Интерьеры: подсистема наконец достижима', () => {
  it('методы входа и выхода теперь вызываются', () => {
    // Раньше пять публичных методов World3D не имели ни одного вызова
    // во всём репозитории
    const calls = [...client.matchAll(/w3d\.(enterBuildingAt|exitBuildingAt|isInsideBuilding)\(/g)].length;
    expect(calls).toBe(2);
  });

  it('методы по-прежнему объявлены в 3D-слое', () => {
    expect(w3d).toMatch(/enterBuildingAt\(/);
    expect(w3d).toMatch(/exitBuildingAt\(/);
  });

  it('3D-слой по-прежнему отвечает за детект двери', () => {
    // Разделение слоёв: 3D знает, что кликнули, приложение знает, что
    // делать. Прямая зависимость 3D от сетевых событий нарушала бы слои
    expect(w3d).toMatch(/private pickDoor\(\)/);
    expect(w3d).toMatch(/callbacks\?\.onDoor\?\./);
  });

  it('комнаты по-прежнему рисуются в сцене', () => {
    // Проверяем, что при подключении двери не потерялась отрисовка:
    // сцена собирается один раз, и переинициализация её не должна рушить
    expect(w3d).toMatch(/this\.interiors\.enter\(id\)/);
    expect(w3d).toMatch(/this\.weather\?\.setInside\(true\)/);
  });
});

describe('Интерьеры: переводы на месте', () => {
  it('все три языка содержат новые ключи', () => {
    for (const lang of ['ru', 'en', 'az']) {
      const json = JSON.parse(read(`shared/locales/${lang}.json`)) as Record<string, Record<string, string>>;
      const w = json.world;
      const keys = [
        'inside_enter', 'inside_exit', 'inside_far', 'inside_not_inside',
        'inside_unknown', 'inside_not_auth', 'inside_failed',
      ];
      for (const k of keys) {
        expect({ lang, key: k, has: !!w[k] }).toEqual({ lang, key: k, has: true });
      }
    }
  });

  it('в подписи есть место для названия комнаты', () => {
    // Название берётся из двери, а не из строковых литералов
    const ru = JSON.parse(read('shared/locales/ru.json')) as { world: Record<string, string> };
    expect(ru.world.inside_enter).toMatch(/\{name\}/);
  });

  it('подстановка названия в коде есть', () => {
    expect(client).toMatch(/inside_enter'\)\.replace\('\{name\}'/);
  });

  it('названия комнат берутся из двери, а не из id', () => {
    // Запасной вариант — id здания. Он нужен, но только если имя не
    // пришло: показывать игроку «workshop» вместо «Мастерская» нельзя
    expect(client).toMatch(/nameRu \|\| buildingId/);
  });
});
