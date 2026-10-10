// Реклама стоит на лендинге и НЕ стоит в игре.
//
// ЗАЧЕМ ТАКАЯ ПРОВЕРКА. Реклама — сторонний чужой код, который в браузере
// получает права самой страницы: читает localStorage, перехватывает формы.
// В игре на том же origin лежат платёжки (YooKassa, Xsolla, Epoint) и токен
// авторизации. Сторонний скрипт там стоит несравнимо дороже.
//
// Проверка охраняет границу: реклама есть на лендинге и отсутствует в /game/.
// Если она когда-нибудь «случайно» уедет в игру, проверка это поймает.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const корень = join(__dirname, '..', '..', '..');
const читать = (p: string): string => readFileSync(join(корень, p), 'utf-8');

/** Все .ts и .html клиента, кроме собранных бандлов. */
function файлыКлиента(): { путь: string; текст: string }[] {
  const { readdirSync } = require('node:fs');
  const результат: { путь: string; текст: string }[] = [];
  const обход = (каталог: string): void => {
    for (const запись of readdirSync(join(корень, каталог), { withFileTypes: true })) {
      if (запись.name === 'node_modules') continue;
      const путь = join(каталог, запись.name);
      if (запись.isDirectory()) {
        if (путь.replace(/\\/g, '/').endsWith('web/game')) continue;
        обход(путь);
        continue;
      }
      if (!/\.(ts|html|js)$/.test(запись.name)) continue;
      if (путь.replace(/\\/g, '/').includes('web/game/assets')) continue;
      результат.push({ путь: путь.replace(/\\/g, '/'), текст: readFileSync(join(корень, путь), 'utf-8') });
    }
  };
  обход('client/src');
  обход('client/web');
  return результат;
}

const ЛЕНДИНГ = 'client/web/index.html';
const ВИЗИТКА = 'bauval.org';
/** Короткий id рекламной сети. В URL он без префикса, в id контейнера — с ним. */
const КОД_РЕКЛАМЫ = 'afc0d5b6522686f2e3d9ce906ea4e537';
const КОНТЕЙНЕР = `container-${КОД_РЕКЛАМЫ}`;

describe('Реклама: только на лендинге', () => {
  it('скрипт и контейнер есть на лендинге', () => {
    const текст = читать(ЛЕНДИНГ);
    expect({
      скрипт: текст.includes(`src="https://${ВИЗИТКА}/21/${КОД_РЕКЛАМЫ}"`),
      контейнер: текст.includes(`id="${КОНТЕЙНЕР}"`),
    }).toEqual({ скрипт: true, контейнер: true });
  });

  it('data-cfasync="false" на месте', () => {
    // Без него Cloudflare Rocket Loader откладывает скрипт и переставляет
    // порядок: рекламный контейнер остаётся пустым.
    const текст = читать(ЛЕНДИНГ);
    const строка = текст.split('\n').find((с) => с.includes(ВИЗИТКА));
    expect({
      async: /async/.test(строка ?? ''),
      cfasync: /data-cfasync="false"/.test(строка ?? ''),
    }).toEqual({ async: true, cfasync: true });
  });

  it('в игре (/game/) рекламы нет', () => {
    // Главное свойство. Проверяем по ВСЕМ исходникам игры, а не по одному
    // файлу: «добавили в один, а загрузилось из другого» — тихой поломки не
    // получится.
    const нарушители = файлыКлиента()
      .filter((ф) => ф.путь !== ЛЕНДИНГ)
      .filter((ф) => ф.текст.includes(ВИЗИТКА))
      .map((ф) => ф.путь);
    expect({ нарушители }).toEqual({ нарушители: [] });
  });

  it('реклама в world/index.html лендинга — а не в игровом index.html', () => {
    // Их два: client/web/index.html и client/src/app/index.html. Второй —
    // это страница /game/, и она не должна ничего тянуть снаружи.
    const игра = читать('client/src/app/index.html');
    const внешние = (игра.match(/src="https?:\/\//g) ?? []).length;
    expect({ внешнихСкриптов: внешние }).toEqual({ внешнихСкриптов: 0 });
  });

  it('реклама не мешает лицензии и обратным ссылкам', () => {
    // Резать футер ради рекламы нельзя: GPL и ссылки на форум — обещание.
    const текст = читать(ЛЕНДИНГ);
    expect({
      форум: текст.includes('/forum.html'),
      лицензия: /github\.com\/borisko35/.test(текст),
    }).toEqual({ форум: true, лицензия: true });
  });
});