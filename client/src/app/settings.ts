// ============================================================
// Настройки игры — Empire of Safavids
// ============================================================
// Единое хранилище настроек (localStorage) и их применение:
//  * экранный режим — полный экран / без рамок / с рамкой;
//  * качество графики — 6 уровней от «слабой» до «ультра»;
//  * громкость музыки и эффектов, подсказки, мини-карта, туман.
// Панель настроек (#overlay-settings) читает и пишет сюда, движок
// получает изменения через подписку onSettingsChange().

export type GraphicsLevel = 'low' | 'medium' | 'good' | 'high' | 'epic' | 'ultra';
export type DisplayMode = 'fullscreen' | 'borderless' | 'windowed';

/** От слабого к мощному — ровно в этом порядке идут пункты в меню */
export const GRAPHICS_LEVELS: GraphicsLevel[] = ['low', 'medium', 'good', 'high', 'epic', 'ultra'];
export const DISPLAY_MODES: DisplayMode[] = ['fullscreen', 'borderless', 'windowed'];

export interface GameSettings {
  graphics: GraphicsLevel;
  display: DisplayMode;
  /** Громкость музыки, 0..100 */
  music: number;
  /** Громкость эффектов и эмбиента, 0..100 */
  sfx: number;
  hints: boolean;
  minimap: boolean;
  fog: boolean;
}

/** Что реально меняет уровень графики в 3D-движке */
export interface GraphicsProfile {
  /** Множитель к devicePixelRatio: <1 — сжатый кадр (быстро), >1 — суперсэмплинг (красиво) */
  pixelScale: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Дальность прорисовки (far тумана), метры */
  fogFar: number;
  /** Доля частиц погоды, 0..1 */
  weather: number;
}

// Шесть уровней: каждый следующий заметно дороже, но и заметно красивее.
// Мягкие тени (PCFSoftShadowMap) вырезаны из Three.js, поэтому разница
// уровней идёт по разрешению кадра, размеру карты теней и дальности.
const PROFILES: Record<GraphicsLevel, GraphicsProfile> = {
  low:    { pixelScale: 0.6,  shadows: false, shadowMapSize: 512,  fogFar: 240, weather: 0.30 },
  medium: { pixelScale: 0.8,  shadows: true,  shadowMapSize: 1024, fogFar: 340, weather: 0.55 },
  good:   { pixelScale: 1.0,  shadows: true,  shadowMapSize: 1024, fogFar: 440, weather: 0.75 },
  high:   { pixelScale: 1.2,  shadows: true,  shadowMapSize: 2048, fogFar: 560, weather: 1.00 },
  epic:   { pixelScale: 1.45, shadows: true,  shadowMapSize: 2048, fogFar: 700, weather: 1.00 },
  ultra:  { pixelScale: 1.75, shadows: true,  shadowMapSize: 4096, fogFar: 850, weather: 1.00 },
};

const KEY = 'eos_settings_v1';

const DEFAULTS: GameSettings = {
  graphics: 'high',
  display: 'borderless',
  music: 50,
  sfx: 70,
  hints: true,
  minimap: true,
  fog: true,
};

function isGraphics(v: unknown): v is GraphicsLevel {
  return typeof v === 'string' && (GRAPHICS_LEVELS as string[]).includes(v);
}
function isDisplay(v: unknown): v is DisplayMode {
  return typeof v === 'string' && (DISPLAY_MODES as string[]).includes(v);
}
function pct(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
}

let cached: GameSettings | null = null;
const listeners = new Set<(s: GameSettings) => void>();

/** Прочитать настройки (кэшируются; повреждённый localStorage откатывается к заводским) */
export function getSettings(): GameSettings {
  if (cached) return cached;
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
  } catch {
    raw = {};
  }
  cached = {
    graphics: isGraphics(raw.graphics) ? raw.graphics : DEFAULTS.graphics,
    display: isDisplay(raw.display) ? raw.display : DEFAULTS.display,
    music: pct(raw.music, DEFAULTS.music),
    sfx: pct(raw.sfx, DEFAULTS.sfx),
    hints: typeof raw.hints === 'boolean' ? raw.hints : DEFAULTS.hints,
    minimap: typeof raw.minimap === 'boolean' ? raw.minimap : DEFAULTS.minimap,
    fog: typeof raw.fog === 'boolean' ? raw.fog : DEFAULTS.fog,
  };
  return cached;
}

/** Изменить часть настроек, сохранить и уведомить подписчиков */
export function updateSettings(patch: Partial<GameSettings>): GameSettings {
  const next = { ...getSettings(), ...patch };
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* приватный режим — просто не сохраняем */ }
  for (const fn of listeners) fn(next);
  return next;
}

/** Подписка на изменения (возвращает отписку) */
export function onSettingsChange(fn: (s: GameSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Профиль качества для уровня (fallback — «высокое») */
export function graphicsProfile(level: GraphicsLevel): GraphicsProfile {
  return PROFILES[level] ?? PROFILES.high;
}

// ── Экранный режим ───────────────────────────────────────────
// Полный экран — настоящий Fullscreen API (исчезает панель браузера).
// «Без рамок» — игра ровно на всё окно браузера (inset: 0).
// «С рамкой» — вокруг игры видимая рамка и поля (как старое окно).
// Рамкой САМОГО окна браузера страница управлять не может — это
// запрещено браузерами, поэтому все три режима живут внутри страницы.

export async function applyDisplayMode(mode: DisplayMode): Promise<void> {
  document.body.dataset.display = mode;
  const wantFullscreen = mode === 'fullscreen';
  try {
    if (wantFullscreen && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else if (!wantFullscreen && document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch {
    // Браузер мог отказать (например, без жеста пользователя) — остаёмся в окне
  }
}

/** Пользователь мог выйти из полного экрана клавишей Esc — синхронизируем состояние */
export function syncDisplayModeWithBrowser(): void {
  const s = getSettings();
  if (s.display === 'fullscreen' && !document.fullscreenElement) {
    updateSettings({ display: 'borderless' });
    void applyDisplayMode('borderless');
  }
}
