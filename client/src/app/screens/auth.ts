// ============================================================
// Экран аутентификации — Empire of Safavids
// ============================================================

import { api, ApiError } from '../api';
import { persistAuth } from '../state';
import { t } from '../i18n';
import { showScreen } from '../world';

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

  function switchTab(login: boolean): void {
    $('tab-login').classList.toggle('active', login);
    $('tab-register').classList.toggle('active', !login);
    $('form-login').classList.toggle('hidden', !login);
    $('form-register').classList.toggle('hidden', login);
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

  showScreen('screen-auth');
}
