// Загрузка фото и видео силами сотрудников.
//
// ЭТА ФИЧА ПРИНИМАЕТ ФАЙЛЫ ОТ ПОЛЬЗОВАТЕЛЯ, ЗНАЧИТ ГЛАВНОЕ В НЕЙ —
// БЕЗОПАСНОСТЬ. Три риска, и все три закрыты:
//
//  1. Имя файла на диске. Если писать то, что прислал человек, то
//     «../../etc/passwd» и «a.html» — это не абстракция, а готовый
//     обход: затереть чужой файл или положить на сервер страницу с
//     чужим скриптом. Поэтому имя генерирует сервер.
//
//  2. Тип файла. Content-Type задаёт браузер, расширение — тоже человек.
//     Скрипт с расширением .png проходит оба. Поэтому сверяем первые
//     байты: сигнатуру подделать нельзя.
//
//  3. Размер. Без потолка один запрос на 300 МБ забивает диск.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sniff, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from '../services/MediaService';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const service = read('server/src/services/MediaService.ts');
const routes = read('server/src/routes/media.ts');
const index = read('server/src/index/index.ts');
const migration = read('database/migrations/037_media_files.sql');
const compose = read('deploy/docker-compose.prod.yml');
const client = read('client/src/app/media.ts');
const clientIndex = read('client/src/app/index.html');
const clientWorld = read('client/src/app/world.ts');

/** Собрать файл с настоящей сигнатурой */
function withHeader(head: number[], size = 64): Buffer {
  const b = Buffer.alloc(Math.max(size, head.length + 8));
  head.forEach((v, i) => { b[i] = v; });
  return b;
}

const PNG  = withHeader([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const JPEG = withHeader([0xFF, 0xD8, 0xFF, 0xE0]);
const GIF  = withHeader([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const MP4  = (() => { const b = Buffer.alloc(64); b.writeUInt32BE(24, 0); b.write('ftypisom', 4, 'ascii'); return b; })();
const WEBM = withHeader([0x1A, 0x45, 0xDF, 0xA3]);

describe('Загрузка: тип файла определяется по содержимому', () => {
  it('картинки опознаются по сигнатуре', () => {
    expect(sniff(PNG)?.mime).toBe('image/png');
    expect(sniff(JPEG)?.mime).toBe('image/jpeg');
    expect(sniff(GIF)?.mime).toBe('image/gif');
  });

  it('видео опознаётся по сигнатуре', () => {
    expect(sniff(MP4)?.kind).toBe('video');
    expect(sniff(WEBM)?.kind).toBe('video');
  });

  it('скрипт с расширением .png не проходит', () => {
    // Раньше тип определялся по Content-Type и расширению — и то, и другое
    // задаёт тот, кто отправил запрос. Подделать можно оба.
    const html = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');
    expect(sniff(html)).toBeNull();
    const elf = withHeader([0x7F, 0x45, 0x4C, 0x46]);
    expect(sniff(elf)).toBeNull();
  });

  it('png с подменёнными байтами внутри отвергается', () => {
    // Проверяем не только «похож на png», но что сигнатура на месте
    const bad = Buffer.from(PNG);
    bad[1] = 0x00;
    expect(sniff(bad)).toBeNull();
  });

  it('mov отдаётся как mp4: расширению доверия нет', () => {
    // Сигнатура у mov и mp4 одинаковая, различается только расширение,
    // а оно приходит от клиента. Браузеры играют mp4 одинаково.
    const mov = Buffer.from(MP4);
    expect(sniff(mov)?.ext).toBe('mp4');
  });

  it('пустой файл не распознаётся и не падает', () => {
    expect(sniff(Buffer.alloc(0))).toBeNull();
    expect(sniff(Buffer.from([0x89]))).toBeNull();
  });
});

describe('Загрузка: имя файла выбирает сервер', () => {
  it('на диск пишется сгенерированное имя, а не присланное', () => {
    // ГЛАВНЫЙ РИСК. «../../etc/passwd» в имени — готовая запись вне папки
    expect(service).toMatch(/const storageName = `\$\{uuidv4\(\)\}\.\$\{info\.ext\}`/);
  });

  it('оригинальное имя только показывается, на диск не идёт', () => {
    expect(service).toMatch(/original_name/);
    // В writeFile — только storageName
    const write = service.match(/writeFile\([^)]*\)/)?.[0] ?? '';
    expect(write).toContain('storageName');
    expect(write).not.toContain('originalName');
  });

  it('удаление не даёт выйти за пределы папки', () => {
    // Даже если в базу попадёт «../../…», path.join вылезет наружу.
    // Проверяем результат, а не вход.
    expect(service).toMatch(/path\.dirname\(target\) !== path\.resolve\(dir\)/);
  });

  it('в базе имя и оригинал хранятся раздельно', () => {
    expect(migration).toMatch(/storage_name\s+VARCHAR\(80\) NOT NULL UNIQUE/);
    expect(migration).toMatch(/original_name\s+VARCHAR\(255\)/);
  });
});

describe('Загрузка: потолки на размер', () => {
  it('для картинки и видео разные потолки', () => {
    expect(MAX_IMAGE_BYTES).toBeLessThan(MAX_VIDEO_BYTES);
    expect(MAX_IMAGE_BYTES).toBeGreaterThan(0);
  });

  it('потолк проверяется по распознанному типу, а не по заявленному', () => {
    // Иначе можно было бы заявить «это картинка» и положить 300 МБ
    expect(service).toMatch(/const limit = info\.kind === 'image' \? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES/);
  });

  it('на входе стоит общий потолок, чтобы не держать в памяти лишнее', () => {
    expect(routes).toMatch(/express\.raw\(\{ type: '\*\/\*', limit: '320mb' \}\)/);
  });

  it('невозможный формат отвергается, а не сохраняется', () => {
    expect(service).toMatch(/unsupported_format/);
    expect(service).toMatch(/empty_file/);
  });
});

describe('Загрузка: доступ только у сотрудников', () => {
  it('все три маршрута закрыты проверкой прав', () => {
    // Без этого любой игрок залил бы файлы и забил диск.
    // \s* вместо пробела: в файле один вызов написан в одну строку, другой
    // с переносом — и обычный поиск подстроки на одном из них падал бы.
    const guarded = [
      { name: 'post', re: /mediaRouter\.post\(\s*'\/'\s*,\s*staffOnly/ },
      { name: 'get', re: /mediaRouter\.get\(\s*'\/'\s*,\s*staffOnly/ },
      { name: 'delete', re: /mediaRouter\.delete\(\s*'\/:id'\s*,\s*staffOnly/ },
    ];
    for (const g of guarded) {
      expect({ route: g.name, guarded: g.re.test(routes) })
        .toEqual({ route: g.name, guarded: true });
    }
  });

  it('проверка идёт и по флагу, и по роли', () => {
    // У разработчика роль 'developer' без флага is_admin
    expect(routes).toMatch(/!row\.is_admin && !SITE_STAFF_ROLES\.has/);
    expect(routes).toMatch(/code: 'admin_required'/);
  });

  it('без токена — 401, а не 403', () => {
    expect(routes).toMatch(/if \(!req\.userId\)[\s\S]*?401/);
  });

  it('кнопка панели показывается тем же составу сотрудников', () => {
    // Иначе кнопка была бы видна кому-то, кому сервер ответит 403
    expect(clientWorld).toMatch(/STAFF_ROLES = \['owner', 'administrator', 'admin', 'moderator', 'developer', 'dev', 'gm'\]/);
    expect(clientWorld).toMatch(/btn-panel-media/);
  });
});

describe('Загрузка: файл не пропадёт при пересборке', () => {
  it('путь хранения задаётся переменной окружения', () => {
    // Без неё файлы легли бы внутрь контейнера и исчезли бы при --build
    expect(compose).toMatch(/MEDIA_DIR: \/app\/uploads\/media/);
    expect(service).toMatch(/process\.env\.MEDIA_DIR/);
  });

  it('это именно том, а не папка в образе', () => {
    expect(compose).toMatch(/media_uploads:\/app\/uploads\/media/);
    expect(compose).toMatch(/^  media_uploads:/m);
  });

  it('том объявлен в списке volumes', () => {
    // Без объявления docker compose не запустится
    const declared = compose.match(/^volumes:([\s\S]*)$/m)?.[1] ?? '';
    expect(declared).toMatch(/media_uploads/);
  });
});

describe('Загрузка: раздача файлов', () => {
  it('файлы отдаются по короткому адресу /media/', () => {
    expect(index).toMatch(/app\.use\('\/media', express\.static\(mediaDir\(\)/);
  });

  it('кеш бессрочный безопасен: имя генерируется и не переиспользуется', () => {
    // Сгенерированное имя не может повториться, поэтому файл по этому
    // адресу всегда один и тот же
    expect(index).toMatch(/maxAge: '365d'/);
    expect(index).toMatch(/immutable: true/);
  });

  it('листинг папки закрыт', () => {
    // Иначе по /media/ был бы виден список всех загрузок
    expect(index).toMatch(/index: false/);
    expect(index).toMatch(/dotfiles: 'deny'/);
  });
});

describe('Загрузка: панель', () => {
  it('есть зона перетаскивания и выбор файла', () => {
    expect(client).toMatch(/media-drop/);
    expect(client).toMatch(/'drop'/);
    expect(client).toMatch(/type = 'file'/);
  });

  it('прогресс виден, и загрузку можно отменить', () => {
    // На видео в 300 МБ это разница между «понятно» и «висит»
    expect(client).toMatch(/xhr\.upload\.onprogress/);
    expect(client).toMatch(/xhr\.abort\(\)/);
    expect(clientIndex).toMatch(/id="media-list"/);
  });

  it('имя файла идёт в заголовке, тело — байты файла', () => {
    // Без библиотеки multipart: тело есть файл, имя лежит в заголовке
    expect(client).toMatch(/X-Filename/);
    expect(client).toMatch(/xhr\.send\(file\)/);
    expect(routes).toMatch(/req\.get\('x-filename'\)/);
  });

  it('файлы по очереди: один ролик не должен блокировать остальные', () => {
    expect(client).toMatch(/for \(const file of files\)/);
    expect(client).toMatch(/await uploadFile/);
  });

  it('перед загрузкой размер проверяется на клиенте', () => {
    // Сервер всё равно проверит, но незачем гонять заведомо лишнее
    expect(client).toMatch(/MAX_IMAGE/);
    expect(client).toMatch(/MAX_VIDEO/);
  });

  it('ролик можно посмотреть прямо в панели', () => {
    expect(client).toMatch(/createElement\('video'\)/);
  });
});

describe('Загрузка: переводы', () => {
  const keys = [
    'media.title', 'media.drop_hint', 'media.drop_formats', 'media.uploaded',
    'media.cancel', 'media.cancelled', 'media.upload_failed', 'media.network_error',
    'media.bad_format', 'media.too_big', 'media.load_failed', 'media.empty',
    'media.total', 'media.photo', 'media.video', 'media.copy', 'media.copied',
    'media.copy_failed', 'media.delete', 'media.delete_confirm', 'media.deleted',
    'media.delete_failed',
  ];
  for (const lang of ['ru', 'en', 'az']) {
    it(`в ${lang} есть все строки`, () => {
      const json = JSON.parse(read(`shared/locales/${lang}.json`)) as Record<string, unknown>;
      for (const k of keys) {
        const val = k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)?.[p], json);
        expect({ key: k, present: !!val }).toEqual({ key: k, present: true });
      }
    });
  }
});
