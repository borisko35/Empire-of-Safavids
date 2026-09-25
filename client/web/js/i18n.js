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
    if (typeof value !== 'string') continue;
    // Элемент может содержать вложенные узлы (метка с <select>/<textarea>):
    // заменяем только текстовые узлы, детей не трогаем.
    const kids = [...el.childNodes];
    const withText = kids.filter((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
    if (!withText.length) {
      if (kids.length) el.insertBefore(document.createTextNode(value), el.firstChild);
      else el.textContent = value;
      continue;
    }
    withText[0].textContent = value;
    for (const extra of withText.slice(1)) extra.textContent = '';
  }

  // Подсказки в полях ввода и всплывающие подсказки
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    const value = resolve(dict, el.dataset.i18nPlaceholder);
    if (typeof value === 'string') el.setAttribute('placeholder', value);
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    const value = resolve(dict, el.dataset.i18nTitle);
    if (typeof value === 'string') el.setAttribute('title', value);
  }
  for (const el of document.querySelectorAll('[data-i18n-aria]')) {
    const value = resolve(dict, el.dataset.i18nAria);
    if (typeof value === 'string') el.setAttribute('aria-label', value);
  }
  for (const el of document.querySelectorAll('[data-i18n-alt]')) {
    const value = resolve(dict, el.dataset.i18nAlt);
    if (typeof value === 'string') el.setAttribute('alt', value);
  }
  // SEO-описание страницы. Важно: боты соцсетей (Discord, Telegram,
  // Facebook) JS не выполняют и видят исходный текст из HTML —
  // так что русская версия в разметке остаётся опорной.
  for (const el of document.querySelectorAll('[data-i18n-content]')) {
    const value = resolve(dict, el.dataset.i18nContent);
    if (typeof value === 'string') el.setAttribute('content', value);
  }

  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === code);
  });

  document.dispatchEvent(new CustomEvent('eos:locale', { detail: dict }));
  return dict;
}
