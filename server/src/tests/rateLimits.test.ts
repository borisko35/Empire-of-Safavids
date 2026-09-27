// Ограничение частоты: было написано и не подключено.
//
// ЧТО БЫЛО. Три готовых пресета в rateLimiter.ts (api, auction, chat) не
// использовались НИ РАЗУ — только authRateLimiter был подключён. Отдельно:
// задержки CHAT_LIMITS (5 секунд на мировой чат, 1 на регион) были
// объявлены, импортированы и не применялись ни разу — обработчик сообщений
// только резал длину. Итог: ограничения на частоту не существовало вовсе.
// Один клиент мог забить мировой чат со скоростью отправки кадров, и
// остальные игроки не могли ничего написать в принципе.
//
// Почему это единственная находка про безопасность в отчёте, и почему она
// же опаснее прочих: остальные находки — это отсутствующие удобства, а это
// открытая дверь.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const constants = stripComments(read('shared/constants.ts'));
const handler = stripComments(read('server/src/socket/GameSocketHandler.ts'));
const client = stripComments(read('client/src/app/world.ts'));
const game = read('server/src/routes/game.ts');
const forum = read('server/src/routes/forum.ts');
const feedback = read('server/src/routes/feedback.ts');

describe('Чат: задержка наконец применяется', () => {
  it('обработчик сообщений проверяет задержку', () => {
    // ГЛАВНОЕ. Раньше здесь была только обрезка длины
    expect(handler).toMatch(/chatCooldownFor\(data\.channel\)/);
  });

  it('задержки берутся из общих констант, а не пишутся числами', () => {
    // Числа в двух местах разъедутся, и игрок получит либо бан за спам,
    // либо бесконечный поток сообщений
    expect(handler).toMatch(/CHAT_LIMITS\.WORLD_CHAT_COOLDOWN_MS/);
    expect(handler).toMatch(/CHAT_LIMITS\.REGION_CHAT_COOLDOWN_MS/);
    expect(handler).toMatch(/CHAT_LIMITS\.GUILD_CHAT_COOLDOWN_MS/);
  });

  it('все три константы задержек объявлены', () => {
    expect(constants).toMatch(/WORLD_CHAT_COOLDOWN_MS:\s*5000/);
    expect(constants).toMatch(/REGION_CHAT_COOLDOWN_MS:\s*1000/);
    // Гильдейский и групповой шли одной веткой. Без своей константы они
    // остались бы вообще без ограничения
    expect(constants).toMatch(/GUILD_CHAT_COOLDOWN_MS:\s*500/);
  });

  it('задержка считается на персонажа, а не на соединение', () => {
    // У игрока может быть открыто несколько вкладок. Считать на соединение
    // — значит закрыть лишнюю вкладку и получить «бан», которого нет
    expect(handler).toMatch(/chatLastSent = new Map<string, Partial<Record<ChatChannel, number>>>\(\)/);
  });

  it('счётчик затирается при выходе игрока', () => {
    // Иначе карта росла бы на каждого зашедшего и держала в памяти его id
    // до перезапуска сервера
    expect(handler).toMatch(/this\.chatLastSent\.delete\(socket\.characterId\)/);
  });

  it('отказ не проглатывается молча', () => {
    // Молчание хуже отказа: игрок решил бы, что его сообщения не доходят,
    // и просто перестал бы писать в чат
    expect(handler).toMatch(/socket\.emit\('chat:error', \{ code: 'CHAT_COOLDOWN', waitMs \}\)/);
  });
});

describe('Чат: игрок понимает, почему не отправилось', () => {
  it('клиент переводит код отказа', () => {
    // Сервер отдаёт код, а не готовый текст: перевод живёт на клиенте,
    // иначе игрок увидел бы служебное слово CHAT_COOLDOWN в чате
    expect(client).toMatch(/e\.code === 'CHAT_COOLDOWN'/);
    expect(client).toMatch(/t\('chat\.cooldown'\)/);
  });

  it('показывается время ожидания', () => {
    // Без времени игрок не понимает, надо ли ждать или забыть
    expect(client).toMatch(/Math\.ceil\(\(e\.waitMs \?\? 1000\) \/ 1000\)/);
  });

  it('остальные ошибки чата по-прежнему показываются', () => {
    // «Вы не в гильдии» и подобные приходят готовым текстом с сервера.
    // Если убрать этот запасной путь, игрок перестанет понимать такие отказы
    expect(client).toMatch(/if \(e\.message\) chatMessage\(null, e\.message, true\)/);
  });

  it('ключ перевода есть во всех языках', () => {
    for (const lang of ['ru', 'en', 'az']) {
      const json = JSON.parse(read(`shared/locales/${lang}.json`)) as { chat: Record<string, string> };
      expect({ lang, has: !!json.chat.cooldown, hasSec: json.chat.cooldown.includes('{sec}') })
        .toEqual({ lang, has: true, hasSec: true });
    }
  });
});

describe('Аукцион: пресет наконец подключён', () => {
  it('выставление лота ограничено', () => {
    // Лот пишет в базу и трогает золото. Без ограничения этим можно было
    // нагрузить базу, а заодно получить много лотов от одного аккаунта
    expect(game).toMatch(/post\('\/auction\/list', auctionRateLimiter/);
  });

  it('покупка лота ограничена тоже', () => {
    // Пропустить только выставление было бы полумерой: покупка двигает
    // золото продавца и пишет транзакцию
    expect(game).toMatch(/post\('\/auction\/:listingId\/buy', auctionRateLimiter/);
  });

  it('ограничитель стоит ДО проверки прав', () => {
    // Иначе запрос без прав всё равно дойдёт до БД. Смысл ограничителя —
    // срезать поток до самой дорогой операции
    expect(game).toMatch(/auctionRateLimiter, secureMiddleware/);
  });
});

describe('Записи без прав: форум и обратная связь', () => {
  it('создание темы ограничено', () => {
    expect(forum).toMatch(/post\('\/topics', apiRateLimiter/);
  });

  it('ответ в теме ограничен', () => {
    expect(forum).toMatch(/post\('\/topics\/:id\/posts', apiRateLimiter/);
  });

  it('сообщение об ошибке ограничено', () => {
    expect(feedback).toMatch(/post\('\/', apiRateLimiter/);
  });

  it('это единственные места, где пишут без прав', () => {
    // Проверяем, что ограничено именно то, что доступно всем, а не
    // что-то под админкой: там ограничитель был бы бесполезен
    expect(forum).not.toMatch(/post\('\/topics\/:id\/moderate', apiRateLimiter/);
  });
});

describe('Сам ограничитель работает правильно', () => {
  it('отказ при превышении, а не молчание', () => {
    const rl = stripComments(read('server/src/middleware/rateLimiter.ts'));
    expect(rl).toMatch(/res\.status\(429\)/);
  });

  it('показывает игроку, сколько осталось', () => {
    const rl = stripComments(read('server/src/middleware/rateLimiter.ts'));
    expect(rl).toMatch(/X-RateLimit-Remaining/);
  });

  it('при недоступном Redis запрос пропускается', () => {
    // ВАЖНО. Строгий лимит при упавшем Redis превратил бы любой сбой
    // базы в полную невозможность зайти в игру. Лучше перегнуть, чем
    // заблокировать игроков
    const rl = stripComments(read('server/src/middleware/rateLimiter.ts'));
    expect(rl).toMatch(/fail-open|catch \{[\s\S]*?next\(\)/);
  });

  it('окно ограничения выставляется один раз', () => {
    // Иначе счётчик никогда не сбросится и игрок заблокируется навсегда
    const rl = stripComments(read('server/src/middleware/rateLimiter.ts'));
    expect(rl).toMatch(/current === 1[\s\S]*?expire\(/);
  });
});
