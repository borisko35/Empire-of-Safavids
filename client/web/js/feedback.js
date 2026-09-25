// ============================================================
// Обратная связь — Empire of Safavids
// ============================================================
// Форма на /feedback.html; очередь обращений видна в /admin.html.

import { applyLocale, detectLocale } from './i18n.js';
import { icon } from './icons.js';

// ── Вставка иконок: <span data-icon="scroll" data-icon-size="20"> ──
for (const el of document.querySelectorAll('[data-icon]')) {
  const size = Number(el.dataset.iconSize) || 24;
  el.innerHTML = icon(el.dataset.icon, size);
}

let dict = {};
let me = null;

function tx(path, fallback = '') {
  const value = path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), dict);
  return typeof value === 'string' ? value : fallback;
}

const LOCALE_TAGS = { ru: 'ru-RU', en: 'en-US', az: 'az-AZ' };
const STAFF_ROLES = ['owner', 'administrator', 'admin', 'moderator', 'developer', 'dev', 'gm'];
const STATUS_KEYS = { new: 'status_new', read: 'status_read', closed: 'status_closed' };
const STATUS_CLS = { new: 'fb-new', read: 'fb-read', closed: 'fb-closed' };

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
  form: $('fb-form'),
  category: $('fb-category'),
  message: $('fb-message'),
  hint: $('fb-hint'),
  counter: $('fb-counter'),
  error: $('fb-error'),
  ok: $('fb-ok'),
  mineBlock: $('fb-mine-block'),
  mine: $('fb-mine'),
  auth: $('fb-auth'),
  adminLink: $('admin-link'),
};

const MESSAGE_MAX = 2000;

/**
 * Подсказка «что стоит указать» меняется вместе с категорией:
 * баг-репорту нужны обстоятельства, вопросу про донат — номер заказа.
 * Без этого игрок пишет «не работает» и обращение приходится досрашивать.
 */
function updateHint() {
  if (!els.hint || !els.category) return;
  els.hint.textContent = tx(`feedback.hint_${els.category.value}`, '');
}

function updateCounter() {
  if (!els.counter || !els.message) return;
  const len = els.message.value.length;
  els.counter.textContent = `${len} / ${MESSAGE_MAX}`;
  els.counter.classList.toggle('fb-counter-over', len >= MESSAGE_MAX);
}

function showError(message) {
  els.error.textContent = message ?? '';
  els.error.classList.toggle('hidden', !message);
}

function fmtDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(LOCALE_TAGS[detectLocale()] ?? 'ru-RU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function isStaff() {
  return !!me && (me.isAdmin === true || STAFF_ROLES.includes(me.adminRole));
}

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
  if (els.auth) els.auth.textContent = me ? me.username : tx('auth.login', 'Войти');
  if (els.adminLink) els.adminLink.classList.toggle('hidden', !isStaff());
  els.mineBlock.classList.toggle('hidden', !me);
}

function renderMine(items) {
  els.mine.innerHTML = '';
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'rating-empty';
    p.textContent = tx('feedback.no_mine', 'Обращений пока нет');
    els.mine.appendChild(p);
    return;
  }
  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'cms-news-item fb-item';

    const head = document.createElement('div');
    head.className = 'fb-item-head';
    const cat = document.createElement('span');
    cat.className = 'fb-item-cat';
    cat.textContent = tx(`feedback.cat_${item.category}`, item.category);
    head.appendChild(cat);
    const status = document.createElement('span');
    status.className = `fb-status ${STATUS_CLS[item.status] ?? ''}`;
    status.textContent = tx(`feedback.${STATUS_KEYS[item.status] ?? 'status_new'}`, item.status);
    head.appendChild(status);
    const date = document.createElement('span');
    date.className = 'fb-item-date';
    date.textContent = fmtDate(item.createdAt);
    head.appendChild(date);

    const body = document.createElement('div');
    body.className = 'fb-item-body';
    body.textContent = item.message;

    card.appendChild(head);
    card.appendChild(body);

    // Ответ команды — иначе статус «Закрыто» читается как игнор
    if (item.reply) {
      const reply = document.createElement('div');
      reply.className = 'fb-reply';
      const rHead = document.createElement('div');
      rHead.className = 'fb-reply-head';
      rHead.textContent = tx('feedback.reply_label', 'Ответ команды');
      const rDate = document.createElement('span');
      rDate.className = 'fb-item-date';
      rDate.textContent = fmtDate(item.repliedAt);
      rHead.appendChild(rDate);
      const rBody = document.createElement('div');
      rBody.className = 'fb-reply-body';
      rBody.textContent = item.reply;
      reply.append(rHead, rBody);
      card.appendChild(reply);
    }

    els.mine.appendChild(card);
  }
}

async function loadMine() {
  if (!me) return;
  try {
    const data = await api('/api/feedback/mine');
    renderMine(data.items ?? []);
  } catch {
    els.mine.innerHTML = '';
  }
}

async function submit(e) {
  e.preventDefault();
  showError('');
  els.ok.classList.add('hidden');

  if (!me) {
    showError(tx('feedback.login_needed', 'Войдите в аккаунт, чтобы отправить обращение'));
    return;
  }

  const message = els.message.value.trim();
  if (message.length < 10) {
    showError(tx('feedback.min_len', 'Опиши подробнее — минимум 10 символов'));
    return;
  }

  const btn = els.form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await api('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ category: els.category.value, message }),
    });
    els.message.value = '';
    els.ok.textContent = tx('feedback.success', 'Обращение отправлено!');
    els.ok.classList.remove('hidden');
    await loadMine();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
  }
}

function bindEvents() {
  els.form?.addEventListener('submit', submit);
  els.category?.addEventListener('change', updateHint);
  els.message?.addEventListener('input', updateCounter);
  // Слушатели вешаем на document, а не на window: i18n.js диспатчит
  // eos:locale на document без bubbles — до window событие не доходит.
  document.addEventListener('eos:locale', (e) => {
    dict = e.detail;
    renderAuth();
    updateHint();
    updateCounter();
  });
  for (const btn of document.querySelectorAll('.lang-btn')) {
    btn.addEventListener('click', () => applyLocale(btn.dataset.lang).catch(console.error));
  }
}

async function init() {
  bindEvents();
  dict = await applyLocale(detectLocale()).catch(() => ({}));
  me = await loadMe();
  renderAuth();
  updateHint();
  updateCounter();
  await loadMine();
}

init().catch(console.error);
