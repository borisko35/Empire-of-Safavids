// Журнал боёв: он был создан, но в него не писал никто.
//
// ЧТО БЫЛО. Таблица combat_logs появилась в первой миграции, со всей
// схемой: атакующий, цель, навык, урон, крит, признак PvP, регион, время.
// За все месяцы в неё не записал НИКТО. Пункт плана звучал «журналирование
// боёв — таблица плюс запись урона», но таблица уже была готова: не
// хватало самой записи. Проверено на боевой базе: 0 строк.
//
// ПОЧЕМУ СХЕМУ ПРИШЛОСЬ МЕНЯТЬ. Колонка target_id объявлена UUID NOT NULL.
// У игрока UUID есть, у монстра идентификатор инстанса такой:
//   mob_bandit_scout_1756500000000_a3f9x
// То есть урон по монстру в существующую таблицу физически не помещался.
// При этом колонка is_pvp была заведена — видно, что PvE задумывался, но
// схема под него не сложилась, и дело замерло на пустой таблице.
//
// ПРОВЕРЯЕМ ПОВЕДЕНИЕ, А НЕ ТЕКСТ. Решение «писать ли этот удар» вынесено
// в чистую функцию buildCombatLogEntry именно для этого. Проверка поиском
// по исходнику GameSocketHandler нашла бы строку type !== 'normal' и
// на этом успокоилась бы — даже если бы условие было перевёрнуто.
const db = {
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
};
jest.mock('../services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => db },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CombatLogService, buildCombatLogEntry, type CombatLogEntry } from '../services/CombatLogService';
import { isUuid } from '../utils/uuid';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const PLAYER = { kind: 'player' as const, id: '11111111-1111-4111-8111-111111111111', name: 'Рустам' };
const hit = {
  attackerId: '22222222-2222-4222-8222-222222222222',
  skillId: 'strike_1',
  damage: 137,
  isCritical: true,
  region: 'shiraz',
};

beforeEach(() => { db.query.mockReset().mockResolvedValue([]); });
const service = () => new CombatLogService();

describe('Что попадает в журнал', () => {
  it('удар по игроку пишется целиком', () => {
    const e = buildCombatLogEntry({ ...hit, target: PLAYER });
    expect({
      цель: e?.targetId, тип: e?.targetKind, имя: e?.targetName,
      навык: e?.skillId, урон: e?.damage, крит: e?.isCritical, pvp: e?.isPvp,
    }).toEqual({
      цель: PLAYER.id, тип: 'player', имя: 'Рустам',
      навык: 'strike_1', урон: 137, крит: true, pvp: true,
    });
  });

  it('удар по монстру не идёт в колонку UUID, а идёт в мирокаб', () => {
    // Главная причина, по которой пришлось менять схему: target_id UUID
    const e = buildCombatLogEntry({
      ...hit,
      target: { kind: 'monster', instanceId: 'mob_div_fire_1756500000000_a3f9x', name: 'Огненный див', monsterType: 'boss' },
    });
    expect({ uuid: e?.targetId, мирокаб: e?.targetInstance, тип: e?.targetKind, pvp: e?.isPvp })
      .toEqual({ uuid: null, мирокаб: 'mob_div_fire_1756500000000_a3f9x', тип: 'monster', pvp: false });
  });

  it('обычный мусор не пишется, элит и босс пишутся', () => {
    // Потоковый вид удара, в цифрах бесполезен; жалобы «стена» идут по элитам
    const at = (monsterType: string) =>
      buildCombatLogEntry({ ...hit, target: { kind: 'monster', instanceId: 'x_1', name: 'Бандит', monsterType } });
    expect({ мусор: at('normal'), элит: at('elite'), босс: at('boss') })
      .toEqual({ мусор: null, элит: expect.objectContaining({ targetKind: 'monster' }), босс: expect.objectContaining({ targetKind: 'monster' }) });
  });

  it('удар без навыка записывается как есть, а не падает', () => {
    // Обычный удар идёт без навыка, а колонка NOT NULL. null здесь
    // обязателен: пропуск поля уронил бы удар
    expect(buildCombatLogEntry({ ...hit, skillId: undefined, target: PLAYER })?.skillId).toBeNull();
  });
});

describe('Запись в базу', () => {
  const entry: CombatLogEntry = {
    attackerId: hit.attackerId, targetId: PLAYER.id, targetInstance: null,
    targetKind: 'player', targetName: 'Рустам', skillId: 'strike_1',
    damage: 137, isCritical: true, isPvp: true, region: 'shiraz',
  };

  it('вставляет ровно те поля, которые есть в таблице', async () => {
    await service().record(entry);
    const [sql, params] = db.query.mock.calls[0];
    for (const col of ['attacker_id', 'target_id', 'target_instance', 'target_kind', 'target_name', 'skill_id', 'damage', 'is_critical', 'is_pvp', 'region']) {
      expect({ колонка: col, есть_в_sql: sql.includes(col) }).toEqual({ колонка: col, есть_в_sql: true });
    }
    expect(params).toEqual([entry.attackerId, entry.targetId, null, 'player', 'Рустам', 'strike_1', 137, true, true, 'shiraz']);
  });

  it('ошибка базы не ломает бой', async () => {
    // Журнал — наблюдатель, а не условие боя. Если запись бросает наружу,
    // один сбой базы превращает удары игрока в ошибки
    db.query.mockRejectedValue(new Error('connection terminated'));
    await expect(service().record(entry)).resolves.toBeUndefined();
  });

  it('решение «не писать» не превращается в попытку вставки', async () => {
    await service().record(buildCombatLogEntry({ ...hit, target: { kind: 'monster', instanceId: 'x', name: 'Мусор', monsterType: 'normal' } }));
    expect({ попыток_вставки: db.query.mock.calls.length }).toEqual({ попыток_вставки: 0 });
  });
});

describe('Срок применяется к запросу, а не только принимается', () => {
  // Первая версия принимала days в подписи и молча не использовала: вопрос
  // «что было в бою» получал ответ за всю историю, и найти среди неё
  // нужный бой было нечем. Типизатор это видел, а проверки на текст — нет.
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
    logged_at: `2026-09-2${i}T10:00:00`, attacker_id: hit.attackerId, attacker_name: 'Тест',
    target_kind: 'player', target_name: 'Рустам', target_id: PLAYER.id,
    skill_id: 'strike_1', damage: 10, is_critical: false, is_pvp: true, region: 'shiraz',
  }));

  it('в запрос попадает отрезок в днях', async () => {
    db.query.mockResolvedValue(rows(2));
    await service().getForCharacter(PLAYER.id, 30);
    const [sql, params] = db.query.mock.calls[0];
    expect({ срок_в_параметрах: params[1], отрезок_в_запросе: /logged_at >= NOW\(\) - \(\$2/.test(sql) })
      .toEqual({ срок_в_параметрах: '30', отрезок_в_запросе: true });
  });

  it('срок из строки или мусора не ломает запрос', async () => {
    // Из days=-1 нельзя получить «за всё, что было», из days=999999 —
    // попытку вычитать сантионное поле. Приводим сами.
    for (const bad of [-1, 0, NaN, Infinity, 10_000]) {
      db.query.mockResolvedValue([]);
      await service().getForCharacter(PLAYER.id, bad);
      const days = Number(db.query.mock.calls[0][1][1]);
      expect({ days, в_разумных_границах: days > 0 && days <= 365 }).toEqual({ days: expect.any(Number), в_разумных_границах: true });
    }
  });

  it('запрос берёт и нанесённый, и полученный урон', async () => {
    // ВАЖНО, ЧТО ЗДЕСЬ ПРИЗНАЁТСЯ. Мок базы возвращает подставленные строки
    // и не выполняет SQL, поэтому счёт урона он проверить не может: слой
    // «из запроса убрали ветку target_id» прошёл на этой проверке зелёным.
    // Считающий код проверен выше — на настоящих строках. А форму запроса
    // приходится смотреть глазами, и это единственное, что тут можно.
    db.query.mockResolvedValue([]);
    await service().getForCharacter(PLAYER.id, 7);
    const sql = db.query.mock.calls[0][0];
    expect({ нанесённый: /attacker_id\s*=\s*\$1/.test(sql), полученный: /target_id\s*=\s*\$1/.test(sql) })
      .toEqual({ нанесённый: true, полученный: true });
  });
});

describe('Сводка по истории боёв', () => {
  const uuid = hit.attackerId;
  const other = '33333333-3333-4333-8333-333333333333';

  it('считает нанесённое, полученное и криты', async () => {
    db.query.mockResolvedValue([
      { attacker_id: uuid, target_id: other, target_kind: 'player', target_name: 'Шах', skill_id: 'a', damage: 100, is_critical: true, is_pvp: true, region: 'shiraz', logged_at: 'x' },
      { attacker_id: uuid, target_id: other, target_kind: 'player', target_name: 'Шах', skill_id: 'b', damage: 50, is_critical: false, is_pvp: true, region: 'shiraz', logged_at: 'x' },
      { attacker_id: other, target_id: uuid, target_kind: 'player', target_name: 'Рустам', skill_id: 'c', damage: 900, is_critical: false, is_pvp: true, region: 'shiraz', logged_at: 'x' },
    ]);
    const { summary } = await service().getForCharacter(uuid, 7);
    expect(summary.dealt).toEqual({ hits: 2, damage: 150, criticals: 1 });
    expect(summary.taken).toEqual({ hits: 1, damage: 900, criticals: 0 });
  });

  it('группирует по навыкам и по целям, сильнейшие первыми', async () => {
    db.query.mockResolvedValue([
      { attacker_id: uuid, target_id: other, target_kind: 'player', target_name: 'Шах', skill_id: 'слабый', damage: 10, is_critical: false, is_pvp: true, region: 's', logged_at: 'x' },
      { attacker_id: uuid, target_id: other, target_kind: 'player', target_name: 'Шах', skill_id: 'сильный', damage: 300, is_critical: false, is_pvp: true, region: 's', logged_at: 'x' },
      { attacker_id: uuid, target_id: null, target_kind: 'monster', target_name: 'Огненный див', target_instance: 'm_1', skill_id: 'сильный', damage: 200, is_critical: false, is_pvp: false, region: 's', logged_at: 'x' },
    ]);
    const { summary } = await service().getForCharacter(uuid, 7);
    expect(summary.bySkill).toEqual([
      { skillId: 'сильный', hits: 2, damage: 500 },
      { skillId: 'слабый', hits: 1, damage: 10 },
    ]);
    expect(summary.byTarget[0]).toEqual({ targetName: 'Шах', targetKind: 'player', hits: 2, damage: 310 });
  });

  it('пустая история — это нули, а не ошибка', async () => {
    // Свежий персонаж без единого боя: пустой ответ должен быть таким же
    // спокойным, как полный
    db.query.mockResolvedValue([]);
    const { rows, summary } = await service().getForCharacter(uuid, 7);
    expect({ строк: rows.length, нанесено: summary.dealt, получено: summary.taken })
      .toEqual({ строк: 0, нанесено: { hits: 0, damage: 0, criticals: 0 }, получено: { hits: 0, damage: 0, criticals: 0 } });
  });
});

describe('Мусор в идентификаторе не доезжает до базы', () => {
  // Колонка имеет тип UUID, и Postgres на мусор отвечает ошибкой приведения
  // типа, а не пустым результатом. Владелец увидел бы 500 там, где человек
  // опечатался. Проверяем сам признак, а не наличие регулярки в маршруте.
  it('принимает настоящий UUID в любом регистре', () => {
    for (const good of ['11111111-1111-4111-8111-111111111111', 'ABCDEF01-1111-4111-8111-111111111111', '0f8fad5b-d9cb-469f-a165-70867728950e']) {
      expect({ значение: good, принят: isUuid(good) }).toEqual({ значение: good, принят: true });
    }
  });

  it('отвергает всё, что не UUID', () => {
    const bad = ['', 'abc', 'не uuid', '1; DROP TABLE combat_logs', '1111-1111-1111-1111', '11111111-1111-4111-8111-1111111111111', null, undefined, 42, {}];
    for (const value of bad) {
      expect({ значение: String(value), принят: isUuid(value) }).toEqual({ значение: String(value), принят: false });
    }
  });
});

describe('Схема позволяет тому, что пишет сервис', () => {
  const migration = read('database/migrations/043_combat_log_pve_and_partitions.sql');
  const service = read('server/src/services/CombatLogService.ts');

  it('цель монстра помещается в схему', () => {
    // Если миграция не снимет NOT NULL с target_id, первая же запись об
    // ударе по элите упадёт на боевой базе — и упадёт молча, потому что
    // запись глотает ошибки.
    //
    // Якорь многострочный и без «--» перед командой. Первая версия искала
    // просто подстроку и осталась зелёной на сломе, где команда была
    // закомментирована: текст в файле остался, а дела — нет. Пятая холостая
    // проверка за день, и самая обидная — именно на этом файле.
    expect({
      снимает_not_null: /^\s*ALTER COLUMN target_id DROP NOT NULL;/m.test(migration),
      добавлена_колонка: /^\s*ADD COLUMN IF NOT EXISTS target_instance VARCHAR/m.test(migration),
    }).toEqual({ снимает_not_null: true, добавлена_колонка: true });
  });

  it('вставляемые колонки существуют в миграции', () => {
    // Обратная проверка: сервис пишет десять колонок, и все десять должны
    // быть объявлены. Список берём из текста вставки, а не из подписи
    const inserted = /INSERT INTO combat_logs\s*\(([^)]+)\)/.exec(service)?.[1] ?? '';
    const cols = inserted.split(',').map(c => c.trim()).filter(Boolean);
    const declared = ['target_instance', 'target_kind', 'target_name'].filter(c => migration.includes(c));
    expect({ вставляется: cols.length, объявлено_нового: declared.length }).toEqual({ вставляется: 10, объявлено_нового: 3 });
  });

  it('партиции закрывают весь текущий год, а не одну', () => {
    // Заявлена была одна, за январь 2024, плюс ловушка DEFAULT, в которую
    // сваливалось всё новое. Проверка на «партиция хоть одна» оставалась
    // зелёной после удаления целой четверти 2026 года — год был бы на
    // три четверти без партиций, и никто бы об этом не узнал.
    for (const q of ['q1', 'q2', 'q3', 'q4']) {
      expect({ четверть: q, есть: migration.includes(`combat_logs_2026_${q} PARTITION OF combat_logs`) })
        .toEqual({ четверть: q, есть: true });
    }
  });

  it('у нового индекса на поиск по персонажу есть причина', () => {
    // Поиск «покажи бои вот этого игрока» шёл полным перебором: кроме
    // составного первичного ключа (id, logged_at) индексов не было вовсе
    const idx = [...migration.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)/g)].map(m => m[1]);
    expect(idx).toEqual(expect.arrayContaining(['idx_combat_logs_attacker', 'idx_combat_logs_target']));
  });
});

describe('Маршрут истории боёв', () => {
  const route = read('server/src/routes/admin.ts');

  // ПРИЗНАЁТСЯ ЧЕСТНО. В проекте нет поднятого приложения в тестах: ни
  // supertest, ни http-запросов. Поэтому доступность маршрута проверяется
  // по тексту объявления, а не настоящим запросом. Это слабее, чем поведение,
  // и сказать об этом надо прямо: если бы в проекте появился HTTP-харнесс,
  // эти три проверки следовало бы заменить запросами без токена, с токеном
  // гостя и с токеном админа.
  it('закрыт проверкой администратора', () => {
    // Слой «убрали adminCheck» остался зелёным: на маршрут не было ни одной
    // проверки. Журнал боёв — это личные данные игроков, и открыть его всем
    // значит выложить чужую историю встреч в общий доступ.
    expect(/adminRouter\.get\('\/combat-log', adminCheck,/.test(route)).toBe(true);
  });

  it('мусорный идентификатор отбивается до базы', () => {
    // Иначе Postgres ответит ошибкой приведения типа UUID, и владелец увидит
    // 500 там, где человек опечатался
    expect(/if \(!isUuid\(characterId\)\)/.test(route) && /status\(400\)/.test(route)).toBe(true);
  });

  it('срок задаётся и ограничивается', () => {
    // Из days=999999 получилась бы попытка вычитать сантионное поле
    expect(/const days = Math\.min\(90, Math\.max\(1, Number\(req\.query\.days\) \|\| 7\)\)/.test(route)).toBe(true);
  });
});

describe('Оба места удара пишут в журнал', () => {
  const handler = read('server/src/socket/GameSocketHandler.ts');

  it('PvP и PvE вызывают решение о записи', () => {
    // Именно вызов функции, а не строка с полями: иначе проверка была бы
    // довольна любым текстом рядом
    const calls = handler.match(/combatLog\.record\(buildCombatLogEntry\(\{/g) ?? [];
    expect({ мест_удара: calls.length }).toEqual({ мест_удара: 2 });
  });

  it('в PvE передаётся тип монстра из каталога', () => {
    // Без типа решение не отличит мусор от элиты, и весь PvE уйдёт в
    // журнал либо, что хуже, не уйдёт совсем
    expect(/monsterType: monsterCtx\.definition\.type/.test(handler)).toBe(true);
  });

  it('запись не ждёт: удар не должен ждать журнал', () => {
    // await здесь означал бы, что игрок видит задержку удара на запись в
    // базу. void + проглатывание ошибок внутри сервиса этого не допускают
    const awaited = /await\s+combatLog\.record/.test(handler);
    expect({ запись_без_await: !awaited }).toEqual({ запись_без_await: true });
  });
});
