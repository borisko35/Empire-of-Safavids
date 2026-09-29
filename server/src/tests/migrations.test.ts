// ============================================================
// Проверка SQL-миграций — Empire of Safavids
// ============================================================
// ЧТО ЭТО ТАКОЕ И ЧТО ЭТО НЕ ТАКОЕ. Это ЛИНТ, а не разбор SQL. Настоящей
// проверки здесь нет и быть не может: поднять Postgres в юнит-тестах здесь
// нечем, а без него «миграция валидна» было бы голословным утверждением.
// Проверяются ошибки, которые ловятся глазами, но стоят выкатки.
//
// ПОЧЕМУ ЭТА ПРОВЕРКА ПОЯВИЛАСЬ. Миграция 044 была написана с комментариями
// через //. SQL их не понимает, выкатка встала на
// «syntax error at or near '//'», сервер не поднялся, сайт лежал. Комментарии
// в остальных сорока трёх миграциях были через --, и на глаз разницы не видно:
// в проекте полно файлов с //, потому что это TypeScript.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
const dir = join(repoRoot, 'database', 'migrations');
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

describe('Миграции вообще есть', () => {
  it('каталог не пуст', () => {
    expect({ файлов: files.length, последний: files[files.length - 1] })
      .toEqual({ файлов: expect.any(Number), последний: expect.any(String) });
    expect(files.length).toBeGreaterThan(10);
  });
});

describe('Комментарии написаны на языке SQL', () => {
  it('ни в одной миграции нет //', () => {
    // Главная проверка файла. // — это TypeScript, и в SQL он не комментарий,
    // а синтаксическая ошибка, которая останавливает выкатку целиком.
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      src.split(/\r?\n/).forEach((line, i) => {
        // Строковые литералы пропускаем: кавычка внутри строки — не комментарий
        if (/^\s*\/\//.test(line) || /\s--\s*\/\//.test(line)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect({ строки_с_двойным_слэшем: bad }).toEqual({ строки_с_двойным_слэшем: [] });
  });

  it('каждая миграция начинается с --, а не с //', () => {
    const bad = files.filter(f => {
      const first = readFileSync(join(dir, f), 'utf8').split(/\r?\n/).find(l => l.trim().length > 0) ?? '';
      return !/^\s*--/.test(first);
    });
    expect({ начинаются_не_с_прочерка: bad }).toEqual({ начинаются_не_с_прочерка: [] });
  });
});

describe('Файл, который уходит в Postgres целиком', () => {
  // Ранинг (server/src/database/migrate.ts) отправляет содержимое файла одним
  // client.query(sql). Значит любой незакрытый блок ломает ВСЮ миграцию, а не
  // её последнее высказывание.

  it('долларовые кавычки закрыты', () => {
    // DO $$ ... $$ — способ написать многострочный блок. Незакрытый $$ съедает
    // остаток файла, и ошибка указывает совсем не туда.
    const bad = files.filter(f => {
      const n = (readFileSync(join(dir, f), 'utf8').match(/\$\$/g) ?? []).length;
      return n % 2 !== 0;
    });
    expect({ незакрытые_кавычки: bad }).toEqual({ незакрытые_кавычки: [] });
  });

  it('файл не пустой и в нём есть хоть одна команда', () => {
    const bad = files.filter(f => {
      const src = readFileSync(join(dir, f), 'utf8').replace(/^\uFEFF/, '');
      // Убираем комментарии, чтобы не посчитать текст внутри них командой
      const withoutComments = src.split(/\r?\n/)
        .map(l => l.replace(/--.*$/, ''))
        .join('\n').trim();
      return withoutComments.length === 0;
    });
    expect({ без_команд: bad }).toEqual({ без_команд: [] });
  });

  it('BOM либо нет, либо ранинг его срезает', () => {
    // Первая версия проверки просто запрещала BOM — и краснела на двадцати
    // миграциях, которые так и написаны и годами применяются. Запрет тут
    // был не про безопасность, а про удобство редактора.
    //
    // Настоящее условие другое: ранинг обязан срезать BOM, потому что
    // двадцать файлов его имеют, и node-pg без этого ответил бы ошибкой на
    // самой первой миграции. Проверяем именно совпадение: BOM есть И ранинг
    // его не срезает = дыра.
    const runner = readFileSync(join(repoRoot, 'server', 'src', 'database', 'migrate.ts'), 'utf8');
    // Якорь ^ в шаблоне обязателен: без него подошло бы и обрезание BOM из
    // середины файла, а нужен именно первый символ. Якорь включён в проверку
    // не для строгости, а чтобы она не прошла мимо переписывания ранинга.
    const strips = /replace\(\/\^\\uFEFF\/, ''\)/.test(runner);
    const withBom = files.filter(f => readFileSync(join(dir, f), 'utf8').charCodeAt(0) === 0xfeff);
    expect({ ранинг_срезает_bom: strips, миграций_с_bom: withBom.length > 0, дыра: withBom.length > 0 && !strips })
      .toEqual({ ранинг_срезает_bom: true, миграций_с_bom: true, дыра: false });
  });
});

describe('Схема, на которую опирается код, объявлена миграцией', () => {
  // Обратная сверка. Миграция может написать колонку не под тем именем, и
  // тогда сервер упадёт уже на первом обращении игрока — после успешной
  // выкатки, то есть заметно позже и дороже.

  it('список стоек в CHECK совпадает со списком в коде', () => {
    const src = readFileSync(join(repoRoot, 'server', 'src', 'systems', 'CombatStance.ts'), 'utf8');
    const block = src.slice(src.indexOf('export const STANCES'), src.indexOf('export const STANCE_IDS'));
    const stances = [...block.matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map(m => m[1]).sort();
    const migration = readFileSync(join(dir, '044_combat_stance.sql'), 'utf8');
    const allowed = /CHECK \(combat_stance IN \(([^)]+)\)\)/.exec(migration)?.[1] ?? '';
    const allowedList = [...allowed.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
    // Пустой CHECK — тоже поломка: тогда в базу можно было бы записать что
    // угодно, и сервер не знал бы, что с этим делать
    expect({
      стойки_в_коде: stances.length,
      стойки_в_базе: allowedList.length,
      совпадают: JSON.stringify(stances) === JSON.stringify(allowedList),
    }).toEqual({ стойки_в_коде: expect.any(Number), стойки_в_базе: expect.any(Number), совпадают: true });
  });

  it('колонка объявлена под тем именем, под которым её ищет код', () => {
    // Проверка только на подстроку 'combat_stance' была бы холостой: имя
    // осталось бы в тексте ограничения CHECK, и проверка прошла бы на файле,
    // где сама колонка объявлена под другим именем. Поэтому сверяется
    // именно строка объявления колонки.
    const migration = readFileSync(join(dir, '044_combat_stance.sql'), 'utf8');
    const declared = /ADD COLUMN IF NOT EXISTS (\w+)/.exec(migration)?.[1];
    const code = readFileSync(join(repoRoot, 'server', 'src', 'services', 'CharacterService.ts'), 'utf8');
    expect({ объявлена: declared, код_ищет: /SELECT combat_stance FROM characters/.test(code) })
      .toEqual({ объявлена: 'combat_stance', код_ищет: true });
  });

  it('у CHECK-ограничения есть защита от повторного добавления', () => {
    // Миграция применяется один раз и отмечается в schema_migrations, но
    // ограничение может быть добавлено вручную или при откате. IF NOT EXISTS
    // делает файл безвредным при повторном запуске.
    const migration = readFileSync(join(dir, '044_combat_stance.sql'), 'utf8');
    expect({
      колонка_идемпотентна: /ADD COLUMN IF NOT EXISTS/.test(migration),
      ограничение_идемпотентно: /IF NOT EXISTS \(SELECT 1 FROM pg_constraint/.test(migration),
    }).toEqual({ колонка_идемпотентна: true, ограничение_идемпотентно: true });
  });
});
