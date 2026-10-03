// 3D-экипировка: персонаж выглядел одинаково, что бы ни надел.
//
// ЧТО БЫЛО. Вид аватара выводился из класса, а не из того, что надето.
// В syncRigs для своего персонажа стояли две строки:
//
//   const hasWeapon = p.charClass !== 'sufi_mystic';
//   const hasShield = p.charClass === 'qizilbash';
//
// То есть суфий, купивший меч, ходил без меча, а кызылбаш без единого
// предмета — с мечом и щитом. Броня на вид вообще не влияла.
//
// При этом данные об экипировке были рядом и обновлялись: renderEquipment
// вызывается при надевании, снятии и открытии инвентаря, то есть правильное
// состояние всегда было под рукой — его просто никто не передавал в 3D.
//
// Отдельно: четыре метода World3D (equipPlayerWeapon, equipPlayerShield,
// isPlayerWeaponEquipped, isPlayerShieldEquipped) были написаны, но не
// вызывались нигде. Для чужих персонажей rig.equipWeapon работает, для
// своего — нет. Они удалены вместе с логикой «выводим из класса».
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const world3d = stripComments(read('client/src/app/game3d/world3d.ts'));
const rig = stripComments(read('client/src/app/game3d/rig.ts'));
const hud = stripComments(read('client/src/app/hud.ts'));
const world = stripComments(read('client/src/app/world.ts'));
const state = stripComments(read('client/src/app/state.ts'));

// Тело syncRigs — то место, где вид собирается
const sync = world3d.slice(world3d.indexOf('private syncRigs'), world3d.indexOf('private syncRigs') + 1600);

describe('Экипировка на аватаре берётся из надетого', () => {
  it('вид оружия решает надетое, а не класс', () => {
    // ГЛАВНОЕ. Раньше в syncRigs стояло hasWeapon = charClass !== 'sufi_mystic'
    // и это было единственное решение — навсегда, независимо от инвентаря
    expect(sync).toMatch(/b\.rig\.equipWeapon\(this\.localGear\.weapon\)/);
    // Класс остался только как «сервер ещё не ответил» — в ветке else
    const branches = sync.match(/equipWeapon\([^)]*\)/g) ?? [];
    expect({ вызовов: branches.length, все_из_надетого_или_ветка_else: branches.length === 2 })
      .toEqual({ вызовов: 2, все_из_надетого_или_ветка_else: true });
  });

  it('syncRigs применяет экипировку своего персонажа', () => {
    expect(sync).toMatch(/this\.localGear/);
    expect(sync).toMatch(/b\.rig\.equipWeapon\(this\.localGear\.weapon\)/);
  });

  it('экипировка применяется на каждом проходе, а не только при создании рига', () => {
    // Иначе игрок надел бы меч, а риг обновился бы только при входе в игру
    const creation = sync.slice(0, sync.indexOf('this.localGear'));
    expect(creation).not.toMatch(/equipWeapon/);
  });

  it('пока экипировка не пришла — вид класса, а не пустота', () => {
    // null означает «сервер ещё не ответил». Без этого ветвления игрок на
    // первых кадрах был бы голым, а потом внезапно с мечом
    expect(sync).toMatch(/else \{[\s\S]{0,160}equipWeapon\(p\.charClass !== 'sufi_mystic'\)/);
  });

  it('в сессии экипировка хранится', () => {
    expect(state).toMatch(/gear: null as null \| \{ weapon: boolean; armorColor: number \| null; swingSeconds: number \| null \}/);
  });
});

describe('Экипировка: броня видна на аватаре', () => {
  it('риг умеет перекрашивать грудь', () => {
    expect(rig).toMatch(/setArmorTint/);
    // Цвет класса возвращается, когда броню сняли: иначе остался бы след
    expect(rig).toMatch(/color \?\? cfg\.robe/);
  });

  it('все риги, кроме гуманоида, заглушку имеют', () => {
    // Каждый buildXxx обязан выполнить контракт Rig, иначе tsc не соберётся.
    // Проверяем, что заглушек ровно столько, сколько остальных ригов
    const noop = (rig.match(/setArmorTint\(\) \{\}/g) ?? []).length;
    const others = (rig.match(/equipWeapon\(\) \{\}/g) ?? []).length;
    expect({ заглушек: noop, остальных_ригов: others }).toEqual({ заглушек: others, остальных_ригов: others });
  });

  it('цвет брони берётся из редкости доспеха', () => {
    expect(hud).toMatch(/armorColor: armor \? parseInt\(/);
    expect(hud).toMatch(/RARITY_COLOR\[armor\.rarity\]/);
  });
});

describe('Экипировка: состояние доходит до 3D-слоя', () => {
  it('renderEquipment кладёт экипировку в сессию', () => {
    // renderEquipment вызывается при надевании, снятии и открытии инвентаря —
    // это единственное место, где состояние точно правильное
    expect(hud).toMatch(/session\.gear = \{/);
    expect(hud).toMatch(/weapon: equipped\.has\('weapon'\)/);
  });

  it('world.ts передаёт экипировку в 3D каждый кадр', () => {
    expect(world).toMatch(/setLocalGear\(session\.gear\)/);
  });

  it('экипировка загружается при входе в игру', () => {
    // Иначе до первого открытия инвентаря аватар носил классовое оружие
    const enter = world.slice(world.indexOf('export async function enterWorld'));
    expect(enter.slice(0, 4000)).toMatch(/loadInventory\(\)/);
  });
});

describe('Экипировка: мёртвые обёртки убраны', () => {
  it('четыре метода-обёртки больше не существуют', () => {
    // Для чужих персонажей rig.equipWeapon работает, для своего — нет:
    // обёртки были написаны, но не вызывались
    for (const name of ['equipPlayerWeapon', 'equipPlayerShield', 'isPlayerWeaponEquipped', 'isPlayerShieldEquipped']) {
      expect({ name, остался: new RegExp(`\\b${name}\\b`).test(world3d) }).toEqual({ name, остался: false });
    }
  });

  it('щит остался классовым — слота щита в игре нет', () => {
    // Слоты: weapon, armor, accessory. Щита среди них нет, поэтому «щит для
    // кызылбаша» — это решение, а не забытый код
    expect(sync).toMatch(/equipShield\(p\.charClass === 'qizilbash'\)/);
  });
});
