// ============================================================
// Sprite System — Empire of Safavids
// ============================================================

export interface SpriteFrame {
  id: string;
  x: number;      // позиция в атласе
  y: number;
  width: number;
  height: number;
  pivotX: number; // точка привязки (0–1)
  pivotY: number;
  duration: number; // мс (для анимаций)
}

export interface SpriteAnimation {
  id: string;
  name: string;
  nameRu: string;
  frames: SpriteFrame[];
  loop: boolean;
  fps: number;
  events: { frame: number; event: string }[]; // события на кадрах
}

export interface SpriteSheet {
  id: string;
  name: string;
  nameRu: string;
  atlasTexture: string;   // ID текстуры атласа
  atlasWidth: number;
  atlasHeight: number;
  category: 'ui' | 'vfx' | 'character' | 'environment' | 'item';
  frames: Record<string, SpriteFrame>;
  animations: Record<string, SpriteAnimation>;
  cdnUrl: string;
}

// ============================================================
// Каталог спрайтов
// ============================================================
export const SPRITE_SHEETS: Record<string, SpriteSheet> = {

  // ── UI ИКОНКИ ──────────────────────────────────────────────
  'ss_ui_icons': {
    id: 'ss_ui_icons',
    name: 'UI Icons Sprite Sheet',
    nameRu: 'Спрайты UI-иконок',
    atlasTexture: 'tex_ui_hud_atlas',
    atlasWidth: 2048, atlasHeight: 2048,
    category: 'ui',
    frames: {
      'icon_hp':       { id: 'icon_hp',       x: 0,   y: 0,   width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'icon_mana':     { id: 'icon_mana',     x: 64,  y: 0,   width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'icon_stamina':  { id: 'icon_stamina',  x: 128, y: 0,   width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'icon_gold':     { id: 'icon_gold',     x: 192, y: 0,   width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'icon_exp':      { id: 'icon_exp',      x: 256, y: 0,   width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'icon_sword':    { id: 'icon_sword',    x: 0,   y: 64,  width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'icon_shield':   { id: 'icon_shield',   x: 64,  y: 64,  width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'icon_bow':      { id: 'icon_bow',      x: 128, y: 64,  width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'icon_staff':    { id: 'icon_staff',    x: 192, y: 64,  width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'icon_potion_r': { id: 'icon_potion_r', x: 256, y: 64,  width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'icon_potion_b': { id: 'icon_potion_b', x: 320, y: 64,  width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'icon_guild':    { id: 'icon_guild',    x: 0,   y: 128, width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'icon_map':      { id: 'icon_map',      x: 64,  y: 128, width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'icon_quest':    { id: 'icon_quest',    x: 128, y: 128, width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'icon_settings': { id: 'icon_settings', x: 192, y: 128, width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'icon_chat':     { id: 'icon_chat',     x: 256, y: 128, width: 64, height: 64, pivotX: 0.5, pivotY: 0.5, duration: 0 },
    },
    animations: {},
    cdnUrl: 'https://cdn.empire-of-safavids.com/sprites/ui/',
  },

  // ── VFX СПРАЙТЫ ──────────────────────────────────────────────
  'ss_vfx_fire': {
    id: 'ss_vfx_fire',
    name: 'Fire VFX Sprite Sheet',
    nameRu: 'Спрайты Огня',
    atlasTexture: 'tex_vfx_fire_atlas',
    atlasWidth: 2048, atlasHeight: 2048,
    category: 'vfx',
    frames: {
      'fire_00': { id: 'fire_00', x: 0,   y: 0,   width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
      'fire_01': { id: 'fire_01', x: 256, y: 0,   width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
      'fire_02': { id: 'fire_02', x: 512, y: 0,   width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
      'fire_03': { id: 'fire_03', x: 768, y: 0,   width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
      'fire_04': { id: 'fire_04', x: 0,   y: 256, width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
      'fire_05': { id: 'fire_05', x: 256, y: 256, width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
      'fire_06': { id: 'fire_06', x: 512, y: 256, width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
      'fire_07': { id: 'fire_07', x: 768, y: 256, width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
    },
    animations: {
      'fire_loop': {
        id: 'fire_loop', name: 'Fire Loop', nameRu: 'Огонь — Цикл',
        frames: [
          { id: 'fire_00', x: 0,   y: 0,   width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
          { id: 'fire_01', x: 256, y: 0,   width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
          { id: 'fire_02', x: 512, y: 0,   width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
          { id: 'fire_03', x: 768, y: 0,   width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
          { id: 'fire_04', x: 0,   y: 256, width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
          { id: 'fire_05', x: 256, y: 256, width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
          { id: 'fire_06', x: 512, y: 256, width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
          { id: 'fire_07', x: 768, y: 256, width: 256, height: 256, pivotX: 0.5, pivotY: 0.0, duration: 42 },
        ],
        loop: true, fps: 24,
        events: [],
      },
    },
    cdnUrl: 'https://cdn.empire-of-safavids.com/sprites/vfx/',
  },

  // ── СПРАЙТЫ ПЕРСОНАЖЕЙ (2D миникарты) ──────────────────────────
  'ss_minimap_icons': {
    id: 'ss_minimap_icons',
    name: 'Minimap Icons',
    nameRu: 'Иконки Миникарты',
    atlasTexture: 'tex_ui_hud_atlas',
    atlasWidth: 2048, atlasHeight: 2048,
    category: 'ui',
    frames: {
      'mm_player':    { id: 'mm_player',    x: 0,  y: 512, width: 32, height: 32, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'mm_enemy':     { id: 'mm_enemy',     x: 32, y: 512, width: 32, height: 32, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'mm_boss':      { id: 'mm_boss',      x: 64, y: 512, width: 32, height: 32, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'mm_npc':       { id: 'mm_npc',       x: 96, y: 512, width: 32, height: 32, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'mm_quest':     { id: 'mm_quest',     x: 128,y: 512, width: 32, height: 32, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'mm_dungeon':   { id: 'mm_dungeon',   x: 160,y: 512, width: 32, height: 32, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'mm_shop':      { id: 'mm_shop',      x: 192,y: 512, width: 32, height: 32, pivotX: 0.5, pivotY: 0.5, duration: 0 },
      'mm_waypoint':  { id: 'mm_waypoint',  x: 224,y: 512, width: 32, height: 32, pivotX: 0.5, pivotY: 0.5, duration: 0 },
    },
    animations: {},
    cdnUrl: 'https://cdn.empire-of-safavids.com/sprites/ui/minimap/',
  },

  // ── VFX Удары ──────────────────────────────────────────────
  'ss_vfx_hit': {
    id: 'ss_vfx_hit',
    name: 'Hit Impact VFX',
    nameRu: 'Спрайты Удара',
    atlasTexture: 'tex_vfx_hit_atlas',
    atlasWidth: 1024, atlasHeight: 1024,
    category: 'vfx',
    frames: {
      'hit_00': { id: 'hit_00', x: 0,   y: 0,   width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 33 },
      'hit_01': { id: 'hit_01', x: 128, y: 0,   width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 33 },
      'hit_02': { id: 'hit_02', x: 256, y: 0,   width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 33 },
      'hit_03': { id: 'hit_03', x: 384, y: 0,   width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 33 },
      'hit_04': { id: 'hit_04', x: 0,   y: 128, width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 33 },
      'hit_05': { id: 'hit_05', x: 128, y: 128, width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 33 },
    },
    animations: {
      'hit_normal': {
        id: 'hit_normal', name: 'Normal Hit', nameRu: 'Обычный Удар',
        frames: [
          { id: 'hit_00', x: 0,   y: 0,   width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 33 },
          { id: 'hit_01', x: 128, y: 0,   width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 33 },
          { id: 'hit_02', x: 256, y: 0,   width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 33 },
          { id: 'hit_03', x: 384, y: 0,   width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 33 },
          { id: 'hit_04', x: 0,   y: 128, width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 33 },
          { id: 'hit_05', x: 128, y: 128, width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 33 },
        ],
        loop: false, fps: 30,
        events: [{ frame: 0, event: 'play_hit_sound' }],
      },
      'hit_critical': {
        id: 'hit_critical', name: 'Critical Hit', nameRu: 'Критический Удар',
        frames: [
          { id: 'hit_00', x: 0,   y: 0,   width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 25 },
          { id: 'hit_01', x: 128, y: 0,   width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 25 },
          { id: 'hit_02', x: 256, y: 0,   width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 25 },
          { id: 'hit_03', x: 384, y: 0,   width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 25 },
          { id: 'hit_04', x: 0,   y: 128, width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 25 },
          { id: 'hit_05', x: 128, y: 128, width: 128, height: 128, pivotX: 0.5, pivotY: 0.5, duration: 25 },
        ],
        loop: false, fps: 40,
        events: [{ frame: 0, event: 'play_critical_sound' }],
      },
    },
    cdnUrl: 'https://cdn.empire-of-safavids.com/sprites/vfx/hit/',
  },
};

// ============================================================
// Менеджер спрайтов
// ============================================================
export class SpriteManager {
  getSpriteSheet(id: string): SpriteSheet | undefined {
    return SPRITE_SHEETS[id];
  }

  getFrame(sheetId: string, frameId: string): SpriteFrame | undefined {
    return SPRITE_SHEETS[sheetId]?.frames[frameId];
  }

  getAnimation(sheetId: string, animId: string): SpriteAnimation | undefined {
    return SPRITE_SHEETS[sheetId]?.animations[animId];
  }

  /** Возвращает UV-координаты фрейма (0–1) */
  getUV(sheetId: string, frameId: string): { u0: number; v0: number; u1: number; v1: number } | undefined {
    const sheet = SPRITE_SHEETS[sheetId];
    const frame = sheet?.frames[frameId];
    if (!sheet || !frame) return undefined;
    return {
      u0: frame.x / sheet.atlasWidth,
      v0: frame.y / sheet.atlasHeight,
      u1: (frame.x + frame.width)  / sheet.atlasWidth,
      v1: (frame.y + frame.height) / sheet.atlasHeight,
    };
  }

  getByCategory(category: SpriteSheet['category']): SpriteSheet[] {
    return Object.values(SPRITE_SHEETS).filter(s => s.category === category);
  }

  /** Возвращает фрейм анимации по времени (ms) */
  getFrameAtTime(sheetId: string, animId: string, timeMs: number): SpriteFrame | undefined {
    const anim = this.getAnimation(sheetId, animId);
    if (!anim || anim.frames.length === 0) return undefined;
    const totalDuration = anim.frames.reduce((s, f) => s + f.duration, 0);
    const t = anim.loop ? timeMs % totalDuration : Math.min(timeMs, totalDuration - 1);
    let elapsed = 0;
    for (const frame of anim.frames) {
      elapsed += frame.duration;
      if (t < elapsed) return frame;
    }
    return anim.frames[anim.frames.length - 1];
  }
}

export const spriteManager = new SpriteManager();
