// Раздел «Воронка и удержание» в админ-панели игры.
//
// ЗАЧЕМ ЭТОТ ТЕСТ. Отчёт был на сервере, но увидеть его можно было только
// запросом из консоли. Владелец игры не технический специалист, а цифры,
// которые нельзя посмотреть одним кликом, не смотрят вообще. Тест следит
// не только за наличием раздела, но и за тремя местами, где такой экран
// легко начал бы врать тихо:
//
//   * доля без знаменателя печатается прочерком, а не 0%;
//   * день возврата, который ещё не наступил, — прочерком, а не нулём;
//   * рядом печатается, какие события не записаны ни разу. Иначе ноль в
//     шаге «завели персонажа» читается как «игроки застревают».
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const api = stripComments(read('client/src/app/api.ts'));
const panels = stripComments(read('client/src/app/panels.ts'));
const locale = (lang: string): Record<string, Record<string, string>> =>
  JSON.parse(read(`shared/locales/${lang}.json`));

const LOCALES = ['ru', 'en', 'az'] as const;
const KEYS = [
  'funnel_title', 'funnel_show', 'funnel_days', 'funnel_loading', 'funnel_failed',
  'funnel_window', 'funnel_step', 'funnel_no_players', 'funnel_retention_title',
  'funnel_retention_totals', 'funnel_retention_incomplete', 'funnel_cohort',
  'funnel_cohort_partial', 'funnel_active_title', 'funnel_active_row',
  'funnel_data_missing', 'funnel_data_since',
];

/** Тело функции отрисовки отчёта */
function reportBody(): string {
  return /async function renderAdminFunnel[\s\S]*?\n\}/.exec(panels)?.[0] ?? '';
}

describe('Клиент умеет спросить отчёт', () => {
  it('метод есть и бьёт в нужный адрес', () => {
    expect(api).toMatch(/adminFunnel:\s*\(days\s*=\s*30\)/);
    expect(api).toMatch(/\/api\/admin\/funnel\?days=/);
  });

  it('окно когорты передаётся на сервер, а не выбирается на клиенте', () => {
    // Считать доли на клиенте нельзя: данные приходят готовыми, иначе
    // «неизвестно» превратится в ноль ещё до отрисовки
    expect(api).toMatch(/req<AdminFunnelReport>/);
  });

  it('тип ответа описан и включает честные неизвестные', () => {
    // null в d1/d7/d30 — это «день не наступил», и тип обязан это допускать.
    //
    // Проверяем ТЕЛО интерфейса, а не файл: первая версия искала
    // регуляркой с неограниченным [s\S]*, и нашлась на чужом месте —
    // в AdminFunnelReport.totals, где та же строка встречается снова.
    // Слой, убирающий null из когорты, оставался зелёным.
    const cohort = /export interface RetentionCohort \{[\s\S]*?\n\}/.exec(api)?.[0] ?? '';
    expect({
      нашли_интерфейс: cohort.length > 0,
      d1_может_быть_null: /d1: number \| null;/.test(cohort),
      d7_может_быть_null: /d7: number \| null;/.test(cohort),
      d30_может_быть_null: /d30: number \| null;/.test(cohort),
      есть_признак_неполноты: /full: boolean;/.test(cohort),
    }).toEqual({
      нашли_интерфейс: true,
      d1_может_быть_null: true,
      d7_может_быть_null: true,
      d30_может_быть_null: true,
      есть_признак_неполноты: true,
    });
  });
});

describe('Раздел есть в панели и стоит первым', () => {
  it('панель вызывает отрисовку отчёта', () => {
    expect(panels).toMatch(/renderAdminFunnel/);
    expect(panels).toMatch(/api\.adminFunnel\(/);
  });

  it('раздел добавлен до поиска игрока', () => {
    // Ответ на вопрос «что происходит с игрой» не должен прятаться под
    // поиском игроков и наказаниями
    const sub = panels.indexOf('admin.funnel_title');
    const search = panels.indexOf('admin.players_sub');
    expect({ нашли_оба: sub >= 0 && search >= 0, воронка_раньше: sub >= 0 && sub < search })
      .toEqual({ нашли_оба: true, воронка_раньше: true });
  });

  it('можно выбрать окно 7, 30 и 90 дней', () => {
    expect(panels).toMatch(/for \(const w of \[7, 30, 90\]\)/);
  });

  it('отчёт не дублируется при повторном нажатии (структурная проверка)', () => {
    // Первая версия считала наличие вызова и его количество и оставалась
    // зелёной на сломанном коде: слой убирал условие `if (!out)`, и
    // контейнер создавался заново при каждом нажатии — два нажатия давали
    // бы два отчёта, и какой из них свежий, пришлось бы угадывать.
    //
    // Теперь требуется связка: добавление в box лежит ВНУТРИ условия
    // «контейнера ещё нет». Настоящая проверка поведения требовала бы DOM;
    // jsdom в проекте нет, и тянуть тестовую зависимость ради одной
    // проверки я не решаю сам.
    const body = reportBody();
    const guarded = /if \(!out\) \{[\s\S]{0,300}?box\.append\(out\);[\s\S]{0,60}?\n {2}\}/.test(body);
    const appends = (body.match(/box\.append\(out\)/g) ?? []).length;
    const findsExisting = /getElementById\(outId\)/.test(body);
    expect({ находит_существующий: findsExisting, добавление_под_условием: guarded, добавлений: appends })
      .toEqual({ находит_существующий: true, добавление_под_условием: true, добавлений: 1 });
  });
});

describe('Экран не врёт тихо (главное)', () => {
  it('доля без знаменателя — прочерк, а не 0%', () => {
    // Ноль процентов у шага, где делить не на что, читается как «никто не
    // прошёл», хотя правильный ответ «неизвестно»
    expect(panels).toMatch(/function shareText[\s\S]*share === null \? dash\(\) :/);
  });

  it('прочерк выводится явно, а не пустотой', () => {
    // Пустая ячейка выглядит как «забыли заполнить», а прочерк — как
    // «значения нет» — разница для читателя принципиальная
    expect(panels).toMatch(/function dash\(\)[\s\S]*return '—'/);
  });

  it('недозревший день не превращается в ноль процентов', () => {
    // Типичная ошибка: null превращается в 0, и владелец видит «никто не
    // возвращается на 7-й день», хотя день ещё не наступил
    const body = reportBody();
    expect({
      доля_через_функцию: body.includes('shareText('),
      прямого_нуля_нет: !/shareText\([^)]*\?\?\s*0/.test(body),
    }).toEqual({ доля_через_функцию: true, прямого_нуля_нет: true });
  });

  it('печатается, какие события не записаны ни разу', () => {
    // На боевой базе character_created и level_up не имеют ни одной записи,
    // поэтому их шаги всегда ноль. Без этой строки ноль читается как «игроки
    // застревают», а дело в том, что событие тогда не писали
    const body = reportBody();
    expect(body).toMatch(/eventSince/);
    expect(body).toMatch(/funnel_data_missing/);
  });

  it('печатается дата появления входа в мир', () => {
    // Когорты раньше этой даты собраны без события, и по ним возвраты
    // занижены. Читатель обязан знать, где кончается точность
    expect(reportBody()).toMatch(/funnel_data_since/);
  });

  it('неполные когорты помечаются', () => {
    expect(reportBody()).toMatch(/funnel_cohort_partial/);
  });

  it('пустая воронка объясняется, а не выглядит как провал', () => {
    // Новый сервер без игроков — это не «все бросили», и отчёт не должен
    // выглядеть так, будто что-то сломалось
    expect(reportBody()).toMatch(/funnel_no_players/);
  });

  it('ошибка запроса не роняет панель молча', () => {
    // Пустая панель без объяснения выглядит как «игра сломалась»
    expect(reportBody()).toMatch(/funnel_failed/);
    expect(reportBody()).toMatch(/catch/);
  });
});

describe('Подписи переведены во всех трёх языках', () => {
  for (const lang of LOCALES) {
    it(`${lang} — все ключи раздела на месте и не пустые`, () => {
      const admin = locale(lang).admin ?? {};
      const missing = KEYS.filter(k => !admin[k]?.trim());
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    });
  }

  it('набор ключей одинаков во всех трёх языках', () => {
    // Ключ, забытый в одном языке, показывается игроку как «funnel_title»
    const sets = LOCALES.map(lang => Object.keys(locale(lang).admin ?? {}).filter(k => k.startsWith('funnel_')).sort());
    expect({ ru: sets[0].length, совпадают: sets.every(s => JSON.stringify(s) === JSON.stringify(sets[0])) })
      .toEqual({ ru: sets[0].length, совпадают: true });
  });

  it('подписи объясняют прочерк, а не просто называют колонку', () => {
    // Иначе «—» в таблице останется без смысла
    for (const lang of LOCALES) {
      const text = locale(lang).admin.funnel_retention_incomplete ?? '';
      expect({ lang, объясняет_прочерк: text.length > 20 }).toEqual({ lang, объясняет_прочерк: true });
    }
  });

  it('русский вариант не содержит английских заглушек', () => {
    const ru = KEYS.map(k => locale('ru').admin[k] ?? '');
    const bad = ru.filter(v => /[a-z]{4,}/.test(v.replace(/\{\w+\}/g, '')) && !/[а-яА-Я]/.test(v));
    expect(bad).toEqual([]);
  });
});
