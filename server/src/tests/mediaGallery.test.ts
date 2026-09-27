// Галерея сайта: загруженные файлы должны попадать на главную страницу.
//
// ЗАЧЕМ ЭТО БЫЛО. Панель загрузки фото и видео позволяла залить файл и
// получить ссылку, но больше ничего: страницы сайта собираются в образ
// при сборке контейнера и без пересборки не меняются. То есть сотрудник
// заливал снимок — и он нигде не появлялся, а чтобы поставить его на
// сайт, надо было звать разработчика. Панель в итоге была дорогой
// бесполезной кнопкой: весь её смысл был в «загрузить на сайт», а
// загрузить было некуда.
//
// ТЕПЕРЬ: файл заливается, сотрудник пишет подпись и включает
// публикацию — файл появляется в галерее на главной странице.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const service = read('server/src/services/MediaService.ts');
const routes = read('server/src/routes/media.ts');
const index = read('server/src/index/index.ts');
const panel = read('client/src/app/media.ts');
const siteJs = read('client/web/js/main.js');
const siteHtml = read('client/web/index.html');
const siteCss = read('client/web/css/main.css');
const panelCss = read('client/src/app/styles.css');
const migration = read('database/migrations/038_media_published.sql');

describe('Галерея: в базе есть чем управлять', () => {
  it('у файла есть флаг публикации, и по умолчанию он выключен', () => {
    // Флаг по умолчанию ВЫКЛЮЧЕН — не наоборот. Залитый черновик не должен
    // сам по себе появиться на главной странице: решение принимает человек
    expect(migration).toMatch(/is_public\s+BOOLEAN\s+NOT NULL DEFAULT FALSE/);
  });

  it('подпись пишет сотрудник, а не берётся из имени файла', () => {
    // Имя файла прислано человеком и почти всегда нечитаемое
    expect(migration).toMatch(/caption\s+VARCHAR\(200\)/);
  });

  it('есть дата публикации — по ней галерея сортируется', () => {
    expect(migration).toMatch(/published_at\s+TIMESTAMPTZ/);
  });

  it('индекс только по опубликованным, черновики не сканируются', () => {
    expect(migration).toMatch(/WHERE is_public/);
  });

  it('подпись обрезается ровно под длину поля', () => {
    // Без этого Postgres молча обрезал бы подпись, и панель показывала бы
    // не то, что сотрудник считал отправленным
    expect(service).toMatch(/\.trim\(\)\.slice\(0, 200\)/);
  });
});

describe('Галерея: черновик не должен протечь на сайт', () => {
  it('галерея выбирает только опубликованные', () => {
    // Ключевая строка. Без WHERE is_public на главную попадали бы все
    // залитые файлы, включая недоделанные
    expect(service).toMatch(/WHERE is_public\s*\n\s*ORDER BY published_at DESC/);
  });

  it('сортировка по дате публикации, а не загрузки', () => {
    // Сотрудник мог залить снимок месяц назад и опубликовать вчера —
    // наверху должен оказаться вчерашний
    expect(service).toMatch(/ORDER BY published_at DESC/);
  });

  it('повторная публикация обновляет дату, а не возвращает старую', () => {
    // Иначе порядок выкладки нельзя было бы менять простым переключением
    expect(service).toMatch(/published_at = CASE WHEN \$2 THEN NOW\(\) ELSE NULL END/);
  });

  it('публичный маршрут не требует прав', () => {
    // Галерею смотрит любой посетитель, у него нет ни токена, ни прав
    expect(routes).toMatch(/galleryRouter\.get\('\/', asyncHandler/);
  });

  it('публичный маршрут не проходит через staffOnly', () => {
    // staffOnly стоит на mediaRouter, а галерея вынесена отдельно —
    // именно поэтому, иначе middleware проглотил бы и её
    const g = routes.slice(routes.indexOf('galleryRouter.get'));
    expect(g.slice(0, 400)).not.toMatch(/staffOnly/);
  });

  it('маршрут подключён', () => {
    expect(index).toMatch(/galleryRouter/);
    expect(index).toMatch(/app\.use\('\/api\/media\/gallery', galleryRouter\)/);
  });
});

describe('Галерея: публичная страница не может уронить базу', () => {
  it('limit приводится к числу и зажат в разумные рамки', () => {
    // Без проверки limit=100000 посетитель вытянул бы всю таблицу
    // одним запросом, а limit=abc уронил бы Postgres ошибкой типа —
    // то есть публичная страница могла бы ронять базу
    expect(routes).toMatch(/Number\.parseInt\(String\(req\.query\.limit/);
    expect(routes).toMatch(/Math\.min\(Math\.max\(raw, 1\), 48\)/);
  });
});

describe('Галерея: переключатель в панели', () => {
  it('в панели есть галочка публикации и поле подписи', () => {
    expect(panel).toMatch(/pubBox\.type = 'checkbox'/);
    expect(panel).toMatch(/pubBox\.checked = f\.isPublic/);
    expect(panel).toMatch(/cap\.className = 'media-caption'/);
  });

  it('новый файл приходит черновиком, и панель это учитывает', () => {
    expect(service).toMatch(/isPublic: false/);
  });

  it('подпись и галочка уходят одним запросом', () => {
    // Иначе сотрудник писал бы подпись, жал галочку и искал кнопку
    // «сохранить подпись», которой нет
    expect(panel).toMatch(/JSON\.stringify\(\{ isPublic: pubBox\.checked, caption: cap\.value \}\)/);
  });

  it('при ошибке галочка возвращается на место', () => {
    // Иначе панель врала бы о состоянии файла: показывала бы «на сайте»
    // при файле, который так и не опубликовался
    expect(panel).toMatch(/pubBox\.checked = f\.isPublic/);
  });

  it('isPublic приводится к булеву строго на сервере', () => {
    // Строка "false" в JS истинна: файл опубликовался бы при попытке его
    // СНЯТЬ с публикации. Проверяем именно строгое сравнение
    expect(routes).toMatch(/req\.body\?\.isPublic === true \|\| req\.body\?\.isPublic === 'true'/);
  });

  it('у блока публикации есть свои стили, чтобы не путать с кнопками', () => {
    expect(panelCss).toMatch(/\.media-publish\b/);
    expect(panelCss).toMatch(/\.media-caption\b/);
  });
});

describe('Галерея: вывод на главной странице', () => {
  it('секция есть в разметке и изначально скрыта', () => {
    // Скрыта от рождения: пока сотрудник ничего не опубликовал, заголовка
    // «Галерея» над пустотой на главной быть не должно
    expect(siteHtml).toMatch(/class="section hidden" id="gallery"/);
  });

  it('галерея берёт опубликованное с сервера', () => {
    expect(siteJs).toMatch(/fetch\('\/api\/media\/gallery\?limit=12'/);
  });

  it('пустая галерея прячет секцию, а не показывает заголовок', () => {
    expect(siteJs).toMatch(/if \(!Array\.isArray\(files\) \|\| !files\.length\) \{\s*\n\s*section\.classList\.add\('hidden'\)/);
  });

  it('ошибка запроса тоже прячет секцию', () => {
    // Галерея не должна быть причиной, по которой главная выглядит
    // сломанной
    expect(siteJs).toMatch(/catch \{\s*\n\s*section\.classList\.add\('hidden'\)/);
  });

  it('картинки грузятся лениво, ролики не играют сами', () => {
    // На главной это плётка из получаса трафика без спроса
    expect(siteJs).toMatch(/img\.loading = 'lazy'/);
    expect(siteJs).toMatch(/v\.muted = true/);
    expect(siteJs).toMatch(/mouseenter/);
  });

  it('фото и ролик выводятся по-разному', () => {
    expect(siteJs).toMatch(/f\.kind === 'video'/);
    expect(siteCss).toMatch(/\.gallery-card\.is-video/);
  });

  it('у галереи есть сетка и подписи', () => {
    expect(siteCss).toMatch(/\.gallery-grid\b/);
    expect(siteCss).toMatch(/\.gallery-caption\b/);
  });

  it('галерея рисуется при загрузке страницы и при смене языка', () => {
    // Иначе после переключения языка секция оставалась бы на старом
    // языке или вовсе не появлялась
    expect(siteJs).toMatch(/renderGallery\(\)\.catch/);
  });
});
