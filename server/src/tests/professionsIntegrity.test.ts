// Справочник профессий в базе и профессии в коде обязаны совпадать.
//
// МИГРАЦИЯ 045 ПОЯВИЛАСЬ ИЗ-ЗА ЭТОЙ ПРОВЕРКИ. У character_professions стоит
// внешний ключ на professions(id), справочник жил в базе, а список профессий
// - в коде. Новая профессия в коде без строки в справочнике выбиралась
// «ошибкой базы» с кодом 400, и это обнаружилось только на боевом сервере.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
const migrations = join(repoRoot, 'database', 'migrations');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

// Код профессий: из массива PROFESSIONS в SkillsService
const service = read('server/src/services/SkillsService.ts');
const block = service.slice(service.indexOf('const PROFESSIONS'), service.indexOf('export class SkillsService'));
const inCode = [...block.matchAll(/\{ id: '([a-z_]+)', name: '\1'/g)].map(m => m[1]).sort();

// Справочник: из всех миграций подряд, в порядке применения
const inDb: string[] = [];
for (const f of readdirSync(migrations).filter(x => x.endsWith('.sql')).sort()) {
  const src = readFileSync(join(migrations, f), 'utf8').replace(/^\uFEFF/, '');
  // Только INSERT в professions, а не упоминания в комментариях и не
  // REFERENCES: иначе в список попали бы чужие идентификаторы
  for (const m of src.matchAll(/INSERT\s+INTO\s+professions\s*\([^)]*\)\s*VALUES([^;]+);/gi)) {
    for (const v of m[1].matchAll(/\(\s*'([a-z_]+)'/g)) inDb.push(v[1]);
  }
}
const uniqueDb = [...new Set(inDb)].sort();

describe('Справочник профессий не отстаёт от кода', () => {
  it('в коде есть профессии', () => {
    expect({ в_коде: inCode.length, примеры: inCode.slice(0, 3) })
      .toEqual({ в_коде: expect.any(Number), примеры: expect.any(Array) });
    expect(inCode.length).toBeGreaterThanOrEqual(7);
  });

  it('каждая профессия из кода есть в справочнике', () => {
    // Проверка, которой не было. Без неё профессия в коде просто
    // недоступна игроку: внешний ключ отклонит вставку, и игрок получит
    // «ошибку базы» вместо профессии.
    const missing = inCode.filter(id => !uniqueDb.includes(id));
    expect({ нет_в_базе: missing }).toEqual({ нет_в_базе: [] });
  });

  it('в справочнике нет профессий, которых больше нет в коде', () => {
    // Обратная проверка. Строка в справочнике без строки в коде даёт
    // профессию, которую нельзя выбрать в панели: путь на неё просто
    // не появится.
    const orphans = uniqueDb.filter(id => !inCode.includes(id));
    expect({ сироты: orphans }).toEqual({ сироты: [] });
  });

  it('дервиш есть и в коде, и в справочнике', () => {
    // Точечная проверка на регрессию: именно дервиша не хватало.
    expect({
      в_коде: inCode.includes('dervish'),
      в_базе: uniqueDb.includes('dervish'),
    }).toEqual({ в_коде: true, в_базе: true });
  });
});

describe('Внешние ключи профессий ведут в заполненный справочник', () => {
  it('описание дервиша в справочнике совпадает с кодом', () => {
    // Описание из миграции и из кода - разные строки, и разъехаться они
    // могут незаметно: игрок видит одно, а база хранит другое.
    const m045 = readFileSync(join(migrations, '045_dervish_profession.sql'), 'utf8');
    const fromCode = /id: 'dervish', name: 'dervish', nameRu: 'Дервиш', description: '([^']+)'/.exec(service)?.[1];
    const fromDb = /\('dervish',\s*'Дервиш',\s*'([^']+)'/.exec(m045)?.[1];
    expect({ в_коде: !!fromCode, в_миграции: !!fromDb, совпадают: fromCode === fromDb })
      .toEqual({ в_коде: true, в_миграции: true, совпадают: true });
  });

  it('справочник описан как внешний ключ, а не свободный текст', () => {
    // Напоминание о том, что справочник обязателен. Если бы миграция
    // убрала внешний ключ, проверка перестала бы быть нужной, но вместе с
    // ней исчезла бы и причина, по которой справочник заполняется.
    const m022 = readFileSync(join(migrations, '022_skills_professions.sql'), 'utf8');
    expect({
      ключ_на_справочник: /profession_id VARCHAR\(50\) NOT NULL REFERENCES professions\(id\)/.test(m022),
    }).toEqual({ ключ_на_справочник: true });
  });
});
