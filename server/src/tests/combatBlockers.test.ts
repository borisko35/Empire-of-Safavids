// Баг анти-чита: законный удар объявлялся подделкой, а игрок получал перманентный бан.
//
// ЧТО БЫЛО СЛОМАНО. Анти-чит сверяет нанесённый урон с базой и отбрасывает
// слишком большой: порог MAX_DAMAGE_MULTIPLIER = 15, а мера 3 в
// AntiCheatSystem означает перманентный бан. База при этом считалась НЕ ТЕМ,
// из чего считался урон:
//
//  1. БЕЗ ОРУЖИЯ. База — удар как без оружия (1.0), урон — с оружием в руках.
//     Клинок Исмаила даёт 1.4, то есть база занижена в 1.4 раза.
//
//  2. БЕЗ НАВЫКА. База бралась как ОБЫЧНАЯ АТАКА, а множитель навыка берётся
//     только при actionType === 'skill'. «Орлиный взор» с множителем 8 давал
//     отношение 8, а с критом (1.5), зикром (1.25), едой (1.05) и клинком
//     Исмаила (1.4) — 8 * 1.5 * 1.3 * 1.4 = 21.84. Это выше порога 15.
//
// ПОЧЕМУ ЭТО НЕ «АНТИЧИТ СЛИШКОМ СТРОГИЙ». Античит не обязан отличать читера от
// вложившегося игрока; он обязан отсекать невозможное. Отношение 21 к базе,
// посчитанной по другим правилам, чем сам урон, возможно законно.
//
// ЧТО ПРОВЕРЯЕТСЯ. Считается НАСТОЯЩИЙ урон через настоящий CombatService, с
// критом, гарантированным подставленным генератором, и сравнивается с обеими
// базами: новой (с навыком, оружием, цепочкой и стойкой) и старой. Проверка
// требует, чтобы честный удар проходил, а старая база его отклоняла — то есть
// чтобы баг был настоящим, а не предположением. Все множители берутся из
// настоящих таблиц игры (стойки, профессии, баффы), а не вписываются руками:
// если игру поменяют, проверка пересчитает вывод сама.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CombatService } from '../services/CombatService';
import { AntiCheatSystem } from '../systems/AntiCheatSystem';
import { STANCES } from '../systems/CombatStance';
import { professionBonuses, PROFESSION_MAX_LEVEL } from '../systems/ProfessionBonuses';
import { BUFFS } from '../services/BuffService';
import type { WeaponProfile } from '../services/EquipmentCache';
import { CharacterClass, type Character, type CombatAction } from '../types/game.types';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

function must(условие: unknown, причина: string): asserts условие {
  if (!условие) throw new Error(причина);
}

const сокет = читать('server/src/socket/GameSocketHandler.ts');
const клиент = читать('client/src/app/world.ts');

/** Лучник для «Орлиного взора»: большая ловкость, чтобы крит был гарантирован. */
function персонаж(класс: CharacterClass, ловкость: number): Character {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    name: 'Боец',
    class: класс,
    level: 1,
    // Характеристики лежат в поле stats — именно к нему лезет CombatService.
    stats: { strength: 10, agility: ловкость, intelligence: 5, endurance: 10, charisma: 5 },
    hp: 100,
    maxHp: 100,
    gold: 0,
    pos: { x: 0, y: 0, z: 0 },
  } as unknown as Character;
}

/** Клинок Исмаила: 1.4 — самое высокое отношение урона к оружию в игре. */
const КЛИНОК: WeaponProfile = { damage: 1.4, speed: 0.38, range: 2.7 } as WeaponProfile;

/**
 * Порог допустимого отношения урона к базе.
 *
 * Не экспортирован: расширять поверхность модуля ради одной проверки не хочется,
 * поэтому читаем число из файла — и тут же убеждаемся, что сравнение с ним в
 * коде есть, иначе «прочитанное» ничего бы не значило.
 */
const ПОРОГ_УРОНА = (() => {
  const исходник = читать('server/src/systems/AntiCheatSystem.ts');
  const найдено = /const MAX_DAMAGE_MULTIPLIER = ([\d.]+);/.exec(исходник);
  must(найдено, 'в AntiCheatSystem нет порога MAX_DAMAGE_MULTIPLIER');
  must(
    /multiplier > MAX_DAMAGE_MULTIPLIER/.test(исходник),
    'в AntiCheatSystem нет сравнения с порогом: константа уплыла в никуда'
  );
  return Number(найдено![1]);
})();

/**
 * Множитель урона от всех баффов разом, как считает их игра.
 *
 * BuffService.getDamageMultiplier СУММИРУЕТ проценты всех живых баффов с
 * префиксом buff_damage_, поэтому еда (+5, действует 600 секунд) и зикр (+25,
 * 30 секунд) складываются в +30. Отсюда важность обеих: по отдельности стек не
 * дотягивал до порога, а вместе — переходил.
 */
const БАФФЫ = (() => {
  const проценты = Object.keys(BUFFS)
    .filter((id) => id.startsWith('buff_damage_'))
    .reduce((сумма, id) => сумма + Number(BUFFS[id].magnitude), 0);
  must(
    проценты >= 30,
    `сумма баффов на урон ${проценты}%, а расчёт в проверке ждёт не меньше 30: ` +
      'значения в баффах поменялись, и порог мог перестать достигаться'
  );
  return 1 + проценты / 100;
})();

/**
 * Настоящий удар из настоящего CombatService.
 *
 * Порядок случайных чисел в calculateDamage задан: уклонение, затем блок, затем
 * крит. Но блок проверяется только для обычной атаки — у навыка этой проверки
 * нет, — поэтому номер броска, на котором выпадает крит, разный: второй для
 * навыка и третий для атаки. Поэтому он передаётся явно, а результат
 * проверяется: если порядок в бою поменяется, проверка упадёт с «крит не
 * выпал», а не посчитает не то.
 *
 * Все прочие броски возвращают 50, то есть уклонение и блок не срабатывают:
 * проверка не должна зависеть от того, выпал ли урон.
 */
function удар(
  боец: Character,
  жертва: Character,
  действие: CombatAction,
  бросокКрита: number,
  comboMultiplier = 1,
  damageScale = 1
): number {
  let вызов = 0;
  const случайный = jest.spyOn(Math, 'random').mockImplementation(() => {
    вызов++;
    return вызов === бросокКрита ? 0 : 50;
  });
  try {
    const результат = new CombatService().calculateDamage(
      боец,
      жертва,
      действие,
      comboMultiplier,
      КЛИНОК,
      damageScale
    );
    must(
      результат.isCritical,
      `крит не выпал, хотя бросок подставлен: урон ${результат.damage} посчитан ` +
        'без крита, и проверка считала бы не то, что происходит в бою'
    );
    // Дальше сокет-обработчик домножает на множитель баффов, и уже потом
    // смотрит анти-чит. Повторяем ровно его порядок.
    return Math.floor(результат.damage * БАФФЫ);
  } finally {
    случайный.mockRestore();
  }
}

describe('Анти-чит: законный удар не должен банить', () => {
  it('«Орлиный взор» с критом проходит проверку', () => {
    const боец = персонаж(CharacterClass.PERSIAN_ARCHER, 30);
    const жертва = персонаж(CharacterClass.QIZILBASH, 0);
    const действие = { actionType: 'skill', skillId: 'arch_ultimate' } as unknown as CombatAction;

    const combat = new CombatService();
    const база = combat.getBaseDamageForAnticheat(боец, действие, КЛИНОК);
    const отношение = удар(боец, жертва, действие, 2) / база;

    must(
      отношение < ПОРОГ_УРОНА,
      `«Орлиный взор» с критом дал отношение ${отношение.toFixed(2)} при пороге ` +
        `${ПОРОГ_УРОНА}: игрока банят за честный удар`
    );
  });

  it('старая база этот же удар отклоняла — баг был настоящий', () => {
    const боец = персонаж(CharacterClass.PERSIAN_ARCHER, 30);
    const жертва = персонаж(CharacterClass.QIZILBASH, 0);
    const действие = { actionType: 'skill', skillId: 'arch_ultimate' } as unknown as CombatAction;

    const отношениеСтарое =
      удар(боец, жертва, действие, 2) / new CombatService().getBaseDamageFor(боец);
    must(
      отношениеСтарое > ПОРОГ_УРОНА,
      `старая база дала отношение ${отношениеСтарое.toFixed(2)} и НЕ превысила порог ` +
        `${ПОРОГ_УРОНА}: значит бан не воспроизводится и правка ни о чём`
    );
  });

  it('полный стек воина на 50 уровне проходит проверку', () => {
    // Худший законный случай: обычная атака (цеплка считается), стойка серпа,
    // профессия воина на максимуме, клинок Исмаила, крит, еда и зикр сразу.
    // Множители берутся из настоящих таблиц, а не вписываются здесь.
    const стойка = STANCES.sickle_dance;
    const профессия = professionBonuses('warrior', PROFESSION_MAX_LEVEL);
    const damageScale = стойка.damage * профессия.damage;

    const боец = персонаж(CharacterClass.QIZILBASH, 30);
    const жертва = персонаж(CharacterClass.QIZILBASH, 0);
    const действие = { actionType: 'attack' } as unknown as CombatAction;

    const combat = new CombatService();
    const chain = 1.5 * стойка.combo; // третий удар серии — как в бою
    const база = combat.getBaseDamageForAnticheat(боец, действие, КЛИНОК, chain, damageScale);
    const отношение =
      удар(боец, жертва, действие, 3, chain, damageScale) / база;

    must(
      отношение < ПОРОГ_УРОНА,
      `полный стек дал отношение ${отношение.toFixed(2)} при пороге ${ПОРОГ_УРОНА}: ` +
        'игрока банят за полностью законный удар'
    );
  });

  it('настоящая подделка по-прежнему ловится', () => {
    // Правка базы не должна была сделать анти-чит бесполезным: урон в 20 раз
    // выше законного — это ровно то, ради чего проверка существует.
    const античит = new AntiCheatSystem();
    const боец = персонаж(CharacterClass.QIZILBASH, 30);
    const действие = { actionType: 'attack' } as unknown as CombatAction;
    const база = new CombatService().getBaseDamageForAnticheat(боец, действие, КЛИНОК);

    const подделка = античит.validateDamage(боец.id, Math.floor(база * 20), база);
    must(!подделка.valid, 'анти-чит перестал ловить подделку урона в 20 раз выше базы');

    const честно = античит.validateDamage(боец.id, Math.floor(база * 2), база);
    must(честно.valid, 'анти-чит отклонил урон вдвое выше базы, то есть за обычный сильный удар');
  });

  it('обе точки проверки считают базу так же, как урон', () => {
    // Раньше база бралась без оружия и без навыка. Сейчас обе точки передают
    // действие, оружие, цепочку и стойку: иначе одна из них продолжила бы
    // банчить за честный удар.
    const новых =
      (сокет.match(/getBaseDamageForAnticheat\(attacker, action, weapon, comboMult, damageScale\)/g) || [])
        .length;
    must(новых === 2, `вызовов новой базы ${новых}, ожидалось 2: PvP и PvE`);
    must(
      !/getBaseDamageFor\(attacker\)/.test(сокет),
      'база без оружия и без навыка осталась в бою: крит снова объявляется подделкой'
    );
  });

  it('функция базы больше не висит без дела', () => {
    must(
      /getBaseDamageForAnticheat\(/.test(читать('server/src/services/CombatService.ts')),
      'функция базы анти-чита пропала из CombatService'
    );
  });
});

describe('Отказ в бою должен быть виден игроку', () => {
  it('клиент читает код, а не несуществующее поле message', () => {
    must(
      /socket\.on\('combat:error', \(данные: \{ code\?: string; message\?: string \}\) =>/.test(клиент),
      'обработчик combat:error не читает код причины: игрок снова увидит пустую плашку'
    );
    must(
      /const код = данные\?\.code \?\? '';/.test(клиент),
      'код причины не читается из ответа сервера'
    );
    must(
      !/socket\.on\('combat:error', \(\{ message \}/.test(клиент),
      'обработчик всё ещё читает только message, которого сервер не шлёт'
    );
  });

  it('известный код переводится, а пустой ответ не показывается', () => {
    must(
      /isCombatErrorCode\(код\)/.test(клиент) && /COMBAT_ERROR_KEYS\[код\]/.test(клиент),
      'код отказа не переводится на язык игрока'
    );
    must(
      /if \(!код && !текст\) \{/.test(клиент),
      'при пустом ответе показывается пустая плашка: молчание честнее'
    );
  });

  it('сервер действительно шлёт код, а не текст', () => {
    const кодов = (сокет.match(/COMBAT_ERROR, \{ code: /g) || []).length;
    must(
      кодов > 10,
      `мест с кодом отказа всего ${кодов}: клиент чинит не то поле или не то место`
    );
  });
});