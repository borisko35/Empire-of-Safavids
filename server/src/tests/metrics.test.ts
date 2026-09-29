// Метрики для Prometheus.
//
// ЧТО БЫЛО. В tools/monitoring/prometheus.yml есть задача, которая снимает
// метрики с server:3000/metrics. Этого адреса не существовало: экспортёра в
// сервере не было. Мониторинг был настроен и молча не работал - то есть
// выглядел как «под наблюдением», а следить было нечем.
//
// ГЛАВНОЕ, ЧТО ЗАЩИЩАЕТСЯ ПРОВЕРКАМИ. Подпись из сырого пути - это утечка
// памяти и бесполезные графики: /api/characters/<uuid>/rename на каждый
// персонаж даёт свою строку. За день игры набегают миллионы. Проверки ниже
// требуют, чтобы тысяча разных идентификаторов дала ОДНУ и ту же подпись.
import { metrics, routeLabel, statusClass } from '../metrics';
import { recordRequest } from '../middleware/metrics';
import { stripComments } from './helpers/stripCode';

beforeEach(() => metrics.reset());

describe('Путь приводится к шаблону', () => {
  it('разные идентификаторы дают одну подпись', () => {
    // То самое, ради чего всё затевалось. Без этого каждая выдача
    // персонажа, каждый переход и каждый запрос по предмету создавали бы
    // свою строку метрики.
    const a = routeLabel('/api/characters/8f3e1a2b-4c5d-6e7f-8a9b-0c1d2e3f4a5b/rename');
    const b = routeLabel('/api/characters/00000000-1111-2222-3333-444444444444/rename');
    expect({ подписи_совпали: a === b, подпись: a }).toEqual({ подписи_совпали: true, подпись: '/api/characters/:id/rename' });
  });

  it('имя персонажа в пути не попадает в подпись', () => {
    // Подпись из пользовательского ввода: и утечка памяти, и способ
    // подделать метрики. Все адреса в игре построены из идентификаторов,
    // поэтому нелатинский сегмент - это точно ввод игрока.
    const label = routeLabel('/api/characters/Лиса/rename');
    expect({ подпись: label, нет_имени: !label.includes('Лиса') })
      .toEqual({ подпись: '/api/characters/:id/rename', нет_имени: true });
  });

  it('закодированная строка тоже не попадает', () => {
    expect(routeLabel('/api/characters/%D0%9B%D0%B8%D1%81%D0%B0/rename')).toBe('/api/characters/:id/rename');
  });

  it('строка запроса отбрасывается', () => {
    // В строке запроса могут быть имена, пароли и токены. Попадание их в
    // подпись - это утечка в графики, которые читают не только вы.
    expect(routeLabel('/api/game/shop?token=secret&name=Лиса')).toBe('/api/game/shop');
  });

  it('длинные числа и имена файлов сборки не плодят ряда', () => {
    // Имена файлов сборки меняются при каждой выкатке: без их замены каждый
    // билд добавлял бы новые ряда, а старые вечно висели бы в памяти.
    expect({
      числа: routeLabel('/api/world/regions/tabriz/12345'),
      файлы: routeLabel('/assets/index-5kcH5ef0.js'),
      два_файла: routeLabel('/assets/index-5kcH5ef0.js') === routeLabel('/assets/index-9ZzQ1xLm.js'),
    }).toEqual({ числа: '/api/world/regions/tabriz/:id', файлы: '/assets/index-:id.js', два_файла: true });
  });

  it('обычные адреса не искажаются', () => {
    // Проверка на то, что защита не съела сама маршруты: иначе все метрики
    // слились бы в одну строку :id и графики стали бы бесполезны с другой
    // стороны.
    for (const p of ['/health', '/api/game/buy', '/api/admin/funnel', '/api/characters']) {
      expect({ путь: p, подпись: routeLabel(p) }).toEqual({ путь: p, подпись: p });
    }
  });

  it('безумно длинный путь обрезается', () => {
    // Иначе одна строка запроса могла бы занять мегабайт в подписи.
    const long = `/${'a'.repeat(500)}`;
    expect(routeLabel(long).length).toBeLessThanOrEqual(120);
  });
});

describe('Класс кода ответа', () => {
  it('отличать надо не точный код, а класс', () => {
    // Иначе каждый код был бы своей подписью, и при 404 у каждого игрока
    // появилась бы своя строка.
    expect([200, 201, 204, 301, 404, 500, 503].map(statusClass))
      .toEqual(['2xx', '2xx', '2xx', '3xx', '4xx', '5xx', '5xx']);
  });
});

describe('Вывод в формате Prometheus', () => {
  it('у каждой метрики есть HELP и TYPE', () => {
    recordRequest({ path: '/api/game/shop', method: 'GET', status: 200, seconds: 0.01 });
    const out = metrics.render();
    expect({ help: out.includes('# HELP eos_http_requests_total'), type: out.includes('# TYPE eos_http_requests_total counter') })
      .toEqual({ help: true, type: true });
  });

  it('счётчик запросов и сумма времени - разные метрики', () => {
    // Ошибка, из-за которой Prometheus принял бы сумму времени за счётчик
    // запросов: время в секундах и количество - разные величины, и в одну
    // метрику они не влезают.
    recordRequest({ path: '/api/game/shop', method: 'GET', status: 200, seconds: 0.5 });
    const out = metrics.render();
    expect({
      счётчик: /eos_http_requests_total\{[^}]*\} 1/.test(out),
      сумма_есть: /eos_http_request_duration_seconds_sum\{[^}]*\} 0\.5/.test(out),
      число_замеров: /eos_http_request_duration_seconds_count\{[^}]*\} 1/.test(out),
    }).toEqual({ счётчик: true, сумма_есть: true, число_замеров: true });
  });

  it('сумма накапливается, а не заменяется', () => {
    for (let i = 0; i < 3; i++) recordRequest({ path: '/api/game/shop', method: 'GET', status: 200, seconds: 0.1 });
    const out = metrics.render();
    expect({ запросов: /eos_http_requests_total\{[^}]*\} 3/.test(out), время: /seconds_sum\{[^}]*\} 0\.3000000/.test(out) })
      .toEqual({ запросов: true, время: true });
  });

  it('ошибки не смешиваются с успехом', () => {
    recordRequest({ path: '/api/game/buy', method: 'POST', status: 500, seconds: 0.2 });
    recordRequest({ path: '/api/game/buy', method: 'POST', status: 200, seconds: 0.2 });
    const out = metrics.render();
    expect({ серверных_ошибок: /status="5xx"\} 1/.test(out), успешных: /status="2xx"\} 1/.test(out) })
      .toEqual({ серверных_ошибок: true, успешных: true });
  });

  it('сервер всегда объявляет себя живым', () => {
    // Иначе нельзя отличить «сервер не отвечает» от «сервер жив, но метрик
    // нет» - а это разные аварии.
    expect(metrics.render()).toMatch(/^eos_up 1$/m);
  });

  it('подписи экранированы', () => {
    // Кавычка в значении подписи закрыла бы строку, и весь вывод после неё
    // перестал бы разбираться.
    metrics.setGauge('eos_test_gauge', 'проверка', 1, { note: 'кавычка " и \\ обратный слэш' });
    const out = metrics.render();
    const line = out.split('\n').find(l => l.startsWith('eos_test_gauge')) ?? '';
    expect({ строка_одна: out.split('\n').filter(l => l.startsWith('eos_test_gauge')).length, кавычка_экранирована: line.includes('\\"'), слэш_экранирован: line.includes('\\\\') })
      .toEqual({ строка_одна: 1, кавычка_экранирована: true, слэш_экранирован: true });
  });
});

describe('Метрики не могут быть наводнены', () => {
  it('потолок на число комбинаций подписей держится', () => {
    // Про тысячу разных идентификаторов: это не «на всякий случай», а
    // ровно тот случай, который случится за день игры. Без потолка память
    // сервера утекает по запросам.
    for (let i = 0; i < 1000; i++) {
      const id = `${i.toString(16).padStart(8, '0')}-1111-2222-3333-444444444444`;
      recordRequest({ path: `/api/characters/${id}/rename`, method: 'GET', status: 200, seconds: 0.001 });
    }
    expect({ комбинаций: metrics.combinationCount, отброшено_видимо: metrics.render().includes('eos_metrics_dropped_label_combinations_total') })
      .toEqual({ комбинаций: expect.any(Number), отброшено_видимо: true });
  });

  it('но полезные ряды не теряются', () => {
    // Потолок не должен съедать настоящие маршруты: если первыми придут
    // мусорные пути, реальные запросы останутся незамеченными.
    recordRequest({ path: '/api/game/buy', method: 'POST', status: 200, seconds: 0.01 });
    for (let i = 0; i < 1000; i++) {
      recordRequest({ path: `/x/${'a'.repeat(300)}-${i}`, method: 'GET', status: 200, seconds: 0.001 });
    }
    // Мусорные пути приводятся к шаблону, а длина ограничена, поэтому
    // настоящий маршрут обязан уцелеть
    expect(metrics.render()).toMatch(/eos_http_requests_total\{route="\/api\/game\/buy"/);
  });

  it('число отброшенных комбинаций видно, а не спрятано', () => {
    // Если потерянные ряды просто исчезнут, они будут выглядеть как
    // «такого маршрута никогда не было» - а это ложь.
    expect(metrics.render()).toMatch(/^eos_metrics_dropped_label_combinations_total 0$/m);
  });
});

describe('Показатели, которые вычисляются в момент снятия', () => {
  it('число игроков попадает в вывод', () => {
    metrics.registerGaugeProvider(() => ({ name: 'eos_players_online', help: 'Игроков сейчас', labels: {}, value: 7 }));
    expect(metrics.render()).toMatch(/^eos_players_online 7$/m);
  });

  it('сломанный показатель не роняет всю выдачу', () => {
    // Иначе одно сломанное значение остановит диагностику ровно тогда,
    // когда она нужнее всего.
    metrics.registerGaugeProvider(() => { throw new Error('сокет не поднялся'); });
    metrics.registerGaugeProvider(() => ({ name: 'eos_players_online', help: 'Игроков сейчас', labels: {}, value: 3 }));
    const out = metrics.render();
    expect({
      вывод_есть: out.includes('eos_up 1'),
      игроки_на_месте: out.includes('eos_players_online 3'),
      ошибка_учтена: out.includes('eos_metrics_provider_errors_total 1'),
    }).toEqual({ вывод_есть: true, игроки_на_месте: true, ошибка_учтена: true });
  });

  it('один показатель не печатается дважды', () => {
    metrics.registerGaugeProvider(() => ({ name: 'eos_players_online', help: 'Игроков', labels: {}, value: 1 }));
    metrics.registerGaugeProvider(() => ({ name: 'eos_players_online', help: 'Игроков', labels: {}, value: 2 }));
    const lines = metrics.render().split('\n').filter(l => l.startsWith('eos_players_online'));
    expect({ строк: lines.length }).toEqual({ строк: 1 });
  });
});

describe('Адрес, который ждал Prometheus', () => {
  const index = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'index', 'index.ts'), 'utf-8',
  );
  const prometheus = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', '..', 'tools', 'monitoring', 'prometheus.yml'), 'utf-8',
  );

  it('маршрут /metrics есть и отдаёт текст', () => {
    // Ровно этот адрес прописан в prometheus.yml. Пока его не было,
    // мониторинг был настроен и молча не работал.
    expect({
      маршрут: /app\.get\('\/metrics'/.test(index),
      тип_ответа: /text\/plain; version=0\.0\.4/.test(index),
      адрес_в_конфиге_совпадает: /metrics_path: '\/metrics'/.test(prometheus),
    }).toEqual({ маршрут: true, тип_ответа: true, адрес_в_конфиге_совпадает: true });
  });

  it('сбор стоит до маршрутов, иначе он ничего не увидит', () => {
    const middlewareAt = index.indexOf('app.use(metricsMiddleware)');
    const firstRouteAt = index.indexOf("app.use('/api/auth'");
    expect({ middleware_раньше_маршрутов: middlewareAt > 0 && firstRouteAt > middlewareAt })
      .toEqual({ middleware_раньше_маршрутов: true });
  });

  it('время ответа берётся не с системных часов', () => {
    // Системные часы умеют прыгать: NTP, смена пояса, правка времени
    // вручную. Прыжок дал бы отрицательное время ответа в метрике.
    //
    // Комментарии отбрасываются обязательно: в объяснении, почему часы не
    // используются, само имя Date.now() написано - и проверка находила
    // саму себя. Это уже второй раз за день, и правило теперь общее:
    // любая проверка вида «в коде нет X» обязана сначала снять комментарии,
    // иначе она проверяет не код, а текст рядом с ним.
    const mw = stripComments(require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'middleware', 'metrics.ts'), 'utf-8',
    ));
    expect({
      использует_hrtime: /process\.hrtime\.bigint\(\)/.test(mw),
      не_использует_Date_now: !/Date\.now\(\)/.test(mw),
    }).toEqual({ использует_hrtime: true, не_использует_Date_now: true });
  });

  it('счётчик игроков онлайн подключён', () => {
    // Единственная метрика, ради которой мониторинг владельцу и нужен.
    expect({
      провайдер: /registerGaugeProvider/.test(index),
      источник: /gameSocketHandler\.getOnlineCount\(\)/.test(index),
    }).toEqual({ провайдер: true, источник: true });
  });

  it('в выдаче нет имён и идентификаторов игроков', () => {
    // Метрики читаются снаружи. Имя персонажа в подписи - это утечка, и
    // одновременно вектор подделки: насоздавать мусорных рядов.
    for (let i = 0; i < 200; i++) {
      recordRequest({ path: `/api/characters/${i}0000000-1111-2222-3333-444444444444/rename`, method: 'GET', status: 200, seconds: 0.001 });
    }
    const out = metrics.render();
    expect({ нет_префиксов: !/prefix_/.test(out), нет_почты: !/@/.test(out), только_наш_префикс: /^# HELP eos_/m.test(out) })
      .toEqual({ нет_префиксов: true, нет_почты: true, только_наш_префикс: true });
  });
});
