// Поломки, найденные сквозным обходом клиента 07.10.2026 (часть вторая).
//
// Здесь правки, которые нельзя проверить поведением без WebGL, поэтому
// сторожат форму кода. Каждая проверка обязана ломаться на старом коде.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');
const код = (p: string): string => stripComments(читать(p));

const world = код('client/src/app/game3d/world3d.ts');
const world3d = читать('client/src/app/game3d/world3d.ts');
const net = код('client/src/app/net.ts');
const worldApp = код('client/src/app/world.ts');
const traffic = код('client/src/app/game3d/roadTraffic.ts');
const fauna = код('client/src/app/game3d/fauna.ts');
const interiors = код('client/src/app/game3d/interiors.ts');
const hud = код('client/src/app/hud.ts');

describe('Коллайдеры не растут при каждом входе в мир', () => {
  it('списки чистятся в самом начале постройки мира', () => {
    // Ломка: было только `COLLIDERS.length = 0` внутри buildCity, и там же
    // список не обнулялся, а СОХРАНЯЛСЯ целиком и возвращался обратно —
    // вместе с коллайдерами города от прошлого мира. Каждый повторный вход
    // примерно удваивал список, а он проверяется в каждом кадре трижды.
    const начало = world.indexOf('init(container: HTMLElement');
    expect(начало).toBeGreaterThan(-1);
    const префикс = world.slice(начало, начало + 2500);
    expect(префикс).toMatch(/COLLIDERS\.length = 0/);
  });

  it('чистятся все пять списков, а не один', () => {
    // Ломка: очистка только COLLIDERS оставила бы POCKET_COLLIDERS
    // (невидимый забор кармана), INTERIOR_COLLIDERS, FAUNA_COLLIDERS и
    // CIV_COLLIDERS расти от входа к входу.
    const начало = world.indexOf('init(container: HTMLElement');
    const префикс = world.slice(начало, начало + 2500);
    for (const имя of ['COLLIDERS', 'POCKET_COLLIDERS', 'INTERIOR_COLLIDERS', 'FAUNA_COLLIDERS', 'CIV_COLLIDERS']) {
      expect(префикс).toMatch(new RegExp(`${имя}\\.length = 0`));
    }
  });

  it('город по-прежнему сохраняет коллайдеры ландшафта', () => {
    // Правка не должна сломать механику buildCity: он откладывает
    // коллайдеры деревьев и камней в сторону, строит город и возвращает их.
    // Убрать это — значит обнулить лес.
    const terrain = код('client/src/app/game3d/terrain.ts');
    expect(terrain).toMatch(/__landscapeColliders/);
    expect(terrain).toMatch(/for \(const c of saved\) COLLIDERS\.push\(c\)/);
  });
});

describe('Индикатор соединения переживает вход в мир', () => {
  it('трекер состояния вынесен в функцию', () => {
    // Ломка: было пять socket.on(...) прямо на верхнем уровне net.ts.
    // `socket.off()` в world.ts снимает ВСЕ подписки, включая их, и после
    // первого входа в мир состояние соединения замирало навсегда.
    expect(net).toMatch(/export function attachConnectionStateTracking/);
    expect(net).toMatch(/attachConnectionStateTracking\(\);/);
  });

  it('world.ts зовёт его сразу после socket.off()', () => {
    const позицияOff = worldApp.indexOf('socket.off()');
    const позицияAttach = worldApp.indexOf('attachConnectionStateTracking()', позицияOff);
    expect(позицияOff).toBeGreaterThan(-1);
    expect(позицияAttach).toBeGreaterThan(позицияOff);
  });

  it('подписки всё ещё заводятся при загрузке модуля', () => {
    // Проверка на побочный эффект правки: если убрать вызов на верхнем
    // уровне, состояние перестанет обновляться ДО первого входа в мир.
    expect(net).toMatch(/attachConnectionStateTracking\(\);\s*$/m);
  });
});

describe('Дорожное движение', () => {
  it('дальнее действительно скрывается', () => {
    // Ломка: было `if (w.group.visible === !far) w.group.visible = !far`, то
    // есть присваивание происходило ровно тогда, когда видимость УЖЕ была
    // правильной. Строка ничего не меняла, и караваны за 460 м никогда не
    // скрывались. Нужен `!==`, а не `===`.
    expect(traffic).toMatch(/if \(w\.group\.visible !== !far\) w\.group\.visible = !far/);
    expect(traffic).not.toMatch(/w\.group\.visible === !far/);
  });

  it('сцена снимает движение, а не течёт геометрией', () => {
    // Ломка: dispose() был написан, но не вызывался ниоткуда — караваны
    // оставались в старой сцене вместе со своими материалами (у каждого
    // каравана свой MeshStandardMaterial на робу, кожу и шляпу).
    expect(world).toMatch(/this\.roadTraffic\?\.dispose\(\)/);
  });

  it('миксеры коров останавливаются', () => {
    // Ломка: без stopAllAction() двухуровневые ссылки на загруженные клипы
    // продолжали крутить анимации уже снятых сцены моделей.
    expect(world).toMatch(/for \(const mx of this\.cowMixers \?\? \[\]\) mx\.stopAllAction\(\)/);
  });
});

describe('Верблюд с двумя горбами', () => {
  it('оба горба добавлены в группу', () => {
    // Ломка: раньше горб клонировали, ставили ему z = 0 — ровно туда же,
    // где стоит первый, — и НЕ добавляли в группу. Он создавался, двигался
    // и молча терялся, так что верблюд оставался с одним горбом.
    expect(fauna).toMatch(/for \(const \[gx, sc\] of \[\[-0\.05, 1\.3\], \[-0\.42, 1\.15\]\] as const\)/);
    expect(fauna).not.toMatch(/const hump2 = hump\.clone\(\)/);
  });

  it('горбы смещены вдоль тела, а не поперёк', () => {
    // Тело вытянуто вдоль оси X (голова на +0.55), значит и второй горб
    // смещается по X. Прежний hump2.position.z = 0 был смещением по Z.
    expect(fauna).toMatch(/hump\.position\.set\(gx, legH \+ 0\.72, 0\)/);
    expect(fauna).not.toMatch(/hump2\.position\.z/);
  });
});

describe('Перемычка над дверью', () => {
  it('стоит по центру своей полосы, а не на низу проёма', () => {
    // Ломка: `box()` берёт ЦЕНТР, а стоял центр FLOOR_Y + 3.4 при высоте
    // 1.1, то есть перемычка на 0.55 м врезалась в проём и не доходила до
    // верха стены. У центрального проёма щель закрывала вторая, отдельная
    // перемычка — поэтому дефект был не виден, а у боковых проёмов крепости
    // (их три: −7, 0, +7) щель была настоящей.
    expect(interiors).toMatch(/ЛЕНА_ПРОЁМА \+ лента \/ 2/);
    expect(interiors).not.toMatch(/FLOOR_Y \+ 3\.4, cz \+ hd\)/);
  });

  it('перемычка одна на каждый проём, а не две', () => {
    // Ломка: старая безусловная перемычка по центру осталась рядом с циклом
    // и дублировала центральную (у крепости — четвёртую лишнюю).
    expect(interiors).not.toMatch(/FLOOR_Y \+ 3\.4 \+ \(ROOM_WALL_H - 3\.4\) \/ 2/);
  });
});

describe('Экран потери связи не запускается дважды', () => {
  it('повторный показ игнорируется', () => {
    // Ломка: `force:disconnect` и следом `disconnect` звонили в одну функцию,
    // каждый раз заводя свой таймер на 2.2 с. Два leaveWorld() и два
    // gotoCharacters() поверх друг друга.
    expect(worldApp).toMatch(/if \(!el\.classList\.contains\('hidden'\)\) return;/);
  });

  it('при новом входе в мир оверлей прячется', () => {
    // Побочная обязанность защиты: оверлей сам себя не прятал, поэтому без
    // этой строки он висел бы поверх нового мира и заблокировал бы экран
    // при следующем реальном обрыве уже в новой сессии.
    expect(worldApp).toMatch(/getElementById\('overlay-lost'\)\?\.classList\.add\('hidden'\)/);
  });
});

describe('Полоса опыта не показывает 0 / 0', () => {
  it('делитель защищён так же, как в pct()', () => {
    // Ломка: было `s.level * s.level * 100` прямо в строке. У не поднятого
    // героя level = 0, и строка показывала «0 / 0».
    expect(hud).toMatch(/const expMax = Math\.max\(1, s\.level \* s\.level \* 100\)/);
    expect(hud).toMatch(/txt-exp'\)\.textContent = `\$\{s\.experience\} \/ \$\{expMax\}`/);
  });
});

describe('FX читается по номеру, а не по индексу', () => {
  it('в мире нет курсора-индекса', () => {
    // Ломка: `while (this.lastFx.floater < fl.length)` на мутируемом с начала
    // массиве — это и был баг. Проверка требует сверки по f.seq.
    expect(world).not.toMatch(/this\.lastFx\.floater < /);
    expect(world).not.toMatch(/this\.lastFx\.effect < /);
    expect(world).toMatch(/if \(f\.seq <= this\.lastFx\.floater\) continue;/);
    expect(world).toMatch(/if \(e\.seq <= this\.lastFx\.effect\) continue;/);
  });

  it('сброса курсора на пустом массиве больше нет', () => {
    // Сброс был именно тем, что маскировало баг: срабатывал он только на
    // пустом массиве, а в бою массив пустым не бывает.
    expect(world).not.toMatch(/if \(fl\.length === 0\) this\.lastFx\.floater = 0/);
    expect(world).not.toMatch(/if \(ef\.length === 0\) this\.lastFx\.effect = 0/);
  });

  it('мёртвый множитель i * 0 убран', () => {
    // Ломка: `f.y -= dt * (1.6 + i * 0)` — i * 0 всегда ноль, индекс не
    // влиял ни на что. Плюс здесь сдвигается координата z (floater.y хранит
    // именно z по 2D-конвенции), а не высота.
    const entities = код('client/src/app/entities.ts');
    expect(entities).not.toMatch(/1\.6 \+ i \* 0/);
    expect(entities).toMatch(/f\.y -= dt \* 1\.6/);
  });

  it('комментарий в мире объясняет, почему не индекс', () => {
    // Комментарий — часть правки: по проекту решение обязано быть записано
    // там, где оно принято, иначе через месяц вернут индекс «для простоты».
    expect(world3d).toMatch(/порядковому номеру/);
  });
});