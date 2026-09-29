// ============================================================
// Точка входа игрового клиента — Empire of Safavids
// ============================================================

import { api, ApiError } from './api';
import { detectLocale, loadLocale, t } from './i18n';
import { toast } from './hud';
import { clearAuth, session, persistAuth, Character } from './state';
import { enterWorld, showScreen } from './world';
import { enterAsGuest, initAuthScreen, showAuthError } from './screens/auth';
import { initCharsScreen } from './screens/chars';
import { audio } from './audio';
import { getSettings, applyDisplayMode, updateSettings, syncDisplayModeWithBrowser } from './settings';
import { initConnectionIndicator } from './connectionIndicator';
import { captureReferralFromUrl } from './referral';
// Wire asset bundle system so Vite includes it (otherwise client/src/assets/* is dead code).
// See client/src/assets/index.ts — TextureSystem / SpriteSystem / AssetStorage catalogs.
// TODO: preload critical bundles (bundle_core) here when CDN is live; currently procedural
// textures and file-based PNG sprites are used as fallback.
import { textureManager, spriteManager, assetStorage } from '../assets/index';
void textureManager; void spriteManager; void assetStorage;

async function boot(): Promise<void> {
  // Словарь нужен для перевода интерфейса, но его отсутствие не должно
  // оставлять игрока на пустом экране — тексты останутся как в разметке
  try {
    await loadLocale(detectLocale());
  } catch {
    console.warn('[i18n] failed to load locale, falling back to markup');
  }

  // Индикатор состояния соединения
  initConnectionIndicator();

  // Экранный режим, громкость и звуки интерфейса — до входа в игру
  applyBootSettings();
  initUiSounds();

  // Музыка на экранах входа/регистрации/персонажей — после первого жеста
  audio.installAuthMusicTrigger();

  // Код приглашения из ссылки ?ref= забираем ДО всего остального: он может
  // прийти к уже вошедшему игроку, и код надо запомнить до восстановления сессии
  captureReferralFromUrl();

  initAuthScreen(() => void gotoCharacters());

  // Провайдер (Google/Facebook) вернул игрока с кодом и state — завершаем вход.
  // Проверяем ДО восстановления сессии: если игрок уже вошёл (например, как
  // гость), код надо обменять, чтобы внешний вход привязался к его же
  // аккаунту, а не завёл второй.
  const returned = await finishOAuthReturn();
  if (returned) return;

  // «Играть за 10 секунд» с лендинга: /game/?guest=1
  //
  // Смысл: между «заинтересовался» и «играет» стоял экран входа с полями
  // почты и пароля. Для нового игрока, который пришёл посмотреть, это
  // был барьер в четыре поля. Ссылка с лендинга ведёт сразу в гостя.
  if (await enterAsGuestFromLink()) return;

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

/**
 * Завершает внешний вход, если провайдер вернул нас с кодом.
 *
 * Провайдеры возвращают игрока на адрес игры с параметрами ?code=…&state=…
 * (Google) либо ?code=… (ВК, state идёт в ответе вместе с ошибкой).
 * Возвращаем true, если вход был и мы ушли к персонажам.
 */
/**
 * Вход гостя по ссылке с лендинга: /game/?guest=1
 *
 * Параметр убирается из адреса сразу: иначе обновление страницы (F5 или
 * тап по адресной строке) завело бы нового гостя и съедало суточный лимит
 * гостей на адрес. Уже вошедшего игрока ссылка не трогает: при сохранённой
 * сессии он и так идёт к персонажам.
 *
 * Возвращает true, если вход состоялся. При неудаче (например, суточный
 * лимит гостей на адрес исчерпан) показываем обычный экран входа с понятной
 * ошибкой: молча упасть на пустой экран нельзя.
 */
async function enterAsGuestFromLink(): Promise<boolean> {
  const url = new URL(window.location.href);
  if (url.searchParams.get('guest') !== '1') return false;

  // Адрес чистим ДО проверки сессии, а не после. Параметр свою работу уже
  // сделал, и держать его дальше незачем: оставленная ссылка — это мина на
  // мине. Игрок, у которого сессия уже есть, уходит к персонажам с
  // «?guest=1» в строке; стоит ему выйти из аккаунта (или истечь токену) и
  // нажать F5 — и он получит нового гостя, вместо того чтобы увидеть
  // экран входа. Нашли это на живом проде, а не в коде.
  url.searchParams.delete('guest');
  window.history.replaceState({}, '', url.toString());

  // Вошедшего игрока не трогаем: он и так идёт к персонажам
  if (session.token) return false;

  try {
    await enterAsGuest();
    await gotoCharacters();
    return true;
  } catch (err) {
    const code = err instanceof ApiError ? err.code : undefined;
    const localized = code ? t(`errors.${code}`) : '';
    showAuthError(localized && localized !== `errors.${code}`
      ? localized
      : ((err as Error).message || t('common.error')));
    showScreen('screen-auth');
    return false;
  }
}

async function finishOAuthReturn(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const denied = url.searchParams.get('error');
  if (!code && !denied) return false;

  // Параметры входа не должны болтаться в адресной строке: иначе игрок
  // обновит страницу и повторит вход с уже сгоревшим state
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  window.history.replaceState({}, '', url.toString());

  if (denied || !code) {
    // Игрок отказался на экране провайдера — это не ошибка, просто молча
    // возвращаем на экран входа
    showScreen('screen-auth');
    return true;
  }
  if (!state) {
    showScreen('screen-auth');
    return true;
  }

  // Какой провайдер — определяем по тому, что удалось получить раньше
  const provider = sessionStorage.getItem('eos_oauth_provider') ?? 'google';
  // Привязка отличается от входа: игрок уже вошёл, и выбрасывать его на
  // экран входа при ошибке — бессмысленно. Он должен остаться в игре и
  // увидеть, что произошло.
  const wasLinking = sessionStorage.getItem('eos_oauth_linking') === '1';
  try {
    const { data } = await api.oauthCallback(provider, code, state);
    persistAuth(data.token, data.userId, data.username, false);
    sessionStorage.removeItem('eos_oauth_provider');
    sessionStorage.removeItem('eos_oauth_linking');
    if (wasLinking) {
      toast(t('link.provider_linked'), 'success');
    }
    await gotoCharacters();
  } catch (err) {
    sessionStorage.removeItem('eos_oauth_provider');
    sessionStorage.removeItem('eos_oauth_linking');
    if (wasLinking && session.token) {
      // Привязка не удалась, но аккаунт живой: остаёмся в игре и говорим почему
      const code_ = (err as { code?: string }).code;
      const msg = code_ === 'identity_taken'
        ? t('link.identity_taken')
        : ((err as Error).message || t('link.provider_failed'));
      toast(msg, 'error');
      await gotoCharacters();
      return true;
    }
    // Неверный или просроченный state, отказ провайдера — экран входа
    showScreen('screen-auth');
  }
  return true;
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

/**
 * Звуки интерфейса по всему клиенту: щелчок по кнопке, шёпот при
 * наведении, открытие/закрытие панелей. Раньше интерфейс был беззвучным.
 * Вешается один раз глобально — иначе пришлось бы править каждый экран.
 */
function initUiSounds(): void {
  const CLICKABLE = 'button, .btn, .tab, select, input[type="checkbox"], input[type="radio"]';
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement | null)?.closest?.(CLICKABLE)) audio.uiClick();
  });

  let lastHover = 0;
  document.addEventListener('pointerover', (e) => {
    if (!(e.target as HTMLElement | null)?.closest?.('button, .btn, .tab, select')) return;
    const now = performance.now();
    if (now - lastHover < 80) return;   // не тарахтим при быстром движении мыши
    lastHover = now;
    audio.uiHover();
  });

  // Открытие/закрытие любых панелей и меню: следим за классом .hidden,
  // чтобы звук был везде, а не только там, где мы о нём вспомнили.
  const obs = new MutationObserver((records) => {
    // Если элемент переключили несколько раз за кадр, записи схлопываются.
    // Берём ПЕРВУЮ запись элемента: её oldValue — состояние до всех
    // переключений, а текущий класс — состояние после них. Сравнив их,
    // получаем ровно одно «открылось/закрылось» вместо мусора.
    const first = new Map<HTMLElement, MutationRecord>();
    for (const r of records) {
      const el = r.target as HTMLElement;
      if (el.classList && !first.has(el)) first.set(el, r);
    }
    for (const [el, r] of first) {
      const wasHidden = (r.oldValue ?? '').split(/\s+/).includes('hidden');
      const isHidden = el.classList.contains('hidden');
      if (wasHidden === isHidden) continue;
      if (isHidden) audio.uiClose(); else audio.uiOpen();
      // Сюжетная музыка — на время диалога с NPC
      if (el.id === 'panel-dialog') audio.setMusicMood(isHidden ? 'explore' : 'story');
    }
  });
  for (const el of document.querySelectorAll<HTMLElement>('.overlay, .side-panel')) {
    obs.observe(el, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  }

  // Квест принят/выполнен — короткая фанфара
  window.addEventListener('quest:accepted', () => audio.questDone());
}

/** Экранный режим и громкость — применяются сразу, до входа в мир */
function applyBootSettings(): void {
  const s = getSettings();
  // Полный экран без жеста пользователя браузер не даст — остаёмся в окне
  const mode = (s.display === 'fullscreen' && !document.fullscreenElement) ? 'borderless' : s.display;
  if (mode !== s.display) updateSettings({ display: mode });
  void applyDisplayMode(mode);
  audio.setMusicVolume(s.music);
  audio.setSfxVolume(s.sfx);
  // Пользователь мог выйти из полного экрана клавишей Esc — синхронизируем
  document.addEventListener('fullscreenchange', () => syncDisplayModeWithBrowser());
}
