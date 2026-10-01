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

/**
 * Секция «Особенности».
 *
 * ЧТО БЫЛО. Заголовок переводился во всех трёх языках, а под ним стоял пустой
 * div#features-grid: ни в этом файле, ни в CSS на него никто не обращался.
 * Игрок видел подпись «Что делает нас особенными» и пустоту.
 *
 * Карточки собираются из ключей site.*, которые уже были написаны и переведены
 * (guild_*, pvp_*, tower_*, house_* и прочие) — они лежали в словарях
 * без единого использования. Никакого нового маршрута: /api/features, на
 * который ссылался мёртвый api.features() в игровом клиенте, на сервере не
 * существует вовсе.
 */
// Иконки берутся из web/js/icons.js. Имена проверены по нему же: там нет
// `home`, который используется в игровом интерфейсе, — пришлось взять `chest`.
//
// Описания — новые ключи site.feat_*. Прежние site.* — это подписи кнопок и
// пустые состояния («Нет данных о репутации», «У вас нет дома»), и в карточке
// они читались бы как извинение за неработающую фичу.
const FEATURES = [
  { icon: 'user', titleKey: 'site.guild_title', descKey: 'site.feat_guild' },
  { icon: 'swords', titleKey: 'site.pvp_title', descKey: 'site.feat_pvp' },
  { icon: 'star8', titleKey: 'site.tower_title', descKey: 'site.feat_tower' },
  { icon: 'flag', titleKey: 'site.reputation_title', descKey: 'site.feat_reputation' },
  { icon: 'chest', titleKey: 'site.house_title', descKey: 'site.feat_house' },
  { icon: 'crown', titleKey: 'site.achievements_title', descKey: 'site.feat_achievements' },
];

/**
 * Ключ словаря по полному пути: 'site.feat_guild' -> dict.site.feat_guild.
 *
 * Зачем отдельная функция, а не dict.site[key]: в FEATURES лежат ПОЛНЫЕ пути
 * с префиксом группы. Обращение вида dict.site['site.feat_guild'] ищет ключ
 * с точкой внутри site и всегда даёт undefined — секция молча оставалась
 * пустой, хотя код выглядел правильно. Собственный разбор пути это исключает.
 */
function pick(dict, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), dict);
}

function renderFeatures(dict) {
  const grid = document.getElementById('features-grid');
  if (!grid) return;
  // Карточка без перевода бесполезна: пустая подпись хуже, чем её отсутствие
  const usable = FEATURES.filter(f => {
    const title = pick(dict, f.titleKey);
    return typeof title === 'string' && title.length > 0;
  });
  if (!usable.length) return;
  const frag = document.createDocumentFragment();
  for (const f of usable) {
    const card = document.createElement('article');
    card.className = 'feature-card';
    const fig = document.createElement('div');
    fig.className = 'feature-icon';
    fig.innerHTML = icon(f.icon, 24);
    const name = document.createElement('div');
    name.className = 'feature-name';
    name.textContent = pick(dict, f.titleKey);
    card.append(fig, name);
    const desc = pick(dict, f.descKey);
    if (typeof desc === 'string' && desc.length > 0) {
      const p = document.createElement('p');
      p.className = 'feature-desc';
      p.textContent = desc;
      card.append(p);
    }
    frag.append(card);
  }
  grid.replaceChildren(frag);
}

document.addEventListener('eos:locale', (e) => {
  renderTimeline(e.detail);
  renderClasses(e.detail);
  renderFeatures(e.detail);
});

// ── Переключатель языка ──────────────────────────────────────
for (const btn of document.querySelectorAll('.lang-btn')) {
  btn.addEventListener('click', () => applyLocale(btn.dataset.lang).catch(console.error));
}

// ── Статус серверов: живой онлайн ──────────────────────────
// ВАЖНО: словарь подгружаем ОДИН раз ДО цикла, карточки собираем
// в DocumentFragment и подменяем сетку одной операцией replaceChildren.
// Раньше await стоял между grid.innerHTML='' и grid.append(): параллельные
// вызовы (загрузка страницы + eos:locale + таймер) очищали ещё пустую
// сетку и дописывали карточки дважды — отсюда дубликаты.
async function renderStatus() {
  const grid = document.getElementById('status-grid');
  if (!grid) return;
  try {
    const [res, dict] = await Promise.all([
      fetch('/api/game/servers-status'),
      loadLocale(document.documentElement.lang || 'ru').catch(() => null),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { servers } = await res.json();
    const label = dict?.site?.status_online ?? '';
    const frag = document.createDocumentFragment();
    let total = 0;
    for (const s of servers ?? []) {
      const online = s.online ?? 0;
      total += online;
      const card = document.createElement('div');
      card.className = 'status-card' + (online > 0 ? ' online' : '');
      const dot = document.createElement('span');
      dot.className = 'status-dot';
      const name = document.createElement('span');
      name.className = 'status-name';
      name.textContent = s.nameRu ?? s.id;
      const count = document.createElement('span');
      count.className = 'status-count';
      count.textContent = `${online} ${label}`;
      card.append(dot, name, count);
      frag.append(card);
    }
    grid.replaceChildren(frag);
    grid.dataset.total = String(total);
  } catch {
    const off = document.createElement('div');
    off.className = 'status-offline';
    off.textContent = '…';
    grid.replaceChildren(off);
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
    // словарь подгружаем ДО очистки — иначе параллельный вызов
    // очистит уже заполненный список и добавит сообщение повторно
    const dict = await loadLocale(document.documentElement.lang || 'ru').catch(() => null);
    if (!entries?.length) {
      const li = document.createElement('li');
      li.className = 'rating-empty';
      li.textContent = dict?.site?.rating_empty ?? '';
      list.replaceChildren(li);
      return;
    }
    const frag = document.createDocumentFragment();
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
      frag.append(li);
    }
    list.replaceChildren(frag);
  } catch {
    list.replaceChildren();
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
    const bodyText = pickL10n(item.body, lang);
    p.textContent = bodyText;
    // Длинный текст -Wide. Анонс об расширении мира содержит список из
    // семи пунктов с эмодзи, и в общей сетке с колонками по 250px он
    // читался как узкая полоса. Решение принимает сам текст, а не
    // заголовок: важна длина текста, а не длина названия.
    if (bodyText.length > 320) card.classList.add('news-card--wide');
    card.append(h3, p);
    if (item.date) {
      const time = document.createElement('time');
      time.textContent = item.date;
      card.append(time);
    }
    // Ссылка внутри новости. Без неё объявление об обновлении было бы
    // строчкой текста, на которую нельзя перейти: на страницу с
    // подробностями, в игру или в раздел. Адрес приходит из CMS, поэтому
    // проверяем его - иначе в разметку попадёт что угодно, включая
    // javascript:.
    const href = typeof item.link === 'string' ? item.link.trim() : '';
    if (href && (href.startsWith('/') || href.startsWith('https://'))) {
      const a = document.createElement('a');
      a.className = 'btn btn-gold';
      a.href = href;
      a.textContent = pickL10n(item.linkText, lang) || '→';
      card.append(a);
    }
    grid.append(card);
  }
}

document.addEventListener('eos:locale', () => {
  renderSiteContent().catch(console.error);
});

renderSiteContent().catch(console.error);

// ── Галерея: снимки и ролики, залитые сотрудниками ───────────
// Файлы кладёт сотрудник через панель «Фото и видео» в игре и
// отмечает галочкой «Показывать на сайте». Здесь они просто выводятся.
//
// СЕКЦИЯ ПРЯЧЕТСЯ, ЕСЛИ ПУСТО. Иначе на главной висел бы заголовок
// «Галерея» и пустота — когда сотрудник ещё ничего не выложил, это
// выглядит как поломка сайта. То же самое при ошибке запроса: галерея
// не должна быть причиной, по которой главная страница выглядит сломанной.
async function renderGallery() {
  const section = document.getElementById('gallery');
  const grid = document.getElementById('gallery-grid');
  if (!section || !grid) return;
  let files;
  try {
    const res = await fetch('/api/media/gallery?limit=12', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ({ files } = await res.json());
  } catch {
    section.classList.add('hidden');
    return;
  }
  if (!Array.isArray(files) || !files.length) {
    section.classList.add('hidden');
    return;
  }

  const frag = document.createDocumentFragment();
  for (const f of files) {
    const card = document.createElement('a');
    card.className = 'gallery-card';
    card.href = f.url;
    card.target = '_blank';
    // Видео и картинки показываем по-разному, но ссылка одна и та же:
    // щёлчок открывает файл целиком в новой вкладке
    if (f.kind === 'video') {
      const v = document.createElement('video');
      v.src = f.url;
      v.muted = true;
      v.preload = 'metadata';
      v.playsInline = true;
      // На превью ролик не играет сам: на главной это плётка из
      // получаса трафика без спроса. Играет при наведении.
      card.addEventListener('mouseenter', () => { v.play().catch(() => {}); });
      card.addEventListener('mouseleave', () => { v.pause(); v.currentTime = 0; });
      card.append(v);
      card.classList.add('is-video');
    } else {
      const img = document.createElement('img');
      img.src = f.url;
      img.alt = f.caption || f.originalName || '';
      img.loading = 'lazy';
      card.append(img);
    }
    if (f.caption) {
      const cap = document.createElement('span');
      cap.className = 'gallery-caption';
      cap.textContent = f.caption;
      card.append(cap);
    }
    frag.append(card);
  }
  grid.replaceChildren(frag);
  section.classList.remove('hidden');
}

document.addEventListener('eos:locale', () => {
  renderGallery().catch(console.error);
});

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
renderGallery().catch(console.error);
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
