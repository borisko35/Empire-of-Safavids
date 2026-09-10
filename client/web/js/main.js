// ============================================================
// Логика веб-страницы — Empire of Safavids
// ============================================================
// Иконки (система иконок), таймлайн истории Сефевидов, карточки
// классов, переключатель языка, индикатор версии сервера.

import { icon, CLASS_ICONS, CLASS_COLORS } from './icons.js';
import { applyLocale, detectLocale } from './i18n.js';

// ── Вставка иконок: <span data-icon="sword" data-icon-size="20"> ──
for (const el of document.querySelectorAll('[data-icon]')) {
  const size = Number(el.dataset.iconSize) || 24;
  el.innerHTML = icon(el.dataset.icon, size);
}

// ── Таймлайн: события из history_events локали ───────────────
function renderTimeline(dict) {
  const list = document.getElementById('timeline');
  if (!list || !Array.isArray(dict.history_events)) return;
  list.innerHTML = '';
  for (const ev of dict.history_events) {
    const li = document.createElement('li');
    const year = document.createElement('span');
    year.className = 'event-year';
    year.textContent = ev.year;
    const title = document.createElement('div');
    title.className = 'event-title';
    title.textContent = ev.title;
    const text = document.createElement('p');
    text.className = 'event-text';
    text.textContent = ev.text;
    li.append(year, title, text);
    list.append(li);
  }
}

// ── Карточки классов: витрина системы иконок и цветов ────────
function renderClasses(dict) {
  const grid = document.getElementById('class-grid');
  if (!grid || !dict.classes) return;
  grid.innerHTML = '';
  for (const [id, iconName] of Object.entries(CLASS_ICONS)) {
    const color = CLASS_COLORS[id] ?? 'var(--gold)';
    const card = document.createElement('article');
    card.className = 'class-card';
    card.style.setProperty('--class-color', color);
    const fig = document.createElement('div');
    fig.className = 'class-icon';
    fig.innerHTML = icon(iconName, 30);
    const name = document.createElement('div');
    name.className = 'class-name';
    name.textContent = dict.classes[id] ?? id;
    const desc = document.createElement('p');
    desc.className = 'class-desc';
    desc.textContent = dict.classes[`${id}_desc`] ?? '';
    card.append(fig, name, desc);
    grid.append(card);
  }
}

// ── Шаги установщика в секции скачивания ─────────────────────
function renderSteps(dict) {
  const list = document.getElementById('download-steps');
  if (!list || !Array.isArray(dict.site?.download_steps)) return;
  list.innerHTML = '';
  for (const step of dict.site.download_steps) {
    const li = document.createElement('li');
    li.textContent = step;
    list.append(li);
  }
}

document.addEventListener('eos:locale', (e) => {
  renderTimeline(e.detail);
  renderClasses(e.detail);
  renderSteps(e.detail);
});

// ── Переключатель языка ──────────────────────────────────────
for (const btn of document.querySelectorAll('.lang-btn')) {
  btn.addEventListener('click', () => applyLocale(btn.dataset.lang).catch(console.error));
}

// ── Версия сервера (индикатор доступности) ───────────────────
const versionNum = document.getElementById('version-num');
const versionBadge = document.getElementById('version-badge');
fetch('/health')
  .then((r) => r.json())
  .then((h) => { versionNum.textContent = h.version ?? '?'; })
  .catch(() => {
    versionNum.textContent = 'offline';
    versionBadge.classList.add('offline');
  });

applyLocale(detectLocale()).catch(console.error);
