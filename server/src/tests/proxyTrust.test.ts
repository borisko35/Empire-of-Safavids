// Ограничители по адресу: адрес должен быть адресом ИГРОКА, а не контейнера.
//
// ТУТ БЫЛА ПОЛНОСТЬЮ ОБЩАЯ ПОЛОМКА, И НА МАШИНЕ РАЗРАБОТЧИКА ЕЁ НЕ
// ВИДНО НИКАК.
//
// На боевом стеке запрос идёт так: браузер → Caddy → nginx (контейнер
// клиента) → express. Оба прокси пишут настоящий адрес игрока в
// X-Forwarded-For, но express без trust proxy эти заголовки игнорирует,
// и req.ip становится адресом контейнера nginx. Он у всех игроков один.
//
// На проде это выглядело так: ключ ограничителя
//   ratelimit:auth:::ffff:172.19.0.3
// Пять гостев со всего мира — и «слишком много гостей с этого устройства»
// получали все, включая тех, кто пришёл впервые, на 24 часа. Плюс общий
// счётчик на 100 попыток входа за 15 минут и на 120 запросов в минуту на
// весь сервер.
//
// Локально (npm run dev) req.ip честный, поэтому ни один тест этого не
// ловил. Проверки ниже — именно на то, чтобы настройка не потерялась.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/stripCode';

const repoRoot = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(repoRoot, p), 'utf-8');

const indexSrc = read('server/src/index/index.ts');
const index = stripComments(indexSrc);
const compose = read('deploy/docker-compose.prod.yml');
const nginx = read('client/nginx.conf');
const rateLimiter = stripComments(read('server/src/middleware/rateLimiter.ts'));
const authRoutes = stripComments(read('server/src/routes/auth.ts'));
const authService = stripComments(read('server/src/services/AuthService.ts'));

/**
 * Разбор compose по секциям верхнего уровня.
 *
 * Две попытки резать файл регуляркой с lookahead на «следующее имя
 * сервиса» не нашли ни одного блока: вложенные ключи (ports, environment)
 * начинаются с тех же двух пробелов, что и имена сервисов. Вторая ошибка —
 * ожидание, что секция volumes тоже сдвинута: в файле она начинается с
 * нулевого отступа, и без отдельной проверки её имена (pg_data,
 * redis_data) читались как сервисы.
 *
 * Разбор построчный: строка без отступа с двоеточием — верхний уровень,
 * и после volumes можно остановиться. Строка ровно из двух пробелов и
 * слова с двоеточием — имя сервиса, всё до следующего такого заголовка
 * его блок.
 */
function composeServices(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = source.split(/\r?\n/);
  let name: string | null = null;
  let buf: string[] = [];
  const flush = (): void => {
    if (name) out[name] = buf.join('\n');
    name = null;
    buf = [];
  };
  for (const line of lines) {
    if (/^volumes:\s*$/.test(line)) break; // дальше только тома
    if (/^[a-z]/.test(line)) { flush(); continue; } // верхний уровень
    const m = /^ {2}([a-z][a-z0-9_-]*):\s*$/.exec(line);
    if (m) {
      flush();
      name = m[1];
    } else if (name) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

const SERVICES = composeServices(compose);

describe('Сервер доверяет прокси: req.ip — адрес игрока', () => {
  it('trust proxy включён', () => {
    // ГЛАВНОЕ. Без этой строки все ограничители ниже считают адрес
    // контейнера nginx, а он одинаков для всех игроков
    expect(index).toMatch(/app\.set\('trust proxy', TRUST_PROXY_HOPS\)/);
  });

  it('значение по умолчанию 2 — это nginx и Caddy', () => {
    // При нуле ситуация не изменится: по умолчанию express не смотрит
    // в заголовки вовсе. Меньше нужного — игрок снова не виден,
    // больше нужного — можно подделать адрес
    expect(indexSrc).toMatch(/process\.env\.TRUST_PROXY_HOPS \?\? 2/);
  });

  it('значение защищено от мусора в переменной окружения', () => {
    // Пустая строка или мусор в .env не должны превращать hops в NaN:
    // поведение express с NaN непредсказуемо, и мы потеряем и защиту,
    // и ограничения
    expect(index).toMatch(/if \(!Number\.isFinite\(raw\) \|\| raw < 0\) return 2;/);
    expect(index).toMatch(/Math\.min\(Math\.floor\(raw\), 5\)/);
  });

  it('настройка стоит ДО подключения маршрутов', () => {
    // Иначе часть маршрутов успеет увидеть неверный req.ip
    const setAt = index.indexOf("app.set('trust proxy'");
    const firstRoute = index.indexOf('app.use(');
    expect({ настройка_раньше_маршрутов: setAt > -1 && setAt < firstRoute })
      .toEqual({ настройка_раньше_маршрутов: true });
  });

  it('переменная проброшена в контейнер сервера', () => {
    // Настройка в коде без переменной в compose осталась бы на локальном
    // значении, и о ней легко забыть при следующем прокси
    expect(SERVICES.server ?? '').toMatch(/TRUST_PROXY_HOPS: \$\{TRUST_PROXY_HOPS:-2\}/);
  });
});

describe('Доверять заголовкам безопасно: сервер не выставлен наружу', () => {
  it('разбор compose нашёл все сервисы (иначе проверки ниже вхолостую)', () => {
    expect(Object.keys(SERVICES).sort())
      .toEqual(['caddy', 'client', 'migrate', 'postgres', 'redis', 'server']);
  });

  it('у сервиса server нет секции ports', () => {
    // ГЛАВНОЕ ДЛЯ БЕЗОПАСНОСТИ. Если бы порт был опубликован, игрок мог
    // бы подделать X-Forwarded-For и обойти любой лимит
    expect(SERVICES.server ?? '').not.toMatch(/^\s*ports:/m);
  });

  it('наружу открыт только Caddy — база и сервер внутри сети', () => {
    // Это и есть причина, по которой trust proxy безопасен: подделать
    // заголовок из интернета нечем, до express и postgres снаружи не дотянуться
    const published = Object.entries(SERVICES)
      .filter(([, block]) => /^\s*ports:/m.test(block))
      .map(([n]) => n)
      .sort();
    expect({ опубликованы: published }).toEqual({ опубликованы: ['caddy'] });
  });

  it('база и сервер портов не имеют', () => {
    for (const svc of ['server', 'postgres', 'redis', 'migrate']) {
      expect({ svc, ports: /^\s*ports:/m.test(SERVICES[svc] ?? '') }).toEqual({ svc, ports: false });
    }
  });

  it('nginx действительно передаёт адрес игрока', () => {
    // Если бы nginx не слал X-Forwarded-For, trust proxy был бы бесполезен
    expect(nginx).toMatch(/proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
  });
});

describe('Ограничители и гость считают по адресу игрока', () => {
  it('ограничитель берёт req.ip', () => {
    expect(rateLimiter).toMatch(/const ip\s+= req\.ip \?\? req\.socket\.remoteAddress/);
  });

  it('лимит гостей на адрес есть и он разумный', () => {
    // Пять гостей на адрес держались как должное, пока вход делался
    // кнопкой на экране входа. С появлением ссылки «Играть за 10 секунд»
    // пять на адрес стало стеной: у мобильных операторов и в офисах один
    // публичный адрес делят десятки людей. Проверка намеренно НЕ зашивает
    // число: важно, что предел существует и не превратился в ноль или
    // тысячу. Само решение — в комментарии над константой.
    const raw = /MAX_GUESTS_PER_IP\s*=\s*(\d+)/.exec(authService)?.[1] ?? '';
    const n = Number(raw);
    expect({ лимит: raw, разумный: n >= 10 && n <= 100 }).toEqual({ лимит: raw, разумный: true });
  });

  it('маршрут гостя передаёт адрес из req.ip', () => {
    expect(authRoutes).toMatch(
      /const ip = req\.ip[\s\S]{0,120}guestLogin\(ip\)/,
    );
  });

  it('пределы не убраны вместе с починкой', () => {
    // Починка не должна была выключить защиту целиком
    expect(rateLimiter).toMatch(/res\.status\(429\)/);
    expect(authService).toMatch(/guest_rate_limited/);
  });
});
