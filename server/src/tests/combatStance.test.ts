// Проверки боевых стоек и парирования — настоящим запуском кода.
//
// Проверяется смысл, а не наличие строк. «В файле есть слово sickle_dance» не
// говорит ни о чём: строка может быть в комментарии или в неиспользуемом
// объекте. Здесь запускаются расчёты и сравниваются числа.
import { DefenseStates } from '../systems/DefenseStates';
import { STANCES, isCombatStance, type CombatStance } from '../systems/CombatStance';
import { CombatService } from '../services/CombatService';
import { Character, CharacterClass, CharacterStats } from '../types/game.types';

const id = 'c1';

function makeChar(over: Partial<Character> = {}): Character {
  const stats: CharacterStats = { strength: 10, agility: 10, intelligence: 5, endurance: 5, charisma: 5 };
  return { id, name: 'Tester', class: CharacterClass.QIZILBASH, level: 10, stats, ...over } as Character;
}

describe('Стойки: каждая должна чего-то стоить', () => {
  it('все четыре стойки объявлены и опознаются', () => {
    const ids: CombatStance[] = ['balanced', 'sickle_dance', 'shah_shield', 'mounted_archery'];
    expect({ столько_стоек: ids.filter(i => isCombatStance(i)).length }).toEqual({ столько_стоек: 4 });
    expect({ неизвестная_опознаётся: isCombatStance('nosuchstance') }).toEqual({ неизвестная_опознаётся: false });
  });

  it('«Танец серпа» быстрее и злее обычного, но почти без защиты', () => {
    const s = STANCES.sickle_dance;
    const b = STANCES.balanced;
    expect({ быстрее: s.attackSpeed > b.attackSpeed, злее: s.damage > b.damage }).toEqual({ быстрее: true, злее: true });
    // Если щит держал бы сколько-то прилично, стиль был бы «просто лучшим»
    expect({ щит_хуже: s.blockReduction < b.blockReduction }).toEqual({ щит_хуже: true });
    expect({ щит_в_раве_держит_четверть: s.blockReduction }).toEqual({ щит_в_раве_держит_четверть: 0.25 });
  });

  it('«Шахский щит» держит удар и стоит копейку, но бьёт слабее', () => {
    const s = STANCES.shah_shield;
    const b = STANCES.balanced;
    expect({ щит_крепче: s.blockReduction > b.blockReduction, дешевле: s.blockStamina < b.blockStamina })
      .toEqual({ щит_крепче: true, дешевле: true });
    expect({ урон_ниже: s.damage < b.damage }).toEqual({ урон_ниже: true });
    expect({ замах_медленнее: s.attackSpeed < b.attackSpeed }).toEqual({ замах_медленнее: true });
  });

  it('конная стрельба доступна только верхом', () => {
    expect({ нужен_скакун: STANCES.mounted_archery.requiresMount }).toEqual({ нужен_скакун: true });
    // Остальные стойки верхом не требуют: иначе смена стиля ломалась бы на
    // пеших новобранцах
    for (const s of ['balanced', 'sickle_dance', 'shah_shield'] as CombatStance[]) {
      expect({ стойка: s, требует_скакун: STANCES[s].requiresMount }).toEqual({ стойка: s, требует_скакун: false });
    }
  });

  it('ни одна стойка не лучше обычной по всем статьям сразу', () => {
    // Проверка на «идеальный стиль»: если стойка выигрывает по всем
    // показателям, одна из них станет единственным выбором и стойки
    // перестанут быть выбором
    for (const s of Object.values(STANCES)) {
      if (s.id === 'balanced') continue;
      const betterOrEqual =
        s.damage >= STANCES.balanced.damage &&
        s.attackSpeed >= STANCES.balanced.attackSpeed &&
        s.blockReduction >= STANCES.balanced.blockReduction &&
        s.blockStamina <= STANCES.balanced.blockStamina;
      expect({ стойка: s.id, лучше_ли_во_всём: betterOrEqual }).toEqual({ стойка: s.id, лучше_ли_во_всём: false });
    }
  });

  it('стойка действительно меняет урон удара', () => {
    const cs = new CombatService();
    const a = makeChar();
    const balanced = cs.getBaseDamageWithWeapon(a, null) * STANCES.balanced.damage;
    const dance = cs.getBaseDamageWithWeapon(a, null) * STANCES.sickle_dance.damage;
    const shield = cs.getBaseDamageWithWeapon(a, null) * STANCES.shah_shield.damage;
    expect({ танец_злее_обычного: dance > balanced, щит_слабее_обычного: shield < balanced })
      .toEqual({ танец_злее_обычного: true, щит_слабее_обычного: true });
  });
});

describe('Парирование: тайминг, а не отдельная кнопка', () => {
  it('удар в первые миллисекунды щита отражается', () => {
    const d = new DefenseStates();
    d.activateBlock(id);
    // Сразу после поднятия щита - попадание в окно
    expect({ отражение: d.getParryReflect(id) }).toEqual({ отражение: 0.35 });
  });

  it('удар через 300 миллисекунд - это уже блок, а не парирование', () => {
    // Раньше окна не было вовсе. Если бы парированием считался весь блок,
    // игрок держал бы щит и парировал постоянно - то есть обещание
    // «фокус на таймингах» было бы ложью
    const d = new DefenseStates();
    d.activateBlock(id);
    expect({ отражение_позже: d.getParryReflect(id, Date.now() + 300) }).toEqual({ отражение_позже: 0 });
    expect({ щит_ещё_держит: d.isBlocking(id, Date.now() + 300) }).toEqual({ щит_ещё_держит: true });
  });

  it('окно короткое: 260 миллисекунд', () => {
    const d = new DefenseStates();
    d.activateBlock(id);
    expect({ в_окне: d.getParryReflect(id, Date.now() + 200) }).toEqual({ в_окне: 0.35 });
    expect({ вне_окна: d.getParryReflect(id, Date.now() + 400) }).toEqual({ вне_окна: 0 });
  });

  it('без щита парирования нет', () => {
    const d = new DefenseStates();
    expect({ без_щита: d.getParryReflect(id) }).toEqual({ без_щита: 0 });
  });

  it('рывок не парируется — это разные вещи', () => {
    const d = new DefenseStates();
    d.activateDodge(id);
    expect({ при_рывке: d.getParryReflect(id) }).toEqual({ при_рывке: 0 });
  });
});

describe('Защита цели учитывает её стойку', () => {
  it('«Шахский щит» держит больше, чем «Танец серпа»', () => {
    const d = new DefenseStates();
    d.activateBlock(id);
    // Множитель входящего урона считается с параметром стойки. Без
    // параметра обе стойки держали бы одинаково, то есть выбор стойки
    // ничего не значил бы в защите
    const shield = d.getIncomingMultiplier(id, Date.now(), STANCES.shah_shield.blockReduction);
    const dance = d.getIncomingMultiplier(id, Date.now(), STANCES.sickle_dance.blockReduction);
    expect({ щит_получает_меньше: shield < dance }).toEqual({ щит_получает_меньше: true });
    // Сравниваем с допуском: 1 - 0.85 в двоичной дроби даёт 0.15000000000000002,
    // и точное сравнение падало бы из-за представления числа, а не из-за
    // боевой логики
    expect({ щит_держит_процент: Math.round(shield * 100) / 100 }).toEqual({ щит_держит_процент: 0.15 });
  });
});
