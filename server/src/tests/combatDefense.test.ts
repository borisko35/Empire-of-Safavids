// Проверки механики защиты и параметров оружия — настоящим запуском кода.
//
// ПОЧЕМУ ПРОВЕРЯЕМ ИМЕННО ЭТО. Механика блока и уклонения существовала на
// сервере, но клиент её никогда не вызывал: ПКМ менял только позу на экране.
// То есть игрок не мог ни заблокировать, ни уклониться, а все проверки были
// зелёные. Проверка «есть ли activateDodge в коде» нашла бы и работающую, и
// сломанную версию одинаково. Поэтому здесь запускается код: смотрим, что
// защита реально срабатывает, откат работает, а блок и уклонение не могут
// висеть одновременно.
import { DefenseStates } from '../systems/DefenseStates';
import { CombatService } from '../services/CombatService';
import { DEFAULT_WEAPON } from '../services/EquipmentCache';
import { ITEMS_DATABASE } from '../data/items';
import { ItemType, CharacterClass } from '../types/game.types';
import type { Character, CharacterStats } from '../types/game.types';

const id = 'c1';

function makeChar(over: Partial<Character> = {}): Character {
  const stats: CharacterStats = { strength: 10, agility: 10, intelligence: 5, endurance: 5, charisma: 5 };
  return {
    id,
    name: 'Tester',
    class: CharacterClass.QIZILBASH,
    level: 10,
    stats,
    ...over,
  } as Character;
}

describe('Защита: то, чего нельзя было сделать в игре', () => {
  it('блок реально гасит урон', () => {
    const d = new DefenseStates();
    expect(d.getIncomingMultiplier(id)).toBe(1);
    d.activateBlock(id);
    // Раньше это состояние было недостижимо из клиента: activateBlock
    // вызывался только сервером по событию, которое клиент не отправлял
    expect(d.getIncomingMultiplier(id)).toBeLessThan(1);
  });

  it('уклонение отменяет весь входящий урон', () => {
    const d = new DefenseStates();
    expect(d.activateDodge(id)).toBe(true);
    expect(d.getIncomingMultiplier(id)).toBe(0);
    expect(d.isDodging(id)).toBe(true);
  });

  it('рывок откатывается: без отката его можно было бы держать постоянно', () => {
    // Ключевая защита: раньше отката не было вовсе, и регенерация стамины
    // позволяла включать неуязвимость снова и снова
    const d = new DefenseStates();
    expect(d.activateDodge(id)).toBe(true);
    expect(d.activateDodge(id)).toBe(false);
    expect(d.isDodgeOnCooldown(id)).toBe(true);
    // Через откат снова можно
    expect(d.activateDodge(id, Date.now() + 1000)).toBe(true);
  });

  it('блок и уклонение не действуют одновременно', () => {
    // Проверяем через isBlocking, а не через getIncomingMultiplier: там сначала
    // смотрится неуязвимость, и при активном рывке она равна 0 независимо от
    // того, погасил ли рывок щит. Через множитель это правило проходило бы
    // и при выключенном сбросе, то есть не проверяло бы ничего.
    const d = new DefenseStates();
    d.activateBlock(id);
    expect(d.isBlocking(id)).toBe(true);
    expect(d.activateDodge(id)).toBe(true);
    expect({ рывок: d.isDodging(id), щит: d.isBlocking(id) }).toEqual({ рывок: true, щит: false });

    const d2 = new DefenseStates();
    d2.activateDodge(id);
    d2.activateBlock(id);
    expect({ рывок: d2.isDodging(id), щит: d2.isBlocking(id) }).toEqual({ рывок: false, щит: true });
  });

  it('несостоявшийся рывок снимает откат (стамины не хватило)', () => {
    // Без этого игрок ждал бы отката за действие, которого не было
    const d = new DefenseStates();
    d.activateDodge(id);
    d.clearDodge(id);
    expect(d.activateDodge(id)).toBe(true);
  });
});

describe('Досягаемость удара', () => {
  it('в пределах досягаемости удар проходит', () => {
    const d = new DefenseStates();
    d.setPosition('a', { x: 0, y: 0, z: 0 });
    expect(d.canReach('a', 2.4, { x: 1.5, y: 0, z: 0 })).toBe(true);
  });

  it('через полкарты удар не проходит', () => {
    // До этого проверки не было вообще: сервер принимал удар по жертве
    // на любом расстоянии, достаточно было назвать её id
    const d = new DefenseStates();
    d.setPosition('a', { x: 0, y: 0, z: 0 });
    expect(d.canReach('a', 2.4, { x: 40, y: 0, z: 0 })).toBe(false);
  });

  it('запас на сетевую задержку есть, иначе честный удар отклонялся бы', () => {
    // Позиция приходит пакетами, между ними игрок успевает сместиться.
    // 3.0 при дальности 2.4 - это 0.6 в запас, укладывается
    const d = new DefenseStates();
    d.setPosition('a', { x: 0, y: 0, z: 0 });
    expect(d.canReach('a', 2.4, { x: 3.0, y: 0, z: 0 })).toBe(true);
  });

  it('без известной позиции удар не отбрасывается', () => {
    // Первым ударом после входа позиции в памяти ещё нет - отбрасывать
    // его нельзя, иначе игрок не смог бы начать бой
    const d = new DefenseStates();
    expect(d.canReach('a', 2.4, { x: 100, y: 0, z: 0 })).toBe(true);
    expect(d.canReach('a', 2.4, null)).toBe(true);
  });

  it('досягаемость оружия в руках влияет на проверку', () => {
    // Разница между саблей (2.5) и клинком Шаха (2.7) реальна: с запасом
    // 0.8 окна равны 3.3 и 3.5, то есть на расстоянии между ними сабля не
    // достаёт, а клинок достаёт. При прежнем запасе в 1.5 окна были бы
    // 4.0 и 4.2, и проверить разницу было бы нечем - тест на это и упал.
    const d = new DefenseStates();
    d.setPosition('a', { x: 0, y: 0, z: 0 });
    expect(d.canReach('a', 2.5, { x: 3.4, y: 0, z: 0 })).toBe(false);
    expect(d.canReach('a', 2.7, { x: 3.4, y: 0, z: 0 })).toBe(true);
  });
});

describe('Оружие наконец влияет на урон', () => {
  it('у всех видов оружия объявлены урон, скорость и дальность', () => {
    // До этого поля не было вовсе: у предмета не было ни урона, ни дальности,
    // ни скорости, поэтому все виды оружия били одинаково.
    //
    // Проверка собирает список виновников и сверяет его целиком. Поштучная
    // проверка expect на каждом предмете падала бы на первом же, но с
    // toEqual на весь список видно сразу все - и, что важнее, видно имя
    // предмета, у которого полей нет.
    const weapons = Object.values(ITEMS_DATABASE).filter(i => i.type === ItemType.WEAPON);
    expect(weapons.length).toBeGreaterThan(0);
    const withoutProfile = weapons
      .filter(w => !w.weapon || !(w.weapon.damage > 0) || !(w.weapon.speed > 0) || !(w.weapon.range > 1))
      .map(w => w.id);
    expect({ без_параметров_удара: withoutProfile }).toEqual({ без_параметров_удара: [] });
  });

  it('сильное оружие бьёт сильнее, и это видно на уроне', () => {
    const cs = new CombatService();
    const attacker = makeChar();
    // Клинок Шаха (1.25) против сабли кызылбаша (1.05) при равных статах
    const weak = cs.getBaseDamageWithWeapon(attacker, { itemId: 'wpn_qizilbash_saber', damage: 1.05, speed: 0.42, range: 2.5 });
    const strong = cs.getBaseDamageWithWeapon(attacker, { itemId: 'wpn_shah_blade', damage: 1.25, speed: 0.38, range: 2.7 });
    expect(strong).toBeGreaterThan(weak);
    // Разница должна быть соразмерна заявленной, а не случайной
    expect(strong / weak).toBeCloseTo(1.25 / 1.05, 5);
  });

  it('без оружия в руках урон не ломается', () => {
    const cs = new CombatService();
    const attacker = makeChar();
    const bare = cs.getBaseDamageWithWeapon(attacker, null);
    expect(bare).toBeGreaterThan(0);
    // Умолчание — множитель 1, то есть голый кулак не хуже и не лучше
    const withDefault = cs.getBaseDamageWithWeapon(attacker, { itemId: 'none', ...DEFAULT_WEAPON });
    expect(bare).toBe(withDefault);
  });
});
