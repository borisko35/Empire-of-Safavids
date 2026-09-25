// ============================================================
// Texture System — Empire of Safavids
// ============================================================

export type TextureFormat = 'png' | 'jpg' | 'webp' | 'dds' | 'bc7' | 'astc';
export type TextureType =
  | 'albedo'       // Основной цвет
  | 'normal'       // Карта нормалей
  | 'roughness'    // Шероховатость (PBR)
  | 'metallic'     // Металличность (PBR)
  | 'emissive'     // Свечение
  | 'ao'           // Ambient Occlusion
  | 'height'       // Карта высот
  | 'opacity'      // Прозрачность
  | 'ui'           // UI-элементы
  | 'sprite'       // Спрайты
  | 'skybox'       // Скайбокс
  | 'terrain';     // Ландшафт

export type TextureQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface TextureResolution {
  width: number;
  height: number;
}

export interface TextureMipLevel {
  level: number;
  resolution: TextureResolution;
  sizeBytes: number;
  path: string;
}

export interface TextureDefinition {
  id: string;
  name: string;
  nameRu: string;
  type: TextureType;
  category: string;         // 'character' | 'environment' | 'ui' | 'vfx' | 'terrain'
  baseResolution: TextureResolution;
  formats: TextureFormat[];
  mipLevels: TextureMipLevel[];
  srgb: boolean;            // Цветовое пространство
  compressed: boolean;
  tiling: { u: number; v: number };
  tags: string[];
  storagePath: string;      // Путь в хранилище
  cdnUrl: string;           // CDN URL
  sizeBytes: number;
  checksum: string;         // SHA-256
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Каталог текстур
// ============================================================
export const TEXTURE_CATALOG: Record<string, TextureDefinition> = {

  // ── ПЕРСОНАЖИ ──────────────────────────────────────────────
  'tex_qizilbash_armor_albedo': {
    id: 'tex_qizilbash_armor_albedo',
    name: 'Qizilbash Armor Albedo',
    nameRu: 'Доспех Кызылбаша — Цвет',
    type: 'albedo', category: 'character',
    baseResolution: { width: 4096, height: 4096 },
    formats: ['bc7', 'png'],
    mipLevels: [
      { level: 0, resolution: { width: 4096, height: 4096 }, sizeBytes: 16777216, path: 'characters/qizilbash/armor_albedo_4k.bc7' },
      { level: 1, resolution: { width: 2048, height: 2048 }, sizeBytes: 4194304,  path: 'characters/qizilbash/armor_albedo_2k.bc7' },
      { level: 2, resolution: { width: 1024, height: 1024 }, sizeBytes: 1048576,  path: 'characters/qizilbash/armor_albedo_1k.bc7' },
      { level: 3, resolution: { width: 512,  height: 512  }, sizeBytes: 262144,   path: 'characters/qizilbash/armor_albedo_512.bc7' },
    ],
    srgb: true, compressed: true,
    tiling: { u: 1, v: 1 },
    tags: ['character', 'qizilbash', 'armor', 'pbr'],
    storagePath: 'gs://empire-assets/textures/characters/qizilbash/',
    cdnUrl: 'https://cdn.empire-of-safavids.com/textures/characters/qizilbash/',
    sizeBytes: 22282240,
    checksum: 'sha256:a1b2c3d4e5f6...',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
  'tex_qizilbash_armor_normal': {
    id: 'tex_qizilbash_armor_normal',
    name: 'Qizilbash Armor Normal Map',
    nameRu: 'Доспех Кызылбаша — Нормали',
    type: 'normal', category: 'character',
    baseResolution: { width: 4096, height: 4096 },
    formats: ['bc7', 'png'],
    mipLevels: [
      { level: 0, resolution: { width: 4096, height: 4096 }, sizeBytes: 16777216, path: 'characters/qizilbash/armor_normal_4k.bc7' },
      { level: 1, resolution: { width: 2048, height: 2048 }, sizeBytes: 4194304,  path: 'characters/qizilbash/armor_normal_2k.bc7' },
    ],
    srgb: false, compressed: true,
    tiling: { u: 1, v: 1 },
    tags: ['character', 'qizilbash', 'normal', 'pbr'],
    storagePath: 'gs://empire-assets/textures/characters/qizilbash/',
    cdnUrl: 'https://cdn.empire-of-safavids.com/textures/characters/qizilbash/',
    sizeBytes: 20971520,
    checksum: 'sha256:b2c3d4e5f6a1...',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
  'tex_sufi_robe_albedo': {
    id: 'tex_sufi_robe_albedo',
    name: 'Sufi Robe Albedo',
    nameRu: 'Халат Суфия — Цвет',
    type: 'albedo', category: 'character',
    baseResolution: { width: 4096, height: 4096 },
    formats: ['bc7', 'png'],
    mipLevels: [
      { level: 0, resolution: { width: 4096, height: 4096 }, sizeBytes: 16777216, path: 'characters/sufi/robe_albedo_4k.bc7' },
      { level: 1, resolution: { width: 2048, height: 2048 }, sizeBytes: 4194304,  path: 'characters/sufi/robe_albedo_2k.bc7' },
    ],
    srgb: true, compressed: true,
    tiling: { u: 1, v: 1 },
    tags: ['character', 'sufi', 'robe', 'pbr'],
    storagePath: 'gs://empire-assets/textures/characters/sufi/',
    cdnUrl: 'https://cdn.empire-of-safavids.com/textures/characters/sufi/',
    sizeBytes: 20971520,
    checksum: 'sha256:c3d4e5f6a1b2...',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },

  // ── ОКРУЖЕНИЕ ──────────────────────────────────────────────
  'tex_tabriz_stone_albedo': {
    id: 'tex_tabriz_stone_albedo',
    name: 'Tabriz Stone Wall Albedo',
    nameRu: 'Каменная Стена Тебриза — Цвет',
    type: 'albedo', category: 'environment',
    baseResolution: { width: 2048, height: 2048 },
    formats: ['bc7', 'png'],
    mipLevels: [
      { level: 0, resolution: { width: 2048, height: 2048 }, sizeBytes: 4194304, path: 'environment/tabriz/stone_wall_albedo_2k.bc7' },
      { level: 1, resolution: { width: 1024, height: 1024 }, sizeBytes: 1048576, path: 'environment/tabriz/stone_wall_albedo_1k.bc7' },
      { level: 2, resolution: { width: 512,  height: 512  }, sizeBytes: 262144,  path: 'environment/tabriz/stone_wall_albedo_512.bc7' },
    ],
    srgb: true, compressed: true,
    tiling: { u: 4, v: 4 },
    tags: ['environment', 'tabriz', 'stone', 'architecture'],
    storagePath: 'gs://empire-assets/textures/environment/tabriz/',
    cdnUrl: 'https://cdn.empire-of-safavids.com/textures/environment/tabriz/',
    sizeBytes: 5505024,
    checksum: 'sha256:d4e5f6a1b2c3...',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
  'tex_isfahan_mosaic_albedo': {
    id: 'tex_isfahan_mosaic_albedo',
    name: 'Isfahan Mosaic Tile Albedo',
    nameRu: 'Мозаика Исфахана — Цвет',
    type: 'albedo', category: 'environment',
    baseResolution: { width: 4096, height: 4096 },
    formats: ['bc7', 'png'],
    mipLevels: [
      { level: 0, resolution: { width: 4096, height: 4096 }, sizeBytes: 16777216, path: 'environment/isfahan/mosaic_albedo_4k.bc7' },
      { level: 1, resolution: { width: 2048, height: 2048 }, sizeBytes: 4194304,  path: 'environment/isfahan/mosaic_albedo_2k.bc7' },
    ],
    srgb: true, compressed: true,
    tiling: { u: 2, v: 2 },
    tags: ['environment', 'isfahan', 'mosaic', 'architecture', 'islamic_art'],
    storagePath: 'gs://empire-assets/textures/environment/isfahan/',
    cdnUrl: 'https://cdn.empire-of-safavids.com/textures/environment/isfahan/',
    sizeBytes: 20971520,
    checksum: 'sha256:e5f6a1b2c3d4...',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
  'tex_desert_sand_albedo': {
    id: 'tex_desert_sand_albedo',
    name: 'Persian Desert Sand',
    nameRu: 'Персидский Песок',
    type: 'terrain', category: 'terrain',
    baseResolution: { width: 4096, height: 4096 },
    formats: ['bc7', 'png'],
    mipLevels: [
      { level: 0, resolution: { width: 4096, height: 4096 }, sizeBytes: 16777216, path: 'terrain/desert/sand_albedo_4k.bc7' },
      { level: 1, resolution: { width: 2048, height: 2048 }, sizeBytes: 4194304,  path: 'terrain/desert/sand_albedo_2k.bc7' },
    ],
    srgb: true, compressed: true,
    tiling: { u: 16, v: 16 },
    tags: ['terrain', 'desert', 'sand', 'khorasan'],
    storagePath: 'gs://empire-assets/textures/terrain/',
    cdnUrl: 'https://cdn.empire-of-safavids.com/textures/terrain/',
    sizeBytes: 20971520,
    checksum: 'sha256:f6a1b2c3d4e5...',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },

  // ── СКАЙБОКСЫ ──────────────────────────────────────────────
  'tex_skybox_tabriz_day': {
    id: 'tex_skybox_tabriz_day',
    name: 'Tabriz Day Skybox',
    nameRu: 'Небо Тебриза — День',
    type: 'skybox', category: 'environment',
    baseResolution: { width: 4096, height: 2048 },
    formats: ['bc7', 'png'],
    mipLevels: [
      { level: 0, resolution: { width: 4096, height: 2048 }, sizeBytes: 8388608, path: 'skybox/tabriz/day_4k.bc7' },
      { level: 1, resolution: { width: 2048, height: 1024 }, sizeBytes: 2097152, path: 'skybox/tabriz/day_2k.bc7' },
    ],
    srgb: true, compressed: true,
    tiling: { u: 1, v: 1 },
    tags: ['skybox', 'tabriz', 'day', 'hdri'],
    storagePath: 'gs://empire-assets/textures/skybox/',
    cdnUrl: 'https://cdn.empire-of-safavids.com/textures/skybox/',
    sizeBytes: 10485760,
    checksum: 'sha256:a2b3c4d5e6f7...',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
  'tex_skybox_khorasan_night': {
    id: 'tex_skybox_khorasan_night',
    name: 'Khorasan Night Skybox',
    nameRu: 'Небо Хорасана — Ночь',
    type: 'skybox', category: 'environment',
    baseResolution: { width: 4096, height: 2048 },
    formats: ['bc7', 'png'],
    mipLevels: [
      { level: 0, resolution: { width: 4096, height: 2048 }, sizeBytes: 8388608, path: 'skybox/khorasan/night_4k.bc7' },
      { level: 1, resolution: { width: 2048, height: 1024 }, sizeBytes: 2097152, path: 'skybox/khorasan/night_2k.bc7' },
    ],
    srgb: true, compressed: true,
    tiling: { u: 1, v: 1 },
    tags: ['skybox', 'khorasan', 'night', 'stars', 'hdri'],
    storagePath: 'gs://empire-assets/textures/skybox/',
    cdnUrl: 'https://cdn.empire-of-safavids.com/textures/skybox/',
    sizeBytes: 10485760,
    checksum: 'sha256:b3c4d5e6f7a2...',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },

  // ── UI ─────────────────────────────────────────────────────
  'tex_ui_hud_atlas': {
    id: 'tex_ui_hud_atlas',
    name: 'HUD UI Atlas',
    nameRu: 'Атлас HUD-интерфейса',
    type: 'ui', category: 'ui',
    baseResolution: { width: 2048, height: 2048 },
    formats: ['png', 'webp'],
    mipLevels: [
      { level: 0, resolution: { width: 2048, height: 2048 }, sizeBytes: 4194304, path: 'ui/hud/hud_atlas_2k.png' },
      { level: 1, resolution: { width: 1024, height: 1024 }, sizeBytes: 1048576, path: 'ui/hud/hud_atlas_1k.png' },
    ],
    srgb: true, compressed: false,
    tiling: { u: 1, v: 1 },
    tags: ['ui', 'hud', 'atlas', 'interface'],
    storagePath: 'gs://empire-assets/textures/ui/',
    cdnUrl: 'https://cdn.empire-of-safavids.com/textures/ui/',
    sizeBytes: 5242880,
    checksum: 'sha256:c4d5e6f7a2b3...',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
  'tex_ui_icons_items': {
    id: 'tex_ui_icons_items',
    name: 'Item Icons Atlas',
    nameRu: 'Атлас Иконок Предметов',
    type: 'ui', category: 'ui',
    baseResolution: { width: 4096, height: 4096 },
    formats: ['png', 'webp'],
    mipLevels: [
      { level: 0, resolution: { width: 4096, height: 4096 }, sizeBytes: 16777216, path: 'ui/icons/items_atlas_4k.png' },
      { level: 1, resolution: { width: 2048, height: 2048 }, sizeBytes: 4194304,  path: 'ui/icons/items_atlas_2k.png' },
    ],
    srgb: true, compressed: false,
    tiling: { u: 1, v: 1 },
    tags: ['ui', 'icons', 'items', 'atlas'],
    storagePath: 'gs://empire-assets/textures/ui/',
    cdnUrl: 'https://cdn.empire-of-safavids.com/textures/ui/',
    sizeBytes: 20971520,
    checksum: 'sha256:d5e6f7a2b3c4...',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  },
};

// ============================================================
// Менеджер текстур
// ============================================================
export class TextureManager {
  // Cache for future runtime texture loading (currently unused — catalog is metadata-only)
  // @ts-ignore - reserved for CDN texture instance cache
  private loadedTextures = new Map<string, TextureDefinition>();
  private qualitySettings: Record<TextureQuality, number> = {
    low: 3, medium: 2, high: 1, ultra: 0,
  };

  getTexture(id: string): TextureDefinition | undefined {
    return TEXTURE_CATALOG[id];
  }

  getMipLevel(id: string, quality: TextureQuality): TextureMipLevel | undefined {
    const tex = TEXTURE_CATALOG[id];
    if (!tex) return undefined;
    const targetLevel = this.qualitySettings[quality];
    return tex.mipLevels[Math.min(targetLevel, tex.mipLevels.length - 1)];
  }

  getCdnUrl(id: string, quality: TextureQuality = 'high'): string | undefined {
    const tex = TEXTURE_CATALOG[id];
    const mip = this.getMipLevel(id, quality);
    if (!tex || !mip) return undefined;
    return `${tex.cdnUrl}${mip.path.split('/').pop()}`;
  }

  getByCategory(category: string): TextureDefinition[] {
    return Object.values(TEXTURE_CATALOG).filter(t => t.category === category);
  }

  getByType(type: TextureType): TextureDefinition[] {
    return Object.values(TEXTURE_CATALOG).filter(t => t.type === type);
  }

  getByTags(tags: string[]): TextureDefinition[] {
    return Object.values(TEXTURE_CATALOG).filter(t =>
      tags.every(tag => t.tags.includes(tag))
    );
  }

  getTotalSize(): number {
    return Object.values(TEXTURE_CATALOG).reduce((sum, t) => sum + t.sizeBytes, 0);
  }

  getTextureSet(characterClass: string): TextureDefinition[] {
    return Object.values(TEXTURE_CATALOG).filter(t =>
      t.tags.includes(characterClass.toLowerCase())
    );
  }
}

export const textureManager = new TextureManager();
