// Навыки гильдии покупаются и дают то, за что заплатили.
//
// ЧТО БЫЛО. В data/guilds.ts объявлено пять навыков с ценой уровня и
// описанием вроде «+2% к опыту за каждый уровень». Файл не импортировался
// вообще: навыков не существовало, а гильдия платила за вклад и вступала
// ради обещанного бонуса, которого не было.
//
// ЧТО ТЕПЕРЬ. Покупка тратит золото гильдии, записывает уровень, и бонус
// попадает в начисление опыта и золота с монстров.
//
// ПРО ТРИ НАВЫКА БЕЗ ТОЧКИ ПРИМЕНЕНИЯ. Их пять, а мест применения - два.
// Прирост HP, скорость крафта и сила осады подключать некуда, поэтому за
// них нельзя заплатить: продавать бонус, который не действует, хуже, чем
// не продавать его вовсе.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GuildService, сбросКэшаГильдий } from '../services/GuildService';
import { guildBonuses, isSkillWired, upgradeCost, WIRED_EFFECTS } from '../systems/GuildBonuses';
import { GUILD_SKILLS } from '../data/guilds';

jest.mock('../services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => ({ query: jest.fn(), queryOne: jest.fn(), transaction: jest.fn() }) },
}));
jest.mock('../services/RedisService', () => ({
  RedisService: { getInstance: () => ({ publish: jest.fn(), subscribe: jest.fn() }) },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const GUILD = 'aaaaaaaa-1111-4111-8111-111111111111';
const CHAR = 'bbbbbbbb-1111-4111-8111-111111111111';
const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

beforeEach(() => сбросКэшаГильдий());

/**
 * Подмена базы для покупки навыка.
 *
 * Золото гильдии отдаётся по своему уровню: проверка «хватает ли золота»
 * обязана различать «в кассе 6000» и «в кассе 100».
 */
function подменить(opts: {
  золото: number;
  уровеньНавыка?: number;
  ранг?: string;
}): { service: GuildService; запросы: string[] } {
  const service = new GuildService();
  const запросы: string[] = [];
  // Явный тип: db ссылается на себя через transaction, и без аннотации
  // вывод типа зацикливается и роняет сборку.
  type Результат = { rows: unknown[]; rowCount: number | null };
  type Подмена = {
    query: (sql: string, params?: unknown[]) => Promise<Результат>;
    queryOne: (sql: string, params: unknown[]) => Promise<Record<string, unknown> | null>;
    transaction: (cb: (c: Подмена) => Promise<unknown>) => Promise<unknown>;
  };
  const db: Подмена = {
    query: jest.fn(async (sql: string) => {
      запросы.push(sql);
      // Списание золота: WHERE gold >= стоимость отсекает долг.
      if (/UPDATE guilds SET gold = gold -/.test(sql)) {
        // Форма настоящего pg: объект с rows и rowCount. Массив тут не
        // годится - код смотрит rowCount, а у массива его нет, и отказ
        // о нехватке золота молча не срабатывал бы.
        return opts.золото > 0
          ? { rows: [{ gold: opts.золото }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    }),
    queryOne: jest.fn(async (sql: string, params: unknown[] = []) => {
      запросы.push(sql);
      // Сначала запрос РАНГА, потом членства: оба ходят в guild_members,
      // и порядок шаблонов решал, кто чей ответ получит. Прежний порядок
      // отдавал { guild_id } на запрос ранга, rank был undefined, прав не
      // было, и каждая проверка покупки получала SKILLS_FORBIDDEN вместо
      // своего отказа.
      // Чужой - это ОТСУТСТВИЕ строки, а не строка с чужим рангом.
      // Прежняя подмена отдавала 'member' любому, кроме CHAR, и «чужой»
      // получал SKILLS_FORBIDDEN вместо честного NOT_A_MEMBER.
      if (/SELECT rank FROM guild_members/.test(sql)) {
        if (params[1] === CHAR) return { rank: opts.ранг ?? 'leader' };
        if (params[1] === 'участник') return { rank: 'member' };
        return null;
      }
      if (/FROM guild_members/.test(sql)) return { guild_id: GUILD };
      if (/SELECT level FROM guild_skills/.test(sql)) {
        return { level: opts.уровеньНавыка ?? 0 };
      }
      return null;
    }),
    // Тело транзакции ВЫПОЛНЯЕТСЯ - иначе весь код внутри неё не
    // выполняется, и проверки падают на неисполненном коде.
    transaction: jest.fn(async (cb: (c: Подмена) => Promise<unknown>) => cb(db)),
  };
  (service as unknown as { db: unknown }).db = db;
  return { service, запросы };
}

describe('Бонусы считаются по уровням', () => {
  it('без навыков бонусов нет', () => {
    expect(guildBonuses({})).toMatchObject({ exp: 1, gold: 1, unavailable: [] });
  });

  it('десять уровней опыта дают ровно +20%, а не «примерно»', () => {
    // Число зафиксировано руками как ловушка: описание в данных говорит
    // «+2% за уровень», и 10 уровней должны дать ровно 1.2. Если число
    // поменяют, проверка обязана покраснеть.
    expect(guildBonuses({ guild_exp_boost: 10 }).exp).toBe(1.2);
    expect(guildBonuses({ guild_gold_boost: 10 }).gold).toBe(1.3);
  });

  it('пять уровней - это половина десяти, а не что-то среднее', () => {
    expect(guildBonuses({ guild_exp_boost: 5 }).exp).toBe(1.1);
    expect(guildBonuses({ guild_gold_boost: 5 }).gold).toBe(1.15);
  });

  it('уровень выше потолка не даёт больше потолка', () => {
    // Потолок стоит и в справочнике (maxLevel), и в CHECK базы. Здесь
    // проверяется, что считающая функция тоже не пропустит лишнее: если
    // бы строка с уровнем 50 появилась в обход CHECK, бонус посчитался бы
    // по потолку, а не выдал +1000% опыта.
    expect(guildBonuses({ guild_exp_boost: 50 }).exp).toBe(1.2);
  });

  it('отрицательный и дробной уровень не делают бонус хуже единицы', () => {
    // Отрицательный уровень дал бы отрицательный бонус, то есть штраф за
    // неудачную покупку.
    //
    // Дробной уровень обрезается ВНИЗ до нуля, а не округляется вверх:
    // уровень - целое число (колонка INTEGER), и 0.5 не бывает половиной
    // навыка. Первая версия проверки ждала тут 1.02 - то есть требовала
    // начислить полпроцента от уровня, которого не существует.
    expect(guildBonuses({ guild_exp_boost: -5 }).exp).toBe(1);
    expect(guildBonuses({ guild_exp_boost: 0.5 }).exp).toBe(1);
    expect(guildBonuses({ guild_exp_boost: 1.9 }).exp).toBe(1.02);
  });

  it('мусорный уровень не ломает начисление опыта', () => {
    // В базу могла попасть строка не из числа. Math.max(0, Math.floor(NaN))
    // даёт NaN, и опыт перестал бы начисляться совсем.
    expect(guildBonuses({ guild_exp_boost: Number.NaN as unknown as number }).exp).toBe(1);
    expect(guildBonuses({ guild_exp_boost: 'десять' as unknown as number }).exp).toBe(1);
  });
});

describe('За навык без точки применения платить нельзя', () => {
  it('справочник знает пять навыков, а подключено три', () => {
    // Числа зафиксированы руками: если новый навык добавят без точки
    // применения, проверка покраснеет и заставит решить, что с ним делать.
    //
    // Было 2, стало 3: «Мастер ремесла» получил настоящее применение -
    // сокращение времени крафта. Без точки применения остались прирост HP
    // (нужен пересчёт max_hp при каждом изменении снаряжения) и сила осады
    // (системы осад нет вообще). Их нельзя продавать, пока они пустые.
    const всего = GUILD_SKILLS.map(s => s.id);
    expect({ всего: всего.length, подключено: WIRED_EFFECTS.length, неподключены: всего.filter(id => !isSkillWired(id)) })
      .toEqual({
        всего: 5,
        подключено: 3,
        неподключены: ['guild_hp_boost', 'guild_siege_power'],
      });
  });

  it('покупка неподключённого навыка отвергается и золото не трогается', async () => {
    // Главный отказ. Без него гильдия заплатила бы 8000 за «+100 HP»,
    // которого никто не начислил бы.
    const { service, запросы } = подменить({ золото: 999999 });
    await expect(service.upgradeSkill(GUILD, CHAR, 'guild_hp_boost', 1))
      .rejects.toThrow('SKILL_UNAVAILABLE');
    expect({ списаний_не_было: запросы.filter(q => /UPDATE guilds SET gold/.test(q)).length })
      .toEqual({ списаний_не_было: 0 });
  });

  it('уровень неподключённого навыка в базе попадает в список недоступных', () => {
    // Такой уровень нельзя купить, но он может остаться от старой версии.
    // Молчаливый бонус был бы враньём, поэтому он назван своим именем.
    expect(guildBonuses({ guild_hp_boost: 3 }).unavailable).toEqual(['guild_hp_boost']);
  });
});

describe('Покупка тратит золото и записывает уровень', () => {
  it('цена берётся из справочника, а не выдумывается', () => {
    expect({ опыт: upgradeCost('guild_exp_boost', 1), золото_навыка: upgradeCost('guild_gold_boost', 1) })
      .toEqual({ опыт: 5000, золото_навыка: 5000 });
  });

  it('десять уровней подряд стоят как десять по одной', () => {
    // Иначе покупка сразу десяти уровней была бы дешевле, и цена в
    // описании была бы ложью.
    expect(upgradeCost('guild_exp_boost', 10)).toBe(upgradeCost('guild_exp_boost', 1) * 10);
  });

  it('покупка проходит: деньги списаны, уровень записан', async () => {
    const { service, запросы } = подменить({ золото: 20000, уровеньНавыка: 3 });
    const итог = await service.upgradeSkill(GUILD, CHAR, 'guild_exp_boost', 2);
    expect({
      итог,
      списали_за_два_уровня: запросы.some(q => /UPDATE guilds SET gold = gold - \$1/.test(q)),
      записали_уровень: запросы.some(q => /INSERT INTO guild_skills/.test(q)),
    }).toEqual({
      итог: { level: 5, cost: 10000 },
      списали_за_два_уровня: true,
      записали_уровень: true,
    });
  });

  it('в гильдии не хватает золота - отказ, уровень не растёт', async () => {
    const { service, запросы } = подменить({ золото: 0 });
    await expect(service.upgradeSkill(GUILD, CHAR, 'guild_exp_boost', 1))
      .rejects.toThrow('NOT_ENOUGH_GUILD_GOLD');
    expect({ уровень_не_записан: запросы.some(q => /INSERT INTO guild_skills/.test(q)) })
      .toEqual({ уровень_не_записан: false });
  });

  it('выше потолка не купить', async () => {
    const { service } = подменить({ золото: 999999, уровеньНавыка: 10 });
    await expect(service.upgradeSkill(GUILD, CHAR, 'guild_exp_boost', 1))
      .rejects.toThrow('SKILL_MAXED');
  });

  it('чужой в гильдию покупать не может', async () => {
    const { service } = подменить({ золото: 999999 });
    await expect(service.upgradeSkill(GUILD, 'чужой', 'guild_exp_boost', 1))
      .rejects.toThrow('NOT_A_MEMBER');
  });

  it('покупает только тот, у кого есть право распоряжаться казной', async () => {
    // Право manageTreasury в справочнике есть ТОЛЬКО у лидера. Первый
    // вариант проверки ждал, что офицер покупает, и ругался на верный код:
    // офицер умеет исключать участников, но распоряжаться казной не может.
    //
    // Право здесь не promote: назначать ранги и вкладывать золото -
    // разные дела, и в справочнике они разные.
    for (const [ранг, отказ] of [['leader', false], ['officer', true], ['veteran', true], ['member', true], ['recruit', true]] as const) {
      const { service } = подменить({ золото: 999999, ранг });
      const покупка = service.upgradeSkill(GUILD, CHAR, 'guild_exp_boost', 1);
      if (отказ) {
        await expect(покупка).rejects.toThrow('SKILLS_FORBIDDEN');
      } else {
        await покупка;
      }
    }
  });

  it('покупка сбрасывает кэш бонусов той же гильдии', async () => {
    // Кэш живёт между вызовами и без сброса отдал бы старый бонус.
    // Проверяется по факту: два вызова getBonuses подряд дают разный опыт.
    const service = new GuildService();
    let уровень = 0;
    const db = {
      // Список навыков приходит через query, а не queryOne. Без этого
      // ответа getSkillLevels видел бы пустой список, бонус всегда был бы
      // равен 1, и проверка сброса кэша не проверяла бы ровно ничего -
      // покраснела бы только от сбоя с throw.
      query: jest.fn(async (sql: string) => {
        if (/UPDATE guilds SET gold/.test(sql)) return [{ gold: 5000 }];
        if (/SELECT skill_id, level FROM guild_skills/.test(sql)) {
          return [{ skill_id: 'guild_exp_boost', level: уровень }];
        }
        return [];
      }),
      // Порядок шаблонов снова решает всё: запрос ранга идёт ПЕРВЫМ,
      // иначе его перехватит запрос членства (оба ходят в guild_members)
      // и rank станет undefined.
      queryOne: jest.fn(async (sql: string) => {
        if (/SELECT rank FROM guild_members/.test(sql)) return { rank: 'leader' };
        if (/SELECT level FROM guild_skills/.test(sql)) return { level: уровень };
        if (/FROM guild_members/.test(sql)) return { guild_id: GUILD };
        return null;
      }),
      transaction: jest.fn(),
    };
    (service as unknown as { db: unknown }).db = db;

    const до = await service.getBonuses(CHAR);
    уровень = 5;
    const ещёДо = await service.getBonuses(CHAR);
    await service.upgradeSkill(GUILD, CHAR, 'guild_exp_boost', 1);
    const после = await service.getBonuses(CHAR);

    expect({
      до_покупки: до.exp,
      второй_раз_подряд: ещёДо.exp,
      после_покупки: после.exp,
    }).toEqual({ до_покупки: 1, второй_раз_подряд: 1, после_покупки: 1.1 });
  });
});

describe('Бонус реально доходит до начислений', () => {
  it('множитель гильдии входит в цепочку опыта', () => {
    // Поиск по тексту тут НЕПРИГОДЕН: он нашёл бы «guildExp» в комментарии
    // и успокоился бы, даже если бы умножения не было. Поэтому проверка
    // требует и переменную, и её участие в произведении.
    const код = читать('server/src/services/CharacterService.ts');
    const строкаИтога = /const total = Math\.floor\(([^\n]*)\)/.exec(код)?.[1] ?? '';
    expect({
      есть_переменная: /let guildExp = 1/.test(код),
      берётся_из_гильдии: /getBonuses\(characterId\)\)\.exp/.test(код),
      участвует_в_произведении: /guildExp/.test(строкаИтога),
      отказ_не_роняет_опыт: /catch \{\s*\r?\n\s*guildExp = 1;/.test(код),
    }).toEqual({
      есть_переменная: true,
      берётся_из_гильдии: true,
      участвует_в_произведении: true,
      отказ_не_роняет_опыт: true,
    });
  });

  it('множитель гильдии входит в золото с монстра', () => {
    // Та же причина: имя переменной в коде есть всегда, значение - нет.
    const код = читать('server/src/socket/GameSocketHandler.ts');
    const блок = код.slice(код.indexOf('goldReward.min'), код.indexOf('addGoldReward(attacker.id, gold)'));
    expect({
      берётся_из_гильдии: /getBonuses\(attacker\.id\)/.test(блок),
      умножается_до_округления: /Math\.floor\(золотоБазовое \* бонусы\.gold\)/.test(блок),
      отказ_не_роняет_золото: /золото = золотоБазовое;/.test(блок),
    }).toEqual({
      берётся_из_гильдии: true,
      умножается_до_округления: true,
      отказ_не_роняет_золото: true,
    });
  });

  it('таблица навыков создаётся миграцией, а не по пути', () => {
    // Метод писал бы в таблицу, которой нет, и покупка падала бы всегда.
    const миграция = читать('database/migrations/050_guild_skills.sql');
    expect({
      таблица: /CREATE TABLE IF NOT EXISTS guild_skills/.test(миграция),
      потолок_в_базе: /level >= 0 AND level <= 10/.test(миграция),
      известные_навыки: /skill_id IN \('guild_exp_boost'/.test(миграция),
    }).toEqual({ таблица: true, потолок_в_базе: true, известные_навыки: true });
  });

  it('потолок в базе совпадает с потолком справочника', () => {
    // Потолок продублирован числом в CHECK - CHECK не умеет ходить в
    // TypeScript. Если у навыка поднимут maxLevel, число в базе станет
    // врать, и покупка выше потолка справочника падала бы с ошибкой.
    const миграция = читать('database/migrations/050_guild_skills.sql');
    const потолкиВБазе = [...миграция.matchAll(/level <= (\d+)/g)].map(m => Number(m[1]));
    const потолкиСправочника = GUILD_SKILLS.map(s => s.maxLevel);
    expect({
      потолки_в_базе: [...new Set(потолкиВБазе)],
      максимум_справочника: Math.max(...потолкиСправочника),
    }).toEqual({ потолки_в_базе: [Math.max(...потолкиСправочника)], максимум_справочника: Math.max(...потолкиСправочника) });
  });
});
