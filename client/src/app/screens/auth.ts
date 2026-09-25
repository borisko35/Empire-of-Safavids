// ============================================================
// Экран аутентификации — Empire of Safavids
// ============================================================

import { api, ApiError } from '../api';
import { persistAuth } from '../state';
import { t } from '../i18n';
import { showScreen } from '../world';
import { getPasswordStrength } from '../../../../shared/auth.validation';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

function showError(message: string): void {
  const el = $('auth-error');
  el.textContent = message;
  el.classList.remove('hidden');
}

/** Ошибка авторизации: код сервера -> локализованный текст */
function showAuthError(err: unknown): void {
  const code = err instanceof ApiError ? err.code : undefined;
  const localized = code ? t(`errors.${code}`) : '';
  showError(localized && localized !== `errors.${code}` ? localized : ((err as Error).message || t('common.error')));
}

export function initAuthScreen(onSuccess: () => void): void {
  // Переключение вкладок
  $('tab-login').addEventListener('click', () => switchTab(true));
  $('tab-register').addEventListener('click', () => switchTab(false));

  // Кнопка "Забыли пароль?"
  $('btn-forgot-password').addEventListener('click', () => showResetForm());
  $('btn-back-to-login').addEventListener('click', () => showLoginForm());

  // Сброс пароля
  ($('form-reset-password') as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    const email = ($('reset-email') as HTMLInputElement).value.trim();
    const newPass = ($('reset-new-password') as HTMLInputElement).value;
    const confirmPass = ($('reset-confirm-password') as HTMLInputElement).value;

    if (newPass !== confirmPass) {
      showError(t('auth.confirm_password') + ' — ' + t('common.error'));
      return;
    }

    try {
      await api.resetPassword(email, newPass);
      showError(t('auth.password_reset_sent'));
      setTimeout(() => showLoginForm(), 2000);
    } catch (err) {
      showError(t('auth.password_reset_error') + ': ' + ((err as Error).message || ''));
    }
  };

  function switchTab(login: boolean): void {
    $('tab-login').classList.toggle('active', login);
    $('tab-register').classList.toggle('active', !login);
    $('form-login').classList.toggle('hidden', !login);
    $('form-register').classList.toggle('hidden', login);
    $('form-reset-password').classList.add('hidden');
    $('auth-error').classList.add('hidden');
  }

  function showLoginForm(): void {
    $('form-login').classList.remove('hidden');
    $('form-register').classList.add('hidden');
    $('form-reset-password').classList.add('hidden');
    $('tab-login').classList.add('active');
    $('tab-register').classList.remove('active');
    $('auth-error').classList.add('hidden');
  }

  function showResetForm(): void {
    $('form-login').classList.add('hidden');
    $('form-register').classList.add('hidden');
    $('form-reset-password').classList.remove('hidden');
    $('tab-login').classList.remove('active');
    $('tab-register').classList.remove('active');
    $('auth-error').classList.add('hidden');
  }

  // Вход
  ($('form-login') as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.login(
        ($('login-email') as HTMLInputElement).value.trim(),
        ($('login-password') as HTMLInputElement).value,
      );
      persistAuth(data.token, data.userId, data.username);
      onSuccess();
    } catch (err) {
      showAuthError(err);
    }
  };

  // Регистрация
  ($('form-register') as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    const password = ($('reg-password') as HTMLInputElement).value;
    if (password !== ($('reg-confirm') as HTMLInputElement).value) {
      showError(t('auth.confirm_password') + ' — ' + t('common.error'));
      return;
    }
    try {
      const { data } = await api.register({
        username: ($('reg-username') as HTMLInputElement).value.trim(),
        email: ($('reg-email') as HTMLInputElement).value.trim(),
        password,
        confirmPassword: password,
        agreeToTerms: ($('reg-terms') as HTMLInputElement).checked,
        agreeToPrivacy: ($('reg-privacy') as HTMLInputElement).checked,
        birthYear: Number(($('reg-birth-year') as HTMLInputElement).value),
      });
      persistAuth(data.token, data.userId, data.username);
      onSuccess();
    } catch (err) {
      showAuthError(err);
    }
  };

  // ── Password strength meter (shared/auth.validation.ts) ──────
  const pwInput = document.getElementById('reg-password') as HTMLInputElement | null;
  if (pwInput) {
    let meter = document.getElementById('pw-strength') as HTMLElement | null;
    if (!meter) {
      meter = document.createElement('div');
      meter.id = 'pw-strength';
      meter.style.fontSize = '12px';
      meter.style.marginTop = '4px';
      meter.style.minHeight = '16px';
      pwInput.insertAdjacentElement('afterend', meter);
    }
    const updateStrength = (): void => {
      const v = pwInput.value;
      if (!v) { meter!.textContent = ''; return; }
      const s = getPasswordStrength(v);
      meter!.textContent = `${s.label} (${s.score}/5)`;
      meter!.style.color = s.color;
    };
    pwInput.addEventListener('input', updateStrength);
  }
  // Also wire meter for reset-password form
  const resetPwInput = document.getElementById('reset-new-password') as HTMLInputElement | null;
  if (resetPwInput) {
    let m2 = document.getElementById('pw-strength-reset') as HTMLElement | null;
    if (!m2) {
      m2 = document.createElement('div');
      m2.id = 'pw-strength-reset';
      m2.style.fontSize = '12px';
      m2.style.marginTop = '4px';
      m2.style.minHeight = '16px';
      resetPwInput.insertAdjacentElement('afterend', m2);
    }
    resetPwInput.addEventListener('input', () => {
      const v = resetPwInput.value;
      if (!v) { m2!.textContent = ''; return; }
      const s = getPasswordStrength(v);
      m2!.textContent = `${s.label} (${s.score}/5)`;
      m2!.style.color = s.color;
    });
  }

  showScreen('screen-auth');
}
