// ============================================================
// Точка входа игрового клиента — Empire of Safavids
// ============================================================

import { api } from './api';
import { detectLocale, loadLocale } from './i18n';
import { clearAuth, session, Character } from './state';
import { enterWorld, showScreen } from './world';
import { initAuthScreen } from './screens/auth';
import { initCharsScreen } from './screens/chars';

async function boot(): Promise<void> {
  await loadLocale(detectLocale());

  initAuthScreen(() => void gotoCharacters());

  // Есть сохранённая сессия — сразу к персонажам
  if (session.token) {
    try {
      await api.characters();
      await gotoCharacters();
      return;
    } catch {
      clearAuth();
      showScreen('screen-auth');
    }
  } else {
    showScreen('screen-auth');
  }
}

/** Переход к экрану персонажей (в т.ч. после reconnect-потери) */
export async function gotoCharacters(): Promise<void> {
  if (!session.token) return;
  try {
    await api.characters(); // проверка, что сессия жива
  } catch {
    clearAuth();
    showScreen('screen-auth');
    return;
  }
  await initCharsScreen((c: Character) => void enterWorld(c));
}

/** Полный выход (из меню мира) */
export function logoutLocal(): void {
  clearAuth();
  showScreen('screen-auth');
}

void boot();
