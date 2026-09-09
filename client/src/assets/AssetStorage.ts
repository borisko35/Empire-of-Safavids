// ============================================================
// Asset Storage — бандлы активов — Empire of Safavids
// ============================================================

export type BundleState = 'not_installed' | 'downloading' | 'installed' | 'outdated';

export type BundlePriority = 'critical' | 'high' | 'normal' | 'optional';

export interface AssetBundle {
  id: string;
  name: string;
  nameRu: string;
  version: string;             // semver бандла
  priority: BundlePriority;    // critical — грузится при первом запуске
  sizeBytes: number;
  checksum: string;            // SHA-256 манифеста
  dependsOn: string[];         // ID других бандлов
  contains: {
    textures: string[];        // ID из TEXTURE_CATALOG
    sprites: string[];         // ID из SPRITE_SHEETS
    models?: string[];
    audio?: string[];
  };
  cdnUrl: string;
  requiredDiskSpace: number;   // с учётом распаковки
}

// ============================================================
// Каталог бандлов
// ============================================================
export const ASSET_BUNDLES: Record<string, AssetBundle> = {

  'bundle_core': {
    id: 'bundle_core',
    name: 'Core Assets',
    nameRu: 'Базовые активы',
    version: '1.0.0',
    priority: 'critical',
    sizeBytes: 250 * 1024 * 1024,
    checksum: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    dependsOn: [],
    contains: {
      textures: ['tex_ui_hud_atlas', 'tex_terrain_tabriz'],
      sprites: ['ss_ui_icons'],
    },
    cdnUrl: 'https://cdn.empire-of-safavids.com/bundles/core/',
    requiredDiskSpace: 400 * 1024 * 1024,
  },

  'bundle_characters': {
    id: 'bundle_characters',
    name: 'Character Assets',
    nameRu: 'Активы персонажей',
    version: '1.0.0',
    priority: 'critical',
    sizeBytes: 800 * 1024 * 1024,
    checksum: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    dependsOn: ['bundle_core'],
    contains: {
      textures: ['tex_char_qizilbash', 'tex_char_sufi_mystic'],
      sprites: ['ss_char_animations'],
    },
    cdnUrl: 'https://cdn.empire-of-safavids.com/bundles/characters/',
    requiredDiskSpace: 1200 * 1024 * 1024,
  },

  'bundle_world_tabriz': {
    id: 'bundle_world_tabriz',
    name: 'Tabriz Region',
    nameRu: 'Регион Тебриз',
    version: '1.0.0',
    priority: 'high',
    sizeBytes: 600 * 1024 * 1024,
    checksum: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    dependsOn: ['bundle_core'],
    contains: {
      textures: ['tex_terrain_tabriz', 'tex_env_bazaar'],
      sprites: [],
    },
    cdnUrl: 'https://cdn.empire-of-safavids.com/bundles/world/tabriz/',
    requiredDiskSpace: 900 * 1024 * 1024,
  },

  'bundle_world_isfahan': {
    id: 'bundle_world_isfahan',
    name: 'Isfahan Region',
    nameRu: 'Регион Исфахан',
    version: '1.0.0',
    priority: 'normal',
    sizeBytes: 700 * 1024 * 1024,
    checksum: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    dependsOn: ['bundle_core'],
    contains: {
      textures: ['tex_terrain_isfahan', 'tex_env_palace'],
      sprites: [],
    },
    cdnUrl: 'https://cdn.empire-of-safavids.com/bundles/world/isfahan/',
    requiredDiskSpace: 1000 * 1024 * 1024,
  },

  'bundle_vfx': {
    id: 'bundle_vfx',
    name: 'Visual Effects',
    nameRu: 'Визуальные эффекты',
    version: '1.0.0',
    priority: 'optional',
    sizeBytes: 350 * 1024 * 1024,
    checksum: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    dependsOn: ['bundle_core'],
    contains: {
      textures: ['tex_vfx_fire', 'tex_vfx_lightning'],
      sprites: ['ss_vfx_effects'],
    },
    cdnUrl: 'https://cdn.empire-of-safavids.com/bundles/vfx/',
    requiredDiskSpace: 500 * 1024 * 1024,
  },
};

// ============================================================
// Менеджер хранилища активов
// ============================================================
export class AssetStorage {
  private bundleStates = new Map<string, BundleState>();
  private installedVersion = new Map<string, string>();
  private downloadProgress = new Map<string, number>(); // 0–100

  getBundle(id: string): AssetBundle | undefined {
    return ASSET_BUNDLES[id];
  }

  getByPriority(priority: BundlePriority): AssetBundle[] {
    return Object.values(ASSET_BUNDLES).filter(b => b.priority === priority);
  }

  getState(id: string): BundleState {
    const bundle = ASSET_BUNDLES[id];
    if (!bundle) return 'not_installed';

    const installed = this.installedVersion.get(id);
    if (!installed) return this.bundleStates.get(id) ?? 'not_installed';
    if (installed !== bundle.version) return 'outdated';
    return 'installed';
  }

  getProgress(id: string): number {
    return this.downloadProgress.get(id) ?? 0;
  }

  /** Все бандлы, от которых зависит указанный (транзитивно) */
  getDependencies(id: string): AssetBundle[] {
    const visited = new Set<string>();
    const result: AssetBundle[] = [];

    const walk = (bundleId: string) => {
      const bundle = ASSET_BUNDLES[bundleId];
      if (!bundle) return;
      for (const depId of bundle.dependsOn) {
        if (visited.has(depId)) continue;
        visited.add(depId);
        const dep = ASSET_BUNDLES[depId];
        if (dep) {
          result.push(dep);
          walk(depId);
        }
      }
    };
    walk(id);
    return result;
  }

  /** Проверка готовности бандла к использованию (вместе с зависимостями) */
  isReady(id: string): boolean {
    if (this.getState(id) !== 'installed') return false;
    return this.getDependencies(id).every(dep => this.getState(dep.id) === 'installed');
  }

  /** Сколько нужно докачать для установки бандла и его устаревших зависимостей */
  getPendingDownloadBytes(id: string): number {
    let total = 0;
    const targets = [ASSET_BUNDLES[id], ...this.getDependencies(id)];
    for (const bundle of targets) {
      if (bundle && this.getState(bundle.id) !== 'installed') {
        total += bundle.sizeBytes;
      }
    }
    return total;
  }

  // --- Жизненный цикл (вызывается загрузчиком) ---

  markDownloading(id: string): void {
    this.bundleStates.set(id, 'downloading');
    this.downloadProgress.set(id, 0);
  }

  setProgress(id: string, percent: number): void {
    this.downloadProgress.set(id, Math.max(0, Math.min(100, percent)));
  }

  markInstalled(id: string, version: string): void {
    this.installedVersion.set(id, version);
    this.bundleStates.delete(id);
    this.downloadProgress.delete(id);
  }

  getTotalInstalledSize(): number {
    return Array.from(this.installedVersion.keys()).reduce((sum, id) => {
      return sum + (ASSET_BUNDLES[id]?.sizeBytes ?? 0);
    }, 0);
  }
}

export const assetStorage = new AssetStorage();
