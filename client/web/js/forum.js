// ============================================================
// Форум — Empire of Safavids
// ============================================================
// Две вьюхи на одной странице: список тем (?category, ?q, ?page)
// и просмотр темы (?t=<id>). Чтение открыто всем, запись — только
// залогиненным (токен eos_token, общий с игрой и админкой).

import { applyLocale, detectLocale } from './i18n.js';
import { icon } from './icons.js';

// ── Вставка иконок: <span data-icon="sword" data-icon-size="20"> ──
for (const el of document.querySelectorAll('[data-icon]')) {
  const size = Number(el.dataset.iconSize) || 24;
  el.innerHTML = icon(el.dataset.icon, size);
}

// ── i18n ────────────────────────────────────────────────────
let dict = {};

function tx(path, fallback = '') {
  const value = path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), dict);
  return typeof value === 'string' ? value : fallback;
}

const LOCALE_TAGS = { ru: 'ru-RU', en: 'en-US', az: 'az-AZ' };
const STAFF_ROLES = ['owner', 'administrator', 'admin', 'moderator', 'developer', 'dev', 'gm'];

function fmtDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(LOCALE_TAGS[detectLocale()] ?? 'ru-RU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ── API ─────────────────────────────────────────────────────
const headers = () => {
  const h = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('eos_token');
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
};

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: headers() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

const $ = (id) => document.getElementById(id);

const els = {
  listSec: $('forum-list-sec'),
  topicSec: $('forum-topic-sec'),
  topics: $('fm-topics'),
  pager: $('fm-pager'),
  error: $('fm-error'),
  q: $('fm-q'),
  cat: $('fm-cat'),
  searchBtn: $('fm-search'),
  newToggle: $('fm-new-toggle'),
  newForm: $('fm-newform'),
  ncat: $('fm-ncat'),
  ntitle: $('fm-ntitle'),
  nbody: $('fm-nbody'),
  create: $('fm-create'),
  cancel: $('fm-cancel'),
  back: $('fm-back'),
  title: $('fm-topic-title'),
  badges: $('fm-topic-badges'),
  meta: $('fm-topic-meta'),
  actions: $('fm-topic-actions'),
  posts: $('fm-posts'),
  rbody: $('fm-rbody'),
  reply: $('fm-reply'),
  rerror: $('fm-rerror'),
  rstatus: $('fm-reply-status'),
  replyBlock: $('fm-reply-block'),
  auth: $('fm-auth'),
  adminLink: $('admin-link'),
};

const state = { category: '', q: '', page: 1 };
let me = null;
let categories = [];
let current = null; // { topic, posts }
let ready = false;  // первичная загрузка завершена

const isStaff = () => !!me && (me.isAdmin === true || STAFF_ROLES.includes(me.adminRole));
const isLogged = () => !!me;

function showError(el, message) {
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
}

/** Название раздела: принимает и категорию целиком, и объект name */
function localizedName(entry) {
  if (!entry) return '';
  const loc = detectLocale();
  const src = entry.name && typeof entry.name === 'object' ? entry.name : entry;
  return src[loc] || src.ru || src.en || entry.id || '';
}

// ── Аутентификация ──────────────────────────────────────────
async function loadMe() {
  if (!localStorage.getItem('eos_token')) return null;
  try {
    const { data } = await api('/api/auth/me');
    return data ?? null;
  } catch {
    return null;
  }
}

function renderAuth() {
  if (els.auth) {
    els.auth.textContent = me ? me.username : tx('auth.login', 'Войти');
  }
  if (els.newToggle) els.newToggle.hidden = false;
  if (els.adminLink) els.adminLink.classList.toggle('hidden', !isStaff());
}

// ── Список тем ──────────────────────────────────────────────
function badge(label, cls) {
  const span = document.createElement('span');
  span.className = `fm-badge ${cls}`;
  span.textContent = label;
  return span;
}

function topicRow(topic) {
  const li = document.createElement('li');
  li.className = 'rating-row fm-topic-row';

  const main = document.createElement('div');
  main.className = 'fm-topic-main';

  const top = document.createElement('div');
  top.className = 'fm-topic-top';

  const link = document.createElement('a');
  link.className = 'fm-topic-link';
  link.href = `?t=${topic.id}`;
  link.textContent = topic.title;
  link.addEventListener('click', (e) => {
    e.preventDefault();
    openTopic(topic.id);
  });
  top.appendChild(link);

  if (topic.pinned) top.appendChild(badge(tx('forum.pinned', 'Закреплена'), 'fm-badge-pin'));
  if (topic.locked) top.appendChild(badge(tx('forum.locked', 'Закрыта'), 'fm-badge-lock'));
  if (topic.solved) top.appendChild(badge(tx('forum.solved', 'Решено'), 'fm-badge-ok'));

  const sub = document.createElement('div');
  sub.className = 'fm-topic-sub';
  const cat = categories.find((c) => c.id === topic.categoryId);
  sub.textContent = [
    localizedName(cat) || topic.categoryId,
    topic.authorName,
    fmtDate(topic.lastPostAt || topic.createdAt),
    `${tx('forum.replies', 'Ответы')}: ${topic.replies}`,
    `${tx('forum.views', 'Просмотры')}: ${topic.views}`,
  ].filter(Boolean).join(' · ');

  main.appendChild(top);
  main.appendChild(sub);
  li.appendChild(main);
  return li;
}

function renderPager(total, page, pageSize) {
  els.pager.innerHTML = '';
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return;

  const make = (label, target, disabled) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost fm-page-btn';
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener('click', () => {
      state.page = target;
      loadTopics();
    });
    return btn;
  };

  els.pager.appendChild(make(`← ${tx('forum.prev', 'Назад')}`, page - 1, page <= 1));
  const info = document.createElement('span');
  info.className = 'fm-page-info';
  info.textContent = `${page} / ${pages}`;
  els.pager.appendChild(info);
  els.pager.appendChild(make(`${tx('forum.next', 'Вперёд')} →`, page + 1, page >= pages));
}

async function loadTopics() {
  showError(els.error, '');
  els.topics.innerHTML = '';
  const empty = document.createElement('li');
  empty.className = 'rating-empty';
  empty.textContent = '…';
  els.topics.appendChild(empty);

  try {
    const params = new URLSearchParams();
    if (state.category) params.set('category', state.category);
    if (state.q) params.set('q', state.q);
    params.set('page', String(state.page));
    const data = await api(`/api/forum/topics?${params.toString()}`);

    els.topics.innerHTML = '';
    if (!data.topics.length) {
      const li = document.createElement('li');
      li.className = 'rating-empty';
      li.textContent = tx(state.q ? 'forum.no_results' : 'forum.no_topics');
      els.topics.appendChild(li);
    } else {
      for (const topic of data.topics) els.topics.appendChild(topicRow(topic));
    }
    renderPager(data.total, data.page, data.pageSize);
  } catch (err) {
    els.topics.innerHTML = '';
    showError(els.error, err.message);
  }
}

function renderCategorySelects() {
  const fill = (select, withAll) => {
    const prev = select.value;
    select.innerHTML = '';
    if (withAll) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = tx('forum.all_categories', 'Все разделы');
      select.appendChild(opt);
    }
    for (const c of categories) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = localizedName(c);
      select.appendChild(opt);
    }
    select.value = prev && [...select.options].some((o) => o.value === prev) ? prev : '';
  };
  fill(els.cat, true);
  fill(els.ncat, false);
}

async function loadCategories() {
  try {
    const data = await api('/api/forum/categories');
    categories = data.categories ?? [];
  } catch {
    categories = [];
  }
  renderCategorySelects();
}

// ── Просмотр темы ───────────────────────────────────────────
function showList(push = true) {
  current = null;
  els.topicSec.classList.add('hidden');
  els.listSec.classList.remove('hidden');
  if (push) history.pushState({ t: '' }, '', location.pathname);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function postCard(post, topic) {
  const card = document.createElement('article');
  card.className = `fm-post${post.isBest ? ' fm-post-best' : ''}`;

  const head = document.createElement('header');
  head.className = 'fm-post-head';
  const author = document.createElement('span');
  author.className = 'fm-post-author';
  author.textContent = post.authorName;
  head.appendChild(author);
  if (post.isBest) head.appendChild(badge(tx('forum.solved', 'Решено'), 'fm-badge-ok'));
  const date = document.createElement('span');
  date.className = 'fm-post-date';
  date.textContent = fmtDate(post.createdAt);
  head.appendChild(date);

  const body = document.createElement('div');
  body.className = 'fm-post-body';
  body.textContent = post.body;

  card.appendChild(head);
  card.appendChild(body);

  // Действия: отметить решением / удалить
  // Отметить решение может автор темы или модератор — в том числе
  // свой собственный ответ. Частый сценарий: автор вопроса сам даёт
  // исчерпывающий ответ и помечает его как канонический. Сервер
  // (POST /topics/:id/solve) разрешает ровно то же самое.
  const canSolve = topic.categoryId === 'qa' && (topic.isAuthor || topic.canModerate);
  const canDelete = isLogged() && (post.authorId === me?.id || isStaff());
  if (canSolve || canDelete) {
    const acts = document.createElement('div');
    acts.className = 'fm-post-actions';
    if (canSolve) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost fm-mini-btn';
      btn.textContent = post.isBest
        ? tx('forum.unmark', 'Снять отметку')
        : tx('forum.mark_solved', 'Отметить решение');
      btn.addEventListener('click', () => solve(topic.id, post.isBest ? '' : post.id));
      acts.appendChild(btn);
    }
    if (canDelete) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost fm-mini-btn fm-danger';
      btn.textContent = tx('forum.delete', 'Удалить');
      btn.addEventListener('click', () => deletePost(post.id));
      acts.appendChild(btn);
    }
    card.appendChild(acts);
  }
  return card;
}

function renderTopicView() {
  const { topic, posts } = current;
  els.title.textContent = topic.title;

  els.badges.innerHTML = '';
  if (topic.pinned) els.badges.appendChild(badge(tx('forum.pinned', 'Закреплена'), 'fm-badge-pin'));
  if (topic.locked) els.badges.appendChild(badge(tx('forum.locked', 'Закрыта'), 'fm-badge-lock'));
  if (topic.solved) els.badges.appendChild(badge(tx('forum.solved', 'Решено'), 'fm-badge-ok'));

  const cat = categories.find((c) => c.id === topic.categoryId);
  els.meta.textContent = [
    localizedName(cat) || topic.categoryId,
    `${tx('forum.by', 'автор')}: ${topic.authorName}`,
    fmtDate(topic.createdAt),
    `${tx('forum.replies', 'Ответы')}: ${posts.length}`,
    `${tx('forum.views', 'Просмотры')}: ${topic.views}`,
  ].filter(Boolean).join(' · ');

  // Кнопки модерации
  els.actions.innerHTML = '';
  const staff = topic.canModerate || isStaff();
  const mine = topic.isAuthor || staff;
  const addAct = (label, handler, danger) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn-ghost fm-mini-btn${danger ? ' fm-danger' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', handler);
    els.actions.appendChild(btn);
  };
  if (staff) {
    addAct(topic.pinned ? tx('forum.unpin', 'Открепить') : tx('forum.pin', 'Закрепить'),
      () => moderate(topic.id, { pinned: !topic.pinned }));
    addAct(topic.locked ? tx('forum.unlock', 'Открыть тему') : tx('forum.lock', 'Закрыть тему'),
      () => moderate(topic.id, { locked: !topic.locked }));
    addAct(tx('forum.delete', 'Удалить'), () => removeTopic(topic.id), true);
  } else if (mine && topic.locked) {
    addAct(tx('forum.unlock', 'Открыть тему'), () => moderate(topic.id, { locked: false }));
  }

  // Ответы
  els.posts.innerHTML = '';
  if (!posts.length) {
    const p = document.createElement('p');
    p.className = 'rating-empty';
    p.textContent = tx('forum.no_posts', 'Ответов пока нет. Будь первым!');
    els.posts.appendChild(p);
  } else {
    for (const post of posts) els.posts.appendChild(postCard(post, topic));
  }

  // Форма ответа — только для залогиненных и только в открытой теме
  const canReply = !topic.locked || isStaff();
  els.replyBlock.classList.toggle('hidden', !(isLogged() && canReply));
  if (isLogged() && canReply) {
    showError(els.rerror, '');
    els.rbody.value = '';
    els.reply.disabled = false;
    els.reply.textContent = tx('forum.reply_send', 'Ответить');
  }
  renderAuth();
}

async function openTopic(id, push = true) {
  showError(els.error, '');
  try {
    const data = await api(`/api/forum/topics/${encodeURIComponent(id)}`);
    current = data;
    els.listSec.classList.add('hidden');
    els.topicSec.classList.remove('hidden');
    renderTopicView();
    if (push) history.pushState({ t: id }, '', `${location.pathname}?t=${encodeURIComponent(id)}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showError(els.error, err.message);
    showList(push);
  }
}

// ── Действия ────────────────────────────────────────────────
function requireLogin() {
  if (isLogged()) return true;
  showError(els.error, tx('forum.login_needed', 'Войдите в аккаунт, чтобы писать на форуме'));
  return false;
}

async function createTopic() {
  if (!requireLogin()) return;
  showError(els.error, '');
  try {
    const data = await api('/api/forum/topics', {
      method: 'POST',
      body: JSON.stringify({
        categoryId: els.ncat.value,
        title: els.ntitle.value,
        body: els.nbody.value,
      }),
    });
    els.ntitle.value = '';
    els.nbody.value = '';
    els.newForm.classList.add('hidden');
    if (data.id) openTopic(data.id);
    else loadTopics();
  } catch (err) {
    showError(els.error, err.message);
  }
}

async function createReply() {
  if (!requireLogin() || !current) return;
  showError(els.rerror, '');
  els.reply.disabled = true;
  try {
    await api(`/api/forum/topics/${current.topic.id}/posts`, {
      method: 'POST',
      body: JSON.stringify({ body: els.rbody.value }),
    });
    els.rbody.value = '';
    els.rstatus.textContent = tx('forum.reply_done', 'Ответ опубликован');
    els.rstatus.classList.remove('hidden');
    await openTopic(current.topic.id, false);
    setTimeout(() => els.rstatus.classList.add('hidden'), 2500);
  } catch (err) {
    showError(els.rerror, err.message);
  } finally {
    els.reply.disabled = false;
    els.reply.textContent = tx('forum.reply_send', 'Ответить');
  }
}

async function solve(topicId, postId) {
  if (!requireLogin()) return;
  try {
    await api(`/api/forum/topics/${topicId}/solve`, {
      method: 'POST',
      body: JSON.stringify({ postId }),
    });
    await openTopic(topicId, false);
  } catch (err) {
    showError(els.error, err.message);
  }
}

async function moderate(topicId, patch) {
  try {
    await api(`/api/forum/topics/${topicId}/moderate`, {
      method: 'POST',
      body: JSON.stringify(patch),
    });
    await openTopic(topicId, false);
  } catch (err) {
    showError(els.error, err.message);
  }
}

async function removeTopic(topicId) {
  if (!confirm(tx('forum.confirm_delete', 'Удалить тему?'))) return;
  try {
    await api(`/api/forum/topics/${topicId}`, { method: 'DELETE' });
    showList();
    await loadTopics();
  } catch (err) {
    showError(els.error, err.message);
  }
}

async function deletePost(postId) {
  if (!confirm(tx('forum.confirm_delete_post', 'Удалить ответ?'))) return;
  if (!current) return;
  try {
    await api(`/api/forum/posts/${postId}`, { method: 'DELETE' });
    await openTopic(current.topic.id, false);
  } catch (err) {
    showError(els.error, err.message);
  }
}

// ── Инициализация ───────────────────────────────────────────
function bindEvents() {
  els.searchBtn?.addEventListener('click', () => {
    state.q = els.q.value.trim();
    state.page = 1;
    loadTopics();
  });
  els.q?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      els.searchBtn.click();
    }
  });
  els.cat?.addEventListener('change', () => {
    state.category = els.cat.value;
    state.page = 1;
    loadTopics();
  });

  els.newToggle?.addEventListener('click', () => {
    if (!requireLogin()) return;
    els.newForm.classList.toggle('hidden');
    if (!els.newForm.classList.contains('hidden')) els.ntitle.focus();
  });
  els.create?.addEventListener('click', createTopic);
  els.cancel?.addEventListener('click', () => els.newForm.classList.add('hidden'));
  els.back?.addEventListener('click', () => showList());
  els.reply?.addEventListener('click', createReply);

  window.addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('t');
    if (id) openTopic(id, false);
    else showList(false);
  });

  // document, а не window: событие диспатчится на document без bubbles
  document.addEventListener('eos:locale', (e) => {
    dict = e.detail;
    renderAuth();
    if (!ready) return;
    renderCategorySelects();
    if (current) renderTopicView();
    else loadTopics();
  });

  for (const btn of document.querySelectorAll('.lang-btn')) {
    btn.addEventListener('click', () => applyLocale(btn.dataset.lang).catch(console.error));
  }
}

async function init() {
  bindEvents();
  dict = await applyLocale(detectLocale()).catch(() => ({}));
  me = await loadMe();

  await loadCategories();
  renderAuth();

  const id = new URLSearchParams(location.search).get('t');
  if (id) await openTopic(id, false);
  else await loadTopics();

  ready = true;
  if (isStaff() && els.adminLink) els.adminLink.classList.remove('hidden');
}

init().catch(console.error);
