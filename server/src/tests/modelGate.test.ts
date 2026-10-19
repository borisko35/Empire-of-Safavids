// Модели персонажей закрыты входом: сторож на то, что запор на месте.
//
// ЗАЧЕМ. В сборке есть анимации из библиотеки Adobe Mixamo (45 файлов .glb из
// 82 — разбор в THIRD_PARTY.md). Условия Mixamo разрешают игру и запрещают
// раздачу исходных файлов, а `/game/models/` до этого отдавался кому угодно:
// любой мог скачать анимацию отдельным файлом, не входя в игру.
//
// ПОЧЕМУ ПО ТЕКСТУ, А НЕ ПОВЕДЕНИЕМ. Поднять nginx с сервером и живой сессией
// в Jest нечем. Проверка по тексту слабее поведенческой — она не доказывает,
// что игрок со входом получает файл, — поэтому поведение проверено на живом
// стенде ломкой: без строки `auth_request` тот же файл отдаётся кому угодно
// (200 и glTF в теле), с ней — 401 без файла в теле. Здесь же караулится то,
// что можно потерять молча при следующей правке конфига или нового загрузчика:
//   1. блок моделей в nginx вообще есть и спрашивает сервер;
//   2. ответ не кэшируется как публичный (иначе промежуточный кэш раздал бы
//      файл следующему, кто его попросит, — то есть ровно вернул бы дыру);
//   3. путь внутрь (internal) снаружи недоступен и токен в него доходит;
//   4. маршрут сервера отвечает по тем же правилам, что и весь API;
//   5. ни один загрузчик моделей в клиенте не забыл представиться — иначе
//      модели не грузятся ни у кого, а снаружи это выглядит как «не вошёл»;
//   6. все .glb сборки лежат именно под закрытым путём.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { stripComments } from './helpers/stripCode';

const корень = join(__dirname, '..', '..', '..');
const читать = (путь: string): string => readFileSync(join(корень, путь), 'utf-8');

const nginx = читать('client/nginx.conf');
const authRoutes = stripComments(читать('server/src/routes/auth.ts'));

/** Тело location-блока по имени — так же, как в cacheHeaders.test.ts. */
function блокNginx(имя: string): string {
  const start = nginx.indexOf(`location ${имя}`);
  if (start < 0) return '';
  const next = nginx.indexOf('\n  }', start);
  return nginx.slice(start, next < 0 ? nginx.length : next);
}

/** Все .ts клиента, рекурсивно. */
function файлыКлиента(каталог: string): string[] {
  const итог: string[] = [];
  for (const имя of readdirSync(каталог)) {
    const полный = join(каталог, имя);
    if (statSync(полный).isDirectory()) итог.push(...файлыКлиента(полный));
    else if (имя.endsWith('.ts')) итог.push(полный);
  }
  return итог;
}

/** Все .glb в публичном каталоге клиента, рекурсивно (относительные пути). */
function публичныеМодели(каталог: string): string[] {
  const итог: string[] = [];
  for (const имя of readdirSync(каталог)) {
    const полный = join(каталог, имя);
    if (statSync(полный).isDirectory()) итог.push(...публичныеМодели(полный));
    else if (имя.endsWith('.glb')) итог.push(relative(join(корень, 'client/src/app/public'), полный));
  }
  return итог;
}

describe('модели закрыты входом', () => {
  it('nginx спрашивает сервер перед отдачей файла модели', () => {
    const блок = блокNginx('^~ /game/models/');
    expect({
      блок_есть: блок.length > 0,
      спрашивает: /auth_request\s+\/_eos_models_gate;/.test(блок),
      // alias — тот самый каталог, что и раньше: путь отдачи не менялся,
      // поменялось только «сначала вход».
      отдаёт_тот_же_каталог: /alias\s+\/usr\/share\/nginx\/html\/game\/models\/;/.test(блок),
      // ^~ — префикс с приоритетом: общий блок /game/ не должен перехватить.
      префикс_с_приоритетом: блок.includes('location ^~ /game/models/'),
    }).toEqual({
      блок_есть: true,
      спрашивает: true,
      отдаёт_тот_же_каталог: true,
      префикс_с_приоритетом: true,
    });
  });

  it('ответ по модели не кэшируется как публичный', () => {
    const блок = блокNginx('^~ /game/models/');
    // private — промежуточный кэш (Cloudflare) хранить не должен: иначе он
    // отдал бы файл следующему запросившему, и вход стал бы украшением.
    expect(блок).toMatch(/add_header\s+Cache-Control\s+"private, no-cache"\s+always;/);
    // Срок годности без private был бы той же дырой, только в браузере.
    expect(блок).not.toMatch(/Cache-Control[^;]*max-age=\d+/);
    expect(блок).not.toMatch(/Cache-Control[^;]*public/);
  });

  it('внутренний путь проверки снаружи недоступен и токен до него доходит', () => {
    const блок = блокNginx('= /_eos_models_gate');
    expect({
      блок_есть: блок.length > 0,
      только_внутри: /internal;/.test(блок),
      идёт_на_сервер: /proxy_pass\s+http:\/\/server:3000\/api\/auth\/gate;/.test(блок),
      // Токен передаётся явно. Проверено ломкой: строка не обязательна —
      // nginx и без неё отдаёт Authorization подзапросу, — но здесь она
      // держит в конфиге видимую зависимость «вход спрашивается по токену».
      передаёт_токен: /proxy_set_header\s+Authorization\s+\$http_authorization;/.test(блок),
      // Тело подзапроса не нужно: это GET.
      без_тела: /proxy_pass_request_body\s+off;/.test(блок),
    }).toEqual({
      блок_есть: true,
      только_внутри: true,
      идёт_на_сервер: true,
      передаёт_токен: true,
      без_тела: true,
    });
  });

  it('маршрут проверки пускает по тем же правилам, что и весь API', () => {
    // secureMiddleware, а не «просто токен в Redis»: иначе забаненный игрок
    // качал бы модели, хотя в игру его уже не пускают, — то есть у вопроса
    // «вошёл ли» стало бы два разных ответа.
    expect(authRoutes).toMatch(/authRouter\.get\('\/gate',\s*secureMiddleware/);
    // Тело не нужно: nginx смотрит только на код.
    expect(authRoutes).toMatch(/sendStatus\(204\)/);
  });

  it('ни один загрузчик моделей не забыл представиться', () => {
    // Загрузчиков шесть мест в пяти файлах, и все они ходят в один каталог.
    // Забыть заголовок в новом месте — значит получить пустую сцену у всех:
    // 401 снаружи выглядит как обычный «не вошёл», и искать будут в сессии.
    const каталог = join(корень, 'client', 'src', 'app');
    const загрузчики = файлыКлиента(каталог)
      .map((путь) => ({ путь, код: stripComments(readFileSync(путь, 'utf-8')) }))
      .filter(({ код }) => код.includes('/game/models/'));

    // Если файлов не нашлось, проверка ниже прошла бы впустую.
    expect(загрузчики.length).toBeGreaterThan(0);
    const безЗаголовка = загрузчики
      .filter(({ код }) => !код.includes('сВходом'))
      .map(({ путь }) => relative(корень, путь));
    expect(безЗаголовка).toEqual([]);
  });

  it('все модели сборки лежат под закрытым путём', () => {
    // Модель, положенная мимо `public/models` (например, в web/assets),
    // в закрытый каталог не попадёт и окажется открытой — при зелёном
    // стороже на сам запор.
    const модели = публичныеМодели(join(корень, 'client/src/app/public'));
    expect(модели.length).toBeGreaterThan(0);
    const мимо = модели.filter((п) => !п.startsWith('models' + sep));
    expect(мимо).toEqual([]);
  });
});
