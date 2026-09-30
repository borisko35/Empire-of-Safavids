// Аудит схемы: объявлено миграциями и пишется кодом - против живой базы.
//
// ЗАЧЕМ. Сегодня покупка г��льдейского навыка стоила игроку 6000 золота:
//   column "updated_at" of relation "guild_skills" does not exist
// Миграция 050 объявляла эту колонку, таблица была создана раньше без неё,
// и IF NOT EXISTS молча пропустил определение. Та же болезнь была с
// guilds - её лечила миграция 042. Пока это вычищали вручную, два раза.
//
// ВОПРОС 1. Что миграции объявили, а база не имеет.
// ВОПРОС 2. Куда код пишет колонку, которой в базе нет, - и о которой
//            миграции не говорили вовсе. Это и есть класс 6000 золота, и
//            он виден без чтения миграций.
//
// ПРОВЕРЕНО НА ЖИВОЙ БАЗЕ. Колонка guild_skills.updated_at была снята с
// боевой базы (ровно то состояние, в котором игрок потерял деньги),
// аудит назвал её ОПАСНО и указал GuildService; фантом
// combat_logs.combo_count назван фантомом. Колонка возвращена.
//
// ГРАНИЦЫ, И ОНИ СУЩЕСТВЕННЫЕ. SELECT a, b FROM t НЕ разбираются: чтобы
// понять, что значит b, нужен настоящий разбор SQL. Про такие места
// инструмент молчит, и молчание это не «всё хорошо».
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  зависимости, кодПишетВОтсутствующие, расхождения, разобратьМиграции, файлыКода,
} from './lib/migrationSchema';

const { Client } = createRequire(import.meta.url)('pg');

const КОД = ['server/src', 'client/src'] as const;

function must(условие: boolean, сообщение: string): void {
  if (!условие) { console.log('PROVAL: ' + сообщение); process.exit(1); }
}

// __dirname не существует в ES-модуле: tsx запускает .ts как ES module.
// Корень ищется перебором вверх, и отсутствие каталога - падение, а не
// «прочитано ноль миграций, всё чисто».
function найтиКорень(): string {
  let текущий = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(текущий, 'database', 'migrations'))) return текущий;
    const выше = dirname(текущий);
    if (выше === текущий) break;
    текущий = выше;
  }
  throw new Error('Корень не найден: не встретился database/migrations выше ' +
    process.cwd() + '. Проверка не имеет права молча прочитать ноль миграций.');
}

async function main(): Promise<void> {
  const корень = найтиКорень();
  const каталог = join(корень, 'database', 'migrations');
  const миграции = readdirSync(каталог).filter(f => f.endsWith('.sql')).sort();
  const чтение = файлыКода(корень, КОД);

  console.log('=== ИСХОДНОЕ СОСТОЯНИЕ ===');
  console.log('каталог миграций:', каталог);
  console.log('миграций разобрано:', миграции.length);
  console.log('файлов кода прочитано (без тестов):', чтение.файлы.length);
  // Ноль - это поломка чтения, а не «проверять нечего».
  must(миграции.length > 0, 'прочитано ноль миграций');
  must(чтение.файлы.length > 0, 'не прочитано ни одного файла кода');
  if (чтение.пропущены.length) {
    console.log('КАТАЛОГИ НЕ ПРОЧИТАНЫ: ' + чтение.пропущены.join(', '));
    console.log('  отчёт НЕ покрывает эти каталоги. Прочитано меньше, чем кажется.');
  }

  const db = new Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'safavid_user',
    password: process.env.DB_PASSWORD ?? 'safavid_pass',
    database: process.env.DB_NAME ?? 'empire_of_safavids',
  });
  await db.connect();
  const факт: { rows: { table_name: string; column_name: string }[] } = await db.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
  await db.end();

  const вБазе = new Set(факт.rows.map(r => `${r.table_name.toLowerCase()}.${r.column_name.toLowerCase()}`));
  const таблицыВБазе = new Set(факт.rows.map(r => r.table_name.toLowerCase()));
  const картаКолонок = разобратьМиграции(каталог, миграции);
const находки = расхождения(картаКолонок, таблицыВБазе, вБазе);

  console.log(`\n=== ВОПРОС 1: ОБЪЯВЛЕНО МИГРАЦИЕЙ, НЕТ В БАЗЕ (${находки.length}) ===`);
  let опасных = 0;
  for (const н of находки.sort((a, b) => a.таблица.localeCompare(b.таблица))) {
    const з = зависимости(корень, н.таблица, н.колонка, чтение.файлы);
    if (з.length) {
      опасных++;
      console.log(`  ОПАСНО  ${н.таблица}.${н.колонка}  (объявлена в ${н.объявлена})`);
      for (const уп of з.slice(0, 3)) {
        console.log(`           → ${уп.файл}:${уп.строка}  ${уп.вид}  ${уп.фрагмент}`);
      }
    } else {
      console.log(`  фантом  ${н.таблица}.${н.колонка}  (объявлена в ${н.объявлена}) — код не ссылается`);
    }
  }
  console.log(`  из них опасных (на них ссылается код): ${опасных}`);

  const прямые = кодПишетВОтсутствующие(корень, вБазе, таблицыВБазе, чтение.файлы);
  console.log(`\n=== ВОПРОС 2: КОД ПИШЕТ В КОЛОНКУ, КОТОРОЙ НЕТ (${прямые.length}) ===`);
  if (!прямые.length) {
    console.log('  таких нет: явные списки колонок в INSERT совпадают с базой');
  }
  for (const уп of прямые.slice(0, 20)) {
    console.log(`  ОПАСНО  ${уп.файл}:${уп.строка}  ${уп.фрагмент}`);
  }

  console.log('\n=== ЧЕГО ИНСТРУМЕНТ НЕ ДЕЛАЕТ ===');
  console.log('  SELECT * и SELECT a, b FROM t НЕ разбираются: что значит b,');
  console.log('  без настоящего разбора SQL не догадаться, а догадка хуже');
  console.log('  отсутствия. Про такие места инструмент МОЛЧИТ.');
  console.log('  Молчание - это не «всё хорошо».');

  process.exit(опасных + прямые.length > 0 ? 1 : 0);
}

await main();
