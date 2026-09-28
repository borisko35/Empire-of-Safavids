// Мёртвые кнопки: нарисованная кнопка без обработчика.
//
// ТУТ БЫЛА МЁРТВАЯ КНОПКА. Крестик полноэкранной карты (✕) был в разметке
// с самого начала, и к нему не подключил обработчик никто: карта
// закрывалась только клавишей M. Игрок жал крестик, ничего не
// происходило, и карту приходилось закрывать клавишей, о которой на
// самой кнопке ничего не написано. Второе: Esc поверх открытой карты
// открывал меню, а карту не закрывал.
//
// Проверка не про карту, а про все кнопки разметки: у каждой кнопки с
// id обязан быть обработчик в клиентском коде. Раньше поломка жила
// молча — на неё можно было наступить, и тесты были зелёные.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const html = read('client/src/app/index.html');

/** Все клиентские исходники: сюда ищем обработчики */
function clientSources(dir: string): string {
  return readdirSync(dir, { withFileTypes: true }).map((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return clientSources(p);
    return e.name.endsWith('.ts') ? readFileSync(p, 'utf-8') : '';
  }).join('\n');
}

const client = clientSources(join(repoRoot, 'client', 'src'));

/** Кнопки с id: именно они ищутся по id в обработчиках */
function buttonIds(): string[] {
  return [...html.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]);
}

/**
 * Кнопки, чей id собирается в коде, поэтому литерала с id в исходниках
 * нет: auth.ts ищет их как `btn-${provider}`.
 */
const DYNAMIC_IDS = new Set(['btn-google', 'btn-facebook']);

describe('Каждая кнопка в разметке чем-то нажимается', () => {
  it('кнопки с id найдены (иначе проверка ниже вхолостую)', () => {
    expect({ кнопок: buttonIds().length }).toEqual({ кнопок: expect.any(Number) });
    expect(buttonIds().length).toBeGreaterThan(10);
  });

  it('у каждой кнопки с id есть обработчик — мёртвых нет', () => {
    // ГЛАВНОЕ. Кнопка без обработчика выглядит как рабочая, пока игрок
    // не нажмёт её и не получит ничего.
    //
    // Первая версия проверки ругалась на btn-google и btn-facebook, и
    // это было ложное срабатывание: кнопки ищутся как `btn-${provider}`,
    // литерала с id в коде нет. Исключение не пустое слово — под ним
    // отдельная проверка, требующая и шаблон, и провайдеров на сервере.
    const dead = buttonIds().filter((id) =>
      !DYNAMIC_IDS.has(id) && !new RegExp(`['"\`#]${id}['"\`]`).test(client));
    expect({ мёртвые_кнопки: dead }).toEqual({ мёртвые_кнопки: [] });
  });

  it('исключение для динамических id обосновано, а не списано', () => {
    expect(client).toMatch(/getElementById\(`btn-\$\{/);
    const providers = stripComments(read('server/src/services/OAuthService.ts'));
    for (const id of DYNAMIC_IDS) {
      const name = id.replace(/^btn-/, '');
      // Если бы провайдер убрали с сервера, кнопка стала бы мёртвой,
      // а исключение тихо её спрятало бы
      expect({ id, провайдер_есть: providers.includes(`'${name}'`) })
        .toEqual({ id, провайдер_есть: true });
    }
  });

  it('крестик карты закрывает карту', () => {
    // Точечная проверка на ту поломку, с которой всё началось
    expect(html).toMatch(/id="worldmap-close"/);
    expect(client).toMatch(/getElementById\('worldmap-close'\)/);
  });

  it('карта закрывается не только клавишей', () => {
    // Иначе игрок, не знающий про M, вообще не сможет её убрать
    expect(client).toMatch(/overlay-map'\)\?\.classList\.add\('hidden'\)/);
  });

  it('Esc закрывает карту, а не открывает поверх неё меню', () => {
    // Раньше Esc карту не трогал, и меню появлялось ПОВЕРХ карты: игрок
    // жал Esc, чтобы убрать карту, и получал меню под ней.
    //
    // Смотрим world.ts, а не склейку всех исходников: порядок обхода
    // каталогов не определён, и первым попался бы чужой обработчик Esc
    const world = stripComments(read('client/src/app/world.ts'));
    const esc = /e\.code === 'Escape'\)[\s\S]{0,900}/.exec(world)?.[0] ?? '';
    expect(esc).toMatch(/overlay-map/);
    expect(esc.indexOf('overlay-map')).toBeLessThan(esc.indexOf("overlay-menu"));
  });
});
