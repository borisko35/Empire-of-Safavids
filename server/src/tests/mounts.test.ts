// Верхом: купленный скакун не давал скорости.
//
// ЧТО БЫЛО. MountSystem.getMountSpeed написан и корректен — линейная
// интерполяция от baseSpeed к maxSpeed по уровню скакуна. Его не вызывал
// НИКТО. addMountExperience, который растит уровень, тоже не вызывался
// нигде. Кнопка «Верхом» в конюшне работала: ставила is_active = TRUE в
// character_mounts. Дальше это значение не читал никто.
//
// Итог: игрок покупал коня, активировал его, и персонаж двигался ровно так
// же, как без него. Ровно тот случай, когда кнопка выглядит рабочей и
// ничего не делает.
//
// ВТОРАЯ ПОЛОМКА, короче первой. У клиента была своя копия таблицы
// скакунов MOUNT_DEFS — на три записи из шести, и без уровня. Боевой слон,
// Симург и корабль показывались в конюшне без описания. Теперь скорость и
// названия считает и присылает сервер.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const mountSystem = stripComments(read('server/src/systems/MountSystem.ts'));
const antiCheat = stripComments(read('server/src/systems/AntiCheatSystem.ts'));
const socketHandler = stripComments(read('server/src/socket/GameSocketHandler.ts'));
const world3d = stripComments(read('client/src/app/game3d/world3d.ts'));
const world = stripComments(read('client/src/app/world.ts'));
const panels = stripComments(read('client/src/app/panels.ts'));
const routes = stripComments(read('server/src/routes/game.ts'));

describe('Верхом: скорость скакуна применяется', () => {
  it('getMountSpeed зовётся сервером', () => {
    // ГЛАВНОЕ. Раньше вызова не было ни одного
    expect(mountSystem).toMatch(/getActiveMount[\s\S]{0,900}this\.getMountSpeed\(/);
  });

  it('скорость активного скакуна находит потребителя', () => {
    expect(mountSystem).toMatch(/async getActiveMount\(/);
    expect(socketHandler).toMatch(/this\.mounts\.getActiveMount\(/);
  });

  it('клиент двигает персонажа со скоростью скакуна', () => {
    // Пешие числа — константы. Скорость скакуна обязана где-то подмешиваться
    // в итоговую, иначе игрок едет по-старому
    expect(world3d).toMatch(/this\.mountSpeed/);
    const land = world3d.slice(world3d.indexOf('landWalk'));
    expect(land.slice(0, 400)).toMatch(/const speed/);
  });

  it('скорость приходит с сервера, а не из таблицы на клиенте', () => {
    // Копии таблицы скакунов на клиенте больше нет
    expect(panels).not.toMatch(/MOUNT_DEFS/);
    expect(mountSystem).toMatch(/name_ru/);
    expect(mountSystem).toMatch(/base_speed/);
  });

  it('world.ts отдаёт скорость 3D-слою каждый кадр', () => {
    // Иначе игрок призывает коня, а едет по-старому до перезахода
    expect(world).toMatch(/setMountSpeed\(session\.mount\?\.speed \?\? 0\)/);
  });

  it('скакун применяется сразу при входе в игру, а не после захода в конюшню', () => {
    expect(world).toMatch(/loadActiveMount\(\)/);
    expect(panels).toMatch(/export async function loadActiveMount\(/);
  });
});

describe('Верхом: предел античита считается по скакуну', () => {
  it('validateMovement принимает разрешённую скорость', () => {
    // Один предел на всех был ловушкой: игрок на Симурге (16 м/с) ловил
    // speed_hack за честную езду
    expect(antiCheat).toMatch(/maxSpeed: number = MAX_SPEED/);
    expect(antiCheat).toMatch(/maxSpeed \* 1\.3/);
  });

  it('проверка движения вызывается со скоростью скакуна', () => {
    expect(socketHandler).toMatch(/MOUNT_ANTICHEAT_CAP_FLOOR \+ mountSpeed/);
  });

  it('скорость берётся из character_mounts, а не из пакета игрока', () => {
    // Проверяем по коду: нигде рядом с validateMovement нет data.position
    // в качестве источника предела
    const call = socketHandler.slice(
      socketHandler.indexOf('MOUNT_ANTICHEAT_CAP_FLOOR + mountSpeed') - 400,
      socketHandler.indexOf('MOUNT_ANTICHEAT_CAP_FLOOR + mountSpeed') + 120
    );
    expect(call).toMatch(/this\.mountSpeeds\.get\(characterId\)/);
  });

  it('кеш скорости не живёт вечно — он обновляется при движении', () => {
    // Иначе игрок сменил скакуна и до перезахода ехал на старой скорости —
    // и античит ругался бы на честную езду
    expect(socketHandler).toMatch(/refreshMountSpeed\(characterId\)/);
    expect(socketHandler).toMatch(/this\.mountSpeeds\.delete\(socket\.characterId\)/);
  });
});

describe('Верхом: скакун растёт', () => {
  it('опыт начисляется из обработчика движения, а не только описан в методе', () => {
    // ГЛАВНОЕ для этого блока. Проверка одного лишь addMountExperience
    // обманывала: он есть в теле метода и продолжает там быть, даже если
    // метод никто не вызывает. Нужна точка вызова — в обработчике движения
    expect(socketHandler).toMatch(/await this\.grantMountExperience\(characterId, data\.position\)/);
    expect(socketHandler).toMatch(/this\.mounts\.addMountExperience\(/);
  });

  it('опыт идёт за пройденный путь, а не за время', () => {
    // Стоящий на месте игрок не должен качать скакуна
    expect(socketHandler).toMatch(/Math\.hypot\(pos\.x - last\.x, pos\.z - last\.z\)/);
    expect(socketHandler).toMatch(/Math\.floor\(meters \/ 10\)/);
  });

  it('пешком опыта скакуну не идёт', () => {
    // Иначе можно было бы накачать коня стоя на месте
    expect(socketHandler).toMatch(/if \(!mount\?\.mountId\) return/);
  });
});

describe('Верхом: конюшня показывает своих скакунов', () => {
  it('свои скакуны перечисляются, а не только заголовок', () => {
    // Раньше рисовался только заголовок «Ваши скакуны (N)», а строки — лишь
    // для товаров конюшни. Конь из боевого пропуска не продаётся, значит
    // надеть его было нечем
    const fn = panels.slice(panels.indexOf('export async function loadMounts'));
    expect(fn.slice(0, 3000)).toMatch(/for \(const m of owned\)/);
  });

  it('нет кнопки «Продать», которая ничего не продаёт', () => {
    // Была кнопка «Продать», которая показывала тост «Скакун продан» и
    // ничего не делала. Маршрута продажи скакуна нет вовсе
    const fn = panels.slice(panels.indexOf('export async function loadMounts'));
    expect(fn.slice(0, 4000)).not.toMatch(/Продать/);
  });

  it('маршрут отдаёт посчитанную скорость', () => {
    expect(routes).toMatch(/listForPlayer/);
  });
});
