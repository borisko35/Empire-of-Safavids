// ============================================================
// Точка входа игрового клиента — Empire of Safavids
// ============================================================

import { api } from './api';
import { detectLocale, loadLocale } from './i18n';
import { clearAuth, session, Character } from './state';
import { enterWorld, showScreen } from './world';
import { initAuthScreen } from './screens/auth';
import { initCharsScreen } from './screens/chars';
import { audio } from './audio';
import { initConnectionIndicator } from './connectionIndicator';
// Wire asset bundle system so Vite includes it (otherwise client/src/assets/* is dead code).
// See client/src/assets/index.ts — TextureSystem / SpriteSystem / AssetStorage catalogs.
// TODO: preload critical bundles (bundle_core) here when CDN is live; currently procedural
// textures and file-based PNG sprites are used as fallback.
import { textureManager, spriteManager, assetStorage } from '../assets/index';
void textureManager; void spriteManager; void assetStorage;

async function boot(): Promise<void> {
  await loadLocale(detectLocale());

  // Индикатор состояния соединения
  initConnectionIndicator();

  // Музыка на экранах входа/регистрации/персонажей — после первого жеста
  audio.installAuthMusicTrigger();

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
