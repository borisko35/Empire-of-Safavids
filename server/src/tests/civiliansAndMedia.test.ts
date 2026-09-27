// Два бага из игрового мира: пустая панель загрузок и разбежавшиеся горожане.
//
// 1. ПАНЕЛЬ БЫЛА ПУСТОЙ. Список файлов вставлялся через replaceWith на сам
//    контейнер #media-list, когда вложенного списка ещё не было.
//    replaceWith ЗАМЕНЯЕТ элемент, а не дополняет его: контейнер с зоной
//    загрузки исчезал. Со второго открытия getElementById('media-list')
//    возвращал null, функция выходила сразу — и панель оставалась пустой
//    навсегда, при живом сервере и рабочих правах. Игрок видел пустоту и
//    не понимал, сломано ли что-то в игре.
//
//  2. ГУРЬЯНЕ РАЗБЕЖАЛИСЬ. Центр прогулки был жёстко зашит на город, а
//    л��вца переносила их к игроку дальше 200 м. Следующая цель всегда
//    оказывалась в городе, то есть за 200+ метров: горожане непрерывно шли
//    обратно через открытое поле, и игрок в поле видел их разбросанными по
//    холмам в разных стадиях перехода. Плюс итоговое выталкивание двигало
//    горожанина, но не поворачивало — со стороны это выглядело как ходьба
//    боком или скольжение задом.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const media = read('client/src/app/media.ts');
const index = read('client/src/app/index.html');
const civ = read('client/src/app/game3d/civilians.ts');

describe('Панель загрузок: контейнер не разрушается', () => {
  it('replaceWith не применяется к контейнеру панели', () => {
    // ГЛАВНАЯ ПОЛОМКА. replaceWith ЗАМЕНЯЕТ элемент, а не дополняет:
    // контейнер #media-list исчезал вместе с зоной загрузки
    expect(media).not.toMatch(/replaceWith\(/);
  });

  it('список вкладывается внутрь контейнера, а не заменяет его', () => {
    expect(media).toMatch(/box\.querySelector<HTMLElement>\('#media-items'\)/);
    expect(media).toMatch(/box\.append\(holder\)/);
  });

  it('при повторном открытии контейнер переиспользуется, а не ищется заново', () => {
    // Иначе второе открытие тихо ничего не рисует
    expect(media).toMatch(/if \(!holder\)/);
    expect(media).toMatch(/holder\.innerHTML = ''/);
  });

  it('зона загрузки рисуется сразу, не дожидаясь ответа сервера', () => {
    // Даже если сервер недоступен, игрок должен видеть зону перетаскивания
    const drop = media.indexOf("box.append(drop)");
    const fetchCall = media.indexOf("fetch(apiUrl('/api/admin/media')");
    expect({ dropAt: drop, fetchAt: fetchCall, dropFirst: drop > -1 && drop < fetchCall })
      .toEqual({ dropAt: expect.any(Number), fetchAt: expect.any(Number), dropFirst: true });
  });

  it('контейнер панели есть в разметке и не создаётся скриптом', () => {
    expect(index).toMatch(/id="media-list"/);
  });
});

describe('Горожане: не разбегаются по миру', () => {
  it('центр прогулки можно передать — по умолчанию это город', () => {
    // Раньше центр был зашит на CITY, и прогулки всегда шли в город
    expect(civ).toMatch(/function freeSpot\(cx: number, cz: number, homeX = CITY\.x, homeZ = CITY\.z\)/);
  });

  it('дом горожан — там, где игрок, а не всегда город', () => {
    const calls = [...civ.matchAll(/freeSpot\(/g)].length;
    // Определение + три вызова: у новичка и два на ходу. Два из трёх
    // обязаны получать позицию игрока, иначе снова будет побег в город
    const withPlayer = [...civ.matchAll(/freeSpot\(c\.group\.position\.x, c\.group\.position\.z, playerX, playerZ\)/g)].length;
    expect({ calls, withPlayer }).toEqual({ calls: expect.any(Number), withPlayer: 2 });
  });

  it('в городе прогулки остаются тесными, в поле — просторнее', () => {
    expect(civ).toMatch(/const inCity = Math\.hypot\(homeX - CITY\.x, homeZ - CITY\.z\) < HOME_R/);
    expect(civ).toMatch(/const span = inCity \? HOME_R : 46/);
  });

  it('горожанин не лезет под ноги игроку', () => {
    expect(civ).toMatch(/Math\.hypot\(x - cx, z - cz\) < 6/);
  });

  it('площадь и мечеть по-прежнему обходятся', () => {
    // Проверки не должны были ослабнуться из-за нового центра
    expect(civ).toMatch(/CITY\.x \+ 6/);
    expect(civ).toMatch(/Math\.abs\(x - CITY\.x\) < 14/);
    expect(civ).toMatch(/waterMask\(x, z\) > 0\.2/);
  });
});

describe('Горожане: не ходят боком и не скользят', () => {
  it('выталкивание поворачивает горожанина по фактическому сдвигу', () => {
    // ТУТ БЫЛО СКОЛЬЗЕНИЕ: итоговое выталкивание двигало, но не поворачивало
    expect(civ).toMatch(/if \(Math\.hypot\(safe\.x - c\.group\.position\.x, safe\.z - c\.group\.position\.z\) > 1e-3\)/);
    expect(civ).toMatch(/face\(c, safe\.x, safe\.z, dt\)/);
  });

  it('поворот идёт по фактическому сдвигу, а не по цели', () => {
    // Цель может быть за стеной: смотреть на неё бессмысленно.
    // Сдвиг передаётся вместе с dt — иначе скорость поворота зависит от
    // частоты кадров (проверка ниже)
    expect(civ).toMatch(/face\(c, safe\.x, safe\.z, dt\)/);
  });

  it('сглаживание поворота не зависит от частоты кадров', () => {
    // Раньше доля поворота была фиксированной на кадр (0.15): на 30 fps
    // поворот втрое медленнее, чем на 90, и горожане заметно доворачивали
    // задом, пока ноги уже шли вперёд
    expect(civ).not.toMatch(/rotation\.y \+= d \* 0\.\d+/);
    expect(civ).toMatch(/rotation\.y \+= d \* Math\.min\(1, dt \* \d+\)/);
  });

  it('во всех вызовах face передаётся dt', () => {
    // Забытый dt — это молчаливый возврат к покадровой скорости
    const calls = [...civ.matchAll(/face\(c, [^)]*\)/g)].map((m) => m[0]);
    expect({ calls: calls.length, allHaveDt: calls.every((c) => c.includes(', dt)')) })
      .toEqual({ calls: expect.any(Number), allHaveDt: true });
  });

  it('поворот умеет идти по кратчайшей дуге, а не через затылок', () => {
    expect(civ).toMatch(/while \(d > Math\.PI\) d -= Math\.PI \* 2/);
    expect(civ).toMatch(/while \(d < -Math\.PI\) d \+= Math\.PI \* 2/);
  });

  it('при ходьбе есть походка, иначе горожане «скользят»', () => {
    expect(civ).toMatch(/const swing = Math\.sin\(now \/ 130 \+ c\.phase\)/);
    expect(civ).toMatch(/c\.legL\.rotation\.x = swing/);
  });
});

describe('Горожане: перенос к игроку не видно', () => {
  it('перенос происходит при невидимом горожанине, а не на глазах', () => {
    // ГЛАВНАЯ НАХОДКА ПОСЛЕ freeSpotNear. Комментарий в коде утверждал, что
    // перенос на 200 м «за пределами видимости, дальность прорисовки ~150 м».
    // Проверили по коду: camera.far = 1600, туман прячет на 240-850 м.
    // То есть 200 м — видимая зона, и игрок видел, как фигурка исчезает с
    // холма и появляется под боком. Скрываем ДО переноса
    const hideAt = civ.indexOf('c.group.visible = false;');
    const moveAt = civ.indexOf('c.group.position.x = p.x;');
    expect({ hideFirst: hideAt > -1 && hideAt < moveAt })
      .toEqual({ hideFirst: true });
  });

  it('порог переноса вынесен в константу с честным числом', () => {
    // Не «200 зашито в коде с объяснением, почему это не видно», а именованное
    // значение рядом с описанием настоящей дальности прорисовки
    expect(civ).toMatch(/const LEASH = 200/);
    expect(civ).toMatch(/if \(dist < LEASH\) continue/);
  });

  it('комментарий не врёт про дальность прорисовки', () => {
    // Чтобы та же ошибка не вернулась: если в коде снова появится
    // «дальность прорисовки ~150 м», тест упадёт
    expect(civ).not.toMatch(/дальность прорисовки у нас ~150/);
    expect(civ).toMatch(/camera\.far = 1600/);
  });

  it('перенесённый горожанин проявляется, а не остаётся невидимым навсегда', () => {
    // Забытый возврат visible = true — исчезнувший NPC. Раньше такой
    // проверки не было: скрытия в коде не существовало вовсе
    expect(civ).toMatch(/hiddenUntil/);
    expect(civ).toMatch(/if \(now < c\.hiddenUntil\) continue;/);
    expect(civ).toMatch(/c\.group\.visible = true;/);
  });

  it('новый горожанин начинает видимым, а не с нулевого hiddenUntil-флага', () => {
    expect(civ).toMatch(/hiddenUntil: 0,/);
  });
});

describe('Горожане: перенос ставит людей рядом, а не на горизонт', () => {
  it('расстояние переноса 13-38 м, а не 70-110', () => {
    // ТУТ БЫЛИ ФИГУРКИ НА ХОЛМАХ. Перенос ставил всех в кольцо 70-110 м от
    // игрока. Это не «рядом», это дальняя кромка видимости: все 22 человека
    // стояли понаспахту на горизонте, отдельно друг от друга, и издалека
    // поле выглядело испорченным. Замер средней дистанции между соседями:
    // было 117 м, стало 30 м
    expect(civ).toMatch(/const r = 13 \+ Math\.random\(\) \* 25/);
    expect(civ).not.toMatch(/const r = 70 \+ Math\.random\(\) \* 40/);
  });

  it('запасной вариант тоже рядом, а не в 70 м', () => {
    // Когда все 14 попыток запрещены водой или постройками, возвращается
    // запасная точка — раньше она тоже была в 70 м
    expect(civ).toMatch(/return \{ x: px \+ 16, z: pz \};/);
    expect(civ).not.toMatch(/return \{ x: px \+ 70, z: pz \};/);
  });

  it('в коде осталось объяснение, почему радиус уменьшили', () => {
    expect(civ).toMatch(/ТУТ БЫЛА ПРИЧИНА, ПОЧЕМУ ГОРЖАНЕ ВЫГЛЯДЕЛИ РАЗБРОСАННЫМИ ПО ХОЛМАМ/);
  });
});
