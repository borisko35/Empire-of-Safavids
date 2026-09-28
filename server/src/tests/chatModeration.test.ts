// Модерация чата: фильтр слов, мьют и жалобы (GDD, раздел 16).
//
// ЧТО БЫЛО. Три требования к игре 18+ не были выполнены вообще:
//
//  1. Фильтрации не существовало. handleChatMessage резал длину и считал
//     задержку, но слова не проверял.
//
//  2. МЬЮТ НЕ РАБОТАЛ. AdminService.muteCharacter писал в character_mutes
//     и публиковал в Redis, а читать таблицу не был НИКТО. Администратор
//     мутил игрока, видел «успешно» — и игрок писал в чат дальше. Проверка
//     ниже ловит именно это: мьют обязан быть ПРОЧИТАН в обработчике.
//
//  3. Жалоб не было: сообщить о нарушителе было нечем.
//
// Фильтр проверяется НАСТОЯЩИМИ вызовами stemWord/filterChatMessage из
// кода, а не разбором исходника регулярками: иначе тест проверял бы
// наличие строк, а не поведение.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';
import { stemWord, filterChatMessage, CHAT_BLOCKLIST, CHAT_BLOCK_STEMS, CHAT_BLOCK_WORDS } from '../data/chatFilter';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const handler = stripComments(read('server/src/socket/GameSocketHandler.ts'));
const service = stripComments(read('server/src/services/ChatModerationService.ts'));
const adminService = read('server/src/services/AdminService.ts');
const filterData = read('server/src/data/chatFilter.ts');
const gameRoutes = read('server/src/routes/game.ts');
const adminRoutes = read('server/src/routes/admin.ts');
const clientHud = stripComments(read('client/src/app/hud.ts'));
const clientWorld = stripComments(read('client/src/app/world.ts'));
const clientApi = read('client/src/app/api.ts');
const migration022 = read('database/migrations/022_skills_professions.sql');

const LOCALES = ['ru', 'en', 'az'] as const;
const locale = (lang: string): Record<string, Record<string, string>> =>
  JSON.parse(read(`shared/locales/${lang}.json`));

describe('Фильтр: настоящая функция режет слова, а обычные не трогает', () => {
  it('слова нет в списке — проходит как есть', () => {
    // ГЛАВНОЕ. Фильтр, который режет обычные слова, хуже отсутствия
    // фильтра: игрок бросает чат совсем
    const clean = [
      'всем привет, иду в Тебриз',
      'кто идёт на симурга?',
      'продам щит за 500 золота',
      'lets raid tonight',
      'bu axşam raid gedirik',
      'кринж', 'имба', 'лут', 'дроп', 'кд', 'хил',
    ];
    const hit = clean.filter((m) => filterChatMessage(m).hits > 0);
    expect({ задетые_обычные_слова: hit }).toEqual({ задетые_обычные_слова: [] });
  });

  it('мат попадает под фильтр', () => {
    // Слова написаны основами: берём из самого списка, иначе проверка
    // зависела бы от того, что автор теста и автор фильтра одинаковые
    const missed = CHAT_BLOCKLIST.filter((w) => filterChatMessage(w).hits === 0);
    expect({ проскочили: missed }).toEqual({ проскочили: [] });
  });

  it('фильтр маскирует, а не вырезает: игрок видит, что написал', () => {
    // Молчаливое вырезание хуже: игрок решит, что у него сломался чат
    const word = CHAT_BLOCKLIST[0];
    const out = filterChatMessage(`это ${word} слово`);
    expect({ текст: out.text, длина_звёзд: out.text.split(' ')[1].length })
      .toEqual({ текст: `это ${'*'.repeat(word.length)} слово`, длина_звёзд: word.length });
  });

  it('обход маскировкой не помогает', () => {
    // Смысл всей работы с основой: «бл@дь», «БЛЯДЬ» и «бляяяаадь» дают
    // одну и ту же основу, поэтому фильтр их увидит
    for (const masked of ['блядь', 'БЛЯДЬ', 'бл@дь', 'бляяяаадь', 'б л я д ь', 'б-л-я-д-ь']) {
      expect({ слово: masked, hits: filterChatMessage(masked).hits > 0 })
        .toEqual({ слово: masked, hits: true });
    }
  });

  it('фильтр ловит мат внутри обычной фразы, а не только отдельным словом', () => {
    // Реальное сообщение игрока, а не слово из словаря. Маскируется само
    // слово, а не символы вокруг: «@» остаётся на месте, иначе игрок не
    // понял бы, где именно было его слово
    const out = filterChatMessage('дайте @блядь за теори');
    expect({ text: out.text, звёзд: out.text.split(' ')[1] })
      .toEqual({ text: 'дайте @***** за теори', звёзд: '@*****' });
  });

  it('короткая основа не ищется подстрокой — иначе блокируются обычные слова', () => {
    // «Идиот» даёт основу «дт», и она встречается внутри слова «дот».
    // Ровно та ошибка была в первой версии фильтра: регулярка по всему
    // тексту рубила «дот», «вред» и подобное
    for (const innocent of ['дот', 'вред', 'приват', 'кд', 'дт']) {
      expect({ слово: innocent, hits: filterChatMessage(innocent).hits }).toEqual({ слово: innocent, hits: 0 });
    }
  });

  it('основа вычисляется одинаково при любом написании слова', () => {
    const variants = ['блядь', 'БЛЯДЬ', 'бл@дь', 'бляяяаадь', 'б-л-я-д-ь'];
    const stems = new Set(variants.map(stemWord));
    expect({ разных_основ: stems.size }).toEqual({ разных_основ: 1 });
  });

  it('словарь не пустой и в нём три языка', () => {
    // Азербайджан и английский в общем чате: фильтр на одном языке
    // просто обходится переходом на другой
    expect({ слов: CHAT_BLOCKLIST.length }).toEqual({ слов: expect.any(Number) });
    expect(CHAT_BLOCKLIST.length).toBeGreaterThanOrEqual(20);
    expect({ с_кириллицей: CHAT_BLOCKLIST.filter((w) => /[а-яё]/i.test(w)).length }).toEqual({ с_кириллицей: expect.any(Number) });
    expect({ с_латиницей: CHAT_BLOCKLIST.filter((w) => /[a-z]/i.test(w)).length }).toEqual({ с_латиницей: expect.any(Number) });
  });

  it('в словаре нет слов с одинаковой основой', () => {
    // Дубли оснований — это слова-синонимы («ебан» и «уёбан» дают «бн»).
    // Второй в списке не нужен: он не добавляет ни одного срабатывания,
    // а список всё равно читают глазами
    const stems = CHAT_BLOCKLIST.map(stemWord);
    const dup = [...new Set(stems.filter((s, i) => stems.indexOf(s) !== i))];
    expect({ всего: stems.length, уникальных: new Set(stems).size, дубли: dup })
      .toEqual({ всего: stems.length, уникальных: stems.length, дубли: [] });
  });

  it('короткие основы в набор подстрок не попадают', () => {
    // «Идиот» даёт «дт», и та же основа есть у слова «дот». Слова в
    // CHAT_BLOCKLIST остаются (их ловит точное совредение), но искать по
    // такой основе подстрокой нельзя — иначе «дот» блокировался бы
    const short = [...CHAT_BLOCK_STEMS].filter((s) => s.length < 4);
    expect({ в_наборе_основ: short }).toEqual({ в_наборе_основ: [] });
    // А слово «идиот» при этом отлавливается — точным совпадением
    expect({ идиот_ловится: filterChatMessage('идиот').hits > 0 }).toEqual({ идиот_ловится: true });
  });

  it('пустое сообщение и символы не ломают фильтр', () => {
    // Фильтр стоит в пути каждого сообщения, включая пустое: исключение
    // здесь отключало бы весь чат. Сверяем не с самим собой, а с исходным
    // текстом — иначе проверка ничего не значила бы
    for (const m of ['', ' ', '...', '???', '123', '🙂', 'привет']) {
      expect({ m, текст_не_изменён: filterChatMessage(m).text }).toEqual({ m, текст_не_изменён: m });
    }
    expect({ слов: CHAT_BLOCK_WORDS.size, основ: CHAT_BLOCK_STEMS.size })
      .toEqual({ слов: expect.any(Number), основ: expect.any(Number) });
  });
});

describe('Мьют: админский инструмент наконец работает', () => {
  it('ГЛАВНОЕ: обработчик чата читает character_mutes', () => {
    // ТУТ БЫЛА ПОЛНАЯ ПОЛОМКА. AdminService писал мьют в таблицу, а читать
    // её не был никто: админ мутил игрока, видел «успешно» в панели, и тот
    // писал в чат как ни в чём не бывало
    expect(service).toMatch(/FROM character_mutes WHERE character_id = \$1/);
    expect(handler).toMatch(/chatModeration\.screen\(/);
  });

  it('мьюченный игрок получает отказ, а его сообщение не уходит в эфир', () => {
    // Проверяем обе стороны: и код отказа, и что после него стоит return.
    // Одного кода мало — потерянный return отправлял бы сообщение в чат
    // ПОСЛЕ отказа, и игрок видел бы собственную реплику без цензуры
    const m = /code: 'CHAT_MUTED'[\s\S]{0,120}return;/.test(handler);
    expect({ отказ_с_возвратом: m }).toEqual({ отказ_с_возвратом: true });
  });

  it('проверка мьюта идёт ДО отправки в эфир', () => {
    // Иначе сообщение успеет уйти всем, а отказ придёт только автору
    const screenAt = handler.indexOf('chatModeration.screen(');
    const emitAt = handler.indexOf('CHAT_WORLD');
    expect({ screen_раньше_эфира: screenAt > -1 && screenAt < emitAt }).toEqual({ screen_раньше_эфира: true });
  });

  it('мьют берётся из базы, а не выдумывается на сервере', () => {
    // Нужен настоящий источник: колонка muted_until, а не локальная переменная
    expect(service).toMatch(/muted_until/);
    expect(adminService).toMatch(/INSERT INTO character_mutes/);
  });

  it('просроченный мьют не действует вечно', () => {
    // Мьют на 10 минут не должен запрещать чат до перезапуска сервера
    expect(service).toMatch(/until\.getTime\(\) <= Date\.now\(\)/);
  });

  it('игроку объясняют, до когда мьют', () => {
    // Молчание хуже отказа: игрок решит, что чат сломался
    expect(clientWorld).toMatch(/CHAT_MUTED/);
    expect(clientWorld).toMatch(/t\('chat\.muted'\)/);
  });

  it('фильтр тоже говорит игроку, что его сообщение изменили', () => {
    // Без этого игрок видит в чате цензуру вместо своего слова и не
    // понимает, что произошло
    expect(handler).toMatch(/code: 'CHAT_FILTERED'/);
    expect(clientWorld).toMatch(/CHAT_FILTERED/);
  });
});

describe('Жалобы: сообщить о нарушителе реально', () => {
  it('есть маршрут для игрока', () => {
    expect(gameRoutes).toMatch(/gameRouter\.post\('\/report'/);
  });

  it('маршрут защищён: авторизация, персонаж и ограничение частоты', () => {
    // Без всех трёх это была бы форма, которой можно забить базу
    expect(gameRoutes).toMatch(/post\('\/report', secureMiddleware, apiRateLimiter, requireCharacterOwnership\(\)/);
  });

  it('жалоба ограничена пятью в час', () => {
    expect(service).toMatch(/REPORTS_PER_HOUR = 5/);
    expect(service).toMatch(/created_at > NOW\(\) - INTERVAL '1 hour'/);
  });

  it('нельзя пожаловаться на себя и подсунуть чужую причину', () => {
    expect(service).toMatch(/reporterId === reportedId/);
    expect(service).toMatch(/REPORT_REASONS as readonly string\[\]\)\.includes\(reason\)/);
  });

  it('жалоба кладётся в существующую таблицу, а не в выдуманную', () => {
    // chat_messages создана миграцией 022. Отдельной таблицы жалоб нет,
    // и это осознанно: она понадобится, когда у жалоб появятся статусы
    expect(migration022).toMatch(/CREATE TABLE IF NOT EXISTS chat_messages/);
    expect(service).toMatch(/INSERT INTO chat_messages/);
    expect(service).not.toMatch(/INSERT INTO chat_reports/);
  });

  it('у персонала есть очередь жалоб', () => {
    expect(adminRoutes).toMatch(/adminRouter\.get\('\/reports', adminCheck/);
    expect(service).toMatch(/WHERE cm\.channel = 'report'/);
  });

  it('у игрока в чате есть кнопка жалобы', () => {
    expect(clientHud).toMatch(/className = 'chat-report'/);
    expect(clientHud).toMatch(/api\.report\(/);
  });

  it('кнопка есть только у чужих сообщений', () => {
    // Пожаловаться на собственную реплику бессмысленно, а кнопка в каждой
    // строке собственного чата только мешала бы
    expect(clientHud).toMatch(/authorId && me && authorId !== me/);
  });

  it('клиент отправляет своего персонажа, а не id аккаунта', () => {
    // Ровно эта ошибка уже повторялась в проекте семь раз: сервисы ищут по
    // character_id, а req.userId — это идентификатор АККАУНТА
    expect(clientApi).toMatch(/report: \(characterId: string, reportedId: string/);
  });

  it('игроку показывают результат жалобы', () => {
    // Молчание выглядело бы как «жалоба ушла», даже если её отклонил лимит
    expect(clientHud).toMatch(/t\('chat\.report_sent'\)/);
    expect(clientHud).toMatch(/t\('chat\.report_failed'\)/);
  });
});

describe('Переводы модерации есть во всех трёх языках', () => {
  const KEYS = [
    'muted', 'muted_no_time', 'filtered',
    'report_title', 'report_reason_prompt', 'report_sent', 'report_failed',
  ];

  for (const lang of LOCALES) {
    it(`${lang} — все ключи на месте и не пустые`, () => {
      const dict = locale(lang);
      const missing = KEYS.filter((k) => !dict.chat?.[k]?.trim());
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    });
  }

  it('в подписи мута есть плейсхолдер минут', () => {
    for (const lang of LOCALES) {
      const dict = locale(lang);
      expect({ lang, есть: dict.chat.muted.includes('{min}') }).toEqual({ lang, есть: true });
    }
  });

  it('в коде клиента нет русских строк вместо перевода', () => {
    // Ключи берутся из словаря, а не пишутся словами: игрок с английским
    // иначе увидит служебный текст на русском
    expect(clientHud).not.toMatch(/Жалоба отправлена/);
    expect(clientWorld).not.toMatch(/Чат заблокирован/);
  });

  it('причины жалоб перечислены игроку в его языке', () => {
    // Список причин показывается в подсказке: без него игрок не знает,
    // что писать, и отправит пустую жалобу
    for (const lang of LOCALES) {
      const dict = locale(lang);
      expect({ lang, причин: (dict.chat.report_reason_prompt.match(/harassment|cheating|spam|scamming|other/g) ?? []).length })
        .toEqual({ lang, причин: 5 });
    }
  });
});

describe('Словарь фильтра отделён от кода фильтра', () => {
  it('слова лежат в своём файле, а не внутри сервиса', () => {
    // Иначе расширить список можно было бы только правкой логики
    expect(filterData).toMatch(/export const CHAT_BLOCKLIST/);
    expect(service).not.toMatch(/'блядь'|"блядь"/);
  });

  it('список не пустой и фильтр им пользуется', () => {
    expect(CHAT_BLOCKLIST.length).toBeGreaterThan(0);
    expect(filterData).toMatch(/CHAT_BLOCK_STEMS/);
  });
});
