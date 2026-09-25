// ============================================================
// Логика веб-страницы — Empire of Safavids
// ============================================================
// Иконки (система иконок), таймлайн истории Сефевидов, карточки
// классов, переключатель языка, индикатор версии сервера.

import { icon, CLASS_ICONS, CLASS_COLORS } from './icons.js';
import { applyLocale, detectLocale, loadLocale } from './i18n.js';

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

// ── Статус серверов: живой онлайн ──────────────────────────
async function renderStatus() {
  const grid = document.getElementById('status-grid');
  if (!grid) return;
  try {
    const res = await fetch('/api/game/servers-status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { servers } = await res.json();
    grid.innerHTML = '';
    let total = 0;
    for (const s of servers ?? []) {
      total += s.online ?? 0;
      const card = document.createElement('div');
      card.className = 'status-card' + ((s.online ?? 0) > 0 ? ' online' : '');
      const dot = document.createElement('span');
      dot.className = 'status-dot';
      const name = document.createElement('span');
      name.className = 'status-name';
      name.textContent = s.nameRu ?? s.id;
      const count = document.createElement('span');
      count.className = 'status-count';
      const dict = await loadLocale(document.documentElement.lang || 'ru').catch(() => null);
      count.textContent = `${s.online ?? 0} ${dict?.site?.status_online ?? ''}`;
      card.append(dot, name, count);
      grid.append(card);
    }
    grid.dataset.total = String(total);
  } catch {
    grid.innerHTML = '';
    const off = document.createElement('div');
    off.className = 'status-offline';
    off.textContent = '…';
    grid.append(off);
  }
}

// ── Рейтинг: топ-10 с вкладками ─────────────────────────────
let ratingType = 'level';
async function renderRating() {
  const list = document.getElementById('rating-list');
  if (!list) return;
  try {
    const res = await fetch(`/api/leaderboard/top/${ratingType}?limit=10`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { entries } = await res.json();
    list.innerHTML = '';
    if (!entries?.length) {
      const li = document.createElement('li');
      li.className = 'rating-empty';
      const dict = await loadLocale(document.documentElement.lang || 'ru').catch(() => null);
      li.textContent = dict?.site?.rating_empty ?? '';
      list.append(li);
      return;
    }
    for (const e of entries) {
      const li = document.createElement('li');
      li.className = 'rating-row' + (e.rank <= 3 ? ` top${e.rank}` : '');
      const rank = document.createElement('span');
      rank.className = 'rating-rank';
      rank.textContent = String(e.rank);
      const name = document.createElement('span');
      name.className = 'rating-name';
      name.textContent = e.characterName ?? e.characterId;
      const value = document.createElement('span');
      value.className = 'rating-value';
      value.textContent = `${e.className ?? ''} · Lv.${e.level ?? '?'} · ${e.value ?? 0}`;
      li.append(rank, name, value);
      list.append(li);
    }
  } catch {
    list.innerHTML = '';
  }
}

for (const tab of document.querySelectorAll('.rating-tab')) {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.rating-tab').forEach((b) => b.classList.remove('active'));
    tab.classList.add('active');
    ratingType = tab.dataset.type ?? 'level';
    renderRating().catch(console.error);
  });
}

document.addEventListener('eos:locale', () => {
  renderStatus().catch(console.error);
});

// ── Контент из CMS: обслуживание, анонс, новости ────────────
// Отредактировать можно в /admin.html → «Управление сайтом»
// (доступно разработчикам, админам и модераторам).
function pickL10n(value, lang) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value[lang] || value.ru || Object.values(value)[0] || '';
}

async function renderSiteContent() {
  let data;
  try {
    const res = await fetch('/api/site/content');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    return; // без CMS страница живёт на статической разметке
  }
  const lang = document.documentElement.lang || 'ru';
  const content = data.content ?? {};

  // Режим обслуживания
  const maint = document.getElementById('site-maintenance');
  if (maint) {
    const m = content.maintenance;
    const text = m?.enabled ? pickL10n(m.text, lang) : '';
    maint.textContent = text;
    maint.classList.toggle('hidden', !text);
  }

  // Анонс / баннер
  const ann = document.getElementById('site-announcement');
  if (ann) {
    const a = content.announcement;
    const text = a?.enabled ? pickL10n(a.text, lang) : '';
    ann.textContent = text;
    ann.classList.toggle('hidden', !text);
  }

  // Новости
  const grid = document.querySelector('.news-grid');
  const items = content.news?.items;
  if (!grid || !Array.isArray(items) || !items.length) return;
  grid.innerHTML = '';
  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'news-card';
    const h3 = document.createElement('h3');
    h3.textContent = pickL10n(item.title, lang);
    const p = document.createElement('p');
    p.textContent = pickL10n(item.body, lang);
    card.append(h3, p);
    if (item.date) {
      const time = document.createElement('time');
      time.textContent = item.date;
      card.append(time);
    }
    grid.append(card);
  }
}

document.addEventListener('eos:locale', () => {
  renderSiteContent().catch(console.error);
});

renderSiteContent().catch(console.error);

// ── Ссылка «Управление сайтом» — только для персонала ──────
async function revealAdminLink() {
  const link = document.getElementById('admin-link');
  if (!link) return;
  const token = localStorage.getItem('eos_token');
  if (!token) return;
  try {
    const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const { data } = await res.json();
    const roles = ['owner', 'administrator', 'admin', 'moderator', 'developer', 'dev', 'gm'];
    if (data?.isAdmin || roles.includes(data?.adminRole)) link.classList.remove('hidden');
  } catch { /* гость — ссылка не показывается */ }
}

renderStatus().catch(console.error);
renderRating().catch(console.error);
revealAdminLink();
setInterval(() => { renderStatus().catch(console.error); }, 60000);
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
