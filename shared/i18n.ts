// ============================================================
// Метаданные локализации — Empire of Safavids
// ============================================================

export const SUPPORTED_LOCALES = ['ru', 'en', 'az'] as const;
export type LocaleCode = typeof SUPPORTED_LOCALES[number];
export const DEFAULT_LOCALE: LocaleCode = 'ru';

export interface LocaleMeta {
  code: LocaleCode;
  /** Самоназвание языка для переключателя */
  nativeName: string;
  flagEmoji: string;
}

export const LOCALES: LocaleMeta[] = [
  { code: 'ru', nativeName: 'Русский', flagEmoji: '🇷🇺' },
  { code: 'en', nativeName: 'English', flagEmoji: '🇬🇧' },
  { code: 'az', nativeName: 'Azərbaycanca', flagEmoji: '🇦🇿' },
];

export function isSupportedLocale(code: string | undefined | null): code is LocaleCode {
  return !!code && (SUPPORTED_LOCALES as readonly string[]).includes(code);
}
