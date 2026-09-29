// Счётчики для Prometheus.
//
// ЧТО БЫЛО. В tools/monitoring/prometheus.yml есть задача, которая снимает
// метрики с server:3000/metrics. Этого адреса не существовало: экспортёра в
// сервере не было, и Prometheus получал отказ - то есть мониторинг был
// настроен и молча не работал.
//
// ПОЧЕМУ БЕЗ prom-client. Зависимость была бы привычнее, но подключение
// пакета означает, что сборка обращается к реестру пакетов, и если он
// недоступен - сервер не поднимется вообще. Для диагностического адреса это
// плохая сделка. Формат вывода для счётчиков и сумм прост, и проверяется
// он тестами.
//
// ГЛАВНОЕ ПРАВИЛО: ПОДПИСИ - НИКОГДА НЕ СЫРОЙ ПУТЬ.
//
// Если писать в подпись req.path как есть, то каждый запрос вида
// /api/characters/8f3e.../rename создаст свою комбинацию. Через неделю в
// памяти будут миллионы строк, графики станут бесполезными, и сервер
// начнёт подъедать память на ровном месте. Поэтому путь приводится к
// ШАБЛОНУ: идентификаторы заменяются на :id.
//
// Подпись из пользовательского ввода - вдобавок вектор для подделки
// метрик. Имя персонажа в подписи создало бы тысячи мусорных рядов.

/** Потолок на число комбинаций подписей. Не даёт утечь памяти на мусоре. */
const MAX_LABEL_COMBINATIONS = 500;

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const LONG_NUMBER_RE = /\b\d{2,}\b/g;
const HASHED_FILE_RE = /-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|jpg|ico)$/;
// Сегмент пути, в котором есть что-то кроме латиницы, цифр, дефиса,
// подчёркивания, точки, двоеточия и самого слэша-разделителя. Обычно это
// имя персонажа или закодированная строка: и то и другое не имеет права
// попасть в подпись метрики, потому что каждое новое значение - это новая
// строка в памяти и новая линия на графике. Все адреса в игре построены из
// идентификаторов, поэтому такие сегменты заменяются на :id целиком.
const UNSAFE_SEGMENT_RE = /\/[^/]*[^A-Za-z0-9_.\-:/][^/]*/g;

// Замена сохраняет ведущий слэш сегмента: без него '/api/characters/Лиса'
// превратился бы в '/api/characters:id', то есть склеился бы с предыдущим
// сегментом.

/**
 * Привести путь к шаблону.
 *
 * `/api/characters/8f3e...-.../rename` → `/api/characters/:id/rename`
 * `/api/game/shop?x=1`                 → `/api/game/shop`
 * `/assets/index-5kcH5ef0.js`          → `/assets/index-:id.js`
 *
 * Имена файлов сборки меняются при каждой выкатке: без их замены каждый
 * билд добавлял бы новые ряда, а старые вечно висели бы в памяти.
 */
export function routeLabel(rawPath: string): string {
  const path = rawPath.split('?')[0];
  const cleaned = path
    .replace(UUID_RE, ':id')
    .replace(LONG_NUMBER_RE, ':id')
    .replace(HASHED_FILE_RE, '-:id.$1')
    .replace(UNSAFE_SEGMENT_RE, '/:id');
  return cleaned.length > 120 ? `${cleaned.slice(0, 110)}...` : cleaned;
}

/** Класс кода ответа: 2xx, 4xx, 5xx. Точный код в подписи не нужен. */
export function statusClass(status: number): string {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  return '2xx';
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export type Labels = Record<string, string>;

function labelText(labels: Labels): string {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
}

interface Series {
  name: string;
  help: string;
  labels: Labels;
  count: number;
  sum: number;
}

class MetricsRegistry {
  private series: Series[] = [];
  private byKey = new Map<string, Series>();
  private gauges: { name: string; help: string; labels: Labels; value: number }[] = [];
  private gaugeProviders: (() => { name: string; help: string; labels: Labels; value: number })[] = [];
  private overflowed = 0;
  private providerErrors = 0;

  private key(name: string, labels: Labels): string {
    return `${name}|${Object.entries(labels).sort().map(([k, v]) => `${k}=${v}`).join(',')}`;
  }

  private touch(name: string, help: string, labels: Labels): Series | null {
    const key = this.key(name, labels);
    const found = this.byKey.get(key);
    if (found) return found;
    // Потолок. Переполнение не молчим: считаем, сколько комбинаций
    // отбросили, и показываем отдельной метрикой. Иначе потерянные ряды
    // выглядели бы как «такого маршрута не было».
    if (this.series.length >= MAX_LABEL_COMBINATIONS) { this.overflowed++; return null; }
    const created: Series = { name, help, labels, count: 0, sum: 0 };
    this.series.push(created);
    this.byKey.set(key, created);
    return created;
  }

  /** Счётчик: сколько раз случилось. */
  count(name: string, help: string, labels: Labels = {}): void {
    const s = this.touch(name, help, labels);
    if (s) s.count++;
  }

  /** Наблюдение величины: время в секундах. Публикуется как _count и _sum. */
  observe(name: string, help: string, seconds: number, labels: Labels = {}): void {
    this.touch(name, help, labels);
    const s = this.byKey.get(this.key(name, labels));
    if (!s) return;
    s.count++;
    s.sum += seconds;
  }

  setGauge(name: string, help: string, value: number, labels: Labels = {}): void {
    const existing = this.gauges.find(g => this.key(g.name, g.labels) === this.key(name, labels));
    if (existing) { existing.value = value; return; }
    this.gauges.push({ name, help, labels, value });
  }

  /**
   * Показатель, вычисляемый в момент снятия метрик.
   *
   * Так сделано число игроков онлайн: его не нужно обновлять на каждом входе,
   * достаточно спросить у сокета, когда пришёл запрос /metrics.
   */
  registerGaugeProvider(fn: () => { name: string; help: string; labels: Labels; value: number }): void {
    this.gaugeProviders.push(fn);
  }

  /** Сброс под счётчики процесса. Нужен тестам. */
  reset(): void {
    this.series = [];
    this.byKey = new Map();
    this.gauges = [];
    this.gaugeProviders = [];
    this.overflowed = 0;
    this.providerErrors = 0;
  }

  get combinationCount(): number { return this.series.length + this.gauges.length; }
  get droppedCombinations(): number { return this.overflowed; }
  get failedProviders(): number { return this.providerErrors; }

  render(): string {
    const lines: string[] = [];
    const declared = new Set<string>();

    const declare = (name: string, type: 'counter' | 'gauge' | 'summary', help: string): void => {
      if (declared.has(name)) return;
      declared.add(name);
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
    };

    declare('eos_up', 'gauge', 'Сервер отвечает: 1 - да');
    declare('eos_metrics_dropped_label_combinations_total', 'counter', 'Комбинаций подписей отброшено из-за потолка');
    declare('eos_metrics_provider_errors_total', 'counter', 'Показателей, которые не удалось вычислить');

    for (const s of this.series) {
      if (s.sum === 0) {
        declare(s.name, 'counter', s.help);
        lines.push(`${s.name}${labelText(s.labels)} ${s.count}`);
      } else {
        declare(s.name, 'summary', s.help);
        lines.push(`${s.name}_count${labelText(s.labels)} ${s.count}`);
        lines.push(`${s.name}_sum${labelText(s.labels)} ${s.sum}`);
      }
    }

    for (const g of this.gauges) {
      declare(g.name, 'gauge', g.help);
      lines.push(`${g.name}${labelText(g.labels)} ${g.value}`);
    }

    const providerNames = new Set<string>();
    for (const provider of this.gaugeProviders) {
      try {
        const g = provider();
        // Один и тот же показатель не печатается дважды: иначе в выводе
        // окажется две строки с одним именем, и Prometheus посчитает вторую
        // за отдельный ряд с тем же значением
        if (providerNames.has(g.name)) continue;
        providerNames.add(g.name);
        declare(g.name, 'gauge', g.help);
        lines.push(`${g.name}${labelText(g.labels)} ${g.value}`);
      } catch {
        // Показатель не должен ронять сам /metrics: иначе одно сломанное
        // значение остановит всю диагностику сервера ровно тогда, когда она
        // нужнее всего
        this.providerErrors++;
      }
    }

    lines.push(`eos_metrics_dropped_label_combinations_total ${this.overflowed}`);
    lines.push(`eos_metrics_provider_errors_total ${this.providerErrors}`);
    lines.push('eos_up 1');
    return `${lines.join('\n')}\n`;
  }
}

export const metrics = new MetricsRegistry();
