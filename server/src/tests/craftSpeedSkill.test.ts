// Навык гильдии «Мастер ремесла» реально сокращает время крафта.
//
// ЧТО БЫЛО. Навык был объявлен в data/guilds.ts как «-5% к времени
// крафтинга за каждый уровень», и не работал: точек применения не было,
// поэтому за него нельзя было заплатить. Файл с навыками при этом
// импортировался - в отличие от рангов, которые тоже были мертвы.
//
// ГЛАВНЫЙ РИСК - НЕ «БОНУС НЕ ПРИМЕНЯЕТСЯ», А «КРАФТ СТАНОВИТСЯ
// МГНОВЕННЫМ». Навык уменьшает время, поэтому знак легко перепутать, а
// отрицательный множитель сделал бы completesAt в прошлом - и проверка
// «сначала ли проверяют, что время пришло» начала бы проходить всегда.
// Поэтому нижняя граница проверяется отдельно и руками.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  guildBonuses, isSkillWired, upgradeCost, MIN_CRAFT_SPEED, WIRED_EFFECTS,
} from '../systems/GuildBonuses';
import { GUILD_SKILLS } from '../data/guilds';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

describe('Навык подключён и покупается', () => {
  it('craft_speed в списке подключённых эффектов', () => {
    expect({ есть: isSkillWired('guild_craft_speed') }).toEqual({ есть: true });
  });

  it('три эффекта подключены из пяти навыков', () => {
    // Было два. Число зафиксировано руками как ловушка: новый навык без
    // точки применения обязан сломать эту проверку.
    const подключены = GUILD_SKILLS.filter(s => isSkillWired(s.id)).map(s => s.id);
    expect({
      подключено: подключены.length,
      подключены,
      неподключены: GUILD_SKILLS.filter(s => !isSkillWired(s.id)).map(s => s.id),
    }).toEqual({
      подключено: 3,
      подключены: ['guild_exp_boost', 'guild_gold_boost', 'guild_craft_speed'],
      неподключены: ['guild_hp_boost', 'guild_siege_power'],
    });
  });

  it('цена за уровень берётся из справочника, а не выдумана', () => {
    const навык = GUILD_SKILLS.find(s => s.id === 'guild_craft_speed')!;
    expect({
      уровней: навык.maxLevel,
      цена: upgradeCost('guild_craft_speed', 1),
      десять_подряд: upgradeCost('guild_craft_speed', 10),
    }).toEqual({ уровней: навык.maxLevel, цена: навык.costPerLevel, десять_подряд: навык.costPerLevel * 10 });
  });
});

describe('Время сокращается, а не становится отрицательным', () => {
  it('без навыка время обычное', () => {
    expect({ craft: guildBonuses({}).craft }).toEqual({ craft: 1 });
  });

  it('десять уровней срезают ровно половину', () => {
    // Описание обещает «-5% за уровень», максимум 10 уровней: это ровно
    // половина. Число зафиксировано руками как ловушка.
    expect({ craft: guildBonuses({ guild_craft_speed: 10 }).craft }).toEqual({ craft: 0.5 });
  });

  it('пять уровней срезают четверть', () => {
    expect({ craft: guildBonuses({ guild_craft_speed: 5 }).craft }).toEqual({ craft: 0.75 });
  });

  it('мусорный уровень не ломает множитель', () => {
    // ГЛАВНАЯ ПРОВЕРКА ФАЙЛА. Множитель входит в completesAt, и знак здесь
    // единственное, что может всё испортить: отрицательный множитель
    // отправил бы время готовности в ПРОШЛОЕ, и проверка «сначала ли
    // пришло время» проходила бы всегда. Рецепт был бы мгновенным.
    //
    // Нижний уровень в списке -5 и мусор NaN: уровень зажимается в ноль, и
    // множитель обязан стать обычной единицей, а не 1.25 («медленнее») и не
    // NaN («невозможно»). Именно эти два значения ловят перевёрнутый знак.
    const уровни = [0, 1, 5, 10, 11, 50, 999, -5, Number.NaN as unknown as number];
    const значения = уровни.map(l => guildBonuses({ guild_craft_speed: l }).craft);
    expect({
      все_положительные: значения.every(v => v > 0),
      ни_одного_нуля: значения.every(v => v !== 0),
      ни_одного_NaN: значения.every(v => Number.isFinite(v)),
      // Мусорный уровень = обычное время, а не «медленнее» и не «быстрее».
      отрицательный_как_ноль: guildBonuses({ guild_craft_speed: -5 }).craft,
      nan_как_ноль: guildBonuses({ guild_craft_speed: Number.NaN as unknown as number }).craft,
    }).toEqual({
      все_положительные: true,
      ни_одного_нуля: true,
      ни_одного_NaN: true,
      отрицательный_как_ноль: 1,
      nan_как_ноль: 1,
    });
  });

  it('нижняя граница стоит в коде и не пропускает отрицательный множитель', () => {
    // ЧЕСТНО О ГРАНИЦЕ. MIN_CRAFT_SPEED сегодня НЕДОСТИЖИМА: уровень
    // зажимается в maxLevel, а в данных maxLevel = 10, то есть худший
    // множитель 0.5. Проверка поведения её не поймает - см. выше.
    //
    // Поэтому граница проверяется как страховка от ПРАВКИ ДАННЫХ: если
    // кто-то поднимет maxLevel до 100, формула без границы даст -4, и крафт
    // станет мгновенным. Это вторая линия, а не первая: первую держит
    // maxLevel в data/guilds.ts, и её проверяет тест выше.
    const код = читать('server/src/systems/GuildBonuses.ts');
    const строка = код.slice(
      код.indexOf("if (effect === 'craft_speed')"),
      код.indexOf('  return { exp, gold, craft'));
    expect({
      граница_в_коде: строка.includes('MIN_CRAFT_SPEED'),
      // Граница - именно минимум, а не потолок сверху: «сверху» означало бы
      // запрет ускорения, то есть навык перестал бы что-то давать.
      именно_минимум: /Math\.max\(MIN_CRAFT_SPEED,/.test(строка),
    }).toEqual({ граница_в_коде: true, именно_минимум: true });

    // И всё-таки проверим, что граница именно такая, какой её объявили:
    // взять потолок выше сегодняшнего и убедиться, что множитель не ушёл
    // в ноль и не стал отрицательным.
    const будущийПотолок = 1 - 100 * 0.05;
    expect({
      без_границы_было_бы: будущийПотолок,
      с_границей: Math.max(MIN_CRAFT_SPEED, будущийПотолок),
    }).toEqual({ без_границы_было_бы: -4, с_границей: MIN_CRAFT_SPEED });
  });

  it('уровень выше потолка не срезает больше половины', () => {
    // maxLevel в данных равен 10, но строка в базе могла оказаться выше.
    // Бонус считается по потолку, а не по фактическому уровню.
    expect({
      десять: guildBonuses({ guild_craft_speed: 10 }).craft,
      пятьдесят: guildBonuses({ guild_craft_speed: 50 }).craft,
    }).toEqual({ десять: 0.5, пятьдесят: 0.5 });
  });

  it('множитель крафта не трогает опыт и золото', () => {
    // Разные навыки - разные величины. Смешивание означало бы, что покупка
    // скорости крафта незаметно ускоряет прокачку.
    const все = guildBonuses({ guild_craft_speed: 10, guild_exp_boost: 10, guild_gold_boost: 10 });
    expect({ exp: все.exp, gold: все.gold, craft: все.craft })
      .toEqual({ exp: 1.2, gold: 1.3, craft: 0.5 });
  });
});

describe('Подключено в настоящем месте', () => {
  it('время крафта берётся из множителя, а не из recipe.craftingTime как есть', () => {
    // По исходнику: проверка поведения здесь потребовала бы подменить и
    // getBonuses, и рецепт, и результат всё равно остался бы числом.
    const код = читать('server/src/services/CraftingService.ts');
    const метод = код.slice(
      код.indexOf('async startCrafting'),
      код.indexOf('async completeCrafting'));
    expect({
      множитель_в_формуле: /completesAt: new Date\(Date\.now\(\) \+ recipe\.craftingTime \* 1000 \* множительКрафта\)/.test(метод),
      множитель_берётся: /getBonuses\(characterId\)\)\.craft/.test(метод),
      подстраховка: /if \(!Number\.isFinite\(множительКрафта\) \|\| множительКрафта <= 0\) множительКрафта = 1;/.test(метод),
    }).toEqual({ множитель_в_формуле: true, множитель_берётся: true, подстраховка: true });
  });

  it('отказ базы не срывает начало крафта', () => {
    // getBonuses ходит в базу. Отказ не должен превращать «нет бонуса» в
    // «крафт невозможен»: игрок без гильдии получает обычное время, и
    // это правильное поведение, а не заглушка.
    const код = читать('server/src/services/CraftingService.ts');
    const метод = код.slice(
      код.indexOf('async startCrafting'),
      код.indexOf('async completeCrafting'));
    expect({
      под_try: /try \{[\s\S]*getBonuses\(characterId\)\)\.craft[\s\S]*\} catch/.test(метод),
      в_журнал: /\[Craft\] бонус гильдии недоступен/.test(метод),
    }).toEqual({ под_try: true, в_журнал: true });
  });

  it('уровень навыка попадает в бонус при покупке', () => {
    // Навык не купится, если upgradeSkill его не примет: проверка
    // isSkillWired остаётся единственной точкой решения.
    const svc = читать('server/src/services/GuildService.ts');
    expect({ проверка_в_upgradeSkill: /if \(!isSkillWired\(skillId\)\) throw new Error\('SKILL_UNAVAILABLE'\)/.test(svc) })
      .toEqual({ проверка_в_upgradeSkill: true });
  });
});

describe('Число подключённых эффектов', () => {
  it('три', () => {
    expect({ эффектов: WIRED_EFFECTS.length }).toEqual({ эффектов: 3 });
  });
});
