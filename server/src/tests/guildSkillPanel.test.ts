// Панель гильдии: покупка навыков доступна игроку, а не только серверу.
//
// ЧТО БЫЛО. Навыки гильдии считались, покупались по маршруту и давали
// бонус - а в панели не было НИ ОДНОГО упоминания навыков. Ни кнопки, ни
// вызова в api.ts, ни строки в переводах. Функция без входа: игрок не мог
// нажать кнопку, потому что кнопки не существовало.
//
// ГЛАВНАЯ ПРОВЕРКА ФАЙЛА. Кнопка не должна рисоваться там, где купить
// нельзя. Навык без точки применения (guild_hp_boost, guild_siege_power)
// выглядел бы как обычный, если бы клиент решал за сервер: цена показана,
// кнопка есть, покупка отвергается. Решение обязано приходить с сервера
// полем available - это та же isSkillWired, которую проверяет upgradeSkill.
//
// ВТОРОЕ. Стоимость уровня не должна быть выдумана на клиенте: цена в
// справочнике 6000 за уровень, и клиент, посчитавший цену сам, показал бы
// другую цифру. Цена приходит с сервера.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');
const панель = читать('client/src/app/guild.ts');
const api = читать('client/src/app/api.ts');
const роуты = читать('server/src/routes/guilds.ts');
const покупка = читать('server/src/routes/guilds.ts')
  .slice(читать('server/src/routes/guilds.ts').indexOf("router.post('/skills/upgrade'"));

describe('Панель показывает навыки', () => {
  it('блок навыков отрисовывается в панели гильдии', () => {
    expect({
      загружает: /api\.guildSkills\(cid\(\)\)/.test(панель),
      добавляет_в_панель: /box\.append\(skillsBlock\)/.test(панель),
    }).toEqual({ загружает: true, добавляет_в_панель: true });
  });

  it('покупка уходит на маршрут, а не в никуда', () => {
    expect({
      вызов: /api\.guildSkillUpgrade\(cid\(\), навык\.id, 1\)/.test(панель),
      адрес: /\/api\/guilds\/skills\/upgrade/.test(api),
    }).toEqual({ вызов: true, адрес: true });
  });

  it('после покупки панель перечитывается', () => {
    // Без перечитывания игрок увидел бы «уровень 2» только после
    // переоткрытия панели - и решил бы, что кнопка не работает.
    expect({
      обновление: /await loadGuild\(\)/.test(панель),
      после_покупки: панель.indexOf('guildSkillUpgrade') < панель.lastIndexOf('await loadGuild()'),
    }).toEqual({ обновление: true, после_покупки: true });
  });
});

describe('Кнопка рисуется только там, где купить можно', () => {
  it('навык без точки применения не получает кнопку', () => {
    // ГЛАВНАЯ ПРОВЕРКА. Условие должно быть «available», а не «не
    // максимум»: иначе игрок увидит цену и кнопку навыка, который
    // сервер отвергнет.
    const блок = панель.slice(панель.indexOf('for (const навык of данные.skills)'));
    expect({
      сперва_проверка_доступности: /if \(!навык\.available\)/.test(блок),
      кнопка_в_ветке_иначе: /else if \(!навык\.maxed\)/.test(блок),
      доступность_в_условии_кнопки: /кнопка\.disabled = !данные\.canManage \|\| !хватает/.test(блок),
    }).toEqual({ сперва_проверка_доступности: true, кнопка_в_ветке_иначе: true, доступность_в_условии_кнопки: true });
  });

  it('недоступный навык объяснён, а не молча скрыт', () => {
    // Молчание выглядело бы как забытый пункт, а не как решение.
    expect({
      подсказка: /guild\.skill_unavailable/.test(панель),
      класс: /guild-skill-off/.test(панель),
    }).toEqual({ подсказка: true, класс: true });
  });

  it('цена берётся с сервера, а не считается на клиенте', () => {
    // Клиент, посчитавший цену сам, показал бы другую цифру, чем снимет
    // сервер. Проверяем, что costNext приходит, а не вычисляется.
    expect({
      // Читается поле с сервера, а не считается на клиенте.
      // Якорь на \b: иначе совпало бы и 'навык.costNext * 2', то есть
      // клиент, удваивающий цену, прошёл бы незаметно.
      приходит: /данные\.gold >= навык\.costNext\b(?!\s*[*/+\-])/.test(панель),
      // То же и здесь: цена на кнопке не должна проходить через
      // арифметику, иначе игрок увидит цифру, которой нет на сервере.
      в_подписи: /— ' \+ навык\.costNext\.toLocaleString\(\)/.test(панель),
      // Клиент вообще не знает цену за уровень: если бы он её знал,
      // он мог бы посчитать другую и показать неверную цифру.
      нет_цены_в_клиенте: !/costPerLevel/.test(панель),
      в_типе_api: /costNext: number/.test(api),
    }).toEqual({ приходит: true, в_подписи: true, нет_цены_в_клиенте: true, в_типе_api: true });
  });

  it('право на покупку приходит с сервера', () => {
    expect({
      canManage_с_сервера: /canManage: boolean/.test(api),
      используется: /данные\.canManage/.test(панель),
      в_типе_api: /available: boolean/.test(api),
    }).toEqual({ canManage_с_сервера: true, используется: true, в_типе_api: true });
  });
});

describe('Маршрут списка навыков отдаёт нужное', () => {
  it('объявлен GET /skills и отдаёт уровни, цены и право', () => {
    const блок = роуты.slice(роуты.indexOf("router.get('/skills'"), роуты.indexOf("router.post('/skills/upgrade'"));
    expect({
      маршрут: /router\.get\('\/skills'/.test(роуты),
      уровни_из_базы: /guilds\.getSkillLevels\(data\.guild\.id\)/.test(блок),
      право_из_ранга: /getGuildRankPermissions/.test(блок),
      золото_котла: /gold: data\.guild\.gold/.test(блок),
      все_навыки: /GUILD_SKILLS\.map/.test(блок),
    }).toEqual({ маршрут: true, уровни_из_базы: true, право_из_ранга: true, золото_котла: true, все_навыки: true });
  });

  it('available считается той же функцией, что и в покупке', () => {
    // Расхождение этих двух было бы хуже отсутствия поля: панель показала
    // бы кнопку, а покупка отказала бы.
    //
    // Проверка смотрит в СЕРВИС, а не в маршрут. Маршрут только вызывает
    // guilds.upgradeSkill и ничего не решает: искать isSkillWired в роутере
    // бессмысленно, его там и быть не должно - иначе решение принималось бы
    // в двух местах и разошлось бы.
    const список = роуты.slice(роуты.indexOf("router.get('/skills'"), роуты.indexOf("router.post('/skills/upgrade'"));
    const сервис = читать('server/src/services/GuildService.ts');
    expect({
      в_списке: /available: isSkillWired\(skill\.id\)/.test(список),
      в_сервисе: /if \(!isSkillWired\(skillId\)\) throw new Error\('SKILL_UNAVAILABLE'\)/.test(сервис),
      // Маршрут покупки решения не принимает - это тоже проверяется.
      маршрут_не_решает: !/isSkillWired/.test(покупка),
    }).toEqual({ в_списке: true, в_сервисе: true, маршрут_не_решает: true });
  });

  it('максимум отличается от бесплатности', () => {
    // costNext = 0 означал бы «бесплатно», а на деле «уже максимум».
    // Поэтому рядом идёт флаг maxed, и клиент их различает.
    const список = роуты.slice(роуты.indexOf("router.get('/skills'"), роуты.indexOf("router.post('/skills/upgrade'"));
    expect({
      цена_обнуляется: /costNext: максимум \? 0 : upgradeCost\(skill\.id, 1\)/.test(список),
      флаг_есть: /maxed: максимум/.test(список),
      клиент_различает: /навык\.maxed/.test(панель),
    }).toEqual({ цена_обнуляется: true, флаг_есть: true, клиент_различает: true });
  });
});

describe('Переводы на трёх языках', () => {
  const ключи = [
    'skills_title', 'skills_gold', 'skills_no_right', 'skill_level', 'skill_max',
    'skill_buy', 'skill_no_gold', 'skill_unavailable', 'skill_bought', 'skills_load_failed',
    'err_skill_unavailable', 'err_skill_unknown', 'err_skill_maxed',
    'err_skills_forbidden', 'err_skill_no_gold',
  ];

  for (const язык of ['ru', 'en', 'az']) {
    it(`${язык}: все ${ключи.length} ключей на месте и не пустые`, () => {
      // Ищется ТЕМ ЖЕ путём, каким ищет t(): разбор по точкам и вход в
      // guild. Ключи, положенные как 'guild.skills_title' внутрь guild,
      // дают guild.guild.skills_title, и t() вернул бы сам путь строкой.
      const данные = JSON.parse(читать(`shared/locales/${язык}.json`));
      const отсутствуют = ключи.filter(к =>
        typeof данные.guild?.[к] !== 'string' || !данные.guild[к].length);
      expect({ отсутствуют, всего: ключи.length }).toEqual({ отсутствуют: [], всего: ключи.length });
    });
  }

  it('каждый ключ панели есть во всех трёх словарях', () => {
    // Все t('guild....') из панели сверяются со словарями. Незаведённый
    // ключ показывается игроку как «guild.some_key» - то есть как ошибка.
    const словари = ['ru', 'en', 'az'].map(я =>
      JSON.parse(читать(`shared/locales/${я}.json`)));
    const путь = (node: unknown, ключ: string): unknown =>
      ключ.split('.').reduce<unknown>((n, k) => (n == null ? undefined : (n as Record<string, unknown>)[k]), node);
    const используются = [...панель.matchAll(/t\('(guild\.[a-z_]+)'\)/g)].map(m => m[1]);
    const отсутствуют: string[] = [];
    for (const ключ of new Set(используются)) {
      for (const словарь of словари) {
        if (typeof путь(словарь, ключ) !== 'string') отсутствуют.push(ключ);
      }
    }
    expect({ используется: new Set(используются).size, отсутствуют: [...new Set(отсутствуют)] })
      .toEqual({ используется: new Set(используются).size, отсутствуют: [] });
  });
});

describe('Коды ошибок не показываются игроку как есть', () => {
  it('все пять кодов покупки переведены', () => {
    // Без перевода игрок увидел бы на экране SKILLS_FORBIDDEN.
    const блок = панель.slice(панель.indexOf('const ERRORS'), панель.indexOf('};', панель.indexOf('const ERRORS')));
    for (const код of ['SKILLS_FORBIDDEN', 'SKILL_UNAVAILABLE', 'SKILL_UNKNOWN', 'SKILL_MAXED', 'NOT_ENOUGH_GUILD_GOLD']) {
      expect({ код, переведён: блок.includes(код + ": 'guild.err_") }).toEqual({ код, переведён: true });
    }
  });
});
