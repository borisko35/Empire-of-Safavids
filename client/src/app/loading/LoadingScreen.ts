import { t } from '../i18n';

// Loading screen states
export type LoadingState = 'idle' | 'loading' | 'complete' | 'error';

// Loading progress info
export interface LoadingProgress {
  state: LoadingState;
  progress: number; // 0-100
  message: string;
  estimatedTime: string; // e.g., "5s", "30s"
  loadedBytes: number;
  totalBytes: number;
  assetName?: string;
}

// Critical assets to preload first (UI, essential textures)
export const CRITICAL_ASSETS = [
  'tex_ui_hud_atlas',
  'tex_ui_icons_items',
  'tex_qizilbash_armor_albedo',
  'tex_sufi_robe_albedo',
];

// All assets catalog
export const ALL_ASSETS = Object.keys(TEXTURE_CATALOG);

// Get size of a single asset
function getAssetSize(id: string): number {
  const tex = TEXTURE_CATALOG[id];
  if (!tex) return 0;
  return tex.sizeBytes;
}

// Get total size of all assets
function getTotalSize(): number {
  return Object.values(TEXTURE_CATALOG).reduce((sum, t) => sum + t.sizeBytes, 0);
}

// Get size of critical assets
function getCriticalSize(): number {
  return CRITICAL_ASSETS.reduce((sum, id) => sum + getAssetSize(id), 0);
}

// Estimate loading time based on connection speed
function estimateLoadTime(bytes: number): string {
  // Rough estimates based on typical connection speeds
  const kbps = 500; // 500 Kbps average
  const seconds = bytes / (kbps * 1024);
  if (seconds < 1) return '< 1s';
  if (seconds < 30) return `${Math.round(seconds)}s`;
  if (seconds < 120) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

// Create loading screen element
function createLoadingScreen(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.id = 'loading-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: #0a0a0f;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #e0e0e0;
    transition: opacity 0.3s ease;
  `;

  overlay.innerHTML = `
    <div style="text-align: center; padding: 20px;">
      <div style="
        width: 64px; height: 64px;
        border: 3px solid #1a1410;
        border-top: 3px solid #00d4aa;
        border-radius: 50%;
        margin: 0 auto 24px;
        animation: spin 1s linear infinite;
      "></div>
      <h2 style="color: #00d4aa; margin-bottom: 12px; font-size: 20px;">
        ${t('loading.loading_title')}
      </h2>
      <p style="color: #888; margin-bottom: 24px; font-size: 14px;">
        ${t('loading.loading_subtitle')}
      </p>
      <div style="
        width: 200px; height: 8px;
        background: #2a221a; border-radius: 4px; overflow: hidden;
      ">
        <div id="loading-progress" style="
          width: 0%; height: 100%;
          background: #00d4aa; transition: width 0.1s linear;
        "></div>
      </div>
      <p id="loading-message" style="color: #666; margin-top: 12px; font-size: 12px;">
        ${t('loading.loading_preparing')}
      </p>
      <p id="loading-estimate" style="color: #555; margin-top: 8px; font-size: 11px;">
        ${t('loading.loading_estimate', '0s')}
      </p>
    </div>
  `;

  // Add spin animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @keyframes fadeOut {
      to { opacity: 0; visibility: hidden; }
    }
  `;
  document.head.appendChild(style);

  return overlay;
}

// Show loading screen
export function showLoadingScreen(): void {
  // Remove existing if any
  const existing = document.getElementById('loading-overlay');
  if (existing) existing.remove();

  const overlay = createLoadingScreen();
  document.body.appendChild(overlay);
}

// Hide loading screen
function hideLoadingScreen(): void {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
  }
}

// Update loading progress
function updateLoadingProgress(progress: LoadingProgress): void {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;

  const progressBar = overlay.querySelector('#loading-progress') as HTMLDivElement;
  const message = overlay.querySelector('#loading-message') as HTMLParagraphElement;
  const estimate = overlay.querySelector('#loading-estimate') as HTMLParagraphElement;

  if (progressBar) {
    const percent = Math.max(0, Math.min(100, progress.progress));
    progressBar.style.width = `${percent}%`;
  }

  if (message) {
    message.textContent = progress.message;
  }

  if (estimate) {
    estimate.textContent = t('loading.loading_estimate', progress.estimatedTime);
  }
}

// Start loading process
async function startLoading(): Promise<void> {
  showLoadingScreen();
  updateLoadingProgress({
    state: 'loading',
    progress: 0,
    message: t('loading.loading_start'),
    estimatedTime: '...',
    loadedBytes: 0,
    totalBytes: getTotalSize(),
  });

  try {
    // Step 1: Load locale
    await loadLocale(detectLocale());
    updateLoadingProgress({
      state: 'loading',
      progress: 10,
      message: t('loading.loading_locale'),
      estimatedTime: estimateLoadTime(getCriticalSize()),
      loadedBytes: getCriticalSize(),
      totalBytes: getTotalSize(),
    });

    // Step 2: Preload critical assets (UI, essential textures)
    const criticalPromises = CRITICAL_ASSETS.map(id => {
      const tex = TEXTURE_CATALOG[id];
      if (!tex) return Promise.resolve();
      // Preload texture - just ensure it's in the catalog
      return Promise.resolve();
    });

    await Promise.all(criticalPromises);
    updateLoadingProgress({
      state: 'loading',
      progress: 30,
      message: t('loading.loading_critical'),
      estimatedTime: estimateLoadTime(getCriticalSize()),
      loadedBytes: getCriticalSize(),
      totalBytes: getTotalSize(),
    });

    // Step 3: Preload all assets (with quality settings)
    // In production, this would use Vite's import meta for optimal loading
    // For now, we just catalog them
    updateLoadingProgress({
      state: 'loading',
      progress: 50,
      message: t('loading.loading_assets'),
      estimatedTime: estimateLoadTime(getTotalSize() - getCriticalSize()),
      loadedBytes: getCriticalSize(),
      totalBytes: getTotalSize(),
    });

    // Step 4: Initialize systems
    await Promise.all([
      // Initialize texture manager
      // Initialize sprite system
      // Initialize asset storage
    ]);
    updateLoadingProgress({
      state: 'loading',
      progress: 80,
      message: t('loading.loading_systems'),
      estimatedTime: '5s',
      loadedBytes: getTotalSize(),
      totalBytes: getTotalSize(),
    });

    // Step 5: Complete
    updateLoadingProgress({
      state: 'complete',
      progress: 100,
      message: t('loading.loading_complete'),
      estimatedTime: '0s',
      loadedBytes: getTotalSize(),
      totalBytes: getTotalSize(),
    });

    // Hide after short delay
    setTimeout(hideLoadingScreen, 500);

  } catch (err) {
    console.error('[Loading] Failed:', err);
    updateLoadingProgress({
      state: 'error',
      progress: 0,
      message: t('loading.loading_error'),
      estimatedTime: '0s',
    });
    // Still hide after error
    setTimeout(hideLoadingScreen, 2000);
  }
}

// Initialize on boot
document.addEventListener('DOMContentLoaded', () => {
  startLoading().catch(console.error);
});

// Export for testing
export { LoadingProgress, LoadingState, createLoadingScreen, showLoadingScreen, hideLoadingScreen, updateLoadingProgress, startLoading, CRITICAL_ASSETS, ALL_ASSETS };