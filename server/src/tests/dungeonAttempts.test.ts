// Лимит попыток входа в данж: dungeon_attempts наконец используется.
//
// ЧТО БЫЛО. Таблица создана миграцией 010 и была пуста все годы. Войти в
// данж можно было сколько угодно: кнопка работала всегда. Для бесплатной
// игры это значит, что один игрок выбивает любую награду за час, пересоздавая
// заход по многу раз.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');
const src = (p: string): string => stripComments(read(p));

const service = src('server/src/systems/DungeonService.ts');
const game = src('server/src/routes/game.ts');
const panels = src('client/src/app/panels.ts');

describe('Лимит попыток: сервис', () => {
  it('таблица dungeon_attempts используется', () => {
    expect(service).toMatch(/INSERT INTO dungeon_attempts/);
  });

  it('лимит — одна константа, а не число в трёх местах', () => {
    expect(service).toMatch(/const DUNGEON_ATTEMPTS_PER_DAY = \d+;/);
    const n = (service.match(/DUNGEON_ATTEMPTS_PER_DAY/g) ?? []).length;
    // определение + attemptsLeft + spendAttempt: где-то ещё — значит
    // правкой одного числа можно разъехаться с остальными
    expect({ упоминаний: n }).toEqual({ упоминаний: 3 });
  });

  it('сутки считает база, а не код', () => {
    // reset_date пришлось бы сравнивать в коде, и тогда смена суток зависела
    // бы от часового пояса сервера: игрок увидел бы «попытки кончились»
    // до полуночи по чужому времени
    expect(service).toMatch(/reset_date = CURRENT_DATE/);
    expect(service).not.toMatch(/new Date\(\)\.toDateString|toISOString\(\)\.slice\(0, 10\)/);
  });

  it('списание атомарно, а не «прочитал и записал»', () => {
    // Две одновременные попытки (двойной клик, две вкладки) при SELECT+UPDATE
    // обе прочитали бы «осталось 1» и обе прошли бы. Postgres обновляет
    // строку один раз: вторая увидит attempts уже 3 и вернёт ноль строк
    expect(service).toMatch(/ON CONFLICT \(character_id, dungeon_id\) DO UPDATE/);
    expect(service).toMatch(/WHERE reset_date = CURRENT_DATE AND dungeon_attempts\.attempts < \$3/);
    expect(service).toMatch(/RETURNING attempts/);
  });
});

describe('Лимит попыток: когда списывается', () => {
  it('отказ по уровню или региону попытку не тратит', () => {
    // Игрок не получил ни монстра, ни минуты захода. Списывать за это
    // нечестно: человек мог три раза промахнуться регионом и уйти без штрафа
    const early = service.indexOf("code: 'dungeon_attempts_exhausted'");
    const levelCheck = service.indexOf('dungeon_level_range');
    const spend = service.lastIndexOf('spendAttempt(characterId, dungeonId)');
    expect({ отказ_раньше_списания: early > 0 && levelCheck > early && spend > levelCheck })
      .toEqual({ отказ_раньше_списания: true });
  });

  it('при восстановлении сессии попытка НЕ списывается', () => {
    // Самая коварная ошибка, которую чуть не сделал: строка объявления
    // сессии встречается дважды — в enter и в restoreActiveSessions.
    // Списание во втором месте означало бы, что игрок платит ещё и за
    // перезапуск сервера
    const spendCalls = service.match(/spendAttempt\(characterId, dungeonId\)/g) ?? [];
    expect({ мест_вызова: spendCalls.length }).toEqual({ мест_вызова: 1 });
  });

  it('после перезапуска заход восстанавливается без штрафа', () => {
    expect(service).toMatch(/async restoreActiveSessions/);
    // Внутри восстановления попыток не трогаем
    // Тело метода, а не всё до конца файла: определение spendAttempt лежит
    // дальше по файлу, и «срез до конца» цеплял бы его, проверяя не то
    const start = service.indexOf('async restoreActiveSessions');
    const end = service.indexOf('\n  private async', start + 10);
    const body = service.slice(start, end > 0 ? end : undefined);
    expect({ в_восстановлении_есть_списание: body.includes('spendAttempt') })
      .toEqual({ в_восстановлении_есть_списание: false });
  });
});

describe('Лимит попыток: игрок видит число', () => {
  it('статус отдаёт остаток по каждому данжу', () => {
    // Именно когда игрок стоит вне данжа, ему и нужно знать, сколько раз
    // ещё можно войти
    expect(game).toMatch(/attempts: Object\.fromEntries\(available\)/);
    expect(game).toMatch(/dungeonService\.attemptsLeft\(req\.body\.characterId, id\)/);
  });

  it('ответ на вход тоже содержит остаток', () => {
    expect(game).toMatch(/attemptsLeft: result\.attemptsLeft/);
  });

  it('панель предупреждает, когда попытки кончились', () => {
    // Без этого кнопка «Войти» просто перестаёт работать, и игрок решает,
    // что игра сломалась. «Попытки кончились» — правило, «ничего не',
    // происходит» — поломка
    expect(panels).toMatch(/dungeon\.attempts_over/);
    expect(panels).toMatch(/every\(n => n <= 0\)/);
  });

  it('сообщение одно на панель, а не на каждый данж', () => {
    // Счётчик общий на персонажа, но считается по данжам раздельно. Одна
    // цифра рядом с каждым данжем означала бы разное для разных, и игрок
    // решил бы, что один из них закрыт навсегда
    expect(panels).not.toMatch(/attempts\[[^\]]+\]/);
  });

  it('текст переведён', () => {
    expect(panels).toMatch(/t\('dungeon\.attempts_over'\)/);
    expect(panels).not.toMatch(/Попытки на сегодня закончились/);
  });
});
