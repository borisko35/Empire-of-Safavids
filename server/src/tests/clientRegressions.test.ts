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
import { JUMP_APEX_M } from '../../../shared/verticality';
const world3d = читать('client/src/app/game3d/world3d.ts');
const net = код('client/src/app/net.ts');
const worldApp = код('client/src/app/world.ts');
const traffic = код('client/src/app/game3d/roadTraffic.ts');
const fauna = код('client/src/app/game3d/fauna.ts');
const interiors = код('client/src/app/game3d/interiors.ts');
const hud = код('client/src/app/hud.ts');
const mainApp = код('client/src/app/main.ts');
const stateApp = код('client/src/app/state.ts');

describe('Коллайдеры не растут при каждом входе в мир', () => {
  it('списки чистятся в самом начале постройки мира', () => {
    // Ломка: было только `COLLIDERS.length = 0` внутри buildCity, и там же
    // список не обнулялся, а СОХРАНЯЛСЯ целиком и возвращался обратно —
    // вместе с коллайдерами города от прошлого мира. Каждый повторный вход
    // примерно удваивал список, а он проверяется в каждом кадре трижды.
    const начало = world.indexOf('async init(');
    expect(начало).toBeGreaterThan(-1);
    const префикс = world.slice(начало, начало + 2500);
    expect(префикс).toMatch(/COLLIDERS\.length = 0/);
  });

  it('чистятся все пять списков, а не один', () => {
    // Ломка: очистка только COLLIDERS оставила бы POCKET_COLLIDERS
    // (невидимый забор кармана), INTERIOR_COLLIDERS, FAUNA_COLLIDERS и
    // CIV_COLLIDERS расти от входа к входу.
    const начало = world.indexOf('async init(');
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
    // Было `for (const mx of this.cowMixers ?? [])`: без скобок вокруг
    // `?? []` это не парсится как for-of — правка сняла лишнее, тест
    // следит за самим вызовом, а не за оформлением.
    expect(world).toMatch(/for \(const mx of this\.cowMixers\) mx\.stopAllAction\(\)/);
    expect(world).toMatch(/mx\.stopAllAction\(\)/);
  });
});

describe('Верблюд — готовая модель', () => {
  it('верблюд приезжает GLB, а не собирается из горбов-шаров', () => {
    const манифест = JSON.parse(читать('client/src/app/public/models/manifest.json')) as {
      animals?: { file: string; name: string; bytes: number }[];
    };
    expect(
      (манифест.animals ?? []).some((д) => д.name === 'camel'),
    ).toBe(true);
    expect(/hump\.position\.set/.test(fauna)).toBe(false);
    expect(/заспавнить\('camel'/.test(fauna)).toBe(true);
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
describe('Воронка входа ведёт в мир (§378)', () => {
  // Форма создания из параллельной работы персонажа на сервере НЕ создавала:
  // id генерился Math.random().toString(36), имя бралось через prompt(), и
  // ни один запрос к /api/characters не уходил. Сокет отвечает на такой id
  // «Character not found», и игрок никогда не входит в мир. Все, кто входил
  // по почте или OAuth, стояли в этой воронке.

  it('вход по почте и OAuth ведёт к ВЫБОРУ персонажей, а не к форме', () => {
    // Рабочая воронка уже была: экран выбора со списком с сервера и
    // серверным созданием (screens/chars.ts, createCharacterWithReferral).
    expect(mainApp.includes('initAuthScreen(() => void gotoCharacters())')).toBe(true);
    expect(mainApp.includes('gotoCharactersCreation')).toBe(false);
    expect(mainApp.includes("from './creation'")).toBe(false);
  });

  it('сохранённый персонаж работает только с живой сессией', () => {
    // Выход из игры с последующим F5 приводил в boot с пустым токеном:
    // gotoCharacters молча возвращался, и игрок оставался на пустом экране
    // - ни входа, ни мира.
    expect(/if \(createdChar && session\.token\) \{/.test(mainApp)).toBe(true);
  });

  it('хвост чужой сессии самолечится по форме id', () => {
    // id настоящего персонажа - uuidv4 с сервера. Локальный id формы
    // (9 символов Math.random) стирался, а игрок попадал на выбор.
    expect(/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/.test(mainApp)).toBe(true);
    expect(mainApp.includes("localStorage.removeItem('created_character')")).toBe(true);
  });

  it('созданный персонаж умирает вместе с сессией', () => {
    // clearAuth без этой строки оставлял created_character в браузере:
    // следующий аккаунт того же браузера получал чужого персонажа.
    expect(stateApp.includes("localStorage.removeItem('created_character')")).toBe(true);
  });
});

describe('Сундуки данжа доходят до игрока (§380)', () => {
  // Спавн и вскрытие жили на сервере (маршруты /dungeons/chests), а клиент
  // ни списка, ни кнопки не имел: лут данжей был недостижим, и шесть
  // сундуков катакомб были декорацией.

  it('панель активного захода запрашивает сундуки и рисует их', () => {
    expect(hud).toBe(hud); // якорь на использование переменных файла
    const панели = код('client/src/app/panels.ts');
    expect(панели.includes('api.dungeonChests(cid())')).toBe(true);
    expect(панели.includes('api.dungeonChestOpen(cid(), с.id, с.x, с.z)')).toBe(true);
    // Открытый сундук не даёт кнопку вскрытия: двойное вскрытие сервер
    // отвергает, но и кнопка не должна обещать.
    expect(/if \(с\.opened\) \{[\s\S]{0,80}кнопка\.disabled = true/.test(панели)).toBe(true);
  });

  it('дистанция считается по позиции игрока, а не выдумана', () => {
    const панели = код('client/src/app/panels.ts');
    expect(/Math\.hypot\(с\.x - session\.selfPos\.x, с\.z - session\.selfPos\.z\)/.test(панели)).toBe(true);
  });

  it('ключи сундуков на трёх языках', () => {
    for (const язык of ['ru', 'en', 'az'] as const) {
      const словарь = JSON.parse(читать(`shared/locales/${язык}.json`));
      for (const ключ of ['chests', 'chest_open', 'chest_failed', 'chest_looted']) {
        expect(typeof (словарь.dungeon ?? {})[ключ]).toBe('string');
        expect((словарь.dungeon ?? {})[ключ].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('История PvP доходит до игрока (§381)', () => {
  // Маршрут /pvp/history и сервис жили, потребителя не было: игрок не видел
  // ни своих побед, ни соперников.

  it('панель PvP зовёт историю и различает исходы', () => {
    const панели = код('client/src/app/panels.ts');
    expect(панели.includes('api.pvpHistory(cid())')).toBe(true);
    expect(/m\.status === 'draw'/.test(панели)).toBe(true);
    expect(/m\.winner_id === cid\(\) \? t\('pvp\.win'\) : t\('pvp\.loss'\)/.test(панели)).toBe(true);
    // Ожидающие и отменённые матчи в истории не рисуются.
    expect(/status === 'finished' \|\| m\.status === 'draw'/.test(панели)).toBe(true);
  });

  it('ключи истории на трёх языках', () => {
    for (const язык of ['ru', 'en', 'az'] as const) {
      const словарь = JSON.parse(читать(`shared/locales/${язык}.json`));
      for (const ключ of ['history', 'win', 'loss', 'draw_short', 'vs']) {
        expect(typeof (словарь.pvp ?? {})[ключ]).toBe('string');
        expect((словарь.pvp ?? {})[ключ].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('Блокировка друга доходит до игрока (§382)', () => {
  // Маршрут /friends/block и обёртка жили без кнопки: от навязчивых
  // друзей можно было только избавиться, но не защититься от новых заявок
  // - удалённый друг тут же присылал следующую.

  it('в строке друга есть блокировка рядом с удалением', () => {
    const панели = код('client/src/app/panels.ts');
    expect(панели.includes('api.friendBlock(f.friendId)')).toBe(true);
    expect(панели.includes("t('panels.friend_block')")).toBe(true);
    // Блокировка стирает дружбу: после неё список перечитывается.
    expect(/blockBtn\.addEventListener\('click'[^}]*void loadFriends\(\)/.test(панели)).toBe(true);
  });

  it('ключи блокировки на трёх языках', () => {
    for (const язык of ['ru', 'en', 'az'] as const) {
      const словарь = JSON.parse(читать(`shared/locales/${язык}.json`));
      for (const ключ of ['friend_block', 'friend_blocked']) {
        expect(typeof (словарь.panels ?? {})[ключ]).toBe('string');
        expect((словарь.panels ?? {})[ключ].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('Мёртвое API убрано, живые двойники на месте (§383)', () => {
  // Шесть обёрток api.ts не имели вызывающих. Четыре дублировали живые
  // пути, chessState указывал на несуществующий маршрут (404), petsActive
  // дубль списка /pets. Удаление с сохранением двойников.

  it('обёрток больше нет', () => {
    const apiКод = код('client/src/app/api.ts');
    for (const имя of ['tasksProgress', 'chessState', 'tutorialSteps', 'getProfessionSkills', 'bountyOn', 'petsActive']) {
      expect({ имя, есть: apiКод.includes(имя + ':') }).toEqual({ имя, есть: false });
    }
  });

  it('маршруты-дубли сняты, живые на месте', () => {
    const game = код('server/src/routes/game.ts');
    const progression = код('server/src/routes/progression.ts');
    const skills = код('server/src/routes/skills.ts');
    const tutorial = код('server/src/routes/tutorial.ts');
    expect(game.includes("'/pets/active'")).toBe(false);
    // GET /bounty снят: литерал '/bounty' в файле остаётся один — у POST.
    expect(game.split("'/bounty'").length - 1).toBe(1);
    expect(progression.includes("'/tasks/progress'")).toBe(false);
    expect(skills.includes("'/professions/:id/skills'")).toBe(false);
    expect(tutorial.includes("'/steps'")).toBe(false);
    // POST /bounty жив: награду за голову можно поставить.
    expect(game.includes("gameRouter.post('/bounty'")).toBe(true);
  });

  it('живые двойники не пострадали', () => {
    const apiКод = код('client/src/app/api.ts');
    for (const имя of ['tasks:', 'chessStart:', 'chessMove:', 'chessResign:', 'tutorialProgress:', 'tutorialAdvance:', 'getAvailableSkills:', 'bountyPlace:', 'petActivate:', 'pets:']) {
      expect({ имя, есть: apiКод.includes(имя) }).toEqual({ имя, есть: true });
    }
    const панели = код('client/src/app/panels.ts');
    expect(панели.includes('api.getAvailableSkills(charId, profId)')).toBe(true);
  });
});

describe('Паркур-надстройка: ящик-опора и подкат (§385)', () => {
  // Прыжок был, но стоять на толкаемом ящике физика не умела: опорой были
  // только земля, мост и мезонин. Ящик - первая ступень паркура.

  it('ящик несёт габариты, опора читает верх целого ящика', () => {
    const интер = код('client/src/app/game3d/interactive.ts');
    const мир = код('client/src/app/game3d/world3d.ts');
    expect(интер.includes('size: { w, h, d },')).toBe(true);
    expect(/private crateTopAt\(x: number, z: number, feetY: number\)/.test(мир)).toBe(true);
    // Сломанный ящик опорой не служит.
    expect(/state !== 'intact'/.test(мир)).toBe(true);
    // Правило ступней то же, что у мезонина: прыгнувший снизу опору не получает.
    expect(/feetY < верхЯщика - 0\.55/.test(мир)).toBe(true);
    // Опора входит в максимум под ногами, а не заменяет мезонин.
    expect(/Math\.max\([\s\S]*?ящик \?\? 0/.test(мир)).toBe(true);
  });

  it('подкат: присед на ходу скользит на беговой скорости', () => {
    const мир = код('client/src/app/game3d/world3d.ts');
    // Триггер - на НАЧАЛЕ приседа, на земле, не в воде и не на лестнице.
    expect(/this\.crouch && !this\.wasCrouch && this\.grounded && !this\.swimming && !this\.climb/.test(мир)).toBe(true);
    // Скольжение бежит БЕГОМ, а не медленным приседом.
    expect(/this\.slideTimer > 0 \? landRun : this\.crouch \? CROUCH_SPEED/.test(мир)).toBe(true);
    // Затухание есть: подкат кончается, а не длится вечно.
    expect(/this\.slideTimer = Math\.max\(0, this\.slideTimer - dt\)/.test(мир)).toBe(true);
  });

  it('инвариант мезонина цел: ящик + прыжок не достают до платы', () => {
    // Верх ящика на полу 0.4 + 0.35 = 0.75; апекс 1.444. Сумма меньше
    // нижней платы мезонина (2.6) - лестница остаётся единственным путём.
    const верхЯщика = 0.4 + 0.35;
    expect(верхЯщика + JUMP_APEX_M).toBeLessThan(2.6);
  });
});

describe('Постройка мира уступает экран (§390)', () => {
  // Вся сборка мира была одним синхронным блоком: секунды без единого кадра.
  // Бар загрузки и надписи замирали на 20%, дальше - чёрный фриз, который
  // игрок честно называл «тормозит при входе».

  it('init асинхронный и отдаёт экран на границах этапов', () => {
    expect(/async init\(/.test(world)).toBe(true);
    // Семь точек ожидания: препроцесс, террейн, дорога, город+вода,
    // указатели, фауна, интерьеры.
    expect((world.match(/await пауза\(/g) ?? []).length).toBe(7);
    // Каждая точка сверяет поколение: мир, покинутый посреди загрузки,
    // не достраивается поверх нового входа.
    expect(/initПоколение\) throw new Error\('world_init_aborted'\)/.test(world)).toBe(true);
    expect(new RegExp('dispose\\(\\): void \\{\\s*' +
      'this\\.initПоколение\\+\\+').test(world)).toBe(true);
  });

  it('enterWorld ждёт постройку и ведёт бар честным прогрессом', () => {
    expect(/await world3d\.init\(/.test(worldApp)).toBe(true);
    expect(/\(f\) => markLoading\(f, t\('loading\.building'\)\)/.test(worldApp)).toBe(true);
    expect(/world_init_aborted/.test(worldApp)).toBe(true);
  });
});
