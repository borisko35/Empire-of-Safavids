// Каталог ежедневных задач живёт в таблице daily_tasks.
//
// ЧТО БЫЛО. Таблица создана миграцией 015 и была пуста все годы. Каталог из
// девяти задач жил строкой в DailyTaskService, и чтобы поменять награду —
// требовался релиз.
//
// ЧТО СТАЛО. Каталог читается из базы и посев идёт при старте сервера. Правка
// награды в базе переживает релиз.
//
// ГЛАВНОЕ, ЧТО ПРОВЕРЯЕТСЯ — ОТКАТ. Если посев не прошёл или таблица
// пуста, сервер берёт задачи из кода. Без этого сбой на проде отнял бы у
// каждого игрока ежедневные задачи: панель показала бы «задач нет» без всякой
// ошибки, и это выглядело бы как поломка, а не как сбой обслуживания.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');
const src = (p: string): string => stripComments(read(p));

const service = src('server/src/services/DailyTaskService.ts');
const loop = src('server/src/systems/GameLoop.ts');

describe('Каталог задач: читается из базы', () => {
  it('таблица daily_tasks используется', () => {
    expect(service).toMatch(/SELECT \* FROM daily_tasks/);
    expect(service).toMatch(/INSERT INTO daily_tasks/);
  });

  it('посев идёт при старте сервера', () => {
    expect(service).toMatch(/async seedCatalog/);
    expect(loop).toMatch(/seedCatalog\(\)/);
  });

  it('посев идемпотентен', () => {
    // Посев происходит на каждом старте. Без ON CONFLICT он либо плодил бы
    // дубли, либо падал бы со второго раза
    expect(service).toMatch(/ON CONFLICT \(id\) DO UPDATE SET/);
  });

  it('оба места чтения берут каталог, а не массив', () => {
    // getAvailable и updateProgress. Если забыть второе, награды за убийства
    // начислялись бы по старому списку, а игрок видел бы новый
    expect(service).toMatch(/for \(const task of await this\.catalog\(\)\)/);
    expect(service).toMatch(/\(await this\.catalog\(\)\)\.filter\(/);
  });
});

describe('Каталог задач: откат на код', () => {
  it('при пустой таблице берём задачи из кода', () => {
    expect(service).toMatch(/if \(!rows\.length\) return DAILY_TASKS;/);
  });

  it('при ошибке чтения берём задачи из кода', () => {
    // Это и есть главная причина отката: панель задач не показывает ошибку,
    // она просто молчит. Игрок решит, что его обманули
    expect(service).toMatch(/\.catch\(\(e\) => \{/);
    expect(service).toMatch(/каталог не прочитан, берём из кода/);
  });

  it('откат возвращает ВСЕ задачи, а не часть', () => {
    // Возврат пустого списка «на всякий случай» — это и есть отнятие задач
    const fallback = service.slice(service.indexOf('async loadCatalog'));
    const end = fallback.indexOf('\n  }');
    const body = fallback.slice(0, end);
    expect(body).toMatch(/return DAILY_TASKS/);
  });
});

describe('Каталог задач: не ходим в базу на каждое событие', () => {
  it('каталог кэшируется', () => {
    // updateProgress дёргается на каждое убийство монстра. Ходить в базу
    // на каждом событии расточительно, а править награды чаще раза в пять
    // минут незачем
    expect(service).toMatch(/CATALOG_TTL_MS = 5 \* 60 \* 1000/);
    expect(service).toMatch(/private catalogCache: DailyTaskDef\[\] \| null/);
  });

  it('кэш имеет срок жизни', () => {
    // Без срока жизни посев при старте и правки в базе никогда не были бы
    // видны до перезапуска
    expect(service).toMatch(/Date\.now\(\) - this\.catalogLoadedAt < DailyTaskService\.CATALOG_TTL_MS/);
  });
});

describe('Каталог задач: содержимое не потеряно', () => {
  it('все девять задач на месте', () => {
    // Сколько было в коде — столько должно оказаться в базе. Меньше
    // означало бы, что часть задач молча пропала при переезде
    const ids = [...service.matchAll(/id: '(daily_\w+|weekly_\w+)'/g)].map(m => m[1]);
    expect({ задач_в_коде: ids.length }).toEqual({ задач_в_коде: 9 });
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('невыполнимая задача не вернулась', () => {
    // Задача «Собрать 15 лепестков роз» была невыполнима в принципе:
    // mat_rose_petals нечем добыть. Её уже заменили на рыбалку — проверяем,
    // что при переезде каталога она не всплыла снова
    expect(service).not.toMatch(/daily_rose|daily_herbs/);
  });
});
