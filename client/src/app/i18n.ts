// ============================================================
// Локализация игрового клиента — Empire of Safavids
// ============================================================
// Те же словари, что у лендинга и сервера: /locales/<code>.json

export type Dict = Record<string, unknown>;

let current: Dict = {};

export function t(path: string): string {
  const value = path
    .split('.')
    .reduce<unknown>((node, key) => (node == null ? undefined : (node as Dict)[key]), current);
  return typeof value === 'string' ? value : path;
}

export function dict(): Dict {
  return current;
}

/**
 * Перевод с откатом на серверное значение.
 *
 * ЗАЧЕМ, А НЕ ПРОСТО t(). t() на отсутствующем ключе возвращает сам путь —
 * то есть игрок вместо названия получил бы «items.mat_dragon_scale». Для
 * интерфейса это терпимо: все строки описания переведены и разойтись не
 * могут, и видна будет поломка. Для предметов нетерпимо: половина словаря
 * ещё не переведена, и «items.mat_iron_ore» в сумке хуже, чем русское
 * название из данных.
 *
 * ПОЧЕМУ ОТКАТ, А НЕ ПУСТАЯ СТРОКА. Пустой заголовок у предмета читается
 * как «у него нет названия», и игрок решит, что это сломанная выдача.
 * Русское название из данных — тоже язык, но хотя бы осмысленный.
 *
 * Пустое значение словаря считается отсутствующим намеренно: строка
 * `items.wpn_shah_blade: ""` — это не «перевод на все языки», а забытое
 * место, и показывать игроку пустоту хуже, чем показывать по-русски.
 */
export function tOr(path: string, fallback: string): string {
  const value = path
    .split('.')
    .reduce<unknown>((node, key) => (node == null ? undefined : (node as Dict)[key]), current);
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

/**
 * Ключ перевода предмета, если он не совпадает с идентификатором.
 *
 * Две пары предметов называются в словаре иначе, чем в данных, и без этой
 * таблицы они выпадали бы из перевода: в сумке показывалось бы русское
 * имя из nameRu, а в магазине — переведённое. Один предмет двумя именами
 * в двух соседних окнах выглядит как поломка.
 *
 * Здесь только настоящие переименования. Остальные предметы совпадают с
 * ключом, и для них таблица не нужна: иначе каждое новое название
 * приходилось бы вносить в два места.
 */
const ПСЕВДОНИМЫ: Record<string, string> = {
  // В данных называется acc_boots_silk, в словаре — с хвостом _road.
  acc_boots_silk: 'acc_boots_silk_road',
  // В данных acc_cloim_rain — с опечаткой в самом идентификаторе;
  // переименовывать идентификатор поздно, он уже в выдаче и базе.
  acc_cloim_rain: 'acc_cloak_monsoon',
};

/**
 * Название предмета на языке интерфейса.
 *
 * ЕДИНОЕ МЕСТО РАЗРЕШЕНИЯ ИМЁН. Почему оно нужно: до этого имя предмета
 * находилось тремя способами — в сумке через nameRu из данных, в магазине
 * через таблицу соответствий, в тостах через t('items.…'). Три места
 * разошлись, и игрок видел один предмет двумя именами в соседних окнах.
 *
 * fallback обязателен и приходит с сервера: переведены пока единицы
 * предметов из 79, и без отката остальные показывались бы как
 * «items.mat_iron_ore» — или как голый идентификатор, что хуже.
 */
export function имяПредмета(itemId: string, fallback: string): string {
  return tOr(`items.${ПСЕВДОНИМЫ[itemId] ?? itemId}`, fallback);
}

export function detectLocale(): string {
  const saved = localStorage.getItem('eos.locale');
  if (['ru', 'en', 'az'].includes(saved ?? '')) return saved!;
  const nav = (navigator.language || '').slice(0, 2).toLowerCase();
  return ['ru', 'en', 'az'].includes(nav) ? nav : 'ru';
}

export async function loadLocale(code: string): Promise<Dict> {
  const res = await fetch(`/locales/${code}.json`);
  if (!res.ok) throw new Error(`locale ${code}: HTTP ${res.status}`);
  current = (await res.json()) as Dict;
  document.documentElement.lang = code;
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n!);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    (el as HTMLInputElement).placeholder = t(el.dataset.i18nPlaceholder!);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle!);
  }
  return current;
}
