// Разбор SQL-текста: объявления схемы и зависимости кода от колонок.
//
// ОТДЕЛЬНО ОТ migration-audit.ts, И ЭТО НЕ КОСМЕТИКА. Сам аудит на верхнем
// уровне делает await main() и подключается к базе, поэтому импортировать
// его из теста нельзя - тест пошёл бы в базу вместо проверки. Значит
// проверяемая логика должна лежать в модуле без побочных эффектов.
//
// ГЛАВНОЕ, ЧТО ЗДЕСЬ ВОЗМОЖНО СЛОМАТЬ. Инструмент нашёл 10 из 16 первых
// находок фантомом САМОГО СЕБЯ: комментарий
//   channel VARCHAR(20) NOT NULL, -- world, region, guild, alliance, ...
// перечисляет значения поля, а разделитель по запятым нарезал текст
// комментария на «колонки». Парсер молча выдавал свой мусор за находки.
//
// Поэтому здесь три уровня защиты, и все три проверяются тестами:
//   - комментарии вырезаются ДО разбора скобок и запятых;
//   - строковые литералы маскируются: запятая внутри 'a, b' это часть
//     значения, а не разделитель;
//   - ноль найденных колонок считается поломкой чтения, а не «схема пуста».
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Служебные слова в скобках CREATE TABLE, которые не являются колонками.
export const НЕ_КОЛОНКИ: ReadonlySet<string> = new Set([
  'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN', 'CONSTRAINT', 'EXCLUDE', 'LIKE', 'KEY',
]);

export interface Находка {
  таблица: string;
  колонка: string;
  объявлена: string;
}

export interface Упоминание {
  файл: string;
  строка: number;
  вид: 'INSERT' | 'qualified';
  фрагмент: string;
}

export interface ИтогЧтения {
  файлы: { путь: string; строк: number }[];
  пропущены: string[];
}

/** Вырезать комментарии, сохранив строковые литералы. */
export function убратьКомментарии(текст: string): string {
  const маска = '§ЛИТЕРАЛ§';
  const литералы: string[] = [];
  let результат = текст.replace(/'(?:''|[^'])*'/g, м => {
    литералы.push(м);
    return маска + (литералы.length - 1) + маска;
  });
  результат = результат
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
  return результат.replace(new RegExp(маска + '(\\d+)' + маска, 'g'),
    (_, n: string) => литералы[Number(n)]);
}

/** Содержимое круглых скобок, начиная с позиции открывающей. */
export function содержимоеСкобок(текст: string, открытая: number): string {
  let глубина = 0;
  for (let i = открытая; i < текст.length; i++) {
    if (текст[i] === '(') глубина++;
    else if (текст[i] === ')') { глубина--; if (глубина === 0) return текст.slice(открытая + 1, i); }
  }
  return '';
}

/** Разделить по запятым верхнего уровня, не разрывая вложенных скобок. */
export function разделить(тело: string): string[] {
  const части: string[] = [];
  let глубина = 0, текущий = '';
  for (const символ of тело) {
    if (символ === '(') глубина++;
    if (символ === ')') глубина--;
    if (символ === ',' && глубина === 0) { части.push(текущий); текущий = ''; }
    else текущий += символ;
  }
  if (текущий.trim()) части.push(текущий);
  return части;
}

export const очистить = (v: string): string => v.trim().replace(/,$/, '').trim();

/** Имя колонки или null, если это не колонка. */
export function имяКолонки(часть: string): string | null {
  const токен = очистить(часть).split(/\s+/)[0] ?? '';
  const имя = токен.replace(/["']/g, '').toLowerCase();
  if (!имя || НЕ_КОЛОНКИ.has(имя.toUpperCase())) return null;
  return /^[a-z_][a-z0-9_]*$/.test(имя) ? имя : null;
}

/** Таблица -> колонка -> файл, из объявлений CREATE TABLE и ADD COLUMN. */
export function разобратьМиграции(
  каталог: string, файлы: string[],
): Map<string, Map<string, string>> {
  const таблицы = new Map<string, Map<string, string>>();
  const взять = (t: string): Map<string, string> => {
    const k = t.toLowerCase();
    let m = таблицы.get(k);
    if (!m) { m = new Map(); таблицы.set(k, m); }
    return m;
  };
  for (const файл of файлы) {
    const текст = убратьКомментарии(readFileSync(join(каталог, файл), 'utf-8'));
    let m: RegExpExecArray | null;
    const reCreate = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
    while ((m = reCreate.exec(текст))) {
      const тело = содержимоеСкобок(текст, m.index + m[0].length - 1);
      for (const часть of разделить(тело)) {
        const колонка = имяКолонки(часть);
        if (колонка) взять(m[1]).set(колонка, файл);
      }
    }
    const reAdd = /ALTER\s+TABLE\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
    while ((m = reAdd.exec(текст))) взять(m[1]).set(m[2].toLowerCase(), файл);
    // Снятая колонка не должна считаться недостающей.
    const reDrop = /ALTER\s+TABLE\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
    while ((m = reDrop.exec(текст))) взять(m[1]).delete(m[2].toLowerCase());
  }
  return таблицы;
}

/** SQL-выражения из строковых литералов '...' и `...`. */
export function sqlВыражения(исходник: string): { текст: string; строка: number }[] {
  const результат: { текст: string; строка: number }[] = [];
  const ре = /'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = ре.exec(исходник))) {
    const тело = m[1] ?? m[2] ?? '';
    if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(тело)) continue;
    результат.push({ текст: убратьКомментарии(тело), строка: исходник.slice(0, m.index).split('\n').length });
  }
  return результат;
}

/** Файлы кода, без тестов. Отсутствующие каталоги не скрываются. */
export function файлыКода(корень: string, каталоги: readonly string[]): ИтогЧтения {
  const файлы: { путь: string; строк: number }[] = [];
  const пропущены: string[] = [];
  const обход = (каталог: string): void => {
    if (!existsSync(каталог)) { пропущены.push(каталог.replace(корень + '\\', '')); return; }
    for (const имя of readdirSync(каталог)) {
      const полный = join(каталог, имя);
      if (statSync(полный).isDirectory()) {
        // Тесты пропускаются намеренно: утверждение теста о несуществующей
        // колонке - это утверждение о схеме, а не обращение к ней.
        if (имя === 'node_modules' || имя === 'tests' || имя === '__tests__') continue;
        обход(полный);
      } else if (имя.endsWith('.ts') || имя.endsWith('.tsx')) {
        файлы.push({ путь: полный, строк: readFileSync(полный, 'utf-8').split('\n').length });
      }
    }
  };
  for (const каталог of каталоги) обход(join(корень, каталог));
  return { файлы, пропущены };
}

/** Кто в коде ссылается на конкретную колонку конкретной таблицы. */
export function зависимости(
  корень: string, таблица: string, колонка: string, файлы: { путь: string; строк: number }[],
): Упоминание[] {
  const найдено: Упоминание[] = [];
  const reInsert = new RegExp(`INSERT\\s+INTO\\s+(?:ONLY\\s+)?${таблица}\\s*\\(([^)]*)\\)`, 'gi');
  const reQualified = new RegExp(`\\b${таблица}\\s*\\.\\s*${колонка}\\b`, 'gi');

  for (const файл of файлы) {
    const исходник = readFileSync(файл.путь, 'utf-8');
    const относительный = файл.путь.replace(корень + '\\', '').replace(/\\/g, '/');
    // Сверка идёт В ПРЕДЕЛАХ ОДНОГО SQL-ВЫРАЖЕНИЯ: упоминание колонки в
    // character_skills ничего не говорит про character_achievements.
    for (const выраж of sqlВыражения(исходник)) {
      if (!new RegExp(`\\b${таблица}\\b`, 'i').test(выраж.текст)) continue;
      let m2: RegExpExecArray | null;
      reInsert.lastIndex = 0;
      while ((m2 = reInsert.exec(выраж.текст))) {
        if (разделить(m2[1]).map(c => c.trim().toLowerCase()).includes(колонка)) {
          найдено.push({ файл: относительный, строка: выраж.строка, вид: 'INSERT',
            фрагмент: m2[0].slice(0, 90) });
        }
      }
      reQualified.lastIndex = 0;
      if (reQualified.test(выраж.текст)) {
        найдено.push({ файл: относительный, строка: выраж.строка, вид: 'qualified',
          фрагмент: `${таблица}.${колонка}` });
      }
    }
  }
  return найдено;
}

/** Колонки из INSERT INTO, которых нет в базе. */
export function кодПишетВОтсутствующие(
  корень: string, колонкиВБазе: Set<string>, таблицыВБазе: Set<string>,
  файлы: { путь: string; строк: number }[],
): Упоминание[] {
  const найдено: Упоминание[] = [];
  for (const файл of файлы) {
    const исходник = readFileSync(файл.путь, 'utf-8');
    const относительный = файл.путь.replace(корень + '\\', '').replace(/\\/g, '/');
    for (const выраж of sqlВыражения(исходник)) {
      const re = /INSERT\s+INTO\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi;
      let m2: RegExpExecArray | null;
      while ((m2 = re.exec(выраж.текст))) {
        const таблица = m2[1].toLowerCase();
        if (!таблицыВБазе.has(таблица)) continue;
        for (const часть of разделить(m2[2])) {
          const колонка = имяКолонки(часть);
          if (колонка && !колонкиВБазе.has(`${таблица}.${колонка}`)) {
            найдено.push({ файл: относительный, строка: выраж.строка, вид: 'INSERT',
              фрагмент: `${таблица}(${m2[2].replace(/\s+/g, ' ').trim().slice(0, 70)})` });
          }
        }
      }
    }
  }
  return найдено;
}

/** Расхождения «миграция объявила, база не имеет» - без учёта зависимостей. */
export function расхождения(
  объявлено: Map<string, Map<string, string>>, таблицыВБазе: Set<string>, вБазе: Set<string>,
): Находка[] {
  const находки: Находка[] = [];
  for (const [таблица, колонки] of объявлено) {
    if (!таблицыВБазе.has(таблица)) continue;
    for (const [колонка, файл] of колонки) {
      if (!вБазе.has(`${таблица}.${колонка}`)) находки.push({ таблица, колонка, объявлена: файл });
    }
  }
  return находки;
}
