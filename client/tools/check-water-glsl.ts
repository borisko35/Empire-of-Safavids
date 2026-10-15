// Печатает шейдеры воды РОВНО ТАК, как их увидит GPU: те же строки, что
// terrain.ts отдаёт ShaderMaterial.
//
// ЗАЧЕМ. Ни TypeScript, ни vite не проверяют GLSL: это строки в шаблонных
// литералах. Синтаксическая ошибка в них не ломает сборку, не ломает тесты и
// проявляется только в браузере — вода молча исчезает или становится чёрной.
// Настоящего компилятора GLSL здесь нет, поэтому ловлю самые частые ошибки:
// незакрытая скобка, кириллица в идентификаторе, объявленный и непрочитанный
// uniform, разъехавшиеся varying'и между вершинным и фрагментным.
//
// ЗАПУСК: из client/ ->  npx tsx tools/check-water-glsl.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WAVE_GLSL } from '../src/app/game3d/waterWaves';

// tsx грузит файл как ES-модуль, где __dirname не существует.
const здесь = dirname(fileURLToPath(import.meta.url));

const ТЕРРЕЙН = readFileSync(
  join(здесь, '..', 'src', 'app', 'game3d', 'terrain.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

function вырезать(имя: string): string {
  const маркер = `const ${имя} = \``;
  const i = ТЕРРЕЙН.indexOf(маркер);
  if (i < 0) throw new Error(`${имя} не найден в terrain.ts`);
  const начало = i + маркер.length;
  const j = ТЕРРЕЙН.indexOf('`;', начало);
  if (j < 0) throw new Error(`${имя} не закрыт`);
  // Подставляем ровно то, что подставит шаблонный литерал в рантайме.
  return ТЕРРЕЙН.slice(начало, j).replace('${WAVE_GLSL}', WAVE_GLSL);
}

const вершинный = вырезать('waterVertexShader');
const фрагментный = вырезать('waterFragmentShader');

console.log('=== ВЕРШИННЫЙ ШЕЙДЕР ===');
console.log(вершинный);
console.log('');
console.log('=== ФРАГМЕНТНЫЙ ШЕЙДЕР ===');
console.log(фрагментный);

const ошибки: string[] = [];
const varying: Record<string, string[]> = {};

for (const [имя, текст] of [
  ['вершинный', вершинный],
  ['фрагментный', фрагментный],
] as const) {
  const скобки = (текст.match(/\(/g) ?? []).length - (текст.match(/\)/g) ?? []).length;
  if (скобки !== 0) {
    ошибки.push(`${имя}: круглых скобок не хватает или лишних (${скобок})`);
  }

  const фигурные = (текст.match(/\{/g) ?? []).length - (текст.match(/\}/g) ?? []).length;
  if (фигурные !== 0) {
    ошибки.push(`${имя}: фигурных скобок не сходится (${фигурные})`);
  }

  // Идентификаторы GLSL ES допускают только латиницу, цифры и подчёркивание.
  const кириллица = [...new Set(текст.match(/[A-Za-z_][А-Яа-яЁё][A-Za-z0-9_]*/g) ?? [])];
  if (кириллица.length) {
    ошибки.push(`${имя}: кириллица в идентификаторах: ${кириллица.join(', ')}`);
  }

  const объявлены = [...текст.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map((м) => м[1]);
  for (const uniform of объявлены) {
    const использований = (текст.match(new RegExp(`\\b${uniform}\\b`, 'g')) ?? []).length;
    if (использований < 2) {
      ошибки.push(
        `${имя}: uniform ${uniform} объявлен и ни разу не прочитан — это рычаг, `
        + 'которым нельзя управлять водой',
      );
    }
  }

  varying[имя] = [...текст.matchAll(/varying\s+\w+\s+(\w+)\s*;/g)].map((м) => м[1]).sort();
}

// varying'и, которые вершинный шейдер отдаёт, но фрагментный не объявляет,
// ведут себя по-разному на разных картах, и вода мерцает полосами.
const лишние = varying.вершинный.filter((v) => !varying.фрагментный.includes(v));
const недостающие = varying.фрагментный.filter((v) => !varying.вершинный.includes(v));
if (лишние.length) {
  ошибки.push(
    `вершинный шейдер отдаёт varying'и, которых нет во фрагментном: ${лишние.join(', ')}. `
    + 'Часть из них читается не из всех карт — вода будет мерцать полосами',
  );
}
if (недостающие.length) {
  ошибки.push(`во фрагментном есть varying'и, которых не отдаёт вершинный: ${недостающие.join(', ')}`);
}

if (ошибки.length) {
  console.log('');
  console.log('НАЙДЕНО:');
  for (const о of ошибки) console.log('  - ' + о);
  process.exit(1);
}

console.log('');
console.log('varying\'и совпадают:', varying.вершинный.join(', '));
console.log('OK: скобки сходятся, идентификаторы латинские, uniform\'ы все используются.');