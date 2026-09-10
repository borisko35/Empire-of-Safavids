// ============================================================
// Локализация веб-страницы — Empire of Safavids
// ============================================================
// Источник текстов — shared/locales/{ru,en,az}.json (те же файлы,
// что использует игра); сервер раздаёт их по /locales/<code>.json.

const cache = new Map();

export async function loadLocale(code) {
  if (!cache.has(code)) {
    const res = await fetch(`/locales/${code}.json`);
    if (!res.ok) throw new Error(`locale ${code}: HTTP ${res.status}`);
    cache.set(code, res.json());
  }
  return cache.get(code);
}

/** Сохранённый выбор → язык браузера → русский (DEFAULT_LOCALE) */
export function detectLocale() {
  const saved = localStorage.getItem('eos.locale');
  if (['ru', 'en', 'az'].includes(saved)) return saved;
  const nav = (navigator.language || '').slice(0, 2).toLowerCase();
  return ['ru', 'en', 'az'].includes(nav) ? nav : 'ru';
}

function resolve(dict, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), dict);
}

/** Применяет словарь к [data-i18n] и уведомляет страницу событием eos:locale */
export async function applyLocale(code) {
  const dict = await loadLocale(code);
  localStorage.setItem('eos.locale', code);
  document.documentElement.lang = code;

  for (const el of document.querySelectorAll('[data-i18n]')) {
    const value = resolve(dict, el.dataset.i18n);
    if (typeof value === 'string') el.textContent = value;
  }

  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === code);
  });

  document.dispatchEvent(new CustomEvent('eos:locale', { detail: dict }));
  return dict;
}
