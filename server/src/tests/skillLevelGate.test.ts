// Требование уровня навыка было написано в данных, показывалось в панели
// рядом с кнопкой «Выучить» — и не проверялось.
//
// Нашлось на боевом сервере: тестовый персонаж первого уровня выучил Тадж,
// который требует десятого. Панель при этом показывала «уровень 10»
// рядом с кнопкой, то есть обещала, что навык доступен.
//
// Проверка держится на двух вещах: сервер отказывает и списком не
// предлагает. Одного отказа мало - можно отказать, но показать кнопку;
// одной кнопки мало - можно показать кнопку, а сервер пропустит.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SkillsService } from '../services/SkillsService';

jest.mock('../services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({ query: jest.fn().mockResolvedValue([]), queryOne: jest.fn().mockResolvedValue(null) }),
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const CHAR = '11111111-1111-4111-8111-111111111111';
const USER = 'test-bot';

// Тадж требует десятого уровня, Аламы и Зикр - первого и пятого.
const TASH = { id: 'taj', нужно: 10 };
const ZIKR = { id: 'zikr', нужно: 5 };
const ALAMS = { id: 'alams', нужно: 1 };

/**
 * Подменить базу у сервиса.
 *
 * Ответ строится по содержимому SQL, а не по порядку вызовов. Первая версия
 * этой подмены отвечала «по очереди» и молчала на списке выученного: сервис
 * читает его через query, а не queryOne, и проверка на повторное
 * предложение прошла бы, ни разу не спросив базу. Ответ по тексту запроса
 * переживает перестановку запросов - то есть проверяет сервер, а не себя.
 */
function подменитьБазу(opts: {
  уровень: number;
  профессия?: string | null;
  выучены?: string[];
}): { service: SkillsService; вставок: string[] } {
  const service = new SkillsService();
  const вставок: string[] = [];
  (service as unknown as { db: unknown }).db = {
    query: jest.fn(async (sql: string) => {
      вставок.push(sql);
      // Только чтение. Вставки и обновления должны попадать в счётчик
      // вставок, а не в ответ: иначе «выучено» вернулось бы из воздуха.
      if (!sql.trimStart().toUpperCase().startsWith('SELECT')) return [];
      // Список выученного приходит одним SELECT без имён навыков в тексте
      // запроса - идентификатор подставляется как $1. Значит отдаём все
      // помеченные как выученные, а не выбираем по вхождению id в SQL:
      // такой отбор всегда был бы пустым, и проверка на повторное
      // предложение прошла бы, не спросив базу ни разу.
      if (sql.includes('FROM character_skills')) {
        return (opts.выучены ?? []).map(skill_id => ({ skill_id, level: 1, xp: 0, unlocked_at: new Date(0) }));
      }
      return [];
    }),
    queryOne: jest.fn(async (sql: string) => {
      if (sql.includes('FROM characters')) {
        return { profession_id: opts.профессия === undefined ? 'dervish' : opts.профессия, level: opts.уровень };
      }
      if (sql.includes('FROM character_skills')) {
        const id = opts.выучены?.find(s => sql.includes(`'${s}'`)) ?? null;
        return id ? { id, level: 1, xp: 0 } : null;
      }
      return null;
    }),
  };
  return { service, вставок };
}

describe('Навык выше уровня персонажа не выучить', () => {
  it('Тадж требует десятого уровня, а не просто написан десятым в данных', async () => {
    // Тот самый случай с боевого сервера: дервиш первого уровня, Тадж.
    const { service, вставок } = подменитьБазу({ уровень: 1, профессия: 'dervish' });
    let сообщение = '';
    try {
      await service.learnSkill(CHAR, TASH.id, USER);
    } catch (e) { сообщение = (e as Error).message; }
    expect({
      сообщение,
      в_базу_не_записали: вставок.filter(s => s.includes('INSERT INTO character_skills')).length === 0,
    }).toEqual({
      сообщение: `Requires level ${TASH.нужно}`,
      в_базу_не_записали: true,
    });
  });

  it('на своём уровне навык выучивается', async () => {
    // Обратная сторона той же рубежа: проверка не должна запрещать всё подряд.
    const { service, вставок } = подменитьБазу({ уровень: TASH.нужно, профессия: 'dervish' });
    const выученный = await service.learnSkill(CHAR, TASH.id, USER);
    expect({
      вернулся: выученный?.id,
      записан: вставок.some(s => s.includes('INSERT INTO character_skills')),
    }).toEqual({ вернулся: TASH.id, записан: true });
  });

  it('один уровень ниже требования — тоже отказ', async () => {
    // Рубеж без запаса. Проверка «меньше на два» пропустила бы «на один
    // меньше», и игрок получил бы навык на уровень ниже обещанного.
    const { service } = подменитьБазу({ уровень: TASH.нужно - 1, профессия: 'dervish' });
    await expect(service.learnSkill(CHAR, TASH.id, USER)).rejects.toThrow(`Requires level ${TASH.нужно}`);
  });

  it('проверка уровня не заменяет проверку профессии', async () => {
    // Два требования независимы. Если проверку уровня поставили бы вместо
    // проверки профессии, кузнец 30 уровня выучил бы Зикр.
    const { service } = подменитьБазу({ уровень: 30, профессия: 'blacksmith' });
    await expect(service.learnSkill(CHAR, ZIKR.id, USER)).rejects.toThrow('Requires dervish profession');
  });

  it('Аламы первого уровня доступны с первого уровня', async () => {
    // Навык без требования должен оставаться доступным сразу, иначе
    // проверка уровня закроет весь класс дервиша.
    const { service } = подменитьБазу({ уровень: ALAMS.нужно, профессия: 'dervish' });
    await expect(service.learnSkill(CHAR, ALAMS.id, USER)).resolves.toBeTruthy();
  });
});

describe('Панель не предлагает навык, который сервер не даст', () => {
  it('первому уровню не показывают Тадж', async () => {
    const { service } = подменитьБазу({ уровень: 1, профессия: 'dervish' });
    const доступные = await service.getAvailableSkills(CHAR, 'dervish');
    expect({
      есть_тадж: доступные.some(s => s.id === TASH.id),
      есть_аламы: доступные.some(s => s.id === ALAMS.id),
    }).toEqual({ есть_тадж: false, есть_аламы: true });
  });

  it('десятому уровню показывают Тадж', async () => {
    const { service } = подменитьБазу({ уровень: 10, профессия: 'dervish' });
    const доступные = await service.getAvailableSkills(CHAR, 'dervish');
    expect({ есть_тадж: доступные.some(s => s.id === TASH.id) }).toEqual({ есть_тадж: true });
  });

  it('уровень достаётся у персонажа, а не выдумывается числом', async () => {
    // Раньше стояло `s.level <= 30`: любой уровень до тридцати получал
    // навык тридцатого. Число было написано руками и ни с чем не сверялось.
    const { service } = подменитьБазу({ уровень: 7, профессия: 'dervish' });
    const доступные = await service.getAvailableSkills(CHAR, 'dervish');
    const лишние = доступные.filter(s => s.level > 7).map(s => s.id);
    expect({ лишние }).toEqual({ лишние: [] });
  });

  it('выученное повторно не предлагается', async () => {
    // Проверка на списке, а не на одном навыке: если бы забыли отсечь
    // выученное, кнопка «Выучить» появлялась бы на уже изученном.
    const { service } = подменитьБазу({ уровень: 10, профессия: 'dervish', выучены: ['alams', 'zikr'] });
    const доступные = await service.getAvailableSkills(CHAR, 'dervish');
    expect({ ids: доступные.map(s => s.id) }).toEqual({ ids: [TASH.id] });
  });
});

describe('Выдуманный порог нигде не остался', () => {
  const корень = join(__dirname, '..', '..', '..');
  const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

  it('в сервисе нет числа 30 как порога доступности', () => {
    const код = читать('server/src/services/SkillsService.ts');
    expect({ порог_30: /s\.level\s*<=\s*30/.test(код) }).toEqual({ порог_30: false });
  });

  it('в панели нет числа 30 как порога доступности', () => {
    // Панель рисует кнопку «Выучить». Показывая кнопку, которую сервер
    // отвергнет, она обещает игроку то, чего не будет. Раньше так и было.
    const код = читать('client/src/app/panels.ts');
    expect({ порог_30: /s\.level\s*<=\s*30/.test(код) }).toEqual({ порог_30: false });
  });

  it('панель берёт уровень у персонажа, а не выдумывает', () => {
    // Не поиск по слову, а требование: должно быть видно, откуда взята
    // цифра, иначе проверка останется зелёной при подмене источника.
    const код = читать('client/src/app/panels.ts');
    expect({
      берёт_у_персонажа: /myLevel = session\.character\?\.level \?\? 0/.test(код),
      фильтрует_по_нему: /s\.level <= myLevel/.test(код),
    }).toEqual({ берёт_у_персонажа: true, фильтрует_по_нему: true });
  });
});
