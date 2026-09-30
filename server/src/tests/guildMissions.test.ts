// Гильдейские задания: правила считаются честно, награда не выдаётся дважды.
//
// РАЗДЕЛЕНИЕ. Логика (когда открыто, выполнено ли, когда откроется снова)
// живёт в GuildMissionRules и проверяется здесь напрямую. Всё, что ходит
// в базу, проверяется на живом сервере отдельным прогоном - здесь бы
// пришлось верить подставной базе.
//
// ПРАВИЛО ДНЯ. Каждая проверка, которая может стать зелёной на
// неверном коде, заменена такой, которая не может. Отсюда проверки на
// мусор в данных: пустой справочник, нулевой откат, required <= 0.
import {
  allDone, blockReason, findMission, isOpen, needMembers, nextAvailable, objectiveIndexes,
} from '../systems/GuildMissionRules';
import { GUILD_MISSIONS, type GuildMission } from '../data/guilds';

const задание = (patch: Partial<GuildMission> = {}): GuildMission => ({
  id: 'test', name: 'T', nameRu: 'Т', description: 'd',
  objectives: [{ type: 'kill', target: 'm', required: 10 }],
  rewards: { guildExp: 1, gold: 1, memberExp: 1 },
  cooldown: 24, minMembers: 5, ...patch,
});

describe('Справочник заданий', () => {
  it('три задания, и каждое ссылается на существующую цель', () => {
    // Проверка против реальных данных, а не против константы в тесте.
    // Раньше в справочнике лежали цели, которых в игре нет - и это было
    // невозможно заметить, потому что импорта на них не было нигде.
    const dunjany = ['dungeon_tabriz_catacombs'];
    expect({
      всего: GUILD_MISSIONS.length,
      типы_целей: [...new Set(GUILD_MISSIONS.flatMap(м => м.objectives.map(o => o.type)))].sort(),
      у_каждого_есть_цель: GUILD_MISSIONS.every(м => м.objectives.length > 0),
      у_каждого_есть_награда: GUILD_MISSIONS.every(м =>
        м.rewards.guildExp > 0 || м.rewards.gold > 0 || м.rewards.memberExp > 0),
      данж_реальный: dunjany.every(id =>
        GUILD_MISSIONS.some(м => м.objectives.some(o => o.target === id))),
    }).toEqual({
      всего: 3,
      типы_целей: ['collect', 'dungeon', 'kill'],
      у_каждого_есть_цель: true,
      у_каждого_есть_награда: true,
      данж_реальный: true,
    });
  });

  it('у каждого задания есть уникальный номер', () => {
    const id = GUILD_MISSIONS.map(м => м.id);
    expect({ уникальны: new Set(id).size === id.length }).toEqual({ уникальны: true });
  });

  it('порядковые номера целей идут подряд с нуля', () => {
    // Номер цели - часть ключа в базе. Если бы они начинались с 1, первая
    // цель не нашла бы своей строки и молча не считалась бы.
    expect(GUILD_MISSIONS.map(objectiveIndexes))
      .toEqual(GUILD_MISSIONS.map(м => Array.from({ length: м.objectives.length }, (_, i) => i)));
  });
});

describe('Порог по составу гильдии', () => {
  it('берётся из справочника, когда он разумный', () => {
    expect(needMembers(задание({ minMembers: 5 }), 30)).toBe(5);
  });

  it('мусор в справочнике не блокирует задание навсегда', () => {
    // 0 и -1 в данных означали бы «нужен ноль участников» или
    // «нужен минус один» - то есть задание недостижимо или всегда
    // доступно всему подряд. И то и другое - не то, чего хотел автор.
    expect(needMembers(задание({ minMembers: 0 }), 30)).toBe(1);
    expect(needMembers(задание({ minMembers: -3 }), 30)).toBe(1);
    expect(needMembers(задание({ minMembers: Number.NaN }), 30)).toBe(1);
  });

  it('не может превысить максимум гильдии', () => {
    // Порог выше max_members означал бы «недоступно» без видимой
    // причины: игрок не может набрать больше, чем влезет.
    expect(needMembers(задание({ minMembers: 999 }), 30)).toBe(30);
  });
});

describe('Откат', () => {
  it('пустое время - открыто', () => {
    expect({ ноль: isOpen(null), нет: isOpen(undefined) })
      .toEqual({ ноль: true, нет: true });
  });

  it('прошедшее время - открыто, будущее - нет', () => {
    const было = new Date(Date.now() - 60_000).toISOString();
    const будет = new Date(Date.now() + 3_600_000).toISOString();
    expect({ было: isOpen(было), будет: isOpen(будет) })
      .toEqual({ было: true, будет: false });
  });

  it('принимает и строку, и Date', () => {
    // База отдаёт timestamptz как Date. Если бы isOpen понимал только
    // строку, Date.parse(Date) даёт NaN, и проверка молча считала бы
    // задание открытым - то есть откат не работал бы.
    const будущее = new Date(Date.now() + 3_600_000);
    expect({ строка: isOpen(будущее.toISOString()), дата: isOpen(будущее) })
      .toEqual({ строка: false, дата: false });
  });

  it('мусор в дате считается открытым, а не блокировкой навсегда', () => {
    // Нечисло в available_at трактовать как «не открыто» - значит
    // заблокировать задание навсегда без видимой игроку причины.
    expect({ мусор: isOpen('не дата'), пусто: isOpen('') }).toEqual({ мусор: true, пусто: true });
  });

  it('отсчёт идёт от сейчас, а не от прошлого отката', () => {
    // Иначе после долгого отсутствия в игре откат накапливался бы с
    // каждой выдачей: 24 + 24 + 24 + ... часов вместо 24.
    const сейчас = Date.UTC(2026, 0, 1, 12, 0, 0);
    const от = new Date(nextAvailable(24, сейчас)).getTime() - сейчас;
    expect({ часов: от / 3_600_000 }).toEqual({ часов: 24 });
  });

  it('мусорный откат не превращается в вечную блокировку', () => {
    const сейчас = Date.UTC(2026, 0, 1, 12, 0, 0);
    const ноль = new Date(nextAvailable(0, сейчас)).getTime() - сейчас;
    const мусор = new Date(nextAvailable(Number.NaN, сейчас)).getTime() - сейчас;
    expect({ ноль, мусор }).toEqual({ ноль: 0, мусор: 0 });
  });
});

describe('Выполнено ли', () => {
  it('одна цель - сравнение с ней', () => {
    const м = задание();
    expect({ меньше: allDone(м, new Map([[0, 9]])), ровно: allDone(м, new Map([[0, 10]])), больше: allDone(м, new Map([[0, 11]])) })
      .toEqual({ меньше: false, ровно: true, больше: true });
  });

  it('все цели нужны, а не любая', () => {
    const м = задание({
      objectives: [
        { type: 'kill', target: 'm', required: 10 },
        { type: 'collect', target: 'i', required: 5 },
      ],
    });
    expect({
      первая_есть: allDone(м, new Map([[0, 10]])),
      обе: allDone(м, new Map([[0, 10], [1, 5]])),
    }).toEqual({ первая_есть: false, обе: true });
  });

  it('нулевая или мусорная цель считается выполненной', () => {
    // required = 0 - это не задача, а мусор. Если считать его невыполненным,
    // задание ждало бы вечно.
    const м = задание({ objectives: [{ type: 'kill', target: 'm', required: 0 }] });
    expect({ ноль: allDone(м, new Map()), мусор: allDone(задание({
      objectives: [{ type: 'kill', target: 'm', required: Number.NaN }] }), new Map()) })
      .toEqual({ ноль: true, мусор: true });
  });

  it('задание без целей выполнено, а не зависло', () => {
    expect({ пустое: allDone(задание({ objectives: [] }), new Map()) })
      .toEqual({ пустое: true });
  });
});

describe('Причина отказа всегда названа', () => {
  it('четыре разные причины дают четыре разных кода', () => {
    // Одна надпись «недоступно» на четыре случая выглядит как поломка.
    expect({
      уже: blockReason(задание(), 30, 30, null, true),
      откат: blockReason(задание(), 30, 30, new Date(Date.now() + 7200_000).toISOString(), false),
      мало: blockReason(задание(), 1, 30, null, false),
      можно: blockReason(задание(), 30, 30, null, false),
    }).toEqual({
      уже: 'MISSION_ALREADY_ACTIVE',
      откат: 'MISSION_ON_COOLDOWN',
      мало: 'MISSION_NEEDS_MEMBERS',
      можно: '',
    });
  });

  it('причин нет - код пустой, а не «null» и не 0', () => {
    expect({ пусто: blockReason(задание(), 30, 30, null, false) === '' }).toEqual({ пусто: true });
  });
});

describe('Поиск задания', () => {
  it('находит по справочнику и не выдумывает', () => {
    const первый = GUILD_MISSIONS[0];
    expect({
      нашёл: findMission(первый.id)?.id === первый.id,
      выдумал: findMission('нет такого'),
      пусто: findMission(''),
      не_строка: findMission(undefined as unknown as string),
    }).toEqual({ нашёл: true, выдумал: null, пусто: null, не_строка: null });
  });
});
