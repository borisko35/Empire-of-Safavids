// ============================================================
// Система иконок — Empire of Safavids
// ============================================================
// Все иконки — inline SVG (viewBox 24), наследуют currentColor,
// раскрашиваются классами CSS. Именованный реестр + фабрика.

export const ICONS = {
  // ── Символ империи ──────────────────────────────────────
  star8: '<path d="M12 1.6l2.1 5.5 5-3-3 5 5.5 2.1-5.5 2.1 3 5-5-3L12 22.4l-2.1-5.5-5 3 3-5-5.5-2.1 5.5-2.1-3-5 5 3z"/>',

  // ── Классы ──────────────────────────────────────────────
  sword: '<path d="M4 20l1.5-1.5L4 17l1.4-1.4 1.6 1.6L16.6 7.6 20 2l-5.6 3.4L6.8 13l1.6 1.6L7 16l-1.5-1.5L4 16z"/>',
  shield: '<path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z"/>',
  bow: '<path d="M6 3c6 3 6 15 0 18l-1.5-1.4C9.5 16.5 9.5 7.5 4.5 4.4zM5 11h11v2H5z" transform="rotate(45 12 12)"/>',
  staff: '<path d="M11 8h2v14h-2z"/><circle cx="12" cy="4.5" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  dagger: '<path d="M12 2l2.5 8L12 12l-2.5-2zM10.5 13h3l-.5 5h-2zM11 19h2v3h-2z"/>',
  rapier: '<path d="M19 2l1 1-9.5 11.5-1.5-1.5L19 2zM8 14l2 2-1.5 1.5 1 1L8 20l-2-2-2 2-1-1 2-2-2-2 1.5-1.5 1 1z"/>',

  // ── Ресурсы ─────────────────────────────────────────────
  heart: '<path d="M12 21S3 14.4 3 8.6C3 5.5 5.4 3 8.4 3c1.5 0 2.9.7 3.6 1.8C12.7 3.7 14.1 3 15.6 3 18.6 3 21 5.5 21 8.6 21 14.4 12 21 12 21z"/>',
  drop: '<path d="M12 2s6.5 7.2 6.5 12a6.5 6.5 0 0 1-13 0C5.5 9.2 12 2 12 2z"/>',
  bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  coin: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7l1.4 2.9 3.1.4-2.3 2.2.6 3.1L12 14l-2.8 1.6.6-3.1-2.3-2.2 3.1-.4z"/>',

  // ── Предметы ────────────────────────────────────────────
  potion: '<path d="M10 2h4v3l3.5 6.5A6 6 0 0 1 12 21a6 6 0 0 1-5.5-9.5L10 5zM9 13h6" fill="none" stroke="currentColor" stroke-width="2"/>',
  ore: '<path d="M12 3l7 6-7 12L5 9z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 9h14M12 3l-3 6 3 12 3-12z" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  silk: '<path d="M3 7c3-3 6 3 9 0s6 3 9 0M3 13c3-3 6 3 9 0s6 3 9 0M3 19c3-3 6 3 9 0s6 3 9 0" fill="none" stroke="currentColor" stroke-width="2"/>',
  scroll: '<path d="M6 4h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm2 4h8m-8 4h8m-8 4h5" fill="none" stroke="currentColor" stroke-width="2"/>',
  chest: '<path d="M4 10a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v9H4zM4 13h16M11 11h2" fill="none" stroke="currentColor" stroke-width="2"/>',

  // ── UI ──────────────────────────────────────────────────
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4v10H3z"/>',
  skull: '<path d="M12 2a8 8 0 0 0-8 8c0 3 1.6 5.4 4 6.7V20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3.3c2.4-1.3 4-3.7 4-6.7a8 8 0 0 0-8-8zm-3.5 8.5A1.8 1.8 0 1 1 10.3 8.7a1.8 1.8 0 0 1-1.8 1.8zm7 0a1.8 1.8 0 1 1 1.8-1.8 1.8 1.8 0 0 1-1.8 1.8zM12 12l1.2 2.4h-2.4z"/>',
  globe: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c3 3.5 3 14 0 18-3-4-3-14.5 0-18z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  gear: '<path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5zm9 3.5l-2.2-.6-.6-1.4 1.1-2-1.8-1.8-2 1.1-1.4-.6L13.5 2h-3l-.6 2.2-1.4.6-2-1.1L4.7 5.5l1.1 2-.6 1.4L3 9.5v3l2.2.6.6 1.4-1.1 2 1.8 1.8 2-1.1 1.4.6.6 2.2h3l.6-2.2 1.4-.6 2 1.1 1.8-1.8-1.1-2 .6-1.4 2.2-.6z"/>',
  chat: '<path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6a2 2 0 0 1 2-2z"/>',
  swords: '<path d="M3 3l8 8-2 2-8-8zm18 0l-8 8 2 2 8-8zM6.5 15.5l2 2L5 21l-2-2zm11 0l2 2-3.5 3.5-2-2z"/>',
  clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6v6l4 2" fill="none" stroke="currentColor" stroke-width="2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5z"/>',
  flag: '<path d="M5 2h2v20H5zM9 3h11l-3 4.5L20 12H9z"/>',
  map: '<path d="M9 3l6 2 5-2v16l-5 2-6-2-5 2V5z" fill="none" stroke="currentColor" stroke-width="2"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4l2.1 2.1M19.8 4.2l-2.1 2.1M6.3 17.7l-2.1 2.1" fill="none" stroke="currentColor" stroke-width="2"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
  download: '<path d="M11 3h2v9l3.5-3.5 1.4 1.4L12 16 6.1 9.9l1.4-1.4L11 12zM4 19h16v2H4z"/>',
  back: '<path d="M11 4l8 8-8 8-1.5-1.5L15.9 12 9.5 5.5z"/>',
  play: '<path d="M6 3l14 9-14 9z"/>',
  home: '<path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  book: '<path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm0 1h16M5 8h3m-3 3h3m-3 3h2"/>',

  // ── Вода и рыбалка ──────────────────────────────────────
  fish: '<path d="M2 12c3.5-4.5 7-6.5 11-6.5 3 0 5.5 1 7 3l-1.8 1.2L20 12l-1.8 2.3L20 15.5c-1.5 2-4 3-7 3-4 0-7.5-2-11-6.5z"/><circle cx="16.5" cy="10.5" r="1.1" fill="#0d1117"/>',
  boat: '<path d="M2 15h20l-2.5 4.5a1 1 0 0 1-.9.5H5.4a1 1 0 0 1-.9-.5z"/><path d="M12 2v12M12 4l7 3-7 2z" fill="none" stroke="currentColor" stroke-width="1.8"/>',
} as const;

export type IconName = keyof typeof ICONS;

/** SVG-разметка иконки по имени. size — сторона в пикселях. */
export function icon(name: IconName, size = 24, extraClass = ''): string {
  const body = ICONS[name] ?? ICONS.star8;
  return `<svg class="icon ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${body}</svg>`;
}

/** Иконка класса персонажа */
export const CLASS_ICONS: Record<string, IconName> = {
  qizilbash: 'shield',
  sufi_mystic: 'staff',
  persian_archer: 'bow',
  bazaar_merchant: 'coin',
  court_diplomat: 'rapier',
};

/** Иконка типа предмета */
export const ITEM_ICONS: Record<string, IconName> = {
  weapon: 'sword',
  armor: 'shield',
  accessory: 'coin',
  consumable: 'potion',
  material: 'ore',
  quest: 'scroll',
  trophy: 'skull',   // добыча с монстров
};

/** Цвета редкости (единая палитра с бейджами) */
export const RARITY_COLORS: Record<string, string> = {
  common: '#b8bcc4',
  uncommon: '#6ecf7a',
  rare: '#4aa3e8',
  epic: '#b06ae8',
  legendary: '#e8a84a',
  artifact: '#e85a4a',
};

/** Цвета классов персонажей */
export const CLASS_COLORS: Record<string, string> = {
  qizilbash: '#c23a3a',
  sufi_mystic: '#7a5fd0',
  persian_archer: '#4aa86a',
  bazaar_merchant: '#d0a83a',
  court_diplomat: '#3a8fc2',
};
