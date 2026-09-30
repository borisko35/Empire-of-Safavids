// Награда за переход: ссылка с настоящим id и золото ровно один раз.
//
// ЧТО БЫЛО. На объявлении сайта висела ссылка «получи бонус в 100 очков
// игрока». Подставить идентификатор игрока в статическую страницу было
// нечем, и там стоял буквальный «?userid=PLAYER_ID»: все игроки уходили к
// партнёру с одним и тем же sub-id, и такой поток партнёрский счёт считает
// невалидным. Награды не выдавал никто - блок <?php ... die('ok'); ?> был
// тем самым колбэком, а PHP в проекте отсутствует.
//
// ГЛАВНОЕ, ЧТО ЛОВЯТ ЭТИ ПРОВЕРКИ. 1) Повторную выдачу. 2) Запись факта и
// проверку «уже было» обязан делать ОДИН запрос с ON CONFLICT DO NOTHING
// RETURNING: проверка «а заявлял ли игрок» в коде оставляет зазор между
// SELECT и UPDATE, в который успевает вклиниться второй запрос. 3) Чужую
// награду получить нельзя - идентификатор персонажа проверяется на
// принадлежность, иначе можно было бы начислять золото себе по чужим id.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RewardService, REWARD_KEY, REWARD_GOLD, linkFor, partnerConfigured,
} from '../services/RewardService';

jest.mock('../services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => ({ query: jest.fn(), queryOne: jest.fn() }) },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// CharacterService подменяется МОДУЛЕМ, потому что RewardService создаёт
// его внутри метода. Подмена поля на экземпляре не действовала: claim
// делал `new CharacterService()` сам, и подменённое поле не читалось
// никогда - четыре проверки выдачи падали.
// Золото, начисленное подменой. Хранится в переменной модуля, а не в
// globalThis: обращение globalThis.что-то без индекса не проходит
// типизацию, а первый вариант проверки на этом и падал.
const золотоПодмены: number[] = [];

jest.mock('../services/CharacterService', () => ({
  CharacterService: class {
    async getCharacterById(id: string) {
      return золотоПодмены.length >= 0 ? { id } : null;
    }
    async addGoldReward(_id: string, amount: number) {
      золотоПодмены.push(amount);
      return 1000 + золотоПодмены.length * amount;
    }
  },
}));

const ЧАР = 'eeeeeeee-1111-4111-8111-111111111111';
const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

/**
 * Подмена базы с РЕАЛЬНОЙ семантикой ON CONFLICT.
 *
 * Ключевое: подмена обязана вести себя как настоящий Postgres, то есть
 * второй INSERT того же ключа не возвращает строку. Подмена, всегда
 * возвращающая строку, проверяла бы несуществующий защитный механизм.
 */
function подменить(opts: { уже_заявлял?: boolean } = {}) {
  const service = new RewardService();
  const запросы: string[] = [];
  const занято = new Set<string>();
  if (opts.уже_заявлял) занято.add(`${ЧАР}|${REWARD_KEY}`);

  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      запросы.push(sql);
      if (/INSERT INTO reward_claims/.test(sql)) {
        const ключ = `${String(params[0])}|${String(params[1])}`;
        if (занято.has(ключ)) return [];      // ON CONFLICT DO NOTHING
        занято.add(ключ);
        return [{ character_id: String(params[0]), gold: Number(params[2]) }];
      }
      return [];
    }),
    queryOne: jest.fn(async (sql: string) => {
      запросы.push(sql);
      if (/FROM reward_claims/.test(sql)) return { n: opts.уже_заявлял ? 1 : 0 };
      return null;
    }),
    transaction: jest.fn(),
  };
  (service as unknown as { db: unknown }).db = db;

  const золото = { начислено: [] as number[] };
  const chars = new RewardService();
  (chars as unknown as { db: unknown }).db = db;
  return { service, запросы, занято, золото };
}

/** Золото, начисленное подменой: тот же массив, что и у подмены. */
function начисленное(): number[] {
  return золотоПодмены;
}

/** Сколько золота начислили за весь набор. */
beforeEach(() => { золотоПодмены.length = 0; });

describe('Ссылка собирается на настоящем игроке', () => {
  it('в ссылке идентификатор игрока, а не слово PLAYER_ID', () => {
    // Главная причина, по которой маршрут и нужен. Со строкой-заглушкой
    // все игроки уходят к партнёру с одним sub-id, и партнёрский счёт
    // считает поток невалидным.
    const url = linkFor(ЧАР);
    expect({
      подставлен_id: url.includes(`userid=${ЧАР}`),
      заглушки_нет: !url.includes('PLAYER_ID'),
      адрес_верный: url.startsWith('https://browsermmorpg.com/px/087bd24089ff03b6f2fd2bd5f0cc5594'),
    }).toEqual({ подставлен_id: true, заглушки_нет: true, адрес_верный: true });
  });

  it('двум игрокам достаются разные ссылки', () => {
    // Прямая проверка на «не одинаковые у всех»: именно этим заканчивалось
    // бы заглушкой PLAYER_ID.
    const a = linkFor('первый-игрок');
    const b = linkFor('второй-игрок');
    expect({ разные: a !== b }).toEqual({ разные: true });
  });

  it('ссылка настроена', () => {
    expect({ настроена: partnerConfigured() }).toEqual({ настроена: true });
  });

  it('на сайте больше нет буквального PLAYER_ID', () => {
    // Объявление на бою выключено, но текст с заглушкой остался в базе
    // как мина: стоит кому-то включить баннер - и заглушка снова увидит
    // игроков. Сама проверка оценивает исходник шаблона, а не текст из
    // базы, который меняется без пересборки.
    const главная = читать('client/web/index.html');
    expect({
      заглушки_в_шаблоне_лендинга: главная.includes('PLAYER_ID'),
      заглушка_есть_только_в_константе: /PARTNER_URL[\s\S]*userid/.test(
        читать('server/src/services/RewardService.ts')),
    }).toEqual({ заглушки_в_шаблоне_лендинга: false, заглушка_есть_только_в_константе: true });
  });
});

describe('Награда выдаётся ровно один раз', () => {
  it('первый запрос выдаёт золото', async () => {
    const { service } = подменить();
    const золото = начисленное();
    const итог = await service.claim(ЧАР);
    expect({
      код: 'ok', выдано: итог.ok, повтор: (итог as any).alreadyClaimed,
      начислено: золото,
    }).toEqual({ код: 'ok', выдано: true, повтор: false, начислено: [REWARD_GOLD] });
  });

  it('второй запрос не выдаёт ничего', async () => {
    // ГЛАВНОЕ. Одно нажатие, одна награда - навсегда на персонажа.
    const { service } = подменить();
    const золото = начисленное();
    await service.claim(ЧАР);
    const второй = await service.claim(ЧАР);
    expect({
      второй_отказ: !второй.ok,
      код: (второй as any).code,
      золото_начислено_за_оба_раза: золото.length,
    }).toEqual({ второй_отказ: true, код: 'already_claimed', золото_начислено_за_оба_раза: 1 });
  });

  it('десять запросов подряд - всё равно одна выдача', async () => {
    const { service } = подменить();
    const золото = начисленное();
    for (let i = 0; i < 10; i++) await service.claim(ЧАР);
    expect({ выдач: золото.length }).toEqual({ выдач: 1 });
  });

  it('уже полученное заранее - тоже отказ, золото не трогаем', async () => {
    const { service } = подменить({ уже_заявлял: true });
    const итог = await service.claim(ЧАР);
    expect({ код: (итог as any).code, начислено: начисленное().length })
      .toEqual({ код: 'already_claimed', начислено: 0 });
  });

  it('у каждого персонажа своя награда: чужой заявкой не блокируется', async () => {
    // Прежняя проверка считала, что в наборе ключей нет чужих, - а там и
    // не могло быть, потому что вставлялся только ключ одного персонажа.
    // Она была зелёной всегда и ничего не утверждала.
    //
    // Настоящий случай: запрет повторной выдаты не должен превращаться в
    // запрет для остальных. Второй игрок со своим идентификатором
    // обязан получить свою награду.
    const другой = 'ffffffff-1111-4111-8111-111111111111';
    const { service, занято } = подменить();
    const первый = await service.claim(ЧАР);
    const второй = await service.claim(другой);
    expect({
      первый_получил: первый.ok,
      второй_тоже_получил: второй.ok,
      отметок_две: занято.size,
      начислено_дважды: начисленное().length,
    }).toEqual({
      первый_получил: true, второй_тоже_получил: true,
      отметок_две: 2, начислено_дважды: 2,
    });
  });
});

describe('Защита держится на базе, а не на коде', () => {
  it('запись факта и проверка «уже было» - один запрос', () => {
    // Если бы сначала шёл SELECT «есть ли отметка», а потом INSERT, между
    // ними успевал бы вклиниться второй запрос, и награда выдалась бы
    // дважды. Поэтому в коде обязан быть ON CONFLICT DO NOTHING RETURNING.
    const код = читать('server/src/services/RewardService.ts');
    const блок = код.slice(код.indexOf('async claim'), код.indexOf('async hasClaimed'));
    expect({
      on_conflict: /ON CONFLICT \(character_id, reward_key\) DO NOTHING/.test(блок),
      returning: /RETURNING character_id, gold/.test(блок),
      проверки_до_insert_нет: !/SELECT[\s\S]{0,200}reward_claims[\s\S]{0,400}INSERT INTO reward_claims/.test(блок),
    }).toEqual({ on_conflict: true, returning: true, проверки_до_insert_нет: true });
  });

  it('золото начисляется после записи факта, а не до неё', () => {
    // Обратный порядок дал бы золото дважды, если бы запись упала.
    const код = читать('server/src/services/RewardService.ts');
    const блок = код.slice(код.indexOf('async claim'), код.indexOf('async hasClaimed'));
    const insert = блок.indexOf('INSERT INTO reward_claims');
    const золото = блок.indexOf('addGoldReward');
    expect({ insert_есть: insert > 0, золото_после: золото > insert })
      .toEqual({ insert_есть: true, золото_после: true });
  });

  it('в базе запрет дубля, а не только код', () => {
    // Первичный ключ по паре (персонаж, награда) - запрет на уровне базы.
    // Проверка в коде может обойтись, ключ - нет.
    const миграция = читать('database/migrations/055_reward_claims.sql');
    expect({
      составной_ключ: /PRIMARY KEY \(character_id, reward_key\)/.test(миграция),
      сумма_неотрицательна: /CHECK \(gold >= 0\)/.test(миграция),
    }).toEqual({ составной_ключ: true, сумма_неотрицательна: true });
  });

  it('сумма награды одна и та же в сервисе и в маршруте', () => {
    // В маршруте была написана цифра рядом с константой. Два числа в двух
    // местах - это описание, которое однажды разойдётся с выдачей.
    const маршрут = читать('server/src/routes/game.ts');
    const блок = маршрут.slice(маршрут.indexOf("'/reward-link'"), маршрут.indexOf("'/reward-claim'"));
    expect({
      использует_константу: /gold: REWARD_GOLD/.test(блок),
      голой_цифры_нет: !/gold:\s*\d+/.test(блок),
    }).toEqual({ использует_константу: true, голой_цифры_нет: true });
  });
});

describe('Чужую награду получить нельзя', () => {
  it('маршруты проверяют принадлежность персонажа', () => {
    // Без этой проверки можно было бы начислить золото себе, подставив
    // идентификатор чужого персонажа - или получить ссылку за чужой id.
    const маршрут = читать('server/src/routes/game.ts');
    const ссылка = маршрут.slice(маршрут.indexOf("'/reward-link'"), маршрут.indexOf("'/reward-claim'"));
    const забрать = маршрут.slice(маршрут.indexOf("'/reward-claim'"), маршрут.indexOf("'/reward-claim'") + 700);
    expect({
      ссылка_проверяет: /requireCharacterOwnership\(\)/.test(ссылка),
      выдача_проверяет: /requireCharacterOwnership\(\)/.test(забрать),
    }).toEqual({ ссылка_проверяет: true, выдача_проверяет: true });
  });

  it('повторная выдача отвечает 409, а не 200 с нулём', async () => {
    // Игрок должен отличать «уже получено» от «начислено». Ответ 200 с
    // нулём выглядел бы как успех, и кнопка гасла бы не по той причине.
    // Код already_claimed в маршруте НЕ написан: маршрут отдаёт итог.code
    // из сервиса. Первая версия проверки искала эту строку в маршруте и
    // ругалась на верный код - на дублирование строки, которой там и не
    // должно быть.
    const маршрут = читать('server/src/routes/game.ts');
    const сервис = читать('server/src/services/RewardService.ts');
    expect({
      есть_409: /status\(409\)/.test(маршрут),
      код_приходит_из_сервиса: /error: итог\.code/.test(маршрут),
      код_задан_в_сервисе: /'already_claimed'/.test(сервис),
    }).toEqual({ есть_409: true, код_приходит_из_сервиса: true, код_задан_в_сервисе: true });
  });
});
