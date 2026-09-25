// ============================================================
// Админ-панель сайта — мониторинг и модерация
// ============================================================
// Токен общий с игрой (localStorage eos_token, тот же origin).
// Все запросы требуют прав администратора (adminCheck на сервере).

import { applyLocale, detectLocale } from './i18n.js';

// ── Локализация ─────────────────────────────────────────────
// Готовые надписи в разметке ([data-i18n]) переводит сам applyLocale.
// Здесь — то, что рисуется кодом: кнопки действий, карточки
// обращений, редактор новостей. Словарь приходит событием eos:locale.
let DICT = {};
let booted = false;

const tx = (path, fallback = '') => {
  const value = path.split('.').reduce((n, k) => (n == null ? undefined : n[k]), DICT);
  return typeof value === 'string' ? value : fallback;
};

for (const btn of document.querySelectorAll('.lang-btn')) {
  btn.addEventListener('click', () => applyLocale(btn.dataset.lang).catch(console.error));
}

document.addEventListener('eos:locale', (e) => {
  DICT = e.detail ?? {};
  retagCmsNews();                       // плейсхолдеры и кнопки редактора новостей
  if (!booted) return;                  // до входа данные ещё не грузили
  refreshOnline();                      // кнопки «Мут» / «Бан» / «ТП»
  loadFeedback();                       // карточки обращений
});

const headers = () => {
  const h = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('eos_token');
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
};

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: headers() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  return body;
}

const loginSec = document.getElementById('admin-login-sec');
const dash = document.getElementById('admin-dash');
const whoEl = document.getElementById('admin-who');
const logoutBtn = document.getElementById('admin-logout');
const errEl = document.getElementById('admin-error');

function showError(msg) {
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}

async function boot() {
  try {
    const { data } = await api('/api/auth/me');
    const staffRoles = ['owner', 'administrator', 'admin', 'moderator', 'developer', 'dev', 'gm'];
    if (!data?.isAdmin && !staffRoles.includes(data?.adminRole)) {
      throw new Error(tx('admin.rights_needed', 'Нужны права администратора или модератора'));
    }
    loginSec.classList.add('hidden');
    logoutBtn.hidden = false;
    whoEl.textContent = `${data.username} (${data.adminRole ?? 'admin'})`;
    // Мониторинг — только для is_admin; CMS доступен всему персоналу
    if (data?.isAdmin) {
      dash.classList.remove('hidden');
      await refreshAll();
      setInterval(refreshOnline, 15000);
    } else {
      dash.classList.add('hidden');
    }
    document.getElementById('admin-cms')?.classList.remove('hidden');
    await loadSiteContent();
    document.getElementById('admin-feedback')?.classList.remove('hidden');
    await loadFeedback();
    booted = true;
  } catch (e) {
    loginSec.classList.remove('hidden');
    dash.classList.add('hidden');
    if (localStorage.getItem('eos_token')) showError(e.message);
  }
}

document.getElementById('admin-login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  errEl.classList.add('hidden');
  const email = document.getElementById('admin-email').value.trim();
  const password = document.getElementById('admin-password').value;
  try {
    const { data } = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    localStorage.setItem('eos_token', data.token ?? data.jwtToken);
    await boot();
  } catch (err) {
    showError(err.message);
  }
});

logoutBtn?.addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  localStorage.removeItem('eos_token');
  location.reload();
});

async function refreshAll() {
  await Promise.all([refreshStats(), refreshOnline()]);
}

async function refreshStats() {
  const box = document.getElementById('admin-stats');
  try {
    const stats = await api('/api/admin/stats');
    box.innerHTML = '';
    for (const [k, v] of Object.entries(stats)) {
      if (v !== null && typeof v === 'object') continue;
      const card = document.createElement('div');
      card.className = 'status-card online';
      card.innerHTML = `<span class="status-name"></span><span class="status-count"></span>`;
      card.querySelector('.status-name').textContent = k;
      card.querySelector('.status-count').textContent = String(v);
      box.append(card);
    }
  } catch (e) {
    box.innerHTML = `<div class="status-offline">${e.message}</div>`;
  }
}

function playerRow(p) {
  const li = document.createElement('li');
  li.className = 'rating-row';
  const rank = document.createElement('span');
  rank.className = 'rating-rank';
  rank.textContent = `Lv.${p.level ?? '?'}`;
  const name = document.createElement('span');
  name.className = 'rating-name';
  name.textContent = `${p.name ?? p.characterId} · ${p.region ?? ''} · ${p.serverId ?? ''}`;
  const acts = document.createElement('span');
  acts.className = 'rating-value';
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rating-tab';
    b.textContent = label;
    b.addEventListener('click', () => fn(p).then(refreshOnline).catch((e) => alert(e.message)));
    return b;
  };
  const muteBtn = mk(tx('admin.act_mute', 'Мут'), async (pl) => {
    const minutes = Number(prompt(tx('admin.mute_minutes', 'Минут мута:'), '10') ?? 0);
    const reason = prompt(tx('admin.reason', 'Причина:'), tx('admin.reason_default', 'нарушение')) ?? '';
    await api('/api/admin/mute', { method: 'POST', body: JSON.stringify({ characterId: pl.characterId, durationMinutes: minutes, reason }) });
  });
  const banBtn = mk(tx('admin.act_ban', 'Бан'), async (pl) => {
    if (!confirm(tx('admin.ban_confirm', 'Забанить {name}?').replace('{name}', pl.name))) return;
    const reason = prompt(tx('admin.reason', 'Причина:'), tx('admin.reason_default', 'нарушение')) ?? '';
    await api(`/api/admin/ban`, { method: 'POST', body: JSON.stringify({ userId: pl.userId ?? pl.characterId, reason }) });
  });
  const tpBtn = mk(tx('admin.act_tp', 'ТП'), async (pl) => {
    const region = prompt(tx('admin.region_prompt', 'Регион (tabriz/isfahan/shiraz/...):'), pl.region ?? 'isfahan') ?? '';
    await api('/api/admin/teleport', { method: 'POST', body: JSON.stringify({ characterId: pl.characterId, region }) });
  });
  acts.append(muteBtn, banBtn, tpBtn);
  li.append(rank, name, acts);
  return li;
}

async function refreshOnline() {
  const list = document.getElementById('admin-online');
  try {
    const { players, total } = await api('/api/admin/online-players');
    document.getElementById('online-count').textContent = String(total ?? players?.length ?? 0);
    list.innerHTML = '';
    for (const p of players ?? []) list.append(playerRow(p));
  } catch (e) {
    list.innerHTML = `<li class="rating-empty">${e.message}</li>`;
  }
}

document.getElementById('admin-search-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = document.getElementById('admin-search-q').value.trim();
  const box = document.getElementById('admin-search-results');
  if (!q) return;
  try {
    const { results } = await api(`/api/admin/search?q=${encodeURIComponent(q)}`);
    box.innerHTML = '';
    const ol = document.createElement('ol');
    ol.className = 'rating-list';
    for (const r of results ?? []) {
      ol.append(playerRow({ characterId: r.id ?? r.character_id, name: r.name, level: r.level, region: r.region, serverId: '', userId: r.user_id ?? r.userId }));
    }
    box.append(ol);
  } catch (err) {
    box.textContent = err.message;
  }
});

// ============================================================
// Управление сайтом (CMS): анонс, режим обслуживания, новости
// ============================================================
// Данные хранятся в таблице site_content (миграция 024) и читаются
// лендингом через GET /api/site/content. Здесь — редактор на все
// три языка: переключатель языка меняет только то, что видно.

let siteContent = {};
let cmsLang = 'ru';

const cmsStatus = document.getElementById('cms-status');
const annEnabled = document.getElementById('ann-enabled');
const annText = document.getElementById('ann-text');
const mntEnabled = document.getElementById('mnt-enabled');
const mntText = document.getElementById('mnt-text');

function cmsNote(msg, isError = false) {
  if (!cmsStatus) return;
  cmsStatus.textContent = msg;
  cmsStatus.classList.toggle('error', isError);
  if (msg) setTimeout(() => { if (cmsStatus.textContent === msg) cmsStatus.textContent = ''; }, 4000);
}

async function loadSiteContent() {
  try {
    const res = await api('/api/site/content');
    siteContent = res.content ?? {};
  } catch (e) {
    cmsNote(e.message, true);
    return;
  }
  if (!siteContent.news) siteContent.news = { items: [] };
  if (!Array.isArray(siteContent.news.items)) siteContent.news.items = [];
  renderNewsEditor();
  fillCmsForm();
}

function fillCmsForm() {
  const ann = siteContent.announcement ?? {};
  if (annEnabled) annEnabled.checked = !!ann.enabled;
  if (annText) annText.value = ann.text?.[cmsLang] ?? '';
  const mnt = siteContent.maintenance ?? {};
  if (mntEnabled) mntEnabled.checked = !!mnt.enabled;
  if (mntText) mntText.value = mnt.text?.[cmsLang] ?? '';
  fillNews();
}

/** Собрать из DOM текущий язык новостей в siteContent */
function collectNews() {
  const items = siteContent.news?.items ?? [];
  document.querySelectorAll('#cms-news .cms-news-title').forEach((el) => {
    const it = items[Number(el.dataset.i)];
    if (!it) return;
    it.title = it.title ?? {};
    it.title[cmsLang] = el.value;
  });
  document.querySelectorAll('#cms-news .cms-news-body').forEach((el) => {
    const it = items[Number(el.dataset.i)];
    if (!it) return;
    it.body = it.body ?? {};
    it.body[cmsLang] = el.value;
  });
}

function fillNews() {
  const items = siteContent.news?.items ?? [];
  document.querySelectorAll('#cms-news .cms-news-title').forEach((el) => {
    el.value = items[Number(el.dataset.i)]?.title?.[cmsLang] ?? '';
  });
  document.querySelectorAll('#cms-news .cms-news-body').forEach((el) => {
    el.value = items[Number(el.dataset.i)]?.body?.[cmsLang] ?? '';
  });
}

function renderNewsEditor() {
  const box = document.getElementById('cms-news');
  if (!box) return;
  box.innerHTML = '';
  const items = siteContent.news?.items ?? [];

  items.forEach((_, i) => {
    const row = document.createElement('div');
    row.className = 'cms-news-item';
    row.innerHTML =
      '<input type="text" class="cms-input cms-news-title" data-i="' + i + '" maxlength="120">' +
      '<textarea class="cms-input cms-news-body" data-i="' + i + '" rows="3" maxlength="900"></textarea>' +
      '<button type="button" class="btn btn-ghost cms-news-del" data-i="' + i + '"></button>';
    box.append(row);
  });

  box.querySelectorAll('.cms-news-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      collectNews();
      siteContent.news.items.splice(Number(btn.dataset.i), 1);
      renderNewsEditor();
      fillNews();
    });
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-ghost';
  add.id = 'cms-news-add';
  add.addEventListener('click', () => {
    collectNews();
    siteContent.news.items.push({ title: { ru: '', en: '', az: '' }, body: { ru: '', en: '', az: '' }, date: '' });
    renderNewsEditor();
    fillNews();
  });
  box.append(add);
  retagCmsNews();               // подписи и плейсхолдеры на текущем языке
}

/**
 * Язык редактора новостей — прямо по DOM, без перерисовки.
 * renderNewsEditor() здесь нельзя вызывать: он стёр бы то, что
 * пользователь уже написал в поля.
 */
function retagCmsNews() {
  const title = tx('admin.news_ph_title', 'Заголовок');
  const body = tx('admin.news_ph_body', 'Текст');
  const del = tx('admin.news_del', 'Удалить');
  document.querySelectorAll('#cms-news .cms-news-title').forEach((el) => { el.placeholder = title; });
  document.querySelectorAll('#cms-news .cms-news-body').forEach((el) => { el.placeholder = body; });
  document.querySelectorAll('#cms-news .cms-news-del').forEach((el) => { el.textContent = del; });
  const add = document.getElementById('cms-news-add');
  if (add) add.textContent = tx('admin.news_add', '+ Добавить новость');
}

document.getElementById('cms-lang')?.addEventListener('change', (e) => {
  collectNews();               // не терять введённое для прежнего языка
  cmsLang = e.target.value;
  fillCmsForm();
});

document.getElementById('cms-reload')?.addEventListener('click', () => loadSiteContent());

document.getElementById('cms-save')?.addEventListener('click', async () => {
  collectNews();
  siteContent.announcement = {
    enabled: !!annEnabled?.checked,
    text: { ...(siteContent.announcement?.text ?? {}), [cmsLang]: annText?.value ?? '' },
  };
  siteContent.maintenance = {
    enabled: !!mntEnabled?.checked,
    text: { ...(siteContent.maintenance?.text ?? {}), [cmsLang]: mntText?.value ?? '' },
  };
  try {
    await api('/api/site/content/announcement', { method: 'PUT', body: JSON.stringify({ value: siteContent.announcement }) });
    await api('/api/site/content/maintenance', { method: 'PUT', body: JSON.stringify({ value: siteContent.maintenance }) });
    await api('/api/site/content/news', { method: 'PUT', body: JSON.stringify({ value: siteContent.news }) });
    cmsNote(tx('admin.cms_saved', 'Сохранено ✓'));
  } catch (e) {
    cmsNote(e.message, true);
  }
});


// ============================================================
// Очередь обратной связи (см. /feedback.html)
// ============================================================
const fbQueue = document.getElementById('fb-queue');
const fbQueueErr = document.getElementById('fb-queue-error');
let fbStatus = '';

// Категории и статусы общие с /feedback.html — берём те же ключи
// feedback.cat_* / feedback.status_*, чтобы админка и игрок видели
// одинаковые слова, а не два разных перевода.
const fbLabel = (cat) => tx(`feedback.cat_${cat}`, cat);
const fbStatusText = (st) => tx(`feedback.status_${st}`, st);

function fbNote(msg) {
  if (!fbQueueErr) return;
  fbQueueErr.textContent = msg ?? '';
  fbQueueErr.classList.toggle('hidden', !msg);
}

function fbDate(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const lang = document.documentElement.lang || 'ru';
  const locale = { ru: 'ru-RU', en: 'en-GB', az: 'az-AZ' }[lang] ?? 'ru-RU';
  return d.toLocaleString(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fbCard(item) {
  const card = document.createElement('div');
  card.className = 'cms-news-item fb-card';

  const head = document.createElement('div');
  head.className = 'fb-item-head';
  const author = document.createElement('strong');
  author.textContent = `${item.authorName} · ${fbLabel(item.category)}`;
  const meta = document.createElement('span');
  meta.className = 'fb-item-date';
  meta.textContent = fbDate(item.createdAt);
  head.append(author, meta);

  const body = document.createElement('div');
  body.className = 'fb-item-body';
  body.textContent = item.message;

  const foot = document.createElement('div');
  foot.className = 'fb-card-foot';
  const st = document.createElement('span');
  st.className = `fb-status fb-${item.status}`;
  st.textContent = fbStatusText(item.status);
  foot.append(st);

  const statusBtns = [
    ['new', tx('admin.fb_to_new', 'В новое')],
    ['read', tx('feedback.status_read', 'Прочитано')],
    ['closed', tx('admin.fb_to_close', 'Закрыть')],
  ];
  for (const [value, label] of statusBtns) {
    if (value === item.status) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-ghost fm-mini-btn';
    b.textContent = label;
    b.addEventListener('click', () => setFbStatus(item.id, value));
    foot.append(b);
  }

  card.append(head, body);

  // Что уже отправлено игроку
  if (item.reply) {
    const rep = document.createElement('div');
    rep.className = 'fb-reply';
    const repHead = document.createElement('div');
    repHead.className = 'fb-reply-head';
    repHead.textContent = tx('admin.fb_reply_sent', 'Ответ отправлен');
    const repDate = document.createElement('span');
    repDate.className = 'fb-item-date';
    repDate.textContent = fbDate(item.repliedAt);
    repHead.appendChild(repDate);
    const repBody = document.createElement('div');
    repBody.className = 'fb-reply-body';
    repBody.textContent = item.reply;
    rep.append(repHead, repBody);
    card.appendChild(rep);
  }

  card.appendChild(fbReplyForm(item));
  card.appendChild(foot);
  return card;
}

/**
 * Ответ игроку. Раньше форма обещала «ответим», а статус «Закрыто»
 * приходил без единого слова — теперь ответ виден в «Мои обращения».
 */
function fbReplyForm(item) {
  const wrap = document.createElement('div');
  wrap.className = 'fb-reply-form';

  const ta = document.createElement('textarea');
  ta.className = 'cms-input';
  ta.rows = 3;
  ta.maxLength = 2000;
  ta.placeholder = tx('admin.fb_reply_ph', 'Ответ игроку…');

  const actions = document.createElement('div');
  actions.className = 'fb-reply-actions';

  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'btn btn-gold fm-mini-btn';
  send.textContent = item.reply
    ? tx('admin.fb_save_reply', 'Сохранить ответ')
    : tx('admin.fb_close_reply', 'Ответить и закрыть');
  send.disabled = true;
  ta.addEventListener('input', () => { send.disabled = !ta.value.trim(); });
  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      await api(`/api/feedback/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ reply: ta.value.trim(), status: 'closed' }),
      });
      await loadFeedback();
    } catch (e) {
      fbNote(e.message);
      send.disabled = false;
    }
  });
  actions.appendChild(send);

  if (item.reply) {
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'btn btn-ghost fm-mini-btn';
    drop.textContent = tx('admin.fb_drop_reply', 'Убрать ответ');
    drop.addEventListener('click', async () => {
      try {
        await api(`/api/feedback/${item.id}`, { method: 'PATCH', body: JSON.stringify({ reply: '' }) });
        await loadFeedback();
      } catch (e) {
        fbNote(e.message);
      }
    });
    actions.appendChild(drop);
  }

  wrap.append(ta, actions);
  return wrap;
}

async function setFbStatus(id, status) {
  try {
    await api(`/api/feedback/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await loadFeedback();
  } catch (e) {
    fbNote(e.message);
  }
}

async function loadFeedback() {
  if (!fbQueue) return;
  fbNote('');
  fbQueue.innerHTML = '<p class="rating-empty">…</p>';
  try {
    const data = await api(`/api/feedback${fbStatus ? `?status=${fbStatus}` : ''}`);
    const counts = data.counts ?? {};
    const total = Object.values(counts).reduce((a, b) => a + Number(b), 0);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
    set('fb-c-all', total);
    set('fb-c-new', counts.new ?? 0);
    set('fb-c-read', counts.read ?? 0);
    set('fb-c-closed', counts.closed ?? 0);

    fbQueue.innerHTML = '';
    if (!data.items?.length) {
      fbQueue.innerHTML = `<p class="rating-empty">${tx('admin.fb_empty', 'Обращений нет')}</p>`;
      return;
    }
    for (const item of data.items) fbQueue.append(fbCard(item));
  } catch (e) {
    fbQueue.innerHTML = '';
    fbNote(e.message);
  }
}

document.querySelectorAll('.fb-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.fb-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    fbStatus = tab.dataset.status ?? '';
    loadFeedback();
  });
});
document.getElementById('fb-reload')?.addEventListener('click', loadFeedback);

// Язык: сохранённый выбор → язык браузера → русский. applyLocale
// переведёт разметку [data-i18n] и событием eos:locale отдаст словарь
// сюда — уже на готовом DOM. Поэтому boot() ждём его завершения.
applyLocale(detectLocale()).catch(() => {}).finally(() => { void boot(); });
