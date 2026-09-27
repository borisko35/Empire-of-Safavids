// ============================================================
// Привязка аккаунтов (клиент) — Empire of Safavids
// ============================================================
// Показываем игроку, какими способами он может войти, и даём manage ими.
//
// ПОЧЕМУ ПОСЛЕДНЯЮ ПРИВЯЗКУ ОТВЯЗАТЬ НЕЛЬЗЯ: если игрок отвяжет единственный
// способ входа, доступ к персонажу пропадёт навсегда — восстановить его можно
// будет только руками через базу. Поэтому последний способ помечается
// сервером, а здесь мы не рисуем кнопку и говорим почему.
//
// ПОЧЕМУ НЕТ «ДОБАВИТЬ ПАРОЛЬ» ОТДЕЛЬНО: вход идёт по почте, а у аккаунта
// Google служебная почта google_…@oauth.invalid, которую никто не введёт.
// Поэтому форма запрашивает почту И пароль — иначе пароль был бы мёртвым.

import { api, type LinkedAccountInfo } from './api';
import { t } from './i18n';
import { toast } from './hud';
import { session } from './state';

type LinkedAccount = LinkedAccountInfo;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

/** Показать ошибку в блоке настроек (не тостом — она должна быть видна) */
function showError(key: string, fallback = ''): void {
  const el = $('link-error');
  if (!el) return;
  // Сервер отдаёт код ошибки; если на него нет перевода, показываем его текст
  const translated = t(key);
  el.textContent = translated === key ? fallback || key : translated;
  el.classList.remove('hidden');
}

function clearError(): void {
  const el = $('link-error');
  if (el) {
    el.textContent = '';
    el.classList.add('hidden');
  }
}

/** Нарисовать список привязанных способов входа */
export async function loadAccountLinks(): Promise<void> {
  const list = $('link-accounts');
  if (!list) return;
  list.innerHTML = '';
  clearError();

  let info: { accounts: LinkedAccount[]; total: number };
  try {
    info = await api.accountIdentities();
  } catch {
    const empty = document.createElement('div');
    empty.className = 'link-empty';
    empty.textContent = t('link.unavailable');
    list.append(empty);
    return;
  }

  for (const acc of info.accounts) {
    const row = document.createElement('div');
    row.className = 'link-row';

    const name = document.createElement('span');
    name.className = 'link-name';
    name.textContent = acc.label;
    row.append(name);

    if (acc.email) {
      const mail = document.createElement('span');
      mail.className = 'link-mail';
      mail.textContent = acc.email;
      row.append(mail);
    }

    if (acc.method === 'password') {
      // Пароль не отвязывается — его можно сменить
      const note = document.createElement('span');
      note.className = 'link-note';
      note.textContent = t('link.password_note');
      row.append(note);
    } else if (acc.canDetach) {
      const un = document.createElement('button');
      un.className = 'link-unlink';
      un.type = 'button';
      un.textContent = t('link.unlink');
      un.addEventListener('click', async () => {
        un.disabled = true;
        try {
          await api.accountUnlink(acc.method as 'google' | 'facebook');
          toast(t('link.unlinked'), 'success');
          await loadAccountLinks();
        } catch (err) {
          // Последний способ входа сервер не отдаст, но подстраховаться надо
          const code = (err as Error & { code?: string }).code;
          showError(code === 'last_way_in' ? 'link.last_way_in' : 'link.unlink_failed',
            (err as Error).message);
          un.disabled = false;
        }
      });
      row.append(un);
    } else {
      // Единственный способ входа: кнопки нет, и сказано почему
      const lock = document.createElement('span');
      lock.className = 'link-lock';
      lock.textContent = t('link.last_way_in');
      row.append(lock);
    }
    list.append(row);
  }

  // Чего не хватает — предлагаем добавить
  const add = $('link-add');
  if (!add) return;
  add.innerHTML = '';

  const hasPassword = info.accounts.some((a) => a.method === 'password');
  if (!hasPassword) {
    add.append(buildEmailForm());
  } else {
    // Способы, которые ещё не привязаны, показываем кнопками входа
    for (const p of ['google', 'facebook'] as const) {
      if (info.accounts.some((a) => a.method === p)) continue;
      add.append(buildProviderButton(p));
    }
  }
}

/** Форма «почта + пароль» для аккаунта, который входит только через Google */
function buildEmailForm(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'link-form';

  const label = document.createElement('p');
  label.className = 'link-hint';
  label.textContent = t('link.add_email');
  wrap.append(label);

  const mail = document.createElement('input');
  mail.type = 'email';
  mail.className = 'link-input';
  mail.placeholder = t('auth.email');
  mail.autocomplete = 'email';
  wrap.append(mail);

  const pass = document.createElement('input');
  pass.type = 'password';
  pass.className = 'link-input';
  pass.placeholder = t('auth.password');
  pass.autocomplete = 'new-password';
  wrap.append(pass);

  const btn = document.createElement('button');
  btn.className = 'link-submit';
  btn.type = 'button';
  btn.textContent = t('link.add_email_btn');
  btn.addEventListener('click', async () => {
    clearError();
    const email = mail.value.trim();
    const password = pass.value;
    if (!email || !password) {
      showError('link.fill_both', '');
      return;
    }
    btn.disabled = true;
    try {
      await api.accountAddEmail(email, password);
      toast(t('link.email_added'), 'success');
      // Почта аккаунта изменилась — обновляем её в сессии, чтобы интерфейс
      // не показывал старую служебную
      if (session.userId) await refreshSessionEmail();
      await loadAccountLinks();
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      showError(
        code === 'email_taken' ? 'link.email_taken'
          : code === 'email_invalid' ? 'link.email_invalid'
            : code === 'password_already_set' ? 'link.password_already_set'
              : 'link.add_failed',
        (err as Error).message,
      );
      btn.disabled = false;
    }
  });
  wrap.append(btn);
  return wrap;
}

/** Кнопка входа через провайдера — привязывает его к текущему аккаунту */
function buildProviderButton(provider: 'google' | 'facebook'): HTMLElement {
  const btn = document.createElement('button');
  btn.className = `link-submit link-submit--${provider}`;
  btn.type = 'button';
  btn.textContent = t(provider === 'google' ? 'auth.sign_in_google' : 'auth.sign_in_facebook');
  btn.addEventListener('click', async () => {
    clearError();
    btn.disabled = true;
    try {
      // Сессия уже есть, поэтому OAuthService привяжет провайдера к
      // текущему аккаунту, а не заведёт новый
      const { data } = await api.oauthStart(provider);
      sessionStorage.setItem('eos_oauth_provider', provider);
      sessionStorage.setItem('eos_oauth_linking', '1');
      window.location.href = data.authorizeUrl;
    } catch (err) {
      showError('link.provider_failed', (err as Error).message);
      btn.disabled = false;
    }
  });
  return btn;
}

/** Обновить почту в сессии после привязки */
async function refreshSessionEmail(): Promise<void> {
  try {
    await api.authMe();
  } catch {
    // Не критично: почта в интерфейсе показывается только в панели
  }
}
