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
